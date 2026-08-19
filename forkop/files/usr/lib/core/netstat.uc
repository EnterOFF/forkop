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

function as_string(value) {
    return value == null ? "" : "" + value;
}

function fields(line) {
    line = trim(line);
    return line == "" ? [] : split(line, /[ \t\r\n]+/);
}

function starts_with(value, prefix) {
    return substr(as_string(value), 0, length(prefix)) == prefix;
}

function ends_with(value, suffix) {
    value = as_string(value);
    return length(value) >= length(suffix) && substr(value, length(value) - length(suffix)) == suffix;
}

function addr_port(addr) {
    addr = as_string(addr);
    let colon = rindex(addr, ":");
    return colon >= 0 ? substr(addr, colon + 1) : addr;
}

function addr_host(addr) {
    addr = as_string(addr);
    if (substr(addr, 0, 1) == "[") {
        let end = index(addr, "]");
        return end > 0 ? substr(addr, 1, end - 1) : addr;
    }
    let colon = rindex(addr, ":");
    return colon >= 0 ? substr(addr, 0, colon) : addr;
}

// A wildcard listener answers for every address of its family, so it satisfies
// any requested listen address; a requested wildcard is satisfied by any
// address of the matching family.
function addr_matches(addr, listen, port) {
    addr = as_string(addr);
    listen = as_string(listen);
    port = as_string(port);

    if (addr_port(addr) != port)
        return false;

    let host = addr_host(addr);
    if (host == "0.0.0.0" || host == "::")
        return true;
    if (listen == "0.0.0.0")
        return ipv4_host(host);
    if (listen == "::")
        return index(host, ":") >= 0;

    return host == listen;
}

function port_listening(data, listen, port, proto) {
    proto = as_string(proto);

    for (let line in split(as_string(data), "
")) {
        let parts = fields(line);
        if (length(parts) < 4 || !starts_with(parts[0], proto))
            continue;

        if (addr_matches(parts[3], listen, port))
            return true;
    }

    return false;
}

function sorted_unique(values) {
    let seen = {};
    let result = [];
    for (let value in values) {
        value = as_string(value);
        if (value != "" && !seen[value]) {
            seen[value] = true;
            push(result, value);
        }
    }

    sort(result, function(a, b) {
        return a < b ? -1 : (a > b ? 1 : 0);
    });
    return result;
}

// Reads `netstat -lnp` output. Without the PID/Program column busybox netstat
// reports no owner at all, so ownership is only claimed when the header shows
// it. sing-box itself is never a conflict: it is the process expected to hold
// the port.
function port_conflict_owners(data, listen, port, proto) {
    let owners = [];
    let line_number = 0;
    let owner_supported = false;

    for (let line in split(as_string(data), "
")) {
        line_number++;
        if (line_number == 2) {
            owner_supported = index(as_string(line), "PID/Program") >= 0;
            continue;
        }

        if (!owner_supported)
            continue;

        let parts = fields(line);
        if (length(parts) < 4 || !starts_with(parts[0], proto) || !addr_matches(parts[3], listen, port))
            continue;

        let owner = as_string(parts[length(parts) - 1]);
        if (owner == "" || owner == "-" || owner == "LISTEN")
            owner = "unknown";
        if (!ends_with(owner, "/sing-box"))
            push(owners, owner);
    }

    return sorted_unique(owners);
}

return {
    sing_box_standard_ports_listening,
    tcp_endpoint_in_use,
    port_listening,
    port_conflict_owners,
    sorted_unique
};
