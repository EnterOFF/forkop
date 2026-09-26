#!/usr/bin/env ucode

let common = require("core.common");
let runtime_constants = require("singbox.constants");
let connections = require("config.connections");

let as_string = common.as_string;
let option = common.option;
let list_option = common.list_option;
let bool_option = common.bool_option;
let int_option = common.int_option;
let array_or_empty = common.array_or_empty;

// What every layer of the server side has to agree on: which credential fields a
// protocol asks a client for, which protocols use the client name as the account
// name on the wire, and which Shadowsocks methods take a base64 key of an exact
// length instead of a password. The generator, the runtime validator and the
// service preparation all read these from here.
const CLIENT_FIELDS = {
    vless: [ "uuid" ],
    vmess: [ "uuid" ],
    trojan: [ "password" ],
    shadowsocks: [ "password" ],
    hysteria2: [ "password" ],
    tuic: [ "uuid", "password" ],
    anytls: [ "password" ],
    mixed: [ "password" ],
    naive: [ "password" ],
    ssh: [ "password" ],
    mieru: [ "password" ],
    mtproto: [ "secret" ],
    tailscale: [],
    json_inbound: []
};
const LOGIN_NAME_PROTOCOLS = { mixed: true, naive: true, ssh: true, mieru: true };
const SHADOWSOCKS_2022_KEY_BYTES = {
    "2022-blake3-aes-128-gcm": 16,
    "2022-blake3-aes-256-gcm": 32,
    "2022-blake3-chacha20-poly1305": 32
};

function shadowsocks_2022_method(method) {
    return SHADOWSOCKS_2022_KEY_BYTES[as_string(method)] != null;
}

function safe_filename(value) {
    value = as_string(value);
    let result = "";
    for (let i = 0; i < length(value); i++) {
        let ch = substr(value, i, 1);
        result += match(ch, /^[A-Za-z0-9_.-]$/) ? ch : "_";
    }
    return result;
}

function string_to_hex(value) {
    value = as_string(value);
    let result = "";
    for (let i = 0; i < length(value); i++)
        result += sprintf("%02x", ord(substr(value, i, 1)));
    return result;
}

// The proxy accepts nothing but a FakeTLS secret: the first byte has to be 0xee,
// the key follows, and the host after it cannot be empty. A bare secret is refused
// by the core, so the camouflage host is part of what makes a secret at all.
function mtproto_client_secret(section, client) {
    let secret = lc(option(client, "secret", ""));
    let faketls = option(section, "mtproto_faketls", "");
    if (substr(secret, 0, 2) == "ee")
        return secret;
    return "ee" + secret + string_to_hex(faketls);
}


function client_user(section, protocol, client) {
    let name = option(client, "name", client[".name"]);
    if (name == "")
        name = client[".name"];

    if (protocol == "vless") {
        let user = { name, uuid: option(client, "uuid", "") };
        let flow = option(client, "flow", "");
        if (flow != "" && flow != "none")
            user.flow = flow;
        return user;
    }
    if (protocol == "vmess")
        return { name, uuid: option(client, "uuid", ""), alterId: 0 };
    if (protocol == "trojan" || protocol == "hysteria2" || protocol == "anytls" ||
        protocol == "mieru" || protocol == "shadowsocks")
        // A 2022 inbound holds the server key of its own and every account carries
        // just its own key here. The two joined belong in the link a client reads,
        // not in the user list, where sing-box decodes this field on its own.
        return { name, password: option(client, "password", "") };
    if (protocol == "mixed" || protocol == "naive")
        return { username: name, password: option(client, "password", "") };
    if (protocol == "ssh") {
        let user = { name };
        let password = option(client, "password", "");
        if (password != "")
            user.password = password;
        let authorized_keys = list_option(client, "authorized_keys");
        if (length(authorized_keys) > 0)
            user.authorized_keys = authorized_keys;
        return user;
    }
    if (protocol == "tuic")
        return { name, uuid: option(client, "uuid", ""), password: option(client, "password", "") };
    if (protocol == "mtproto")
        return { name, secret: mtproto_client_secret(section, client) };
    return null;
}

