// Answers one question about the router firewall: would an inbound connection
// from WAN reach a given port and protocol? The answer comes from two places.
// `uci show firewall` is the configuration the user can fix, and it is the only
// one for a port the user opened. The loaded input chain is the other, because
// the ports of the Servers tab are written as an nftables.d include that fw4
// folds into its ruleset - they never appear in uci at all, so reading uci alone
// reported every server Forkop had just opened as closed.

function as_string(value) {
    return value == null ? "" : "" + value;
}

function starts_with(value, prefix) {
    value = as_string(value);
    prefix = as_string(prefix);
    return substr(value, 0, length(prefix)) == prefix;
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

function uci_show_list_value(value) {
    return trim(replace(as_string(value), /['"]/g, ""));
}

// `uci show firewall` prints one `package.section=type` line per section
// followed by its `package.section.option=value` lines. Only rule sections
// matter, and they are collected in file order so that the first matching
// ACCEPT wins the same way the firewall evaluates them.
function rules_from_uci_show(data) {
    let prefix = "firewall.";
    let sections = {};
    let order = [];

    for (let line in split(as_string(data), "\n")) {
        let equals = index(as_string(line), "=");
        if (equals < 0)
            continue;

        let key = substr(line, 0, equals);
        let raw_value = substr(line, equals + 1);
        if (!starts_with(key, prefix))
            continue;

        let rest = substr(key, length(prefix));
        if (index(rest, ".") < 0) {
            if (uci_show_list_value(raw_value) == "rule") {
                if (sections[key] == null)
                    sections[key] = {};
                push(order, key);
            }
            continue;
        }

        let option_dot = rindex(key, ".");
        let section = substr(key, 0, option_dot);
        let option = substr(key, option_dot + 1);
        if (sections[section] == null)
            sections[section] = {};
        sections[section][option] = uci_show_list_value(raw_value);
    }

    let rules = [];
    for (let section in order)
        push(rules, sections[section] || {});

    return rules;
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

// Only rules that let WAN traffic reach the router itself count: a destination
// zone means forwarding, an IPv6 family rule does not cover the IPv4 listener
// the check is about, and a source port restriction cannot match a client's
// ephemeral port.
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

// required_proto is the whitespace separated protocol list an inbound needs;
// every one of them has to be open before the port counts as reachable.
function required_protocols_open(data, port, required_proto) {
    let rules = rules_from_uci_show(data);

    for (let proto in whitespace_values(required_proto))
        if (!rules_allow_port_proto(rules, port, proto))
            return false;

    return true;
}


// The ports one of Forkop's own accept rules covers, read out of the input chain
// the firewall is running. nft prints a single port bare and a set in braces:
//   tcp dport { 443, 8443 } counter packets 0 bytes 0 accept comment "..."
//   udp dport 443 counter packets 0 bytes 0 accept comment "..."
// The loaded chain is asked rather than the include file, because a written file
// that fw4 refused says the port is open when it is not.
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

// Whether Forkop's own rules already accept every protocol the inbound needs. An
// inbound that needs none is open the same way required_protocols_open reads it.
function forkop_accepts_port(chain_data, comment, port, required_proto) {
    let accepted = accepted_ports_by_proto(chain_data, comment);

    for (let proto in whitespace_values(required_proto))
        if (accepted[proto] == null || !accepted[proto][as_string(port)])
            return false;

    return true;
}

return {
    rules_from_uci_show,
    rules_allow_port_proto,
    port_spec_contains,
    proto_spec_contains,
    required_protocols_open,
    accepted_ports_by_proto,
    forkop_accepts_port
};
