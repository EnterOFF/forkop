#!/usr/bin/env ucode

let fs = require("fs");
let netstat = require("core.netstat");
let nft_state = require("nft.state");

const SB_DNS_INBOUND_ADDRESS = getenv("SB_DNS_INBOUND_ADDRESS") || "127.0.0.42";
const SB_TPROXY_INBOUND_PORT = getenv("SB_TPROXY_INBOUND_PORT") || "1602";
const SB_TPROXY_INBOUND6_ADDRESS = getenv("SB_TPROXY_INBOUND6_ADDRESS") || "::1";

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

function sing_box_service_pid_runtime() {
    let data = command_output_from_args([ "ubus", "call", "service", "list", "{\"name\":\"sing-box\"}" ]);
    try {
        return sing_box_service_pid_from_value(json(data));
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

function process_start_ticks(stat) {
    stat = as_string(stat);
    let marker = index(stat, ") ");
    if (marker < 0)
        return null;

    let fields = split(trim(substr(stat, marker + 2)), /[ \t\r\n]+/);
    if (length(fields) < 20 || match(fields[19], /^[0-9]+$/) == null)
        return null;
    return int(fields[19]);
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

function sing_box_runtime_ports_ready() {
    return netstat.sing_box_standard_ports_listening(
        command_output_from_args([ "netstat", "-ln" ]),
        SB_DNS_INBOUND_ADDRESS,
        SB_TPROXY_INBOUND_PORT,
        SB_TPROXY_INBOUND6_ADDRESS
    );
}

// This runs on every reload, in every readiness poll and behind every UI status
// refresh, which is why nft/state.uc answers it with -t: a rule set holding 40k
// addresses turns a 36 ms check into 5 s when nft prints them all first.
function forkop_runtime_network_configured(rt_table, nft_table, mark) {
    return nft_state.table_present(nft_table) &&
        nft_state.tproxy_route_rule_present(rt_table, mark);
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
    service_status_text,
    sing_box_service_pid_from_value,
    sing_box_service_pid_runtime,
    pid_is_sing_box,
    process_start_ticks,
    process_age_seconds_from_ticks,
    process_age_seconds,
    sing_box_service_running,
    sing_box_service_stable,
    sing_box_runtime_ports_ready,
    forkop_runtime_network_configured,
    forkop_running,
    forkop_stably_running
};
