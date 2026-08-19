#!/usr/bin/env ucode

// Process supervision shared by the DPI provider runtimes: how a worker's pid
// file is read, how it is killed and how the live children are counted. Both
// providers start ordinary child processes under Forkop's own pid directories,
// so a difference here would leak processes for one provider and not the other.

let fs = require("fs");

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
    pipe.close();
    return data == null ? "" : as_string(data);
}

function command_success_from_args(args) {
    return system(command_from_args(args) + " >/dev/null 2>&1") == 0;
}

function pid_running(pid) {
    pid = as_string(pid);
    return match(pid, /^[0-9]+$/) != null && command_success_from_args([ "kill", "-0", pid ]);
}

function file_first_line(path) {
    let data = fs.readfile(as_string(path));
    if (data == null)
        return "";
    let newline = index(data, "\n");
    return trim(newline >= 0 ? substr(data, 0, newline) : data);
}

// A plain kill asks the supervisor to stop; SIGKILL is only sent to a process
// that is still there, so a recycled pid is never signalled.
function kill_pidfile_process(path, signal) {
    let pid = file_first_line(path);
    if (pid == "")
        return;
    if (signal == "9") {
        if (pid_running(pid))
            command_success_from_args([ "kill", "-9", pid ]);
    }
    else {
        command_success_from_args([ "kill", pid ]);
    }
}

function pidfiles_in_dir(path) {
    if (fs.stat(path) == null)
        return [];

    let output = command_output_from_args([ "find", path, "-maxdepth", "1", "-type", "f", "-name", "*.pid" ]);
    let result = [];
    for (let line in split(output, "\n")) {
        line = trim(as_string(line));
        if (line != "")
            push(result, line);
    }
    return result;
}

// Counting is also the cleanup: a pid file whose process is gone is removed so
// the next count does not have to look at it again.
function live_pid_count(path) {
    let count = 0;
    for (let pidfile in pidfiles_in_dir(path)) {
        if (pid_running(file_first_line(pidfile)))
            count++;
        else
            fs.unlink(pidfile);
    }
    return count;
}

function value_contains(value, needle) {
    if (type(value) == "array") {
        for (let item in value)
            if (as_string(item) == needle)
                return true;
        return false;
    }
    return as_string(value) == needle;
}

function has_route_rule(config, inbound, outbound) {
    for (let rule in type(config) == "object" && type(config.route) == "object" &&
        type(config.route.rules) == "array" ? config.route.rules : []) {
        if (type(rule) == "object" &&
            rule.action == "route" &&
            value_contains(rule.inbound, inbound) &&
            value_contains(rule.outbound, outbound))
            return true;
    }
    return false;
}

return {
    pid_running,
    file_first_line,
    kill_pidfile_process,
    pidfiles_in_dir,
    live_pid_count,
    value_contains,
    has_route_rule
};