function users(section, protocol) {
    let result = [];
    for (let client in connections.server_clients(section)) {
        let user = client_user(section, protocol, client);
        if (user != null)
            push(result, user);
    }
    return result;
}

function effective_security(section, protocol) {
    let security = option(section, "security", "");
    if (security == "") {
        if (protocol == "vless")
            security = "reality";
        else if (protocol == "trojan" || protocol == "hysteria2" || protocol == "naive" ||
            protocol == "anytls" || protocol == "tuic")
            security = "tls";
        else
            security = "none";
    }

    if (protocol == "shadowsocks" || protocol == "mixed" || protocol == "ssh" || protocol == "mieru" || protocol == "mtproto" ||
        protocol == "tailscale" || protocol == "json_inbound")
        return "none";
    if (protocol == "hysteria2" || protocol == "naive" || protocol == "anytls" || protocol == "tuic")
        return "tls";
    if ((protocol == "vmess" || protocol == "trojan") && security == "reality")
        return protocol == "trojan" ? "tls" : "none";
    return security;
}

function maybe_string(object, key, value) {
    value = as_string(value);
    if (value != "")
        object[key] = value;
}

function apply_tls(inbound, section, protocol) {
    let security = effective_security(section, protocol);
    if (security == "" || security == "none")
        return;

    let tls = { enabled: true };
    maybe_string(tls, "server_name", option(section, "tls_server_name", ""));
    let alpn = list_option(section, "tls_alpn");
    if (length(alpn) > 0)
        tls.alpn = alpn;

    if (security == "tls") {
        let safe_name = safe_filename(section[".name"]);
        maybe_string(tls, "certificate_path",
            option(section, "tls_certificate_path", "/etc/forkop/server-certs/" + safe_name + ".crt"));
        maybe_string(tls, "key_path",
            option(section, "tls_key_path", "/etc/forkop/server-certs/" + safe_name + ".key"));
    }
    else if (security == "reality") {
        // The SNI is what a client sends and the handshake target is where the
        // listener goes to borrow a certificate for exactly that name, so the two
        // are the same site: a target answering for another name hands a prober a
        // certificate that does not match the name it asked for. One field names
        // the site and the handshake goes to it on the port a site serves TLS on.
        let reality = {
            enabled: true,
            handshake: {
                server: option(section, "tls_server_name", ""),
                server_port: 443
            },
            private_key: option(section, "reality_private_key", "")
        };
        let short_id = list_option(section, "reality_short_id");
        if (length(short_id) > 0)
            reality.short_id = short_id;
        tls.reality = reality;
    }

    inbound.tls = tls;
}

function apply_transport(inbound, section, protocol) {
    if (protocol != "vless" && protocol != "vmess" && protocol != "trojan")
        return;

    let transport_type = option(section, "transport", "tcp");
    if (transport_type == "" || transport_type == "tcp" || transport_type == "raw")
        return;

    let transport = { type: transport_type };
    let path = option(section, "transport_path", "");
    let host = option(section, "transport_host", "");
    if (transport_type == "ws") {
        maybe_string(transport, "path", path);
        if (host != "")
            transport.headers = { Host: host };
    }
    else if (transport_type == "grpc") {
        maybe_string(transport, "service_name", option(section, "transport_service_name", ""));
    }
    else if (transport_type == "http") {
        maybe_string(transport, "path", path);
        let hosts = list_option(section, "transport_hosts");
        if (length(hosts) > 0)
            transport.host = hosts;
    }
    else if (transport_type == "httpupgrade") {
        maybe_string(transport, "path", path);
        maybe_string(transport, "host", host);
    }
    else if (transport_type == "xhttp") {
        transport.mode = option(section, "transport_xhttp_mode", "auto");
        transport.path = path != "" ? path : "/";
        maybe_string(transport, "host", host);
        // The only field the core has no default for: x_padding_bytes is a value, not
        // a pointer, and a zero range is refused with "x_padding_bytes cannot be
        // disabled". Everything else the mode needs it fills in itself.
        transport.x_padding_bytes = "100-1000";
    }
    else {
        return;
    }

    inbound.transport = transport;
}

