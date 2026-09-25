#!/usr/bin/env ucode

// Forkop configuration migrations follow released config_version edges. The
// legacy applied_migrations list is discarded and never controls execution.

let fs = require("fs");
let common = require("core.common");
let uci_core = require("core.uci");
let core_url = require("core.url");
let singbox_constants_module = require("singbox.constants");
let runtime_dns = require("singbox.dns");
let subscription_headers_module = require("singbox.subscription_headers");
let domain_config = require("config.domain");

let as_string = common.as_string;
let read_json_file = common.read_json_file;
let write_json = common.write_json;
let option = common.option;
let list_option = common.list_option;
let bool_option = common.bool_option;
let object_or_empty = common.object_or_empty;

const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || "forkop";
const TMP_SUBSCRIPTION_FOLDER = getenv("TMP_SUBSCRIPTION_FOLDER") || "/tmp/sing-box/subscriptions";
const FORKOP_RUNTIME_STATE_DIR = getenv("FORKOP_RUNTIME_STATE_DIR") || "/var/run/forkop";
const FORKOP_SUBSCRIPTION_UPDATE_STATE_DIR = getenv("FORKOP_SUBSCRIPTION_UPDATE_STATE_DIR") || FORKOP_RUNTIME_STATE_DIR + "/subscription-update";
const FORKOP_SUBSCRIPTION_LINKS_DIR = getenv("FORKOP_SUBSCRIPTION_LINKS_DIR") || FORKOP_RUNTIME_STATE_DIR + "/subscription-links";
const FORKOP_SUBSCRIPTION_METADATA_DIR = getenv("FORKOP_SUBSCRIPTION_METADATA_DIR") || FORKOP_RUNTIME_STATE_DIR + "/subscription-metadata";
const FORKOP_OUTBOUND_METADATA_DIR = getenv("FORKOP_OUTBOUND_METADATA_DIR") || FORKOP_RUNTIME_STATE_DIR + "/outbound-metadata";
const FORKOP_SECTION_CACHE_DIR = getenv("FORKOP_SECTION_CACHE_DIR") || FORKOP_RUNTIME_STATE_DIR + "/section-cache";
const FORKOP_RUNTIME_MANIFEST_FILE = getenv("FORKOP_RUNTIME_MANIFEST_FILE") || FORKOP_RUNTIME_STATE_DIR + "/runtime-manifest.json";
const FORKOP_PERSISTENT_SUBSCRIPTION_CACHE_DIR = getenv("FORKOP_PERSISTENT_SUBSCRIPTION_CACHE_DIR") || "/etc/forkop/subscription-cache";
const FORKOP_SUBSCRIPTION_UPDATE_LOCK_DIR = getenv("FORKOP_SUBSCRIPTION_UPDATE_LOCK_DIR") || FORKOP_RUNTIME_STATE_DIR + "/subscription-update.lock";
const FORKOP_SUBSCRIPTION_UPDATE_JOB_DIR = getenv("FORKOP_SUBSCRIPTION_UPDATE_JOB_DIR") || FORKOP_RUNTIME_STATE_DIR + "/subscription-update-jobs";
const FORKOP_SUBSCRIPTION_BOOTSTRAP_RETRY_PID_FILE = getenv("FORKOP_SUBSCRIPTION_BOOTSTRAP_RETRY_PID_FILE") || FORKOP_RUNTIME_STATE_DIR + "/subscription-bootstrap-retry.pid";
const FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD = getenv("FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD") || "/var/run/forkop.internal-config-change";
const FORKOP_LEGACY_LIST_UPDATE_STATE_FILE = getenv("FORKOP_LEGACY_LIST_UPDATE_STATE_FILE") || FORKOP_RUNTIME_STATE_DIR + "/list-update.timestamp";
const FORKOP_LEGACY_LIST_UPDATE_PID_FILE = getenv("FORKOP_LEGACY_LIST_UPDATE_PID_FILE") || "/var/run/forkop_list_update.pid";
const FORKOP_LEGACY_RULESET_CACHE_DIR = getenv("FORKOP_LEGACY_RULESET_CACHE_DIR") || "/tmp/sing-box/rulesets";
const FORKOP_CRONTAB_BIN = getenv("FORKOP_CRONTAB_BIN") || "crontab";
const LEGACY_LIST_UPDATE_CRON_MARKER = "# forkop-list-update";
const LEGACY_SUBSCRIPTION_UPDATE_CRON_MARKER = "# forkop-subscription-update";
const CONFIG_VERSION_OPTION = "config_version";
const APPLIED_MIGRATIONS_OPTION = "applied_migrations";
const MIN_CONFIG_VERSION = "1.0.2";
const LATEST_SOURCE_VERSION = "1.0.5";
const DEFAULT_CONFIG_PATH = getenv("FORKOP_DEFAULT_CONFIG_PATH") || "/usr/share/forkop/default-config";
const RUNTIME_CONFIG_PATH = getenv("FORKOP_CONFIG_PATH") || "/etc/config/" + CONFIG_NAME;
const CHILD_ITEM_TYPES = [
    "server_client",
    "subscription_url",
    "section_interface",
    "urltest",
    "fallback_group",
    "fallback_level",
    "priority_group",
    "priority_level",
    "tunnel",
    "tunnel_peer"
];

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function command_result(command) {
    let pipe = fs.popen(command, "r");
    if (!pipe)
        return { ok: false, status: -1, output: "" };

    let data = pipe.read("all");
    let status = pipe.close();
    return {
        ok: status == 0,
        status,
        output: replace(as_string(data), /[\r\n]+$/g, "")
    };
}

function command_output(command) {
    let result = command_result(command);
    return result.ok ? result.output : "";
}

function run(command) {
    return system(command) == 0;
}

function report_migration_error(message) {
    let text = "Forkop configuration migration failed: " + as_string(message);
    warn("[error] " + text + "\n");
    run("logger -t " + shell_quote("forkop") + " " + shell_quote("[error] " + text));
}

function section_name(section) {
    return option(section, ".name", "");
}

