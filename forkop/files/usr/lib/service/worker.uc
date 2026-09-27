// A long-lived Forkop process that procd supervises as a service of its own and
// respawns when it exits. The process records its pid once it is up, and that
// record is how it is found again - checked against the command line, so a pid
// the kernel handed to something else is never signalled.
//
// A worker is described by { name, command, pid_file, env, data }: the procd
// service name, the argv it runs, where it records itself, and what procd keeps
// beside the instance for whoever starts it next.

let fs = require("fs");
let common = require("core.common");
let exec = require("core.exec");

function recorded_pid(worker) {
    return trim(fs.readfile(worker.pid_file) ?? "");
}

function is_worker(worker, pid) {
    return common.pid_alive(pid) &&
        index(fs.readfile("/proc/" + pid + "/cmdline") ?? "", "\0" + join("\0", worker.command) + "\0") >= 0;
}

function payload(worker) {
    let instance = {
        command: worker.command,
        env: worker.env ?? {},
        respawn: [ "3600", "5", "0" ],
        stderr: true
    };
    if (worker.data != null)
        instance.data = worker.data;
    return { name: worker.name, instances: { [worker.instance ?? "worker"]: instance } };
}

function running(worker) {
    return is_worker(worker, recorded_pid(worker));
}

// Running, and started with the same data. procd keeps an instance's data but
// does not restart it when a later add brings other data, so the caller does.
function current(worker) {
    if (!running(worker))
        return false;
    let services = common.parse_json(exec.output([ "ubus", "call", "service", "list", sprintf("%J", { name: worker.name, verbose: true }) ]));
    let instance = services?.[worker.name]?.instances?.[worker.instance ?? "worker"];
    return type(instance) == "object" && sprintf("%J", instance.data) == sprintf("%J", worker.data);
}

function unregistered(worker) {
    if (exec.ok([ "ubus", "call", "service", "delete", sprintf("%J", { name: worker.name }) ]))
        return true;
    let services = common.parse_json(exec.output([ "ubus", "call", "service", "list", sprintf("%J", { name: worker.name }) ]));
    return type(services) == "object" && services[worker.name] == null;
}

// procd signals the process when the service goes; one that outlives that is
// terminated, and killed if it still does not go.
function stop(worker) {
    if (!unregistered(worker))
        return false;

    let pid = recorded_pid(worker);
    if (common.pid_alive(pid) && is_worker(worker, pid)) {
        for (let i = 0; i < 3 && is_worker(worker, pid); i++)
            sleep(1000);
        if (is_worker(worker, pid)) {
            exec.ok([ "kill", pid ]);
            sleep(1000);
            if (is_worker(worker, pid))
                exec.ok([ "kill", "-KILL", pid ]);
        }
    }
    fs.unlink(worker.pid_file);
    return true;
}

function start(worker) {
    if (!stop(worker) || !common.ensure_dir(common.parent_dir(worker.pid_file)))
        return false;
    if (!exec.ok([ "ubus", "call", "service", "add", sprintf("%J", payload(worker)) ]))
        return false;

    for (let i = 0; i < 5; i++) {
        if (is_worker(worker, recorded_pid(worker)))
            return true;
        sleep(1000);
    }
    stop(worker);
    return false;
}

// Called by the worker process itself once it is up, and on its way out.
function announce(worker) {
    return common.ensure_dir(common.parent_dir(worker.pid_file)) &&
        common.write_file(worker.pid_file, common.own_pid() + "\n");
}

function retire(worker) {
    if (recorded_pid(worker) == common.own_pid())
        fs.unlink(worker.pid_file);
}

return { start, stop, announce, retire, payload, is_worker, running, current };
