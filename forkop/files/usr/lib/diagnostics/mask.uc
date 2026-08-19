// Redaction of everything Forkop shows back to the user: UCI configuration,
// the generated sing-box configuration, DNS server URLs and the address a
// proxy check reports. Diagnostics output is pasted into issue reports, so
// every value that identifies a subscriber or a credential is hidden here
// before it can be printed.

let core_url = require("core.url");

function as_string(value) {
    return value == null ? "" : "" + value;
}

function ends_with(value, suffix) {
    value = as_string(value);
    suffix = as_string(suffix);
    return length(value) >= length(suffix) && substr(value, length(value) - length(suffix)) == suffix;
}

function is_space_char(value) {
    return value == " " || value == "\t" || value == "\r" || value == "\n";
}

// Replaces the whole remainder of the line, quotes included.
function mask_after_token(line, token) {
    let pos = index(line, token);
    return pos < 0 ? line : substr(line, 0, pos) + token + " 'MASKED'";
}

// Same, but only when the option name is followed by a separator, so that
// "option port" does not also match "option portal".
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

// Keeps the scheme and host of a DNS URL but hides the path that identifies
// the account.
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

// Keep in sync with maskForkopConfigLine() in
// fe-app-forkop/src/forkop/tabs/diagnostic/helpers/maskDiagnostics.ts, which
// masks the copy the browser downloads.
function forkop_config_line(line) {
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
    line = mask_after_token(line, "option shadowsocks_psk");
    // Credentials of a server client section.
    line = mask_after_token(line, "option uuid");
    line = mask_after_token(line, "option password");
    line = mask_after_token(line, "option secret");
    line = mask_after_token_space(line, "list authorized_keys");
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

// Splits configuration text into the lines a report prints. A file that ends
// with a newline must not gain a trailing empty line.
function config_lines(data) {
    data = as_string(data);
    let lines = split(data, "\n");
    if (length(lines) > 0 && lines[length(lines) - 1] == "" && substr(data, length(data) - 1) == "\n")
        lines = slice(lines, 0, length(lines) - 1);
    return lines;
}

function lines_text(lines) {
    return length(lines) == 0 ? "" : join("\n", lines) + "\n";
}

function forkop_config(data) {
    let result = [];
    let in_masked_multiline = false;

    for (let line in config_lines(data)) {
        line = as_string(line);

        // A masked JSON option can span several lines; the continuation lines
        // are dropped up to the closing quote instead of being printed raw.
        if (in_masked_multiline) {
            if (index(line, "'") >= 0)
                in_masked_multiline = false;
            continue;
        }

        if (delete_token_space(line, "option tailscale_ephemeral") ||
            delete_token_space(line, "option tailscale_exit_node") ||
            delete_token_space(line, "option tailscale_exit_node_allow_lan_access"))
            continue;

        push(result, forkop_config_line(line));
        if (index(line, "option outbound_json") >= 0 || index(line, "option endpoint_json") >= 0) {
            let first_quote = index(line, "'");
            if (first_quote >= 0 && index(substr(line, first_quote + 1), "'") < 0)
                in_masked_multiline = true;
        }
    }

    return lines_text(result);
}

// Only the WAN interface is reported, and only the fields that identify the
// subscriber are hidden; the rest is needed to judge the routing setup.
function wan_config(data) {
    let result = [];
    let in_wan = false;
    let proto = "";

    for (let line in config_lines(data)) {
        let fields = split(trim(as_string(line)), /[ \t\r\n]+/);
        if (length(fields) > 0 && fields[0] == "config") {
            in_wan = length(fields) >= 3 && fields[1] == "interface" && fields[2] == "'wan'";
            proto = "";
        }

        if (!in_wan)
            continue;

        if (length(fields) >= 3 && fields[0] == "option" && fields[1] == "proto") {
            proto = fields[2];
            push(result, line);
        }
        else if (proto == "'static'" && length(fields) >= 2 && fields[0] == "option" &&
            (fields[1] == "ipaddr" || fields[1] == "netmask" || fields[1] == "gateway")) {
            push(result, "        option " + fields[1] + " '******'");
        }
        else if (proto == "'pppoe'" && length(fields) >= 2 && fields[0] == "option" &&
            (fields[1] == "username" || fields[1] == "password")) {
            push(result, "        option " + fields[1] + " '******'");
        }
        else if (proto == "'wireguard'" && length(fields) >= 2 && fields[0] == "option" &&
            fields[1] == "private_key") {
            push(result, "        option private_key '******'");
        }
        else {
            push(result, line);
        }
    }

    return lines_text(result);
}

const SING_BOX_MASKED_KEYS = {
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

function sing_box_config(value) {
    if (type(value) == "array") {
        let result = [];
        for (let item in value)
            push(result, sing_box_config(item));
        return result;
    }

    if (type(value) == "object") {
        let result = {};
        for (let key, item in value)
            result[key] = SING_BOX_MASKED_KEYS[key] ? "MASKED" : sing_box_config(item);
        return result;
    }

    return value;
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

// A NextDNS profile id is a credential: it is either the leftmost label of the
// host or the URL path. Other DNS servers carry no account and stay readable.
function dns_server(value) {
    value = as_string(value);
    let scheme = core_url.scheme(value);
    let prefix = scheme == "" ? "" : scheme + "://";
    let host = core_url.host(value);
    let port = core_url.port(value);
    let suffix = port == "" ? "" : ":" + port;
    let path = core_url.path(value);

    if (ends_with(host, ".dns.nextdns.io")) {
        let nextdns_id = first_field(host, ".");
        return prefix + repeat_char("*", length(nextdns_id)) + ".dns.nextdns.io" + suffix + path;
    }

    if (host == "dns.nextdns.io" && length(path) > 1)
        return prefix + host + suffix + "/" + repeat_char("*", length(path) - 1);

    return value;
}

function ipv6_line(line) {
    let matched = match(line, /([0-9a-fA-F]+:[0-9a-fA-F]+:[0-9a-fA-F]+):.*/);
    return matched ? matched[1] + ":XXXX:XXXX:XXXX" : line;
}

// The proxy check has to prove the exit address changed without publishing it,
// so only the last IPv4 octet or the first three IPv6 hextets survive. Returns
// null when the response carries no address at all.
function proxy_response_ip(response) {
    response = as_string(response);
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

    if (length(ipv4_lines) > 0)
        return join("\n", ipv4_lines);

    if (!ipv6_like)
        return null;

    let masked = [];
    for (let i = 0; i < length(lines); i++) {
        if (i == length(lines) - 1 && lines[i] == "")
            continue;
        push(masked, ipv6_line(lines[i]));
    }
    return join("\n", masked);
}

// A proxy that answers with an HTML error page or a bare 403 has not failed
// permanently; the check retries instead of reporting the page as an address.
function proxy_response_is_retryable_error(response) {
    response = as_string(response);
    return index(response, "<html") == 0 || index(response, "403 Forbidden") >= 0;
}

return {
    forkop_config_line,
    forkop_config,
    wan_config,
    config_lines,
    lines_text,
    sing_box_config,
    dns_server,
    proxy_response_ip,
    proxy_response_is_retryable_error
};
