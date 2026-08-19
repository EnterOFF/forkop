#!/usr/bin/env ucode

let common = require("core.common");
let uci_core = require("core.uci");
let rule_config = require("config.rule");

let as_string = common.as_string;
let object_or_empty = common.object_or_empty;

const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || "forkop";
const SYSTEM_DEVICE_VALUE = "@system";
const DEFAULT_DOMAIN_RESOLVER_DNS_SERVER = "8.8.8.8";
const ITEM_TYPES = [
    "section",
    "server",
    "subscription_url",
    "section_interface",
    "urltest",
    "fallback_group",
    "fallback_level",
    "tunnel",
    "tunnel_peer"
];
const AMNEZIA_INTEGER_KEYS = [ "jc", "jmin", "jmax", "s1", "s2", "s3", "s4" ];
const AMNEZIA_RANGE_KEYS = [ "h1", "h2", "h3", "h4", "content_padding_addition", "rekey_after_time", "rekey_timeout", "reject_after_time", "keepalive_timeout", "max_handshake_attempts" ];
const AMNEZIA_KEYS = [ "jc", "jmin", "jmax", "s1", "s2", "s3", "s4", "h1", "h2", "h3", "h4", "content_padding_addition", "rekey_after_time", "rekey_timeout", "reject_after_time", "keepalive_timeout", "max_handshake_attempts", "i1", "i2", "i3", "i4", "i5", "header_protection_key" ];
const WARP_AMNEZIA_KEYS = [ "jc", "jmin", "jmax", "i1", "i2", "i3", "i4", "i5", "content_padding_addition", "rekey_after_time", "rekey_timeout", "reject_after_time", "keepalive_timeout", "max_handshake_attempts" ];

let item_sections = null;

function raw_option(section, key) {
    return object_or_empty(section)[key];
}

function option(section, key, fallback) {
    return common.option(section, key, fallback);
}

function bool_value(value, fallback) {
    if (value == null || value == "")
        return !!fallback;

    value = as_string(value);
    return value == "1" || value == "true" || value == "yes" || value == "on";
}

function bool_option(section, key, fallback) {
    return bool_value(raw_option(section, key), fallback);
}

function list_value(section, key) {
    let value = raw_option(section, key);
    if (value == null)
        return [];
    if (type(value) == "array")
        return value;

    value = as_string(value);
    return value == "" ? [] : [ value ];
}

function list_contains(values, value) {
    for (let item in values)
        if (item == value)
            return true;
    return false;
}

function device_matchers(section, key) {
    let raw = raw_option(section, key);
    let values = type(raw) == "array"
        ? raw
        : rule_config.text_list_values(raw, "comma-space");
    let text_values = rule_config.text_list_values(option(section, key + "_text", ""), "comma-space");

    if (bool_option(section, key + "_text_mode", false) || bool_option(section, "conditions_text_mode", false))
        values = text_values;
    else if (length(values) == 0)
        values = text_values;

    let result = { selected: length(values) > 0, system: false, ips: [] };
    let seen = {};
    for (let value in values) {
        value = trim(as_string(value));
        if (value == SYSTEM_DEVICE_VALUE)
            result.system = true;
        else {
            let normalized = rule_config.normalize_domain_subnet_value(value, "subnets");
            if (normalized != null && !seen[normalized]) {
                seen[normalized] = true;
                push(result.ips, normalized);
            }
        }
    }
    return result;
}

function whitespace_list_value(section, key) {
    let value = raw_option(section, key);
    if (type(value) == "array")
        return value;
    return common.list_option(section, key);
}

function section_name(section) {
    return option(section, ".name", "");
}

function display_name(section) {
    section = object_or_empty(section);
    let name = trim(option(section, "label", ""));
    return name != "" ? name : section_name(section);
}

function empty_item_sections() {
    let result = {};
    for (let type_name in ITEM_TYPES) {
        result[type_name] = {
            by_name: {},
            list: []
        };
    }
    return result;
}

function add_item_section(index, type_name, section) {
    section = object_or_empty(section);
    let name = section_name(section);
    if (name == "")
        return;

    if (index[type_name] == null)
        index[type_name] = { by_name: {}, list: [] };
    index[type_name].by_name[name] = section;
    push(index[type_name].list, section);
}

function item_index_from_cursor(cursor, config_name) {
    let index = empty_item_sections();
    if (cursor == null)
        return index;

    config_name = as_string(config_name || CONFIG_NAME);
    for (let type_name in ITEM_TYPES) {
        try {
            cursor.foreach(config_name, type_name, function(section) {
                add_item_section(index, type_name, section);
            });
        }
        catch (e) {
        }
    }

    return index;
}

function fixture_section_list(data, type_name) {
    data = object_or_empty(data);
    let value = data[type_name];
    if (type(value) == "array")
        return value;
    if (type(value) == "object")
        return [ value ];

    let plural = data[type_name + "s"];
    return type(plural) == "array" ? plural : [];
}

