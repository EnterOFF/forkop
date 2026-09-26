// Takes the Forkop runtime down once procd gives up on sing-box. procd respawns
// a crashing core a few times and then leaves it dead, and the rules would keep
// steering traffic at a proxy that is gone.

let fs = require("fs");
let common = require("core.common");
let exec = require("core.exec");
let constants = require("core.constants");
let library = require("core.library");
let worker = require("service.worker");

let paths = {
    pid: "/var/run/forkop/sing-box-watch.pid",
    // The crash being cleaned up, kept until the cleanup has run, so a watcher that
    // died halfway finishes the job after procd respawns it.
    pending_cleanup: "/var/run/forkop/sing-box-watch.cleanup"
};

function spec() {
    return {
        name: "forkop-singbox-watch",
        instance: "watch",
        command: [ constants.FORKOP_BIN, "sing_box_watch" ],
        env: { FORKOP_LIB: library.dir() },
        pid_file: paths.pid
    };
}

function should_cleanup(event) {
    return event?.type == "instance.fail" && event?.data?.service == "sing-box";
}

// Separate crash loops differ by pid; the same notification delivered twice does not.
function cleanup_event_key(event) {
    let data = event?.data ?? {};
    return join("|", map([ data.service, data.instance, data.pid, data.exit_code, data.respawn_count ], common.as_string));
}

// A sing-box that procd stopped respawning while no watcher was listening.
function failed_exit_code(services) {
    for (let name, instance in services?.["sing-box"]?.instances ?? {})
        if (instance?.running === false && instance.respawn == null && instance.exit_code != null)
            return common.as_string(instance.exit_code);
    return null;
}

function cleanup(exit_code) {
    return common.write_file(paths.pending_cleanup, exit_code + "\n") &&
        exec.ok([ constants.FORKOP_BIN, "sing_box_crash_cleanup", exit_code ]);
}

// Exits non-zero when a cleanup failed, so procd respawns it to try again.
function monitor() {
    let uloop = require("uloop");
    let me = spec();
    uloop.init();
    let connection = require("ubus").connect();
    if (connection == null)
        return 1;

    let status = 0;
    let last_event = "";
    let subscriber = connection.subscriber(function(notification) {
        let event = { type: notification.type, data: notification.data };
        if (!should_cleanup(event) || cleanup_event_key(event) == last_event)
            return;
        last_event = cleanup_event_key(event);
        if (!cleanup(common.as_string(event.data.exit_code))) {
            status = 1;
            uloop.end();
        }
    }, function(id) {});
    if (subscriber == null || !subscriber.subscribe("service") || !worker.announce(me))
        return 1;

    let pending = fs.readfile(paths.pending_cleanup);
    let exit_code = pending != null ? trim(pending) : failed_exit_code(connection.call("service", "list", { name: "sing-box" }));
    if (exit_code != null && !cleanup(exit_code)) {
        worker.retire(me);
        return 1;
    }

    uloop.run();
    worker.retire(me);
    return status;
}

function start_worker() {
    return worker.start(spec());
}

function stop_worker() {
    if (!worker.stop(spec()))
        return false;
    fs.unlink(paths.pending_cleanup);
    return true;
}

return { paths, spec, should_cleanup, cleanup_event_key, failed_exit_code, monitor, start_worker, stop_worker };
