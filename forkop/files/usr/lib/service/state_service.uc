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
// request until the state actually differs from what the caller last saw, or a
// log line arrives the caller has not seen, so a change reaches the browser in
// the time it takes to serialise it, and an idle page costs one parked request
// instead of a refresh every ten seconds. One, because a browser keeps six
// connections to a host and lets every other request of every tab wait behind
// them: a page that parked a request for the log beside the one for the state
// made three open pages enough to stall the whole of LuCI.

let fs = require("fs");
let common = require("core.common");
let exec = require("core.exec");
let constants = require("core.constants");
let ui = require("service.ui");
let uci = require("core.uci");
let health = require("service.health");
let features = require("singbox.features");

const OBJECT_NAME = getenv("FORKOP_STATE_SERVICE_OBJECT") || "forkop";

// Cheap enough to run several times a second: a handful of stat calls.
const WATCH_INTERVAL_MS = 500;
// While an action runs the runtime itself is what changes, and nothing stats it.
const BUSY_REFRESH_MS = 1000;
// The runtime keeps settling after the action that changed it has finished:
// sing-box has to reach its minimum age, the nft table and the routing rules
// have to come back. Nothing stats any of that, so without looking closely for
// a while after every change the reported state stayed at whatever it happened
// to be at the moment the action ended - a service reported stopped, with a
// Start button, until the next sweep noticed otherwise.
const SETTLE_MS = 10000;
// The backstop for a change nothing announced.
const SWEEP_INTERVAL_MS = 20000;
// Long enough that an idle page reparks rarely, short enough to sit inside
// uhttpd's network timeout and LuCI's own request ceiling.
const MAX_WAIT_MS = 15000;
// A port rebind is not an outage. sing-box closes and reopens every inbound
// when it reloads and when procd respawns it - six seconds after a reload
// signal and about twelve around a crash respawn, measured on the reference
// router - and through that window the readiness predicate is honestly false
// while the service the user is looking at never went away. So a running
// service is not reported stopped on one look: as long as the sing-box process
// exists, the flip to "stopped" has to persist for this long to be believed.
// A stop and a crash procd gave up on kill the process, and are reported the
// moment they are seen.
const DOWN_GRACE_MS = 15000;

// The page watched the log by asking for the whole filtered buffer every five
// seconds - 48 KB and 310 ms per tab - and working out for itself which lines
// were new. Reading only the tail is ten times cheaper, doing it once serves
// every tab, and only the new lines then cross the wire.
const LOG_PATTERN = constants.FORKOP_LOG_PATTERN;
// Deep enough that a poll cannot miss lines between two reads on a busy router.
const LOG_TAIL_LINES = 200;
const LOG_BUFFER_LINES = 400;
const LOG_POLL_MS = 1500;
// Polling stops when nobody has asked for a while, so a router with no tab open
// pays nothing for a feature nobody is watching.
const LOG_INTEREST_MS = 60000;

let paths = {
    config: "/etc/config/forkop",
    // Installed versions change when a package is installed or removed and at
    // no other time, and both package managers record that in one file.
    // Watching it is a stat; working the versions out is a CLI run, so this is
    // what decides when to pay that.
    package_databases: [ "/usr/lib/opkg/status", "/lib/apk/db/installed" ]
};

function monotonic_ms() {
    let c = clock(true);
    return c[0] * 1000 + int(c[1] / 1000000);
}

function path_signature(path) {
    let stat = fs.stat(path);
    if (stat == null)
        return "-";
    return stat.mtime + ":" + stat.size;
}

// One string standing for everything that can change the state without this
// process being told. Comparing it is a few stat calls; recomputing the state is
// three child processes, so the comparison is what runs often.
function watch_signature() {
    return path_signature(paths.config) + "|" +
        path_signature(ui.paths.service_actions) + "|" +
        path_signature(ui.paths.reload_lock) + "|" +
        path_signature(ui.paths.rc_dir + "/S" + constants.FORKOP_START_PRIORITY + "forkop");
}

let state = { revision: 0, payload: null, text: "" };
let system_info = { value: null, signature: "" };
let log_lines = [];
let log_cursor = 0;
let last_log_interest_ms = 0;
let last_log_poll_ms = 0;
let waiters = [];
let last_watch = "";
let last_config = "";
let last_sweep_ms = 0;
let last_busy_refresh_ms = 0;
let settle_until_ms = 0;
let down_since_ms = 0;

