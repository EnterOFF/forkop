let fs = require("fs");
let netstat = require("core.netstat");
let nft_state = require("nft.state");
let runtime_constants = require("singbox.constants");

let paths = {
    proc: "/proc",
    tcp: "/proc/net/tcp",
    tcp6: "/proc/net/tcp6",
    udp6: "/proc/net/udp6"
};

function as_string(value) {
    return value == null ? "" : "" + value;
}

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function command_from_args(args) {
    let parts = [];
    for (let arg in args)
        push(parts, shell_quote(arg));
    return join(" ", parts);
}

function command_output_from_args(args) {
    let pipe = fs.popen(command_from_args(args), "r");
    if (!pipe)
        return "";

    let data = pipe.read("all");
    let status = pipe.close();
    return status == 0 && data != null ? as_string(data) : "";
}

function sing_box_service_pid_from_value(value) {
    let service = type(value) == "object" ? value["sing-box"] : null;
    let instances = service && type(service.instances) == "object" ? service.instances : {};
    for (let _, instance in instances)
        if (type(instance) == "object" && instance.running === true && int(instance.pid || 0) > 0)
            return int(instance.pid);
    return 0;
}

// The status feed asks procd for the same instance behind every poll. The ubus
// binding answers in-process, where shelling out to `ubus call` paid for a
// shell, a second binary and a JSON reparse to reach the same object. The
// connection is opened once and reused: within one short-lived status process
// that is a single round trip instead of one per question.
let ubus_connection = null;
let ubus_connection_tried = false;

function ubus_connect() {
    if (ubus_connection_tried)
        return ubus_connection;

    ubus_connection_tried = true;
    try {
        ubus_connection = require("ubus").connect();
    }
    catch (e) {
        ubus_connection = null;
    }
    return ubus_connection;
}

function sing_box_service_pid_from_cli() {
    let data = command_output_from_args([ "ubus", "call", "service", "list", "{\"name\":\"sing-box\"}" ]);
    try {
        return sing_box_service_pid_from_value(json(data));
    }
    catch (e) {
        return 0;
    }
}

function sing_box_service_pid_runtime() {
    let connection = ubus_connect();
    if (connection == null)
        return sing_box_service_pid_from_cli();

    try {
        return sing_box_service_pid_from_value(
            connection.call("service", "list", { name: "sing-box" })
        );
    }
    catch (e) {
        return 0;
    }
}

function path_basename(path) {
    path = as_string(path);
    let slash = rindex(path, "/");
    return slash >= 0 ? substr(path, slash + 1) : path;
}

function pid_is_sing_box(pid) {
    pid = as_string(pid);
    if (match(pid, /^[0-9]+$/) == null)
        return false;
    try {
        return path_basename(fs.readlink("/proc/" + pid + "/exe")) == "sing-box";
    }
    catch (e) {
        return false;
    }
}

// The fields of /proc/<pid>/stat after the command name, which may hold spaces
// and parentheses of its own: fields[0] is the state, fields[11] and [12] the
// user and system time, fields[19] the start time.
function stat_fields(stat) {
    stat = as_string(stat);
    let marker = rindex(stat, ") ");
    if (marker < 0)
        return null;

    let fields = split(trim(substr(stat, marker + 2)), /[ \t\r\n]+/);
    for (let i in [ 11, 12, 19 ])
        if (match(fields[i] ?? "", /^[0-9]+$/) == null)
            return null;
    return fields;
}

function process_start_ticks(stat) {
    let fields = stat_fields(stat);
    return fields == null ? null : int(fields[19]);
}

// When the process started, in ticks since boot, or null once it is gone.
function start_ticks(pid) {
    return process_start_ticks(fs.readfile("/proc/" + pid + "/stat"));
}

// What a process costs the router: the processor time it has used, in kernel
// ticks, and the memory only it holds - its anonymous pages. The resident total
// also counts the pages of its binary, a cache of the file the kernel drops
// under pressure, and for sing-box that is more than half of it.
function process_usage(pid) {
    let dir = paths.proc + "/" + pid;
    let fields = stat_fields(fs.readfile(dir + "/stat"));
    let anon = match(fs.readfile(dir + "/status") ?? "", /(^|\n)RssAnon:[ \t]*([0-9]+) kB/);
    if (fields == null || anon == null)
        return null;
    return { started: int(fields[19]), cpu_ticks: int(fields[11]) + int(fields[12]), memory_kb: int(anon[2]) };
}

function cpu_count() {
    let count = 0;
    for (let line in split(fs.readfile(paths.proc + "/stat") ?? "", "\n"))
        if (match(line, /^cpu[0-9]+ /))
            count++;
    return count || 1;
}

// The core's usage and the moment it was read, on the monotonic clock: a load
// worked out from two readings is timed by the router rather than by the
// network to the page, and the kernel stamps a process start on that same
// scale, in ticks since boot, so one reading also tells the core's age.
function sing_box_usage() {
    let pid = sing_box_service_pid_runtime();
    let usage = pid > 0 && pid_is_sing_box(pid) ? process_usage(pid) : null;
    if (usage == null)
        return { running: false };
    let now = clock(true);
    return { running: true, ...usage, cpus: cpu_count(), clock_ms: now[0] * 1000 + int(now[1] / 1000000) };
}

