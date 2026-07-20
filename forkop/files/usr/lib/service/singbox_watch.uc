#!/usr/bin/env ucode

let fs = require("fs");

const LIB_DIR = getenv("FORKOP_LIB") || "/usr/lib/forkop";
const BIN_PATH = getenv("FORKOP_BIN") || "/usr/bin/forkop";
const PID_FILE = getenv("FORKOP_SING_BOX_WATCH_PID_FILE") || "/var/run/forkop/sing-box-watch.pid";
const SCRIPT_PATH = getenv("FORKOP_SING_BOX_WATCH_UC") || LIB_DIR + "/service/singbox_watch.uc";
const UBUS_BIN = getenv("FORKOP_UBUS_BIN") || "ubus";
const PROCD_SERVICE_NAME = getenv("FORKOP_SING_BOX_WATCH_SERVICE_NAME") || "forkop-singbox-watch";
const PLANNED_STOP_FILE = getenv("FORKOP_SING_BOX_PLANNED_STOP_FILE") || "/var/run/forkop/sing-box-watch.planned-stop";

function as_string(value) {
    return value == null ? "" : "" + value;
}

function object_or_empty(value) {
    return type(value) == "object" ? value : {};
}

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function command_from_args(args) {
    let result = [];
    for (let arg in args)
        push(result, shell_quote(arg));
    return join(" ", result);
}

function command_success(args) {
    return system(command_from_args(args) + " >/dev/null 2>&1") == 0;
}

function command_capture(args) {
    let pipe = fs.popen(command_from_args(args), "r");
    if (!pipe)
        return { status: 1, output: "" };
    let output = pipe.read("all");
    return { status: pipe.close(), output: output == null ? "" : as_string(output) };
}

function parse_json(value) {
    try {
        return json(as_string(value));
    }
    catch (e) {
        return null;
    }
}

function owner_pid() {
    let stat = as_string(fs.readfile("/proc/self/stat"));
    let separator = index(stat, " ");
    return separator > 0 ? substr(stat, 0, separator) : "0";
}

function pid_running(pid) {
    pid = as_string(pid);
    return match(pid, /^[0-9]+$/) != null && command_success([ "kill", "-0", pid ]);
}

function path_basename(path) {
    path = as_string(path);
    let slash = rindex(path, "/");
    return slash >= 0 ? substr(path, slash + 1) : path;
}

function worker_cmdline_matches(cmdline) {
    cmdline = as_string(cmdline);
    let first_separator = index(cmdline, "\0");
    let executable = first_separator >= 0 ? substr(cmdline, 0, first_separator) : cmdline;
    return path_basename(executable) == "ucode" &&
        index(cmdline, "\0" + SCRIPT_PATH + "\0monitor\0") >= 0;
}

function pid_is_worker(pid) {
    pid = as_string(pid);
    return pid_running(pid) && worker_cmdline_matches(fs.readfile("/proc/" + pid + "/cmdline"));
}

function parent_dir(path) {
    let slash = rindex(as_string(path), "/");
    return slash <= 0 ? "/" : substr(as_string(path), 0, slash);
}

function should_cleanup(event) {
    event = object_or_empty(event);
    let data = object_or_empty(event.data);
    return as_string(event.type) == "instance.fail" && as_string(data.service) == "sing-box";
}

function cleanup_event_key(event) {
    let data = object_or_empty(object_or_empty(event).data);
    return join("|", [
        as_string(data.service),
        as_string(data.instance),
        as_string(data.pid),
        as_string(data.exit_code),
        as_string(data.respawn_count)
    ]);
}

function clear_pid_file(pid) {
    if (trim(as_string(fs.readfile(PID_FILE) || "")) == as_string(pid))
        fs.unlink(PID_FILE);
}

function procd_service_payload() {
    let instances = {};
    instances.watch = {
        command: [ "ucode", "-L", LIB_DIR, SCRIPT_PATH, "monitor" ],
        env: {
            FORKOP_LIB: LIB_DIR,
            FORKOP_BIN: BIN_PATH,
            FORKOP_SING_BOX_WATCH_PID_FILE: PID_FILE,
            FORKOP_SING_BOX_WATCH_UC: SCRIPT_PATH,
            FORKOP_SING_BOX_PLANNED_STOP_FILE: PLANNED_STOP_FILE
        },
        respawn: [ "3600", "5", "0" ],
        stderr: true
    };
    return { name: PROCD_SERVICE_NAME, instances };
}

