#!/usr/bin/env ucode

let common = require("core.common");
let uci_core = require("core.uci");
let core_url = require("core.url");
let runtime_constants = require("singbox.constants");
let runtime_dns = require("singbox.dns");
let runtime_route = require("singbox.route");
let runtime_rulesets = require("singbox.rulesets");
let runtime_servers = require("singbox.servers");
let subscription_headers_module = require("singbox.subscription_headers");
let runtime_urltest = require("singbox.urltest");
let rule_config = require("config.rule");
let connections = require("config.connections");
let uci = null;
let fixture_uci_data = null;

// Whether client and router DNS is captured into sing-box at all. Set from the
// settings once per generation; device-scoped DNS rules and the capture
// inbounds only exist while it is on.
let runtime_dns_capture = true;
let runtime_settings_cache = null;

let as_string = common.as_string;
let read_json_file = common.read_json_file;
let read_stdin = common.read_stdin;
let write_json_file = common.write_json_file;
let strip_internal_fields = common.strip_internal_fields;
let array_or_empty = common.array_or_empty;
let object_or_empty = common.object_or_empty;
let option = common.option;
let list_option = common.list_option;
let bool_option = common.bool_option;
let int_option = common.int_option;
let duration_to_seconds = common.duration_to_seconds;
const CONFIG_NAME = "forkop";
// The sing-box FakeIP transport answers address queries only and fails the
// query with `only IP queries are supported by fakeip` for anything else, so
// every rule that routes to it stays limited to A/AAAA and the remaining
// types fall through to the ordinary DNS rules.
const FAKEIP_QUERY_TYPES = [ "A", "AAAA" ];

function fixture_section_list(type_name) {
    let value = object_or_empty(fixture_uci_data)[type_name];
    if (type(value) == "array")
        return value;
    if (type(value) == "object")
        return [ value ];

    let plural = object_or_empty(fixture_uci_data)[type_name + "s"];
    return type(plural) == "array" ? plural : [];
}

function fixture_get_section(section_name) {
    let fixture = object_or_empty(fixture_uci_data);
    if (section_name == "settings" && type(fixture.settings) == "object")
        return fixture.settings;

    for (let type_name in [ "settings", "server", "section", "subscription_url", "section_interface", "urltest", "fallback_group", "fallback_level" ]) {
        for (let section in fixture_section_list(type_name)) {
            if (as_string(section[".name"]) == section_name)
                return section;
        }
    }

    return {};
}

function fixture_cursor(path) {
    fixture_uci_data = object_or_empty(read_json_file(path));
    connections.set_item_sections_from_data(fixture_uci_data);
    return {
        load: function(_config_name) {
            return true;
        },
        get_all: function(_config_name, section_name) {
            return fixture_get_section(section_name);
        },
        foreach: function(_config_name, type_name, callback) {
            for (let section in fixture_section_list(type_name))
                callback(section);
        }
    };
}

function use_fixture_cursor(path) {
    uci = fixture_cursor(path);
    runtime_settings_cache = null;
}

function runtime_uci_cursor() {
    return {
        load: function(package_name) {
            return uci_core.load(package_name);
        },
        get_all: function(package_name, section_name) {
            return uci_core.get_all(package_name, section_name);
        },
        foreach: function(package_name, type_name, callback) {
            for (let section in uci_core.section_objects(package_name, type_name))
                callback(section);
        }
    };
}

function uci_cursor() {
    if (uci == null)
        uci = runtime_uci_cursor();
    return uci;
}

function runtime_generate_unsupported(reason) {
    warn(reason, "\n");
    exit(2);
}

function valid_section_name(name) {
    return match(name, /^[A-Za-z0-9_]+$/);
}

function section_enabled(section) {
    return bool_option(section, "enabled", true);
}

// A server carries the switch from the moment its dialog is saved, so one without
// it was added and never finished. The runtime check and the reload signature both
// read a missing switch as off, and generating an inbound for it anyway is how an
// unfinished server reached sing-box without ever being checked.
function server_enabled(section) {
    return bool_option(section, "enabled", false);
}

function runtime_settings() {
    if (runtime_settings_cache == null)
        runtime_settings_cache = object_or_empty(uci_cursor().get_all(CONFIG_NAME, "settings"));
    return runtime_settings_cache;
}

function dhcp_dnsmasq_section() {
    if (fixture_uci_data != null)
        return object_or_empty(fixture_uci_data.dhcp_dnsmasq);
    return object_or_empty(uci_core.get_all("dhcp", "@dnsmasq[0]"));
}

// Where unmatched client queries are handed back to. dnsmasq owns 127.0.0.1:53
// unless it was moved off the port; an AdGuard Home install keeps dnsmasq on
// another port or disables it, and whatever replaced it takes 127.0.0.1:53 by
// the same convention the system resolver relies on.
function local_resolver_port() {
    let value = trim(as_string(option(dhcp_dnsmasq_section(), "port", "")));
    if (match(value, /^[0-9]+$/) == null)
        return 53;
    let port = int(value, 10);
    return port >= 1 && port <= 65535 ? port : 53;
}

function local_resolver_domain() {
    let value = trim(as_string(option(dhcp_dnsmasq_section(), "domain", "")));
    return value == "" ? "lan" : value;
}

function dns_capture_enabled(settings) {
    return !bool_option(settings, "disable_dns_capture", false);
}

// The server that answers a client query no section rule claimed: the local
// resolver by default, so DHCP names, hosts records and ad-block lists keep
// answering, or the Forkop DNS when the user routed everything unmatched
// through it.
function unmatched_client_dns_server_tag() {
    return option(runtime_settings(), "unmatched_dns_mode", "router") == "forkop"
        ? runtime_constants.DNS_SERVER_TAG
        : runtime_constants.DNSMASQ_DNS_SERVER_TAG;
}

function settings_update_interval() {
    let settings = runtime_settings();
    if (!bool_option(settings, "list_update_enabled", true))
        return "";

    let update_interval = option(settings, "update_interval", "1d");
    return update_interval != "" ? update_interval : "1d";
}

function apply_remote_ruleset_update_interval(rule_set) {
    let update_interval = settings_update_interval();
    if (update_interval != "")
        rule_set.update_interval = update_interval;
    return rule_set;
}

function tag(base, postfix) {
    return runtime_constants.tag(base, postfix);
}

function outbound_tag(section_name) {
    return runtime_constants.outbound_tag(connections.section_display_name(section_name));
}

function child_outbound_tag(section, display_name) {
    return runtime_constants.child_tag(connections.section_display_name(section), display_name);
}

function download_via_proxy_any_enabled(settings, sections) {
    return connections.download_via_proxy_enabled(settings, "lists") ||
        connections.download_via_proxy_enabled(settings, "components") ||
        length(connections.subscription_download_targets(sections || [])) > 0;
}

function download_detour_tag(settings, purpose) {
    let section_name = connections.download_via_proxy_section(settings, purpose);
    return section_name == "" ? "" : outbound_tag(section_name);
}

function ruleset_registered(config, tag_name) {
    for (let rule_set in array_or_empty(config.route && config.route.rule_set)) {
        if (type(rule_set) == "object" && rule_set.tag == tag_name)
            return true;
    }
    return false;
}

function ensure_custom_ruleset(config, reference) {
    let tag_name;

    if (runtime_rulesets.is_community(reference)) {
        tag_name = runtime_rulesets.custom_reference_tag(reference);
        if (!ruleset_registered(config, tag_name)) {
            let rule_set = {
                type: "remote",
                tag: tag_name,
                format: "binary",
                url: runtime_rulesets.community_url(reference)
            };
            let detour = download_detour_tag(runtime_settings(), "lists");
            if (detour != "")
                rule_set.download_detour = detour;
            push(config.route.rule_set, apply_remote_ruleset_update_interval(rule_set));
        }
        return tag_name;
    }

    tag_name = runtime_rulesets.custom_reference_tag(reference);
    if (ruleset_registered(config, tag_name))
        return tag_name;

    if (substr(reference, 0, 1) == "/") {
        push(config.route.rule_set, {
            type: "local",
            tag: tag_name,
            format: "auto",
            path: reference
        });
    }
    else if (substr(reference, 0, 7) == "http://" || substr(reference, 0, 8) == "https://") {
        let rule_set = {
            type: "remote",
            tag: tag_name,
            format: "auto",
            url: reference
        };
        let detour = download_detour_tag(runtime_settings(), "lists");
        if (detour != "")
            rule_set.download_detour = detour;
        push(config.route.rule_set, apply_remote_ruleset_update_interval(rule_set));
    }
    else {
        runtime_generate_unsupported("rule_set reference is not supported by sing-box config generation");
    }

    return tag_name;
}

function clash_api_config(settings, service_address) {
    let controller = as_string(service_address || "");
    if (bool_option(settings, "enable_yacd", false) && bool_option(settings, "enable_yacd_wan_access", false))
        controller = "0.0.0.0";
    else if (controller == "")
        controller = "127.0.0.1";

    let result = {
        external_controller: controller + ":" + runtime_constants.CLASH_API_CONTROLLER_PORT
    };
    if (bool_option(settings, "enable_yacd", false)) {
        result.external_ui = "ui";
        let secret = option(settings, "yacd_secret_key", "");
        if (secret != "")
            result.secret = secret;
    }
    return result;
}

function cli_bool(value) {
    return value === true || value == "1" || value == "true" || value == "yes" || value == "on";
}

function single_or_array(values) {
    return length(values) == 1 ? values[0] : values;
}

function client_tproxy_inbound_matcher() {
    return [ runtime_constants.TPROXY_INBOUND_TAG, runtime_constants.TPROXY_INBOUND6_TAG ];
}

function system_tproxy_inbound_matcher() {
    return [ runtime_constants.SYSTEM_TPROXY_INBOUND_TAG, runtime_constants.SYSTEM_TPROXY_INBOUND6_TAG ];
}

function tproxy_inbound_matcher() {
    let result = client_tproxy_inbound_matcher();
    for (let inbound in system_tproxy_inbound_matcher())
        push(result, inbound);
    return result;
}

function source_dns_inbound_matcher() {
    return [ runtime_constants.SOURCE_DNS_INBOUND_TAG ];
}

function system_dns_inbound_matcher() {
    return [ runtime_constants.SYSTEM_DNS_INBOUND_TAG ];
}

