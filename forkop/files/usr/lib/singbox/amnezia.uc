// The AmneziaWG parameters as UCI holds them, on a tunnel or a server, one row
// each: how the value is written and whether a peer speaking plain WireGuard can
// ignore it. The page carries the same table (fe-app-forkop/src/helpers/wireguard.ts)
// and tests/fixtures/page_contract.json holds the two to each other.

let common = require("core.common");

const PARAMETERS = [
    { key: "jc", kind: "count", one_sided: true },
    { key: "jmin", kind: "count", one_sided: true },
    { key: "jmax", kind: "count", one_sided: true },
    { key: "s1", kind: "padding", one_sided: false },
    { key: "s2", kind: "padding", one_sided: false },
    { key: "s3", kind: "padding", one_sided: false },
    { key: "s4", kind: "padding", one_sided: false },
    { key: "h1", kind: "range", one_sided: false },
    { key: "h2", kind: "range", one_sided: false },
    { key: "h3", kind: "range", one_sided: false },
    { key: "h4", kind: "range", one_sided: false },
    { key: "i1", kind: "signature", one_sided: true },
    { key: "i2", kind: "signature", one_sided: true },
    { key: "i3", kind: "signature", one_sided: true },
    { key: "i4", kind: "signature", one_sided: true },
    { key: "i5", kind: "signature", one_sided: true },
    { key: "header_protection_key", kind: "key", one_sided: false },
    { key: "content_padding_addition", kind: "range", one_sided: true },
    { key: "rekey_after_time", kind: "range", one_sided: true },
    { key: "rekey_timeout", kind: "range", one_sided: true },
    { key: "reject_after_time", kind: "range", one_sided: true },
    { key: "keepalive_timeout", kind: "range", one_sided: true },
    { key: "max_handshake_attempts", kind: "range", one_sided: true },
    { key: "random_trailers", kind: "flag", one_sided: false },
    { key: "disable_cookies", kind: "flag", one_sided: true }
];

const KEYS = map(PARAMETERS, (entry) => entry.key);
// What an endpoint whose peer may be a plain WireGuard implementation accepts:
// the WARP endpoint, whose peer is Cloudflare, and a wireguard tunnel.
const ONE_SIDED_KEYS = map(filter(PARAMETERS, (entry) => entry.one_sided), (entry) => entry.key);

// Tags the core accepts inside a Custom Protocol Signature.
const SIGNATURE_TAGS = [ "b", "c", "t", "r", "rc", "rd", "d", "ds", "dz" ];

let kinds = {};
for (let entry in PARAMETERS)
    kinds[entry.key] = entry.kind;

function text(section, key) {
    return trim(common.as_string(common.option(section, "amnezia_" + key, "")));
}

function uint(value, maximum) {
    return match(value, /^[0-9]+$/) != null && int(value) <= maximum;
}

function valid_range(value) {
    let parts = split(value, "-");
    if (length(parts) > 2)
        return false;
    for (let part in parts)
        if (!uint(part, 4294967295))
            return false;
    return length(parts) == 1 || int(parts[0]) <= int(parts[1]);
}

function valid_key(value) {
    if (match(value, /^[A-Za-z0-9+\/]{43}=$/) == null)
        return false;
    let decoded = null;
    try {
        decoded = b64dec(value);
    }
    catch (e) {
        return false;
    }
    return decoded != null && length(decoded) == 32;
}

// A Custom Protocol Signature is a chain of <tag value> packets such as
// <b 0xdeadbeef><r 4>. The core refuses an unknown tag and sends nothing at all
// for a signature without any tag, so neither reaches it.
function valid_signature(value) {
    let rest = value;
    let tags = 0;
    while (true) {
        let start = index(rest, "<");
        if (start < 0)
            break;
        rest = substr(rest, start + 1);
        let end = index(rest, ">");
        if (end < 0)
            return false;
        let parts = split(trim(substr(rest, 0, end)), /[ \t]+/);
        if (index(SIGNATURE_TAGS, parts[0]) < 0)
            return false;
        tags++;
        rest = substr(rest, end + 1);
    }
    return tags > 0;
}