function item_index_from_data(data) {
    let index = empty_item_sections();
    for (let type_name in ITEM_TYPES)
        for (let section in fixture_section_list(data, type_name))
            add_item_section(index, type_name, section);
    return index;
}

function item_index_from_uci() {
    let index = empty_item_sections();
    for (let type_name in ITEM_TYPES)
        for (let section in uci_core.section_objects(CONFIG_NAME, type_name))
            add_item_section(index, type_name, section);
    return index;
}

function set_item_sections(index) {
    item_sections = type(index) == "object" ? index : empty_item_sections();
}

function set_item_sections_from_cursor(cursor, config_name) {
    set_item_sections(item_index_from_cursor(cursor, config_name));
}

function set_item_sections_from_data(data) {
    set_item_sections(item_index_from_data(data));
}

function get_item_sections() {
    if (item_sections == null)
        item_sections = item_index_from_uci();
    return item_sections;
}

function child_section(type_name, item_id) {
    return object_or_empty(object_or_empty(object_or_empty(get_item_sections())[type_name]).by_name)[as_string(item_id)];
}

function named_display_name(type_name, value) {
    if (type(value) == "object")
        return display_name(value);
    let section = child_section(type_name, value);
    return type(section) == "object" ? display_name(section) : as_string(value);
}

function section_display_name(value) {
    return named_display_name("section", value);
}

function section_exists(value) {
    return type(child_section("section", value)) == "object";
}

function server_display_name(value) {
    return named_display_name("server", value);
}

function owned_child_section(parent, type_name, item_id) {
    let child = child_section(type_name, item_id);
    if (type(child) != "object")
        return null;
    return option(child, "section", "") == section_name(parent) ? child : null;
}

function child_items(parent, type_name) {
    let result = [];
    for (let child in object_or_empty(object_or_empty(get_item_sections())[type_name]).list || [])
        if (option(child, "section", "") == section_name(parent))
            push(result, child);
    return result;
}

function child_items_by_owner(type_name, owner_key, owner_value) {
    owner_value = as_string(owner_value);
    let result = [];
    for (let child in object_or_empty(object_or_empty(get_item_sections())[type_name]).list || [])
        if (option(child, owner_key, "") == owner_value)
            push(result, child);
    return result;
}

function child_item_by_value(parent, type_name, value_key, value) {
    value = as_string(value);
    for (let child in child_items(parent, type_name))
        if (option(child, value_key, "") == value)
            return child;
    return null;
}

function child_option(child, key, fallback) {
    if (type(child) != "object")
        return as_string(fallback);
    return option(child, key, fallback);
}

function child_option_alias(child, keys, fallback) {
    if (type(child) != "object")
        return as_string(fallback);
    for (let key in keys) {
        let value = raw_option(child, key);
        if (value != null)
            return as_string(value);
    }
    return as_string(fallback);
}

function child_bool(child, key, fallback) {
    if (type(child) != "object")
        return !!fallback;
    return bool_option(child, key, fallback);
}

function child_list(child, key, fallback) {
    if (type(child) != "object")
        return fallback == null ? [] : fallback;
    let value = raw_option(child, key);
    if (value == null)
        value = fallback;
    if (value == null)
        return [];
    if (type(value) == "array")
        return value;

    value = as_string(value);
    return value == "" ? [] : [ value ];
}

function child_list_alias(child, keys, fallback) {
    if (type(child) == "object") {
        for (let key in keys) {
            let value = raw_option(child, key);
            if (value != null)
                return child_list(child, key, []);
        }
    }
    return fallback == null ? [] : fallback;
}

function child_values(parent, type_name, value_key, legacy_key) {
    let items = child_items(parent, type_name);
    if (length(items) > 0) {
        let result = [];
        for (let child in items) {
            let value = option(child, value_key, "");
            if (value != "")
                push(result, value);
        }
        return result;
    }
    return legacy_key == "" ? [] : whitespace_list_value(parent, legacy_key);
}

function settings_map(section, key) {
    let value = option(section, key, "");
    if (value == "")
        return {};

    try {
        value = json(value);
    }
    catch (e) {
        return {};
    }

    return object_or_empty(value);
}

function item_settings(section, key, item) {
    return object_or_empty(settings_map(section, key)[as_string(item)]);
}

function item_option(section, key, item, option_name, fallback) {
    let value = item_settings(section, key, item)[option_name];
    if (value == null)
        return as_string(fallback);
    return as_string(value);
}

function item_bool(section, key, item, option_name, fallback) {
    return bool_value(item_settings(section, key, item)[option_name], fallback);
}

function item_list(section, key, item, option_name, fallback) {
    let value = item_settings(section, key, item)[option_name];
    if (value == null)
        value = fallback;
    if (value == null)
        return [];
    if (type(value) == "array")
        return value;

    value = as_string(value);
    return value == "" ? [] : [ value ];
}