function device_matcher_variants(section, key, dns) {
    let devices = connections.device_matchers(section, key);
    if (!devices.selected)
        return [ dns ? {} : { inbound: tproxy_inbound_matcher() } ];

    // A device-scoped DNS rule matches on the capture inbound the device's
    // queries arrive through. Without the capture those inbounds do not exist
    // and the rule could never match, so it is not emitted at all.
    if (dns && !runtime_dns_capture)
        return [];

    let result = [];
    if (length(devices.ips) > 0)
        push(result, {
            inbound: dns ? source_dns_inbound_matcher() : client_tproxy_inbound_matcher(),
            source_ip_cidr: single_or_array(devices.ips)
        });
    if (devices.system)
        push(result, { inbound: dns ? system_dns_inbound_matcher() : system_tproxy_inbound_matcher() });
    return result;
}

function copy_matchers(matchers) {
    let copy = {};
    for (let key, value in matchers)
        copy[key] = value;
    return copy;
}

function apply_matchers(rule, matchers) {
    for (let key, value in matchers)
        rule[key] = value;
}

function base_config(settings, service_address, runtime_context) {
    let log_level = option(settings, "log_level", "warn");
    let rewrite_ttl = int_option(settings, "dns_rewrite_ttl", "60");
    let cache_path = option(settings, "cache_path", "/tmp/sing-box/cache.db");
    let dns_config = runtime_dns.config(settings);
    if (dns_config.unsupported)
        runtime_generate_unsupported(dns_config.unsupported);

    let dns_rules = [
        { action: "reject", query_type: "HTTPS" },
        { action: "reject", domain_suffix: "use-application-dns.net" },
        {
            action: "route",
            server: runtime_constants.FAKEIP_DNS_SERVER_TAG,
            rewrite_ttl,
            query_type: FAKEIP_QUERY_TYPES,
            domain: [ runtime_constants.FAKEIP_TEST_DOMAIN, runtime_constants.CHECK_PROXY_IP_DOMAIN ]
        }
    ];

    let dns_servers = [];
    for (let server in dns_config.servers)
        push(dns_servers, server);
    push(dns_servers, {
        type: "fakeip",
        tag: runtime_constants.FAKEIP_DNS_SERVER_TAG,
        inet4_range: runtime_constants.FAKEIP_INET4_RANGE,
        inet6_range: runtime_constants.FAKEIP_INET6_RANGE
    });

    runtime_context = object_or_empty(runtime_context);
    let inbounds = [
        { type: "tproxy", tag: runtime_constants.TPROXY_INBOUND_TAG, listen: runtime_constants.TPROXY_INBOUND_ADDRESS, listen_port: runtime_constants.TPROXY_INBOUND_PORT, tcp_fast_open: true, udp_fragment: true },
        { type: "tproxy", tag: runtime_constants.TPROXY_INBOUND6_TAG, listen: runtime_constants.TPROXY_INBOUND6_ADDRESS, listen_port: runtime_constants.TPROXY_INBOUND_PORT, tcp_fast_open: true, udp_fragment: true },
        { type: "tproxy", tag: runtime_constants.SYSTEM_TPROXY_INBOUND_TAG, listen: runtime_constants.TPROXY_INBOUND_ADDRESS, listen_port: runtime_constants.SYSTEM_TPROXY_INBOUND_PORT, tcp_fast_open: true, udp_fragment: true },
        { type: "tproxy", tag: runtime_constants.SYSTEM_TPROXY_INBOUND6_TAG, listen: runtime_constants.TPROXY_INBOUND6_ADDRESS, listen_port: runtime_constants.SYSTEM_TPROXY_INBOUND_PORT, tcp_fast_open: true, udp_fragment: true },
        { type: "direct", tag: runtime_constants.DNS_INBOUND_TAG, listen: runtime_constants.DNS_INBOUND_ADDRESS, listen_port: runtime_constants.DNS_INBOUND_PORT }
    ];
    if (runtime_context.source_aware_dns)
        push(inbounds, { type: "direct", tag: runtime_constants.SOURCE_DNS_INBOUND_TAG, listen: runtime_constants.SOURCE_DNS_INBOUND_ADDRESS, listen_port: runtime_constants.SOURCE_DNS_INBOUND_PORT });
    if (runtime_context.system_aware_dns)
        push(inbounds, { type: "direct", tag: runtime_constants.SYSTEM_DNS_INBOUND_TAG, listen: runtime_constants.SYSTEM_DNS_INBOUND_ADDRESS, listen_port: runtime_constants.SYSTEM_DNS_INBOUND_PORT });

    runtime_context.default_domain_resolver = runtime_dns.default_domain_resolver(settings);

    return {
        log: {
            disabled: false,
            level: log_level,
            timestamp: false
        },
        dns: {
            servers: dns_servers,
            rules: dns_rules,
            final: runtime_constants.DNS_SERVER_TAG,
            strategy: option(settings, "dns_strategy", "prefer_ipv4"),
            independent_cache: true
        },
        endpoints: [],
        inbounds,
        providers: [],
        outbounds: [
            { type: "direct", tag: runtime_constants.DIRECT_OUTBOUND_TAG }
        ],
        route: runtime_route.config(settings, runtime_context),
        services: [],
        experimental: {
            unified_delay: {
                enabled: bool_option(settings, "unified_delay", false)
            },
            cache_file: {
                enabled: true,
                path: cache_path,
                store_fakeip: true,
                store_warp_config: true
            },
            clash_api: clash_api_config(settings, service_address)
        }
    };
}

function subscription_headers(section, source) {
    let parsed = subscription_headers_module.parse_header_lines(
        connections.subscription_headers(section, source)
    );
    if (!parsed.valid)
        runtime_generate_unsupported("invalid subscription request " + parsed.message);
    return parsed.headers;
}

function regex_escape(value) {
    value = as_string(value);
    let result = "";
    for (let i = 0; i < length(value); i++) {
        let character = substr(value, i, 1);
        if (index("\\.^$|?*+()[]{}", character) >= 0)
            result += "\\";
        result += character;
    }
    return result;
}

function filter_name_pattern(exact_names, regex_pattern) {
    let parts = [];
    for (let value in array_or_empty(exact_names)) {
        value = trim(as_string(value));
        if (value != "")
            push(parts, "^(?:" + regex_escape(value) + ")$");
    }
    regex_pattern = trim(as_string(regex_pattern));
    if (regex_pattern != "")
        push(parts, "(?:" + regex_pattern + ")");
    return length(parts) > 0 ? "(?:" + join("|", parts) + ")" : "";
}

function set_filter_side(result, side, pattern, require_match) {
    if (pattern != "")
        result[side] = pattern;
    else if (require_match)
        result[side] = "a^";
}

function normalized_outbound_types(values, allowed) {
    let supported = {};
    for (let value in array_or_empty(allowed))
        supported[value] = true;

    let result = [];
    let seen = {};
    for (let value in array_or_empty(values)) {
        value = lc(trim(as_string(value)));
        if (value == "" || seen[value] || !supported[value])
            continue;
        seen[value] = true;
        push(result, value);
    }
    return result;
}

function native_filter_options(mode,
    include_names, include_regex,
    exclude_names, exclude_regex, exclude_types) {
    let result = {};
    if (mode == "all")
        return result;
    if (mode == "include")
        set_filter_side(result, "include",
            filter_name_pattern(include_names, include_regex), true);
    if (mode == "include" || mode == "exclude") {
        set_filter_side(result, "exclude",
            filter_name_pattern(exclude_names, exclude_regex), false);
        // Only outbounds reach a provider, so an endpoint protocol in the
        // native filter could never match and is left out of the config.
        let types = normalized_outbound_types(exclude_types, runtime_constants.FILTERABLE_PROVIDER_TYPES);
        if (length(types) > 0)
            result.exclude_types = types;
    }
    return result;
}

function merge_object(target, source) {
    for (let key, value in object_or_empty(source))
        target[key] = value;
    return target;
}

function subscription_provider_filter(section, source) {
    let settings = connections.subscription_url_settings(section, source);
    return native_filter_options(
        option(settings, "server_filter_mode", "all"),
        list_option(settings, "include_outbounds"), option(settings, "include_regex", ""),
        list_option(settings, "exclude_outbounds"), option(settings, "exclude_regex", ""),
        connections.subscription_exclude_types(section, source)
    );
}

function urltest_provider_filter(section, urltest_id) {
    return native_filter_options(
        connections.urltest_filter_mode(section, urltest_id),
        connections.urltest_include_outbounds(section, urltest_id), connections.urltest_include_regex(section, urltest_id),
        connections.urltest_exclude_outbounds(section, urltest_id), connections.urltest_exclude_regex(section, urltest_id),
        connections.urltest_exclude_types(section, urltest_id)
    );
}

function fallback_level_provider_filter(group_id, level_id) {
    return native_filter_options(
        connections.fallback_level_mode(group_id, level_id),
        connections.fallback_level_include_outbounds(group_id, level_id),
        connections.fallback_level_include_regex(group_id, level_id),
        connections.fallback_level_exclude_outbounds(group_id, level_id),
        connections.fallback_level_exclude_regex(group_id, level_id),
        connections.fallback_level_exclude_types(group_id, level_id)
    );
}

function urltest_leaf_candidate_outbound(outbound) {
    if (type(outbound) != "object")
        return false;

    let t = lc(as_string(outbound.type || ""));
    return t != "selector" && t != "urltest" && t != "fallback" &&
        t != "dns" && t != "block";
}

function unique_tag(base, taken) {
    base = as_string(base);
    if (base == "")
        base = "Node";
    if (!taken[base])
        return base;
    for (let i = 2; i < 100000; i++) {
        let candidate = base + " #" + i;
        if (!taken[candidate])
            return candidate;
    }
    return base + " #overflow";
}

function reserved_runtime_tag_set(outbounds) {
    let result = {};
    for (let tag_name in keys(object_or_empty(runtime_constants.RESERVED_TAGS)))
        result[tag_name] = true;

    for (let outbound in array_or_empty(outbounds)) {
        if (type(outbound) != "object")
            continue;

        let tag_name = as_string(outbound.tag || "");
        if (tag_name != "")
            result[tag_name] = true;
    }
    return result;
}

function assert_unique_outbound_tags(config) {
    let seen = {};
    for (let outbound in array_or_empty(config.outbounds)) {
        if (type(outbound) != "object")
            runtime_generate_unsupported("generated sing-box outbound is not an object");

        let tag_name = as_string(outbound.tag || "");
        if (tag_name == "")
            runtime_generate_unsupported("generated sing-box outbound has an empty tag");
        if (seen[tag_name])
            runtime_generate_unsupported("generated sing-box config has duplicate outbound tag '" + tag_name + "'");
        seen[tag_name] = true;
    }
}

