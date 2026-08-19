#!/usr/bin/env ucode

let fs = require("fs");
let core_ip = require("core.ip");
let core_url = require("core.url");

function as_string(value) {
    return value == null ? "" : "" + value;
}

function read_stdin() {
    let input = fs.open("/dev/stdin", "r");
    if (!input)
        return "";
    let data = input.read("all");
    input.close();
    return data == null ? "" : data;
}

function read_stdin_json() {
    try {
        return json(read_stdin());
    }
    catch (e) {
        return null;
    }
}

function proxy_response_is_retryable_error() {
    let response = read_stdin();
    return index(response, "<html") == 0 || index(response, "403 Forbidden") >= 0;
}

function read_json_file(path) {
    let data = fs.readfile(path);
    if (data == null)
        return null;

    try {
        return json(data);
    }
    catch (e) {
        return null;
    }
}

function write_json_file(path, value) {
    return fs.writefile(path, sprintf("%J", value) + "\n");
}

function parse_json_object(value) {
    try {
        value = json(as_string(value));
    }
    catch (e) {
        return {};
    }

    return type(value) == "object" ? value : {};
}

function number_value(value) {
    value = as_string(value);
    return value == "" ? 0 : int(value);
}

function stdin_first_line_last_field() {
    let input = read_stdin();
    if (input == "")
        return;

    let newline = index(input, "\n");
    let line = newline >= 0 ? substr(input, 0, newline) : input;
    let trimmed = trim(line);
    if (trimmed == "") {
        print(line, "\n");
        return;
    }

    let fields = split(trimmed, /[ \t\r\n]+/);
    if (length(fields) > 0 && fields[0] != "")
        print(fields[length(fields) - 1], "\n");
    else
        print("\n");
}

function stdin_first_line() {
    let input = read_stdin();
    if (input == "")
        return;

    let newline = index(input, "\n");
    print(newline >= 0 ? substr(input, 0, newline + 1) : input);
}

function stdin_contains(needle) {
    exit(index(read_stdin(), as_string(needle)) >= 0 ? 0 : 1);
}

