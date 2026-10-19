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

// The options whose value can span several lines: JSON, and the certificates
// and keys of an OpenVPN server and its clients and of a TLS server.
const MULTILINE_OPTIONS = [ "option outbound_json", "list outbound_jsons", "option endpoint_json", "option inbound_json",
    "option openvpn_certificate", "option openvpn_key", "option openvpn_tls_crypt_key",
    "option tls_certificate", "option tls_key", "option tls_self_signed_certificate", "option tls_self_signed_key" ];

function forkop_config_line(line) {
    line = mask_after_token(line, "option proxy_string");
    line = mask_after_token(line, "option hwid");
    line = mask_after_token(line, "list header");
    line = mask_after_token(line, "option subscription_url");
    line = mask_after_token(line, "list subscription_urls");
    line = mask_after_token(line, "list urltest_proxy_links");
    line = mask_after_token(line, "list selector_proxy_links");
    line = mask_after_token_space(line, "option uri");
    for (let token in MULTILINE_OPTIONS)
        line = mask_after_token_space(line, token);
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
    line = mask_after_token_space(line, "option amnezia_header_protection_key");
    line = mask_after_token_space(line, "option wireguard_private_key");
    line = mask_after_token_space(line, "option wireguard_public_key");
    line = mask_after_token_space(line, "option wireguard_pre_shared_key");
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
    line = mask_after_token(line, "option yacd_secret_key");
    line = mask_after_token(line, "option native_api_secret");

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

        // A masked option can span several lines; the continuation lines
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
        if (length(filter(MULTILINE_OPTIONS, (token) => delete_token_space(line, token))) > 0) {
            let first_quote = index(line, "'");
            if (first_quote >= 0 && index(substr(line, first_quote + 1), "'") < 0)
                in_masked_multiline = true;
        }
    }

    return lines_text(result);
}

// What identifies the subscriber or opens the uplink, whatever the protocol:
// PPPoE, L2TP and PPTP accounts, a modem's PIN, a WireGuard key, and the
// addresses and hardware address of the line.
const WAN_MASKED_OPTIONS = {
    username: true, password: true, pincode: true, private_key: true, macaddr: true,
    ipaddr: true, netmask: true, gateway: true, ip6addr: true, ip6gw: true, ip6prefix: true,
    peeraddr: true, server: true
};