function outbound_detour_tag_for_section(section) {
    if (!bool_option(section, "outbound_detour_enabled", false))
        return "";

    let detour_section = option(section, "outbound_detour_section", "");
    return detour_section == "" ? "" : outbound_tag(detour_section);
}

function override_rename_rules(values) {
    let result = [];
    for (let value in array_or_empty(values)) {
        let rule = connections.parse_rename_rule(value);
        if (rule == null)
            runtime_generate_unsupported("subscription rename rule must be written as 'pattern => replacement'");
        push(result, rule);
    }
    return result;
}

function override_patch_object(raw) {
    raw = trim(as_string(raw));
    if (raw == "")
        return {};

    let parsed;
    try {
        parsed = json(raw);
    }
    catch (e) {
        runtime_generate_unsupported("subscription override patch is not valid JSON");
    }
    if (type(parsed) != "object")
        runtime_generate_unsupported("subscription override patch is not a JSON object");
    return parsed;
}

function subscription_override_options(section, source) {
    let settings = connections.subscription_override(section, source);
    let result = {};

    let prefix = as_string(settings.prefix);
    if (prefix != "")
        result.prefix = prefix;
    let suffix = as_string(settings.suffix);
    if (suffix != "")
        result.suffix = suffix;
    let rename = override_rename_rules(settings.rename);
    if (length(rename) > 0)
        result.rename = rename;

    let detour = outbound_detour_tag_for_section(section);
    if (detour != "")
        result.detour = detour;

    let patch = override_patch_object(settings.patch);
    if (length(keys(patch)) > 0)
        result.patch = patch;

    return result;
}

function add_subscription_provider(config, section, source_index, source) {
    let tag_name = child_outbound_tag(section, connections.subscription_tag(section, source, source_index));
    let source_type = connections.subscription_source_type(source);
    if (source_type == "")
        runtime_generate_unsupported("subscription source is not supported by sing-box config generation");

    let provider = merge_object({ type: source_type, tag: tag_name }, subscription_provider_filter(section, source));
    if (source_type == "local") {
        provider.path = source;
    }
    else {
        provider.url = source;
        provider.headers = subscription_headers(section, source);
        if (connections.subscription_update_enabled(section, source))
            provider.update_interval = connections.subscription_update_interval(section, source);

        let download_section = connections.subscription_download_section(section, source);
        if (download_section != "")
            provider.download_detour = outbound_tag(download_section);
    }
    let override = subscription_override_options(section, source);
    if (length(keys(override)) > 0)
        provider.override = override;
    push(config.providers, provider);
    return { tag: tag_name };
}

function add_subscription_providers(config, section) {
    let result = [];
    let sources = connections.subscription_urls(section);
    for (let i = 0; i < length(sources); i++)
        push(result, add_subscription_provider(config, section, i + 1, sources[i]));
    return result;
}

function vmess_link_name(link) {
    let payload = substr(as_string(link), length("vmess://"));
    if (substr(payload, 0, 1) != "{") {
        let boundary = length(payload);
        for (let marker in [ "@", "?", "#" ]) {
            let position = index(payload, marker);
            if (position >= 0 && position < boundary)
                boundary = position;
        }
        payload = substr(payload, 0, boundary);
        payload = replace(replace(payload, /-/g, "+"), /_/g, "/");
        while (length(payload) % 4 != 0)
            payload += "=";
        try {
            payload = b64dec(payload);
        }
        catch (e) {
            payload = "";
        }
    }
    try {
        let parsed = json(payload);
        return type(parsed) == "object" ? as_string(parsed.ps || "") : "";
    }
    catch (e) {
        return "";
    }
}

function connection_link_name(link) {
    return core_url.scheme(link) == "vmess"
        ? (vmess_link_name(link) || core_url.fragment(link))
        : core_url.fragment(link);
}

function add_manual_link_outbounds(config, section, taken, selector_tags, urltest_candidate_tags) {
    let links = connections.connection_urls(section);
    let detour = outbound_detour_tag_for_section(section);
    for (let i = 0; i < length(links); i++) {
        let display_name = connection_link_name(links[i]);
        if (display_name == "")
            display_name = "Node #" + (i + 1);
        let tag_name = unique_tag(child_outbound_tag(section, display_name), taken);
        taken[tag_name] = true;
        let outbound = { type: "parser", tag: tag_name, link: links[i] };
        if (detour != "")
            outbound.detour = detour;
        push(config.outbounds, outbound);
        push(selector_tags, tag_name);
        push(urltest_candidate_tags, tag_name);
    }
}

function urltest_check_interval(section, urltest_id) {
    let interval = connections.urltest_check_interval(section, urltest_id);
    return interval != "" ? interval : "3m";
}

function legacy_urltest_idle_timeout(section, urltest_id) {
    if (urltest_id != "urltest")
        return "";

    let settings = connections.urltest_settings(section, urltest_id);
    if (type(settings) == "object" && as_string(settings[".type"] || "") == "urltest")
        return "";

    let interval = urltest_check_interval(section, urltest_id);
    let interval_seconds = duration_to_seconds(interval);
    let default_idle_seconds = duration_to_seconds(runtime_constants.URLTEST_DEFAULT_IDLE_TIMEOUT);
    return interval_seconds != null && interval_seconds > default_idle_seconds ? interval : "";
}

function urltest_idle_timeout(section, urltest_id) {
    let configured = connections.urltest_idle_timeout(section, urltest_id);
    return configured != "" ? configured : legacy_urltest_idle_timeout(section, urltest_id);
}

function unique_string_array(values) {
    let result = [];
    let seen = {};
    for (let value in array_or_empty(values)) {
        value = as_string(value);
        if (value == "" || seen[value])
            continue;
        seen[value] = true;
        push(result, value);
    }
    return result;
}

function object_keys_set(values) {
    let result = {};
    for (let value in array_or_empty(values))
        result[value] = true;
    return result;
}

function tag_display_name(tag, section) {
    tag = as_string(tag);
    let prefix = connections.section_display_name(section) + "/";
    return substr(tag, 0, length(prefix)) == prefix ? substr(tag, length(prefix)) : tag;
}

function regex_match_set(tags, section, regexes) {
    let names = {};
    for (let tag in array_or_empty(tags))
        names[tag] = tag_display_name(tag, section);
    let pattern = trim(as_string(regexes));
    return object_keys_set(runtime_urltest.regex_matching_tag_array(
        tags, names, pattern == "" ? [] : [ pattern ]
    ));
}

function tag_name_filter_matches(tag, section, name_filter, regex_set) {
    let name = trim(tag_display_name(tag, section));
    for (let selected in array_or_empty(name_filter))
        if (trim(as_string(selected)) == name)
            return true;
    return regex_set[tag];
}

function link_scheme(link) {
    link = as_string(link);
    let separator = index(link, "://");
    return separator > 0 ? lc(substr(link, 0, separator)) : "";
}

// sing-box resolves a manual link at runtime, so a generated "parser" outbound
// has to be matched by the protocol of the link it carries.
function outbound_effective_type(outbound) {
    outbound = object_or_empty(outbound);
    let type_name = lc(as_string(outbound.type || ""));
    if (type_name == "parser")
        return as_string(
            runtime_constants.LINK_SCHEME_OUTBOUND_TYPES[link_scheme(outbound.link)] || ""
        );
    return type_name;
}

function candidate_outbound_types(config) {
    let result = {};
    for (let group in [ array_or_empty(config.outbounds), array_or_empty(config.endpoints) ])
        for (let outbound in group) {
            if (type(outbound) != "object")
                continue;
            let tag_name = as_string(outbound.tag || "");
            if (tag_name != "")
                result[tag_name] = outbound_effective_type(outbound);
        }
    return result;
}

// Native exclude_types only reaches provider members, so the manually
// configured servers of the section are filtered by the same list here.
function exclude_typed_candidates(mode, tags, candidate_types, exclude_types) {
    if (mode == "all")
        return tags;

    let excluded = {};
    let types = normalized_outbound_types(exclude_types, runtime_constants.FILTERABLE_GROUP_TYPES);
    if (length(types) == 0)
        return tags;
    for (let value in types)
        excluded[value] = true;

    let result = [];
    for (let tag_name in array_or_empty(tags))
        if (!excluded[as_string(object_or_empty(candidate_types)[tag_name] || "")])
            push(result, tag_name);
    return result;
}

function urltest_all_candidate_outbounds(urltest_candidate_tags) {
    return unique_string_array(urltest_candidate_tags);
}

function urltest_matching_candidate_outbounds(urltest_candidate_tags, section, name_filter, regexes) {
    let regex_set = regex_match_set(urltest_candidate_tags, section, regexes);
    let result = [];

    for (let tag in array_or_empty(urltest_candidate_tags)) {
        if (tag_name_filter_matches(tag, section, name_filter, regex_set))
            push(result, tag);
    }

    return unique_string_array(result);
}

function urltest_exclude_outbounds(all_outbounds, excluded_outbounds) {
    let excluded = object_keys_set(excluded_outbounds);
    let result = [];
    for (let tag in array_or_empty(all_outbounds)) {
        if (!excluded[tag])
            push(result, tag);
    }
    return result;
}

function filter_candidate_outbounds(mode, section, urltest_candidate_tags,
    include_names, include_regex,
    exclude_names, exclude_regex) {
    let all_outbounds = urltest_all_candidate_outbounds(urltest_candidate_tags);
    if (mode == "all")
        return all_outbounds;

    let include_outbounds = urltest_matching_candidate_outbounds(
        urltest_candidate_tags,
        section,
        include_names,
        include_regex
    );
    let exclude_outbounds = urltest_matching_candidate_outbounds(
        urltest_candidate_tags,
        section,
        exclude_names,
        exclude_regex
    );
    let matched = mode == "include" ? include_outbounds : all_outbounds;
    return urltest_exclude_outbounds(matched, exclude_outbounds);
}

function urltest_filtered_outbounds(section, urltest_id, urltest_candidate_tags, candidate_types) {
    let mode = connections.urltest_filter_mode(section, urltest_id);
    return filter_candidate_outbounds(
        mode,
        section,
        exclude_typed_candidates(mode, urltest_candidate_tags, candidate_types,
            connections.urltest_exclude_types(section, urltest_id)),
        connections.urltest_include_outbounds(section, urltest_id),
        connections.urltest_include_regex(section, urltest_id),
        connections.urltest_exclude_outbounds(section, urltest_id),
        connections.urltest_exclude_regex(section, urltest_id)
    );
}

