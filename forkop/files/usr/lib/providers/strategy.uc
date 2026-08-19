#!/usr/bin/env ucode

// The contract every DPI provider validator shares with the LuCI strategy
// editor: how a strategy string is normalized before it is compared or stored,
// and the shape of the verdict the editor renders.

function as_string(value) {
    return value == null ? "" : "" + value;
}

function normalize_whitespace(value) {
    value = replace(as_string(value), /[\t\r\n]/g, " ");
    value = replace(value, / +/g, " ");
    value = replace(value, /^ /, "");
    return replace(value, / $/, "");
}

function or_default(value, default_value) {
    value = as_string(value);
    if (value == "")
        value = as_string(default_value);
    return normalize_whitespace(value);
}

function print_or_default(value, default_value) {
    print(or_default(value, default_value), "\n");
}

function failure(message, needles) {
    needles = type(needles) == "array" ? needles : [];
    return {
        valid: false,
        message: as_string(message),
        needle: length(needles) > 0 ? as_string(needles[0]) : "",
        needles
    };
}

function success() {
    return {
        valid: true,
        message: "",
        needle: "",
        needles: []
    };
}

function write_json(value) {
    print(sprintf("%J", value), "\n");
}

return {
    normalize_whitespace,
    or_default,
    print_or_default,
    failure,
    success,
    write_json
};
