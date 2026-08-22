#!/usr/bin/env ucode

// Keep migrations in this file. A migration is identified by a stable name;
// release checks are optional conditions inside the migration itself.

let fs = require("fs");
let common = require("core.common");
let uci_core = require("core.uci");
let constants_module = require("core.constants");
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
const CHILD_ITEM_TYPES = [
    "server_client",
    "subscription_url",
    "section_interface",
    "urltest",
    "fallback_group",
    "fallback_level",
    "priority_group",
    "priority_level"
];

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function command_output(command) {
    let pipe = fs.popen(command, "r");
    if (!pipe)
        return "";

    let data = pipe.read("all");
    let status = pipe.close();
    if (status != 0 || data == null)
        return "";

    return replace(as_string(data), /[\r\n]+$/g, "");
}

function run(command) {
    return system(command) == 0;
}

function constants_context() {
    let constants = object_or_empty(constants_module);
    return {
        zapret_legacy_default_nfqws_opt: as_string(constants.ZAPRET_LEGACY_DEFAULT_NFQWS_OPT),
        zapret_default_nfqws_opt: as_string(constants.ZAPRET_DEFAULT_NFQWS_OPT),
        urltest_default_idle_timeout: as_string(object_or_empty(singbox_constants_module).URLTEST_DEFAULT_IDLE_TIMEOUT || "30m")
    };
}

function section_name(section) {
    return option(section, ".name", "");
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
        rules: [],
        sections: [],
        servers: []
    };
    for (let type_name in CHILD_ITEM_TYPES)
        model[type_name] = [];

    if (model.settings[".name"] == null)
        model.settings[".name"] = "settings";
    if (model.settings[".type"] == null)
        model.settings[".type"] = "settings";

    for (let section in fixture_section_list(data, "rule"))
        push(model.rules, clone_section(section));
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
        rules: [],
        sections: [],
        servers: []
    };
    for (let type_name in CHILD_ITEM_TYPES)
        model[type_name] = [];

    cursor.foreach(CONFIG_NAME, "rule", function(section) {
        push(model.rules, clone_section(section));
    });
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
    if (length(model.rules) > 0)
        result.rule = model.rules;
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
        added_lists: {},
        changed: false
    };
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