function procd_add_worker() {
    return command_success([ UBUS_BIN, "call", "service", "add", sprintf("%J", procd_service_payload()) ]);
}

function procd_remove_worker() {
    if (command_success([ UBUS_BIN, "call", "service", "delete", sprintf("%J", { name: PROCD_SERVICE_NAME }) ]))
        return true;

    let result = command_capture([ UBUS_BIN, "call", "service", "list", sprintf("%J", { name: PROCD_SERVICE_NAME }) ]);
    let services = result.status == 0 ? parse_json(result.output) : null;
    return type(services) == "object" && services[PROCD_SERVICE_NAME] == null;
}

function wait_worker_ready(attempts) {
    attempts = int(attempts || 1);
    for (let i = 0; i < attempts; i++) {
        let pid = trim(as_string(fs.readfile(PID_FILE) || ""));
        if (pid_is_worker(pid))
            return true;
        if (i + 1 < attempts)
            command_success([ "sleep", "1" ]);
    }
    return false;
}

function monitor() {
    let ubus = require("ubus");
    let uloop = require("uloop");
    let pid = owner_pid();
    let last_event_key = "";

    command_success([ "mkdir", "-p", parent_dir(PID_FILE) ]);
    uloop.init();
    let connection = ubus.connect();
    if (connection == null) {
        clear_pid_file(pid);
        return 1;
    }

    let subscriber = connection.subscriber(function(notification) {
        let event = {
            type: as_string(notification.type),
            data: object_or_empty(notification.data)
        };
        if (!should_cleanup(event))
            return;

        let event_key = cleanup_event_key(event);
        if (event_key == last_event_key)
            return;
        last_event_key = event_key;

        let exit_code = as_string(object_or_empty(event.data).exit_code);
        system(
            command_from_args([ BIN_PATH, "sing_box_crash_cleanup", exit_code ]) +
            " >/dev/null 2>&1 1000>&- &"
        );
    }, function(id) {});
    if (subscriber == null || !subscriber.subscribe("service")) {
        clear_pid_file(pid);
        return 1;
    }
    if (!fs.writefile(PID_FILE, pid + "\n"))
        return 1;

    uloop.run();
    clear_pid_file(pid);
    return 0;
}

function stop_worker() {
    if (!procd_remove_worker())
        return 1;
    let pid = trim(as_string(fs.readfile(PID_FILE) || ""));
    if (pid_running(pid) && !pid_is_worker(pid)) {
        fs.unlink(PID_FILE);
        return 0;
    }
    for (let i = 0; i < 3 && pid_running(pid); i++)
        command_success([ "sleep", "1" ]);
    if (pid_is_worker(pid)) {
        command_success([ "kill", pid ]);
        command_success([ "sleep", "1" ]);
        if (pid_is_worker(pid))
            command_success([ "kill", "-KILL", pid ]);
    }
    fs.unlink(PID_FILE);
    return 0;
}

function start_worker() {
    if (stop_worker() != 0)
        return 1;
    command_success([ "mkdir", "-p", parent_dir(PID_FILE) ]);
    if (!procd_add_worker())
        return 1;
    if (!wait_worker_ready(5)) {
        stop_worker();
        return 1;
    }
    return 0;
}

if ((sourcepath(1) != null && sourcepath(1) != "") || ARGV[0] == null)
    return { should_cleanup, cleanup_event_key, worker_cmdline_matches, procd_service_payload };

let mode = ARGV[0] || "";
if (mode == "failure-event-fixture") {
    let event = null;
    try {
        event = json(as_string(fs.readfile(ARGV[1]) || ""));
    }
    catch (e) {
    }
    exit(should_cleanup(event) ? 0 : 1);
}
else if (mode == "start-worker")
    exit(start_worker());
else if (mode == "stop-worker")
    exit(stop_worker());
else if (mode == "monitor")
    exit(monitor());
else if (mode == "event-key-fixture") {
    let event = null;
    try {
        event = json(as_string(fs.readfile(ARGV[1]) || ""));
    }
    catch (e) {
    }
    print(cleanup_event_key(event), "\n");
}
else if (mode == "worker-cmdline-fixture")
    exit(worker_cmdline_matches(fs.readfile(ARGV[1])) ? 0 : 1);
else if (mode == "procd-service-payload-fixture")
    print(sprintf("%J", procd_service_payload()), "\n");
else {
    warn("Usage: service/singbox_watch.uc <start-worker|stop-worker|monitor|failure-event-fixture|event-key-fixture|worker-cmdline-fixture|procd-service-payload-fixture> ...\n");
    exit(1);
}
