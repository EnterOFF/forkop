// The Forkop runtime and the order it comes up and goes down in: sing-box, the
// nft table that steers traffic to it, the routing that table relies on, and the
// workers that keep both current. Every action holds the lifecycle lock, which
// the component manager takes as well.
//
// A reload changes only what would come out different: the nft script is
// compared with the one applied last, the sing-box configuration with the file
// the service reads, the cron jobs with the crontab.

let fs = require("fs");
let common = require("core.common");
let exec = require("core.exec");
let constants = require("core.constants");
let library = require("core.library");
let netstat = require("core.netstat");
let uci = require("core.uci");
let validator = require("config.validator");
let server = require("server.service");
let runtime = require("singbox.runtime");
let nft = require("nft.apply");
let nft_state = require("nft.state");
let rulesets = require("nft.ruleset_sync");
let health = require("service.health");
let lock = require("service.lock");
let watch = require("service.singbox_watch");

const CONFIG_NAME = "forkop";
const RT_TABLE = constants.RT_TABLE_NAME;
const NFT_TABLE = constants.NFT_TABLE_NAME;
const FAKEIP_MARK = constants.NFT_FAKEIP_MARK;
const CRON_MARKER = "# forkop-component-update-check";
const LOCK_TIMEOUT = 360;
// A start watches a fresh sing-box long enough to see an early crash; a reload
// only has to outlast the gap between the HUP and the ports dropping, measured at
// 0.2 s. The hold is how many consecutive one-second looks must see readiness.
const START_READY_WINDOW = 8;
const RELOAD_READY_WINDOW = 2;
const READY_HOLD = 2;
const MAX_READY_WAIT = 300;
const STOP_TIMEOUT = 15;

let paths = {
    config: "/etc/config/forkop",
    sing_box_init: "/etc/init.d/sing-box",
    lock: "/var/run/forkop/start.lock",
    pending_reload: "/var/run/forkop/reload.pending",
    // Written before Forkop stops sing-box itself, so the crash watcher does not
    // mistake the stop for a crash.
    planned_stop: "/var/run/forkop/sing-box-watch.planned-stop",
    // The nft script the live table was built from.
    applied_nft: "/var/run/forkop/runtime.nft",
    rc_dir: "/etc/rc.d"
};

// The reason an action failed is what its caller needs, and procd drops the
// output of what it runs itself, so an error goes to stderr as well as the log.
function log(level, message) {
    exec.log(level, message);
    if (level == "error")
        warn(message, "\n");
}

function config_fingerprint() {
    return fs.readfile(paths.config) ?? "";
}

function queue_reload_if_changed(fingerprint, context) {
    if (fingerprint == "" || config_fingerprint() == "" || config_fingerprint() == fingerprint)
        return;
    if (lock.mark_request(paths.pending_reload, context == "reload" ? "config_changed_during_reload" : "config_changed_during_start"))
        log("info", "Configuration changed during " + (context == "reload" ? "current reload" : "startup") +
            "; queued reload after " + (context == "reload" ? "current reload" : "startup") + " completes");
    else
        log("warn", "Configuration changed during " + (context == "reload" ? "current reload" : "startup") + ", but pending reload could not be queued");
}

// The installed system, the defaults a server needs, and the configuration
// itself. The server ports open only once the configuration is known good.
function validate() {
    try {
        validator.check_requirements();
    }
    catch (e) {
        return false;
    }
    try {
        server.prepare();
    }
    catch (e) {
        log("error", e.message);
        return false;
    }
    try {
        validator.validate();
    }
    catch (e) {
        log("error", e.message);
        return false;
    }
    server.remove_orphans();
    server.sync_firewall(false);
    return true;
}

// The one readiness wait behind every action, dated from the moment it is
// called: a live reload leaves the process in place, so no look taken before its
// rebind can hold to the end of the window. The process is pinned by its start
// ticks from the first look that finds it - procd answers a start before it has
// forked anything - and one that exits or is replaced mid-wait fails at once,
// because whatever procd respawns is not the runtime the caller built.
function wait_ready(window, hold, with_network) {
    let pid = 0;
    let ticks = null;
    let waited = 0;
    let held = 0;
    while (true) {
        if (pid <= 0) {
            let found = health.sing_box_service_pid_runtime();
            if (found > 0 && health.pid_is_sing_box(found)) {
                ticks = health.start_ticks(found);
                if (ticks != null)
                    pid = found;
            }
            if (pid <= 0 && waited >= window)
                return false;
        }
        else if (health.start_ticks(pid) != ticks)
            return false;

        if (pid > 0 && health.sing_box_runtime_ports_ready() &&
            (!with_network || health.forkop_runtime_network_configured(RT_TABLE, NFT_TABLE, FAKEIP_MARK)))
            held++;
        else
            held = 0;

        // Looks are a second apart, so `held` of them span `held - 1` seconds.
        if (waited >= window && held > hold)
            return true;
        if (waited >= MAX_READY_WAIT)
            return false;
        sleep(1000);
        waited++;
    }
}