function fallback_level_filtered_outbounds(section, group_id, level_id, urltest_candidate_tags, candidate_types) {
    let mode = connections.fallback_level_mode(group_id, level_id);
    if (mode == "direct")
        return [ runtime_constants.DIRECT_OUTBOUND_TAG ];

    return filter_candidate_outbounds(
        mode,
        section,
        exclude_typed_candidates(mode, urltest_candidate_tags, candidate_types,
            connections.fallback_level_exclude_types(group_id, level_id)),
        connections.fallback_level_include_outbounds(group_id, level_id),
        connections.fallback_level_include_regex(group_id, level_id),
        connections.fallback_level_exclude_outbounds(group_id, level_id),
        connections.fallback_level_exclude_regex(group_id, level_id)
    );
}

function fallback_levels_with_outbounds(section, group_id, urltest_candidate_tags, candidate_types) {
    let result = [];
    let assigned = {};

    for (let level_id in connections.fallback_levels(group_id)) {
        let outbounds = [];
        for (let tag_name in fallback_level_filtered_outbounds(section, group_id, level_id, urltest_candidate_tags, candidate_types)) {
            if (!assigned[tag_name]) {
                assigned[tag_name] = true;
                push(outbounds, tag_name);
            }
        }

        push(result, {
            id: level_id,
            displayName: connections.fallback_level_display_name(group_id, level_id),
            order: int(connections.fallback_level_order(group_id, level_id), 10),
            mode: connections.fallback_level_mode(group_id, level_id),
            outbounds
        });
    }

    return result;
}

function provider_tags(provider_refs) {
    let result = [];
    for (let provider in array_or_empty(provider_refs))
        if (type(provider) == "object" && as_string(provider.tag || "") != "")
            push(result, as_string(provider.tag));
    return result;
}

function section_group_items(section) {
    let result = [];
    for (let urltest_id in connections.urltests(section))
        push(result, {
            kind: "urltest",
            id: urltest_id,
            display_name: connections.urltest_display_name(section, urltest_id)
        });
    for (let group_id in connections.fallback_groups(section))
        push(result, {
            kind: "fallback",
            id: group_id,
            display_name: connections.fallback_group_display_name(section, group_id)
        });
    return result;
}

// A Fallback level can hold a URLTest group, so every tag is allocated before
// any group is built and the references resolve by display name. Only URLTest
// names are resolvable: a nested Fallback would add nothing its parent levels
// cannot express.
function allocate_group_tags(section, items, taken) {
    let by_name = {};
    for (let item in items) {
        item.tag = unique_tag(child_outbound_tag(section, item.display_name), taken);
        taken[item.tag] = true;
        let name = trim(as_string(item.display_name));
        if (item.kind == "urltest" && name != "" && by_name[name] == null)
            by_name[name] = item.tag;
    }
    return by_name;
}

function included_group_tags(names, group_tags_by_name, own_tag) {
    let result = [];
    let seen = {};
    for (let name in array_or_empty(names)) {
        let tag_name = as_string(object_or_empty(group_tags_by_name)[trim(as_string(name))] || "");
        if (tag_name == "" || tag_name == own_tag || seen[tag_name])
            continue;
        seen[tag_name] = true;
        push(result, tag_name);
    }
    return result;
}

function append_unique_tags(target, tags) {
    let seen = {};
    for (let tag_name in array_or_empty(target))
        seen[tag_name] = true;
    for (let tag_name in array_or_empty(tags)) {
        if (seen[tag_name])
            continue;
        seen[tag_name] = true;
        push(target, tag_name);
    }
    return target;
}

function group_has_members(descriptor) {
    if (descriptor.kind == "urltest")
        return length(array_or_empty(descriptor.outbound.outbounds)) > 0 ||
            length(array_or_empty(descriptor.outbound.providers)) > 0;

    for (let level in array_or_empty(descriptor.outbound.groups))
        if (length(array_or_empty(level.outbounds)) > 0 ||
            length(array_or_empty(level.providers)) > 0)
            return true;
    return false;
}

function prune_group_member_list(members, available, group_tags) {
    let filtered = [];
    for (let tag_name in array_or_empty(members))
        if (!group_tags[tag_name] || available[tag_name])
            push(filtered, tag_name);
    return filtered;
}

// A referenced group that ended up without members is dropped, and so is every
// group left empty because it only pointed at such a group.
function usable_group_descriptors(descriptors, group_tags) {
    let result = descriptors;
    for (let changed = true; changed; ) {
        changed = false;
        let available = {};
        for (let descriptor in result)
            available[descriptor.tag] = true;

        for (let descriptor in result) {
            if (descriptor.kind == "urltest") {
                let members = prune_group_member_list(descriptor.outbound.outbounds, available, group_tags);
                if (length(members) != length(array_or_empty(descriptor.outbound.outbounds)))
                    changed = true;
                descriptor.outbound.outbounds = members;
                continue;
            }
            for (let level in array_or_empty(descriptor.outbound.groups)) {
                let members = prune_group_member_list(level.outbounds, available, group_tags);
                if (length(members) != length(array_or_empty(level.outbounds)))
                    changed = true;
                level.outbounds = members;
            }
        }

        let kept = [];
        for (let descriptor in result) {
            if (group_has_members(descriptor))
                push(kept, descriptor);
            else
                changed = true;
        }
        result = kept;
    }
    return result;
}

function build_urltest_outbound(section, item, urltest_candidate_tags, candidate_types, provider_refs) {
    let urltest_id = item.id;
    let urltest_outbounds = urltest_filtered_outbounds(section, urltest_id, urltest_candidate_tags, candidate_types);
    let urltest_outbound = {
        type: "urltest",
        tag: item.tag,
        outbounds: urltest_outbounds,
        url: connections.urltest_testing_url(section, urltest_id),
        expected_status: connections.urltest_expected_status(section, urltest_id),
        interval: urltest_check_interval(section, urltest_id),
        tolerance: int(connections.urltest_tolerance(section, urltest_id), 10),
        interrupt_exist_connections: connections.urltest_interrupt_exist_connections(section, urltest_id)
    };
    let providers = provider_tags(provider_refs);
    if (length(providers) > 0)
        urltest_outbound.providers = providers;
    merge_object(urltest_outbound, urltest_provider_filter(section, urltest_id));
    let idle_timeout = urltest_idle_timeout(section, urltest_id);
    if (idle_timeout != "")
        urltest_outbound.idle_timeout = idle_timeout;

    return urltest_outbound;
}

function build_fallback_group_outbound(section, item, urltest_candidate_tags, candidate_types, group_tags_by_name, provider_refs) {
    let group_id = item.id;
    let levels = fallback_levels_with_outbounds(section, group_id, urltest_candidate_tags, candidate_types);
    let providers = provider_tags(provider_refs);
    let outbound = {
        type: "fallback",
        tag: item.tag,
        groups: []
    };

    for (let level in levels) {
        let native_level = {
            outbounds: level.outbounds
        };
        if (level.mode != "direct") {
            append_unique_tags(native_level.outbounds, included_group_tags(
                connections.fallback_level_include_groups(group_id, level.id), group_tags_by_name, item.tag
            ));
            if (length(providers) > 0)
                native_level.providers = providers;
            merge_object(native_level, fallback_level_provider_filter(group_id, level.id));
        }

        push(outbound.groups, native_level);
    }

    outbound.url = connections.fallback_group_health_check_url(section, group_id);
    outbound.interval = connections.fallback_group_health_check_interval(section, group_id);
    outbound.timeout = connections.fallback_group_health_check_timeout(section, group_id);
    outbound.attempt_timeout = connections.fallback_group_attempt_timeout(section, group_id);
    outbound.expected_status = connections.fallback_group_expected_status(section, group_id);
    outbound.idle_timeout = connections.fallback_group_idle_timeout(section, group_id);
    outbound.interrupt_exist_connections = connections.fallback_group_interrupt_exist_connections(section, group_id);

    return outbound;
}

function add_proxy_selector(config, section, selector_tags, urltest_candidate_tags, provider_refs, taken) {
    let section_name = section[".name"];
    let selector_tag = outbound_tag(section_name);
    let selector_outbounds = [];
    let selector_default = selector_tags[0];
    let urltest_tags = [];
    let fallback_tags = [];
    let candidate_types = candidate_outbound_types(config);
    let items = section_group_items(section);
    let group_tags_by_name = allocate_group_tags(section, items, taken);
    let group_tags = {};
    for (let item in items)
        group_tags[item.tag] = true;

    let descriptors = [];
    for (let item in items) {
        let outbound = item.kind == "urltest"
            ? build_urltest_outbound(section, item, urltest_candidate_tags, candidate_types, provider_refs)
            : build_fallback_group_outbound(section, item, urltest_candidate_tags, candidate_types, group_tags_by_name, provider_refs);
        push(descriptors, { kind: item.kind, tag: item.tag, outbound });
    }

    for (let descriptor in usable_group_descriptors(descriptors, group_tags)) {
        push(config.outbounds, descriptor.outbound);
        push(descriptor.kind == "urltest" ? urltest_tags : fallback_tags, descriptor.tag);
    }

    for (let tag in urltest_tags)
        push(selector_outbounds, tag);
    for (let tag in fallback_tags)
        push(selector_outbounds, tag);
    for (let tag in selector_tags)
        push(selector_outbounds, tag);

    if (length(urltest_tags) > 0 || length(fallback_tags) > 0) {
        selector_default = length(urltest_tags) > 0 ? urltest_tags[0]
            : fallback_tags[0];
    }

    let selector = {
        type: "selector",
        tag: selector_tag,
        outbounds: selector_outbounds,
        interrupt_exist_connections: true
    };
    let providers = provider_tags(provider_refs);
    if (length(providers) > 0)
        selector.providers = providers;
    if (selector_default != null && as_string(selector_default) != "")
        selector.default = selector_default;
    push(config.outbounds, selector);
}

function add_service_mixed_proxy_inbound(config, tag_name, listen_port, outbound) {
    push(config.inbounds, {
        type: "mixed",
        tag: tag_name,
        listen: runtime_constants.SERVICE_MIXED_INBOUND_ADDRESS,
        listen_port
    });
    push(config.route.rules, {
        action: "route",
        inbound: tag_name,
        outbound
    });
}

function service_mixed_proxy_inbound_tag_for_purpose(purpose) {
    return as_string(purpose || "lists") == "components"
        ? runtime_constants.inbound_tag("service-components")
        : runtime_constants.SERVICE_MIXED_INBOUND_TAG;
}