// Only the WAN interface is reported, and only the fields that identify the
// subscriber are hidden; the rest is needed to judge the routing setup.
function wan_config(data) {
    let result = [];
    let in_wan = false;

    for (let line in config_lines(data)) {
        let fields = split(trim(as_string(line)), /[ \t\r\n]+/);
        if (length(fields) > 0 && fields[0] == "config")
            in_wan = length(fields) >= 3 && fields[1] == "interface" && fields[2] == "'wan'";

        if (in_wan && length(fields) >= 2 && (fields[0] == "option" || fields[0] == "list") && WAN_MASKED_OPTIONS[fields[1]])
            push(result, "        " + fields[0] + " " + fields[1] + " '******'");
        else if (in_wan)
            push(result, line);
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
    psk: true,
    userkey: true,
    static_key: true,
    key: true,
    client_key: true,
    certificate: true,
    client_certificate: true,
    peer_fingerprint: true,
    cookie: true,
    token: true,
    address: true,
    port: true,
    allowed_ips: true,
    pre_shared_key: true,
    reserved: true,
    id: true,
    auth_token: true,
    license_key: true,
    link: true,
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
    source_ip_cidr: true,
    headers: true
};

// The path of a DNS over HTTPS server can carry the account: AdGuard's private
// /dns-query/<id>, ControlD's /<id>. The endpoints every resolver shares stay.
function doh_path(path) {
    path = as_string(path);
    if (path == "" || path == "/" || path == "/dns-query" || path == "/resolve")
        return path;
    return substr(path, 0, 11) == "/dns-query/" ? "/dns-query/MASKED" : "/MASKED";
}

function mask_sing_box_value(value) {
    if (type(value) == "array")
        return map(value, mask_sing_box_value);
    if (type(value) != "object")
        return value;
    let result = {};
    for (let key, item in value)
        result[key] = SING_BOX_MASKED_KEYS[key] ? "MASKED" : mask_sing_box_value(item);
    return result;
}

// A subscription URL carries the subscriber's token, and a URL is only masked
// where it is one: a rule set's or a latency test's is public.
function sing_box_config(value) {
    let result = mask_sing_box_value(value);
    if (type(result) != "object")
        return result;
    for (let provider in (type(result.providers) == "array" ? result.providers : []))
        if (type(provider) == "object" && provider.url != null)
            provider.url = "MASKED";
    for (let server in (type(result.dns?.servers) == "array" ? result.dns.servers : []))
        if (type(server) == "object" && server.path != null)
            server.path = doh_path(server.path);
    return result;
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

// Resolvers that name the account in the leftmost label of their host for DNS
// over TLS or QUIC.
const ACCOUNT_HOST_SUFFIXES = [ ".dns.nextdns.io", ".d.adguard-dns.com", ".dns.controld.com" ];

// A private resolver's account id is a credential: the leftmost label of the
// host, or the path of a DNS over HTTPS URL. A public resolver stays readable.
function dns_server(value) {
    value = as_string(value);
    let scheme = core_url.scheme(value);
    let prefix = scheme == "" ? "" : scheme + "://";
    let host = core_url.host(value);
    let port = core_url.port(value);
    let suffix = port == "" ? "" : ":" + port;
    let path = core_url.path(value);

    for (let ending in ACCOUNT_HOST_SUFFIXES)
        if (ends_with(host, ending))
            host = repeat_char("*", length(first_field(host, "."))) + ending;
    let masked_path = host == "dns.nextdns.io" && length(path) > 1 ? "/" + repeat_char("*", length(path) - 1) : doh_path(path);
    return host == core_url.host(value) && masked_path == path ? value : prefix + host + suffix + masked_path;
}

// The first three hextets of an IPv6 address - the provider's allocation, not
// the subscriber - however the address is written.
function masked_ipv6(address) {
    let bytes = iptoarr(address);
    if (bytes == null || length(bytes) != 16)
        return null;
    return sprintf("%x:%x:%x:XXXX:XXXX:XXXX:XXXX:XXXX", bytes[0] << 8 | bytes[1], bytes[2] << 8 | bytes[3], bytes[4] << 8 | bytes[5]);
}

// The proxy check has to prove the exit address changed without publishing it,
// so only the last IPv4 octet or the first three IPv6 hextets survive. The
// public endpoint answers with JSON, a plain address service with a bare
// address. Returns null when the response carries no address at all.
function proxy_response_ip(response) {
    let result = [];
    for (let line in split(as_string(response), "\n")) {
        let address = match(line, /"IP"[[:space:]]*:[[:space:]]*"([^"]+)"/)?.[1] ?? trim(line);
        let v4 = match(address, /^[0-9]+\.[0-9]+\.[0-9]+\.([0-9]+)$/);
        let v6 = index(address, ":") >= 0 ? masked_ipv6(address) : null;
        if (v4 != null)
            push(result, "X.X.X." + v4[1]);
        else if (v6 != null)
            push(result, v6);
    }
    return length(result) > 0 ? join("\n", result) : null;
}

// A proxy that answers with an HTML error page or a bare 403 has not failed
// permanently; the check retries instead of reporting the page as an address.
function proxy_response_is_retryable_error(response) {
    response = as_string(response);
    return index(response, "<html") == 0 || index(response, "403 Forbidden") >= 0;
}

return {
    forkop_config,
    wan_config,
    config_lines,
    sing_box_config,
    dns_server,
    proxy_response_ip,
    proxy_response_is_retryable_error
};
