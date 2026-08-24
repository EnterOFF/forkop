#!/usr/bin/env ucode

// The service state, served from a process that is already running.
//
// Every status refresh used to be a `forkop get_ui_state`: a ucode start, the
// bytecode-cache resolution, a second interpreter for the module, and only then
// the state itself - about 190 ms on an MT7621, of which roughly 100 ms was
// getting to the point of asking. Paid per refresh, per open tab. This process
// pays none of it: the library is loaded once and the answer is already in
// memory when the question arrives.
//
// It does not poll for the answer either. Computing the state means asking nft
// and iproute2, which is the expensive half, so it is recomputed when something
// could have changed and not on a clock:
//
//   * procd publishes service events over ubus, which is how sing-box going up
//     or down is noticed the moment it happens;
//   * the action directories, the reload lock and the autostart symlink are
//     watched by mtime, which costs a stat and catches every action whoever
//     started it - the page, the init script, ssh;
//   * while an action is running the runtime is re-read once a second, because
//     that is when it is genuinely changing and when someone is watching;
//   * and a slow sweep runs regardless, so a change nothing announced - an nft
//     table dropped by hand - is still picked up.
//
// `state_wait` is what removes polling from the page as well: it holds the
// request until the state actually differs from what the caller last saw, so a
// change reaches the browser in the time it takes to serialise it, and an idle
// page costs one parked request instead of a refresh every ten seconds.

let fs = require("fs");
let ui = require("service.ui");

const PID_FILE = getenv("FORKOP_STATE_SERVICE_PID_FILE") || "/var/run/forkop/state-service.pid";
const OBJECT_NAME = getenv("FORKOP_STATE_SERVICE_OBJECT") || "forkop";
const SERVICE_NAME = getenv("FORKOP_SERVICE_NAME") || "forkop";

// Cheap enough to run several times a second: a handful of stat calls.
const WATCH_INTERVAL_MS = int(getenv("FORKOP_STATE_WATCH_INTERVAL_MS") || "500");
// While an action runs the runtime itself is what changes, and nothing stats it.
const BUSY_REFRESH_MS = int(getenv("FORKOP_STATE_BUSY_REFRESH_MS") || "1000");
// The runtime keeps settling after the action that changed it has finished:
// sing-box has to reach its minimum age, the nft table and the routing rules
// have to come back. Nothing stats any of that, so without looking closely for
// a while after every change the reported state stayed at whatever it happened
// to be at the moment the action ended - a service reported stopped, with a
// Start button, until the next sweep noticed otherwise.
const SETTLE_MS = int(getenv("FORKOP_STATE_SETTLE_MS") || "10000");
const PACKAGE_DB_QUIET_MS = int(getenv("FORKOP_STATE_PACKAGE_DB_QUIET_MS") || "5000");
// The backstop for a change nothing announced.
const SWEEP_INTERVAL_MS = int(getenv("FORKOP_STATE_SWEEP_INTERVAL_MS") || "20000");
// Long enough that an idle page reparks rarely, short enough to sit inside
// uhttpd's network timeout and LuCI's own request ceiling.
const MAX_WAIT_MS = int(getenv("FORKOP_STATE_MAX_WAIT_MS") || "15000");

const AUTOSTART_LINK = "/etc/rc.d/S99" + SERVICE_NAME;
const BIN_PATH = getenv("FORKOP_BIN") || "/usr/bin/forkop";