function service_mixed_proxy_port_for_purpose(purpose) {
    return runtime_constants.SERVICE_MIXED_INBOUND_PORT +
        (as_string(purpose || "lists") == "components" ? 1 : 0);
}

function add_global_download_service_mixed_proxy(config, settings, purpose) {
    let outbound = download_detour_tag(settings, purpose);
    if (outbound == "")
        return;

    add_service_mixed_proxy_inbound(
        config,
        service_mixed_proxy_inbound_tag_for_purpose(purpose),
        service_mixed_proxy_port_for_purpose(purpose),
        outbound
    );
}

function add_subscription_download_service_mixed_proxies(config, sections) {
    for (let target in connections.subscription_download_targets(sections)) {
        let port = connections.subscription_download_target_port(sections, target, runtime_constants.SERVICE_MIXED_INBOUND_PORT);
        if (port <= 0)
            runtime_generate_unsupported("subscription download proxy port could not be resolved");

        add_service_mixed_proxy_inbound(
            config,
            runtime_constants.inbound_tag("service-subscription-" + target),
            port,
            outbound_tag(target)
        );
    }
}

function first_outbound_section(sections) {
    for (let section in sections) {
        let action = option(section, "action", "");
        if (connections.is_connections_action(action) ||
            action == "byedpi" || action == "zapret" || action == "zapret2")
            return section;
    }
    return null;
}

function inbound_registered(config, tag_name) {
    for (let inbound in config.inbounds)
        if (type(inbound) == "object" && as_string(inbound.tag) == as_string(tag_name))
            return true;
    return false;
}

// The proxy diagnostic measures the running core through this inbound instead
// of starting a second sing-box process beside it. A download detour creates it
// already; without one it is added for the outbound the diagnostic checks.
function add_service_check_mixed_proxy(config, sections) {
    let first = first_outbound_section(sections);
    if (first == null || inbound_registered(config, runtime_constants.SERVICE_MIXED_INBOUND_TAG))
        return;

    add_service_mixed_proxy_inbound(
        config,
        runtime_constants.SERVICE_MIXED_INBOUND_TAG,
        runtime_constants.SERVICE_MIXED_INBOUND_PORT,
        outbound_tag(first[".name"])
    );
}

function add_service_mixed_proxy(config, settings, sections) {
    if (!download_via_proxy_any_enabled(settings, sections)) {
        add_service_check_mixed_proxy(config, sections);
        return;
    }

    add_global_download_service_mixed_proxy(config, settings, "lists");
    add_global_download_service_mixed_proxy(config, settings, "components");
    add_subscription_download_service_mixed_proxies(config, sections);
    add_service_check_mixed_proxy(config, sections);

    if (connections.download_via_proxy_enabled(settings, "lists") && download_detour_tag(settings, "lists") == "")
        runtime_generate_unsupported("download lists via proxy section is not set");
    if (connections.download_via_proxy_enabled(settings, "components") && download_detour_tag(settings, "components") == "")
        runtime_generate_unsupported("download components via proxy section is not set");
}

// A resolver without an explicit detour keeps resolving through its own interface,
// so a selected section only overrides that default.
function interface_domain_resolver_detour_tag(section, interface_name, interface_tag) {
    if (!connections.interface_domain_resolver_dns_detour_enabled(section, interface_name))
        return interface_tag;

    let target_section = connections.interface_domain_resolver_dns_detour_section(section, interface_name);
    if (target_section == "")
        runtime_generate_unsupported("interface '" + interface_name + "' routes resolver DNS through a section, but no section is selected");

    return outbound_tag(target_section);
}

function add_interface_connection_outbound(config, section, interface_index, interface_name, taken, selector_tags, urltest_candidate_tags) {
    let section_name = section[".name"];
    let display_name = connections.interface_display_name(section, interface_name);
    if (trim(display_name) == "")
        display_name = "Interface #" + interface_index;
    let tag_name = unique_tag(child_outbound_tag(section, display_name), taken);
    taken[tag_name] = true;

    let domain_resolver = "";
    if (connections.interface_domain_resolver_enabled(section, interface_name)) {
        domain_resolver = runtime_constants.domain_resolver_tag(section_name + "-interface-" + interface_index);
        let unsupported = runtime_dns.add_uri_server_group(
            config.dns.servers,
            connections.interface_domain_resolver_dns_servers(section, interface_name),
            domain_resolver,
            connections.interface_domain_resolver_dns_fallback_strategy(section, interface_name),
            interface_domain_resolver_detour_tag(section, interface_name, tag_name),
            false
        );
        if (unsupported != "")
            runtime_generate_unsupported(unsupported);
    }

    let outbound = {
        type: "direct",
        tag: tag_name,
        bind_interface: interface_name,
        domain_resolver,
        routing_mark: runtime_constants.OUTBOUND_MARK
    };
    if (domain_resolver == "")
        delete outbound.domain_resolver;

    push(config.outbounds, outbound);
    push(selector_tags, tag_name);
    push(urltest_candidate_tags, tag_name);
}

function add_connection_interfaces(config, section, taken, selector_tags, urltest_candidate_tags) {
    let items = connections.interfaces(section);
    for (let i = 0; i < length(items); i++)
        add_interface_connection_outbound(config, section, i + 1, items[i], taken, selector_tags, urltest_candidate_tags);
}

function parse_outbound_json(value) {
    try {
        value = json(as_string(value));
    }
    catch (e) {
        return null;
    }

    return type(value) == "object" ? value : null;
}

function add_connection_tunnels(config, section, taken, selector_tags, urltest_candidate_tags) {
    let items = connections.tunnel_items(section);
    let section_name = section[".name"];

    for (let i = 0; i < length(items); i++) {
        let tunnel = items[i];
        let endpoint = connections.tunnel_endpoint(tunnel);
        let endpoint_type = lc(as_string(endpoint.type || ""));
        let wrapper_kind = lc(as_string(connections.option(tunnel, "kind", "wireguard")));
        if (endpoint_type == "" ||
            (endpoint_type != "wireguard" && endpoint_type != "amneziawg" && endpoint_type != "warp" && endpoint_type != "tailscale" && wrapper_kind != "json"))
            runtime_generate_unsupported("tunnel " + (i + 1) + " has an unsupported endpoint type");

        let display_name = trim(as_string(endpoint.tag || ""));
        if (display_name == "")
            display_name = trim(as_string(connections.option(tunnel, "name", "")));
        if (display_name == "")
            display_name = "Tunnel #" + (i + 1);
        let tag_name = unique_tag(child_outbound_tag(section, display_name), taken);
        taken[tag_name] = true;
        endpoint.tag = tag_name;

        if (wrapper_kind != "json" && (endpoint_type == "wireguard" || endpoint_type == "amneziawg" || endpoint_type == "warp")) {
            let detour = outbound_detour_tag_for_section(section);
            if (detour != "" && as_string(endpoint.detour || "") == "")
                endpoint.detour = detour;
        }

        if (wrapper_kind != "json" && endpoint_type == "tailscale") {
            let detour_section = connections.option(tunnel, "tailscale_detour_section", "");
            if (detour_section != "")
                endpoint.detour = outbound_tag(detour_section);
            if (as_string(endpoint.state_directory || "") == "")
                endpoint.state_directory = "/etc/forkop/tailscale/" + section_name + "-" + as_string(tunnel[".name"] || (i + 1));
            endpoint.exit_node_allow_lan_access = true;
        }

        push(config.endpoints, endpoint);
        push(selector_tags, tag_name);
        push(urltest_candidate_tags, tag_name);
    }
}

function json_outbound_reference_tag(reference, tag_map) {
    reference = as_string(reference);
    if (tag_map[reference])
        return tag_map[reference];
    if (connections.section_exists(reference))
        return outbound_tag(reference);

    let suffix = "-out";
    if (length(reference) > length(suffix) && substr(reference, -length(suffix)) == suffix) {
        let section_name = substr(reference, 0, length(reference) - length(suffix));
        if (connections.section_exists(section_name))
            return outbound_tag(section_name);
    }
    return reference;
}

function rewrite_json_outbound_references(outbounds, tag_map) {
    for (let outbound in array_or_empty(outbounds)) {
        if (type(outbound) != "object")
            continue;

        for (let key in [ "detour", "default" ]) {
            let reference = as_string(outbound[key] || "");
            if (reference != "")
                outbound[key] = json_outbound_reference_tag(reference, tag_map);
        }

        if (type(outbound.outbounds) == "array") {
            let rewritten = [];
            for (let tag_name in outbound.outbounds) {
                tag_name = as_string(tag_name);
                if (tag_name != "")
                    push(rewritten, json_outbound_reference_tag(tag_name, tag_map));
            }
            outbound.outbounds = rewritten;
        }
    }
}

function prepare_json_connection_outbounds(section, taken) {
    let items = connections.outbound_jsons(section);
    let prepared = [];
    let outbounds = [];
    let tag_map = {};
    let legacy_tags = [];

    for (let i = 0; i < length(items); i++) {
        let outbound = parse_outbound_json(items[i]);
        if (outbound == null)
            runtime_generate_unsupported("JSON outbound is invalid");

        let display_name = trim(as_string(outbound.tag || ""));
        let legacy_tag = section[".name"] + "-json-" + (i + 1) + "-out";
        if (display_name == "")
            display_name = "JSON outbound #" + (i + 1);
        let tag_name = unique_tag(child_outbound_tag(section, display_name), taken);
        taken[tag_name] = true;
        if (display_name != "" && !tag_map[display_name])
            tag_map[display_name] = tag_name;
        push(legacy_tags, [ legacy_tag, tag_name ]);

        outbound.tag = tag_name;
        push(outbounds, outbound);
        push(prepared, {
            outbound,
            displayName: display_name
        });
    }

    for (let entry in legacy_tags)
        if (!tag_map[entry[0]])
            tag_map[entry[0]] = entry[1];

    rewrite_json_outbound_references(outbounds, tag_map);
    return prepared;
}

function add_connection_json_outbounds(config, section, taken, selector_tags, urltest_candidate_tags) {
    for (let item in prepare_json_connection_outbounds(section, taken)) {
        let outbound = item.outbound;
        let tag_name = outbound.tag;
        push(config.outbounds, outbound);
        push(selector_tags, tag_name);
        if (urltest_leaf_candidate_outbound(outbound))
            push(urltest_candidate_tags, tag_name);
    }
}

