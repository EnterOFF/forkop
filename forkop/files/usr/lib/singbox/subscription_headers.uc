#!/usr/bin/env ucode

let fs = require("fs");
let common = require("core.common");

let as_string = common.as_string;

function clean_header_value(value) {
    return trim(replace(as_string(value), /[\r\n]+/g, " "));
}

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function command_output(command) {
    let pipe = fs.popen(command, "r");
    if (!pipe)
        return "";

    let output = pipe.read("all");
    let status = pipe.close();
    return status == 0 && output != null ? as_string(output) : "";
}

function device_model() {
    let model = clean_header_value(fs.readfile("/tmp/sysinfo/model"));
    return model != "" ? model : "OpenWrt Router";
}

function generated_hwid() {
    let mac = clean_header_value(fs.readfile("/sys/class/net/eth0/address"));
    if (mac == "")
        mac = clean_header_value(fs.readfile("/sys/class/net/br-lan/address"));

    let input = mac + "-" + device_model();
    let output = split(trim(command_output("printf %s " + shell_quote(input) + " | md5sum")), /[ \t]+/)[0] || "";
    let hash = substr(output, 0, 16);
    return substr(hash, 0, 4) + "-" + substr(hash, 4, 4) + "-" + substr(hash, 8, 4) + "-" + substr(hash, 12, 4);
}

function header_line(name, value) {
    return as_string(name) + ": " + clean_header_value(value);
}

function default_header_lines(hwid) {
    if (hwid == null)
        hwid = generated_hwid();
    else
        hwid = clean_header_value(hwid);

    let result = [
        header_line("X-Device-OS", "OpenWrt Linux"),
        header_line("X-Device-Model", device_model()),
        header_line("X-Ver-OS", fs.readfile("/proc/sys/kernel/osrelease")),
        header_line("Accept-Language", "ru-RU,en,*"),
        header_line("X-Device-Locale", "EN")
    ];
    if (hwid != "")
        push(result, header_line("X-HWID", hwid));
    return result;
}

function parse_header_line(value) {
    value = as_string(value);
    let separator = index(value, ":");
    if (separator <= 0)
        return { valid: false, message: "expected 'Name: Value'" };

    let name = trim(substr(value, 0, separator));
    let header_value = trim(substr(value, separator + 1));
    if (match(name, /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/) == null)
        return { valid: false, message: "header name contains invalid characters" };
    if (match(header_value, /[\r\n]/) != null)
        return { valid: false, message: "header value contains a line break" };

    return { valid: true, name, value: header_value };
}

function parse_header_lines(lines) {
    if (type(lines) != "array")
        lines = lines == null || as_string(lines) == "" ? [] : [ lines ];

    let result = {};
    let names = {};
    for (let i = 0; i < length(lines); i++) {
        let parsed = parse_header_line(lines[i]);
        if (!parsed.valid)
            return { valid: false, message: "header " + (i + 1) + ": " + parsed.message, headers: {} };

        let normalized_name = lc(parsed.name);
        let name = names[normalized_name];
        if (name == null) {
            name = parsed.name;
            names[normalized_name] = name;
            result[name] = [];
        }
        push(result[name], parsed.value);
    }

    return { valid: true, message: "", headers: result };
}

return {
    generated_hwid,
    default_header_lines,
    parse_header_line,
    parse_header_lines
};