function wait_stopped() {
    for (let i = 0; i < STOP_TIMEOUT; i++) {
        if (!runtime.process_running() && !health.sing_box_service_running())
            return true;
        sleep(1000);
    }
    return !runtime.process_running() && !health.sing_box_service_running();
}

// A router without an RTC starts in the past, and TLS certificates are not
// valid there yet.
function sync_time_if_needed() {
    if (localtime().year >= 2024)
        return;
    exec.ok([ "/usr/sbin/ntpd", "-q", "-p", "194.190.168.1", "-p", "216.239.35.0", "-p", "216.239.35.4",
        "-p", "162.159.200.1", "-p", "162.159.200.123" ]);
}

function clash_controller_free() {
    let settings = uci.get_all(CONFIG_NAME, "settings") ?? {};
    let config = common.read_json_file(common.option(settings, "config_path", ""));
    let controller = common.as_string(config?.experimental?.clash_api?.external_controller);
    if (controller == "" || !netstat.tcp_endpoint_in_use(exec.output([ "netstat", "-lnt" ]) ?? "", controller))
        return true;
    log("fatal", "Clash API address " + controller + " is already in use by another process. Aborted.");
    return false;
}

function cron_program(args) {
    return library.program("components/updates.uc", args);
}

function cron_current() {
    let plan = exec.capture(cron_program([ "cron-refresh-plan", constants.FORKOP_BIN, CRON_MARKER ]));
    if (plan.status != 0)
        return false;
    let wanted = map(filter(split(plan.stdout, "\n"), (line) => substr(line, 0, 10) == "component\t"), (line) => substr(line, 10));
    let installed = filter(split(exec.output([ "crontab", "-l" ]) ?? "", "\n"), (line) => index(line, CRON_MARKER) >= 0);
    return join("\n", wanted) == join("\n", installed);
}

function refresh_cron() {
    return exec.run(cron_program([ "refresh-cron-from-uci", constants.FORKOP_BIN, CRON_MARKER ])) == 0;
}

function remove_cron_jobs() {
    exec.run(cron_program([ "remove-cron-jobs", CRON_MARKER ]));
}

function apply_nft(built) {
    nft.apply(built);
    if (!common.write_file_atomic(paths.applied_nft, built.script))
        log("warn", "Failed to record the applied nftables rules; the next reload rebuilds them");
}

// The table goes, and with it every capture; the routing it relied on lives
// outside nft and is removed with the binary that added it.
function cleanup_network() {
    let ok = true;
    let ip = nft_state.IP_BIN;
    let mark = FAKEIP_MARK + "/" + FAKEIP_MARK;
    let steps = [
        [ () => nft_state.table_present(NFT_TABLE), [ "nft", "delete", "table", "inet", NFT_TABLE ], "Failed to remove the Forkop nftables table" ],
        [ () => nft_state.tproxy_marking_rule4_present(RT_TABLE, FAKEIP_MARK), [ ip, "-4", "rule", "del", "fwmark", mark, "table", RT_TABLE, "priority", "105" ],
            "Failed to remove the Forkop IPv4 routing rule" ],
        [ () => nft_state.tproxy_marking_rule6_present(RT_TABLE, FAKEIP_MARK), [ ip, "-6", "rule", "del", "fwmark", mark, "table", RT_TABLE, "priority", "105" ],
            "Failed to remove the Forkop IPv6 routing rule" ],
        [ () => nft_state.tproxy_route4_present(RT_TABLE), [ ip, "route", "flush", "table", RT_TABLE ], "Failed to flush the Forkop IPv4 routing table" ],
        [ () => nft_state.tproxy_route6_present(RT_TABLE), [ ip, "-6", "route", "flush", "table", RT_TABLE ], "Failed to flush the Forkop IPv6 routing table" ]
    ];
    for (let step in steps)
        if (step[0]() && (!exec.ok(step[1]) || step[0]())) {
            log("error", step[2]);
            ok = false;
        }
    fs.unlink(paths.applied_nft);
    return ok;
}