function process_age_seconds_from_ticks(start_ticks, current_ticks) {
    start_ticks = as_string(start_ticks);
    current_ticks = as_string(current_ticks);
    if (match(start_ticks, /^[0-9]+$/) == null || match(current_ticks, /^[0-9]+$/) == null)
        return null;

    start_ticks = int(start_ticks);
    current_ticks = int(current_ticks);
    return current_ticks < start_ticks ? null : int((current_ticks - start_ticks) / 100);
}

// How long a pid has been alive, in seconds. The clock is the awkward part: the
// start time in /proc/<pid>/stat counts ticks from boot, and lxcfs virtualizes
// /proc/uptime inside a container while leaving that field alone, so subtracting
// one from the other invented an age and declared a healthy sing-box unstable.
// A freshly spawned child answers instead - its own start time is now, on exactly
// the scale the target pid was measured on. The spawn is the mechanism and not
// overhead: service/lifecycle.uc requires this module and lives for the whole
// reload, so reading /proc/self/stat inline would time the reload, not the moment.
function process_age_seconds(pid, expected_start_ticks) {
    pid = as_string(pid);
    if (match(pid, /^[0-9]+$/) == null)
        return null;

    let start_ticks = process_start_ticks(fs.readfile("/proc/" + pid + "/stat"));
    if (start_ticks == null ||
        (expected_start_ticks != null && start_ticks != int(expected_start_ticks)))
        return null;

    let current_ticks = process_start_ticks(command_output_from_args([ "cat", "/proc/self/stat" ]));
    return process_age_seconds_from_ticks(start_ticks, current_ticks);
}

function sing_box_service_running() {
    let pid = sing_box_service_pid_runtime();
    return pid > 0 && pid_is_sing_box(pid);
}

function sing_box_service_stable(min_age) {
    min_age = int(min_age || 2);
    let pid = sing_box_service_pid_runtime();
    if (pid <= 0 || !pid_is_sing_box(pid))
        return false;

    let age = process_age_seconds(pid);
    return age != null && age >= min_age;
}

// Read straight from /proc instead of spawning netstat, which enumerates and
// formats every socket on the box to report three of them.
function sing_box_runtime_ports_ready() {
    let tcp6 = fs.readfile(paths.tcp6);
    let dns_address = [ runtime_constants.SOURCE_DNS_INBOUND_ADDRESS ];
    let dns_port = as_string(runtime_constants.SOURCE_DNS_INBOUND_PORT);
    return netstat.sing_box_standard_ports_listening_proc(
        fs.readfile(paths.tcp),
        tcp6,
        runtime_constants.DNS_INBOUND_ADDRESS,
        "" + runtime_constants.TPROXY_INBOUND_PORT,
        runtime_constants.TPROXY_INBOUND6_ADDRESS
    ) && netstat.proc_socket_listening(tcp6, dns_address, dns_port) &&
        netstat.proc_socket_listening(fs.readfile(paths.udp6), dns_address, dns_port, "07");
}

// This runs on every reload, in every readiness poll and behind every UI status
// refresh, so nft/state.uc collects the table index and both families of routes
// and rules in one shell rather than five, and asks nft for the table index
// instead of a named table: naming it made nft walk the whole rule set, which on
// a set holding 40k addresses is seconds of work to answer a yes or no.
function forkop_runtime_network_configured(rt_table, nft_table, mark) {
    return nft_state.runtime_network_configured(nft_table, rt_table, mark);
}

function forkop_running(rt_table, nft_table, mark) {
    return sing_box_service_running() && sing_box_runtime_ports_ready() &&
        forkop_runtime_network_configured(rt_table, nft_table, mark);
}

function forkop_stably_running(rt_table, nft_table, mark, min_age) {
    return sing_box_service_stable(min_age) && sing_box_runtime_ports_ready() &&
        forkop_runtime_network_configured(rt_table, nft_table, mark);
}

// The four words the UI shows for a service. Both the LuCI state feed and the
// diagnostics status command report them, so the wording lives in one place.
function service_status_text(running, enabled) {
    running = running === true || running == "true" || running == "1" || running == 1;
    enabled = enabled === true || enabled == "true" || enabled == "1" || enabled == 1;

    if (running)
        return enabled ? "running & enabled" : "running but disabled";
    return enabled ? "stopped but enabled" : "stopped & disabled";
}

return {
    paths,
    service_status_text,
    sing_box_service_pid_runtime,
    pid_is_sing_box,
    start_ticks,
    process_usage,
    sing_box_usage,
    process_age_seconds,
    process_age_seconds_from_ticks,
    sing_box_service_running,
    sing_box_service_stable,
    sing_box_runtime_ports_ready,
    forkop_runtime_network_configured,
    forkop_running,
    forkop_stably_running
};