function target_config_version() {
    let data = as_string(fs.readfile(DEFAULT_CONFIG_PATH) || "");
    for (let line in split(data, "\n")) {
        let matched = match(line, /^\s*option\s+config_version\s+['\"]([^'\"]+)['\"]\s*$/);
        if (matched)
            return trim(matched[1]);
    }
    return "";
}

function clone_section(section) {
    let result = {};
    for (let key in keys(object_or_empty(section)))
        result[key] = section[key];
    return result;
}

function fixture_section_list(data, type_name) {
    let value = object_or_empty(data)[type_name];
    if (type(value) == "array")
        return value;
    if (type(value) == "object")
        return [ value ];

    let plural = object_or_empty(data)[type_name + "s"];
    return type(plural) == "array" ? plural : [];
}

function model_from_fixture(path) {
    let data = object_or_empty(read_json_file(path));
    let model = {
        settings: clone_section(object_or_empty(data.settings)),
        sections: [],
        servers: []
    };
    for (let type_name in CHILD_ITEM_TYPES)
        model[type_name] = [];

    if (model.settings[".name"] == null)
        model.settings[".name"] = "settings";
    if (model.settings[".type"] == null)
        model.settings[".type"] = "settings";

    for (let section in fixture_section_list(data, "section"))
        push(model.sections, clone_section(section));
    for (let section in fixture_section_list(data, "server"))
        push(model.servers, clone_section(section));
    for (let type_name in CHILD_ITEM_TYPES)
        for (let section in fixture_section_list(data, type_name))
            push(model[type_name], clone_section(section));

    return model;
}

function model_from_uci(cursor) {
    let model = {
        settings: clone_section(object_or_empty(cursor.get_all(CONFIG_NAME, "settings"))),
        sections: [],
        servers: []
    };
    for (let type_name in CHILD_ITEM_TYPES)
        model[type_name] = [];

    cursor.foreach(CONFIG_NAME, "section", function(section) {
        push(model.sections, clone_section(section));
    });
    cursor.foreach(CONFIG_NAME, "server", function(section) {
        push(model.servers, clone_section(section));
    });
    for (let type_name in CHILD_ITEM_TYPES) {
        cursor.foreach(CONFIG_NAME, type_name, function(section) {
            push(model[type_name], clone_section(section));
        });
    }

    return model;
}

function export_model(model) {
    let result = {
        settings: model.settings,
        section: model.sections
    };
    if (length(model.servers) > 0)
        result.server = model.servers;
    for (let type_name in CHILD_ITEM_TYPES)
        if (length(model[type_name] || []) > 0)
            result[type_name] = model[type_name];
    return result;
}

function migration_context(model) {
    return {
        model,
        operations: [],
        removed_caches: [],
        removed_cron_markers: [],
        warnings: [],
        added_lists: {},
        changed: false,
        error: null,
        reset: false
    };
}

function migration_error(ctx, message) {
    if (ctx.error == null)
        ctx.error = as_string(message);
    return ctx;
}

function record_operation(ctx, op) {
    push(ctx.operations, op);
    ctx.changed = true;
}

function option_exists(section, key) {
    return object_or_empty(section)[key] != null;
}

function set_option(ctx, section, key, value) {
    value = as_string(value);
    if (option(section, key, "") == value && option_exists(section, key))
        return;

    section[key] = value;
    record_operation(ctx, { op: "set", section: section_name(section), option: key, value });
}

function set_option_if_missing(ctx, section, key, value) {
    if (option_exists(section, key))
        return;
    set_option(ctx, section, key, value);
}

function list_values_equal(left, right) {
    if (length(left) != length(right))
        return false;

    for (let i = 0; i < length(left); i++)
        if (as_string(left[i]) != as_string(right[i]))
            return false;

    return true;
}

function set_list_option(ctx, section, key, values) {
    let normalized = [];
    for (let value in values) {
        value = as_string(value);
        if (value != "")
            push(normalized, value);
    }

    let current = object_or_empty(section)[key];
    let current_values = [];
    if (type(current) == "array")
        current_values = current;
    else if (current != null && as_string(current) != "")
        current_values = [ as_string(current) ];

    if (option_exists(section, key) && list_values_equal(current_values, normalized))
        return;

    section[key] = normalized;
    record_operation(ctx, { op: "set_list", section: section_name(section), option: key, values: normalized });
}

function delete_option(ctx, section, key) {
    if (!option_exists(section, key))
        return;

    delete section[key];
    record_operation(ctx, { op: "delete", section: section_name(section), option: key });
}

function list_contains(section, key, value) {
    value = as_string(value);
    for (let item in list_option(section, key))
        if (as_string(item) == value)
            return true;
    return false;
}

function add_list_unique(ctx, section, key, value) {
    value = as_string(value);
    if (value == "")
        return;

    let list_key = section_name(section) + "." + key + "=" + value;
    if (ctx.added_lists[list_key] || list_contains(section, key, value))
        return;

    let current = section[key];
    if (type(current) != "array")
        current = list_option(section, key);
    push(current, value);
    section[key] = current;
    ctx.added_lists[list_key] = true;
    record_operation(ctx, { op: "add_list", section: section_name(section), option: key, values: current });
}

function child_sections_by_owner(ctx, type_name, owner_option, owner_value) {
    let result = [];
    owner_value = as_string(owner_value);
    for (let child in ctx.model[type_name] || [])
        if (option(child, owner_option, "") == owner_value)
            push(result, child);
    return result;
}

function create_child_section(ctx, type_name) {
    ctx.child_index = int(ctx.child_index || 0) + 1;
    let item_id = "__" + type_name + "_" + ctx.child_index;
    let section = {
        ".name": item_id,
        ".type": type_name
    };
    if (ctx.model[type_name] == null)
        ctx.model[type_name] = [];
    push(ctx.model[type_name], section);
    record_operation(ctx, { op: "create", section: item_id, type: type_name, anonymous: true });
    return section;
}

function create_child_for_owner(ctx, parent, type_name, owner_option) {
    let child = create_child_section(ctx, type_name);
    let value = section_name(parent);
    child[owner_option] = value;
    record_operation(ctx, {
        op: "set",
        section: section_name(child),
        option: owner_option,
        value,
        section_reference: true
    });
    return child;
}

function option_list_values(section, key) {
    let value = object_or_empty(section)[key];
    if (type(value) == "array")
        return value;
    if (value == null)
        return [];
    value = as_string(value);
    return value == "" ? [] : [ value ];
}


function set_section_type(ctx, section, type_name) {
    if (option(section, ".type", "") == type_name)
        return;

    section[".type"] = type_name;
    record_operation(ctx, { op: "set_type", section: section_name(section), type: type_name });
}


function normalize_existing_list_option(ctx, section, key) {
    let current = object_or_empty(section)[key];
    if (current == null || type(current) == "array")
        return;

    let value = trim(as_string(current));
    let values = value == "" ? [] : [ value ];
    section[key] = values;
    record_operation(ctx, { op: "set_list", section: section_name(section), option: key, values });
}


function version_parts(value) {
    let matched = match(as_string(value), /^([0-9]+)\.([0-9]+)\.([0-9]+)$/);
    if (!matched)
        return null;
    return [ int(matched[1]), int(matched[2]), int(matched[3]) ];
}

function compare_versions(left, right) {
    left = version_parts(left);
    right = version_parts(right);
    for (let i = 0; i < 3; i++) {
        if (left[i] < right[i])
            return -1;
        if (left[i] > right[i])
            return 1;
    }
    return 0;
}

// Released 1.0.2 -> 1.0.5.

function hex_digit_value(value) {
    value = ord(lc(as_string(value)));
    if (value >= 48 && value <= 57)
        return value - 48;
    if (value >= 97 && value <= 102)
        return value - 87;
    return -1;
}

function percent_decode(value) {
    value = as_string(value);
    let result = "";
    for (let i = 0; i < length(value); i++) {
        let c = substr(value, i, 1);
        if (c == "+") {
            result += " ";
            continue;
        }
        if (c == "%") {
            let high = i + 1 < length(value) ? hex_digit_value(substr(value, i + 1, 1)) : -1;
            let low = i + 2 < length(value) ? hex_digit_value(substr(value, i + 2, 1)) : -1;
            if (high >= 0 && low >= 0) {
                result += chr(high * 16 + low);
                i += 2;
                continue;
            }
        }
        result += c;
    }
    return result;
}

function strip_fragment(value) {
    value = as_string(value);
    let marker = index(value, "#");
    return marker >= 0 ? substr(value, 0, marker) : value;
}

function userinfo(value) {
    value = as_string(value);
    let scheme = index(value, "://");
    if (scheme >= 0)
        value = substr(value, scheme + 3);
    let end = index(value, "/");
    value = end >= 0 ? substr(value, 0, end) : value;
    let at = rindex(value, "@");
    return at >= 0 ? percent_decode(substr(value, 0, at)) : "";
}

function migration_port(value) {
    value = as_string(value);
    if (match(value, /^[0-9]+$/) == null)
        return null;

    value = int(value);
    return value >= 1 && value <= 65535 ? value : null;
}

function unique_migration_tag(base, taken) {
    base = trim(as_string(base));
    if (base == "")
        base = "http";
    if (!taken[base])
        return base;

    for (let suffix = 1; suffix < 100000; suffix++) {
        let candidate = base + "-" + suffix;
        if (!taken[candidate])
            return candidate;
    }
    return base + "-overflow";
}

function migrated_http_outbound(link, tag_name) {
    link = strip_fragment(percent_decode(link));
    let scheme = core_url.scheme(link);
    if (scheme != "http" && scheme != "https")
        return null;

    let host = core_url.host(link);
    let port = migration_port(core_url.port(link));
    let path = core_url.path(link);
    if (host == "" || port == null || (path != "" && path != "/") || index(link, "?") >= 0)
        return null;

    let outbound = {
        type: "http",
        tag: tag_name,
        server: host,
        server_port: port
    };
    let credentials = userinfo(link);
    if (credentials != "") {
        let colon = index(credentials, ":");
        outbound.username = colon >= 0 ? substr(credentials, 0, colon) : credentials;
        if (colon >= 0)
            outbound.password = substr(credentials, colon + 1);
    }
    if (scheme == "https")
        outbound.tls = { enabled: true };
    return outbound;
}

function migrate_to_1_0_5(ctx) {
    for (let section in ctx.model.sections) {
        let existing_jsons = option_list_values(section, "outbound_jsons");
        let taken = {};
        for (let value in existing_jsons) {
            try {
                let outbound = json(value);
                let tag_name = type(outbound) == "object" ? trim(as_string(outbound.tag || "")) : "";
                if (tag_name != "")
                    taken[tag_name] = true;
            }
            catch (e) {
            }
        }

        let remaining_links = [];
        let migrated_jsons = [];
        for (let link in option_list_values(section, "selector_proxy_links")) {
            let tag_name = unique_migration_tag(core_url.fragment(link), taken);
            let outbound = migrated_http_outbound(link, tag_name);
            if (outbound == null) {
                push(remaining_links, link);
                continue;
            }

            taken[tag_name] = true;
            push(migrated_jsons, sprintf("%J", outbound));
        }

        if (length(migrated_jsons) == 0)
            continue;

        if (length(remaining_links) > 0)
            set_list_option(ctx, section, "selector_proxy_links", remaining_links);
        else
            delete_option(ctx, section, "selector_proxy_links");

        for (let value in existing_jsons)
            push(migrated_jsons, value);
        set_list_option(ctx, section, "outbound_jsons", migrated_jsons);
    }
}


// Released 1.0.5 -> current schema.

function migrate_interface_display_names(ctx) {
    for (let child in ctx.model.section_interface || []) {
        let name = trim(option(child, "name", ""));
        if (name != "")
            set_option_if_missing(ctx, child, "display_name", name);
    }
}

const OBSOLETE_SERVER_FILTER_OPTIONS = [
    "detect_server_country",
    "dashboard_filter_mode",
    "dashboard_detect_server_country",
    "dashboard_include_countries",
    "dashboard_include_outbounds",
    "dashboard_include_regex",
    "dashboard_include_proxy_parameters",
    "dashboard_include_protocols",
    "dashboard_include_transports",
    "dashboard_include_securities",
    "dashboard_include_groups",
    "dashboard_exclude_countries",
    "dashboard_exclude_outbounds",
    "dashboard_exclude_regex",
    "dashboard_exclude_proxy_parameters",
    "dashboard_exclude_protocols",
    "dashboard_exclude_transports",
    "dashboard_exclude_securities",
    "dashboard_exclude_groups"
];

function remove_server_country_and_dashboard_filter(ctx) {
    for (let section in ctx.model.sections)
        for (let key in OBSOLETE_SERVER_FILTER_OPTIONS)
            delete_option(ctx, section, key);

    for (let child in ctx.model.urltest || [])
        delete_option(ctx, child, "detect_server_country");
    for (let child in ctx.model.priority_level || [])
        delete_option(ctx, child, "detect_server_country");

    push(ctx.removed_caches, FORKOP_RUNTIME_STATE_DIR + "/server-country-cache.json");
}

const OBSOLETE_PRIORITY_GROUP_OPTIONS = [
    "active_check_interval",
    "check_timeout",
    "recovery_check_interval",
    "pick_fastest",
    "switch_to_faster_same_priority",
    "fastest_check_interval",
    "interrupt_exist_connections"
];

function use_native_fallbacks(ctx) {
    let settings = ctx.model.settings;
    for (let key in [ "dns_check_interval", "dns_recovery_check_interval", "dns_check_timeout" ])
        delete_option(ctx, settings, key);

    for (let group in ctx.model.priority_group || []) {
        for (let key in OBSOLETE_PRIORITY_GROUP_OPTIONS)
            delete_option(ctx, group, key);
    }

    for (let path in [
        TMP_SUBSCRIPTION_FOLDER,
        FORKOP_PERSISTENT_SUBSCRIPTION_CACHE_DIR,
        FORKOP_SUBSCRIPTION_UPDATE_STATE_DIR,
        FORKOP_SUBSCRIPTION_LINKS_DIR,
        FORKOP_SUBSCRIPTION_METADATA_DIR,
        FORKOP_OUTBOUND_METADATA_DIR,
        FORKOP_SUBSCRIPTION_UPDATE_LOCK_DIR,
        FORKOP_SUBSCRIPTION_UPDATE_JOB_DIR,
        FORKOP_SUBSCRIPTION_BOOTSTRAP_RETRY_PID_FILE,
        FORKOP_RUNTIME_STATE_DIR + "/cache-format",
        FORKOP_RUNTIME_STATE_DIR + "/dns-failover.json",
        FORKOP_RUNTIME_STATE_DIR + "/dns-failover.pid",
        FORKOP_RUNTIME_STATE_DIR + "/priority.pid"
    ])
        push(ctx.removed_caches, path);
}

function use_native_rule_sets(ctx) {
    let legacy_options = [
        "local_domain_lists",
        "local_subnet_lists",
        "remote_domain_lists",
        "remote_subnet_lists"
    ];

    for (let section in ctx.model.sections) {
        let values = list_option(section, "domain_ip_lists");
        let seen = {};
        let merged = [];
        for (let value in values) {
            value = as_string(value);
            if (value != "" && !seen[value]) {
                seen[value] = true;
                push(merged, value);
            }
        }

        let had_legacy = false;
        for (let key in legacy_options) {
            if (!option_exists(section, key))
                continue;
            had_legacy = true;
            for (let value in list_option(section, key)) {
                value = as_string(value);
                if (value != "" && !seen[value]) {
                    seen[value] = true;
                    push(merged, value);
                }
            }
            delete_option(ctx, section, key);
        }

        if (had_legacy)
            set_list_option(ctx, section, "domain_ip_lists", merged);
    }

    for (let path in [
        FORKOP_LEGACY_LIST_UPDATE_STATE_FILE,
        FORKOP_LEGACY_LIST_UPDATE_PID_FILE,
        FORKOP_LEGACY_RULESET_CACHE_DIR
    ])
        push(ctx.removed_caches, path);

    push(ctx.removed_cron_markers, LEGACY_LIST_UPDATE_CRON_MARKER);
    push(ctx.removed_cron_markers, LEGACY_SUBSCRIPTION_UPDATE_CRON_MARKER);
}

function use_universal_rule_sets(ctx) {
    for (let section in ctx.model.sections) {
        if (!option_exists(section, "domain_ip_lists"))
            continue;

        let target = option(section, "action", "") == "dns"
            ? "rule_set"
            : "rule_set_with_subnets";
        for (let value in list_option(section, "domain_ip_lists"))
            add_list_unique(ctx, section, target, value);
        delete_option(ctx, section, "domain_ip_lists");
    }
}

const OBSOLETE_SUBSCRIPTION_GROUP_OPTIONS = [
    "include_urltest_groups",
    "hide_urltest_group_outbounds",
    "hide_detour_outbounds"
];

function use_leaf_subscription_providers(ctx) {
    for (let child in ctx.model.subscription_url || []) {
        for (let key in OBSOLETE_SUBSCRIPTION_GROUP_OPTIONS)
            delete_option(ctx, child, key);
    }
    for (let section in ctx.model.sections || []) {
        for (let key in OBSOLETE_SUBSCRIPTION_GROUP_OPTIONS)
            delete_option(ctx, section, key);
    }
    for (let child in ctx.model.urltest || [])
        delete_option(ctx, child, "hide_added_outbounds");
}

function remove_section_cache(ctx) {
    push(ctx.removed_caches, FORKOP_SECTION_CACHE_DIR);
}

function set_option_if_blank(ctx, section, key, value) {
    if (option(section, key, "") == "")
        set_option(ctx, section, key, value);
}

function decode_hex(value) {
    value = as_string(value);
    if (length(value) == 0 || length(value) % 2 != 0 || match(value, /^([0-9a-fA-F]{2})+$/) == null)
        return "";

    let result = "";
    for (let i = 0; i < length(value); i += 2) {
        let high = hex_digit_value(substr(value, i, 1));
        let low = hex_digit_value(substr(value, i + 1, 1));
        if (high < 0 || low < 0)
            return "";
        result += chr(high * 16 + low);
    }
    return result;
}

function migrate_legacy_server_user(ctx, server, protocol) {
    let entries = option_list_values(server, "server_users");
    if (length(entries) == 0)
        return;

    let parts = split(as_string(entries[0]), "|");
    let name = "client";
    let credential = trim(as_string(parts[0] || ""));
    let extra = "";
    if (length(parts) > 1) {
        name = trim(as_string(parts[0] || ""));
        credential = trim(as_string(parts[1] || ""));
        extra = trim(as_string(parts[2] || ""));
    }

    if (credential != "") {
        if (name != "")
            set_option_if_blank(ctx, server, "server_username", name);
        if (protocol == "vless" || protocol == "vmess") {
            set_option_if_blank(ctx, server, "server_uuid", credential);
            if (protocol == "vless" && extra != "")
                set_option_if_blank(ctx, server, "vless_flow", extra);
            else if (protocol == "vmess" && match(extra, /^[0-9]+$/) != null)
                set_option_if_blank(ctx, server, "vmess_alter_id", extra);
        }
        else if (protocol == "shadowsocks" || protocol == "socks" || protocol == "trojan" || protocol == "hysteria2") {
            set_option_if_blank(ctx, server, "server_password", credential);
        }
        else if (protocol == "mtproto") {
            let secret = lc(credential);
            let base_secret = secret;
            let faketls = "";
            if (match(secret, /^ee[0-9a-f]{32}([0-9a-f]{2})+$/) != null) {
                base_secret = substr(secret, 2, 32);
                faketls = decode_hex(substr(secret, 34));
            }
            set_option_if_blank(ctx, server, "mtproto_secret", base_secret);
            set_option_if_blank(ctx, server, "mtproto_faketls", faketls != "" ? faketls : "google.com");
        }
    }

    delete_option(ctx, server, "server_users");
}

function add_current_defaults(ctx) {
    set_option_if_missing(ctx, ctx.model.settings, "unified_delay", "1");
}

function migrate_released_server_users(ctx) {
    for (let server in ctx.model.servers || [])
        migrate_legacy_server_user(ctx, server, option(server, "protocol", "vless"));
}

function migrate_fallback_uci_tags(ctx) {
    for (let mapping in [
        [ "priority_group", "fallback_group" ],
        [ "priority_level", "fallback_level" ]
    ]) {
        let old_type = mapping[0];
        let new_type = mapping[1];
        for (let section in ctx.model[old_type] || []) {
            set_section_type(ctx, section, new_type);
            push(ctx.model[new_type], section);
        }
        ctx.model[old_type] = [];
    }
}

function reset_fallback_defaults(ctx) {
    for (let group in ctx.model.fallback_group || []) {
        let health_check_url = option(group, "health_check_url", option(group, "health_url", ""));
        let reset_keys = [];
        for (let key in group)
            if (substr(key, 0, 1) != "." &&
                key != "section" && key != "name" && key != "health_check_url")
                push(reset_keys, key);
        for (let key in reset_keys)
            delete_option(ctx, group, key);
        if (health_check_url != "")
            set_option(ctx, group, "health_check_url", health_check_url);
    }
}

const OBSOLETE_PROXY_PARAMETER_FILTER_OPTIONS = [
    "include_proxy_parameters",
    "include_protocols",
    "include_transports",
    "include_securities",
    "exclude_proxy_parameters",
    "exclude_protocols",
    "exclude_transports",
    "exclude_securities"
];

function remove_proxy_parameter_filters(ctx) {
    for (let type_name in [ "subscription_url", "urltest", "fallback_level", "priority_level" ])
        for (let child in ctx.model[type_name] || [])
            for (let key in OBSOLETE_PROXY_PARAMETER_FILTER_OPTIONS)
                delete_option(ctx, child, key);

    for (let section in ctx.model.sections || []) {
        for (let key in OBSOLETE_PROXY_PARAMETER_FILTER_OPTIONS) {
            delete_option(ctx, section, key);
            delete_option(ctx, section, "urltest_" + key);
        }
    }
}

function filter_utf8_four_byte(codepoint) {
    return chr(0xf0 | ((codepoint >> 18) & 0x07)) +
        chr(0x80 | ((codepoint >> 12) & 0x3f)) +
        chr(0x80 | ((codepoint >> 6) & 0x3f)) +
        chr(0x80 | (codepoint & 0x3f));
}

function country_flag_pattern(country) {
    country = uc(trim(as_string(country)));
    if (match(country, /^[A-Z]{2}$/) == null)
        return "";
    let first = 0x1f1e6 + ord(substr(country, 0, 1)) - 65;
    let second = 0x1f1e6 + ord(substr(country, 1, 1)) - 65;
    return filter_utf8_four_byte(first) + filter_utf8_four_byte(second);
}

function unique_values_from_options(section, option_names) {
    let result = [];
    let seen = {};
    for (let option_name in option_names) {
        for (let value in option_list_values(section, option_name)) {
            value = trim(as_string(value));
            if (value == "" || seen[value])
                continue;
            seen[value] = true;
            push(result, value);
        }
    }
    return result;
}

function combined_filter_pattern(section, regex_options, country_options) {
    let parts = unique_values_from_options(section, regex_options);
    let seen = {};
    for (let value in parts)
        seen[value] = true;
    for (let country in unique_values_from_options(section, country_options)) {
        let flag = country_flag_pattern(country);
        if (flag == "" || seen[flag])
            continue;
        seen[flag] = true;
        push(parts, flag);
    }

    if (length(parts) == 0)
        return "";
    if (length(parts) == 1)
        return parts[0];

    let grouped = [];
    for (let part in parts)
        push(grouped, "(?:" + part + ")");
    return join("|", grouped);
}

function migrated_filter_values(section, kind) {
    let fallback = kind == "fallback";
    let legacy_mode_exists = option_exists(section, "filter_mode");
    let legacy_mode = option(section, "filter_mode", fallback ? "include" : "disabled");

    let include_outbounds = unique_values_from_options(
        section,
        fallback ? [ "include_outbounds", "server_name" ] : [ "include_outbounds" ]
    );
    let exclude_outbounds = unique_values_from_options(section, [ "exclude_outbounds" ]);
    let include_regex = combined_filter_pattern(
        section,
        fallback ? [ "include_regex", "regex" ] : [ "include_regex" ],
        fallback ? [ "include_countries", "country" ] : [ "include_countries" ]
    );
    let exclude_regex = combined_filter_pattern(
        section,
        [ "exclude_regex" ],
        [ "exclude_countries" ]
    );

    if (legacy_mode_exists && legacy_mode == "include") {
        exclude_outbounds = [];
        exclude_regex = "";
    }
    else if (legacy_mode_exists && legacy_mode == "exclude") {
        include_outbounds = [];
        include_regex = "";
    }

    let mode = option(section, "server_filter_mode", "");
    if (mode != "all" && mode != "exclude" && mode != "include" && mode != "direct") {
        if (fallback && bool_option(section, "direct", false))
            mode = "direct";
        else if (legacy_mode == "include" || legacy_mode == "mixed")
            mode = "include";
        else if (legacy_mode == "exclude")
            mode = "exclude";
        else
            mode = "all";
    }
    if (!fallback && mode == "direct")
        mode = "all";

    return {
        server_filter_mode: mode,
        include_outbounds,
        include_regex,
        exclude_outbounds,
        exclude_regex
    };
}

const LEGACY_SERVER_FILTER_OPTIONS = [
    "filter_mode",
    "direct",
    "include_countries",
    "country",
    "server_name",
    "regex",
    "exclude_countries"
];

function has_server_filter_fields(section) {
    for (let key in [
        "server_filter_mode",
        "filter_mode",
        "include_countries",
        "include_outbounds",
        "include_regex",
        "country",
        "server_name",
        "regex",
        "exclude_countries",
        "exclude_outbounds",
        "exclude_regex"
    ])
        if (option_exists(section, key))
            return true;
    return false;
}

function apply_migrated_filter_values(ctx, section, values) {
    set_option(ctx, section, "server_filter_mode", values.server_filter_mode);
    for (let key in [ "include_outbounds", "exclude_outbounds" ]) {
        if (length(values[key]) > 0)
            set_list_option(ctx, section, key, values[key]);
        else
            delete_option(ctx, section, key);
    }
    for (let key in [ "include_regex", "exclude_regex" ]) {
        if (values[key] != "") {
            if (type(object_or_empty(section)[key]) == "array")
                delete_option(ctx, section, key);
            set_option(ctx, section, key, values[key]);
        }
        else
            delete_option(ctx, section, key);
    }
    for (let key in LEGACY_SERVER_FILTER_OPTIONS)
        delete_option(ctx, section, key);
}

function migrate_server_filter_model(ctx) {
    for (let child in ctx.model.subscription_url || [])
        if (has_server_filter_fields(child))
            apply_migrated_filter_values(ctx, child, migrated_filter_values(child, "subscription"));
    for (let child in ctx.model.urltest || [])
        if (has_server_filter_fields(child))
            apply_migrated_filter_values(ctx, child, migrated_filter_values(child, "urltest"));
    for (let type_name in [ "fallback_level", "priority_level" ])
        for (let child in ctx.model[type_name] || [])
            if (has_server_filter_fields(child))
                apply_migrated_filter_values(ctx, child, migrated_filter_values(child, "fallback"));
}

function single_subscription_user_agent(item) {
    let configured = as_string(object_or_empty(item).user_agent);
    return bool_option(item, "auto_user_agent", false) || trim(configured) == ""
        ? "sing-box"
        : configured;
}

function migrate_single_subscription_user_agent(ctx) {
    for (let child in ctx.model.subscription_url || []) {
        set_option(ctx, child, "user_agent", single_subscription_user_agent(child));
        delete_option(ctx, child, "auto_user_agent");
    }
}

function migrate_subscription_headers(ctx) {
    for (let child in ctx.model.subscription_url || []) {
        let configured_hwid = trim(option(child, "hwid", ""));
        let hwid = configured_hwid != ""
            ? configured_hwid
            : (bool_option(child, "auto_hwid", true) ? subscription_headers_module.generated_hwid() : "");

        set_list_option(ctx, child, "header", subscription_headers_module.default_header_lines(hwid));
        delete_option(ctx, child, "auto_hwid");
        delete_option(ctx, child, "hwid");
    }
}

// Released configs carried the User-Agent as its own option, and the provider
// now reads it from the ordinary headers. A missing header would fall back to
// the core default instead of the value the release actually sent, so every
// subscription gets the header written out explicitly.
function subscription_user_agent_header_lines(item) {
    let configured = trim(as_string(option(item, "user_agent", "")));
    if (configured == "")
        configured = subscription_headers_module.default_user_agent();

    let line = "User-Agent: " + configured;
    let result = [];
    let replaced = false;
    for (let value in list_option(item, "header")) {
        let parsed = subscription_headers_module.parse_header_line(value);
        if (parsed.valid && lc(parsed.name) == "user-agent") {
            if (!replaced) {
                replaced = true;
                push(result, line);
            }
            continue;
        }
        push(result, as_string(value));
    }
    if (replaced)
        return result;

    let prefixed = [ line ];
    for (let value in result)
        push(prefixed, value);
    return prefixed;
}

function migrate_subscription_user_agent_header(ctx) {
    for (let child in ctx.model.subscription_url || []) {
        set_list_option(ctx, child, "header", subscription_user_agent_header_lines(child));
        delete_option(ctx, child, "user_agent");
    }
}

function remove_dashboard_sort_options(ctx) {
    for (let section in ctx.model.sections || [])
        delete_option(ctx, section, "sort_by_latency");
    for (let type_name in [ "urltest", "fallback_group" ])
        for (let child in ctx.model[type_name] || [])
            delete_option(ctx, child, "pin_dashboard");
}

function migrate_dns_server_uris(ctx) {
    let settings = ctx.model.settings;
    if (option_exists(settings, "dns_type")) {
        let dns_type = option(settings, "dns_type", "udp");
        let main_servers = [];
        let bootstrap_servers = [];
        for (let value in option_list_values(settings, "dns_server"))
            push(main_servers, runtime_dns.uri_from_legacy_options(dns_type, value));
        for (let value in option_list_values(settings, "bootstrap_dns_server"))
            push(bootstrap_servers, runtime_dns.uri_from_legacy_options("udp", value));
        set_list_option(ctx, settings, "dns_server", main_servers);
        set_list_option(ctx, settings, "bootstrap_dns_server", bootstrap_servers);
        delete_option(ctx, settings, "dns_type");
    }

    for (let section in ctx.model.sections || []) {
        if (option_exists(section, "dns_type")) {
            let dns_type = option(section, "dns_type", "udp");
            let servers = [];
            for (let value in option_list_values(section, "dns_server"))
                push(servers, runtime_dns.uri_from_legacy_options(dns_type, value));
            set_list_option(ctx, section, "dns_server", servers);
            delete_option(ctx, section, "dns_type");
        }
        normalize_existing_list_option(ctx, section, "dns_server");
    }
}

function migrate_interface_domain_resolver_uris(ctx) {
    for (let child in ctx.model.section_interface || []) {
        if (option_exists(child, "domain_resolver_dns_type")) {
            let dns_type = option(child, "domain_resolver_dns_type", "udp") || "udp";
            let servers = [];
            for (let value in option_list_values(child, "domain_resolver_dns_server"))
                push(servers, runtime_dns.uri_from_legacy_options(dns_type, value));
            set_list_option(ctx, child, "domain_resolver_dns_server", servers);
            delete_option(ctx, child, "domain_resolver_dns_type");
        }
        normalize_existing_list_option(ctx, child, "domain_resolver_dns_server");
    }
}

function readable_tag_component(value, fallback) {
    value = trim(as_string(value));
    if (value == "")
        value = as_string(fallback);
    return replace(value, /\//g, "／");
}

function unique_display_value(value, taken) {
    let base = as_string(value);
    if (!taken[base]) {
        taken[base] = true;
        return base;
    }
    for (let number = 2; number < 100000; number++) {
        let candidate = base + " #" + number;
        if (!taken[candidate]) {
            taken[candidate] = true;
            return candidate;
        }
    }
    return base + " #overflow";
}

function migrate_display_names(ctx, sections, taken) {
    for (let section in sections || []) {
        let label = readable_tag_component(option(section, "label", ""), section_name(section));
        set_option(ctx, section, "label", unique_display_value(label, taken));
    }
}

function migrate_subscription_tags(ctx) {
    let counters = {};
    let taken_by_section = {};
    for (let child in ctx.model.subscription_url || []) {
        let owner = option(child, "section", "");
        counters[owner] = int(counters[owner] || 0) + 1;
        let taken = taken_by_section[owner] || {};
        taken_by_section[owner] = taken;
        let configured = option(child, "tag", "");
        if (configured == "")
            configured = option(child, "node_prefix", "");
        let tag_name = readable_tag_component(configured, "sub" + counters[owner]);
        set_option(ctx, child, "tag", unique_display_value(tag_name, taken));
        if (option_exists(child, "prefix_nodes"))
            set_option(ctx, child, "show_subscription_name", option(child, "prefix_nodes", "0"));
        delete_option(ctx, child, "node_prefix");
        delete_option(ctx, child, "prefix_nodes");
    }
}

function migrate_fallback_group_names(ctx) {
    let taken_by_section = {};
    for (let group in ctx.model.fallback_group || []) {
        let owner = option(group, "section", "");
        let taken = taken_by_section[owner] || {};
        taken_by_section[owner] = taken;
        let name = trim(option(group, "name", "")) || section_name(group);
        set_option(ctx, group, "name", unique_display_value(name, taken));
    }

    let taken_by_group = {};
    for (let level in ctx.model.fallback_level || []) {
        let owner = option(level, "group", "");
        let taken = taken_by_group[owner] || {};
        taken_by_group[owner] = taken;
        let name = trim(option(level, "name", "")) || section_name(level);
        set_option(ctx, level, "name", unique_display_value(name, taken));
    }
}

function migrate_readable_runtime_tags(ctx) {
    let taken = {};
    for (let tag_name in keys(object_or_empty(singbox_constants_module.RESERVED_TAGS)))
        taken[tag_name] = true;
    migrate_display_names(ctx, ctx.model.sections, taken);
    migrate_display_names(ctx, ctx.model.servers, taken);
    migrate_subscription_tags(ctx);
    migrate_fallback_group_names(ctx);
    push(ctx.removed_caches, FORKOP_SECTION_CACHE_DIR);
    push(ctx.removed_caches, FORKOP_RUNTIME_MANIFEST_FILE);
}

function migrate_urltest_expected_status(ctx) {
    for (let child in ctx.model.urltest || [])
        set_option_if_missing(ctx, child, "expected_status", "*");
}

// Interrupting live connections on every automatic switch is far more
// disruptive than the switch itself, so both group types now default to
// leaving connections alone. Released configs stored the previous default
// explicitly, therefore that stored value has to be dropped for the new
// default to take effect.
function migrate_group_interrupt_defaults(ctx) {
    for (let type_name in [ "urltest", "fallback_group" ])
        for (let child in ctx.model[type_name] || [])
            if (option(child, "interrupt_exist_connections", "") == "1")
                delete_option(ctx, child, "interrupt_exist_connections");
}

const SERVER_CLIENT_PROTOCOL_FIELDS = {
    vless: [ [ "uuid", "server_uuid" ], [ "flow", "vless_flow" ] ],
    vmess: [ [ "uuid", "server_uuid" ] ],
    trojan: [ [ "password", "server_password" ] ],
    shadowsocks: [ [ "password", "server_password" ] ],
    hysteria2: [ [ "password", "server_password" ] ],
    mixed: [ [ "password", "server_password" ] ],
    mtproto: [ [ "secret", "mtproto_secret" ] ]
};
const LOGIN_NAME_SERVER_PROTOCOLS = { mixed: true };
// Frozen on purpose: a migration describes the schema of a past release and must not
// follow the generator's table when that table changes again.
const SHADOWSOCKS_2022_KEY_BYTES = {
    "2022-blake3-aes-128-gcm": 16,
    "2022-blake3-aes-256-gcm": 32,
    "2022-blake3-chacha20-poly1305": 32
};

function login_safe_value(value, fallback) {
    value = lc(as_string(value));
    let result = "";
    for (let i = 0; i < length(value); i++) {
        let chr = substr(value, i, 1);
        result += match(chr, /^[a-z0-9._-]$/) != null ? chr : "-";
    }
    result = replace(result, /^-+/, "");
    result = replace(result, /-+$/, "");
    return result == "" ? as_string(fallback) : result;
}

// The SOCKS inbound only ever served SOCKS5 without TLS. The mixed inbound answers
// both SOCKS5 and HTTP on the same port with the same accounts and can carry TLS, so
// the released socks servers become mixed servers and keep working unchanged.
function migrate_socks_servers_to_mixed(ctx) {
    for (let server in ctx.model.servers || []) {
        if (option(server, "protocol", "") != "socks")
            continue;

        set_option(ctx, server, "protocol", "mixed");
        let auth = option(server, "socks_auth_enabled", "");
        set_option(ctx, server, "mixed_auth_enabled", auth == "" ? "1" : auth);
        delete_option(ctx, server, "socks_auth_enabled");
    }

    // The option was only ever written for socks servers, but a stale value on any
    // other server would otherwise stay behind forever.
    for (let server in ctx.model.servers || [])
        delete_option(ctx, server, "socks_auth_enabled");
}

// Credentials a released server carried inline. They live on client sections now, so
// the server options are removed. sing-box has no MD5 authenticated VMess either, so
// the alterId option is dropped instead of migrated.
function delete_server_credentials(ctx, server) {
    delete_option(ctx, server, "server_uuid");
    delete_option(ctx, server, "server_username");
    delete_option(ctx, server, "server_password");
    delete_option(ctx, server, "mtproto_secret");
    delete_option(ctx, server, "vless_flow");
    delete_option(ctx, server, "vmess_alter_id");
}

// Released servers held one account inline. Every protocol sing-box serves takes a
// user list, so the inline credentials move into a client section and the server
// stops carrying credentials of its own.
function migrate_server_clients(ctx) {
    for (let server in ctx.model.servers || []) {
        let protocol = option(server, "protocol", "vless");
        let fields = SERVER_CLIENT_PROTOCOL_FIELDS[protocol];
        if (fields == null) {
            delete_server_credentials(ctx, server);
            continue;
        }

        let existing = child_sections_by_owner(ctx, "server_client", "server", section_name(server));
        if (length(existing) == 0) {
            let name = trim(option(server, "server_username", ""));
            if (name == "")
                name = trim(option(server, "label", "")) || section_name(server);
            if (LOGIN_NAME_SERVER_PROTOCOLS[protocol])
                name = login_safe_value(name, "client");

            let client = create_child_for_owner(ctx, server, "server_client", "server");
            set_option(ctx, client, "name", name);
            for (let field in fields) {
                let value = option(server, field[1], "");
                if (field[0] == "flow" && (value == "" || value == "none"))
                    continue;
                // The released dialog stored the bare key next to the FakeTLS host,
                // but it also accepted a pasted ee<key><host> secret and stored that
                // as it was. Both end up split the way the client section holds it.
                if (field[0] == "secret" && match(lc(value), /^ee[0-9a-f]{32}([0-9a-f]{2})+$/) != null) {
                    let host = decode_hex(substr(lc(value), 34));
                    if (host != "")
                        set_option(ctx, server, "mtproto_faketls", host);
                    value = substr(lc(value), 2, 32);
                }
                if (value != "")
                    set_option(ctx, client, field[0], value);
            }
        }

        delete_server_credentials(ctx, server);
    }
}

// Shadowsocks servers released with a legacy AEAD method keep it: changing the method
// would invalidate every distributed link, so the released default is written out
// where nothing stored one. A 2022 method was never offered by the released dialog,
// but a hand written one carried its key in the server password, and that key is the
// listener key now, so it moves there instead of being thrown away.
function migrate_shadowsocks_server_keys(ctx) {
    for (let server in ctx.model.servers || []) {
        if (option(server, "protocol", "") != "shadowsocks")
            continue;
        set_option_if_missing(ctx, server, "shadowsocks_method", "aes-128-gcm");
        if (SHADOWSOCKS_2022_KEY_BYTES[option(server, "shadowsocks_method", "")] == null)
            continue;
        let released_password = option(server, "server_password", "");
        if (released_password != "")
            set_option_if_missing(ctx, server, "shadowsocks_psk", released_password);
    }
}

// Options the dialog no longer asks for. Every one of them had a working default in
// the core, none changed whether a client could connect, and an unread value left in
// the configuration would only show up in diagnostics forever.
const REMOVED_SERVER_OPTIONS = [
    "mtproto_padding",
    "mtproto_concurrency",
    "mtproto_domain_fronting_port",
    "mtproto_domain_fronting_ip",
    "mtproto_domain_fronting_proxy_protocol",
    "mtproto_prefer_ip",
    "mtproto_auto_update",
    "mtproto_allow_fallback_on_unknown_dc",
    "mtproto_tolerate_time_skewness",
    "mtproto_idle_timeout",
    "mtproto_handshake_timeout",
    "reality_max_time_difference",
    // The exit node is what a Tailscale server is for, so the switch that could
    // take it away is gone and the runtime always advertises it.
    "tailscale_advertise_exit_node"
];

function remove_expert_server_options(ctx) {
    for (let server in ctx.model.servers || [])
        for (let key in REMOVED_SERVER_OPTIONS)
            delete_option(ctx, server, key);
}

// The released dialog asked for the handshake target next to the SNI and defaulted
// both to the same site, so the second field only ever added a way to disagree with
// the first. The SNI is the half already baked into every link a client holds, so it
// keeps its value and the target is adopted only where no SNI was stored at all.
function merge_reality_handshake_into_sni(ctx) {
    for (let server in ctx.model.servers || []) {
        let handshake = option(server, "reality_handshake_server", "");
        if (handshake != "" && option(server, "tls_server_name", "") == "")
            set_option(ctx, server, "tls_server_name", handshake);
        delete_option(ctx, server, "reality_handshake_server");
        delete_option(ctx, server, "reality_handshake_server_port");
    }
}

// The section settings carried a mixed proxy of their own: one listener on the
// service address that handed everything it accepted to that section. The Servers
// tab owns every inbound Forkop opens now, and a mixed server routed to a section is
// that listener with a name, a client list and a firewall switch, so each released
// switch becomes such a server instead of a second way to open a port.
const MIXED_PROXY_SECTION_ACTIONS = {
    connection: true,
    proxy: true,
    outbound: true,
    vpn: true
};

const MIXED_PROXY_SECTION_OPTIONS = [
    "mixed_proxy_enabled",
    "mixed_proxy_port",
    "mixed_proxy_auth_enabled",
    "mixed_proxy_username",
    "mixed_proxy_password"
];

function section_label(section) {
    return trim(option(section, "label", "")) || section_name(section);
}

function taken_display_names(ctx) {
    let result = {};
    for (let section in ctx.model.sections || [])
        result[section_label(section)] = true;
    for (let server in ctx.model.servers || [])
        result[section_label(server)] = true;
    return result;
}

function taken_section_names(ctx) {
    let result = { settings: true };
    for (let list in [ ctx.model.sections || [], ctx.model.servers || [] ])
        for (let section in list)
            result[section_name(section)] = true;
    for (let type_name in CHILD_ITEM_TYPES)
        for (let section in ctx.model[type_name] || [])
            result[section_name(section)] = true;
    return result;
}

// Both the display name and the uci id have to be free, and a config that already
// holds the obvious candidate gets the next number instead of a silent collision:
// two servers of one name fail validation, and two ids write over each other.
function claim_free_name(taken, name, separator) {
    let candidate = name;
    for (let suffix = 2; taken[candidate]; suffix++)
        candidate = name + separator + suffix;
    taken[candidate] = true;
    return candidate;
}

function create_server_section(ctx, name) {
    let server = { ".name": name, ".type": "server" };
    push(ctx.model.servers, server);
    record_operation(ctx, { op: "create", section: name, type: "server" });
    return server;
}

function migrate_section_mixed_proxies(ctx) {
    let display_names = null;
    let section_names = null;

    for (let section in ctx.model.sections || []) {
        let port = option(section, "mixed_proxy_port", "");
        let port_number = match(port, /^[0-9]+$/) != null ? int(port, 10) : 0;
        let auth = bool_option(section, "mixed_proxy_auth_enabled", false);
        let username = option(section, "mixed_proxy_username", "");
        let password = option(section, "mixed_proxy_password", "");
        // What the released dialog could produce. Anything else never reached a
        // listener either: the generator refused to write the whole configuration
        // over a port it could not use, an action with no outbound to route to, or
        // authentication with half a login, so there is nothing to carry over.
        let convert = bool_option(section, "mixed_proxy_enabled", false) &&
            MIXED_PROXY_SECTION_ACTIONS[option(section, "action", "")] &&
            port_number >= 1 && port_number <= 65535 &&
            (!auth || (username != "" && password != ""));

        for (let key in MIXED_PROXY_SECTION_OPTIONS)
            delete_option(ctx, section, key);

        if (!convert)
            continue;

        if (display_names == null) {
            display_names = taken_display_names(ctx);
            section_names = taken_section_names(ctx);
        }

        let server = create_server_section(ctx,
            claim_free_name(section_names, "server_" + section_name(section) + "_mixed", "_"));
        set_option(ctx, server, "label",
            claim_free_name(display_names, section_label(section) + " - Mixed proxy", " "));
        // A disabled section had no listener and a server may not route to one, so
        // the switch of the section decides the switch of the server.
        set_option(ctx, server, "enabled", bool_option(section, "enabled", true) ? "1" : "0");
        set_option(ctx, server, "protocol", "mixed");
        // The released listener followed the service address, which is read from the
        // lan interface on every start and is no value to freeze into the config. The
        // firewall stays shut instead, so the port answers on the lan and nowhere else.
        set_option(ctx, server, "listen", "0.0.0.0");
        set_option(ctx, server, "listen_port", port);
        set_option(ctx, server, "open_firewall", "0");
        set_option(ctx, server, "routing_mode", "section");
        set_option(ctx, server, "routing_section", section_name(section));
        set_option(ctx, server, "mixed_auth_enabled", auth ? "1" : "0");

        if (!auth)
            continue;

        let client = create_child_for_owner(ctx, server, "server_client", "server");
        // A Mixed account is a login name, and the released field took any text.
        set_option(ctx, client, "name", login_safe_value(username, "client"));
        set_option(ctx, client, "password", password);
    }
}

// The released switch added one `resolve` route rule ahead of the rule of the very
// section that emitted it, so the real address only ever reached the outbound this
// section had already chosen. It never moved a connection between sections, and it
// traded resolution at the proxy exit for resolution at the router, which picks the
// wrong CDN node and turns a local DNS failure into a dropped connection.
function remove_resolve_real_ip_for_routing(ctx) {
    for (let section in ctx.model.sections || [])
        delete_option(ctx, section, "resolve_real_ip_for_routing");
}

// The released dnsmasq takeover is gone: client DNS is captured by nftables and
// the dnsmasq configuration is never written again. The flag that guarded the
// takeover and the flag the service flipped on every start and stop both leave
// with the mechanism they served; a device the user wants left alone is the
// routing_excluded_ips list now.
function migrate_dns_capture_settings(ctx) {
    let settings = ctx.model.settings;
    delete_option(ctx, settings, "dont_touch_dhcp");
    delete_option(ctx, settings, "shutdown_correctly");
}

// The model carries no dhcp state, so this only asks the runtime adapter to
// restore /etc/config/dhcp the one time this registry entry first applies.
function request_dnsmasq_restore(ctx) {
    ctx.restore_dnsmasq = true;
}

// Forkop no longer drives an external DPI engine. Zapret, Zapret2 and ByeDPI
// were section actions that steered selected traffic into an nfqueue or a local
// SOCKS proxy Forkop started itself, and none of that exists any more, so a
// released section carrying one of those actions describes a route with no
// destination. The section goes, together with the child items it owned and
// every option elsewhere that named it - leaving the name behind would only
// make the next configuration validation refuse to start over a section that
// cannot come back. The strategy options leave every remaining section too,
// because a section whose action was changed away from a provider in an earlier
// release still carries them.
//
// What the engines left on the router is not touched: /opt/zapret, /opt/zapret2,
// the ciadpi package and their own init scripts belong to whoever installed
// them, and Forkop has no claim on them once it stops offering the actions.
const REMOVED_DPI_ACTIONS = {
    zapret: true,
    zapret2: true,
    byedpi: true
};

const REMOVED_DPI_SECTION_OPTIONS = [
    "nfqws_opt",
    "nfqws2_opt",
    "byedpi_cmd_opts"
];

// Each entry is an option naming a section, together with the switch that made
// Forkop read it. Clearing the name without clearing the switch trades a
// dangling reference for an empty required field, and both stop the service.
const SECTION_REFERENCE_OPTIONS = [
    [ "dns_detour_section", "dns_detour_enabled" ],
    [ "outbound_detour_section", "outbound_detour_enabled" ],
    [ "download_via_proxy_section", "download_via_proxy_enabled" ],
    [ "download_lists_via_proxy_section", "download_lists_via_proxy" ],
    [ "download_components_via_proxy_section", "download_components_via_proxy" ],
    [ "domain_resolver_dns_detour_section", "domain_resolver_dns_detour_enabled" ],
    [ "tailscale_detour_section", "" ]
];

function clear_removed_section_references(ctx, section, removed) {
    for (let entry in SECTION_REFERENCE_OPTIONS) {
        let value = option(section, entry[0], "");
        if (value == "" || !removed[value])
            continue;

        delete_option(ctx, section, entry[0]);
        if (entry[1] != "")
            set_option(ctx, section, entry[1], "0");
    }
}

function remove_dpi_provider_sections(ctx) {
    let removed = {};
    let kept = [];

    for (let section in ctx.model.sections || []) {
        let name = section_name(section);
        if (name != "" && REMOVED_DPI_ACTIONS[option(section, "action", "")]) {
            removed[name] = true;
            record_operation(ctx, { op: "delete_section", section: name });
            continue;
        }
        push(kept, section);
    }

    ctx.model.sections = kept;

    for (let section in kept)
        for (let key in REMOVED_DPI_SECTION_OPTIONS)
            delete_option(ctx, section, key);

    // A child item belongs to exactly one owner. Once that owner is gone the
    // child is unreachable configuration that still validates and still shows up
    // in the section lists the page builds.
    for (let type_name in CHILD_ITEM_TYPES) {
        let kept_children = [];

        for (let child in ctx.model[type_name] || []) {
            let owner = option(child, "section", "");
            if (owner != "" && removed[owner]) {
                record_operation(ctx, { op: "delete_section", section: section_name(child) });
                continue;
            }
            push(kept_children, child);
        }

        ctx.model[type_name] = kept_children;
    }

    if (length(keys(removed)) == 0)
        return;

    clear_removed_section_references(ctx, ctx.model.settings, removed);
    for (let section in ctx.model.sections || [])
        clear_removed_section_references(ctx, section, removed);
    for (let server in ctx.model.servers || []) {
        clear_removed_section_references(ctx, server, removed);
        if (removed[option(server, "section", "")])
            delete_option(ctx, server, "section");
    }
    for (let type_name in CHILD_ITEM_TYPES)
        for (let child in ctx.model[type_name] || [])
            clear_removed_section_references(ctx, child, removed);
}

function migrate_openvpn_json(ctx, outbound, label) {
    let endpoint = json(sprintf("%J", outbound));
    // The old system interface installed allowed_ips as OS routes; native
    // OpenVPN routes are preferences inside sing-box, so that cannot be renamed.
    if (endpoint.system || (endpoint.reconnect_delay != null && endpoint.reconnect_delay != "")) {
        migration_error(ctx, label + ": OpenVPN system routes and reconnect_delay require manual conversion to native openvpn-client options");
        return null;
    }
    endpoint.type = "openvpn-client";
    let proto = lc(as_string(endpoint.proto || "udp"));
    if (index([ "udp", "udp4", "tcp", "tcp-client", "tcp4", "tcp4-client" ], proto) < 0) {
        migration_error(ctx, label + ": unsupported legacy OpenVPN proto");
        return null;
    }
    endpoint.network = index([ "tcp", "tcp-client", "tcp4", "tcp4-client" ], proto) >= 0 ? "tcp" : "udp";
    endpoint.auth = as_string(endpoint.auth || "SHA1");
    if (endpoint.cipher) endpoint.data_ciphers_fallback = endpoint.cipher;
    delete endpoint.cipher;
    delete endpoint.proto;
    delete endpoint.allowed_ips;
    delete endpoint.reconnect_delay;

    let old_tls = object_or_empty(endpoint.tls);
    if (old_tls.kernel_tx || old_tls.kernel_rx || old_tls.cipher_suites != null || old_tls.verify_x509_name_mode == "name-suffix") {
        migration_error(ctx, label + ": OpenVPN tls.kernel_tx, tls.kernel_rx, tls.cipher_suites or tls.verify_x509_name_mode need native equivalents");
        return null;
    }
    let tls = {};
    let tls_fields = {
        ca: "certificate", ca_path: "certificate_path",
        certificate: "client_certificate", certificate_path: "client_certificate_path",
        key: "client_key", key_path: "client_key_path", verify_x509_name: "server_name"
    };
    for (let key in keys(old_tls)) {
        if (tls_fields[key] != null) tls[tls_fields[key]] = old_tls[key];
        else if (index([ "kernel_tx", "kernel_rx", "verify_x509_name_mode" ], key) < 0) {
            migration_error(ctx, label + ": unsupported legacy OpenVPN TLS field '" + key + "'");
            return null;
        }
    }
    if (tls.server_name != null)
        tls.server_name_type = old_tls.verify_x509_name_mode == "name-prefix" ? "name-prefix" : "name";
    let auth_key = endpoint.tls_auth || endpoint.tls_auth_path;
    let crypt_key = endpoint.tls_crypt || endpoint.tls_crypt_path;
    if (auth_key || crypt_key) {
        let wrap = { type: auth_key ? "tls_auth" : endpoint.tls_crypt_v2 ? "tls_crypt_v2" : "tls_crypt" };
        let prefix = auth_key ? "tls_auth" : "tls_crypt";
        if (endpoint[prefix]) wrap.key = endpoint[prefix];
        else wrap.key_path = endpoint[prefix + "_path"];
        if (auth_key) {
            let direction = int(endpoint.key_direction || 0);
            if (direction != 0 && direction != 1) {
                migration_error(ctx, label + ": invalid legacy OpenVPN key_direction");
                return null;
            }
            wrap.direction = direction == 1 ? "client" : "server";
        }
        tls.control_wrap = wrap;
    }
    for (let key in [ "tls_auth", "tls_auth_path", "tls_crypt", "tls_crypt_path", "tls_crypt_v2", "key_direction" ])
        delete endpoint[key];
    endpoint.tls = tls;
    return endpoint;
}

// Public 1.0.5 accepted arbitrary outbound_jsons. Its contemporaneous extended
// release already supplied OpenVPN and Snell with these legacy option shapes.
// This runs only on the released-schema edge; NEXT -> NEXT remains a no-op.
function migrate_native_protocol_json(ctx) {
    for (let section in ctx.model.sections) {
        let remaining = [];
        let changed = false;
        let ordinal = 0;
        let values = option_list_values(section, "outbound_jsons");
        let singular = length(values) == 0 && option(section, "outbound_json", "") != "";
        if (singular) values = [ option(section, "outbound_json", "") ];
        for (let value in values) {
            ordinal++;
            let outbound = null;
            try { outbound = json(value); } catch (e) {}
            if (type(outbound) != "object") {
                push(remaining, value);
                continue;
            }
            let label = "section '" + section_name(section) + "', " + (singular ? "outbound_json" : "outbound_jsons item " + ordinal);
            if (outbound.type == "openvpn") {
                let endpoint = migrate_openvpn_json(ctx, outbound, label);
                if (endpoint == null) return;
                let child = create_child_for_owner(ctx, section, "tunnel", "section");
                set_option(ctx, child, "kind", "openvpn-client");
                set_option(ctx, child, "name", as_string(endpoint.tag || "JSON outbound #" + ordinal));
                set_option(ctx, child, "order", as_string(ordinal));
                set_option(ctx, child, "endpoint_json", sprintf("%J", endpoint));
                changed = true;
                continue;
            }
            if (outbound.type == "snell") {
                if (outbound.version != 4 && outbound.version != 5 && outbound.version != 6) {
                    migration_error(ctx, label + ": Snell 1-3 is no longer supported; upgrade the server to Snell 4 or 6 before updating this configuration");
                    return;
                }
                if (outbound.version == 5) { outbound.version = 4; changed = true; }
                if (type(outbound.obfs) == "object") {
                    if (outbound.version != 4 || outbound.obfs_mode != null || outbound.obfs_host != null) {
                        migration_error(ctx, label + ": conflicting Snell obfuscation fields");
                        return;
                    }
                    if (outbound.obfs.mode != null) outbound.obfs_mode = outbound.obfs.mode;
                    if (outbound.obfs.host != null) outbound.obfs_host = outbound.obfs.host;
                    delete outbound.obfs;
                    changed = true;
                }
                value = sprintf("%J", outbound);
            }
            push(remaining, value);
        }
        if (changed) {
            if (singular && length(remaining) > 0)
                set_option(ctx, section, "outbound_json", remaining[0]);
            else {
                set_list_option(ctx, section, "outbound_jsons", remaining);
                if (length(remaining) == 0) {
                    delete_option(ctx, section, "outbound_json");
                    if (option(section, "action", "") == "outbound")
                        set_option(ctx, section, "action", "connection");
                }
            }
        }
    }
}

const CURRENT_TRANSFORMS = [
    remove_server_country_and_dashboard_filter,
    use_native_fallbacks,
    use_native_rule_sets,
    use_universal_rule_sets,
    use_leaf_subscription_providers,
    add_current_defaults,
    migrate_released_server_users,
    migrate_fallback_uci_tags,
    reset_fallback_defaults,
    remove_proxy_parameter_filters,
    migrate_server_filter_model,
    migrate_single_subscription_user_agent,
    migrate_subscription_headers,
    migrate_interface_display_names,
    remove_section_cache,
    remove_dashboard_sort_options,
    migrate_dns_server_uris,
    migrate_interface_domain_resolver_uris,
    migrate_readable_runtime_tags,
    migrate_urltest_expected_status,
    migrate_group_interrupt_defaults,
    migrate_subscription_user_agent_header,
    migrate_socks_servers_to_mixed,
    // Before the client sections: the released Shadowsocks key lives in the server
    // password, and that option is removed once the credentials have moved.
    migrate_shadowsocks_server_keys,
    migrate_server_clients,
    remove_expert_server_options,
    merge_reality_handshake_into_sni,
    migrate_section_mixed_proxies,
    remove_resolve_real_ip_for_routing,
    migrate_dns_capture_settings,
    request_dnsmasq_restore,
    remove_dpi_provider_sections,
    migrate_native_protocol_json
];

function migrate_to_current(ctx) {
    for (let transform in CURRENT_TRANSFORMS) {
        transform(ctx);
        if (ctx.error != null)
            return;
    }
}

function migrate_released_schema(ctx, source_release) {
    if (source_release == "1.0.2") {
        migrate_to_1_0_5(ctx);
        if (ctx.error != null)
            return;
    }
    migrate_to_current(ctx);
}

function request_reset(ctx, source_release) {
    ctx.source_release = source_release;
    ctx.reset = true;
    ctx.changed = true;
    ctx.restore_dnsmasq = true;
    return ctx;
}

function migrate_podkop_model(model, _constants) {
    return request_reset(migration_context(model), "legacy-podkop");
}

function migrate_forkop_model(model) {
    let ctx = migration_context(model);
    let target_release = target_config_version();
    if (target_release == "")
        return migration_error(ctx, "canonical default " + DEFAULT_CONFIG_PATH + " has no config_version option");
    if (target_release != "NEXT" &&
        (version_parts(target_release) == null || compare_versions(target_release, LATEST_SOURCE_VERSION) <= 0))
        return migration_error(ctx, "canonical target config_version must be NEXT or a release newer than " + LATEST_SOURCE_VERSION + ": '" + target_release + "'");
    let source_release = trim(option(model.settings, CONFIG_VERSION_OPTION, ""));
    ctx.source_release = source_release;

    if (source_release == "")
        return request_reset(ctx, "missing");
    if (source_release == target_release) {
        delete_option(ctx, model.settings, APPLIED_MIGRATIONS_OPTION);
        return ctx;
    }
    if (version_parts(source_release) == null)
        return migration_error(ctx, "section 'settings', option 'config_version' has invalid value '" + source_release + "'");
    if (compare_versions(source_release, MIN_CONFIG_VERSION) < 0)
        return request_reset(ctx, source_release);
    if (compare_versions(source_release, LATEST_SOURCE_VERSION) > 0)
        return migration_error(ctx, "section 'settings', option 'config_version' is newer than the newest migratable schema " + LATEST_SOURCE_VERSION + ": '" + source_release + "'");
    if (source_release != "1.0.2" && source_release != "1.0.5")
        return migration_error(ctx, "section 'settings', option 'config_version' names an unknown released schema '" +
            source_release + "'; supported source schemas are 1.0.2 and 1.0.5");

    migrate_released_schema(ctx, source_release);
    if (ctx.error != null)
        return ctx;
    delete_option(ctx, model.settings, APPLIED_MIGRATIONS_OPTION);
    set_option(ctx, model.settings, CONFIG_VERSION_OPTION, target_release);
    return ctx;
}

// Runtime UCI adapter and external command dispatcher.
function remove_cache_path(path) {
    path = as_string(path);
    if (index(path, "*") >= 0)
        return run("rm -f " + path);
    return run("rm -rf " + shell_quote(path));
}

function remove_cron_markers(markers) {
    let current = command_output(shell_quote(FORKOP_CRONTAB_BIN) + " -l 2>/dev/null");
    let filtered = "";

    for (let line in split(current, "\n")) {
        let remove = false;
        for (let marker in markers) {
            if (marker != "" && index(line, marker) >= 0) {
                remove = true;
                break;
            }
        }
        if (!remove && line != "")
            filtered += line + "\n";
    }

    let normalized = current == "" ? "" : current + "\n";
    if (filtered == normalized)
        return true;

    let tmp = command_output("mktemp");
    if (tmp == "" || fs.writefile(tmp, filtered) == null)
        return false;

    let ok = run(shell_quote(FORKOP_CRONTAB_BIN) + " " + shell_quote(tmp) + " >/dev/null 2>&1");
    fs.unlink(tmp);
    return ok;
}

function apply_operations(cursor, operations) {
    let created = {};
    let section_ref = function(name) {
        name = as_string(name);
        return as_string(created[name] || name);
    };

    for (let op in operations) {
        let ok = true;
        if (op.op == "create") {
            if (op.anonymous && type(cursor.add) == "function") {
                let created_name = as_string(cursor.add(CONFIG_NAME, op.type));
                if (created_name == "")
                    ok = false;
                else
                    created[as_string(op.section)] = created_name;
            }
            else
                ok = cursor.set(CONFIG_NAME, op.section, op.type) !== false;
        }
        else if (op.op == "set")
            ok = cursor.set(CONFIG_NAME, section_ref(op.section), op.option,
                op.section_reference ? section_ref(op.value) : op.value) !== false;
        else if (op.op == "delete")
            ok = cursor.delete(CONFIG_NAME, section_ref(op.section), op.option) !== false;
        else if (op.op == "add_list")
            ok = cursor.set(CONFIG_NAME, section_ref(op.section), op.option, op.values) !== false;
        else if (op.op == "set_list")
            ok = cursor.set(CONFIG_NAME, section_ref(op.section), op.option, op.values) !== false;
        else if (op.op == "set_type")
            ok = cursor.set(CONFIG_NAME, section_ref(op.section), op.type) !== false;
        else if (op.op == "delete_section")
            ok = cursor.delete(CONFIG_NAME, section_ref(op.section), null) !== false;
        else
            return { ok: false, error: "unknown migration operation '" + as_string(op.op) + "'" };

        if (!ok) {
            let location = "section '" + section_ref(op.section) + "'";
            if (op.option != null)
                location += ", option '" + as_string(op.option) + "'";
            return { ok: false, error: "could not apply UCI " + as_string(op.op) + " to " + location };
        }
    }
    return { ok: true };
}

function runtime_cursor() {
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
        },
        add: function(package_name, type_name) {
            return uci_core.add(package_name, type_name);
        },
        set: function(package_name, section_name, option_name, value) {
            if (value == null)
                return uci_core.set_section(package_name + "." + section_name, option_name);
            return uci_core.set(package_name + "." + section_name + "." + option_name, value);
        },
        delete: function(package_name, section_name, option_name) {
            if (option_name == null)
                return uci_core.delete(package_name + "." + section_name);
            return uci_core.delete(package_name + "." + section_name + "." + option_name);
        },
        commit: function(package_name) {
            return uci_core.commit(package_name);
        }
    };
}

function current_config_hash() {
    let config_path = "/etc/config/" + CONFIG_NAME;
    if (fs.stat(config_path) == null)
        return "";

    let output = command_output("md5sum " + shell_quote(config_path) + " 2>/dev/null");
    let fields = split(trim(output), /[ \t\r\n]+/);
    return length(fields) > 0 ? as_string(fields[0]) : "";
}

function mark_internal_config_guard() {
    let hash = current_config_hash();
    if (hash == "") {
        fs.unlink(FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD);
        return;
    }

    let stamp = clock();
    let tmp_path = FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD + "." + stamp[0] + "." + stamp[1];
    fs.writefile(tmp_path, as_string(stamp[0]) + "\n" + hash + "\n");
    if (!fs.rename(tmp_path, FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD))
        fs.unlink(tmp_path);
}

function commit_cursor(cursor) {
    if (!cursor.commit(CONFIG_NAME))
        return false;
    mark_internal_config_guard();
    return true;
}

// ---- One-time restore of the dnsmasq takeover a released Forkop wrote ----
//
// Up to release 1.0.5 Forkop pointed dhcp.@dnsmasq[0] at the sing-box resolver
// and kept the original values under its own forkop_* options; podkop, which
// Forkop installs over, used the same shape under podkop_*. DNS is captured by
// nftables now and dnsmasq is never written again, so whatever such a release
// left behind - after a crash, a failed removal or an unclean upgrade - is
// restored here exactly once, from the backups when they exist.

const SB_DNS_INBOUND_ADDRESS = getenv("SB_DNS_INBOUND_ADDRESS") || "127.0.0.42";
const DNSMASQ_INIT = getenv("DNSMASQ_INIT") || "/etc/init.d/dnsmasq";
const DNSMASQ_BACKUP_PREFIXES = [ "forkop_", "podkop_" ];

function value_words(value) {
    if (type(value) == "array") {
        let result = [];
        for (let item in value) {
            item = trim(as_string(item));
            if (item != "")
                push(result, item);
        }
        return result;
    }

    value = trim(as_string(value == null ? "" : value));
    return value == "" ? [] : split(value, /[ \t\r\n]+/);
}

function dnsmasq_backup_words(dnsmasq, key) {
    for (let prefix in DNSMASQ_BACKUP_PREFIXES) {
        let values = value_words(object_or_empty(dnsmasq)[prefix + key]);
        if (length(values) > 0)
            return values;
    }
    return [];
}

function dnsmasq_backup_keys_present(dnsmasq) {
    for (let prefix in DNSMASQ_BACKUP_PREFIXES)
        for (let key in [ "server", "noresolv", "cachesize", "rebind_protection", "notinterface" ])
            if (object_or_empty(dnsmasq)[prefix + key] != null)
                return true;
    return false;
}

function list_without(values, needle) {
    let result = [];
    for (let value in values)
        if (value != needle)
            push(result, value);
    return result;
}

// What has to change in dhcp.@dnsmasq[0] to undo the takeover. Pure: reads the
// section object and the legacy-instance facts, returns the edits, so a fixture
// can prove the exact transformation the runtime adapter applies.
function dnsmasq_restore_plan(dnsmasq, legacy_present, legacy_interfaces) {
    dnsmasq = object_or_empty(dnsmasq);
    let servers = value_words(dnsmasq.server);
    let managed_global_dns = false;
    for (let server in servers)
        if (server == SB_DNS_INBOUND_ADDRESS)
            managed_global_dns = true;

    let plan = {
        changed: false,
        set: {},
        set_lists: {},
        delete_options: [],
        delete_legacy_instance: false
    };

    if (!managed_global_dns && !dnsmasq_backup_keys_present(dnsmasq) && !legacy_present)
        return plan;

    plan.changed = true;

    let backup_servers = dnsmasq_backup_words(dnsmasq, "server");
    plan.set_lists.server = length(backup_servers) > 0
        ? backup_servers
        : list_without(servers, SB_DNS_INBOUND_ADDRESS);

    let backup_noresolv = join("", dnsmasq_backup_words(dnsmasq, "noresolv"));
    if (backup_noresolv != "")
        plan.set.noresolv = backup_noresolv;
    else if (managed_global_dns)
        plan.set.noresolv = "0";

    let backup_cachesize = join("", dnsmasq_backup_words(dnsmasq, "cachesize"));
    if (backup_cachesize != "")
        plan.set.cachesize = backup_cachesize;
    else if (managed_global_dns)
        plan.set.cachesize = "150";

    // The takeover always recorded the previous rebind protection, storing
    // "__unset__" for an absent option, so the backup key alone decides.
    let backup_rebind = join("", dnsmasq_backup_words(dnsmasq, "rebind_protection"));
    if (backup_rebind == "__unset__")
        push(plan.delete_options, "rebind_protection");
    else if (backup_rebind != "")
        plan.set.rebind_protection = backup_rebind;
    else if (managed_global_dns && object_or_empty(dnsmasq).forkop_rebind_protection != null)
        plan.set.rebind_protection = "1";

    let backup_notinterface = dnsmasq_backup_words(dnsmasq, "notinterface");
    if (length(backup_notinterface) > 0)
        plan.set_lists.notinterface = backup_notinterface;
    else if (legacy_present) {
        let interfaces = value_words(legacy_interfaces);
        if (length(interfaces) == 0)
            interfaces = [ "br-lan" ];
        let remaining = value_words(dnsmasq.notinterface);
        for (let interface in interfaces)
            remaining = list_without(remaining, interface);
        plan.set_lists.notinterface = remaining;
    }

    for (let prefix in DNSMASQ_BACKUP_PREFIXES)
        for (let key in [ "server", "noresolv", "cachesize", "rebind_protection", "notinterface" ])
            if (dnsmasq[prefix + key] != null)
                push(plan.delete_options, prefix + key);

    plan.delete_legacy_instance = legacy_present;

    return plan;
}

// What the restore actually did, option by option: the values it put back are
// the one thing a user debugging a changed dnsmasq needs from the log.
function dnsmasq_restore_summary(plan) {
    let parts = [];
    for (let key, values in plan.set_lists)
        push(parts, key + "='" + join(" ", values) + "'");
    for (let key, value in plan.set)
        push(parts, key + "='" + as_string(value) + "'");
    if (length(plan.delete_options) > 0)
        push(parts, "removed " + join(", ", plan.delete_options));
    if (plan.delete_legacy_instance)
        push(parts, "removed the dhcp.forkop instance");
    return join("; ", parts);
}

function restore_dnsmasq_runtime(settings) {
    if (!uci_core.load("dhcp"))
        return true;

    // The takeover always wrote the first dnsmasq instance; resolving it by
    // type works against the live cursor and the test fixture alike.
    let instances = uci_core.section_objects("dhcp", "dnsmasq");
    let dnsmasq = length(instances) > 0 ? object_or_empty(instances[0]) : {};
    let dnsmasq_name = as_string(dnsmasq[".name"] == null ? "" : dnsmasq[".name"]);

    let legacy_present = uci_core.exists("dhcp.forkop");
    let legacy_interfaces = legacy_present ? uci_core.get("dhcp.forkop.interface") : "";
    if (legacy_present && trim(as_string(legacy_interfaces)) == "")
        legacy_interfaces = option(object_or_empty(settings), "source_network_interfaces", "");

    let plan = dnsmasq_restore_plan(dnsmasq, legacy_present, legacy_interfaces);
    if (!plan.changed)
        return true;

    if (dnsmasq_name != "") {
        for (let key, values in plan.set_lists) {
            uci_core.delete("dhcp." + dnsmasq_name + "." + key);
            for (let value in values)
                uci_core.add_list("dhcp." + dnsmasq_name + "." + key, value);
        }
        for (let key, value in plan.set)
            uci_core.set("dhcp." + dnsmasq_name + "." + key, value);
        for (let key in plan.delete_options)
            uci_core.delete("dhcp." + dnsmasq_name + "." + key);
    }
    if (plan.delete_legacy_instance)
        uci_core.delete("dhcp.forkop");

    if (!uci_core.commit("dhcp"))
        return false;

    run("logger -t " + shell_quote("forkop") +
        " " + shell_quote("[info] Restored the dnsmasq configuration a previous Forkop release had taken over: " + dnsmasq_restore_summary(plan)));
    run("[ -x " + shell_quote(DNSMASQ_INIT) + " ] && " + shell_quote(DNSMASQ_INIT) + " restart");
    return true;
}

function migrate_model(model, source) {
    return source == "podkop"
        ? migrate_podkop_model(model)
        : migrate_forkop_model(model);
}

const RELEASED_SECTION_TYPES = [
    "settings", "section", "server", "subscription_url", "section_interface",
    "urltest", "priority_group", "priority_level"
];

const CURRENT_SECTION_TYPES = [
    "settings", "section", "server", "server_client", "subscription_url",
    "section_interface", "urltest", "fallback_group", "fallback_level",
    "tunnel", "tunnel_peer"
];

function section_type_allowed(type_name, allowed) {
    for (let candidate in allowed)
        if (type_name == candidate)
            return true;
    return false;
}

function runtime_config_preflight() {
    // core.uci's file-backed test adapter has no system uci binary by design.
    if (getenv("FORKOP_UCI_STATE_FILE") != null && getenv("FORKOP_RUN_UCI_PREFLIGHT") != "1")
        return { error: null, sections: [] };

    let result = command_result("uci -q show " + shell_quote(CONFIG_NAME) + " 2>&1");
    if (!result.ok)
        return {
            error: "cannot parse " + RUNTIME_CONFIG_PATH + (result.output == "" ? "" : ": " + result.output),
            sections: []
        };

    let sections = [];
    for (let line in split(result.output, "\n")) {
        let matched = match(line, /^[^.]+\.([^.=]+)=([^=]+)$/);
        if (!matched)
            continue;
        let type_name = replace(trim(matched[2]), /^['\"]|['\"]$/g, "");
        push(sections, { name: matched[1], type: type_name });
    }
    return { error: null, sections };
}

function invalid_section_error(sections, allowed) {
    for (let section in sections || [])
        if (!section_type_allowed(section.type, allowed))
            return "UCI section '" + section.name + "' has unsupported type '" +
                section.type + "' in " + RUNTIME_CONFIG_PATH;
    return null;
}

function backup_suffix(value) {
    value = replace(as_string(value), /[^A-Za-z0-9._-]/g, "-");
    return value == "" ? "unknown" : value;
}

function backup_runtime_config(source_release) {
    if (fs.stat(RUNTIME_CONFIG_PATH) == null)
        return true;
    let backup_path = RUNTIME_CONFIG_PATH + ".migration-backup." + backup_suffix(source_release);
    if (fs.stat(backup_path) != null)
        return true;
    if (!run("cp -p " + shell_quote(RUNTIME_CONFIG_PATH) + " " + shell_quote(backup_path)))
        return false;
    run("logger -t " + shell_quote("forkop") + " " +
        shell_quote("[info] Saved the pre-migration configuration to " + backup_path));
    return true;
}

function install_default_runtime_config() {
    if (fs.stat(DEFAULT_CONFIG_PATH) == null) {
        report_migration_error("canonical default configuration is missing: " + DEFAULT_CONFIG_PATH);
        return false;
    }
    let temporary = RUNTIME_CONFIG_PATH + ".migration-new";
    if (!run("cp -p " + shell_quote(DEFAULT_CONFIG_PATH) + " " + shell_quote(temporary) +
        " && chmod 0600 " + shell_quote(temporary) + " && mv -f " + shell_quote(temporary) + " " + shell_quote(RUNTIME_CONFIG_PATH))) {
        report_migration_error("could not atomically replace " + RUNTIME_CONFIG_PATH + " with the canonical defaults");
        return false;
    }
    return true;
}

function migrate_runtime(source) {
    let preflight = runtime_config_preflight();
    if (preflight.error != null) {
        report_migration_error(preflight.error);
        return false;
    }
    let cursor = runtime_cursor();
    if (cursor.load(CONFIG_NAME) === false) {
        report_migration_error("core.uci could not load " + RUNTIME_CONFIG_PATH);
        return false;
    }
    let ctx = migrate_model(model_from_uci(cursor), source);
    if (ctx.error != null) {
        report_migration_error(ctx.error);
        return false;
    }
    let allowed_types = ctx.source_release == target_config_version()
        ? CURRENT_SECTION_TYPES
        : RELEASED_SECTION_TYPES;
    let section_error = ctx.reset ? null : invalid_section_error(preflight.sections, allowed_types);
    if (section_error != null) {
        report_migration_error(section_error);
        return false;
    }
    if (!ctx.changed)
        return true;

    if (!backup_runtime_config(ctx.source_release)) {
        report_migration_error("could not create a backup of " + RUNTIME_CONFIG_PATH);
        return false;
    }

    for (let path in ctx.removed_caches) {
        if (!remove_cache_path(path)) {
            report_migration_error("could not remove obsolete runtime state " + path);
            return false;
        }
    }
    if (!remove_cron_markers(ctx.removed_cron_markers)) {
        report_migration_error("could not remove obsolete Forkop entries from crontab");
        return false;
    }
    if (ctx.restore_dnsmasq === true && !restore_dnsmasq_runtime(ctx.model.settings)) {
        report_migration_error("could not restore the dnsmasq configuration owned by the previous Forkop release");
        return false;
    }

    for (let warning in ctx.warnings || []) {
        warn("[warning] " + warning + "\n");
        run("logger -t " + shell_quote("forkop") + " " + shell_quote("[warning] " + warning));
    }
    if (ctx.reset)
        return install_default_runtime_config();

    let applied = apply_operations(cursor, ctx.operations);
    if (!applied.ok) {
        report_migration_error(applied.error);
        return false;
    }
    if (!commit_cursor(cursor)) {
        report_migration_error("could not commit migrated UCI package '" + CONFIG_NAME + "'");
        return false;
    }
    return true;
}

function commit_runtime() {
    let cursor = runtime_cursor();
    cursor.load(CONFIG_NAME);
    return commit_cursor(cursor);
}

function migrate_fixture(path, source) {
    let ctx = migrate_model(model_from_fixture(path), source);
    if (ctx.error != null) {
        report_migration_error(ctx.error);
        return false;
    }
    write_json({
        changed: ctx.changed,
        reset: ctx.reset,
        target_version: target_config_version(),
        config: ctx.reset ? null : export_model(ctx.model),
        operations: ctx.operations,
        removed_caches: ctx.removed_caches,
        removed_cron_markers: ctx.removed_cron_markers,
        warnings: ctx.warnings,
        restore_dnsmasq: ctx.restore_dnsmasq === true
    });
    return true;
}

function restore_dnsmasq_fixture(path) {
    let data = object_or_empty(read_json_file(path));
    let plan = dnsmasq_restore_plan(
        object_or_empty(data.dnsmasq),
        data.legacy_present === true || data.legacy_present == "1",
        data.legacy_interfaces
    );
    plan.summary = dnsmasq_restore_summary(plan);
    write_json(plan);
}

function main(argv) {
    let mode = argv[0] || "";

    if (mode == "migrate")
        return migrate_runtime("forkop") ? 0 : 1;
    if (mode == "migrate-podkop")
        return migrate_runtime("podkop") ? 0 : 1;
    if (mode == "commit")
        return commit_runtime() ? 0 : 1;
    if (mode == "migrate-fixture") {
        return migrate_fixture(argv[1], argv[2] || "forkop") ? 0 : 1;
    }
    if (mode == "restore-dnsmasq-fixture") {
        restore_dnsmasq_fixture(argv[1]);
        return 0;
    }

    warn("Usage: config/migration.uc migrate\n");
    warn("       config/migration.uc migrate-podkop\n");
    warn("       config/migration.uc commit\n");
    warn("       config/migration.uc migrate-fixture <fixture.json> [forkop|podkop]\n");
    warn("       config/migration.uc restore-dnsmasq-fixture <dhcp.json>\n");
    return 1;
}

function module_exports() {
    return {
        main: main,
        migrate_model: migrate_model,
        migrate_forkop_model: migrate_forkop_model,
        migrate_podkop_model: migrate_podkop_model,
        mark_internal_config_guard: mark_internal_config_guard
    };
}

if (sourcepath(1) != null && sourcepath(1) != "")
    return module_exports();

exit(main(ARGV));