// Multiplexing is accepted, never required: a client that does not use it keeps
// working, and TCP Brutal only takes effect when both sides load the module.
function apply_multiplex(inbound, section, protocol) {
    if (protocol != "vless" && protocol != "vmess" && protocol != "trojan" && protocol != "shadowsocks")
        return;
    if (!bool_option(section, "multiplex_enabled", false))
        return;

    let multiplex = { enabled: true };
    if (bool_option(section, "multiplex_padding", false))
        multiplex.padding = true;

    inbound.multiplex = multiplex;
}

function add_standard_inbound(config, section, protocol, tag_name) {
    let inbound = {
        type: protocol,
        tag: tag_name,
        listen: option(section, "listen", "0.0.0.0"),
        listen_port: int_option(section, "listen_port", "443")
    };

    if (protocol == "shadowsocks") {
        let method = option(section, "shadowsocks_method", "2022-blake3-aes-256-gcm");
        inbound.method = method;
        // A 2022 server needs its own pre-shared key next to the per client keys; the
        // older AEAD methods derive every key from the client password alone.
        if (shadowsocks_2022_method(method))
            inbound.password = option(section, "shadowsocks_psk", "");
        inbound.users = users(section, protocol);
    }
    else if (protocol == "mixed") {
        if (bool_option(section, "mixed_auth_enabled", true)) {
            let server_users = users(section, protocol);
            if (length(server_users) > 0)
                inbound.users = server_users;
        }
    }
    else if (protocol == "hysteria2") {
        inbound.users = users(section, protocol);
        if (bool_option(section, "hysteria2_ignore_client_bandwidth", false))
            inbound.ignore_client_bandwidth = true;
        let up_mbps = option(section, "hysteria2_up_mbps", "");
        let down_mbps = option(section, "hysteria2_down_mbps", "");
        if (up_mbps != "")
            inbound.up_mbps = int(up_mbps, 10);
        if (down_mbps != "")
            inbound.down_mbps = int(down_mbps, 10);
        let obfs_type = option(section, "hysteria2_obfs_type", "");
        let obfs_password = option(section, "hysteria2_obfs_password", "");
        if (obfs_type != "" && obfs_password != "")
            inbound.obfs = { type: obfs_type, password: obfs_password };
        if (obfs_type == "gecko" && inbound.obfs) {
            let minimum = option(section, "hysteria2_gecko_min_packet_size", "");
            let maximum = option(section, "hysteria2_gecko_max_packet_size", "");
            if (minimum != "") inbound.obfs.min_packet_size = int(minimum, 10);
            if (maximum != "") inbound.obfs.max_packet_size = int(maximum, 10);
        }
        maybe_string(inbound, "bbr_profile", option(section, "hysteria2_bbr_profile", ""));
        // sing-box reads a masquerade URL as a string and picks the mode from its
        // scheme, so the single form field is passed through unchanged.
        maybe_string(inbound, "masquerade", option(section, "hysteria2_masquerade", ""));
    }
    else if (protocol == "naive") {
        inbound.users = users(section, protocol);
        let network = option(section, "naive_network", "tcp");
        inbound.network = network == "tcp_udp" ? [ "tcp", "udp" ] : network;
    }
    else if (protocol == "ssh") {
        inbound.users = users(section, protocol);
        let host_key_path = list_option(section, "ssh_host_key_path");
        if (length(host_key_path) > 0)
            inbound.host_key_path = host_key_path;
    }
    else if (protocol == "mieru") {
        inbound.users = users(section, protocol);
        inbound.transport = option(section, "mieru_transport", "TCP");
    }
    else if (protocol == "anytls") {
        inbound.users = users(section, protocol);
    }
    else if (protocol == "tuic") {
        inbound.users = users(section, protocol);
        maybe_string(inbound, "congestion_control", option(section, "tuic_congestion_control", "cubic"));
        maybe_string(inbound, "heartbeat", option(section, "tuic_heartbeat", "10s"));
        if (bool_option(section, "tuic_zero_rtt_handshake", false))
            inbound.zero_rtt_handshake = true;
    }
    else if (protocol == "mtproto") {
        // The proxy is registered as mtproxy in the core; mtproto is the name this
        // tab uses. Nothing else is written: mtg supplies its own concurrency limit,
        // fronting port, address family preference and timeouts, and the secret each
        // client carries already names the domain the handshake fronts.
        inbound.type = "mtproxy";
        inbound.users = users(section, protocol);
    }
    else {
        inbound.users = users(section, protocol);
    }

    if (bool_option(section, "tcp_fast_open", false))
        inbound.tcp_fast_open = true;

    apply_tls(inbound, section, protocol);
    apply_transport(inbound, section, protocol);
    apply_multiplex(inbound, section, protocol);
    push(config.inbounds, inbound);
}

