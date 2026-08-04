#!/usr/bin/env ucode

let common = require("core.common");
let core_ip = require("core.ip");
let runtime_constants = require("singbox.constants");
let runtime_url = require("core.url");

let as_string = common.as_string;
let bool_option = common.bool_option;
let list_option = common.list_option;
let option = common.option;

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

function server_from_options(tag_name, dns_type, dns_server, detour) {
    let server = runtime_url.host(dns_server);
    let port = runtime_url.port(dns_server);
    let result = {
        type: "udp",
        tag: tag_name,
        server,
        server_port: 53
    };

    if (dns_type == "udp") {
        if (port != "")
            result.server_port = int(port, 10);
    }
    else if (dns_type == "dot") {
        result.type = "tls";
        result.server_port = port != "" ? int(port, 10) : 853;
    }
    else if (dns_type == "doh") {
        result.type = "https";
        result.server_port = port != "" ? int(port, 10) : 443;
        let path = runtime_url.path(dns_server);
        if (path != "")
            result.path = path;
    }
    else {
        return { unsupported: "unsupported dns_type " + dns_type };
    }

    if (!core_ip.valid_ip(server))
        result.domain_resolver = runtime_constants.BOOTSTRAP_DNS_SERVER_TAG;
    if (as_string(detour) != "")
        result.detour = as_string(detour);
    return result;
}

function bootstrap_server(tag_name, value) {
    let server = runtime_url.host(value);
    let port = runtime_url.port(value);
    return {
        type: "udp",
        tag: tag_name,
        server: server != "" ? server : value,
        server_port: port != "" ? int(port, 10) : 53
    };
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

function config(settings) {
    let servers = [];
    let main_strategy = option(settings, "dns_main_fallback_strategy", "parallel");
    let bootstrap_strategy = option(settings, "dns_bootstrap_fallback_strategy", "parallel");
    let bootstrap_values = server_list(settings, "bootstrap_dns_server", "77.88.8.8");
    let main_values = server_list(settings, "dns_server", "77.88.8.8");
    let dns_type = option(settings, "dns_type", "udp");
    let detour = detour_tag(settings);

    let unsupported = add_server_group(
        servers,
        bootstrap_values,
        runtime_constants.BOOTSTRAP_DNS_SERVER_TAG,
        bootstrap_strategy,
        bootstrap_server
    );
    if (unsupported != "")
        return { unsupported };

    unsupported = add_server_group(
        servers,
        main_values,
        runtime_constants.DNS_SERVER_TAG,
        main_strategy,
        function(tag_name, value) {
            return server_from_options(tag_name, dns_type, value, detour);
        }
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
    bootstrap_server,
    config,
    default_domain_resolver,
    detour_tag,
    server_from_options,
    server_list
};