function is_legacy_connection_action(action) {
    action = as_string(action);
    return action == "proxy" || action == "outbound" || action == "vpn";
}

function is_connections_action(action) {
    action = as_string(action);
    return action == "connection" || is_legacy_connection_action(action);
}

function normalize_action(action) {
    action = as_string(action);
    return is_connections_action(action) ? "connection" : action;
}

function action(section) {
    return normalize_action(option(section, "action", ""));
}

function connection_urls(section) {
    return whitespace_list_value(section, "selector_proxy_links");
}

function subscription_urls(section) {
    return child_values(section, "subscription_url", "url", "subscription_urls");
}

function subscription_source_type(value) {
    value = lc(trim(as_string(value)));
    if (substr(value, 0, 7) == "http://" || substr(value, 0, 8) == "https://")
        return "remote";
    if (substr(value, 0, 1) == "/")
        return "local";
    return "";
}

function interfaces(section) {
    let items = child_values(section, "section_interface", "name", "");
    if (length(items) > 0)
        return items;

    let result = list_value(section, "interfaces");
    if (length(result) == 0) {
        let value = option(section, "interface", "");
        if (value != "")
            push(result, value);
    }
    return result;
}

function outbound_jsons(section) {
    let result = list_value(section, "outbound_jsons");
    if (length(result) == 0) {
        let value = option(section, "outbound_json", "");
        if (value != "")
            push(result, value);
    }
    return result;
}

function tunnel_sort(left, right) {
    let left_order = int(option(left, "order", "0"), 10);
    let right_order = int(option(right, "order", "0"), 10);
    if (left_order != right_order)
        return left_order < right_order ? -1 : 1;

    let left_name = section_name(left);
    let right_name = section_name(right);
    return left_name == right_name ? 0 : (left_name < right_name ? -1 : 1);
}

function tunnel_items(section) {
    let result = child_items(section, "tunnel");
    sort(result, tunnel_sort);
    return result;
}

function tunnels(section) {
    let result = [];
    for (let child in tunnel_items(section)) {
        let id = section_name(child);
        if (id != "")
            push(result, id);
    }
    return result;
}

function tunnel_child(section, value) {
    return owned_child_section(section, "tunnel", value);
}

function tunnel_peer_sort(left, right) {
    let left_order = int(option(left, "order", "0"), 10);
    let right_order = int(option(right, "order", "0"), 10);
    if (left_order != right_order)
        return left_order < right_order ? -1 : 1;

    let left_name = section_name(left);
    let right_name = section_name(right);
    return left_name == right_name ? 0 : (left_name < right_name ? -1 : 1);
}

function tunnel_peer_items(tunnel_id) {
    let result = child_items_by_owner("tunnel_peer", "tunnel", tunnel_id);
    sort(result, tunnel_peer_sort);
    return result;
}