function set_list_option_if_not_empty(ctx, section, key, values) {
    if (length(values || []) > 0)
        set_list_option(ctx, section, key, values);
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

function create_child_for_section(ctx, parent, type_name) {
    let child = create_child_section(ctx, type_name);
    set_option(ctx, child, "section", section_name(parent));
    return child;
}

function create_child_for_owner(ctx, parent, type_name, owner_option) {
    let child = create_child_section(ctx, type_name);
    set_option(ctx, child, owner_option, section_name(parent));
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

function whitespace_list_values(section, key) {
    let value = object_or_empty(section)[key];
    if (type(value) == "array")
        return value;
    return list_option(section, key);
}

function subscription_url_entry_profile(value) {
    let entry = trim(as_string(value));
    let result = {
        raw: entry,
        value: entry,
        user_agent: "",
        changed: false
    };
    let delimiter = " | ";
    let delimiter_index = rindex(entry, delimiter);

    if (delimiter_index < 0)
        return result;

    let url = trim(substr(entry, 0, delimiter_index));
    let user_agent = trim(substr(entry, delimiter_index + length(delimiter)));
    if (url == "" || user_agent == "")
        return result;

    result.value = url;
    result.user_agent = user_agent;
    result.changed = true;
    return result;
}

function normalize_connections_list(ctx, section, old_key, new_key) {
    let old_values = option_list_values(section, old_key);

    for (let value in old_values)
        add_list_unique(ctx, section, new_key, value);

    if (length(old_values) > 0)
        delete_option(ctx, section, old_key);
}

function set_section_type(ctx, section, type_name) {
    if (option(section, ".type", "") == type_name)
        return;

    section[".type"] = type_name;
    record_operation(ctx, { op: "set_type", section: section_name(section), type: type_name });
}

function duration_to_seconds_value(value) {
    let rest = as_string(value);
    if (rest == "")
        return null;

    let total = 0.0;
    let multipliers = {
        ns: 0.000000001,
        us: 0.000001,
        ms: 0.001,
        s: 1,
        m: 60,
        h: 3600,
        d: 86400
    };

    while (rest != "") {
        let matched = match(rest, /^([0-9]+(\.[0-9]+)?)(ns|us|ms|s|m|h|d)/);
        if (!matched)
            return null;

        let token = as_string(matched[0]);
        let amount = matched[1] * 1;
        let unit = matched[3];
        total += amount * multipliers[unit];
        rest = substr(rest, length(token));
    }

    return total <= 0 ? null : int(total + 0.5);
}

function legacy_urltest_idle_timeout(section, constants) {
    let interval = option(section, "urltest_check_interval", "3m") || "3m";
    let interval_seconds = duration_to_seconds_value(interval);
    let default_idle_seconds = duration_to_seconds_value(object_or_empty(constants).urltest_default_idle_timeout || "30m");
    return interval_seconds != null && default_idle_seconds != null && interval_seconds > default_idle_seconds
        ? interval
        : "";
}

const LEGACY_URLTEST_OPTIONS = [
    "urltest_enabled",
    "urltest_check_interval",
    "urltest_tolerance",
    "urltest_testing_url",
    "urltest_filter_mode",
    "urltest_hide_filtered_outbounds",
    "detect_server_country",
    "urltest_include_countries",
    "urltest_include_outbounds",
    "urltest_include_regex",
    "urltest_exclude_countries",
    "urltest_exclude_outbounds",
    "urltest_exclude_regex"
];

function delete_legacy_urltest_options(ctx, section) {
    for (let key in LEGACY_URLTEST_OPTIONS)
        delete_option(ctx, section, key);
}

function migrate_urltest_filter_mode(ctx, section) {
    if (option_exists(section, "urltest_filter_mode"))
        return;

    if (option_exists(section, "urltest_exclude_countries") ||
        option_exists(section, "urltest_include_countries") ||
        option_exists(section, "urltest_exclude_outbounds") ||
        option_exists(section, "urltest_exclude_regex")) {
        set_option(ctx, section, "urltest_filter_mode", "exclude");
    }
}

function trim_lines(value) {
    let result = [];
    for (let line in split(as_string(value), "\n")) {
        line = trim(replace(as_string(line), /\r/g, ""));
        if (line != "")
            push(result, line);
    }
    return result;
}

function migrate_urltest_link(ctx, section, link) {
    add_list_unique(ctx, section, "selector_proxy_links", link);
}

function migrate_proxy_string(ctx, section) {
    let proxy_string = option(section, "proxy_string", "");
    if (proxy_string == "")
        return;

    let migrated = false;
    for (let link in trim_lines(proxy_string)) {
        if (substr(link, 0, 2) == "//")
            continue;
        add_list_unique(ctx, section, "selector_proxy_links", link);
        migrated = true;
    }

    if (migrated)
        delete_option(ctx, section, "proxy_string");
}

function cache_section_safe(section) {
    section = as_string(section);
    return section != "" && index(section, "/") < 0 && index(section, "..") < 0;
}

function subscription_cache_paths(section) {
    return [
        TMP_SUBSCRIPTION_FOLDER + "/" + section + ".json",
        TMP_SUBSCRIPTION_FOLDER + "/" + section + ".url",
        TMP_SUBSCRIPTION_FOLDER + "/" + section + ".user_agent",
        FORKOP_SUBSCRIPTION_METADATA_DIR + "/" + section + ".json",
        FORKOP_SUBSCRIPTION_LINKS_DIR + "/" + section + ".json",
        FORKOP_OUTBOUND_METADATA_DIR + "/" + section + ".json",
        TMP_SUBSCRIPTION_FOLDER + "/" + section + "-subscription-*.json",
        TMP_SUBSCRIPTION_FOLDER + "/" + section + "-subscription-*.url",
        TMP_SUBSCRIPTION_FOLDER + "/" + section + "-subscription-*.user_agent"
    ];
}

function delete_subscription_cache(ctx, section) {
    section = as_string(section);
    if (!cache_section_safe(section))
        return;

    for (let path in subscription_cache_paths(section))
        push(ctx.removed_caches, path);
}

function migrate_subscription_url(ctx, section) {
    let subscription_url = option(section, "subscription_url", "");
    if (subscription_url == "")
        return;

    let subscription_user_agent = option(section, "subscription_user_agent", "");
    let entry = subscription_user_agent != ""
        ? subscription_url + " | " + subscription_user_agent
        : subscription_url;
    add_list_unique(ctx, section, "subscription_urls", entry);
    delete_option(ctx, section, "subscription_url");
    delete_option(ctx, section, "subscription_user_agent");
    delete_subscription_cache(ctx, section_name(section));
}

function migrate_interval_flags(ctx, section, proxy_config_type) {
    if (proxy_config_type == "urltest" || proxy_config_type == "subscription") {
        if (option(section, "urltest_check_interval_disabled", "") == "1")
            set_option(ctx, section, "urltest_enabled", "0");
        else
            set_option_if_missing(ctx, section, "urltest_enabled", "1");
    }
    else if (proxy_config_type == "url" || proxy_config_type == "selector") {
        set_option_if_missing(ctx, section, "urltest_enabled", "0");
    }

    if (proxy_config_type == "subscription") {
        if (option(section, "subscription_update_interval_disabled", "") == "1")
            set_option(ctx, section, "subscription_update_enabled", "0");
        else
            set_option_if_missing(ctx, section, "subscription_update_enabled", "1");
    }

    delete_option(ctx, section, "urltest_check_interval_disabled");
    delete_option(ctx, section, "subscription_update_interval_disabled");
}

function migrate_proxy_rule(ctx, section, proxy_config_type) {
    if (proxy_config_type == "url")
        migrate_proxy_string(ctx, section);
    else if (proxy_config_type == "urltest") {
        for (let link in list_option(section, "urltest_proxy_links"))
            migrate_urltest_link(ctx, section, link);
        delete_option(ctx, section, "urltest_proxy_links");
    }
    else if (proxy_config_type == "subscription") {
        migrate_subscription_url(ctx, section);
        delete_subscription_cache(ctx, section_name(section));
    }

    migrate_interval_flags(ctx, section, proxy_config_type);
    delete_option(ctx, section, "proxy_config_type");
}

// Podkop Plus -> Forkop source migration.
function migrated_rule_action(section) {
    let action = option(section, "action", "");
    let proxy_config_type = option(section, "proxy_config_type", "");
    let connection_type = option(section, "connection_type", "");
    let iface = option(section, "interface", "");
    let outbound_json = option(section, "outbound_json", "");
    let selector_proxy_links = option(section, "selector_proxy_links", "");
    let subscription_urls = option(section, "subscription_urls", "");

    if (action == "proxy" || action == "vpn" || action == "outbound")
        return "connection";

    if (action == "direct")
        return "bypass";

    if (action != "")
        return action;

    if (connection_type == "proxy")
        return "connection";
    if (connection_type == "vpn")
        return "connection";
    if (connection_type == "block")
        return "block";
    if (connection_type == "exclusion")
        return "bypass";

    if (proxy_config_type == "interface")
        return "connection";
    if (proxy_config_type == "outbound")
        return "connection";
    if (proxy_config_type == "url" || proxy_config_type == "selector" ||
        proxy_config_type == "urltest" || proxy_config_type == "subscription")
        return "connection";

    if (outbound_json != "")
        return "connection";
    if (iface != "")
        return "connection";
    if (selector_proxy_links != "" || subscription_urls != "")
        return "connection";

    return "";
}

function legacy_rule_connection_kind(section) {
    let action = option(section, "action", "");
    let proxy_config_type = option(section, "proxy_config_type", "");
    let connection_type = option(section, "connection_type", "");

    if (action == "vpn" || connection_type == "vpn" || proxy_config_type == "interface")
        return "interface";
    if (action == "outbound" || proxy_config_type == "outbound")
        return "outbound";
    if (action == "proxy" || connection_type == "proxy" ||
        proxy_config_type == "url" || proxy_config_type == "selector" ||
        proxy_config_type == "urltest" || proxy_config_type == "subscription")
        return "proxy";
    if (option(section, "interface", "") != "")
        return "interface";
    if (option(section, "outbound_json", "") != "")
        return "outbound";
    return "proxy";
}

function migrate_byedpi_cmd_opts(ctx, section) {
    let cmd_opts = option(section, "cmd_opts", "");
    if (cmd_opts == "")
        return;

    if (option(section, "byedpi_cmd_opts", "") == "")
        set_option(ctx, section, "byedpi_cmd_opts", cmd_opts);
    delete_option(ctx, section, "cmd_opts");
}

function migrate_zapret_nfqws_default(ctx, section, constants) {
    if (migrated_rule_action(section) != "zapret")
        return;

    let nfqws_opt = option(section, "nfqws_opt", "");
    if (nfqws_opt == "" || nfqws_opt != constants.zapret_legacy_default_nfqws_opt)
        return;

    set_option(ctx, section, "nfqws_opt", constants.zapret_default_nfqws_opt);
}

function migrate_subscription_url_item_settings(ctx, section) {
    let values = whitespace_list_values(section, "subscription_urls");
    let seen_values = {};
    let update_enabled = bool_option(section, "subscription_update_enabled", true);
    let update_interval = option(section, "subscription_update_interval", "");
    if (update_interval == "")
        update_interval = "1h";
    let index = 1;

    for (let value in values) {
        let profile = subscription_url_entry_profile(value);
        if (profile.value == "")
            continue;
        if (seen_values[profile.value])
            continue;
        seen_values[profile.value] = true;

        let child = create_child_for_section(ctx, section, "subscription_url");
        set_option(ctx, child, "url", profile.value);
        set_option(ctx, child, "subscription_update_enabled", update_enabled ? "1" : "0");
        set_option(ctx, child, "subscription_update_interval", update_enabled ? update_interval : "");
        set_option(ctx, child, "user_agent", profile.user_agent != "" ? profile.user_agent : "sing-box");
        set_option(ctx, child, "auto_hwid", "1");
        set_option(ctx, child, "show_dashboard_metadata", "1");
        set_option(ctx, child, "show_subscription_name", "0");
        index++;
    }

    delete_option(ctx, section, "subscription_urls");
    delete_option(ctx, section, "subscription_url_settings");
}

function migrate_urltest_item_settings(ctx, section, constants) {
    let legacy_enabled = bool_option(section, "urltest_enabled", false);

    if (legacy_enabled) {
        let child = create_child_for_section(ctx, section, "urltest");
        set_option(ctx, child, "name", "Fastest");
        set_option(ctx, child, "check_interval", option(section, "urltest_check_interval", "3m") || "3m");
        set_option(ctx, child, "tolerance", option(section, "urltest_tolerance", "50") || "50");
        set_option(ctx, child, "testing_url", option(section, "urltest_testing_url", "https://www.gstatic.com/generate_204") || "https://www.gstatic.com/generate_204");
        set_option(ctx, child, "filter_mode", option(section, "urltest_filter_mode", "disabled") || "disabled");

        let idle_timeout = legacy_urltest_idle_timeout(section, constants);
        if (idle_timeout != "")
            set_option(ctx, child, "idle_timeout", idle_timeout);

        set_list_option_if_not_empty(ctx, child, "include_countries", option_list_values(section, "urltest_include_countries"));
        set_list_option_if_not_empty(ctx, child, "include_outbounds", option_list_values(section, "urltest_include_outbounds"));
        set_list_option_if_not_empty(ctx, child, "include_regex", option_list_values(section, "urltest_include_regex"));
        set_list_option_if_not_empty(ctx, child, "exclude_countries", option_list_values(section, "urltest_exclude_countries"));
        set_list_option_if_not_empty(ctx, child, "exclude_outbounds", option_list_values(section, "urltest_exclude_outbounds"));
        set_list_option_if_not_empty(ctx, child, "exclude_regex", option_list_values(section, "urltest_exclude_regex"));
    }

    delete_legacy_urltest_options(ctx, section);
    delete_option(ctx, section, "urltest_settings");
}

function migrate_interface_item_settings(ctx, section) {
    let owner = section_name(section);
    let resolver_enabled = bool_option(section, "domain_resolver_enabled", false) ? "1" : "0";
    let dns_type = option(section, "domain_resolver_dns_type", "udp") || "udp";
    let dns_server = option(section, "domain_resolver_dns_server", "8.8.8.8") || "8.8.8.8";
    let seen_values = {};

    for (let child in ctx.model.section_interface || []) {
        if (option(child, "section", "") != owner)
            continue;

        let value = option(child, "name", "");
        if (value == "" || seen_values[value])
            continue;

        seen_values[value] = true;
        set_option_if_missing(ctx, child, "domain_resolver_enabled", resolver_enabled);
        set_option_if_missing(ctx, child, "domain_resolver_dns_type", dns_type);
        set_option_if_missing(ctx, child, "domain_resolver_dns_server", dns_server);
    }

    let values = option_list_values(section, "interfaces");
    let legacy_interface = option(section, "interface", "");
    if (legacy_interface != "")
        push(values, legacy_interface);

    for (let value in values) {
        value = as_string(value);
        if (value == "" || seen_values[value])
            continue;

        seen_values[value] = true;
        let child = create_child_for_section(ctx, section, "section_interface");
        set_option(ctx, child, "name", value);
        set_option(ctx, child, "domain_resolver_enabled", resolver_enabled);
        set_option(ctx, child, "domain_resolver_dns_type", dns_type);
        set_option(ctx, child, "domain_resolver_dns_server", dns_server);
    }

    delete_option(ctx, section, "interface");
    delete_option(ctx, section, "interfaces");
    delete_option(ctx, section, "interface_settings");
    delete_option(ctx, section, "domain_resolver_enabled");
    delete_option(ctx, section, "domain_resolver_dns_type");
    delete_option(ctx, section, "domain_resolver_dns_server");
}

function migrate_legacy_outbound_json_detour(ctx, section, legacy_connection_kind) {
    if (legacy_connection_kind != "outbound" ||
        !bool_option(section, "outbound_detour_enabled", false))
        return;

    let detour_section = option(section, "outbound_detour_section", "");
    let outbound_json = option(section, "outbound_json", "");
    if (detour_section == "" || outbound_json == "")
        return;

    let outbound;
    try {
        outbound = json(outbound_json);
    }
    catch (e) {
        return;
    }
    if (type(outbound) != "object")
        return;

    if (as_string(outbound.detour || "") == "")
        outbound.detour = singbox_constants_module.outbound_tag(detour_section);
    set_option(ctx, section, "outbound_json", sprintf("%J", outbound));
    delete_option(ctx, section, "outbound_detour_enabled");
    delete_option(ctx, section, "outbound_detour_section");
}

function migrate_outbound_json_list(ctx, section, legacy_connection_kind) {
    migrate_legacy_outbound_json_detour(ctx, section, legacy_connection_kind);

    let outbound_json = option(section, "outbound_json", "");
    if (outbound_json != "") {
        let outbound;
        try {
            outbound = json(outbound_json);
        }
        catch (e) {
            outbound = null;
        }

        if (type(outbound) == "object" && trim(as_string(outbound.tag || "")) == "") {
            let existing = option_list_values(section, "outbound_jsons");
            let taken = {};
            for (let value in existing) {
                try {
                    let item = json(value);
                    let tag_name = type(item) == "object" ? trim(as_string(item.tag || "")) : "";
                    if (tag_name != "")
                        taken[tag_name] = true;
                }
                catch (e) {
                }
            }

            let base = singbox_constants_module.outbound_tag(
                section_name(section) + "-json-" + (length(existing) + 1)
            );
            let tag_name = base;
            for (let suffix = 1; taken[tag_name]; suffix++)
                tag_name = base + "-" + suffix;
            outbound.tag = tag_name;
            set_option(ctx, section, "outbound_json", sprintf("%J", outbound));
        }
    }

    normalize_connections_list(ctx, section, "outbound_json", "outbound_jsons");
}

function migrate_connection_section(ctx, section, constants, legacy_connection_kind) {
    migrate_subscription_url_item_settings(ctx, section);
    migrate_urltest_item_settings(ctx, section, constants);
    migrate_interface_item_settings(ctx, section);
    migrate_outbound_json_list(ctx, section, legacy_connection_kind);

    delete_option(ctx, section, "subscription_update_enabled");
    delete_option(ctx, section, "subscription_update_interval");
    delete_option(ctx, section, "enable_udp_over_tcp");
}

function strip_list_comment(line) {
    line = replace(as_string(line), /[[:space:]]*\/\/.*$/, "");
    return replace(line, /[[:space:]]*#.*$/, "");
}

function text_list_values(value, separator_mode) {
    let result = [];
    separator_mode = as_string(separator_mode);

    for (let line in split(as_string(value), "\n")) {
        line = strip_list_comment(line);
        line = separator_mode == "comma-space"
            ? replace(line, /[ ,]/g, "\n")
            : replace(line, /,/g, "\n");

        for (let item in split(line, "\n")) {
            item = trim(replace(item, /\r/g, ""));
            if (item != "")
                push(result, item);
        }
    }

    return result;
}

function filter_domain_values(values) {
    let result = [];
    for (let value in values) {
        let normalized = domain_config.suffix_to_ascii(value);
        if (normalized != null)
            push(result, normalized);
    }
    return result;
}

function generic_values_from_text(value) {
    return text_list_values(value, "comma");
}

function legacy_condition_values(kind, text_mode, conditions_text_mode, text_value, list_value) {
    if (int(text_mode || 0) == 1 || int(conditions_text_mode || 0) == 1)
        return kind == "domains"
            ? filter_domain_values(text_list_values(text_value, "comma-space"))
            : generic_values_from_text(text_value);

    let result = [];
    for (let item in list_option({ value: list_value }, "value"))
        push(result, item);
    if (length(result) > 0)
        return result;

    if (as_string(text_value) != "")
        return kind == "domains"
            ? filter_domain_values(text_list_values(text_value, "comma-space"))
            : generic_values_from_text(text_value);

    return [];
}

function add_unique_value(result, seen, value) {
    value = as_string(value);
    if (value == "" || seen[value])
        return;

    seen[value] = true;
    push(result, value);
}

function has_domain_condition_prefix(value) {
    let colon = index(value, ":");
    if (colon <= 0)
        return false;

    let prefix = domain_config.ascii_lower(substr(value, 0, colon));
    return prefix == "full" || prefix == "keyword" || prefix == "regex";
}

function add_values_with_prefix(result, seen, values, prefix) {
    for (let value in values) {
        value = trim(as_string(value));
        add_unique_value(result, seen, has_domain_condition_prefix(value) ? value : prefix + value);
    }
}

function legacy_values_for_option(section, option_name, kind) {
    return legacy_condition_values(
        kind,
        option(section, option_name + "_text_mode", "0"),
        option(section, "conditions_text_mode", "0"),
        option(section, option_name + "_text", ""),
        section[option_name]
    );
}

function raw_text_condition_values(section, option_name) {
    return text_list_values(option(section, option_name, ""), "comma-space");
}

function add_domain_values_with_prefix(result, seen, section, option_name, prefix, kind) {
    let values = legacy_condition_values(
        kind,
        option(section, option_name + "_text_mode", "0"),
        option(section, "conditions_text_mode", "0"),
        option(section, option_name + "_text", ""),
        section[option_name]
    );

    add_values_with_prefix(result, seen, values, prefix);
}

function migrate_combined_domain_conditions(ctx, section) {
    let values = [];
    let seen = {};

    for (let value in list_option(section, "domain_suffix"))
        add_unique_value(values, seen, value);
    for (let value in raw_text_condition_values(section, "domain_suffix_text"))
        add_unique_value(values, seen, value);

    add_domain_values_with_prefix(values, seen, section, "domain", "full:", "domains");
    add_domain_values_with_prefix(values, seen, section, "domain_keyword", "keyword:", "generic");
    add_domain_values_with_prefix(values, seen, section, "domain_regex", "regex:", "generic");

    if (length(values) > 0)
        set_option(ctx, section, "domain", join("\n", values));
    else
        delete_option(ctx, section, "domain");

    delete_option(ctx, section, "domain_suffix");
    delete_option(ctx, section, "domain_suffix_text");
    delete_option(ctx, section, "domain_suffix_text_mode");
    delete_option(ctx, section, "domain_keyword");
    delete_option(ctx, section, "domain_regex");
    delete_option(ctx, section, "domain_text");
    delete_option(ctx, section, "domain_keyword_text");
    delete_option(ctx, section, "domain_regex_text");
    delete_option(ctx, section, "domain_text_mode");
    delete_option(ctx, section, "domain_keyword_text_mode");
    delete_option(ctx, section, "domain_regex_text_mode");
}

function migrate_text_condition(ctx, section, option_name, kind) {
    let values = legacy_values_for_option(section, option_name, kind);
    if (length(values) > 0)
        set_option(ctx, section, option_name, join("\n", values));
    else if (option_exists(section, option_name) && type(section[option_name]) == "array")
        delete_option(ctx, section, option_name);

    delete_option(ctx, section, option_name + "_text");
    delete_option(ctx, section, option_name + "_text_mode");
}

function migrate_rule(ctx, section, converted_from_rule, constants) {
    let action = migrated_rule_action(section);
    let legacy_connection_kind = legacy_rule_connection_kind(section);
    let proxy_config_type = option(section, "proxy_config_type", "");
    let subscription_urls = option(section, "subscription_urls", "");

    if (action != "")
        set_option(ctx, section, "action", action);

    delete_option(ctx, section, "connection_type");
    delete_option(ctx, section, "subscription_group_by_countries");
    delete_option(ctx, section, "group_by_countries");
    delete_option(ctx, section, "subscription_detect_server_countries");

    if (action == "connection") {
        migrate_urltest_filter_mode(ctx, section);
        if (legacy_connection_kind == "proxy")
            migrate_proxy_rule(ctx, section, proxy_config_type);
        else {
            delete_option(ctx, section, "proxy_config_type");
            delete_option(ctx, section, "proxy_string");
            delete_option(ctx, section, "urltest_proxy_links");
            delete_option(ctx, section, "subscription_url");
            delete_option(ctx, section, "subscription_user_agent");
            delete_option(ctx, section, "urltest_check_interval_disabled");
            delete_option(ctx, section, "subscription_update_interval_disabled");
        }
        migrate_connection_section(ctx, section, constants, legacy_connection_kind);
        if (converted_from_rule && subscription_urls != "")
            delete_subscription_cache(ctx, section_name(section));
    }
    else if (action == "block" ||
        action == "bypass" || action == "zapret" || action == "zapret2" || action == "byedpi") {
        delete_option(ctx, section, "proxy_config_type");
        delete_option(ctx, section, "proxy_string");
        delete_option(ctx, section, "urltest_proxy_links");
        delete_option(ctx, section, "subscription_url");
        delete_option(ctx, section, "subscription_user_agent");
        delete_option(ctx, section, "urltest_check_interval_disabled");
        delete_option(ctx, section, "subscription_update_interval_disabled");
    }

    if (action != "connection")
        delete_legacy_urltest_options(ctx, section);

    migrate_byedpi_cmd_opts(ctx, section);
    migrate_zapret_nfqws_default(ctx, section, constants);
}

function migrate_rule_section(ctx, section, constants) {
    set_section_type(ctx, section, "section");
    migrate_rule(ctx, section, true, constants);
    migrate_combined_domain_conditions(ctx, section);
    migrate_text_condition(ctx, section, "ip_cidr", "subnets");
}

function migrate_list_update_enabled(ctx) {
    let settings = ctx.model.settings;
    if (option_exists(settings, "list_update_enabled")) {
        if (bool_option(settings, "list_update_enabled", true) &&
            option(settings, "update_interval", "") == "") {
            set_option(ctx, settings, "update_interval", "1d");
        }
        return;
    }

    if (option(settings, "update_interval", "") != "") {
        set_option(ctx, settings, "list_update_enabled", "1");
    }
    else {
        set_option(ctx, settings, "list_update_enabled", "0");
        set_option(ctx, settings, "update_interval", "1d");
    }
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

function migrate_dns_server_lists(ctx) {
    normalize_existing_list_option(ctx, ctx.model.settings, "dns_server");
    normalize_existing_list_option(ctx, ctx.model.settings, "bootstrap_dns_server");
}

function migrate_download_via_proxy_flags(ctx) {
    let settings = ctx.model.settings;
    let legacy_section = option(settings, "download_lists_via_proxy_section", "");
    let lists_enabled = bool_option(settings, "download_lists_via_proxy", false);
    let components_enabled = option_exists(settings, "download_components_via_proxy")
        ? bool_option(settings, "download_components_via_proxy", false)
        : lists_enabled;

    set_option(ctx, settings, "download_lists_via_proxy", lists_enabled ? "1" : "0");
    if (!lists_enabled)
        delete_option(ctx, settings, "download_lists_via_proxy_section");

    set_option(ctx, settings, "download_components_via_proxy", components_enabled ? "1" : "0");
    if (components_enabled) {
        if (option(settings, "download_components_via_proxy_section", "") == "" && legacy_section != "")
            set_option(ctx, settings, "download_components_via_proxy_section", legacy_section);
    }
    else {
        delete_option(ctx, settings, "download_components_via_proxy_section");
    }
}

function migrate_subscription_download_via_proxy_settings(ctx) {
    let settings_section = ctx.model.settings;
    let enabled = bool_option(settings_section, "download_subscriptions_via_proxy", false);
    let target_section = option(settings_section, "download_lists_via_proxy_section", "");

    if (enabled && target_section != "") {
        for (let child in ctx.model.subscription_url || []) {
            let name = option(child, "section", "");
            if (name == "" || name == target_section)
                continue;
            set_option(ctx, child, "download_via_proxy_enabled", "1");
            set_option(ctx, child, "download_via_proxy_section", target_section);
        }
    }

    delete_option(ctx, settings_section, "download_subscriptions_via_proxy");
}

function migrate_rule_set_settings(ctx, section) {
    let normalize_list = function(key) {
        let seen = {};
        let result = [];
        for (let reference in option_list_values(section, key)) {
            reference = as_string(reference);
            if (reference == "" || seen[reference])
                continue;
            seen[reference] = true;
            push(result, reference);
        }
        if (length(result) > 0)
            set_list_option(ctx, section, key, result);
        else
            delete_option(ctx, section, key);
    };

    normalize_list("community_lists");
    normalize_list("rule_set");
    normalize_list("rule_set_with_subnets");
    delete_option(ctx, section, "rule_set_settings");
}

function version_parts(value) {
    let matched = match(as_string(value), /^([0-9]+)\.([0-9]+)\.([0-9]+)$/);
    if (!matched)
        return [ 0, 0, 0 ];
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

function release_at_most(ctx, version) {
    return compare_versions(ctx.source_release, version) <= 0;
}

function migrate_interface_sections(ctx) {
    if (!release_at_most(ctx, "1.0.1"))
        return;

    for (let section in ctx.model.sections)
        migrate_interface_item_settings(ctx, section);
}

function migrate_interface_display_names(ctx) {
    if (!release_at_most(ctx, "1.0.5"))
        return;

    for (let child in ctx.model.section_interface || []) {
        let name = trim(option(child, "name", ""));
        if (name != "")
            set_option_if_missing(ctx, child, "display_name", name);
    }
}

function migrate_enable_component_checks(ctx) {
    if (!release_at_most(ctx, "1.0.1"))
        return;

    set_option(ctx, ctx.model.settings, "component_update_check_enabled", "1");
}

function migrate_http_connection_urls(_ctx) {
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
    "blacklist_timeout",
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

function migrate_dns_fallback_modes(ctx) {
    let settings = ctx.model.settings;
    set_option_if_missing(ctx, settings, "dns_main_fallback_strategy", "parallel");
    set_option_if_missing(ctx, settings, "dns_bootstrap_fallback_strategy", "parallel");
    delete_option(ctx, settings, "dns_fallback_strategy");
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

function remove_subscription_group_settings_map(ctx, section) {
    let raw = option(section, "subscription_url_settings", "");
    if (raw == "")
        return false;

    let settings;
    try {
        settings = json(raw);
    }
    catch (e) {
        return false;
    }
    if (type(settings) != "object")
        return false;

    let changed = false;
    for (let _, item in settings) {
        if (type(item) != "object")
            continue;
        for (let key in OBSOLETE_SUBSCRIPTION_GROUP_OPTIONS) {
            if (!option_exists(item, key))
                continue;
            delete item[key];
            changed = true;
        }
    }
    if (changed)
        set_option(ctx, section, "subscription_url_settings", sprintf("%J", settings));
    return changed;
}

function use_leaf_subscription_providers(ctx) {
    for (let child in ctx.model.subscription_url || []) {
        for (let key in OBSOLETE_SUBSCRIPTION_GROUP_OPTIONS)
            delete_option(ctx, child, key);
    }
    for (let section in ctx.model.sections || []) {
        for (let key in OBSOLETE_SUBSCRIPTION_GROUP_OPTIONS)
            delete_option(ctx, section, key);
        remove_subscription_group_settings_map(ctx, section);
    }
}

function remove_section_cache(ctx) {
    push(ctx.removed_caches, FORKOP_SECTION_CACHE_DIR);
}

function set_option_if_blank(ctx, section, key, value) {
    if (option(section, key, "") == "")
        set_option(ctx, section, key, value);
}

function hex_digit_value(value) {
    value = ord(lc(as_string(value)));
    if (value >= 48 && value <= 57)
        return value - 48;
    if (value >= 97 && value <= 102)
        return value - 87;
    return -1;
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
        if (protocol == "vless" || protocol == "vmess") {
            set_option_if_blank(ctx, server, "server_uuid", credential);
            if (protocol == "vless" && extra != "")
                set_option_if_blank(ctx, server, "vless_flow", extra);
            else if (protocol == "vmess" && match(extra, /^[0-9]+$/) != null)
                set_option_if_blank(ctx, server, "vmess_alter_id", extra);
        }
        else if (protocol == "shadowsocks" || protocol == "socks" || protocol == "trojan" || protocol == "hysteria2") {
            set_option_if_blank(ctx, server, "server_password", credential);
            if (protocol == "socks" && name != "")
                set_option_if_blank(ctx, server, "server_username", name);
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

function add_extended_server_defaults(ctx) {
    set_option_if_missing(ctx, ctx.model.settings, "unified_delay", "0");
    for (let server in ctx.model.servers || []) {
        let protocol = option(server, "protocol", "vless");
        migrate_legacy_server_user(ctx, server, protocol);
        delete_option(ctx, server, "mtproto_padding");
        // Only the options the dialog still asks for. The expert knobs this migration
        // used to fill in are removed again further down the list, so writing them
        // here would just be work undone.
        if (protocol == "naive")
            set_option_if_missing(ctx, server, "naive_network", "tcp");
        else if (protocol == "mieru")
            set_option_if_missing(ctx, server, "mieru_transport", "TCP");
        else if (protocol == "tuic") {
            set_option_if_missing(ctx, server, "tuic_congestion_control", "cubic");
            set_option_if_missing(ctx, server, "tuic_heartbeat", "10s");
            set_option_if_missing(ctx, server, "tuic_zero_rtt_handshake", "0");
        }
    }
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

function remove_proxy_parameter_fields(value) {
    let changed = false;
    if (type(value) == "array") {
        for (let item in value)
            if (remove_proxy_parameter_fields(item))
                changed = true;
        return changed;
    }
    if (type(value) != "object")
        return false;

    for (let key in OBSOLETE_PROXY_PARAMETER_FILTER_OPTIONS) {
        if (!option_exists(value, key))
            continue;
        delete value[key];
        changed = true;
    }
    for (let key, item in value)
        if (remove_proxy_parameter_fields(item))
            changed = true;
    return changed;
}

function clean_proxy_parameter_settings_map(ctx, section, key) {
    let raw = option(section, key, "");
    if (raw == "")
        return;

    let settings;
    try {
        settings = json(raw);
    }
    catch (e) {
        return;
    }
    if (remove_proxy_parameter_fields(settings))
        set_option(ctx, section, key, sprintf("%J", settings));
}

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
        for (let map_key in [
            "subscription_url_settings",
            "urltest_settings",
            "priority_group_settings",
            "priority_level_settings",
            "fallback_group_settings",
            "fallback_level_settings"
        ])
            clean_proxy_parameter_settings_map(ctx, section, map_key);
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
        else if (option_exists(section, "filter_enabled")) {
            if (!bool_option(section, "filter_enabled", false))
                mode = "all";
            else if (length(include_outbounds) > 0 || include_regex != "")
                mode = "include";
            else if (length(exclude_outbounds) > 0 || exclude_regex != "")
                mode = "exclude";
            else
                mode = "all";
        }
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
    "filter_enabled",
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
        "filter_enabled",
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

function apply_migrated_filter_object(section, values) {
    section.server_filter_mode = values.server_filter_mode;
    for (let key in [ "include_outbounds", "exclude_outbounds" ]) {
        if (length(values[key]) > 0)
            section[key] = values[key];
        else
            delete section[key];
    }
    for (let key in [ "include_regex", "exclude_regex" ]) {
        if (values[key] != "")
            section[key] = values[key];
        else
            delete section[key];
    }
    for (let key in LEGACY_SERVER_FILTER_OPTIONS)
        delete section[key];
}

function migrate_filter_settings_map(ctx, section, key, kind) {
    let raw = option(section, key, "");
    if (raw == "")
        return;

    let settings;
    try {
        settings = json(raw);
    }
    catch (e) {
        return;
    }
    if (type(settings) != "object")
        return;

    let before = sprintf("%J", settings);
    for (let _, item in settings) {
        if (type(item) != "object" || !has_server_filter_fields(item))
            continue;
        let values = migrated_filter_values(item, kind);
        apply_migrated_filter_object(item, values);
    }
    if (sprintf("%J", settings) != before)
        set_option(ctx, section, key, sprintf("%J", settings));
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

    for (let section in ctx.model.sections || []) {
        migrate_filter_settings_map(ctx, section, "subscription_url_settings", "subscription");
        migrate_filter_settings_map(ctx, section, "urltest_settings", "urltest");
        migrate_filter_settings_map(ctx, section, "fallback_level_settings", "fallback");
        migrate_filter_settings_map(ctx, section, "priority_level_settings", "fallback");
    }
}

function migrate_server_filter_modes(ctx) {
    migrate_server_filter_model(ctx);
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

    for (let section in ctx.model.sections || []) {
        let raw = option(section, "subscription_url_settings", "");
        if (raw == "")
            continue;

        let settings;
        try {
            settings = json(raw);
        }
        catch (e) {
            continue;
        }
        if (type(settings) != "object")
            continue;

        let changed = false;
        for (let _, item in settings) {
            if (type(item) != "object")
                continue;

            let user_agent = single_subscription_user_agent(item);
            if (as_string(item.user_agent) != user_agent || !option_exists(item, "user_agent")) {
                item.user_agent = user_agent;
                changed = true;
            }
            if (option_exists(item, "auto_user_agent")) {
                delete item.auto_user_agent;
                changed = true;
            }
        }
        if (changed)
            set_option(ctx, section, "subscription_url_settings", sprintf("%J", settings));
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
        configured = subscription_headers_module.DEFAULT_USER_AGENT;

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

    for (let section in ctx.model.sections || []) {
        let raw = option(section, "subscription_url_settings", "");
        if (raw == "")
            continue;

        let settings;
        try {
            settings = json(raw);
        }
        catch (e) {
            continue;
        }
        if (type(settings) != "object")
            continue;

        let changed = false;
        for (let _, item in settings) {
            if (type(item) != "object" || !option_exists(item, "user_agent"))
                continue;

            item.header = subscription_user_agent_header_lines(item);
            delete item.user_agent;
            changed = true;
        }
        if (changed)
            set_option(ctx, section, "subscription_url_settings", sprintf("%J", settings));
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
    if (!release_at_most(ctx, "1.0.5"))
        return;

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
    tuic: [ [ "uuid", "server_uuid" ], [ "password", "server_password" ] ],
    anytls: [ [ "password", "server_password" ] ],
    mixed: [ [ "password", "server_password" ] ],
    naive: [ [ "password", "server_password" ] ],
    ssh: [ [ "password", "server_password" ] ],
    mieru: [ [ "password", "server_password" ] ],
    mtproto: [ [ "secret", "mtproto_secret" ] ]
};
const LOGIN_NAME_SERVER_PROTOCOLS = { mixed: true, naive: true, ssh: true, mieru: true };
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
    "tuic_auth_timeout",
    "naive_quic_congestion_control",
    "mieru_user_hint_mandatory",
    "reality_max_time_difference"
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

// The released dialog defaulted the switch to on and always wrote it, so only a
// server written straight through uci needs the default filled in.
function migrate_tailscale_exit_node(ctx) {
    for (let server in ctx.model.servers || [])
        if (option(server, "protocol", "") == "tailscale")
            set_option_if_missing(ctx, server, "tailscale_advertise_exit_node", "1");
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
    vpn: true,
    byedpi: true,
    zapret: true,
    zapret2: true
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
    for (let list in [ ctx.model.sections || [], ctx.model.rules || [], ctx.model.servers || [] ])
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
// wrong CDN node and turns a local DNS failure into a dropped connection. ByeDPI
// still resolves, but the runtime now decides that from the action alone.
function remove_resolve_real_ip_for_routing(ctx) {
    for (let section in ctx.model.sections || [])
        delete_option(ctx, section, "resolve_real_ip_for_routing");
}

const MIGRATIONS = [
    { id: "interface_sections", run: migrate_interface_sections },
    { id: "enable_component_checks", run: migrate_enable_component_checks },
    { id: "http_connection_urls", run: migrate_http_connection_urls },
    { id: "remove_server_country_and_dashboard_filter", run: remove_server_country_and_dashboard_filter },
    { id: "native_fallbacks", run: use_native_fallbacks },
    { id: "dns_fallback_modes", run: migrate_dns_fallback_modes },
    { id: "native_rule_sets", run: use_native_rule_sets },
    { id: "universal_rule_sets", run: use_universal_rule_sets },
    { id: "leaf_subscription_providers", run: use_leaf_subscription_providers },
    { id: "extended_server_defaults", run: add_extended_server_defaults },
    { id: "fallback_uci_tags", run: migrate_fallback_uci_tags },
    { id: "reset_fallback_defaults", run: reset_fallback_defaults },
    { id: "remove_proxy_parameter_filters", run: remove_proxy_parameter_filters },
    { id: "server_filter_model", run: migrate_server_filter_model },
    { id: "server_filter_modes", run: migrate_server_filter_modes },
    { id: "single_subscription_user_agent", run: migrate_single_subscription_user_agent },
    { id: "subscription_headers", run: migrate_subscription_headers },
    { id: "interface_display_names", run: migrate_interface_display_names },
    { id: "remove_section_cache", run: remove_section_cache },
    { id: "remove_dashboard_sort_options", run: remove_dashboard_sort_options },
    { id: "dns_server_uris", run: migrate_dns_server_uris },
    { id: "interface_domain_resolver_uris", run: migrate_interface_domain_resolver_uris },
    { id: "readable_runtime_tags", run: migrate_readable_runtime_tags },
    { id: "urltest_expected_status", run: migrate_urltest_expected_status },
    { id: "group_interrupt_defaults", run: migrate_group_interrupt_defaults },
    { id: "subscription_user_agent_header", run: migrate_subscription_user_agent_header },
    { id: "mixed_server_inbounds", run: migrate_socks_servers_to_mixed },
    // Before the client sections: the released Shadowsocks key lives in the server
    // password, and that option is removed once the credentials have moved.
    { id: "shadowsocks_server_keys", run: migrate_shadowsocks_server_keys },
    { id: "server_client_sections", run: migrate_server_clients },
    { id: "tailscale_exit_node_switch", run: migrate_tailscale_exit_node },
    { id: "remove_expert_server_options", run: remove_expert_server_options },
    { id: "reality_handshake_sni", run: merge_reality_handshake_into_sni },
    { id: "section_mixed_proxy_servers", run: migrate_section_mixed_proxies },
    { id: "remove_resolve_real_ip_for_routing", run: remove_resolve_real_ip_for_routing }
];

function apply_migrations(ctx) {
    ctx.source_release = option(ctx.model.settings, CONFIG_VERSION_OPTION, "");

    let applied = [];
    let seen = {};
    let added = false;
    for (let id in list_option(ctx.model.settings, APPLIED_MIGRATIONS_OPTION)) {
        id = as_string(id);
        if (id == "" || seen[id])
            continue;
        seen[id] = true;
        push(applied, id);
    }

    for (let migration in MIGRATIONS) {
        if (seen[migration.id])
            continue;

        migration.run(ctx);
        seen[migration.id] = true;
        push(applied, migration.id);
        added = true;
    }

    if (added)
        set_list_option(ctx, ctx.model.settings, APPLIED_MIGRATIONS_OPTION, applied);

    if (release_at_most(ctx, "1.0.4"))
        set_option(ctx, ctx.model.settings, CONFIG_VERSION_OPTION, "1.0.5");
}

function migrate_podkop_model(model, constants) {
    let ctx = migration_context(model);
    constants = object_or_empty(constants);

    delete_option(ctx, model.settings, "routing_excluded_ips");
    migrate_dns_server_lists(ctx);
    migrate_list_update_enabled(ctx);

    let converted_sections = [];
    for (let section in model.rules) {
        migrate_rule_section(ctx, section, constants);
        push(converted_sections, section);
    }
    model.rules = [];

    for (let section in model.sections) {
        migrate_rule(ctx, section, false, constants);
        migrate_combined_domain_conditions(ctx, section);
        migrate_text_condition(ctx, section, "ip_cidr", "subnets");
        migrate_rule_set_settings(ctx, section);
    }
    for (let section in converted_sections) {
        migrate_rule_set_settings(ctx, section);
        push(model.sections, section);
    }
    migrate_subscription_download_via_proxy_settings(ctx);
    migrate_download_via_proxy_flags(ctx);
    apply_migrations(ctx);

    return ctx;
}

function migrate_forkop_model(model) {
    let ctx = migration_context(model);
    apply_migrations(ctx);
    return ctx;
}

// Runtime UCI adapter and external command dispatcher.
function remove_cache_path(path) {
    path = as_string(path);
    if (index(path, "*") >= 0)
        run("rm -f " + path);
    else
        run("rm -rf " + shell_quote(path));
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
        if (op.op == "create") {
            if (op.anonymous && type(cursor.add) == "function")
                created[as_string(op.section)] = cursor.add(CONFIG_NAME, op.type);
            else
                cursor.set(CONFIG_NAME, op.section, op.type);
        }
        else if (op.op == "set")
            cursor.set(CONFIG_NAME, section_ref(op.section), op.option, op.value);
        else if (op.op == "delete")
            cursor.delete(CONFIG_NAME, section_ref(op.section), op.option);
        else if (op.op == "add_list")
            cursor.set(CONFIG_NAME, section_ref(op.section), op.option, op.values);
        else if (op.op == "set_list")
            cursor.set(CONFIG_NAME, section_ref(op.section), op.option, op.values);
        else if (op.op == "set_type")
            cursor.set(CONFIG_NAME, section_ref(op.section), op.type);
    }
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

function migrate_model(model, source) {
    return source == "podkop"
        ? migrate_podkop_model(model, constants_context())
        : migrate_forkop_model(model);
}

function migrate_runtime(source) {
    let cursor = runtime_cursor();
    cursor.load(CONFIG_NAME);
    let ctx = migrate_model(model_from_uci(cursor), source);
    if (!ctx.changed)
        return true;

    apply_operations(cursor, ctx.operations);
    for (let path in ctx.removed_caches)
        remove_cache_path(path);
    if (!remove_cron_markers(ctx.removed_cron_markers))
        return false;

    return commit_cursor(cursor);
}

function commit_runtime() {
    let cursor = runtime_cursor();
    cursor.load(CONFIG_NAME);
    return commit_cursor(cursor);
}

function migrate_fixture(path, source) {
    let ctx = migrate_model(model_from_fixture(path), source);
    write_json({
        changed: ctx.changed,
        config: export_model(ctx.model),
        operations: ctx.operations,
        removed_caches: ctx.removed_caches,
        removed_cron_markers: ctx.removed_cron_markers
    });
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
        migrate_fixture(argv[1], argv[2] || "forkop");
        return 0;
    }

    warn("Usage: config/migration.uc migrate\n");
    warn("       config/migration.uc migrate-podkop\n");
    warn("       config/migration.uc commit\n");
    warn("       config/migration.uc migrate-fixture <fixture.json> [forkop|podkop]\n");
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