function uci_show_value(line) {
    let equals = index(as_string(line), "=");
    if (equals < 0)
        return "";

    let value = substr(line, equals + 1);
    let next_equals = index(value, "=");
    if (next_equals >= 0)
        value = substr(value, 0, next_equals);

    return replace(value, /['" ]/g, "");
}

function string_starts_with(value, prefix) {
    value = as_string(value);
    prefix = as_string(prefix);
    return substr(value, 0, length(prefix)) == prefix;
}

function uci_show_list_value(value) {
    return trim(replace(as_string(value), /['"]/g, ""));
}

function firewall_rules_from_uci_show(data) {
    let prefix = "firewall.";
    let sections = {};
    let order = [];

    for (let line in split(as_string(data), "\n")) {
        let equals = index(as_string(line), "=");
        if (equals < 0)
            continue;

        let key = substr(line, 0, equals);
        let raw_value = substr(line, equals + 1);
        if (!string_starts_with(key, prefix))
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

function first_two_dot_fields(value) {
    let parts = split(as_string(value), ".");
    return length(parts) >= 2 ? parts[0] + "." + parts[1] : as_string(value);
}

function whitespace_values(value) {
    let result = [];
    for (let item in split(trim(as_string(value)), /[ \t\r\n]+/))
        if (item != "")
            push(result, item);
    return result;
}

function value_in_list(values, needle) {
    for (let value in values)
        if (as_string(value) == as_string(needle))
            return true;
    return false;
}

function network_endpoint_host_warnings(octets) {
    let cloudflare_octets = whitespace_values(octets);

    for (let line in split(read_stdin(), "\n")) {
        line = as_string(line);
        if (index(line, "endpoint_host") < 0)
            continue;

        let host = uci_show_value(line);
        if (host == "")
            continue;

        if (host == "engage.cloudflareclient.com") {
            print("engage\t", host, "\n");
            continue;
        }

        if (value_in_list(cloudflare_octets, first_two_dot_fields(host)))
            print("prefix\t", host, "\n");
    }
}

function network_wireguard_route_allowed_peers() {
    for (let line in split(read_stdin(), "\n")) {
        line = as_string(line);
        if (index(line, "wireguard_") < 0 || index(line, ".route_allowed_ips=") < 0)
            continue;
        if (uci_show_value(line) != "1")
            continue;

        let route_option = index(line, ".route_allowed_ips=");
        if (route_option > 0)
            print(substr(line, 0, route_option), "\n");
    }
}

function wan_config_masked(path) {
    let data = fs.readfile(path);
    let in_wan = false;
    let proto = "";

    if (data == null)
        exit(1);

    let lines = split(as_string(data), "\n");
    for (let i = 0; i < length(lines); i++) {
        let line = lines[i];
        if (i == length(lines) - 1 && line == "" && substr(as_string(data), length(data) - 1) == "\n")
            continue;

        let fields = split(trim(as_string(line)), /[ \t\r\n]+/);
        if (length(fields) > 0 && fields[0] == "config") {
            in_wan = length(fields) >= 3 && fields[1] == "interface" && fields[2] == "'wan'";
            proto = "";
        }

        if (!in_wan)
            continue;

        if (length(fields) >= 3 && fields[0] == "option" && fields[1] == "proto") {
            proto = fields[2];
            print(line, "\n");
        }
        else if (proto == "'static'" && length(fields) >= 2 && fields[0] == "option" &&
            (fields[1] == "ipaddr" || fields[1] == "netmask" || fields[1] == "gateway")) {
            print("        option ", fields[1], " '******'\n");
        }
        else if (proto == "'pppoe'" && length(fields) >= 2 && fields[0] == "option" &&
            (fields[1] == "username" || fields[1] == "password")) {
            print("        option ", fields[1], " '******'\n");
        }
        else if (proto == "'wireguard'" && length(fields) >= 2 && fields[0] == "option" &&
            fields[1] == "private_key") {
            print("        option private_key '******'\n");
        }
        else {
            print(line, "\n");
        }
    }
}

function is_space_char(value) {
    return value == " " || value == "\t" || value == "\r" || value == "\n";
}

function mask_after_token(line, token) {
    let pos = index(line, token);
    return pos < 0 ? line : substr(line, 0, pos) + token + " 'MASKED'";
}

function mask_after_token_space(line, token) {
    let pos = index(line, token);
    if (pos < 0)
        return line;

    let space_pos = pos + length(token);
    if (space_pos >= length(line) || !is_space_char(substr(line, space_pos, 1)))
        return line;

    return substr(line, 0, space_pos + 1) + "'MASKED'";
}

function delete_token_space(line, token) {
    let pos = index(line, token);
    if (pos < 0)
        return false;

    let space_pos = pos + length(token);
    return space_pos < length(line) && is_space_char(substr(line, space_pos, 1));
}

function mask_option_path(line, token) {
    let pos = index(line, token);
    if (pos < 0)
        return line;

    let slash = index(substr(line, pos + length(token)), "/");
    if (slash < 0)
        return line;
    slash += pos + length(token);

    let quote = index(substr(line, slash + 1), "'");
    if (quote < 0)
        return line;
    quote += slash + 1;

    return substr(line, 0, slash) + "/MASKED'" + substr(line, quote + 1);
}

function forkop_config_masked_line(line) {
    line = mask_after_token(line, "option proxy_string");
    line = mask_after_token(line, "option hwid");
    line = mask_after_token(line, "list header");
    line = mask_after_token(line, "option subscription_url");
    line = mask_after_token(line, "list subscription_urls");
    line = mask_after_token(line, "list urltest_proxy_links");
    line = mask_after_token(line, "list selector_proxy_links");
    line = mask_after_token_space(line, "option outbound_json");
    line = mask_after_token_space(line, "option endpoint_json");
    line = mask_after_token_space(line, "list domain");
    line = mask_after_token_space(line, "list domain_suffix");
    line = mask_after_token_space(line, "list domain_keyword");
    line = mask_after_token_space(line, "list domain_regex");
    line = mask_after_token_space(line, "list ip_cidr");
    line = mask_after_token_space(line, "list source_ip_cidr");
    line = mask_after_token_space(line, "list fully_routed_ips");
    line = mask_after_token_space(line, "option dns_server");
    line = mask_after_token_space(line, "option bootstrap_dns_server");
    line = mask_after_token_space(line, "list dns_server");
    line = mask_after_token_space(line, "list bootstrap_dns_server");
    line = mask_after_token_space(line, "option listen");
    line = mask_after_token_space(line, "option listen_port");
    line = mask_after_token_space(line, "option public_host");
    line = mask_after_token(line, "option server_uuid");
    line = mask_after_token(line, "option server_username");
    line = mask_after_token(line, "option server_password");
    line = mask_after_token(line, "option mtproto_secret");
    line = mask_after_token_space(line, "option mtproto_faketls");
    line = mask_after_token_space(line, "option mtproto_domain_fronting_ip");
    line = mask_after_token_space(line, "option tls_server_name");
    line = mask_after_token_space(line, "option reality_handshake_server");
    line = mask_after_token_space(line, "option reality_handshake_server_port");
    line = mask_after_token_space(line, "option transport_host");
    line = mask_after_token_space(line, "list transport_hosts");
    line = mask_after_token_space(line, "option tailscale_auth_key");
    line = mask_after_token_space(line, "option tailscale_control_url");
    line = mask_after_token_space(line, "option tailscale_hostname");
    line = mask_after_token_space(line, "option warp_profile_id");
    line = mask_after_token_space(line, "option warp_profile_auth_token");
    line = mask_after_token_space(line, "option warp_profile_private_key");
    line = mask_after_token_space(line, "option warp_profile_license_key");
    line = mask_after_token_space(line, "option pre_shared_key");
    line = mask_after_token_space(line, "option public_key");
    line = mask_after_token_space(line, "option address");
    line = mask_after_token_space(line, "list address");
    line = mask_after_token_space(line, "option port");
    line = mask_after_token_space(line, "list allowed_ips");
    line = mask_after_token_space(line, "list tailscale_advertise_routes");
    line = mask_after_token(line, "option hysteria2_obfs_password");
    line = mask_after_token(line, "option reality_private_key");
    line = mask_after_token(line, "option reality_public_key");
    line = mask_after_token(line, "option reality_short_id");
    line = mask_after_token(line, "list reality_short_id");
    line = mask_after_token_space(line, "option mixed_proxy_username");
    line = mask_after_token_space(line, "option mixed_proxy_password");
    line = mask_after_token_space(line, "option private_key");
    line = mask_after_token_space(line, "option url");
    line = mask_option_path(line, "option dns_server '");
    line = mask_option_path(line, "list dns_server '");
    line = mask_after_token(line, "option yacd_secret_key");

    return line;
}

function forkop_config_masked(path) {
    let data = fs.readfile(path);
    if (data == null)
        exit(1);

    let lines = split(as_string(data), "\n");
    let in_masked_multiline = false;

    for (let i = 0; i < length(lines); i++) {
        let line = as_string(lines[i]);
        if (i == length(lines) - 1 && line == "" && substr(as_string(data), length(data) - 1) == "\n")
            continue;

        if (in_masked_multiline) {
            if (index(line, "'") >= 0)
                in_masked_multiline = false;
            continue;
        }

        if (delete_token_space(line, "option tailscale_ephemeral") ||
            delete_token_space(line, "option tailscale_exit_node") ||
            delete_token_space(line, "option tailscale_exit_node_allow_lan_access"))
            continue;

        let masked = forkop_config_masked_line(line);
        print(masked, "\n");
        if (index(line, "option outbound_json") >= 0 || index(line, "option endpoint_json") >= 0) {
            let first_quote = index(line, "'");
            if (first_quote >= 0 && index(substr(line, first_quote + 1), "'") < 0)
                in_masked_multiline = true;
        }
    }
}

function dhcp_dnsmasq_config(path) {
    let data = fs.readfile(path);
    let in_dnsmasq = false;

    if (data == null)
        exit(1);

    let lines = split(as_string(data), "\n");
    for (let i = 0; i < length(lines); i++) {
        let line = lines[i];
        if (i == length(lines) - 1 && line == "" && substr(as_string(data), length(data) - 1) == "\n")
            continue;

        if (match(as_string(line), /^config /) != null) {
            let fields = split(trim(as_string(line)), /[ \t\r\n]+/);
            in_dnsmasq = length(fields) >= 2 && fields[1] == "dnsmasq";
        }

        if (in_dnsmasq)
            print(line, "\n");
    }
}

function only_digits(value) {
    value = as_string(value);
    return value != "" && match(value, /^[0-9]+$/) != null;
}

function firewall_port_token_contains(token, port) {
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

function firewall_port_spec_contains(spec, port) {
    spec = as_string(spec);
    if (spec == "")
        return true;

    for (let token in split(replace(spec, /,/g, " "), /[ \t\r\n]+/))
        if (token != "" && firewall_port_token_contains(token, port))
            return true;

    return false;
}

function firewall_proto_spec_contains(spec, proto) {
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

function firewall_rules_allow_port_proto(rules, port, proto) {
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

        if (!firewall_proto_spec_contains(rule.proto, proto))
            continue;

        if (!firewall_port_spec_contains(rule.dest_port, port))
            continue;

        return true;
    }

    return false;
}

function firewall_required_protocols_open(port, required_proto) {
    let rules = firewall_rules_from_uci_show(read_stdin());

    for (let proto in whitespace_values(required_proto))
        if (!firewall_rules_allow_port_proto(rules, port, proto))
            return false;

    return true;
}

function server_required_inbound_proto(protocol, transport) {
    protocol = as_string(protocol);
    transport = lc(as_string(transport));
    if (protocol == "json_inbound")
        print("\n");
    else if (protocol == "hysteria2" || protocol == "tuic")
        print("udp\n");
    else if (protocol == "naive" && transport == "tcp_udp")
        print("tcp udp\n");
    else if ((protocol == "naive" || protocol == "mieru") && transport == "udp")
        print("udp\n");
    else
        print("tcp\n");
}

function arg_bool(value) {
    return value === true || value == "true" || value == "1" || value == 1;
}

function arg_number(value) {
    value = as_string(value);
    if (value == "" || match(value, /[^0-9-]/))
        return 0;
    return int(value);
}

function flag_is_one(value) {
    return as_string(value) == "1";
}

function flag_is_true(value) {
    return value == true || as_string(value) == "true" || as_string(value) == "1";
}

function server_listen_requires_firewall(listen, wan_ip, listen_is_public) {
    listen = as_string(listen);
    wan_ip = as_string(wan_ip);

    if (listen == "0.0.0.0" || listen == "::" || arg_bool(listen_is_public))
        return true;
    for (let ip in whitespace_values(wan_ip))
        if (ip == listen)
            return true;
    return false;
}

function object_value(object, key) {
    return type(object) == "object" && object[key] != null ? as_string(object[key]) : "";
}

function object_or_empty(value) {
    return type(value) == "object" ? value : {};
}

function array_or_empty(value) {
    return type(value) == "array" ? value : [];
}

function str_startswith(value, prefix) {
    value = as_string(value);
    prefix = as_string(prefix);
    return substr(value, 0, length(prefix)) == prefix;
}

function str_endswith(value, suffix) {
    value = as_string(value);
    suffix = as_string(suffix);
    return length(value) >= length(suffix) && substr(value, length(value) - length(suffix)) == suffix;
}

function contains(values, needle) {
    needle = as_string(needle);
    for (let value in array_or_empty(values))
        if (as_string(value) == needle)
            return true;
    return false;
}

function netstat_fields(line) {
    line = trim(as_string(line));
    return line == "" ? [] : split(line, /[ \t\r\n]+/);
}

function netstat_addr_port(addr) {
    addr = as_string(addr);
    let colon = rindex(addr, ":");
    return colon >= 0 ? substr(addr, colon + 1) : addr;
}

function netstat_addr_host(addr) {
    addr = as_string(addr);
    if (substr(addr, 0, 1) == "[") {
        let end = index(addr, "]");
        return end > 0 ? substr(addr, 1, end - 1) : addr;
    }
    let colon = rindex(addr, ":");
    return colon >= 0 ? substr(addr, 0, colon) : addr;
}

function ipv4_like(value) {
    return match(as_string(value), /^[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+$/) != null;
}

function valid_ipv4(value) {
    return core_ip.valid_ipv4(value, false, false);
}

function valid_public_ipv4(value) {
    value = as_string(value);
    if (!valid_ipv4(value))
        return false;

    let parts = split(value, ".");
    let a = int(parts[0]);
    let b = int(parts[1]);

    if (a == 0 || a == 10 || a == 127 || a >= 224)
        return false;
    if (a == 169 && b == 254)
        return false;
    if (a == 192 && (b == 168 || b == 0 || b == 2))
        return false;
    if (a == 198 && (b == 18 || b == 19 || b == 51))
        return false;
    if (a == 203 && b == 0)
        return false;
    if (a == 100 && b >= 64 && b <= 127)
        return false;
    if (a == 172 && b >= 16 && b <= 31)
        return false;

    return true;
}

function valid_public_ipv6(value) {
    value = lc(as_string(value));
    if (!core_ip.valid_ipv6(value))
        return false;
    if (value == "::" || value == "::1")
        return false;
    if (substr(value, 0, 4) == "fe80" || substr(value, 0, 2) == "ff")
        return false;
    if (substr(value, 0, 2) == "fc" || substr(value, 0, 2) == "fd")
        return false;
    if (index(value, "2001:db8") == 0)
        return false;
    return true;
}

function valid_public_ip(value) {
    return valid_public_ipv4(value) || valid_public_ipv6(value);
}

function netstat_addr_matches(addr, listen, port) {
    addr = as_string(addr);
    listen = as_string(listen);
    port = as_string(port);

    if (netstat_addr_port(addr) != port)
        return false;

    let host = netstat_addr_host(addr);
    if (host == "0.0.0.0" || host == "::")
        return true;
    if (listen == "0.0.0.0")
        return ipv4_like(host);
    if (listen == "::")
        return index(host, ":") >= 0;

    return host == listen;
}

function netstat_server_port_listening_in_data(data, listen, port, proto) {
    listen = as_string(listen);
    port = as_string(port);
    proto = as_string(proto);

    for (let line in split(as_string(data), "\n")) {
        let fields = netstat_fields(line);
        if (length(fields) < 4 || !str_startswith(fields[0], proto))
            continue;

        if (netstat_addr_matches(fields[3], listen, port))
            return true;
    }

    return false;
}

function server_required_ports_listening(listen, port, required_proto) {
    let data = read_stdin();

    for (let proto in whitespace_values(required_proto))
        if (!netstat_server_port_listening_in_data(data, listen, port, proto))
            return false;

    return true;
}

function sorted_unique_strings(values) {
    let result = [];
    for (let value in values) {
        value = as_string(value);
        if (value != "" && !contains(result, value))
            push(result, value);
    }

    sort(result, function(a, b) {
        return a < b ? -1 : (a > b ? 1 : 0);
    });
    return result;
}

function public_host_flags(public_host, public_host_ips, wan_ip, wan_public) {
    let resolved = -1;
    let public_ip = -1;
    let matches_wan = -1;
    let ips = whitespace_values(public_host_ips);

    if (as_string(public_host) != "") {
        if (length(ips) > 0) {
            resolved = 1;
            public_ip = 1;
            for (let ip in ips)
                if (!valid_public_ip(ip))
                    public_ip = 0;

            if (as_string(wan_public) == "1") {
                matches_wan = 0;
                for (let wan in whitespace_values(wan_ip)) {
                    if (contains(ips, wan)) {
                        matches_wan = 1;
                        break;
                    }
                }
            }
        }
        else {
            resolved = 0;
        }
    }

    print(resolved, " ", public_ip, " ", matches_wan, "\n");
}

function netstat_server_port_conflict_owner_list(data, listen, port, proto) {
    let owners = [];
    let line_number = 0;
    let owner_supported = false;

    for (let line in split(as_string(data), "\n")) {
        line_number++;
        if (line_number == 2) {
            owner_supported = index(as_string(line), "PID/Program") >= 0;
            continue;
        }

        if (!owner_supported)
            continue;

        let fields = netstat_fields(line);
        if (length(fields) < 4 || !str_startswith(fields[0], proto) || !netstat_addr_matches(fields[3], listen, port))
            continue;

        let owner = length(fields) > 0 ? as_string(fields[length(fields) - 1]) : "";
        if (owner == "" || owner == "-" || owner == "LISTEN")
            owner = "unknown";
        if (!str_endswith(owner, "/sing-box"))
            push(owners, owner);
    }

    return sorted_unique_strings(owners);
}

function server_required_port_conflict_owners(listen, port, required_proto) {
    let data = read_stdin();
    let owners = [];

    for (let proto in whitespace_values(required_proto))
        for (let owner in netstat_server_port_conflict_owner_list(data, listen, port, proto))
            if (!contains(owners, owner))
                push(owners, owner);

    print(join(" ", sorted_unique_strings(owners)), "\n");
}

function nft_chain_counter_status() {
    let rules_exist = 0;
    let counters = 0;

    for (let line in split(read_stdin(), "\n")) {
        line = as_string(line);
        if (index(line, "counter") < 0)
            continue;

        rules_exist = 1;
        if (index(line, "packets 0 bytes 0") < 0)
            counters = 1;
    }

    print(rules_exist, " ", counters, "\n");
}

function print_line(value) {
    print(value, "\n");
}

function write_json(value) {
    print(sprintf("%J", value), "\n");
}

function mask_ipv6_line(line) {
    let matched = match(line, /([0-9a-fA-F]+:[0-9a-fA-F]+:[0-9a-fA-F]+):.*/);
    return matched ? matched[1] + ":XXXX:XXXX:XXXX" : line;
}

function render_proxy_response_ip_mask() {
    let response = read_stdin();
    let lines = split(response, "\n");
    let ipv4_lines = [];
    let ipv6_like = false;

    for (let line in lines) {
        // The public endpoint answers with JSON, a plain address service with a
        // bare address. Both are accepted, and only the last octet is shown.
        let matched = match(line, /^([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)$/) ||
            match(line, /"IP"[[:space:]]*:[[:space:]]*"([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)"/);
        if (matched)
            push(ipv4_lines, "X.X.X." + matched[4]);

        if (match(line, /^[0-9a-fA-F:]*::[0-9a-fA-F:]*$/) || match(line, /^[0-9a-fA-F:]+$/))
            ipv6_like = true;
    }

    if (length(ipv4_lines) > 0) {
        for (let line in ipv4_lines)
            print_line(line);
        return;
    }

    if (ipv6_like) {
        for (let i = 0; i < length(lines); i++) {
            if (i == length(lines) - 1 && lines[i] == "")
                continue;
            print_line(mask_ipv6_line(lines[i]));
        }
        return;
    }

    exit(1);
}

function render_inbound_item(item, wan_ip) {
    let label = object_value(item, "label");
    let protocol = object_value(item, "protocol");
    let listen = object_value(item, "listen");
    let listen_port = object_value(item, "listen_port");
    let public_host = object_value(item, "public_host");
    let tag = object_value(item, "tag");
    let required_proto = object_value(item, "required_proto");
    let runtime_ok = object_value(item, "runtime_ok");
    let listening = object_value(item, "listening");
    let firewall_required = object_value(item, "firewall_required");
    let firewall_open = object_value(item, "firewall_open");
    let port_conflict = object_value(item, "port_conflict");
    let port_conflict_owners = object_value(item, "port_conflict_owners");
    let routes_configured = object_value(item, "routes_configured");
    let public_host_resolved = object_value(item, "public_host_resolved");
    let public_host_public = object_value(item, "public_host_public");
    let public_host_matches_wan = object_value(item, "public_host_matches_wan");
    let public_host_ips = object_value(item, "public_host_ips");

    if (flag_is_one(runtime_ok))
        print_line("[OK] " + label + ": runtime " + tag + " [" + protocol + "]");
    else
        print_line("[FAIL] " + label + ": generated inbound is missing or differs from UCI");

    if (protocol == "json_inbound") {
        print_line("[OK] " + label + ": JSON inbound uses custom listen settings");
    }
    else if (protocol != "tailscale") {
        if (flag_is_one(listening))
            print_line("[OK] " + label + ": listening on " + listen + ":" + listen_port + " [" + required_proto + "]");
        else
            print_line("[FAIL] " + label + ": not listening on " + listen + ":" + listen_port + " [" + required_proto + "]");

        if (flag_is_one(port_conflict))
            print_line("[FAIL] " + label + ": " + listen + ":" + listen_port + " [" + required_proto + "] is already used by " + port_conflict_owners);
        else
            print_line("[OK] " + label + ": no local port conflict detected");

        if (flag_is_one(firewall_required)) {
            if (flag_is_one(firewall_open))
                print_line("[OK] " + label + ": firewall accepts " + required_proto + "/" + listen_port + " from WAN");
            else
                print_line("[FAIL] " + label + ": firewall does not accept " + required_proto + "/" + listen_port + " from WAN");
        }
        else {
            print_line("[WARN] " + label + ": firewall WAN check skipped for listen address " + listen);
        }
    }
    else {
        print_line("[OK] " + label + ": Tailscale endpoint does not need a public firewall port");
    }

    if (flag_is_one(routes_configured))
        print_line("[OK] " + label + ": route rules for inbound exist");
    else
        print_line("[WARN] " + label + ": route rules for inbound were not found");

    if (protocol != "tailscale" && protocol != "json_inbound") {
        if (public_host != "") {
            if (public_host_resolved == "0")
                print_line("[WARN] " + label + ": public host does not resolve: " + public_host);
            else if (public_host_public == "0")
                print_line("[WARN] " + label + ": public host is not public: " + public_host);
            else if (public_host_matches_wan == "0")
                print_line("[WARN] " + label + ": public host resolves to " + public_host_ips + ", WAN is " + wan_ip);
            else
                print_line("[OK] " + label + ": public host " + public_host);
        }
        else {
            print_line("[WARN] " + label + ": public host is empty");
        }
    }
}

function inbound_runtime_ok(protocol, runtime_exists, runtime_type, runtime_listen, runtime_port_text, expected_type, listen, listen_port) {
    if (!flag_is_one(runtime_exists))
        return 0;

    if (protocol == "json_inbound")
        return 1;

    if (runtime_type != expected_type)
        return 0;

    if (protocol == "tailscale")
        return 1;

    return runtime_listen == listen && runtime_port_text == listen_port ? 1 : 0;
}

function write_inbound_item_json(args) {
    let runtime = parse_json_object(args[0]);
    let section = as_string(args[1]);
    let label = as_string(args[2]);
    let protocol = as_string(args[3]);
    let routing_mode = as_string(args[4]);
    let tag = as_string(args[5]);
    let listen = as_string(args[6]);
    let listen_port = as_string(args[7]);
    let public_host = as_string(args[8]);
    let public_host_ips = as_string(args[9]);
    let expected_type = as_string(args[10]);
    let required_proto = as_string(args[11]);
    let runtime_exists = object_value(runtime, "exists") || "0";
    let runtime_type = object_value(runtime, "type");
    let runtime_listen = object_value(runtime, "listen");
    let runtime_port_text = object_value(runtime, "listen_port") || "0";

    write_json({
        section,
        label,
        protocol,
        routing_mode,
        tag,
        listen,
        listen_port: number_value(listen_port),
        public_host,
        public_host_ips,
        expected_type,
        required_proto,
        runtime_exists: number_value(runtime_exists),
        runtime_type,
        runtime_listen,
        runtime_port: number_value(runtime_port_text),
        runtime_ok: inbound_runtime_ok(protocol, runtime_exists, runtime_type, runtime_listen, runtime_port_text, expected_type, listen, listen_port),
        listening: number_value(args[12]),
        firewall_required: number_value(args[13]),
        firewall_open: number_value(args[14]),
        port_conflict: number_value(args[15]),
        port_conflict_owners: as_string(args[16]),
        routes_configured: number_value(args[17]),
        public_host_resolved: number_value(args[18]),
        public_host_public: number_value(args[19]),
        public_host_matches_wan: number_value(args[20])
    });
}

function service_status_label(running, enabled) {
    running = arg_number(running);
    enabled = arg_number(enabled);

    if (running == 1)
        return enabled == 1 ? "running & enabled" : "running but disabled";

    return enabled == 1 ? "stopped but enabled" : "stopped & disabled";
}

function write_service_status_json(running, enabled, status_or_dns_configured, dns_configured) {
    if (dns_configured == null)
        dns_configured = status_or_dns_configured;

    write_json({
        running: arg_number(running),
        enabled: arg_number(enabled),
        status: service_status_label(running, enabled),
        dns_configured: arg_number(dns_configured)
    });
}

function service_list_instance_running(name) {
    let value = object_or_empty(read_stdin_json());
    let service = object_or_empty(value[as_string(name)]);
    let instances = object_or_empty(service.instances);

    for (let key in instances) {
        let instance = object_or_empty(instances[key]);
        if (flag_is_true(instance.running))
            exit(0);
    }

    exit(1);
}

function repeat_char(char, count) {
    let result = "";
    for (let i = 0; i < count; i++)
        result += char;
    return result;
}

function first_field(value, separator) {
    let marker = index(value, separator);
    return marker < 0 ? value : substr(value, 0, marker);
}

function mask_dns_server(value) {
    value = as_string(value);
    let scheme = core_url.scheme(value);
    let prefix = scheme == "" ? "" : scheme + "://";
    let host = core_url.host(value);
    let port = core_url.port(value);
    let suffix = port == "" ? "" : ":" + port;
    let path = core_url.path(value);

    if (str_endswith(host, ".dns.nextdns.io")) {
        let nextdns_id = first_field(host, ".");
        print_line(prefix + repeat_char("*", length(nextdns_id)) + ".dns.nextdns.io" + suffix + path);
        return;
    }

    if (host == "dns.nextdns.io" && length(path) > 1) {
        print_line(prefix + host + suffix + "/" + repeat_char("*", length(path) - 1));
        return;
    }

    print_line(value);
}

function render_global_inbounds_check() {
    let value = read_stdin_json();
    if (type(value) != "object")
        exit(1);

    let enabled_count = number_value(value.enabled_count);
    let wan_ip = as_string(value.wan_ip || "");
    let wan_public = number_value(value.wan_public);

    if (enabled_count == 0) {
        print_line("[OK] No enabled server inbounds");
        return;
    }

    if (wan_public == 1)
        print_line("[OK] WAN public IP: " + wan_ip);
    else if (wan_ip != "")
        print_line("[WARN] WAN IP is not public: " + wan_ip);
    else
        print_line("[WARN] WAN IP was not detected");

    let items = type(value.items) == "array" ? value.items : [];
    for (let i = 0; i < enabled_count; i++)
        render_inbound_item(type(items[i]) == "object" ? items[i] : {}, wan_ip);
}

function render_flag_line(value, key, ok_message, fail_message) {
    print_line((flag_is_one(value[key]) ? ok_message : fail_message));
}

function render_global_sing_box_check() {
    let value = object_or_empty(read_stdin_json());

    render_flag_line(value, "sing_box_installed", "\u2705 Sing-box installed", "\u274c Sing-box installed");
    render_flag_line(value, "sing_box_version_ok", "\u2705 Sing-box version is compatible (newer than 1.12.4)", "\u274c Sing-box version is not compatible (older than 1.12.4)");

    render_flag_line(value, "sing_box_service_exist", "\u2705 Sing-box service exist", "\u274c Sing-box service exist");
    render_flag_line(value, "sing_box_autostart_disabled", "\u2705 Sing-box autostart disabled", "\u274c Sing-box autostart disabled");
    render_flag_line(value, "sing_box_process_running", "\u2705 Sing-box process running", "\u274c Sing-box process running");
    render_flag_line(value, "sing_box_ports_listening", "\u2705 Sing-box listening ports", "\u274c Sing-box listening ports");
}

function render_global_system_info() {
    let value = object_or_empty(read_stdin_json());
    let forkop_version = object_value(value, "forkop_version") || "unknown";
    let luci_app_version = object_value(value, "luci_app_version") || "unknown";
    let sing_box_version = object_value(value, "sing_box_version") || "unknown";
    let zapret_version = object_value(value, "zapret_version") || "unknown";
    let zapret2_version = object_value(value, "zapret2_version") || "unknown";
    let byedpi_version = object_value(value, "byedpi_version") || "unknown";
    let openwrt_version = object_value(value, "openwrt_version") || "unknown";
    let device_model = object_value(value, "device_model") || "unknown";

    print_line("\ud83d\udd73\ufe0f Forkop:   " + forkop_version);
    print_line("\ud83d\udd73\ufe0f LuCI App:      " + luci_app_version);
    print_line("\ud83d\udce6 Sing-box:      " + sing_box_version);
    if (flag_is_one(value.zapret_installed))
        print_line("\ud83e\uddf5 Zapret:        " + zapret_version);
    if (flag_is_one(value.zapret2_installed))
        print_line("\ud83e\uddf5 Zapret2:       " + zapret2_version);
    if (flag_is_one(value.byedpi_installed))
        print_line("\ud83e\uddf5 ByeDPI:        " + byedpi_version);
    print_line("\ud83d\udedc OpenWrt:       " + openwrt_version);
    print_line("\ud83d\udedc Device:        " + device_model);
}

function render_global_fakeip_check() {
    let value = object_or_empty(read_stdin_json());
    let fakeip_address = object_value(value, "IP");

    if (flag_is_true(value.fakeip))
        print_line("\u2705 Sing-box FakeIP DNS works: " + fakeip_address);
    else
        print_line("\u274c Sing-box FakeIP DNS does NOT work");
}

function render_global_dns_check(dont_touch_dhcp) {
    let value = object_or_empty(read_stdin_json());
    let dns_server = object_value(value, "dns_server") || "unknown";
    let bootstrap_dns_server = object_value(value, "bootstrap_dns_server");
    let dump_dhcp_config = false;

    if (bootstrap_dns_server != "") {
        print_line((flag_is_one(value.bootstrap_dns_status) ? "\u2705 Bootstrap DNS: " : "\u274c Bootstrap DNS: ") + bootstrap_dns_server);
    }

    print_line((flag_is_one(value.dns_status) ? "\u2705 Main DNS: " : "\u274c Main DNS: ") + dns_server);
    print_line(flag_is_one(value.dns_on_router) ? "\u2705 DNS on router" : "\u274c DNS on router");

    if (as_string(dont_touch_dhcp) == "1") {
        print_line("\u26a0\ufe0f dont_touch_dhcp is enabled. \ud83d\udcc4 DHCP config:");
        dump_dhcp_config = true;
    }
    else if (!flag_is_one(value.dhcp_config_status)) {
        print_line("\u274c DHCP configuration differs from template. \ud83d\udcc4 DHCP config:");
        dump_dhcp_config = true;
    }
    else {
        print_line("\u2705 /etc/config/dhcp");
    }

    exit(dump_dhcp_config ? 10 : 0);
}

function render_global_nft_check() {
    let value = read_stdin_json();
    if (type(value) != "object")
        exit(1);

    render_flag_line(value, "table_exist", "\u2705 Table exist", "\u274c Table exist");
    render_flag_line(value, "rules_mangle_exist", "\u2705 Rules mangle exist", "\u274c Rules mangle exist");
    render_flag_line(value, "rules_mangle_counters", "\u2705 Rules mangle counters", "\u26a0\ufe0f  Rules mangle counters");
    render_flag_line(value, "rules_mangle_output_exist", "\u2705 Rules mangle output exist", "\u274c Rules mangle output exist");
    render_flag_line(value, "rules_mangle_output_counters", "\u2705 Rules mangle output counters", "\u26a0\ufe0f  Rules mangle output counters");
    render_flag_line(value, "rules_proxy_exist", "\u2705 Rules proxy exist", "\u274c Rules proxy exist");
    render_flag_line(value, "rules_proxy_counters", "\u2705 Rules proxy counters", "\u26a0\ufe0f  Rules proxy counters");

    if (flag_is_one(value.rules_other_mark_exist))
        print_line("\u26a0\ufe0f  Additional marking rules found:");
    else
        print_line("\u2705 No other marking rules found");
}

function global_nft_other_mark_exists() {
    let value = read_stdin_json();
    exit(type(value) == "object" && flag_is_one(value.rules_other_mark_exist) ? 0 : 1);
}

function nft_ruleset_other_mark_lines(table_name) {
    table_name = as_string(table_name);
    let in_forkop_table = false;

    for (let line in split(read_stdin(), "\n")) {
        line = as_string(line);
        if (index(line, "table inet " + table_name) >= 0) {
            in_forkop_table = true;
            continue;
        }

        if (match(line, /^table/) != null)
            in_forkop_table = false;

        if (!in_forkop_table && (index(line, "mark set") >= 0 || index(line, "meta mark") >= 0))
            print_line(line);
    }
}

let masked_sing_box_keys = {
    auth_key: true,
    control_url: true,
    exit_node: true,
    hostname: true,
    listen: true,
    listen_port: true,
    username: true,
    uuid: true,
    server: true,
    server_name: true,
    secret: true,
    password: true,
    private_key: true,
    public_key: true,
    short_id: true,
    fingerprint: true,
    server_port: true,
    server_ports: true,
    advertise_routes: true,
    domain: true,
    domain_suffix: true,
    domain_keyword: true,
    domain_regex: true,
    ip_cidr: true,
    source_ip_cidr: true
};

function mask_sing_box_value(value) {
    if (type(value) == "array") {
        let result = [];
        for (let item in value)
            push(result, mask_sing_box_value(item));
        return result;
    }

    if (type(value) == "object") {
        let result = {};
        for (let key, item in value)
            result[key] = masked_sing_box_keys[key] ? "MASKED" : mask_sing_box_value(item);
        return result;
    }

    return value;
}

function mask_sing_box_config(path) {
    write_json(mask_sing_box_value(read_json_file(path)));
}

function rule_references_rule_set(rule, tags) {
    if (type(rule) != "object")
        return false;

    for (let nested in array_or_empty(rule.rules))
        if (rule_references_rule_set(nested, tags))
            return true;

    let referenced = type(rule.rule_set) == "array" ? rule.rule_set : [ rule.rule_set ];
    for (let tag in referenced)
        if (tag != null && tags[as_string(tag)])
            return true;
    return false;
}

function drop_rules_for_rule_sets(rules, tags) {
    let result = [];
    for (let rule in array_or_empty(rules))
        if (!rule_references_rule_set(rule, tags))
            push(result, rule);
    return result;
}

// The check runs with a fresh cache file, so remote rule-sets would have to be
// downloaded again. That download resolves its host through the FakeIP rules
// of the very configuration under test and then dials 198.18.0.0/15 without
// TPROXY, which fails rule-set initialization before the proxy is ever
// reached. The proxy check does not match traffic, so remote rule-sets and the
// rules referencing them are dropped from the temporary configuration.
function strip_remote_rule_sets(config) {
    let kept = [];
    let removed = {};
    for (let rule_set in array_or_empty(config.route && config.route.rule_set)) {
        if (type(rule_set) == "object" && as_string(rule_set.type) == "remote")
            removed[as_string(rule_set.tag)] = true;
        else
            push(kept, rule_set);
    }

    if (type(config.route) == "object") {
        config.route.rule_set = kept;
        config.route.rules = drop_rules_for_rule_sets(config.route.rules, removed);
    }
    if (type(config.dns) == "object")
        config.dns.rules = drop_rules_for_rule_sets(config.dns.rules, removed);
}

function prepare_check_proxy_config(input_path, output_path, cache_path) {
    let config = object_or_empty(read_json_file(input_path));
    config.inbounds = [];
    config.services = [];
    if (type(config.experimental) == "object") {
        if (type(config.experimental.cache_file) == "object")
            config.experimental.cache_file.path = as_string(cache_path);
        delete config.experimental.clash_api;
    }
    strip_remote_rule_sets(config);

    if (!write_json_file(output_path, config))
        exit(1);
}

// A single domain is generated as a plain string, so the matcher accepts both
// shapes. Missing the rule would send the check through the default outbound
// and report the router address instead of the proxy address.
function rule_matches_domain(rule, domain) {
    if (type(rule.domain) == "array")
        return contains(rule.domain, domain);
    return rule.domain != null && as_string(rule.domain) == as_string(domain);
}

function check_proxy_outbound_tag(config_path, domain) {
    let config = object_or_empty(read_json_file(config_path));
    for (let rule in array_or_empty(config.route && config.route.rules)) {
        if (type(rule) != "object")
            continue;
        if (rule_matches_domain(rule, domain)) {
            print_line(as_string(rule.outbound || ""));
            return;
        }
    }
}

let mode = ARGV[0];

if (mode == "proxy-response-ip-mask")
    render_proxy_response_ip_mask();
else if (mode == "stdin-first-line-last-field")
    stdin_first_line_last_field();
else if (mode == "stdin-first-line")
    stdin_first_line();
else if (mode == "public-host-flags")
    public_host_flags(ARGV[1], ARGV[2], ARGV[3], ARGV[4]);
else if (mode == "stdin-contains")
    stdin_contains(ARGV[1]);
else if (mode == "network-endpoint-host-warnings")
    network_endpoint_host_warnings(ARGV[1]);
else if (mode == "network-wireguard-route-allowed-peers")
    network_wireguard_route_allowed_peers();
else if (mode == "wan-config-masked")
    wan_config_masked(ARGV[1]);
else if (mode == "forkop-config-masked")
    forkop_config_masked(ARGV[1]);
else if (mode == "dhcp-dnsmasq-config")
    dhcp_dnsmasq_config(ARGV[1]);
else if (mode == "firewall-required-protocols-open")
    exit(firewall_required_protocols_open(ARGV[1], ARGV[2]) ? 0 : 1);
else if (mode == "server-required-inbound-proto")
    server_required_inbound_proto(ARGV[1], ARGV[2]);
else if (mode == "server-listen-requires-firewall")
    exit(server_listen_requires_firewall(ARGV[1], ARGV[2], ARGV[3]) ? 0 : 1);
else if (mode == "server-required-ports-listening")
    exit(server_required_ports_listening(ARGV[1], ARGV[2], ARGV[3]) ? 0 : 1);
else if (mode == "server-required-port-conflict-owners")
    server_required_port_conflict_owners(ARGV[1], ARGV[2], ARGV[3]);
else if (mode == "inbound-item-json")
    write_inbound_item_json(slice(ARGV, 1));
else if (mode == "service-status-json")
    write_service_status_json(ARGV[1], ARGV[2], ARGV[3], ARGV[4]);
else if (mode == "service-list-instance-running")
    service_list_instance_running(ARGV[1]);
else if (mode == "mask-dns-server")
    mask_dns_server(ARGV[1]);
else if (mode == "global-inbounds-check")
    render_global_inbounds_check();
else if (mode == "global-sing-box-check")
    render_global_sing_box_check();
else if (mode == "global-system-info")
    render_global_system_info();
else if (mode == "global-fakeip-check")
    render_global_fakeip_check();
else if (mode == "global-dns-check")
    render_global_dns_check(ARGV[1]);
else if (mode == "global-nft-check")
    render_global_nft_check();
else if (mode == "global-nft-other-mark-exists")
    global_nft_other_mark_exists();
else if (mode == "nft-ruleset-other-mark-lines")
    nft_ruleset_other_mark_lines(ARGV[1]);
else if (mode == "nft-chain-counter-status")
    nft_chain_counter_status();
else if (mode == "mask-sing-box-config")
    mask_sing_box_config(ARGV[1]);
else if (mode == "proxy-response-is-retryable-error")
    exit(proxy_response_is_retryable_error() ? 0 : 1);
else if (mode == "prepare-check-proxy-config")
    prepare_check_proxy_config(ARGV[1], ARGV[2], ARGV[3]);
else if (mode == "check-proxy-outbound-tag")
    check_proxy_outbound_tag(ARGV[1], ARGV[2]);
else {
    warn("Usage: diagnostics/status.uc <operation> ...\n");
    exit(1);
}
