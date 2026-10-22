// URL parsing as Forkop 1.0.5 did it (core/url.uc of that release): the migrations read
// released values with it, so they keep the meaning 1.0.5 gave them whatever core.url becomes.

let common = require("core.common");

let as_string = common.as_string;

function hex_digit(value) {
    value = ord(lc(value));
    if (value >= 48 && value <= 57)
        return value - 48;
    if (value >= 97 && value <= 102)
        return value - 87;
    return -1;
}

// Form encoding: "+" is a space.
function decode(value) {
    value = as_string(value);
    let result = "";
    for (let i = 0; i < length(value); i++) {
        let c = substr(value, i, 1);
        if (c == "+") {
            result += " ";
            continue;
        }
        if (c == "%") {
            let high = i + 1 < length(value) ? hex_digit(substr(value, i + 1, 1)) : -1;
            let low = i + 2 < length(value) ? hex_digit(substr(value, i + 2, 1)) : -1;
            if (high >= 0 && low >= 0) {
                result += chr(high * 16 + low);
                i += 2;
                continue;
            }
        }
        result += c;
    }
    return result;
}

function before(value, markers) {
    value = as_string(value);
    let end = length(value);
    for (let marker in markers) {
        let found = index(value, marker);
        if (found >= 0 && found < end)
            end = found;
    }
    return substr(value, 0, end);
}

function after_scheme(value) {
    value = as_string(value);
    let marker = index(value, "://");
    return marker >= 0 ? substr(value, marker + 3) : value;
}

function scheme(value) {
    value = as_string(value);
    let marker = index(value, "://");
    return marker >= 0 ? lc(substr(value, 0, marker)) : "";
}

function fragment(value) {
    value = as_string(value);
    let marker = index(value, "#");
    return marker >= 0 ? decode(substr(value, marker + 1)) : "";
}

function authority(value) {
    value = after_scheme(value);
    let at = rindex(value, "@");
    return before(at >= 0 ? substr(value, at + 1) : value, [ "/", "?", "#" ]);
}

function host(value) {
    let found = authority(value);
    if (substr(found, 0, 1) == "[") {
        let end = index(found, "]");
        return end > 0 ? substr(found, 1, end - 1) : found;
    }
    let colon = index(found, ":");
    return colon >= 0 && rindex(found, ":") == colon ? substr(found, 0, colon) : found;
}

function port(value) {
    let found = authority(value);
    if (substr(found, 0, 1) == "[") {
        let end = index(found, "]");
        return end > 0 && substr(found, end + 1, 1) == ":" ? substr(found, end + 2) : "";
    }
    let colon = index(found, ":");
    return colon >= 0 && rindex(found, ":") == colon ? substr(found, colon + 1) : "";
}

function userinfo(value) {
    let found = before(after_scheme(before(value, [ "#" ])), [ "/", "?", "#" ]);
    let at = rindex(found, "@");
    return at >= 0 ? decode(substr(found, 0, at)) : "";
}

// The path after a scheme only when nothing before the marker looked like a path.
function path(value) {
    value = as_string(value);
    let marker = index(value, "://");
    if (marker >= 0 && index(substr(value, 0, marker), "/") < 0 && index(substr(value, 0, marker), "?") < 0)
        value = substr(value, marker + 3);
    let slash = index(value, "/");
    return slash >= 0 ? before(substr(value, slash), [ "?" ]) : "";
}

return { decode, before, scheme, fragment, host, port, userinfo, path };
