// The rules the server inbound check reasons with, separated from the
// commands that collect the facts: which transport a protocol needs, which
// sing-box inbound type it becomes, when a listen address is exposed to WAN,
// and how the generated inbound and the advertised public host compare with
// what UCI asks for.

let core_ip = require("core.ip");

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

// A JSON inbound declares its own listeners, so nothing is required of it.
// Everything else is TCP unless the protocol is UDP-only or its transport
// option says otherwise. Shadowsocks is the one that carries both without being
// asked: its listener takes the default network, which is TCP and UDP, and the
// UDP half is how a client relays datagrams.
// The `type` the generator writes into the sing-box inbound or endpoint. Only
// MTProto and OpenVPN are named differently there.
function runtime_type(protocol) {
    protocol = as_string(protocol);
    if (protocol == "json_inbound")
        return "";
    if (protocol == "mtproto")
        return "mtproxy";
    if (protocol == "openvpn")
        return "openvpn-server";
    return protocol;
}

// Where the generated configuration keeps it: Tailscale and OpenVPN are
// endpoints, an OpenVPN server one with a listener of its own.
function runtime_kind(protocol) {
    return protocol == "tailscale" || protocol == "openvpn" ? "endpoints" : "inbounds";
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

// The generated inbound has to exist and describe the same listener as UCI. A
// JSON inbound carries its own listen settings, and a Tailscale endpoint has
// no listener of its own, so for both only existence and type are compared.
function runtime_ok(protocol, runtime_exists, runtime_type_value, runtime_listen, runtime_port,
                    expected_type, listen, listen_port) {
    if (as_string(runtime_exists) != "1")
        return 0;

    if (protocol == "json_inbound")
        return 1;

    if (as_string(runtime_type_value) != as_string(expected_type))
        return 0;

    if (protocol == "tailscale")
        return 1;

    return as_string(runtime_listen) == as_string(listen) &&
        as_string(runtime_port) == as_string(listen_port) ? 1 : 0;
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
    runtime_type,
    runtime_kind,
    listen_requires_firewall,
    runtime_ok,
    public_host_flags
};
