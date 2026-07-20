function sing_box_standard_ports_listening(netstat, dns_address, tproxy_port, tproxy6_address) {
    netstat = netstat == null ? "" : "" + netstat;
    dns_address = dns_address == null ? "127.0.0.42" : "" + dns_address;
    tproxy_port = tproxy_port == null ? "1602" : "" + tproxy_port;
    tproxy6_address = tproxy6_address == null ? "::1" : "" + tproxy6_address;

    let dns_ok = index(netstat, dns_address + ":53") >= 0;
    let tproxy_suffix = ":" + tproxy_port;
    let tproxy4_ok = index(netstat, "0.0.0.0" + tproxy_suffix) >= 0 ||
        index(netstat, "127.0.0.1" + tproxy_suffix) >= 0;
    let tproxy6_ok = index(netstat, tproxy6_address + tproxy_suffix) >= 0 ||
        index(netstat, "[" + tproxy6_address + "]" + tproxy_suffix) >= 0 ||
        index(netstat, "0:0:0:0:0:0:0:1" + tproxy_suffix) >= 0 ||
        index(netstat, ":::" + tproxy_port) >= 0;
    return dns_ok && tproxy4_ok && tproxy6_ok;
}

function trim(value) {
    return replace(value == null ? "" : "" + value, /^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

function endpoint(value) {
    value = trim(value);
    let colon = rindex(value, ":");
    if (colon < 0)
        return null;

    let host = substr(value, 0, colon);
    let port = substr(value, colon + 1);
    if (match(port, /^[0-9]+$/) == null)
        return null;
    if (substr(host, 0, 1) == "[" && substr(host, length(host) - 1) == "]")
        host = substr(host, 1, length(host) - 2);
    if (host == "")
        host = "::";

    return { host: lc(host), port };
}

function ipv4_host(host) {
    return match(host, /^[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+$/) != null;
}

function endpoint_hosts_overlap(left, right) {
    if (left == right || left == "::" || right == "::")
        return true;
    if (left == "0.0.0.0")
        return ipv4_host(right);
    if (right == "0.0.0.0")
        return ipv4_host(left);
    return false;
}

function tcp_endpoint_in_use(netstat, requested_endpoint) {
    let requested = endpoint(requested_endpoint);
    if (requested == null)
        return false;

    for (let line in split(netstat == null ? "" : "" + netstat, "\n")) {
        let fields = split(trim(line), /[ \t\r\n]+/);
        if (length(fields) < 4 || substr(fields[0], 0, 3) != "tcp")
            continue;

        let listener = endpoint(fields[3]);
        if (listener != null && listener.port == requested.port && endpoint_hosts_overlap(listener.host, requested.host))
            return true;
    }

    return false;
}

return { sing_box_standard_ports_listening, tcp_endpoint_in_use };