function tunnel_endpoint(tunnel) {
    tunnel = object_or_empty(tunnel);
    let kind = lc(trim(as_string(option(tunnel, "kind", "wireguard"))));

    if (kind == "json") {
        try {
            let endpoint = json(option(tunnel, "endpoint_json", ""));
            return type(endpoint) == "object" ? endpoint : {};
        }
        catch (e) {
            return {};
        }
    }

    let endpoint = {
        type: kind == "amneziawg" ? "wireguard" : kind
    };

    if (kind == "tailscale") {
        endpoint.auth_key = trim(as_string(option(tunnel, "tailscale_auth_key", "")));
        endpoint.hostname = trim(as_string(option(tunnel, "tailscale_hostname", "")));
        endpoint.control_url = trim(as_string(option(tunnel, "tailscale_control_url", "https://controlplane.tailscale.com")));
        endpoint.accept_routes = bool_option(tunnel, "tailscale_accept_routes", true);
        endpoint.exit_node = trim(as_string(option(tunnel, "tailscale_exit_node", "")));
        let detour = trim(as_string(option(tunnel, "tailscale_detour_section", "")));
        if (detour != "")
            endpoint.detour = detour;
        return endpoint;
    }

    if (kind == "warp") {
        let keepalive = trim(as_string(option(tunnel, "warp_keepalive", "")));
        if (keepalive != "")
            endpoint.persistent_keepalive_interval = index(keepalive, "-") >= 0 ? keepalive : int(keepalive, 10);
        let profile = {};
        for (let key in [ "id", "auth_token", "private_key", "license_key" ]) {
            let value = trim(as_string(option(tunnel, "warp_profile_" + key, "")));
            if (value != "")
                profile[key] = value;
        }
        if (length(keys(profile)) > 0) {
            profile.recreate = true;
            endpoint.profile = profile;
        }
        let amnezia = {};
        for (let key in WARP_AMNEZIA_KEYS) {
            let value = trim(as_string(option(tunnel, "amnezia_" + key, "")));
            if (value != "")
                amnezia[key] = list_contains(AMNEZIA_INTEGER_KEYS, key) ||
                    (list_contains(AMNEZIA_RANGE_KEYS, key) && index(value, "-") < 0) ? int(value, 10) : value;
        }
        if (length(keys(amnezia)) > 0)
            endpoint.amnezia = amnezia;
        return endpoint;
    }

    endpoint.address = list_value(tunnel, "address");
    endpoint.private_key = trim(as_string(option(tunnel, "private_key", "")));
    let listen_port = int(option(tunnel, "listen_port", "0"), 10);
    if (listen_port > 0)
        endpoint.listen_port = listen_port;
    let mtu = int(option(tunnel, "mtu", "0"), 10);
    if (mtu > 0)
        endpoint.mtu = mtu;

    endpoint.peers = [];
    for (let peer in tunnel_peer_items(section_name(tunnel))) {
        let item = {
            address: trim(as_string(option(peer, "address", ""))),
            port: int(option(peer, "port", "0"), 10),
            public_key: trim(as_string(option(peer, "public_key", ""))),
            allowed_ips: list_value(peer, "allowed_ips")
        };
        let pre_shared_key = trim(as_string(option(peer, "pre_shared_key", "")));
        if (pre_shared_key != "")
            item.pre_shared_key = pre_shared_key;
        let keepalive = trim(as_string(option(peer, "persistent_keepalive_interval", "")));
        if (keepalive != "")
            item.persistent_keepalive_interval = index(keepalive, "-") >= 0 ? keepalive : int(keepalive, 10);
        push(endpoint.peers, item);
    }

    if (kind == "amneziawg") {
        let amnezia = {};
        for (let key in AMNEZIA_KEYS) {
            let value = trim(as_string(option(tunnel, "amnezia_" + key, "")));
            if (value != "") {
                if (list_contains(AMNEZIA_INTEGER_KEYS, key) ||
                    (list_contains(AMNEZIA_RANGE_KEYS, key) && index(value, "-") < 0))
                    amnezia[key] = int(value, 10);
                else
                    amnezia[key] = value;
            }
        }
        endpoint.amnezia = amnezia;
    }

    return endpoint;
}

function tunnels_signature(section) {
    let result = [];
    for (let tunnel_id in tunnels(section)) {
        let tunnel = tunnel_child(section, tunnel_id);
        push(result, {
            id: tunnel_id,
            order: option(tunnel, "order", "0"),
            name: option(tunnel, "name", ""),
            kind: option(tunnel, "kind", ""),
            endpoint: tunnel_endpoint(tunnel)
        });
    }
    return sprintf("%J", result);
}

function urltests(section) {
    let result = [];
    for (let child in child_items(section, "urltest")) {
        let id = section_name(child);
        if (id != "")
            push(result, id);
    }
    if (length(result) > 0)
        return result;

    return bool_option(section, "urltest_enabled", false) ? [ "urltest" ] : [];
}

function fallback_groups(section) {
    let result = [];
    for (let child in child_items(section, "fallback_group")) {
        let id = section_name(child);
        if (id != "")
            push(result, id);
    }
    return result;
}

function fallback_group_child(section, value) {
    return owned_child_section(section, "fallback_group", value);
}

function fallback_group_settings(section, value) {
    let child = fallback_group_child(section, value);
    return child != null ? child : {};
}

function fallback_level_child(group_id, value) {
    let child = child_section("fallback_level", value);
    if (type(child) != "object")
        return null;
    return option(child, "group", "") == as_string(group_id) ? child : null;
}

function fallback_level_sort(left, right) {
    let left_order = int(option(left, "order", "0"), 10);
    let right_order = int(option(right, "order", "0"), 10);
    if (left_order != right_order)
        return left_order < right_order ? -1 : 1;

    let left_name = section_name(left);
    let right_name = section_name(right);
    return left_name == right_name ? 0 : (left_name < right_name ? -1 : 1);
}

function fallback_level_items(group_id) {
    let result = child_items_by_owner("fallback_level", "group", group_id);
    sort(result, fallback_level_sort);
    return result;
}

function fallback_levels(group_id) {
    let result = [];
    for (let child in fallback_level_items(group_id)) {
        let id = section_name(child);
        if (id != "")
            push(result, id);
    }
    return result;
}

function community_lists(section) {
    return whitespace_list_value(section, "community_lists");
}

function rule_sets(section) {
    return whitespace_list_value(section, "rule_set");
}

function rule_sets_with_subnets(section) {
    return whitespace_list_value(section, "rule_set_with_subnets");
}

function combined_domain_condition_text(section) {
    if (type(raw_option(section, "domain")) != "array") {
        let value = option(section, "domain", "");
        if (value != "")
            return value;
    }

    return option(section, "domain_suffix_text", "");
}