// Installed versions change when a package is installed or removed and at no
// other time, and both package managers record that in one file. Watching it is
// a stat; working the versions out is roughly 1.7 s of opkg and version
// commands, so this is what decides when to pay that.
//
// The database also moves while an install is still running, and asking opkg
// anything then contends for its lock - which is how this process came to print
// "Could not lock /var/lock/opkg.lock" into the middle of a package upgrade and
// fail its verification. So the signature has to hold still first: a settled
// database means whoever was writing it has finished.
// The page watched the log by asking for the whole filtered buffer every five
// seconds - 48 KB and 310 ms per tab - and working out for itself which lines
// were new. Reading only the tail is ten times cheaper, doing it once serves
// every tab, and only the new lines then cross the wire.
const LOG_PATTERN = getenv("FORKOP_LOG_PATTERN") || "forkop\\|sing-box";
// Deep enough that a poll cannot miss lines between two reads on a busy router.
const LOG_TAIL_LINES = int(getenv("FORKOP_LOG_TAIL_LINES") || "200");
const LOG_BUFFER_LINES = int(getenv("FORKOP_LOG_BUFFER_LINES") || "400");
const LOG_POLL_MS = int(getenv("FORKOP_LOG_POLL_MS") || "1500");
// Polling stops when nobody has asked for a while, so a router with no tab open
// pays nothing for a feature nobody is watching.
const LOG_INTEREST_MS = int(getenv("FORKOP_LOG_INTEREST_MS") || "60000");

const PACKAGE_DB_FILES = [
    getenv("FORKOP_OPKG_STATUS_FILE") || "/usr/lib/opkg/status",
    getenv("FORKOP_APK_DB_FILE") || "/lib/apk/db/installed"
];

function as_string(value) {
    return value == null ? "" : "" + value;
}

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function monotonic_ms() {
    let c = clock(true);
    return c[0] * 1000 + int(c[1] / 1000000);
}

function path_signature(path) {
    let stat = fs.stat(as_string(path));
    if (stat == null)
        return "-";
    return as_string(stat.mtime) + ":" + as_string(stat.size);
}

// One string standing for everything that can change the state without this
// process being told. Comparing it is a few stat calls; recomputing the state is
// three child processes, so the comparison is what runs often.
function watch_signature() {
    return path_signature(ui.SERVICE_ACTION_DIR) + "|" +
        path_signature(ui.COMPONENT_ACTION_DIR) + "|" +
        path_signature(ui.RELOAD_LOCK_DIR) + "|" +
        path_signature(AUTOSTART_LINK);
}

let state = { revision: 0, payload: null, text: "" };
let system_info = { value: null, signature: "" };
let package_db_seen = { signature: "", at_ms: 0 };
let update_checks = { entries: {}, signature: "" };
let log_lines = [];
let log_cursor = 0;
let log_waiters = [];
let last_log_interest_ms = 0;
let last_log_poll_ms = 0;
let waiters = [];
let last_watch = "";
let last_sweep_ms = 0;
let last_busy_refresh_ms = 0;
let settle_until_ms = 0;

function read_log_tail() {
    let pipe = fs.popen("logread -l " + LOG_TAIL_LINES + " -e " +
        shell_quote(LOG_PATTERN) + " 2>/dev/null", "r");
    if (!pipe)
        return [];

    let data = pipe.read("all");
    pipe.close();
    if (data == null)
        return [];

    let result = [];
    for (let line in split(as_string(data), "\n"))
        if (line != "")
            push(result, line);
    return result;
}

// Where the lines we already have end inside a freshly read tail. Matching the
// last known line rather than counting is what survives a busy router pushing
// unrelated entries between two reads; if it has scrolled past, everything in
// the new tail is treated as new, which is the honest answer.
function new_log_lines(tail) {
    if (length(log_lines) == 0)
        return tail;

    let last = log_lines[length(log_lines) - 1].line;
    for (let i = length(tail) - 1; i >= 0; i--)
        if (tail[i] == last)
            return slice(tail, i + 1);

    return tail;
}

function append_log_lines(lines) {
    if (length(lines) == 0)
        return false;

    for (let line in lines)
        push(log_lines, { cursor: ++log_cursor, line });

    if (length(log_lines) > LOG_BUFFER_LINES)
        log_lines = slice(log_lines, length(log_lines) - LOG_BUFFER_LINES);

    return true;
}