function read_log_tail() {
    let data = exec.output([ "logread", "-l", LOG_TAIL_LINES, "-e", LOG_PATTERN ]);
    return filter(split(data ?? "", "\n"), (line) => line != "");
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

    for (let entry in log_lines)
        if (entry.cursor > cursor)
            push(lines, entry.line);

    return { cursor: log_cursor, lines };
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

// A caller that sends no cursor waits for the state alone.
function follows_log(waiter) {
    return waiter.cursor != null;
}

function wait_reply(waiter) {
    let reply = reply_payload();
    if (follows_log(waiter)) {
        let log = log_reply(waiter.cursor);
        reply.cursor = log.cursor;
        reply.lines = log.lines;
    }
    return reply;
}

function answer_waiters(pending) {
    for (let waiter in pending) {
        try {
            waiter.request.reply(wait_reply(waiter));
        }
        catch (e) {
        }
    }
}

function wake_waiters() {
    let pending = waiters;
    waiters = [];
    answer_waiters(pending);
}

// A new line answers only the requests that asked for the log.
function wake_log_waiters() {
    let pending = filter(waiters, follows_log);
    waiters = filter(waiters, (waiter) => !follows_log(waiter));
    answer_waiters(pending);
}

// The interval is the log's clock and reads on every tick; a request reads only
// when the last read is older than an interval.
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
    return length(filter(waiters, follows_log)) > 0 ||
        monotonic_ms() - last_log_interest_ms < LOG_INTEREST_MS;
}

function package_db_signature() {
    let signature = "";
    for (let path in paths.package_databases)
        signature += path_signature(path) + "|";
    return signature;
}

// Read from the CLI rather than by requiring diagnostics/runtime.uc: that module
// is fifteen hundred lines with a wide require chain, and this process would
// carry all of it in memory to answer a question asked once per package change.
function read_system_info() {
    let value = common.parse_json(exec.output([ constants.FORKOP_BIN, "get_system_info" ]));
    return type(value) == "object" ? value : null;
}

