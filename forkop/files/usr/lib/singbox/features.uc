// What the installed sing-box was built with, from the Tags line of `sing-box version`. Every
// Forkop function that needs a build tag is listed here, and nothing else in Forkop names a tag.
// Read from the binary, never the package, and kept while the file stays the same.

let fs = require("fs");
let exec = require("core.exec");
let singbox_constants = require("singbox.constants");

let paths = {
    binary: "/usr/bin/sing-box"
};

// The dashboard, groups, latency tests and the nft subnet sync all need the Clash API.
const REQUIRED = "clash_api";

const FEATURES = {
    clash_api: { name: "the Clash API", tags: [ "with_clash_api" ] },
    wireguard: { name: "WireGuard, AmneziaWG and WARP", tags: [ "with_wireguard", "with_gvisor" ] },
    utls: { name: "uTLS and Reality", tags: [ "with_utls" ] },
    quic: { name: "QUIC", tags: [ "with_quic" ] },
    openvpn: { name: "OpenVPN", tags: [ "with_openvpn", "with_gvisor" ] },
    tailscale: { name: "Tailscale", tags: [ "with_tailscale", "with_gvisor" ] },
    naive: { name: "the NaiveProxy client", tags: [ "with_naive_outbound" ] },
    trusttunnel: { name: "TrustTunnel", tags: [ "with_trusttunnel" ] },
    openconnect: { name: "OpenConnect", tags: [ "with_openconnect", "with_gvisor" ] }
};

// The naive inbound is in every build; its client is not.
const OUTBOUND_TYPES = {
    hysteria: "quic", hysteria2: "quic", tuic: "quic",
    naive: "naive", trusttunnel: "trusttunnel"
};
const INBOUND_TYPES = {
    hysteria: "quic", hysteria2: "quic", tuic: "quic",
    trusttunnel: "trusttunnel"
};
const ENDPOINT_TYPES = {
    wireguard: "wireguard", amneziawg: "wireguard", warp: "wireguard",
    tailscale: "tailscale", "openvpn-client": "openvpn", "openvpn-server": "openvpn",
    openconnect: "openconnect"
};

let known = { signature: null, tags: null };

function signature(stat) {
    return sprintf("%d:%d:%d", stat.inode, stat.size, stat.mtime);
}

function parse_tags(text) {
    for (let line in split(text ?? "", "\n")) {
        let matched = match(trim(line), /^Tags:[ \t]*(.*)$/);
        if (matched)
            return filter(map(split(matched[1], ","), (tag) => trim(tag)), (tag) => tag != "");
    }
    return [];
}

// The tags of the installed core, or null when there is no core to ask.
function tags() {
    let stat = fs.stat(paths.binary);
    if (stat == null)
        return null;
    if (known.signature == signature(stat))
        return known.tags;

    let text = exec.output([ paths.binary, "version" ]);
    if (text == null || index(text, "sing-box version") < 0)
        return null;
    known = { signature: signature(stat), tags: parse_tags(text) };
    return known.tags;
}

// The tags a feature needs that the given set, or the installed core, lacks.
function missing_tags(feature, present) {
    let have = {};
    for (let tag in present ?? tags() ?? [])
        have[tag] = true;
    return filter(FEATURES[feature]?.tags ?? [], (tag) => !have[tag]);
}

function available(feature, present) {
    present ??= tags();
    return FEATURES[feature] != null && present != null && length(missing_tags(feature, present)) == 0;
}

// Why a feature cannot be used with the given tags, or "" when it can.
function unavailable_reason(feature, present) {
    present ??= tags();
    if (available(feature, present))
        return "";
    if (present == null)
        return "sing-box is not installed";
    return "this sing-box build lacks " + FEATURES[feature].name + " (built without " + join(", ", missing_tags(feature, present)) + ")";
}

function type_feature(kind, type_name) {
    let table = kind == "inbound" ? INBOUND_TYPES : kind == "endpoint" ? ENDPOINT_TYPES : OUTBOUND_TYPES;
    return table[lc(trim("" + (type_name ?? "")))] ?? "";
}

function link_query(link) {
    let start = index(link, "?");
    if (start < 0)
        return {};
    let text = substr(link, start + 1);
    let hash = index(text, "#");
    if (hash >= 0)
        text = substr(text, 0, hash);
    let result = {};
    for (let pair in split(text, "&")) {
        let equals = index(pair, "=");
        let key = lc(equals < 0 ? pair : substr(pair, 0, equals));
        if (key != "" && result[key] == null)
            result[key] = equals < 0 ? "" : substr(pair, equals + 1);
    }
    return result;
}

// A VMess link is either the base64 JSON v2rayN writes or a URL with a query.
function vmess_payload(link) {
    let body = substr(link, index(link, "://") + 3);
    let hash = index(body, "#");
    if (hash >= 0)
        body = substr(body, 0, hash);
    body = replace(replace(body, /-/g, "+"), /_/g, "/");
    while (length(body) % 4 != 0)
        body += "=";
    let decoded = b64dec(body);
    if (decoded == null)
        return null;
    try {
        let payload = json(decoded);
        return type(payload) == "object" ? payload : null;
    }
    catch (e) {
        return null;
    }
}

// Types the core always dials over TLS, so a fingerprint in their link counts
// without a security parameter.
const ALWAYS_TLS_TYPES = { trojan: true, tuic: true, hysteria: true, hysteria2: true, anytls: true };

// A fingerprint on a TLS link, or Reality, which always sends one; the rules are the core's
// link parser.
function link_uses_utls(scheme, type_name, link) {
    if (type_name == "vmess") {
        let payload = vmess_payload(link);
        if (payload != null) {
            let tls = lc("" + (payload.tls ?? ""));
            return (tls == "tls" || tls == "1" || tls == "true" || payload.net == "h2") && ("" + (payload.fp ?? "")) != "";
        }
    }
    let query = link_query(link);
    let security = lc(query.security ?? "");
    if (security == "reality" || (query.pbk ?? "") != "")
        return true;
    let tls = ALWAYS_TLS_TYPES[type_name] || security == "tls" || security == "xtls";
    return tls && ((query.fp ?? "") != "" || (query["client-fingerprint"] ?? "") != "");
}

// The features a share link needs from the core that will parse it.
function link_features(link) {
    link = trim("" + (link ?? ""));
    let separator = index(link, "://");
    let scheme = separator > 0 ? lc(substr(link, 0, separator)) : "";
    let type_name = singbox_constants.LINK_SCHEME_OUTBOUND_TYPES[scheme] ?? "";
    let result = [];
    let feature = type_feature("outbound", type_name);
    if (feature != "")
        push(result, feature);
    if (link_uses_utls(scheme, type_name, link))
        push(result, "utls");
    return result;
}

// Each feature with the tags that make it, and which types need which feature; unknown without
// a core to ask.
function report(present) {
    let current = present ?? tags();
    let features = {};
    for (let name, entry in FEATURES)
        features[name] = { available: current != null && length(missing_tags(name, current)) == 0, tags: entry.tags };
    return {
        known: current != null,
        tags: current ?? [],
        features,
        types: { outbound: OUTBOUND_TYPES, inbound: INBOUND_TYPES, endpoint: ENDPOINT_TYPES },
        // The type each share link scheme dials, so the page reads a link the way this does.
        links: singbox_constants.LINK_SCHEME_OUTBOUND_TYPES
    };
}

return {
    paths, REQUIRED, FEATURES, OUTBOUND_TYPES, INBOUND_TYPES, ENDPOINT_TYPES,
    parse_tags, tags, available, missing_tags, unavailable_reason, type_feature, link_features, report
};