function rule_condition_csv(section, key, kind) {
    return rule_config.rule_condition_csv_value(
        key,
        kind,
        option(section, key + "_text_mode", "0"),
        option(section, "conditions_text_mode", "0"),
        option(section, key + "_text", ""),
        option(section, key, ""),
        combined_domain_condition_text(section),
        option(section, "domain_suffix", "")
    );
}

function has_dns_matchers(section) {
    return rule_condition_csv(section, "domain", "domains") != "" ||
        rule_condition_csv(section, "domain_suffix", "domains") != "" ||
        rule_condition_csv(section, "domain_keyword", "generic") != "" ||
        rule_condition_csv(section, "domain_regex", "generic") != "" ||
        length(community_lists(section)) > 0 ||
        length(rule_sets(section)) > 0 ||
        length(rule_sets_with_subnets(section)) > 0;
}

function list_option_value_from_array(values) {
    return join(" ", values || []);
}

function community_lists_value(section) {
    return list_option_value_from_array(community_lists(section));
}

function rule_sets_value(section) {
    return list_option_value_from_array(rule_sets(section));
}

function rule_sets_with_subnets_value(section) {
    return list_option_value_from_array(rule_sets_with_subnets(section));
}

function has_connection_sources(section) {
    return length(connection_urls(section)) > 0 ||
        length(subscription_urls(section)) > 0 ||
        length(interfaces(section)) > 0 ||
        length(outbound_jsons(section)) > 0 ||
        length(tunnels(section)) > 0;
}

function subscription_url_settings(section, value) {
    let child = child_item_by_value(section, "subscription_url", "url", value);
    return child != null ? child : item_settings(section, "subscription_url_settings", value);
}

function interface_settings(section, value) {
    let child = child_item_by_value(section, "section_interface", "name", value);
    return child != null ? child : item_settings(section, "interface_settings", value);
}

function interface_display_name(section, value) {
    let child = child_item_by_value(section, "section_interface", "name", value);
    let display_name = child != null ? trim(child_option(child, "display_name", value)) : "";
    return display_name != "" ? display_name : value;
}

function interface_domain_resolver_enabled(section, value) {
    let child = child_item_by_value(section, "section_interface", "name", value);
    if (child != null)
        return child_bool(child, "domain_resolver_enabled", false);
    return item_bool(section, "interface_settings", value, "domain_resolver_enabled",
        bool_option(section, "domain_resolver_enabled", false));
}

function interface_domain_resolver_dns_servers(section, value) {
    let child = child_item_by_value(section, "section_interface", "name", value);
    let values = child != null
        ? child_list(child, "domain_resolver_dns_server", null)
        : item_list(section, "interface_settings", value, "domain_resolver_dns_server", null);
    let result = [];
    for (let entry in values) {
        entry = trim(as_string(entry));
        if (entry != "")
            push(result, entry);
    }
    return length(result) > 0 ? result : [ DEFAULT_DOMAIN_RESOLVER_DNS_SERVER ];
}

function interface_domain_resolver_dns_fallback_strategy(section, value) {
    let child = child_item_by_value(section, "section_interface", "name", value);
    let strategy = child_option(child, "domain_resolver_dns_fallback_strategy", "parallel");
    return strategy != "" ? strategy : "parallel";
}

function interface_domain_resolver_dns_detour_enabled(section, value) {
    let child = child_item_by_value(section, "section_interface", "name", value);
    return child_bool(child, "domain_resolver_dns_detour_enabled", false);
}

function interface_domain_resolver_dns_detour_section(section, value) {
    let child = child_item_by_value(section, "section_interface", "name", value);
    return interface_domain_resolver_dns_detour_enabled(section, value)
        ? child_option(child, "domain_resolver_dns_detour_section", "")
        : "";
}

function urltest_child(section, value) {
    let child = owned_child_section(section, "urltest", value);
    if (child != null)
        return child;

    return child_item_by_value(section, "urltest", "id", value);
}

function urltest_settings(section, value) {
    let child = urltest_child(section, value);
    return child != null ? child : item_settings(section, "urltest_settings", value);
}

function subscription_update_enabled(section, value) {
    if (subscription_source_type(value) != "remote")
        return false;
    let child = child_item_by_value(section, "subscription_url", "url", value);
    if (child != null)
        return child_bool(child, "subscription_update_enabled", true);
    return item_bool(section, "subscription_url_settings", value, "subscription_update_enabled",
        bool_option(section, "subscription_update_enabled", true));
}

function subscription_update_interval(section, value) {
    if (subscription_source_type(value) != "remote")
        return "";
    let child = child_item_by_value(section, "subscription_url", "url", value);
    if (child != null)
        return child_option(child, "subscription_update_interval", "1h");
    return item_option(section, "subscription_url_settings", value, "subscription_update_interval",
        option(section, "subscription_update_interval", "1h") || "1h");
}