// What is wrong with one value, said after the name of what holds it, or "".
function value_problem(key, value) {
    let kind = kinds[key];
    if (kind == "count" && !uint(value, 4294967295))
        return "has an invalid AmneziaWG " + key + " value. Use whole numbers from 0 to 4294967295";
    if (kind == "padding" && !uint(value, 65535))
        return "has an invalid AmneziaWG " + key + " value. Use whole numbers from 0 to 65535";
    if (kind == "range" && !valid_range(value))
        return "has an invalid AmneziaWG " + key + " range. Use values from 0 to 4294967295 with the start no greater than the end";
    if (kind == "signature" && !valid_signature(value))
        return "has an invalid AmneziaWG " + key + " signature. Use Custom Protocol Signature tags such as <b 0xdeadbeef><r 4>";
    if (kind == "key" && !valid_key(value))
        return "has an invalid AmneziaWG " + key + ". Use a standard base64-encoded 32-byte value";
    if (kind == "flag" && value != "0" && value != "1")
        return "has an invalid AmneziaWG " + key + " flag. Use 0 or 1";
    return "";
}

function range_bounds(value) {
    let parts = split(value, "-");
    return [ int(parts[0]), int(parts[length(parts) - 1]) ];
}

// What the values have to hold together. The device refuses padding too short
// to carry the header protection nonce (the all-zero key turns protection off)
// and headers that overlap, a header it is not given being the WireGuard type
// number it keeps; sing-box's check passes both and the whole service fails to
// start. A junk minimum above the maximum is a size stock AmneziaWG cannot draw.
function set_problem(values) {
    let protection_key = values.header_protection_key ?? "";
    if (protection_key != "" && match(protection_key, /^A{43}=$/) == null)
        for (let key in [ "s1", "s2", "s3", "s4" ])
            if (int(values[key] ?? "0") < 12)
                return "requires AmneziaWG " + key + " of at least 12 bytes when header protection is enabled";

    let headers = [ "h1", "h2", "h3", "h4" ];
    if (length(filter(headers, (key) => values[key] != null)) > 0) {
        let bounds = map(headers, (key, i) => range_bounds(values[key] ?? ("" + (i + 1))));
        for (let i = 0; i < 4; i++)
            for (let j = i + 1; j < 4; j++)
                if (bounds[i][0] <= bounds[j][1] && bounds[j][0] <= bounds[i][1])
                    return "has AmneziaWG headers " + headers[i] + " and " + headers[j] + " that overlap. Give each header a range of its own";
    }

    if (int(values.jmin ?? "0") > int(values.jmax ?? "0"))
        return "has an AmneziaWG jmin greater than jmax";
    return "";
}

// Why the named parameters of a section cannot reach the core, said after the
// name of the section, or "".
function problem(section, names) {
    let values = {};
    for (let key in names) {
        let value = text(section, key);
        if (value == "")
            continue;
        let reason = value_problem(key, value);
        if (reason != "")
            return reason;
        values[key] = value;
    }
    return set_problem(values);
}

// The amnezia object sing-box reads for the named parameters of a section, or
// null when none is set.
function object(section, names) {
    let amnezia = {};
    for (let key in names) {
        let value = text(section, key);
        if (value == "")
            continue;
        let kind = kinds[key];
        if (kind == "flag")
            amnezia[key] = value == "1";
        else if (kind == "count" || kind == "padding" || (kind == "range" && index(value, "-") < 0))
            amnezia[key] = int(value, 10);
        else
            amnezia[key] = value;
    }
    return length(keys(amnezia)) > 0 ? amnezia : null;
}

return { PARAMETERS, KEYS, ONE_SIDED_KEYS, problem, object };
