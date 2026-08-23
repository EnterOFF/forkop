#!/usr/bin/env ucode

let fs = require("fs");

// A string is returned as it came. Concatenating it with "" produces an equal
// but distinct string, and on the lists the nftables sets are built from that is
// one copy of every address in the list for no result.
function as_string(value) {
    if (type(value) == "string")
        return value;
    return value == null ? "" : "" + value;
}

// Which signal killed a command, or 0 for one that exited on its own. A shell
// that execs the command reports the signal itself and ucode hands it over
// negated; one that waits for it reports 128 plus the signal as its own exit
// code. Both spellings reach the same callers, and a command that was killed
// never got to say why.
function signal_from_status(status) {
    status = int(status || 0);
    if (status < 0)
        return 0 - status;
    if (status > 128 && status < 160)
        return status - 128;
    return 0;
}

function read_json_file(path) {
    let data = fs.readfile(path);
    if (data == null)
        return null;

    try {
        return json(data);
    }
    catch (e) {
        return null;
    }
}

function read_stdin() {
    let input = fs.open("/dev/stdin", "r");
    if (!input)
        return "";
    let data = input.read("all");
    input.close();
    return data == null ? "" : data;
}

function read_stdin_json() {
    let data = read_stdin();
    try {
        return json(data);
    }
    catch (e) {
        return null;
    }
}

function write_json(value) {
    print(sprintf("%J", value), "\n");
}

function write_compact_string_array(values) {
    print("[");
    for (let i = 0; i < length(values); i++) {
        if (i > 0)
            print(",");
        print(sprintf("%J", as_string(values[i])));
    }
    print("]\n");
}

function csv_to_json_array(value) {
    value = as_string(value);
    write_compact_string_array(value == "" ? [] : split(value, ","));
}

function write_json_file(path, value) {
    return fs.writefile(path, sprintf("%J\n", value));
}

function strip_internal_fields(value) {
    if (type(value) == "array") {
        for (let i = 0; i < length(value); i++)
            value[i] = strip_internal_fields(value[i]);
        return value;
    }

    if (type(value) == "object") {
        for (let key in keys(value)) {
            if (substr(key, 0, 2) == "__") {
                delete value[key];
                continue;
            }
            value[key] = strip_internal_fields(value[key]);
        }
    }

    return value;
}

// Go duration syntax, which is what sing-box accepts for every interval and
// timeout Forkop passes through: a sequence of amount+unit pairs such as
// "3m", "1h30m" or "1.5s". Returns whole seconds, or null when the text is not
// a duration at all.
function duration_to_seconds(value) {
    let rest = as_string(value);
    if (rest == "")
        return null;

    let total = 0.0;
    let multipliers = {
        ns: 0.000000001,
        us: 0.000001,
        ms: 0.001,
        s: 1,
        m: 60,
        h: 3600,
        d: 86400
    };

    while (rest != "") {
        let matched = match(rest, /^([0-9]+(\.[0-9]+)?)(ns|us|ms|s|m|h|d)/);
        if (!matched)
            return null;

        let token = as_string(matched[0]);
        total += (matched[1] * 1) * multipliers[matched[3]];
        rest = substr(rest, length(token));
    }

    return total <= 0 ? null : int(total + 0.5);
}

// A number written the way an nftables mark or a queue base is: "0x40000000"
// or a plain decimal. Anything else is not a number here.
function parse_number(value) {
    value = lc(trim(as_string(value)));
    if (value == "")
        return null;

    if (substr(value, 0, 2) != "0x")
        return match(value, /^[0-9]+$/) == null ? null : int(value);

    value = substr(value, 2);
    if (value == "")
        return null;

    let result = 0;
    for (let i = 0; i < length(value); i++) {
        let digit = index("0123456789abcdef", substr(value, i, 1));
        if (digit < 0)
            return null;
        result = result * 16 + digit;
    }

    return result;
}

function array_or_empty(value) {
    return type(value) == "array" ? value : [];
}

function object_or_empty(value) {
    return type(value) == "object" ? value : {};
}

function option(section, key, fallback) {
    if (fallback == null)
        fallback = "";
    let value = object_or_empty(section)[key];
    if (value == null)
        return fallback;
    if (type(value) == "array")
        return join(" ", value);
    return as_string(value);
}

function list_option(section, key) {
    let value = object_or_empty(section)[key];
    if (value == null)
        return [];
    if (type(value) == "array")
        return value;
    let text = trim(as_string(value));
    return text == "" ? [] : split(text, " ");
}

function bool_option(section, key, fallback) {
    if (fallback == null)
        fallback = false;
    let value = option(section, key, fallback ? "1" : "0");
    return value == "1" || value == "true" || value == "yes" || value == "on";
}

function int_option(section, key, fallback) {
    let value = option(section, key, "");
    if (match(value, /^[0-9]+$/) == null)
        value = as_string(fallback);
    return match(value, /^[0-9]+$/) == null ? 0 : int(value, 10);
}

return {
    as_string,
    signal_from_status,
    read_json_file,
    read_stdin,
    read_stdin_json,
    write_json,
    csv_to_json_array,
    write_json_file,
    strip_internal_fields,
    duration_to_seconds,
    parse_number,
    array_or_empty,
    object_or_empty,
    option,
    list_option,
    bool_option,
    int_option
};