function subscription_dashboard_metadata_enabled(section, value) {
    if (subscription_source_type(value) != "remote")
        return false;
    let child = child_item_by_value(section, "subscription_url", "url", value);
    if (child != null)
        return child_bool(child, "show_dashboard_metadata", true);
    return item_bool(section, "subscription_url_settings", value, "show_dashboard_metadata", true);
}

function subscription_headers(section, value) {
    if (subscription_source_type(value) != "remote")
        return [];
    let child = child_item_by_value(section, "subscription_url", "url", value);
    if (child != null)
        return list_value(child, "header");

    let settings = item_settings(section, "subscription_url_settings", value);
    return list_value(settings, "header");
}

function subscription_show_name(section, value) {
    let child = child_item_by_value(section, "subscription_url", "url", value);
    if (child != null)
        return child_bool(child, "show_subscription_name", false);
    return item_bool(section, "subscription_url_settings", value, "show_subscription_name", false);
}

function subscription_tag(section, value, source_index) {
    let child = child_item_by_value(section, "subscription_url", "url", value);
    let tag_name = child != null
        ? child_option(child, "tag", "")
        : item_option(section, "subscription_url_settings", value, "tag", "");
    tag_name = trim(as_string(tag_name));
    return tag_name != "" ? tag_name : "sub" + int(source_index || 1);
}

function subscription_exclude_types(section, value) {
    let child = child_item_by_value(section, "subscription_url", "url", value);
    if (child != null)
        return child_list(child, "exclude_types", []);
    return item_list(section, "subscription_url_settings", value, "exclude_types", []);
}

// A rename rule is stored the way it is written: "pattern => replacement".
// The first separator wins, so a replacement may contain one itself.
function parse_rename_rule(value) {
    value = as_string(value);
    let separator = index(value, "=>");
    if (separator < 0)
        return null;

    let pattern = trim(substr(value, 0, separator));
    if (pattern == "")
        return null;

    return { pattern, target: trim(substr(value, separator + 2)) };
}

function subscription_override(section, value) {
    let settings = subscription_url_settings(section, value);
    return {
        prefix: option(settings, "override_prefix", ""),
        suffix: option(settings, "override_suffix", ""),
        rename: list_value(settings, "override_rename"),
        tcp_fast_open: option(settings, "override_tcp_fast_open", ""),
        tcp_multi_path: option(settings, "override_tcp_multi_path", ""),
        udp_fragment: option(settings, "override_udp_fragment", ""),
        connect_timeout: option(settings, "override_connect_timeout", ""),
        tls_insecure: option(settings, "override_tls_insecure", ""),
        tls_server_name: option(settings, "override_tls_server_name", ""),
        multiplex: option(settings, "override_multiplex", ""),
        multiplex_protocol: option(settings, "override_multiplex_protocol", ""),
        multiplex_max_streams: option(settings, "override_multiplex_max_streams", ""),
        patch: option(settings, "override_patch", "")
    };
}

function subscription_download_section(section, value) {
    if (subscription_source_type(value) != "remote")
        return "";
    let child = child_item_by_value(section, "subscription_url", "url", value);
    if (child != null) {
        if (!child_bool(child, "download_via_proxy_enabled", false))
            return "";
        return child_option(child, "download_via_proxy_section", "");
    }

    if (!item_bool(section, "subscription_url_settings", value, "download_via_proxy_enabled", false))
        return "";

    return item_option(section, "subscription_url_settings", value, "download_via_proxy_section", "");
}

function urltest_check_interval(section, value) {
    let child = urltest_child(section, value);
    if (child != null)
        return child_option_alias(child, [ "check_interval", "urltest_check_interval" ], "3m");
    return item_option(section, "urltest_settings", value, "urltest_check_interval",
        option(section, "urltest_check_interval", "3m") || "3m");
}

function urltest_tolerance(section, value) {
    let child = urltest_child(section, value);
    if (child != null)
        return child_option_alias(child, [ "tolerance", "urltest_tolerance" ], "50");
    return item_option(section, "urltest_settings", value, "urltest_tolerance",
        option(section, "urltest_tolerance", "50") || "50");
}

function urltest_testing_url(section, value) {
    let child = urltest_child(section, value);
    if (child != null)
        return child_option_alias(child, [ "testing_url", "urltest_testing_url" ], "https://www.gstatic.com/generate_204");
    return item_option(section, "urltest_settings", value, "urltest_testing_url",
        option(section, "urltest_testing_url", "https://www.gstatic.com/generate_204") || "https://www.gstatic.com/generate_204");
}

function urltest_expected_status(section, value) {
    let child = urltest_child(section, value);
    if (child != null)
        return child_option(child, "expected_status", "*");
    return item_option(section, "urltest_settings", value, "expected_status", "*");
}

