#!/usr/bin/env ucode

let fs = require("fs");
let common = require("core.common");

let as_string = common.as_string;

const SING_BOX_FORKOP_VERSION_FILE = getenv("SING_BOX_FORKOP_VERSION_FILE") || "/usr/share/sing-box-forkop/version";
const OPENWRT_RELEASE_FILE = getenv("OPENWRT_RELEASE_FILE") || "/etc/openwrt_release";

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

// X-Ver-OS is the version of the operating system - the panel's own example is
// iOS 18.3 - and for OpenWrt that is its release, not the Linux kernel that
// happens to sit under it. Sending 6.6.122 told a panel nothing it could use.
// An empty answer means the release is unknown, and the header is then left
// out: it is optional, and substituting a number that answers a different
// question would be a wrong value dressed up as a working one.
function os_version() {
    let data = fs.readfile(OPENWRT_RELEASE_FILE);
    if (data != null) {
        let prefix = "DISTRIB_RELEASE='";
        for (let line in split(as_string(data), "\n")) {
            if (substr(line, 0, length(prefix)) != prefix)
                continue;
            let rest = substr(line, length(prefix));
            let quote = rindex(rest, "'");
            let value = clean_header_value(quote >= 0 ? substr(rest, 0, quote) : rest);
            if (value != "")
                return value;
        }
    }
    return "";
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

// The sing-box release the core is built on, without the fork's own suffix.
// A subscription panel picks which sing-box template to serve from this
// number, and "1.13.18-extended-2.6.5-f70" is not a version it can parse.
// The file is shipped by the core package, so reading it costs nothing.
function upstream_sing_box_version() {
    let installed = trim(as_string(fs.readfile(SING_BOX_FORKOP_VERSION_FILE)));
    let base = split(split(installed, "-extended-")[0], "-forkop.")[0];
    return match(base, /^[0-9]+(\.[0-9]+)*$/) != null ? base : "";
}

// Naming the core first keeps the token panels match on at the start of the
// value, and the version after it is what tells them which template to send.
// Without an installed core there is nothing honest to claim a version of.
function default_user_agent() {
    let version = upstream_sing_box_version();
    return version != "" ? "sing-box/" + version : "sing-box";
}

// Exactly the set Happ defined and Remnawave standardised: X-HWID is the only
// one a panel requires, and the three device fields are what it shows the user
// when a key turns up on a second device. Nothing else belongs here - a header
// no panel reads is a fingerprint that cannot even be acted on.
function default_header_lines(hwid) {
    if (hwid == null)
        hwid = generated_hwid();
    else
        hwid = clean_header_value(hwid);

    let result = [
        header_line("User-Agent", default_user_agent()),
        header_line("X-Device-OS", "OpenWrt Linux"),
        header_line("X-Device-Model", device_model())
    ];
    let version = os_version();
    if (version != "")
        push(result, header_line("X-Ver-OS", version));
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
    default_user_agent,
    generated_hwid,
    default_header_lines,
    parse_header_line,
    parse_header_lines
};
