#!/usr/bin/env ucode

let common = require("core.common");
let core_ip = require("core.ip");
let runtime_constants = require("singbox.constants");
let runtime_url = require("core.url");
let domain_config = require("config.domain");

let as_string = common.as_string;
let bool_option = common.bool_option;
let list_option = common.list_option;
let option = common.option;

const DNS_URI_TYPES = {
    udp: "udp",
    tcp: "tcp",
    tls: "tls",
    https: "https",
    quic: "quic",
    h3: "h3"
};

const DNS_URI_DEFAULT_PORTS = {
    udp: 53,
    tcp: 53,
    tls: 853,
    https: 443,
    quic: 853,
    h3: 443
};

function server_list(settings, key, fallback) {
    let result = [];
    for (let value in list_option(settings, key)) {
        value = trim(as_string(value));
        if (value != "")
            push(result, value);
    }
    if (length(result) == 0)
        push(result, fallback);
    return result;
}

function detour_tag(settings) {
    if (!bool_option(settings, "dns_detour_enabled", false))
        return "";
    let section_name = option(settings, "dns_detour_section", "");
    return section_name == "" ? "" : runtime_constants.outbound_tag(section_name);
}

function dns_domain_valid(value) {
    value = lc(as_string(value));
    if (value == "" || length(value) > 253 || index(value, ".") < 1 ||
        substr(value, 0, 1) == "." || substr(value, length(value) - 1, 1) == ".")
        return false;

    let labels = split(value, ".");
    for (let label in labels)
        if (label == "" || length(label) > 63 ||
            match(label, /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/) == null)
            return false;

    let tld = labels[length(labels) - 1];
    return match(tld, /^[a-z]{2,}$/) != null || match(tld, /^xn--[a-z0-9-]{2,59}$/) != null;
}

function parse_server_uri(value, ip_only) {
    value = trim(as_string(value));
    if (value == "")
        return { unsupported: "DNS server address is empty" };
    if (match(value, /[ \t\r\n@?#]/) != null)
        return { unsupported: "DNS server URI must not contain whitespace, credentials, query parameters, or fragments" };

    let scheme = runtime_url.scheme(value);
    if (scheme == "")
        scheme = "udp";
    if (DNS_URI_TYPES[scheme] == null)
        return { unsupported: "unsupported DNS server URI scheme '" + scheme + "'" };

    let server = runtime_url.host(value);
    if (!core_ip.valid_ip(server)) {
        let ascii_server = domain_config.suffix_to_ascii(server);
        if (ascii_server == null || !dns_domain_valid(ascii_server))
            return { unsupported: "invalid DNS server host '" + server + "'" };
        server = ascii_server;
    }
    if (ip_only && !core_ip.valid_ip(server))
        return { unsupported: "Bootstrap DNS server must use an IP address" };

    let port = runtime_url.port(value);
    if (port != "" && (match(port, /^[0-9]+$/) == null || int(port) < 1 || int(port) > 65535))
        return { unsupported: "invalid DNS server port '" + port + "'" };

    let path = runtime_url.path(value);
    if (path != "" && scheme != "https" && scheme != "h3")
        return { unsupported: "DNS server paths are supported only for https:// and h3://" };

    return {
        type: DNS_URI_TYPES[scheme],
        server,
        server_port: port != "" ? int(port, 10) : DNS_URI_DEFAULT_PORTS[scheme],
        path
    };
}

function server_from_uri(tag_name, value, detour, ip_only) {
    let parsed = parse_server_uri(value, ip_only);
    if (parsed.unsupported)
        return parsed;

    let result = {
        type: parsed.type,
        tag: tag_name,
        server: parsed.server,
        server_port: parsed.server_port
    };
    if (parsed.path != "")
        result.path = parsed.path;
    if (!core_ip.valid_ip(parsed.server))
        result.domain_resolver = runtime_constants.BOOTSTRAP_DNS_SERVER_TAG;
    if (as_string(detour) != "")
        result.detour = as_string(detour);
    return result;
}

function uri_from_legacy_options(dns_type, value) {
    let scheme = dns_type == "doh" ? "https" : (dns_type == "dot" ? "tls" : (dns_type == "udp" ? "udp" : ""));
    if (scheme == "")
        return as_string(value);

    let server = runtime_url.host(value);
    let port = runtime_url.port(value);
    let authority = index(server, ":") >= 0 ? "[" + server + "]" : server;
    if (port != "")
        authority += ":" + port;

    let path = scheme == "https" ? runtime_url.path(value) : "";
    return scheme + "://" + authority + path;
}

function server_from_options(tag_name, dns_type, dns_server, detour) {
    let uri = uri_from_legacy_options(dns_type, dns_server);
    if (uri == as_string(dns_server) && dns_type != "udp" && dns_type != "dot" && dns_type != "doh")
        return { unsupported: "unsupported dns_type " + dns_type };
    return server_from_uri(tag_name, uri, detour, false);
}

function bootstrap_server(tag_name, value) {
    return server_from_uri(tag_name, value, "", true);
}

function add_server_group(result, values, canonical_tag, strategy, create_server) {
    if (length(values) == 1) {
        let server = create_server(canonical_tag, values[0]);
        if (server.unsupported)
            return server.unsupported;
        push(result, server);
        return "";
    }

    let tags = [];
    for (let i = 0; i < length(values); i++) {
        let tag_name = canonical_tag + "-" + as_string(i + 1);
        let server = create_server(tag_name, values[i]);
        if (server.unsupported)
            return server.unsupported;
        push(result, server);
        push(tags, tag_name);
    }
    push(result, {
        type: "fallback",
        tag: canonical_tag,
        servers: tags,
        strategy
    });
    return "";
}

function add_uri_server_group(result, values, canonical_tag, strategy, detour, ip_only) {
    return add_server_group(result, values, canonical_tag, strategy, function(tag_name, value) {
        return server_from_uri(tag_name, value, detour, ip_only);
    });
}

function config(settings) {
    let servers = [];
    let main_strategy = option(settings, "dns_main_fallback_strategy", "parallel");
    let bootstrap_strategy = option(settings, "dns_bootstrap_fallback_strategy", "parallel");
    let bootstrap_values = server_list(settings, "bootstrap_dns_server", "77.88.8.8");
    let main_values = server_list(settings, "dns_server", "77.88.8.8");
    let detour = detour_tag(settings);

    let unsupported = add_uri_server_group(
        servers,
        bootstrap_values,
        runtime_constants.BOOTSTRAP_DNS_SERVER_TAG,
        bootstrap_strategy,
        "",
        true
    );
    if (unsupported != "")
        return { unsupported };

    unsupported = add_uri_server_group(
        servers,
        main_values,
        runtime_constants.DNS_SERVER_TAG,
        main_strategy,
        detour,
        false
    );
    if (unsupported != "")
        return { unsupported };

    return { servers };
}

function default_domain_resolver(settings) {
    return bool_option(settings, "dns_detour_enabled", false)
        ? runtime_constants.BOOTSTRAP_DNS_SERVER_TAG
        : runtime_constants.DNS_SERVER_TAG;
}

return {
    add_uri_server_group,
    bootstrap_server,
    config,
    default_domain_resolver,
    detour_tag,
    parse_server_uri,
    server_from_options,
    server_from_uri,
    uri_from_legacy_options,
    server_list
};