function urltest_display_name(section, value) {
    let fallback = as_string(value);
    if (fallback == "urltest" && length(child_items(section, "urltest")) == 0)
        fallback = "Fastest";
    let child = urltest_child(section, value);
    if (child != null)
        return child_option_alias(child, [ "name", "display_name" ], fallback);
    return item_option(section, "urltest_settings", value, "display_name", fallback);
}

function urltest_idle_timeout(section, value) {
    let child = urltest_child(section, value);
    if (child != null)
        return child_option(child, "idle_timeout", "");
    return item_option(section, "urltest_settings", value, "idle_timeout", "");
}

function urltest_interrupt_exist_connections(section, value) {
    let child = urltest_child(section, value);
    if (child != null)
        return child_bool(child, "interrupt_exist_connections", false);
    return item_bool(section, "urltest_settings", value, "interrupt_exist_connections", false);
}

function urltest_filter_mode(section, value) {
    let child = urltest_child(section, value);
    if (child != null)
        return child_option(child, "server_filter_mode", "all");
    return item_option(section, "urltest_settings", value, "server_filter_mode",
        option(section, "urltest_server_filter_mode", "all"));
}

function urltest_hide_dashboard_members(section, value) {
    let child = urltest_child(section, value);
    return child != null ? child_bool(child, "hide_dashboard_members", false) : false;
}

function urltest_include_outbounds(section, value) {
    let child = urltest_child(section, value);
    if (child != null)
        return child_list_alias(child, [ "include_outbounds", "urltest_include_outbounds" ], []);
    return item_list(section, "urltest_settings", value, "urltest_include_outbounds",
        list_value(section, "urltest_include_outbounds"));
}

function urltest_include_regex(section, value) {
    let child = urltest_child(section, value);
    if (child != null)
        return child_option_alias(child, [ "include_regex", "urltest_include_regex" ], "");
    return item_option(section, "urltest_settings", value, "include_regex",
        option(section, "urltest_include_regex", ""));
}

function urltest_exclude_outbounds(section, value) {
    let child = urltest_child(section, value);
    if (child != null)
        return child_list_alias(child, [ "exclude_outbounds", "urltest_exclude_outbounds" ], []);
    return item_list(section, "urltest_settings", value, "urltest_exclude_outbounds",
        list_value(section, "urltest_exclude_outbounds"));
}

function urltest_exclude_regex(section, value) {
    let child = urltest_child(section, value);
    if (child != null)
        return child_option_alias(child, [ "exclude_regex", "urltest_exclude_regex" ], "");
    return item_option(section, "urltest_settings", value, "exclude_regex",
        option(section, "urltest_exclude_regex", ""));
}

function urltest_exclude_types(section, value) {
    let child = urltest_child(section, value);
    if (child != null)
        return child_list(child, "exclude_types", []);
    return item_list(section, "urltest_settings", value, "exclude_types", []);
}

function fallback_group_display_name(section, value) {
    let child = fallback_group_child(section, value);
    return child != null ? child_option(child, "name", as_string(value)) : as_string(value);
}

function fallback_group_health_check_url(section, value) {
    let child = fallback_group_child(section, value);
    return child != null ? child_option(child, "health_check_url", "https://www.gstatic.com/generate_204") : "https://www.gstatic.com/generate_204";
}

function fallback_group_health_check_interval(section, value) {
    let child = fallback_group_child(section, value);
    return child != null ? child_option(child, "health_check_interval", "5m") : "5m";
}

function fallback_group_health_check_timeout(section, value) {
    let child = fallback_group_child(section, value);
    return child != null ? child_option(child, "health_check_timeout", "5s") : "5s";
}

function fallback_group_attempt_timeout(section, value) {
    let child = fallback_group_child(section, value);
    return child != null ? child_option(child, "attempt_timeout", "5s") : "5s";
}

function fallback_group_expected_status(section, value) {
    let child = fallback_group_child(section, value);
    return child != null ? child_option(child, "expected_status", "*") : "*";
}

function fallback_group_idle_timeout(section, value) {
    let child = fallback_group_child(section, value);
    return child != null ? child_option(child, "idle_timeout", "5m") : "5m";
}

function fallback_group_interrupt_exist_connections(section, value) {
    let child = fallback_group_child(section, value);
    return child != null ? child_bool(child, "interrupt_exist_connections", false) : false;
}

function fallback_group_hide_dashboard_members(section, value) {
    let child = fallback_group_child(section, value);
    return child != null ? child_bool(child, "hide_dashboard_members", false) : false;
}

function fallback_level_display_name(group_id, value) {
    let child = fallback_level_child(group_id, value);
    return child != null ? child_option(child, "name", as_string(value)) : as_string(value);
}

function fallback_level_order(group_id, value) {
    let child = fallback_level_child(group_id, value);
    return child != null ? child_option(child, "order", "0") : "0";
}