function add_connections_outbound(config, section, taken) {
    let selector_tags = [];
    let urltest_candidate_tags = [];
    let provider_refs = add_subscription_providers(config, section);
    add_manual_link_outbounds(config, section, taken, selector_tags, urltest_candidate_tags);
    let interface_tags = [];
    let tunnel_tags = [];
    let json_tags = [];
    add_connection_interfaces(config, section, taken, interface_tags, urltest_candidate_tags);
    add_connection_tunnels(config, section, taken, tunnel_tags, urltest_candidate_tags);
    add_connection_json_outbounds(config, section, taken, json_tags, urltest_candidate_tags);
    for (let tags in [ interface_tags, tunnel_tags, json_tags ])
        for (let tag_name in tags)
            push(selector_tags, tag_name);

    if (length(selector_tags) == 0 && length(provider_refs) == 0)
        runtime_generate_unsupported("connection section has no usable outbounds");

    add_proxy_selector(config, section, selector_tags, urltest_candidate_tags, provider_refs, taken);
}

function enabled_action_index(sections, target_section, action_name) {
    let index = 0;
    for (let section in sections) {
        if (option(section, "action", "") != action_name)
            continue;
        index++;
        if (section[".name"] == target_section[".name"])
            return index;
    }
    return 0;
}

function add_zapret_outbound(config, section, sections) {
    let index = enabled_action_index(sections, section, "zapret");
    if (index <= 0)
        runtime_generate_unsupported("unable to resolve Zapret index for " + section[".name"]);
    push(config.outbounds, {
        type: "direct",
        tag: outbound_tag(section[".name"]),
        routing_mark: runtime_constants.ZAPRET_ROUTE_MARK_BASE + index
    });
}

function add_zapret2_outbound(config, section, sections) {
    let index = enabled_action_index(sections, section, "zapret2");
    if (index <= 0)
        runtime_generate_unsupported("unable to resolve Zapret2 index for " + section[".name"]);
    push(config.outbounds, {
        type: "direct",
        tag: outbound_tag(section[".name"]),
        routing_mark: runtime_constants.ZAPRET2_ROUTE_MARK_BASE + index
    });
}

function add_byedpi_outbound(config, section, sections) {
    let index = enabled_action_index(sections, section, "byedpi");
    if (index <= 0)
        runtime_generate_unsupported("unable to resolve ByeDPI index for " + section[".name"]);
    push(config.outbounds, {
        type: "socks",
        tag: outbound_tag(section[".name"]),
        server: runtime_constants.BYEDPI_LISTEN_ADDRESS,
        server_port: runtime_constants.BYEDPI_PORT_BASE + index - 1,
        version: "5"
    });
}

function ensure_community_ruleset(config, section_name, community) {
    if (!runtime_rulesets.is_community(community))
        runtime_generate_unsupported("unknown community list " + community);

    let tag_name = runtime_rulesets.community_tag(section_name, community);
    if (!ruleset_registered(config, tag_name)) {
        let rule_set = {
            type: "remote",
            tag: tag_name,
            format: "binary",
            url: runtime_rulesets.community_url(community)
        };
        let detour = download_detour_tag(runtime_settings(), "lists");
        if (detour != "")
            rule_set.download_detour = detour;
        push(config.route.rule_set, apply_remote_ruleset_update_interval(rule_set));
    }
    return {
        tag: tag_name,
        kind: "domains"
    };
}

function legacy_condition_values(section, key) {
    let raw_values = object_or_empty(section)[key];
    let list_values = type(raw_values) == "array"
        ? raw_values
        : [];
    let option_text_values = type(raw_values) == "array" || key == "domain"
        ? []
        : rule_config.text_list_values(raw_values, "comma-space");
    let text_value = option(section, key + "_text", "");
    let text_values = rule_config.text_list_values(text_value, "comma-space");

    if (bool_option(section, key + "_text_mode", false) || bool_option(section, "conditions_text_mode", false))
        return text_values;
    if (length(list_values) > 0)
        return list_values;
    if (length(option_text_values) > 0)
        return option_text_values;
    return text_values;
}

function combined_domain_source_values(section) {
    let values = [];
    if (type(object_or_empty(section)["domain"]) != "array") {
        for (let value in rule_config.text_list_values(option(section, "domain", ""), "comma-space"))
            if (as_string(value) != "")
                push(values, as_string(value));
    }
    for (let value in rule_config.text_list_values(option(section, "domain_suffix_text", ""), "comma-space"))
        if (as_string(value) != "")
            push(values, as_string(value));
    for (let value in list_option(section, "domain_suffix"))
        if (as_string(value) != "")
            push(values, as_string(value));
    return values;
}

function domain_suffix_condition_value_kind(value) {
    return rule_config.prefixed_domain_kind_value(value);
}

function domain_conditions(section) {
    let result = {
        domain: [],
        domain_suffix: [],
        domain_keyword: [],
        domain_regex: []
    };

    for (let key in [ "domain", "domain_keyword", "domain_regex" ]) {
        for (let value in legacy_condition_values(section, key)) {
            let normalized = rule_config.domain_value_for_key(value, key);
            if (normalized != null)
                push(result[key], normalized);
        }
    }

    for (let value in combined_domain_source_values(section)) {
        let normalized = domain_suffix_condition_value_kind(value);
        if (normalized != null)
            push(result[normalized.kind], normalized.value);
    }

    return result;
}

function add_domain_array(rule, key, values) {
    if (length(values) > 0)
        rule[key] = values;
}

function push_dns_matcher_rule(config, rule) {
    push(config.dns.rules, rule);
}

function section_has_port_matchers(section) {
    return length(list_option(section, "ports")) > 0 ||
        length(rule_config.text_list_values(option(section, "ports_text", ""), "comma-space")) > 0;
}

function section_dns_server(section) {
    return option(section, "action", "") == "bypass" && !section_has_port_matchers(section)
        ? runtime_constants.DNS_SERVER_TAG
        : runtime_constants.FAKEIP_DNS_SERVER_TAG;
}

function add_source_aware_bypass_dns_rules(config, matchers, rewrite_ttl) {
    // Real addresses for a device whose traffic goes around the proxy. The
    // router's own queries cannot take the local-resolver path: the resolver
    // forwards upstream through the very capture that brought the query here,
    // and answering it from the resolver would send the query in a circle.
    let real_ip_server = type(matchers.inbound) == "array" &&
        index(matchers.inbound, runtime_constants.SYSTEM_DNS_INBOUND_TAG) >= 0
        ? runtime_constants.DNS_SERVER_TAG
        : unmatched_client_dns_server_tag();

    push_dns_matcher_rule(config, {
        type: "logical",
        mode: "and",
        rules: [
            copy_matchers(matchers),
            {
                ip_cidr: [ runtime_constants.FAKEIP_INET4_RANGE, runtime_constants.FAKEIP_INET6_RANGE ],
                invert: true
            }
        ],
        action: "route",
        server: real_ip_server,
        rewrite_ttl
    });

    let fallback = copy_matchers(matchers);
    fallback.action = "route";
    fallback.server = runtime_constants.DNS_SERVER_TAG;
    fallback.query_type = [ "A", "AAAA" ];
    fallback.rewrite_ttl = rewrite_ttl;
    push_dns_matcher_rule(config, fallback);
}

function add_section_dns_matcher_rule(config, section, matchers, rewrite_ttl) {
    let devices = connections.device_matchers(section, "source_ip_cidr");
    for (let device_matchers in device_matcher_variants(section, "source_ip_cidr", true)) {
        let rule = copy_matchers(matchers);
        apply_matchers(rule, device_matchers);
        if (option(section, "action", "") == "bypass" &&
            !section_has_port_matchers(section) && devices.selected) {
            add_source_aware_bypass_dns_rules(config, rule, rewrite_ttl);
            continue;
        }

        rule.action = "route";
        rule.server = section_dns_server(section);
        if (rule.server == runtime_constants.FAKEIP_DNS_SERVER_TAG)
            rule.query_type = FAKEIP_QUERY_TYPES;
        rule.rewrite_ttl = rewrite_ttl;
        push_dns_matcher_rule(config, rule);
    }
}

function system_aware_dns_enabled(sections) {
    for (let section in sections)
        if (connections.section_needs_system_dns(section))
            return true;

    return false;
}

function add_source_aware_dns_support(config) {
    push(config.dns.servers, {
        type: "udp",
        tag: runtime_constants.DNSMASQ_DNS_SERVER_TAG,
        server: "127.0.0.1",
        server_port: local_resolver_port()
    });
}

function static_hosts_config() {
    let hosts = runtime_dns.static_hosts(runtime_settings());
    if (hosts.unsupported)
        runtime_generate_unsupported(hosts.unsupported);
    return hosts;
}

// Static records answer before sing-box dials the destination itself, so ByeDPI,
// Zapret and direct sections reach domains that the configured DNS servers cannot
// resolve. Section DNS rules keep their FakeIP answers for client queries.
function add_static_hosts_support(config, hosts) {
    if (length(hosts.domains) == 0)
        return;

    push(config.dns.servers, {
        type: "hosts",
        tag: runtime_constants.HOSTS_DNS_SERVER_TAG,
        predefined: hosts.predefined
    });
    push(config.route.rules, {
        action: "resolve",
        server: runtime_constants.HOSTS_DNS_SERVER_TAG,
        domain: hosts.domains
    });
}

function add_static_hosts_dns_rule(config, hosts) {
    if (length(hosts.domains) == 0)
        return;

    push_dns_matcher_rule(config, {
        action: "route",
        server: runtime_constants.HOSTS_DNS_SERVER_TAG,
        domain: hosts.domains,
        rewrite_ttl: int_option(runtime_settings(), "dns_rewrite_ttl", "60")
    });
}

// Queries no section rule claimed. Captured client queries return to the local
// resolver, which keeps DHCP names, hosts records and ad-block filtering
// answering - or go to the Forkop DNS when the user routed everything unmatched
// through it, with only the resolver's own zone left on it. The router's
// unmatched queries always take the Forkop DNS: the resolver forwards upstream
// through the very capture that brought the query here, and answering the
// router from the resolver would send the query in a circle.
function add_source_aware_dns_fallback(config, system_aware_dns) {
    let rewrite_ttl = int_option(runtime_settings(), "dns_rewrite_ttl", "60");
    let client_server = unmatched_client_dns_server_tag();

    if (client_server != runtime_constants.DNSMASQ_DNS_SERVER_TAG) {
        // Single-label names, the DHCP domain and reverse lookups are what the
        // local resolver is authoritative for, so they stay with it.
        let local_zone_matchers = [
            { domain_regex: "^[^.]+$" },
            { domain_suffix: "." + local_resolver_domain() },
            { query_type: [ "PTR" ] }
        ];
        for (let matcher in local_zone_matchers) {
            let rule = {
                inbound: source_dns_inbound_matcher(),
                action: "route",
                server: runtime_constants.DNSMASQ_DNS_SERVER_TAG,
                rewrite_ttl
            };
            apply_matchers(rule, matcher);
            push_dns_matcher_rule(config, rule);
        }
    }

    push_dns_matcher_rule(config, {
        inbound: source_dns_inbound_matcher(),
        action: "route",
        server: client_server,
        rewrite_ttl
    });

    if (system_aware_dns)
        push_dns_matcher_rule(config, {
            inbound: system_dns_inbound_matcher(),
            action: "route",
            server: runtime_constants.DNS_SERVER_TAG,
            rewrite_ttl
        });
}