// An answer read while an install is still writing the database is stamped
// with the database as it was, so the next change reads it again.
function refresh_system_info() {
    let signature = package_db_signature();
    if (system_info.value != null && signature == system_info.signature)
        return false;

    let value = read_system_info();
    if (value == null)
        return false;

    system_info = { value, signature };
    return true;
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

// Whether a freshly observed "not running" is believed yet, given what was
// published before. Pure so the grace behavior can be tested without a clock:
// the caller owns `down_since_ms` and passes it back in.
function settled_running(observed_running, process_alive, prev_running, down_since, now_ms, grace_ms) {
    if (observed_running)
        return { running: true, down_since_ms: 0 };
    if (!process_alive || !prev_running)
        return { running: false, down_since_ms: 0 };
    if (int(down_since || 0) == 0)
        return { running: true, down_since_ms: int(now_ms) };
    if (int(now_ms) - int(down_since) >= int(grace_ms))
        return { running: false, down_since_ms: int(down_since) };
    return { running: true, down_since_ms: int(down_since) };
}

// The instantaneous state says what is true this instant; what this process
// publishes is what has settled. While the grace holds a flip back, the
// running-derived fields are kept coherent with it: the status text follows the
// held value and the fresh enabled bit.
function apply_settled_running(payload) {
    let forkop = payload.service.forkop;
    let previous = state.payload;
    let prev_running = previous != null && previous.service.forkop.running == 1;

    let settled = settled_running(
        forkop.running == 1,
        health.sing_box_service_running(),
        prev_running,
        down_since_ms,
        monotonic_ms(),
        DOWN_GRACE_MS
    );
    down_since_ms = settled.down_since_ms;

    if (!settled.running || forkop.running == 1)
        return;

    forkop.running = 1;
    forkop.status = health.service_status_text(1, forkop.enabled);
    // The premise of holding the value is that the process exists, so the
    // sing-box row must not contradict it while a respawned process is still
    // younger than its own stability age.
    payload.service.sing_box.running = 1;
    payload.service.sing_box.status = health.service_status_text(1, payload.service.sing_box.enabled);
}

// The revision moves only when the answer does. A recompute that produces the
// same payload must not wake a parked request, or an idle page would be handed
// an identical state every sweep and the parking would buy nothing.
function recompute() {
    // A configuration the cursor has already read stays in it, so a changed one
    // is read again rather than answered from memory - by every recompute, the
    // one a page asks for right after saving included.
    let config = path_signature(paths.config);
    if (config != last_config) {
        last_config = config;
        uci.reset();
    }

    let payload = ui.current_ui_state();
    // What the core can do rides along, so the page learns it from the first
    // answer; it is read from the binary once, and again only once that changes.
    payload.capabilities.core = features.report();
    apply_settled_running(payload);
    let text = sprintf("%J", payload);
    if (text == state.text)
        return false;

    state = { revision: state.revision + 1, payload, text };
    // Every change restarts the settle window, so a runtime that is still coming
    // up is watched until it stops changing rather than for a fixed time.
    settle_until_ms = monotonic_ms() + SETTLE_MS;
    wake_waiters();
    return true;
}

function tick() {
    let now = monotonic_ms();
    let signature = watch_signature();
    let due_sweep = now - last_sweep_ms >= SWEEP_INTERVAL_MS;
    // A pending down-flip needs the close cadence too: holding the old value
    // often publishes nothing, so the settle window is not extended, and the
    // grace has to expire on a look rather than on the next slow sweep.
    let due_close = needs_close_refresh(now, state_is_busy() || down_since_ms != 0, settle_until_ms, last_busy_refresh_ms);

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
        refresh_system_info();
}

function log_tick() {
    if (log_is_watched())
        poll_log(true);
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
        // until a line arrives past the log cursor it sent, or until the
        // ceiling, whichever comes first. A caller that is already behind is
        // answered at once. One ahead of the log holds a cursor from before this
        // process started, and is handed the current one to wait from.
        state_wait: {
            call: function(request) {
                let waiter = { request, cursor: null };
                if (request.args.cursor != null) {
                    log_interest();
                    waiter.cursor = int(request.args.cursor);
                }

                if (state.payload == null || state.revision != int(request.args.revision || 0) ||
                    (follows_log(waiter) && waiter.cursor != log_cursor))
                    return wait_reply(waiter);

                request.defer();
                push(waiters, waiter);
                return null;
            },
            args: { revision: 0, cursor: 0, ubus_rpc_session: "" }
        },
        // Where the log of Forkop and sing-box lines stands now, for a page to
        // wait from. What it held before is history the page does not show.
        logs: {
            call: function(request) {
                log_interest();
                poll_log(false);
                return { cursor: log_cursor };
            },
            args: { ubus_rpc_session: "" }
        },
        // Installed versions and the device it all runs on. Worked out once and
        // held until the installed packages change, which is what the page used
        // to keep in a file with a TTL it then had to prove.
        system_info: {
            call: function(request) {
                refresh_system_info();
                return system_info.value == null
                    ? { available: false }
                    : { available: true, system_info: system_info.value };
            },
            args: { ubus_rpc_session: "" }
        },
        // What the core costs the router now and how long it has run. The
        // dashboard asks every few seconds while it is shown, so the answer is
        // read from /proc by the process already running, not by a CLI start.
        usage: {
            call: function(request) {
                return health.sing_box_usage();
            },
            args: { ubus_rpc_session: "" }
        },
        // For a caller that has just changed something and does not want to wait
        // for the watch to notice - an apply.
        refresh: {
            call: function(request) {
                recompute();
                refresh_system_info();
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
    // libubox's own SIGTERM handler only raises a flag that uloop.run() clears
    // when it starts: a stop arriving while the first state is read would be
    // lost, and procd would kill the service five seconds later. A handler of
    // our own is queued until the loop runs.
    uloop.signal("SIGTERM", () => uloop.end());

    let connection = ubus.connect();
    if (connection == null) {
        exec.log("error", "The state service could not connect to ubus");
        return 1;
    }

    if (connection.publish(OBJECT_NAME, object_methods()) == null) {
        exec.log("error", "The state service could not publish the ubus object " + OBJECT_NAME);
        return 1;
    }

    // procd reports sing-box starting or stopping, which is the one change that
    // matters most and the one no directory mtime reflects. It reports on every
    // other service of the router as well, and none of them is in the state.
    let subscriber = connection.subscriber(function(notification) {
        if (notification.data?.service == "sing-box")
            recompute();
    }, function(id) {});
    if (subscriber != null)
        subscriber.subscribe("service");

    recompute();
    last_sweep_ms = monotonic_ms();
    refresh_system_info();

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
    });

    uloop.run();
    return 0;
}

if ((sourcepath(1) != null && sourcepath(1) != "") || ARGV[0] == null)
    return {
        MAX_WAIT_MS,
        LOG_POLL_MS,
        paths,
        needs_close_refresh,
        settled_running,
        new_log_lines,
        // Seeding the buffer is what lets the delta logic be exercised without a
        // router and without a log to read.
        remember_log_line: function(line) { append_log_lines([ line ]); },
        object_methods,
        run
    };

let mode = ARGV[0] || "";

if (mode == "run")
    exit(run());

warn("Usage: service/state_service.uc run\n");
exit(1);