function stop_runtime(keep_watcher) {
    let ok = true;
    log("info", "Stopping Forkop");
    if (!keep_watcher)
        watch.stop_worker();
    rulesets.stop_worker();
    remove_cron_jobs();
    if (!cleanup_network())
        ok = false;
    if (((fs.stat(paths.sing_box_init)?.mode ?? 0) & 0111) != 0 && exec.run([ paths.sing_box_init, "stop" ]) != 0) {
        log("error", "Failed to stop sing-box");
        ok = false;
    }
    if (!wait_stopped()) {
        log("error", "sing-box is still running after it was stopped");
        ok = false;
    }
    return ok;
}

// Whatever a failed start or reload left running goes, including the server
// ports it opened.
function cleanup_failed_runtime(keep_watcher) {
    server.sync_firewall(true);
    log("info", "Cleaning up Forkop runtime after failed start/reload");
    let ok = stop_runtime(keep_watcher);
    if (!ok)
        log("warn", "Failed to fully clean up Forkop runtime after start/reload failure");
    return ok;
}

let start_fingerprint = "";

function start_runtime() {
    if (runtime.process_running()) {
        log("error", "sing-box is still running; refusing to start a second process");
        return false;
    }

    log("info", "Starting Forkop");
    if (!validate())
        return false;
    start_fingerprint = config_fingerprint();
    if (!nft.ensure_bridge_netfilter_disabled()) {
        log("error", "Failed to disable br_netfilter for transparent proxy routing. Aborted.");
        return false;
    }
    sync_time_if_needed();

    try {
        runtime.configure_service();
        runtime.write_config(true);
    }
    catch (e) {
        log("fatal", e.message);
        return false;
    }
    if (!clash_controller_free())
        return false;
    if (!refresh_cron()) {
        log("error", "Failed to refresh the Forkop cron jobs. Aborted.");
        return false;
    }

    if (!exec.ok([ paths.sing_box_init, "start" ])) {
        log("fatal", "Failed to start sing-box. Aborted.");
        return false;
    }
    if (!wait_ready(START_READY_WINDOW, READY_HOLD, false)) {
        log("fatal", "sing-box did not reach a stable running state after start. Aborted.");
        return false;
    }

    // Only once sing-box answers does the table start sending it traffic.
    try {
        apply_nft(nft.build());
    }
    catch (e) {
        log("fatal", e.message);
        return false;
    }
    if (!wait_ready(0, 0, true)) {
        log("fatal", "Forkop runtime was not ready after nftables activation. Aborted.");
        return false;
    }
    if (!watch.start_worker()) {
        log("error", "Failed to start the sing-box crash watcher. Aborted.");
        return false;
    }
    if (!rulesets.start_worker()) {
        log("error", "Failed to start the rule set sync worker. Aborted.");
        return false;
    }

    fs.unlink(paths.planned_stop);
    if (fs.stat(paths.planned_stop) != null) {
        log("error", "Failed to arm the sing-box crash watcher after start");
        return false;
    }
    return true;
}

function locked(action) {
    let owner = common.own_pid();
    if (!lock.acquire_wait(paths.lock, owner, LOCK_TIMEOUT)) {
        log("error", "Timed out waiting for another Forkop lifecycle action");
        return 1;
    }
    let status = action();
    lock.release(paths.lock, owner);
    return status;
}

function forkop_running() {
    return health.forkop_running(RT_TABLE, NFT_TABLE, FAKEIP_MARK);
}

function start() {
    if (forkop_running()) {
        log("info", "Forkop is already running; duplicate start skipped");
        return 0;
    }
    return locked(function() {
        if (forkop_running()) {
            log("info", "Forkop became ready while another start was running; duplicate start skipped");
            return 0;
        }
        if (health.sing_box_service_running() && (!cleanup_failed_runtime() || health.sing_box_service_running())) {
            log("error", "A previous sing-box process could not be stopped safely; refusing a second start");
            return 1;
        }
        if (!start_runtime()) {
            cleanup_failed_runtime();
            return 1;
        }
        queue_reload_if_changed(start_fingerprint, "start");
        return 0;
    });
}

function stop() {
    return locked(function() {
        // The server ports close with the runtime. A reload keeps them: closing
        // them in between would cost a second firewall reload.
        server.sync_firewall(true);
        if (!common.write_file_atomic(paths.planned_stop, common.own_pid() + "\n"))
            log("warn", "Failed to mark the planned sing-box stop");
        watch.stop_worker();
        return stop_runtime(true) ? 0 : 1;
    });
}