function add_json_inbound(config, section, tag_name) {
    let inbound = {};
    try {
        inbound = json(option(section, "inbound_json", ""));
    }
    catch (e) {
        inbound = {};
    }
    if (type(inbound) != "object")
        inbound = {};
    inbound.tag = tag_name;
    push(config.inbounds, inbound);
}

// The transports a listener of this protocol takes. A port can be shared by two
// servers when one takes TCP and the other UDP.
function transports(protocol, network) {
    network = lc(as_string(network));
    if (protocol == "hysteria2" || protocol == "tuic")
        return [ "udp" ];
    if (protocol == "shadowsocks" || (protocol == "naive" && network == "tcp_udp"))
        return [ "tcp", "udp" ];
    if ((protocol == "naive" || protocol == "mieru") && network == "udp")
        return [ "udp" ];
    return [ "tcp" ];
}

function listen_transports(section) {
    let protocol = option(section, "protocol", "vless");
    return transports(protocol, protocol == "naive" ? option(section, "naive_network", "tcp")
        : protocol == "mieru" ? option(section, "mieru_transport", "TCP") : "");
}

function add_tailscale_endpoint(config, section, tag_name) {
    let section_name = section[".name"];
    let endpoint = {
        type: "tailscale",
        tag: tag_name,
        state_directory: "/etc/forkop/tailscale/" + safe_filename(section_name),
        auth_key: option(section, "tailscale_auth_key", ""),
        control_url: option(section, "tailscale_control_url", "https://controlplane.tailscale.com"),
        hostname: option(section, "tailscale_hostname", "forkop-" + safe_filename(section_name)),
        // The offer does nothing until the exit node is approved in the
        // Tailscale console, so a server meant only to share subnets leaves it
        // unapproved instead of needing a switch of its own.
        advertise_exit_node: true
    };
    if (bool_option(section, "tailscale_detour_enabled", false)) {
        let detour_section = option(section, "tailscale_detour_section", "");
        if (detour_section != "")
            endpoint.detour = runtime_constants.outbound_tag(connections.section_display_name(detour_section));
    }
    if (bool_option(section, "tailscale_accept_routes", false))
        endpoint.accept_routes = true;
    if (bool_option(section, "tailscale_ephemeral", false))
        endpoint.ephemeral = true;
    // sing-box reads each as a prefix, and the dialog takes a single address too.
    let advertise_routes = map(list_option(section, "tailscale_advertise_routes"),
        (route) => index(route, "/") >= 0 ? route : route + (index(route, ":") >= 0 ? "/128" : "/32"));
    if (length(advertise_routes) > 0)
        endpoint.advertise_routes = advertise_routes;
    push(config.endpoints, endpoint);
}