function dns_action_server_tag(section_name) {
    return runtime_constants.tag(section_name, "dns-server");
}

function dns_action_detour_tag(section) {
    if (!bool_option(section, "dns_detour_enabled", false))
        return "";
    let target_section = option(section, "dns_detour_section", "");
    return target_section == "" ? "" : outbound_tag(target_section);
}

function add_dns_server_for_section(config, section) {
    let unsupported = runtime_dns.add_uri_server_group(
        config.dns.servers,
        runtime_dns.server_list(section, "dns_server", ""),
        dns_action_server_tag(section[".name"]),
        option(section, "dns_fallback_strategy", "parallel"),
        dns_action_detour_tag(section),
        false
    );
    if (unsupported != "")
        runtime_generate_unsupported(unsupported);
}

function add_dns_action_rules_for_section(config, section) {
    let domains = domain_conditions(section);
    let domain = domains.domain;
    let domain_suffix = domains.domain_suffix;
    let domain_keyword = domains.domain_keyword;
    let domain_regex = domains.domain_regex;
    let rule_set_tags = [];
    let section_name = section[".name"];
    let fully_routed_devices = connections.device_matchers(section, "fully_routed_ips");

    for (let community in connections.community_lists(section)) {
        let ensured = ensure_community_ruleset(config, section_name, as_string(community));
        push(rule_set_tags, ensured.tag);
    }
    for (let reference in connections.rule_sets(section)) {
        push(rule_set_tags, ensure_custom_ruleset(config, as_string(reference)));
    }

    let rewrite_ttl = int_option(runtime_settings(), "dns_rewrite_ttl", "60");
    let server_tag = dns_action_server_tag(section_name);
    let has_inline_domains = length(domain) > 0 || length(domain_suffix) > 0 ||
        length(domain_keyword) > 0 || length(domain_regex) > 0;

    if (fully_routed_devices.selected) {
        for (let device_matchers in device_matcher_variants(section, "fully_routed_ips", true)) {
            let dns_rule = {
                action: "route",
                server: server_tag,
                rewrite_ttl
            };
            apply_matchers(dns_rule, device_matchers);
            push_dns_matcher_rule(config, dns_rule);
        }
    }
    if (has_inline_domains) {
        for (let device_matchers in device_matcher_variants(section, "source_ip_cidr", true)) {
            let dns_rule = {
                action: "route",
                server: server_tag,
                rewrite_ttl
            };
            add_domain_array(dns_rule, "domain", domain);
            add_domain_array(dns_rule, "domain_suffix", domain_suffix);
            add_domain_array(dns_rule, "domain_keyword", domain_keyword);
            add_domain_array(dns_rule, "domain_regex", domain_regex);
            apply_matchers(dns_rule, device_matchers);
            push_dns_matcher_rule(config, dns_rule);
        }
    }
    if (length(rule_set_tags) > 0) {
        for (let device_matchers in device_matcher_variants(section, "source_ip_cidr", true)) {
            let dns_rule = {
                action: "route",
                server: server_tag,
                rewrite_ttl,
                rule_set: single_or_array(rule_set_tags),
                // A DNS query carries no destination address or port, so only the domain
                // half of a mixed rule set can pick this server. Without the projection a
                // subnet-only set matches every domain, and an address matcher anywhere in
                // the set would also confine the rule to A, AAAA and HTTPS queries.
                rule_set_domain_only: true
            };
            apply_matchers(dns_rule, device_matchers);
            push_dns_matcher_rule(config, dns_rule);
        }
    }
    if (!has_inline_domains && length(rule_set_tags) == 0 && !fully_routed_devices.selected)
        runtime_generate_unsupported("DNS action '" + section_name + "' has no domain matchers");
}

function normalize_port_number_value(value) {
    return rule_config.normalize_port_number_value(value);
}

function add_port_matchers(rule, section) {
    let values = [];
    for (let value in list_option(section, "ports"))
        push(values, value);
    for (let value in rule_config.text_list_values(option(section, "ports_text", ""), "comma-space"))
        push(values, value);

    let ports = [];
    let port_ranges = [];
    let seen = {};
    for (let value in values) {
        value = trim(as_string(value));
        if (value == "" || seen[value])
            continue;
        seen[value] = true;

        let dash = index(value, "-");
        if (dash < 0) {
            let port = normalize_port_number_value(value);
            if (port != null)
                push(ports, port);
            continue;
        }

        let start = normalize_port_number_value(substr(value, 0, dash));
        let end = normalize_port_number_value(substr(value, dash + 1));
        if (start != null && end != null && start <= end)
            push(port_ranges, start == end ? as_string(start) : sprintf("%d:%d", start, end));
    }

    if (length(ports) > 0)
        rule.port = ports;
    if (length(port_ranges) > 0)
        rule.port_range = port_ranges;
}

function add_fully_routed_ips_rules(config, section) {
    let devices = connections.device_matchers(section, "fully_routed_ips");
    if (!devices.selected)
        return;

    if (option(section, "action", "") == "bypass") {
        for (let dns_matchers in device_matcher_variants(section, "fully_routed_ips", true))
            add_source_aware_bypass_dns_rules(
                config,
                dns_matchers,
                int_option(runtime_settings(), "dns_rewrite_ttl", "60")
            );
    }

    let target = runtime_route.target(section, outbound_tag(section[".name"]));
    if (target.unsupported)
        runtime_generate_unsupported(target.unsupported);

    for (let device_matchers in device_matcher_variants(section, "fully_routed_ips", false)) {
        let route_rule = { action: target.action };
        if (target.outbound)
            route_rule.outbound = target.outbound;
        apply_matchers(route_rule, device_matchers);
        push(config.route.rules, route_rule);
    }
}

// sing-box hands the grouped matches of a rule-set branch back to the rule that
// includes it, so a branch carrying its own ports or source addresses would satisfy
// the section's ports or device filter instead of being narrowed by them. Moving
// those matchers into a separate AND branch keeps the section constraining the rule
// set rather than the rule set widening the section.
const RULE_SET_CONSTRAINT_KEYS = [ "port", "port_range", "source_ip_cidr" ];

function constrain_rule_set_by_section(route_rule, target) {
    if (route_rule.rule_set == null)
        return route_rule;

    let constraint = {};
    let constrained = false;
    for (let key in RULE_SET_CONSTRAINT_KEYS) {
        if (route_rule[key] == null)
            continue;
        constraint[key] = route_rule[key];
        constrained = true;
    }
    if (!constrained)
        return route_rule;

    let identity_rule = copy_matchers(route_rule);
    delete identity_rule.action;
    delete identity_rule.outbound;
    for (let key in RULE_SET_CONSTRAINT_KEYS)
        delete identity_rule[key];

    let result = {
        type: "logical",
        mode: "and",
        rules: [ identity_rule, constraint ],
        action: target.action
    };
    if (target.outbound)
        result.outbound = target.outbound;
    return result;
}

function add_combined_route_for_section(config, section) {
    let domains = domain_conditions(section);
    let domain = domains.domain;
    let domain_suffix = domains.domain_suffix;
    let domain_keyword = domains.domain_keyword;
    let domain_regex = domains.domain_regex;
    let ip_cidr = legacy_condition_values(section, "ip_cidr");
    let rule_set_tags = [];
    let section_name = section[".name"];

    add_fully_routed_ips_rules(config, section);

    for (let community in connections.community_lists(section))
        push(rule_set_tags, ensure_community_ruleset(config, section_name, as_string(community)).tag);
    for (let reference in connections.rule_sets(section))
        push(rule_set_tags, ensure_custom_ruleset(config, as_string(reference)));
    for (let reference in connections.rule_sets_with_subnets(section))
        push(rule_set_tags, ensure_custom_ruleset(config, as_string(reference)));

    let target = runtime_route.target(section, outbound_tag(section_name));
    if (target.unsupported)
        runtime_generate_unsupported(target.unsupported);
    let route_rule = { action: target.action };
    if (target.outbound)
        route_rule.outbound = target.outbound;
    add_domain_array(route_rule, "domain", domain);
    add_domain_array(route_rule, "domain_suffix", domain_suffix);
    add_domain_array(route_rule, "domain_keyword", domain_keyword);
    add_domain_array(route_rule, "domain_regex", domain_regex);
    if (length(ip_cidr) > 0)
        route_rule.ip_cidr = ip_cidr;
    add_port_matchers(route_rule, section);
    if (length(rule_set_tags) > 0)
        route_rule.rule_set = single_or_array(rule_set_tags);

    let has_route_matchers = route_rule.domain != null || route_rule.domain_suffix != null ||
        route_rule.domain_keyword != null || route_rule.domain_regex != null ||
        route_rule.ip_cidr != null || route_rule.port != null || route_rule.port_range != null ||
        route_rule.rule_set != null;
    if (has_route_matchers) {
        for (let device_matchers in device_matcher_variants(section, "source_ip_cidr", false)) {
            let device_route_rule = copy_matchers(route_rule);
            apply_matchers(device_route_rule, device_matchers);
            device_route_rule = constrain_rule_set_by_section(device_route_rule, target);
            let resolve = runtime_route.resolve_rule_for_section(section, device_route_rule);
            if (type(resolve) == "object" && resolve.warning)
                warn(resolve.warning, "\n");
            else if (type(resolve) == "object" && resolve.rule)
                push(config.route.rules, resolve.rule);
            push(config.route.rules, device_route_rule);
        }
    }

    let rewrite_ttl = int_option(runtime_settings(), "dns_rewrite_ttl", "60");
    if (length(domain) > 0 || length(domain_suffix) > 0 || length(domain_keyword) > 0 || length(domain_regex) > 0) {
        let dns_rule = {};
        add_domain_array(dns_rule, "domain", domain);
        add_domain_array(dns_rule, "domain_suffix", domain_suffix);
        add_domain_array(dns_rule, "domain_keyword", domain_keyword);
        add_domain_array(dns_rule, "domain_regex", domain_regex);
        add_section_dns_matcher_rule(config, section, dns_rule, rewrite_ttl);
    }
    if (length(rule_set_tags) > 0) {
        add_section_dns_matcher_rule(config, section, {
            rule_set: single_or_array(rule_set_tags)
        }, rewrite_ttl);
    }
}