function log_reply(cursor) {
    cursor = int(cursor || 0);
    let lines = [];

    // A reader with no cursor is starting up and gets the tail as it stands, so
    // the page has something to show without a second round trip.
    for (let entry in log_lines)
        if (cursor <= 0 || entry.cursor > cursor)
            push(lines, entry.line);

    return { cursor: log_cursor, lines };
}

function wake_log_waiters() {
    let pending = log_waiters;
    log_waiters = [];
    for (let waiter in pending) {
        try {
            waiter.request.reply(log_reply(waiter.cursor));
        }
        catch (e) {
        }
    }
}

function poll_log(force) {
    let now = monotonic_ms();
    if (!force && now - last_log_poll_ms < LOG_POLL_MS)
        return false;

    last_log_poll_ms = now;
    if (!append_log_lines(new_log_lines(read_log_tail())))
        return false;

    wake_log_waiters();
    return true;
}

function log_interest() {
    last_log_interest_ms = monotonic_ms();
}

function log_is_watched() {
    return length(log_waiters) > 0 ||
        monotonic_ms() - last_log_interest_ms < LOG_INTEREST_MS;
}

function package_db_signature() {
    let signature = "";
    for (let path in PACKAGE_DB_FILES)
        signature += path_signature(path) + "|";
    return signature;
}

// Read from the CLI rather than by requiring diagnostics/runtime.uc: that module
// is fifteen hundred lines with a wide require chain, and this process would
// carry all of it in memory to answer a question asked once per package change.
// What the last update check found upstream. A scheduled job has to leave its
// answer somewhere for the page to read hours later; it used to be a file per
// component under /var/run, which is a copy of an answer that can go out of date
// without anything noticing.
//
// Here it is held beside everything else this process holds, and stamped with
// the package database as it was when the check ran. Install or remove anything
// and the stamp no longer matches, so the answer is dropped rather than served -
// which is the case the files got wrong: an `opkg upgrade` behind Forkop's back
// left them claiming an update was available for a version already installed.
function store_update_check(component, result) {
    component = as_string(component);
    if (component == "" || type(result) != "object")
        return false;

    if (package_db_signature() != update_checks.signature)
        update_checks = { entries: {}, signature: package_db_signature() };

    update_checks.entries[component] = result;
    return true;
}

function update_check_results() {
    if (package_db_signature() != update_checks.signature) {
        update_checks = { entries: {}, signature: package_db_signature() };
        return [];
    }

    let results = [];
    for (let _, entry in update_checks.entries)
        push(results, entry);
    return results;
}

function read_system_info() {
    let pipe = fs.popen(shell_quote(BIN_PATH) + " get_system_info 2>/dev/null", "r");
    if (!pipe)
        return null;

    let data = pipe.read("all");
    pipe.close();
    if (data == null)
        return null;

    try {
        return json(data);
    }
    catch (e) {
        return null;
    }
}

// True once the package database has looked the same for long enough that
// nobody is still writing it.
function package_db_settled(signature, now) {
    if (signature != package_db_seen.signature)
        package_db_seen = { signature, at_ms: now };

    return now - package_db_seen.at_ms >= PACKAGE_DB_QUIET_MS;
}

function refresh_system_info(force) {
    let signature = package_db_signature();
    let known = system_info.value != null;
    if (!force && known && signature == system_info.signature)
        return false;

    // Asking opkg during an install fights it for its own lock. The first answer
    // is worth having straight away - nothing is installing at boot - but any
    // later one waits for the database to stop moving.
    if (known && !package_db_settled(signature, monotonic_ms()))
        return false;

    let value = read_system_info();
    if (value == null)
        return false;

    system_info = { value, signature };
    return true;
}

// How long to keep looking after something moved. Every change restarts the
// window, so a runtime that is still coming up is watched until it stops
// changing rather than for a fixed time after the action.
function settle_deadline(now, changed, current_deadline) {
    now = int(now);
    current_deadline = int(current_deadline || 0);
    return changed ? now + SETTLE_MS : current_deadline;
}

