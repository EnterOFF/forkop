// Whether a connection from WAN reaches a port: the firewall rules hold what the user opened,
// the loaded input chain the Servers tab ports, an nftables.d include no rule names.

function as_string(value) {
    return value == null ? "" : type(value) == "array" ? join(" ", value) : "" + value;
}

function only_digits(value) {
    value = as_string(value);
    return value != "" && match(value, /^[0-9]+$/) != null;
}

function whitespace_values(value) {
    let result = [];
    for (let item in split(trim(as_string(value)), /[ \t\r\n]+/))
        if (item != "")
            push(result, item);
    return result;
}

// A port token is either a single port or a range written with "-" or ":".
function port_token_contains(token, port) {
    token = as_string(token);
    port = as_string(port);

    let dash = index(token, "-");
    let colon = index(token, ":");
    if (dash < 0 && colon < 0)
        return token == port;

    let separator = dash >= 0 ? dash : colon;
    let start = substr(token, 0, separator);
    let end = substr(token, separator + 1);
    if (!only_digits(start) || !only_digits(end) || !only_digits(port))
        return false;

    port = int(port);
    return port >= int(start) && port <= int(end);
}

// An empty spec means the rule does not restrict the port at all.
function port_spec_contains(spec, port) {
    spec = as_string(spec);
    if (spec == "")
        return true;

    for (let token in split(replace(spec, /,/g, " "), /[ \t\r\n]+/))
        if (token != "" && port_token_contains(token, port))
            return true;

    return false;
}

function proto_spec_contains(spec, proto) {
    spec = as_string(spec);
    proto = as_string(proto);
    if (spec == "")
        return true;

    for (let token in split(spec, /[ \t\r\n]+/)) {
        if (token == "all" || token == "any" || token == "tcpudp" || token == "tcp/udp" || token == proto)
            return true;
    }

    return false;
}

// A destination zone means forwarding, an IPv6-only rule misses the IPv4 listener, and a
// source port restriction cannot match a client's ephemeral port.
function rules_allow_port_proto(rules, port, proto) {
    for (let rule in rules) {
        let enabled = as_string(rule.enabled);
        if (enabled != "" && enabled != "1")
            continue;

        if (uc(as_string(rule.target)) != "ACCEPT")
            continue;

        let src = as_string(rule.src);
        if (src != "" && src != "wan" && src != "*")
            continue;

        let dest = as_string(rule.dest);
        if (dest != "" && dest != "*")
            continue;

        let src_port = as_string(rule.src_port);
        if (src_port != "" && src_port != "*")
            continue;

        if (as_string(rule.family) == "ipv6")
            continue;

        if (!proto_spec_contains(rule.proto, proto))
            continue;

        if (!port_spec_contains(rule.dest_port, port))
            continue;

        return true;
    }

    return false;
}

// Every protocol in required_proto must be open.
function required_protocols_open(rules, port, required_proto) {
    for (let proto in whitespace_values(required_proto))
        if (!rules_allow_port_proto(rules, port, proto))
            return false;

    return true;
}


// Read from the loaded chain, not the include file, which fw4 may have refused. nft prints a
// single port bare and a set in braces:
//   tcp dport { 443, 8443 } counter packets 0 bytes 0 accept comment "..."
//   udp dport 443 counter packets 0 bytes 0 accept comment "..."
function accepted_ports_by_proto(chain_data, comment) {
    let result = { tcp: {}, udp: {} };
    comment = as_string(comment);
    if (comment == "")
        return result;

    for (let line in split(as_string(chain_data), "\n")) {
        line = trim(line);
        if (index(line, comment) < 0 || index(line, " accept") < 0)
            continue;

        let parsed = match(line, /^(tcp|udp) dport (\{[^}]*\}|[0-9]+)/);
        if (parsed == null)
            continue;

        for (let port in split(replace(parsed[2], /[{}]/g, ""), ","))
            if (only_digits(trim(port)))
                result[parsed[1]][trim(port)] = true;
    }

    return result;
}

function forkop_accepts_port(chain_data, comment, port, required_proto) {
    let accepted = accepted_ports_by_proto(chain_data, comment);

    for (let proto in whitespace_values(required_proto))
        if (accepted[proto] == null || !accepted[proto][as_string(port)])
            return false;

    return true;
}

return {
    required_protocols_open,
    forkop_accepts_port
};