function unsupported_matcher_key(section) {
    let unsupported_options = [
        "subnet", "subnet_text"
    ];
    for (let key in unsupported_options) {
        if (length(list_option(section, key)) > 0 || option(section, key, "") != "")
            return key;
    }
    return "";
}

function add_outbound_for_section(config, section, taken, sections) {
    let action = option(section, "action", "");
    let section_name = section[".name"];
    if (!valid_section_name(section_name))
        runtime_generate_unsupported("section name is not safe for sing-box config generation");
    let unsupported_matcher = unsupported_matcher_key(section);
    if (unsupported_matcher != "")
        runtime_generate_unsupported("section has unsupported matcher " + unsupported_matcher);

    if (connections.is_connections_action(action))
        add_connections_outbound(config, section, taken);
    else if (action == "zapret")
        add_zapret_outbound(config, section, sections);
    else if (action == "zapret2")
        add_zapret2_outbound(config, section, sections);
    else if (action == "byedpi")
        add_byedpi_outbound(config, section, sections);
    else if (action == "bypass") {
        /* route-only action */
    }
    else if (action == "block") {
        /* route-only action */
    }
    else if (action == "dns") {
        add_dns_server_for_section(config, section);
    }
    else {
        runtime_generate_unsupported("unsupported action " + action);
    }
}

function reserve_section_outbound_tags(sections, taken) {
    for (let section in sections) {
        let action = option(section, "action", "");
        if (connections.is_connections_action(action) ||
            action == "byedpi" || action == "zapret" || action == "zapret2")
            taken[outbound_tag(section[".name"])] = true;

    }
}

function add_route_for_section(config, section) {
    if (option(section, "action", "") == "dns")
        add_dns_action_rules_for_section(config, section);
    else
        add_combined_route_for_section(config, section);
}

function add_service_route_rules(config, sections) {
    let first = first_outbound_section(sections);
    if (first != null) {
        if (option(first, "action", "") == "byedpi")
            push(config.route.rules, {
                action: "resolve",
                inbound: tproxy_inbound_matcher(),
                domain: runtime_constants.CHECK_PROXY_IP_DOMAIN,
                server: runtime_constants.DNS_SERVER_TAG
            });
        push(config.route.rules, {
            action: "route",
            inbound: tproxy_inbound_matcher(),
            outbound: outbound_tag(first[".name"]),
            domain: runtime_constants.CHECK_PROXY_IP_DOMAIN
        });
    }
    push(config.route.rules, {
        action: "route-options",
        domain: runtime_constants.FAKEIP_TEST_DOMAIN,
        override_port: 8443
    });
}

function deferred_section_set(value) {
    let result = {};
    for (let name in split(trim(as_string(value)), /[ \t\r\n]+/)) {
        name = as_string(name);
        if (name != "")
            result[name] = true;
    }
    return result;
}

function enabled_sections(deferred_sections) {
    let deferred = deferred_section_set(deferred_sections);
    let result = [];
    uci_cursor().foreach(CONFIG_NAME, "section", function(section) {
        if (section_enabled(section) && !deferred[as_string(section[".name"])])
            push(result, section);
    });
    return result;
}

function runtime_sections(sections) {
    let result = [];
    for (let section in sections)
        if (!connections.is_connections_action(option(section, "action", "")) || connections.has_connection_sources(section))
            push(result, section);
    return result;
}

function enabled_servers() {
    let result = [];
    uci_cursor().foreach(CONFIG_NAME, "server", function(section) {
        if (server_enabled(section))
            push(result, section);
    });
    return result;
}

function section_by_name(sections, name) {
    name = as_string(name);
    for (let section in sections)
        if (as_string(section[".name"]) == name)
            return section;
    return null;
}

function has_direct_tailscale_server(servers) {
    for (let server in servers)
        if (option(server, "protocol", "vless") == "tailscale" &&
            option(server, "routing_mode", "rules") == "direct")
            return true;
    return false;
}

// The rule a routing mode turns into. "rules" has no single rule of its own: it
// clones the shared set onto the inbound, so it is handled by the caller.
function server_route_rule(sections, routing_mode, routing_section_name, label) {
    if (routing_mode == "direct")
        return { action: "route", outbound: runtime_constants.DIRECT_OUTBOUND_TAG };

    if (routing_mode != "section")
        runtime_generate_unsupported("unsupported " + label + " routing_mode " + routing_mode);

    let routing_section = section_by_name(sections, routing_section_name);
    if (routing_section == null)
        runtime_generate_unsupported(label + " references missing routing section " + routing_section_name);
    let action = option(routing_section, "action", "");
    if (action == "bypass" || action == "block")
        runtime_generate_unsupported(label + " routing section " + routing_section_name + " cannot use action " + action);
    let target = runtime_route.target(routing_section, outbound_tag(routing_section[".name"]));
    if (target.unsupported)
        runtime_generate_unsupported(target.unsupported);

    let rule = { action: target.action };
    if (target.outbound)
        rule.outbound = target.outbound;
    return rule;
}

// Accounts that take their own route. sing-box matches a rule on the user name, so
// one client can go straight out while the rest of the server follows its own mode.
// An account that follows the shared rules needs no rule of its own when its server
// already clones them; when it does not, the set is cloned for that account alone.
function add_server_client_routes(config, server, sections, inbound, server_mode) {
    for (let client in connections.server_clients(server)) {
        if (!bool_option(client, "routing_override", false))
            continue;

        let name = option(client, "name", "");
        if (name == "")
            continue;

        let client_mode = option(client, "routing_mode", "direct");
        if (client_mode == "rules") {
            if (server_mode != "rules")
                runtime_servers.clone_rules_for_inbound(
                    config,
                    runtime_constants.TPROXY_INBOUND_TAG,
                    inbound,
                    runtime_constants.CHECK_PROXY_IP_DOMAIN,
                    name
                );
            continue;
        }

        let rule = server_route_rule(
            sections,
            client_mode,
            option(client, "routing_section", ""),
            "server client '" + name + "'"
        );
        rule.inbound = inbound;
        // auth_user, not user: a route rule has no user field, and sing-box drops the
        // whole rule without a word when it finds one, so the account took the route
        // of its server instead of its own.
        rule.auth_user = name;
        push(config.route.rules, rule);
    }
}

function add_server_routes(config, servers, sections) {
    for (let server in servers) {
        runtime_servers.add_sniff_rule(config, server);

        let inbound = runtime_constants.server_inbound_tag(connections.server_display_name(server));
        let routing_mode = option(server, "routing_mode", "rules");
        add_server_client_routes(config, server, sections, inbound, routing_mode);
        if (routing_mode == "rules") {
            runtime_servers.clone_rules_for_inbound(
                config,
                runtime_constants.TPROXY_INBOUND_TAG,
                inbound,
                runtime_constants.CHECK_PROXY_IP_DOMAIN
            );
        }
        else {
            let rule = server_route_rule(
                sections,
                routing_mode,
                option(server, "routing_section", ""),
                "server"
            );
            rule.inbound = inbound;
            push(config.route.rules, rule);
        }
    }
}

function generate_config(output_path, service_address, mwan3_active, deferred_sections) {
    let cursor = uci_cursor();
    cursor.load(CONFIG_NAME);
    runtime_settings_cache = object_or_empty(cursor.get_all(CONFIG_NAME, "settings"));
    let settings = runtime_settings_cache;

    // A Connection section without a single source contributes no outbound and no
    // route, so counting enabled sections let an unfinished one pass the check and
    // Forkop started on a config that routes nothing while it still hijacks the DNS
    // of the whole network. Only sections that survive to the runtime graph count.
    let sections = runtime_sections(enabled_sections(deferred_sections));
    let servers = enabled_servers();
    if (length(sections) == 0 && length(servers) == 0 && trim(as_string(deferred_sections)) == "")
        runtime_generate_unsupported("no usable sections or servers");

    runtime_dns_capture = dns_capture_enabled(settings);
    let system_aware_dns = runtime_dns_capture && system_aware_dns_enabled(sections);
    let config = base_config(settings, service_address, {
        mwan3_active: cli_bool(mwan3_active),
        source_aware_dns: runtime_dns_capture,
        system_aware_dns,
        direct_server_route: has_direct_tailscale_server(servers)
    });
    if (runtime_dns_capture)
        add_source_aware_dns_support(config);
    let static_hosts = static_hosts_config();
    add_static_hosts_support(config, static_hosts);
    let taken = reserved_runtime_tag_set(config.outbounds);
    reserve_section_outbound_tags(sections, taken);
    for (let server in servers)
        runtime_servers.add_server(config, server);
    for (let section in sections)
        add_outbound_for_section(config, section, taken, sections);
    add_service_route_rules(config, sections);
    for (let section in sections)
        add_route_for_section(config, section);
    add_static_hosts_dns_rule(config, static_hosts);
    if (runtime_dns_capture)
        add_source_aware_dns_fallback(config, system_aware_dns);
    add_server_routes(config, servers, sections);
    add_service_mixed_proxy(config, settings, sections);

    assert_unique_outbound_tags(config);
    strip_internal_fields(config);
    if (!write_json_file(output_path, config)) {
        warn("failed to write ", output_path, "\n");
        exit(1);
    }
}

function generate_config_fixture(fixture_path, output_path, service_address, mwan3_active, deferred_sections) {
    use_fixture_cursor(fixture_path);
    generate_config(output_path, service_address, mwan3_active, deferred_sections);
}

function stdin_contains(needle) {
    return index(read_stdin(), as_string(needle)) >= 0;
}

let mode = ARGV[0] || "";

if (mode == "generate-config")
    generate_config(ARGV[1], ARGV[2], ARGV[3], ARGV[4] || "");
else if (mode == "generate-config-fixture")
    generate_config_fixture(ARGV[1], ARGV[2], ARGV[3], ARGV[4], ARGV[5] || "");
else if (mode == "stdin-contains")
    exit(stdin_contains(ARGV[1]) ? 0 : 1);
else {
    warn("Usage: singbox/generator.uc <operation> ...\n");
    exit(1);
}
