#!/usr/bin/env ucode

// Cross-process coordination under /var/run: the mkdir directory locks that
// serialize lifecycle actions, and the marker file that carries a queued reload
// between them. The init script, the lifecycle owner and the UI all take the
// same locks and read the same marker, so one implementation answers for all
// three instead of three copies drifting apart.

let fs = require("fs");

const DEFAULT_OWNER_GRACE = 30;

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

function command_success(args) {
    return system(command_from_args(args) + " >/dev/null 2>&1") == 0;
}

function now_seconds() {
    return int(clock()[0]);
}

function positive_int(value, fallback) {
    value = as_string(value);
    return match(value, /^[0-9]+$/) == null ? fallback : int(value, 10);
}

function first_line(path) {
    let data = fs.readfile(as_string(path));
    if (data == null)
        return "";

    let newline = index(data, "\n");
    return newline >= 0 ? substr(data, 0, newline) : data;
}

function write_owner(lock_dir, owner_pid) {
    return fs.writefile(as_string(lock_dir) + "/pid", as_string(owner_pid) + "\n") != null;
}

function pid_alive(pid) {
    pid = as_string(pid);
    return match(pid, /^[0-9]+$/) != null && command_success([ "kill", "-0", pid ]);
}

function ensure_parent_dir(path) {
    let slash = rindex(as_string(path), "/");
    if (slash <= 0)
        return true;
    return command_success([ "mkdir", "-p", substr(as_string(path), 0, slash) ]);
}

// True while another process owns the lock. mkdir() and writing the owner pid
// are separate operations, so a freshly created lock gets time to receive its
// owner before an empty pid counts as stale; otherwise two simultaneous
// service actions can both proceed.
function held(lock_dir, owner_grace) {
    lock_dir = as_string(lock_dir);
    let lock_stat = lock_dir == "" ? null : fs.stat(lock_dir);
    if (lock_stat == null)
        return false;

    let owner = first_line(lock_dir + "/pid");
    if (pid_alive(owner))
        return true;
    if (owner != "")
        return false;

    let age = now_seconds() - int(lock_stat.mtime || 0);
    return age >= 0 && age < positive_int(owner_grace, DEFAULT_OWNER_GRACE);
}

function release(lock_dir, owner_pid) {
    lock_dir = as_string(lock_dir);
    owner_pid = as_string(owner_pid);
    if (lock_dir == "" || owner_pid == "")
        return;
    if (first_line(lock_dir + "/pid") != owner_pid)
        return;

    command_success([ "rm", "-f", lock_dir + "/pid" ]);
    command_success([ "rmdir", lock_dir ]);
}

function acquire(lock_dir, owner_pid, owner_grace) {
    lock_dir = as_string(lock_dir);
    owner_pid = as_string(owner_pid);
    if (lock_dir == "" || owner_pid == "")
        return false;
    if (!ensure_parent_dir(lock_dir))
        return false;

    if (!command_success([ "mkdir", lock_dir ])) {
        if (held(lock_dir, owner_grace))
            return false;

        command_success([ "rm", "-f", lock_dir + "/pid" ]);
        if (!command_success([ "rmdir", lock_dir ]) || !command_success([ "mkdir", lock_dir ]))
            return false;
    }

    if (write_owner(lock_dir, owner_pid))
        return true;

    release(lock_dir, owner_pid);
    return false;
}

function acquire_wait(lock_dir, owner_pid, timeout, owner_grace) {
    timeout = positive_int(timeout == null ? "300" : timeout, 300);
    let start = now_seconds();

    while (!acquire(lock_dir, owner_pid, owner_grace)) {
        if (now_seconds() - start >= timeout)
            return false;
        command_success([ "sleep", "2" ]);
    }

    return true;
}

// A request marker: the queued reload and the failed-start retry are the same
// "someone asked for this, act on it once" file with a different reason.
function mark_request(path, reason) {
    path = as_string(path);
    if (path == "" || !ensure_parent_dir(path))
        return false;

    return fs.writefile(path, "reason=" + as_string(reason) +
        "\nupdated_at=" + now_seconds() + "\n") != null;
}

function consume_request(path) {
    path = as_string(path);
    if (path == "" || fs.stat(path) == null)
        return false;

    fs.unlink(path);
    return true;
}

function run_pending_reload_if_requested(path, init_script, service_name) {
    if (!consume_request(path))
        return;

    command_success([ "logger", "-t", as_string(service_name || "forkop"),
        "[info] Applying pending Forkop reload" ]);
    system(shell_quote(as_string(init_script)) + " reload pending >/dev/null 2>&1 1000>&- &");
}

return {
    held,
    acquire,
    acquire_wait,
    release,
    mark_request,
    consume_request,
    run_pending_reload_if_requested
};