function add_dns_bypass(config, section) {
    if (option(section, "protocol", "vless") != "tailscale")
        return;

    let section_name = section[".name"];
    let inbound = runtime_constants.server_inbound_tag(connections.server_display_name(section));
    let dns_tag = runtime_constants.tailscale_dns_server_tag(section_name);
    let rule_tag = "tailscale-server-dns-" + safe_filename(section_name);
    push(config.dns.servers, {
        type: "tailscale",
        tag: dns_tag,
        endpoint: inbound,
        accept_default_resolvers: true
    });
    push(config.dns.rules, {
        action: "route",
        server: dns_tag,
        inbound,
        __service_tag: rule_tag
    });
}

function add_server(config, section) {
    let section_name = section[".name"];
    let protocol = option(section, "protocol", "vless");
    let tag_name = runtime_constants.server_inbound_tag(connections.server_display_name(section));

    if (protocol == "tailscale")
        add_tailscale_endpoint(config, section, tag_name);
    else if (protocol == "json_inbound")
        add_json_inbound(config, section, tag_name);
    else
        add_standard_inbound(config, section, protocol, tag_name);
    add_dns_bypass(config, section);
}

function add_sniff_rule(config, section) {
    if (option(section, "protocol", "vless") == "tailscale")
        return;

    let rules = array_or_empty(config.route.rules);
    let rule = {
        action: "sniff",
        inbound: runtime_constants.server_inbound_tag(connections.server_display_name(section))
    };
    let insert_at = 0;
    while (insert_at < length(rules) && type(rules[insert_at]) == "object" && rules[insert_at].action == "sniff")
        insert_at++;

    let result = [];
    for (let i = 0; i < insert_at; i++)
        push(result, rules[i]);
    push(result, rule);
    for (let i = insert_at; i < length(rules); i++)
        push(result, rules[i]);
    config.route.rules = result;
}

function clone(value) {
    try {
        return json(sprintf("%J", value));
    }
    catch (e) {
        return null;
    }
}

function value_contains(value, item) {
    if (type(value) == "array") {
        for (let entry in value)
            if (entry == item)
                return true;
        return false;
    }
    return value == item;
}

// A user narrows the clones to one account of the inbound, which is what a client
// that follows the shared rules needs when its server does not.
// A section whose rule set is narrowed by ports or devices is a logical AND of
// what identifies it, which carries the inbound, and the narrowing.
function identity_rule(rule) {
    return rule.type == "logical" ? rule.rules?.[0] : rule;
}

function clone_rules_for_inbound(config, source_inbound, target_inbound, skip_domain, user) {
    let cloned_rules = [];
    for (let rule in array_or_empty(config.route.rules)) {
        if (type(rule) != "object")
            continue;
        if (rule.action != "route" && rule.action != "reject")
            continue;
        let identity = identity_rule(rule);
        if (type(identity) != "object" || !value_contains(identity.inbound, source_inbound))
            continue;
        if (skip_domain != "" && value_contains(identity.domain, skip_domain))
            continue;
        // Device filters name the router's clients, which a server's are not.
        if (length(filter(rule.type == "logical" ? rule.rules : [ rule ], (part) => part?.source_ip_cidr != null)) > 0)
            continue;

        let cloned = clone(rule);
        let cloned_identity = identity_rule(cloned);
        cloned_identity.inbound = target_inbound;
        // auth_user is what a route rule matches an account on; a user field is not
        // part of a rule and sing-box drops the whole rule that carries one.
        if (user != null && user != "")
            cloned_identity.auth_user = user;
        push(cloned_rules, cloned);
    }
    for (let cloned_rule in cloned_rules)
        push(config.route.rules, cloned_rule);
}

return {
    CLIENT_FIELDS,
    LOGIN_NAME_PROTOCOLS,
    SHADOWSOCKS_2022_KEY_BYTES,
    add_server,
    add_sniff_rule,
    clone_rules_for_inbound,
    transports,
    listen_transports,
    effective_security
};