// Called by the crash watcher once procd gave up on sing-box.
function crash_cleanup(exit_code) {
    return locked(function() {
        if (fs.stat(paths.planned_stop) != null || forkop_running())
            return 0;
        let suffix = match(common.as_string(exit_code), /^[0-9]+$/) ? " (exit code " + exit_code + ")" : "";
        log("fatal", "sing-box stopped after repeated crashes" + suffix);
        return cleanup_failed_runtime(true) && watch.stop_worker() ? 0 : 1;
    });
}

// Every way out of a reload says which step gave up, once, because the page
// reports a failed apply out of the log and raises every error line in it.
function abort_reload(reason, runtime_touched) {
    log("error", reason + ". Aborted.");
    if (runtime_touched)
        cleanup_failed_runtime();
    return 1;
}

function restart_runtime() {
    log("info", "Reload requires a full Forkop runtime restart");
    if (!stop_runtime()) {
        log("error", "Failed to stop the Forkop runtime before restarting it. Aborted.");
        return 1;
    }
    if (!start_runtime()) {
        cleanup_failed_runtime();
        return 1;
    }
    return 0;
}

function capture(active) {
    return exec.ok(active ? [ "nft", "add", "table", "inet", NFT_TABLE ] : [ "nft", "add", "table", "inet", NFT_TABLE, "{ flags dormant; }" ]);
}

// procd brings a crashed sing-box back a few seconds later. Until the new one
// listens the capture pauses, as it does while a reload rebinds, so clients and
// the router resolve and connect directly instead of at closed ports. An action
// holding the lifecycle lock owns the runtime, so neither step waits for one.
function crash_pause() {
    let owner = common.own_pid();
    if (!lock.acquire(paths.lock, owner))
        return 0;
    if (fs.stat(paths.planned_stop) == null && nft_state.table_present(NFT_TABLE) && !health.sing_box_service_running()) {
        if (capture(false))
            log("warn", "sing-box exited; traffic goes direct until procd restarts it");
        else
            log("error", "Failed to pause the nftables traffic capture after sing-box exited");
    }
    lock.release(paths.lock, owner);
    return 0;
}

function crash_resume() {
    if (!wait_ready(0, 1, false))
        return 0;
    let owner = common.own_pid();
    if (!lock.acquire(paths.lock, owner))
        return 0;
    if (fs.stat(paths.planned_stop) == null && nft_state.table_present(NFT_TABLE) && !forkop_running()) {
        if (capture(true))
            log("info", "sing-box is back; traffic capture resumed");
        else
            log("error", "Failed to resume the nftables traffic capture after sing-box came back");
    }
    lock.release(paths.lock, owner);
    return 0;
}

// A config change and a queued reload apply what changed; any other reason - a
// reload asked for by hand, a WAN coming back - also reloads sing-box. Both the
// table and the sing-box configuration are built before either is applied, so a
// configuration refused on the way leaves the running one as it was.
function reload_runtime(reason) {
    let forced = reason != "on_config_change" && reason != "pending";
    log("info", "Applying configuration");
    if (!validate())
        return 1;
    // After validation, which writes the defaults a new server needs: a
    // fingerprint taken before it would read this reload's own writing as
    // somebody else's change.
    let fingerprint = config_fingerprint();

    if (!forkop_running()) {
        log("info", "Runtime state is incomplete; restarting Forkop runtime");
        let status = restart_runtime();
        if (status == 0)
            queue_reload_if_changed(fingerprint, "reload");
        return status;
    }

    let built;
    try {
        built = nft.build();
    }
    catch (e) {
        return abort_reload("Failed to build the nftables rules: " + e.message, false);
    }

    // The running core reads the file only when it is reloaded below.
    let config_changed;
    try {
        runtime.configure_service();
        config_changed = runtime.write_config(false);
    }
    catch (e) {
        log("error", e.message);
        return 1;
    }

    let nft_changed = fs.readfile(paths.applied_nft) != built.script;
    if (nft_changed) {
        rulesets.stop_worker();
        log("info", "Rebuilding nftables rules");
        try {
            apply_nft(built);
        }
        catch (e) {
            log("fatal", e.message);
            cleanup_failed_runtime();
            return 1;
        }
    }

    // The capture pauses while sing-box rebinds, so traffic goes direct instead
    // of at ports that are closed.
    if (config_changed || forced) {
        if (!capture(false))
            return abort_reload("Failed to pause the nftables traffic capture before reloading sing-box", true);
        log("info", "Reloading sing-box runtime");
        if (!exec.ok([ paths.sing_box_init, "reload" ]))
            return abort_reload("Failed to reload sing-box", true);
        if (!wait_ready(RELOAD_READY_WINDOW, READY_HOLD, false)) {
            log("fatal", "Reload verification failed after sing-box was reloaded; stopping Forkop runtime");
            cleanup_failed_runtime();
            return 1;
        }
        if (!capture(true))
            return abort_reload("Failed to resume the nftables traffic capture after reloading sing-box", true);
        if (!wait_ready(0, 0, true))
            return abort_reload("Forkop runtime was not ready after nftables activation", true);
    }

    // A rebuilt table starts with empty sets, so the worker starts again and
    // fills them. Otherwise a running worker keeps what it wrote and follows the
    // core across its reload on its own; only a change to the providers a
    // section reads starts it again.
    let worker_changed = nft_changed || !rulesets.worker_current();
    if (worker_changed && !rulesets.start_worker())
        return abort_reload("Failed to start the rule set sync worker", true);

    let cron_changed = !cron_current();
    if (cron_changed && !refresh_cron())
        return abort_reload("Failed to refresh the Forkop cron jobs", false);

    if (nft_changed || config_changed || forced || worker_changed || cron_changed)
        log("info", "Configuration applied");
    else
        log("info", "Configuration already applied; nothing to change");
    queue_reload_if_changed(fingerprint, "reload");
    return 0;
}

