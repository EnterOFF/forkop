// Every external command the backend runs goes through here, as an argv array
// quoted for /bin/sh.

let fs = require("fs");
let common = require("core.common");

function quote(value) {
    return "'" + replace(common.as_string(value), /'/g, "'\\''") + "'";
}

function command_line(argv) {
    return join(" ", map(argv, quote));
}

// Exit status, with stdout and stderr left to the caller's.
function run(argv) {
    return system(command_line(argv));
}

// Exit status, with all output discarded.
function status(argv) {
    return system(command_line(argv) + " >/dev/null 2>&1");
}

function ok(argv) {
    return status(argv) == 0;
}

// { status, stdout }, with stderr discarded.
function capture(argv) {
    let pipe = fs.popen(command_line(argv) + " 2>/dev/null", "r");
    if (!pipe)
        return { status: 1, stdout: "" };
    let stdout = pipe.read("all");
    return { status: pipe.close(), stdout: stdout ?? "" };
}

// { status, output } with stderr folded into stdout.
function combined(argv) {
    let pipe = fs.popen(command_line(argv) + " 2>&1", "r");
    if (!pipe)
        return { status: 1, output: "" };
    let output = pipe.read("all");
    return { status: pipe.close(), output: output ?? "" };
}

// stdout of a command that succeeded, null otherwise.
function output(argv) {
    let result = capture(argv);
    return result.status == 0 ? result.stdout : null;
}

// Writes text to the command's stdin and returns { status, stderr }.
function feed(argv, text) {
    let now = clock();
    let error_path = sprintf("/tmp/forkop-exec.%d.%d.err", now[0], now[1]);
    let pipe = fs.popen(command_line(argv) + " >/dev/null 2>" + quote(error_path), "w");
    if (!pipe)
        return { status: 1, stderr: "" };
    let written = pipe.write(common.as_string(text)) != null;
    let result = { status: pipe.close(), stderr: fs.readfile(error_path) ?? "" };
    fs.unlink(error_path);
    if (!written && result.status == 0)
        result.status = 1;
    return result;
}

// A detached child. procd holds the service lock on fd 1000 for as long as an
// init action runs, and a child that inherited it would hold it past its parent.
function background(argv) {
    return system(command_line(argv) + " >/dev/null 2>&1 1000>&- &") == 0;
}

function log(level, message) {
    status([ "logger", "-t", "forkop", "[" + common.as_string(level) + "] " + common.as_string(message) ]);
}

return { command_line, run, status, ok, capture, combined, output, feed, background, log };