function fallback_level_mode(group_id, value) {
    let child = fallback_level_child(group_id, value);
    return child != null ? child_option(child, "server_filter_mode", "include") : "include";
}

function fallback_level_include_outbounds(group_id, value) {
    let child = fallback_level_child(group_id, value);
    return child != null ? child_list_alias(child, [ "include_outbounds", "server_name" ], []) : [];
}

function fallback_level_include_regex(group_id, value) {
    let child = fallback_level_child(group_id, value);
    return child != null ? child_option(child, "include_regex", "") : "";
}

function fallback_level_exclude_outbounds(group_id, value) {
    let child = fallback_level_child(group_id, value);
    return child != null ? child_list(child, "exclude_outbounds", []) : [];
}

function fallback_level_exclude_regex(group_id, value) {
    let child = fallback_level_child(group_id, value);
    return child != null ? child_option(child, "exclude_regex", "") : "";
}

function fallback_level_include_groups(group_id, value) {
    let child = fallback_level_child(group_id, value);
    return child != null ? child_list(child, "include_groups", []) : [];
}

function fallback_level_exclude_types(group_id, value) {
    let child = fallback_level_child(group_id, value);
    return child != null ? child_list(child, "exclude_types", []) : [];
}

function append_unique(result, seen, value) {
    value = as_string(value);
    if (value == "" || seen[value])
        return;
    seen[value] = true;
    push(result, value);
}

function subscription_download_targets(sections) {
    let result = [];
    let seen = {};

    for (let section in sections) {
        section = object_or_empty(section);
        let name = option(section, ".name", "");

        for (let source in subscription_urls(section)) {
            let target = subscription_download_section(section, source);
            if (target != "" && target != name)
                append_unique(result, seen, target);
        }
    }

    return result;
}

function subscription_download_target_port(sections, target, base_port) {
    target = as_string(target);
    base_port = int(base_port || 0);

    let targets = subscription_download_targets(sections);
    for (let i = 0; i < length(targets); i++)
        if (targets[i] == target)
            return base_port + 2 + i;

    return 0;
}

return {
    SYSTEM_DEVICE_VALUE,
    option,
    bool_option,
    list_value,
    device_matchers,
    whitespace_list_value,
    set_item_sections,
    set_item_sections_from_cursor,
    set_item_sections_from_data,
    settings_map,
    item_settings,
    item_option,
    item_bool,
    is_connections_action,
    normalize_action,
    action,
    connection_urls,
    subscription_urls,
    subscription_source_type,
    interfaces,
    outbound_jsons,
    tunnels,
    tunnel_items,
    tunnel_child,
    tunnel_peer_items,
    tunnel_endpoint,
    tunnels_signature,
    urltests,
    community_lists,
    rule_sets,
    rule_sets_with_subnets,
    has_dns_matchers,
    community_lists_value,
    rule_sets_value,
    rule_sets_with_subnets_value,
    has_connection_sources,
    subscription_url_settings,
    interface_settings,
    urltest_settings,
    subscription_update_enabled,
    subscription_update_interval,
    subscription_dashboard_metadata_enabled,
    subscription_headers,
    subscription_show_name,
    subscription_exclude_types,
    subscription_override,
    parse_rename_rule,
    subscription_tag,
    subscription_download_section,
    interface_display_name,
    interface_domain_resolver_enabled,
    interface_domain_resolver_dns_servers,
    interface_domain_resolver_dns_fallback_strategy,
    interface_domain_resolver_dns_detour_enabled,
    interface_domain_resolver_dns_detour_section,
    urltest_check_interval,
    urltest_tolerance,
    urltest_testing_url,
    urltest_expected_status,
    urltest_display_name,
    urltest_idle_timeout,
    urltest_interrupt_exist_connections,
    urltest_filter_mode,
    urltest_hide_dashboard_members,
    urltest_include_outbounds,
    urltest_include_regex,
    urltest_exclude_outbounds,
    urltest_exclude_regex,
    urltest_exclude_types,
    fallback_groups,
    fallback_group_settings,
    fallback_levels,
    fallback_group_display_name,
    fallback_group_health_check_url,
    fallback_group_health_check_interval,
    fallback_group_health_check_timeout,
    fallback_group_attempt_timeout,
    fallback_group_expected_status,
    fallback_group_idle_timeout,
    fallback_group_interrupt_exist_connections,
    fallback_group_hide_dashboard_members,
    fallback_level_display_name,
    fallback_level_order,
    fallback_level_mode,
    fallback_level_include_outbounds,
    fallback_level_include_regex,
    fallback_level_exclude_outbounds,
    fallback_level_exclude_regex,
    fallback_level_exclude_types,
    fallback_level_include_groups,
    subscription_download_targets,
    subscription_download_target_port,
    section_display_name,
    section_exists,
    server_display_name
};
