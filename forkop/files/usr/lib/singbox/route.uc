#!/usr/bin/env ucode

let common = require("core.common");
let connections = require("config.connections");
let runtime_constants = require("singbox.constants");

let option = common.option;
let bool_option = common.bool_option;

function as_string(value) {
    return value == null ? "" : "" + value;
}

function bool_value(value) {
    return value === true || value == "1" || value == "true" || value == "yes" || value == "on";
}

function tproxy_inbounds() {
    return [
        runtime_constants.TPROXY_INBOUND_TAG,
        runtime_constants.TPROXY_INBOUND6_TAG,
        runtime_constants.SYSTEM_TPROXY_INBOUND_TAG,
        runtime_constants.SYSTEM_TPROXY_INBOUND6_TAG
    ];
}

function config(settings, runtime) {
    let output_network_interface = option(settings, "output_network_interface", "");
    let mwan3_active = type(runtime) == "object" && bool_value(runtime.mwan3_active);
    let direct_server_route = type(runtime) == "object" && bool_value(runtime.direct_server_route);
    let source_aware_dns = type(runtime) == "object" && bool_value(runtime.source_aware_dns);
    let system_aware_dns = type(runtime) == "object" && bool_value(runtime.system_aware_dns);
    let sniff_inbounds = tproxy_inbounds();
    push(sniff_inbounds, runtime_constants.DNS_INBOUND_TAG);
    if (source_aware_dns)
        push(sniff_inbounds, runtime_constants.SOURCE_DNS_INBOUND_TAG);
    if (system_aware_dns)
        push(sniff_inbounds, runtime_constants.SYSTEM_DNS_INBOUND_TAG);
    let result = {
        rules: [
            { action: "sniff", inbound: sniff_inbounds },
            { action: "hijack-dns", protocol: "dns" }
        ],
        rule_set: [],
        final: runtime_constants.DIRECT_OUTBOUND_TAG,
        auto_detect_interface: output_network_interface == "" && !mwan3_active && !direct_server_route,
        default_domain_resolver: type(runtime) == "object" && as_string(runtime.default_domain_resolver) != ""
            ? as_string(runtime.default_domain_resolver)
            : runtime_constants.DNS_SERVER_TAG,
        default_mark: runtime_constants.OUTBOUND_MARK
    };

    if (source_aware_dns)
        push(result.rules, { action: "reject", inbound: runtime_constants.SOURCE_DNS_INBOUND_TAG });
    if (system_aware_dns)
        push(result.rules, { action: "reject", inbound: runtime_constants.SYSTEM_DNS_INBOUND_TAG });
    if (output_network_interface != "")
        result.default_interface = output_network_interface;
    if (bool_option(settings, "disable_quic", false))
        push(result.rules, { action: "reject", inbound: tproxy_inbounds(), protocol: "quic" });
    if (bool_option(settings, "bittorrent_direct", false))
        push(result.rules, { action: "route", inbound: tproxy_inbounds(), protocol: "bittorrent", outbound: runtime_constants.DIRECT_OUTBOUND_TAG });

    return result;
}

function target(section, outbound_tag_name) {
    let action = option(section, "action", "");
    if (connections.is_connections_action(action) ||
        action == "byedpi" || action == "zapret" || action == "zapret2")
        return { action: "route", outbound: outbound_tag_name };
    if (action == "bypass")
        return { action: "route", outbound: runtime_constants.DIRECT_OUTBOUND_TAG };
    if (action == "block")
        return { action: "reject" };
    return { unsupported: "unsupported action " + action };
}

function has_resolve_matchers(rule) {
    if (rule.type == "logical") {
        for (let nested_rule in rule.rules || [])
            if (has_resolve_matchers(nested_rule))
                return true;
        return false;
    }
    return rule.domain != null || rule.domain_suffix != null || rule.domain_keyword != null ||
        rule.domain_regex != null || rule.rule_set != null;
}

function resolve_rule_for_section(section, route_rule) {
    let action = option(section, "action", "");
    let should_resolve = action == "byedpi" ||
        (connections.is_connections_action(action) &&
            bool_option(section, "resolve_real_ip_for_routing", false));

    if (!should_resolve)
        return null;

    if (!has_resolve_matchers(route_rule)) {
        return {
            warning: "Resolve real IP is enabled for '" + section[".name"] + "', but no domain or rule-set matchers found"
        };
    }

    let resolve_rule = {};
    for (let key in [ "type", "mode", "rules", "invert", "inbound", "source_ip_cidr", "domain", "domain_suffix", "domain_keyword", "domain_regex", "rule_set", "port", "port_range" ]) {
        if (route_rule[key] != null)
            resolve_rule[key] = route_rule[key];
    }
    // Without an explicit server the lookup follows dns.rules, so static records and
    // per-section DNS servers are honoured. FakeIP servers are skipped by sing-box for
    // this kind of lookup, and unmatched domains still fall back to the main DNS server.
    resolve_rule.action = "resolve";

    return { rule: resolve_rule };
}

return {
    config,
    target,
    has_resolve_matchers,
    resolve_rule_for_section
};
