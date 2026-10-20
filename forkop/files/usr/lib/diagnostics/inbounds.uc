let core_ip = require("core.ip");
let servers = require("singbox.servers");

function as_string(value) {
    return value == null ? "" : "" + value;
}

function words(value) {
    value = trim(as_string(value));
    return value == "" ? [] : split(value, /[ \t\r\n]+/);
}

function contains(values, needle) {
    needle = as_string(needle);
    for (let value in values)
        if (as_string(value) == needle)
            return true;
    return false;
}

// Tailscale, OpenVPN and WireGuard are endpoints; all but Tailscale listen.
function runtime_kind(protocol) {
    return servers.is_endpoint(protocol) ? "endpoints" : "inbounds";
}

// Only a listener reachable from WAN needs a firewall rule: wildcard, routable or WAN address.
function listen_requires_firewall(listen, wan_ip) {
    listen = as_string(listen);
    if (listen == "0.0.0.0" || listen == "::" || core_ip.valid_public_ip(listen))
        return true;
    for (let ip in words(wan_ip))
        if (ip == listen)
            return true;
    return false;
}

// Three flags, -1 where the question does not apply: resolves, all addresses public, one
// equals the WAN address.
function public_host_flags(public_host, public_host_ips, wan_ip, wan_public) {
    let resolved = -1;
    let public_ip = -1;
    let matches_wan = -1;
    let ips = words(public_host_ips);

    if (as_string(public_host) != "") {
        if (length(ips) == 0) {
            resolved = 0;
        }
        else {
            resolved = 1;
            public_ip = 1;
            for (let ip in ips)
                if (!core_ip.valid_public_ip(ip))
                    public_ip = 0;

            if (as_string(wan_public) == "1") {
                matches_wan = 0;
                for (let wan in words(wan_ip)) {
                    if (contains(ips, wan)) {
                        matches_wan = 1;
                        break;
                    }
                }
            }
        }
    }

    return { resolved, public_ip, matches_wan };
}

return {
    runtime_kind,
    listen_requires_firewall,
    public_host_flags
};