function reload(reason) {
    return locked(() => reload_runtime(reason ?? ""));
}

// Autostart is the rc.d link and has nothing to do with the runtime. The init
// script's own enable waits on procd's per-service lock for as long as any other
// command on the service runs - measured at 41 s during a restart.
const AUTOSTART_PRIORITY = constants.FORKOP_START_PRIORITY;

function enable() {
    let link = paths.rc_dir + "/S" + AUTOSTART_PRIORITY + "forkop";
    common.ensure_dir(paths.rc_dir);
    fs.unlink(link);
    return fs.symlink("../init.d/forkop", link) ? 0 : 1;
}

function disable() {
    fs.unlink(paths.rc_dir + "/K" + AUTOSTART_PRIORITY + "forkop");
    fs.unlink(paths.rc_dir + "/S" + AUTOSTART_PRIORITY + "forkop");
    return fs.stat(paths.rc_dir + "/S" + AUTOSTART_PRIORITY + "forkop") == null ? 0 : 1;
}

function remove_package(name) {
    if (exec.ok([ "sh", "-c", "command -v apk" ])) {
        if (exec.ok([ "apk", "info", "-e", name ]))
            exec.ok([ "apk", "del", name ]);
    }
    else if (require("core.packages").opkg_installed(name))
        exec.ok([ "opkg", "remove", "--force-depends", name ]);
}

// What a manual install put on the router, removed the way a package removal
// would.
function uninstall() {
    let init = constants.FORKOP_SERVICE_INIT;
    let domain = constants.FORKOP_LUCI_I18N_DOMAIN;
    log("info", "Uninstalling Forkop");
    if (fs.stat(init) != null) {
        exec.ok([ init, "stop" ]);
        exec.ok([ init, "disable" ]);
    }
    remove_package("luci-i18n-forkop-ru");
    remove_package("luci-app-forkop");

    common.remove_tree("/usr/lib/forkop");
    common.remove_tree(constants.FORKOP_LUCI_VIEW_DIR);
    for (let path in [ init, constants.FORKOP_BIN, "/usr/share/luci/menu.d/luci-app-forkop.json",
        "/usr/share/rpcd/acl.d/luci-app-forkop.json", "/etc/uci-defaults/50_luci-forkop",
        "/usr/lib/lua/luci/i18n/" + domain + ".ru.lua", "/usr/lib/lua/luci/i18n/" + domain + ".en.lua",
        ...fs.glob("/usr/lib/lua/luci/i18n/" + domain + ".*.lmo"), ...fs.glob("/var/luci-indexcache*"), ...fs.glob("/tmp/luci-indexcache*") ])
        fs.unlink(path);
    if (fs.stat("/etc/init.d/rpcd") != null)
        exec.ok([ "/etc/init.d/rpcd", "reload" ]);

    print("{\"removed\":true}\n");
    return 0;
}

return { paths, start, stop, reload, crash_cleanup, crash_pause, crash_resume, enable, disable, uninstall, wait_ready };
