// The rules the server check reasons with, separated from the commands that
// collect the facts: where the generated configuration keeps a server, when a
// listen address is exposed to WAN, and how the advertised public host compares
// with the WAN.

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

// Where the generated configuration keeps it: Tailscale, OpenVPN and WireGuard
// are endpoints, all but Tailscale with a listener of their own.
function runtime_kind(protocol) {
    return servers.is_endpoint(protocol) ? "endpoints" : "inbounds";
}

// A firewall rule is only meaningful when the listener can be reached from
// WAN: on a wildcard address, on a routable address, or on the WAN address
// itself.
function listen_requires_firewall(listen, wan_ip) {
    listen = as_string(listen);
    if (listen == "0.0.0.0" || listen == "::" || core_ip.valid_public_ip(listen))
        return true;
    for (let ip in words(wan_ip))
        if (ip == listen)
            return true;
    return false;
}

// How usable the advertised public host is, as three flags that stay -1 when
// the question does not apply: does it resolve at all, are all of its
// addresses routable from the Internet, and does one of them equal the WAN
// address. Without a public WAN address the last comparison is meaningless.
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