// True while the state deserves the close cadence rather than the slow sweep:
// an action is running, or something changed recently enough that the runtime
// may not have finished settling.
function needs_close_refresh(now, busy, deadline, last_refresh) {
    now = int(now);
    if (!busy && now >= int(deadline || 0))
        return false;
    return now - int(last_refresh || 0) >= BUSY_REFRESH_MS;
}

function state_is_busy() {
    let payload = state.payload;
    return payload != null && payload.service.forkop.busy != null;
}

function reply_payload() {
    let payload = state.payload == null ? {} : state.payload;
    return {
        revision: state.revision,
        service: payload.service,
        capabilities: payload.capabilities,
        actions: payload.actions
    };
}

function wake_waiters() {
    let pending = waiters;
    waiters = [];
    for (let waiter in pending) {
        try {
            waiter.reply(reply_payload());
        }
        catch (e) {
        }
    }
}

// The revision moves only when the answer does. A recompute that produces the
// same payload must not wake a parked request, or an idle page would be handed
// an identical state every sweep and the parking would buy nothing.
function recompute() {
    let payload = ui.current_ui_state();
    let text = sprintf("%J", payload);
    if (text == state.text)
        return false;

    state = { revision: state.revision + 1, payload, text };
    settle_until_ms = settle_deadline(monotonic_ms(), true, settle_until_ms);
    wake_waiters();
    return true;
}

function tick() {
    let now = monotonic_ms();
    let signature = watch_signature();
    let due_sweep = now - last_sweep_ms >= SWEEP_INTERVAL_MS;
    let due_close = needs_close_refresh(now, state_is_busy(), settle_until_ms, last_busy_refresh_ms);

    if (signature == last_watch && !due_sweep && !due_close)
        return;

    last_watch = signature;
    if (due_sweep)
        last_sweep_ms = now;
    if (due_close)
        last_busy_refresh_ms = now;

    recompute();

    // Cheap unless a package actually changed, and the sweep is a fine moment to
    // notice one installed from outside Forkop.
    if (due_sweep)
        refresh_system_info(false);
}

function log_tick() {
    if (log_is_watched())
        poll_log(false);
}

function log_message(message, level) {
    system("logger -t " + shell_quote(SERVICE_NAME) + " " +
        shell_quote("[" + as_string(level || "info") + "] " + as_string(message)) +
        " >/dev/null 2>&1");
}

function current_pid() {
    let stat = as_string(fs.readfile("/proc/self/stat"));
    let separator = index(stat, " ");
    return separator > 0 ? substr(stat, 0, separator) : "0";
}

function ensure_pid_dir() {
    let slash = rindex(PID_FILE, "/");
    if (slash > 0)
        system("mkdir -p " + shell_quote(substr(PID_FILE, 0, slash)) + " >/dev/null 2>&1");
}

