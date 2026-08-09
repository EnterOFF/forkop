#!/usr/bin/env ucode

let fs = require("fs");

function shell_quote(value) {
    return "'" + replace("" + value, /'/g, "'\\''") + "'";
}

function normalize_status(status) {
    status = int(status);
    return status > 255 ? int(status / 256) : status;
}

let mode = ARGV[0] || "";
let pattern = mode == "sing-box" ? "sing-box" : "forkop\\|sing-box";
let pipe = fs.popen(
    "logread -e " + shell_quote(pattern) + " 2>/dev/null",
    "r"
);

if (!pipe) {
    warn("Logs not found\n");
    exit(1);
}

let output = pipe.read("all") || "";
let status = normalize_status(pipe.close());
if (output == "") {
    warn(mode == "sing-box" ? "sing-box logs not found\n" : "Logs not found\n");
    exit(1);
}

print(output);
exit(status);