function object_methods() {
    return {
        // The state as it stands. Used for the first paint and whenever a page
        // wants an answer without waiting for one to change.
        state: {
            call: function(request) {
                return reply_payload();
            },
            args: { ubus_rpc_session: "" }
        },
        // Held until the state differs from the revision the caller already has,
        // or until the ceiling, whichever comes first. A caller that is already
        // behind is answered at once.
        state_wait: {
            call: function(request) {
                let want = int(request.args.revision || 0);
                if (state.payload == null || state.revision != want)
                    return reply_payload();

                request.defer();
                push(waiters, request);
                return null;
            },
            args: { revision: 0, ubus_rpc_session: "" }
        },
        // The Forkop and sing-box log lines this service has seen, from the
        // cursor the caller last held. A caller with no cursor gets the tail.
        logs: {
            call: function(request) {
                log_interest();
                poll_log(false);
                return log_reply(request.args.cursor);
            },
            args: { cursor: 0, ubus_rpc_session: "" }
        },
        // Held until there is a line the caller has not seen.
        logs_wait: {
            call: function(request) {
                log_interest();
                poll_log(false);

                let want = int(request.args.cursor || 0);
                if (want <= 0 || log_cursor != want)
                    return log_reply(want);

                request.defer();
                push(log_waiters, { request, cursor: want });
                return null;
            },
            args: { cursor: 0, ubus_rpc_session: "" }
        },
        // What the last update check found. Dropped when the installed packages
        // change, so it cannot outlive the versions it was an answer about.
        update_checks: {
            call: function(request) {
                return { results: update_check_results() };
            },
            args: { ubus_rpc_session: "" }
        },
        // Written by the check itself, scheduled or started by hand.
        report_update_check: {
            call: function(request) {
                let result = null;
                try {
                    result = json(as_string(request.args.result));
                }
                catch (e) {
                    result = null;
                }

                if (result == null)
                    return { stored: false };

                return { stored: store_update_check(request.args.component, result) };
            },
            args: { component: "", result: "", ubus_rpc_session: "" }
        },
        forget_update_checks: {
            call: function(request) {
                update_checks = { entries: {}, signature: package_db_signature() };
                return { forgotten: true };
            },
            args: { ubus_rpc_session: "" }
        },
        // Installed versions and the device it all runs on. Worked out once and
        // held until the installed packages change, which is what the page used
        // to keep in a file with a TTL it then had to prove.
        system_info: {
            call: function(request) {
                refresh_system_info(false);
                return system_info.value == null
                    ? { available: false }
                    : { available: true, system_info: system_info.value };
            },
            args: { ubus_rpc_session: "" }
        },
        // For a caller that has just changed something and does not want to wait
        // for the watch to notice - a component action, an apply.
        refresh: {
            call: function(request) {
                recompute();
                // Deliberately not forced: a caller announcing a change may be
                // announcing one that is still in progress.
                refresh_system_info(false);
                return reply_payload();
            },
            args: { ubus_rpc_session: "" }
        }
    };
}

function run() {
    let ubus = require("ubus");
    let uloop = require("uloop");

    uloop.init();

    let connection = ubus.connect();
    if (connection == null) {
        log_message("State service could not reach ubus", "error");
        return 1;
    }

    if (connection.publish(OBJECT_NAME, object_methods()) == null) {
        log_message("State service could not publish the " + OBJECT_NAME + " object", "error");
        return 1;
    }

    // procd reports a service starting or stopping, which is the one change that
    // matters most and the one no directory mtime reflects.
    let subscriber = connection.subscriber(function(notification) {
        recompute();
    }, function(id) {});
    if (subscriber != null)
        subscriber.subscribe("service");

    recompute();
    last_sweep_ms = monotonic_ms();
    refresh_system_info(true);

    uloop.interval(WATCH_INTERVAL_MS, function() {
        tick();
    });

    uloop.interval(LOG_POLL_MS, function() {
        log_tick();
    });

    // A parked request must not outlive what the transport in front of it will
    // wait for, so the ceiling is enforced here rather than left to time out
    // somewhere less forgiving.
    uloop.interval(MAX_WAIT_MS, function() {
        wake_waiters();
        wake_log_waiters();
    });

    ensure_pid_dir();
    fs.writefile(PID_FILE, current_pid() + "\n");

    uloop.run();
    return 0;
}

if ((sourcepath(1) != null && sourcepath(1) != "") || ARGV[0] == null)
    return {
        watch_signature,
        reply_payload,
        package_db_signature,
        settle_deadline,
        needs_close_refresh,
        new_log_lines,
        log_reply,
        // Seeding the buffer is what lets the delta logic be exercised without a
        // router and without a log to read.
        remember_log_line: function(line) { append_log_lines([ line ]); },
        store_update_check,
        update_check_results
    };

let mode = ARGV[0] || "";

if (mode == "run")
    exit(run());

warn("Usage: service/state_service.uc run\n");
exit(1);
