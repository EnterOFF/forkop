#!/usr/bin/env ucode

let fs = require("fs");
let uci_core_module = null;
let fixture_uci_data = null;
let zapret_validator_module = null;
let zapret2_validator_module = null;
let byedpi_validator_module = null;
let constants_module = null;
let core_url = require("core.url");
let core_ip = require("core.ip");
let rule_config = require("config.rule");
let connections = require("config.connections");
let singbox_constants = require("singbox.constants");
let runtime_dns = require("singbox.dns");
let subscription_headers_module = require("singbox.subscription_headers");

const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || "forkop";
const LIB_DIR = getenv("FORKOP_LIB") || "/usr/lib/forkop";
const SING_BOX_FORKOP_VERSION_FILE = getenv("SING_BOX_FORKOP_VERSION_FILE") || "/usr/share/sing-box-forkop/version";
const DEFAULT_LATENCY_TEST_URL = "https://www.gstatic.com/generate_204";
const TAILSCALE_FWMARK_MASK = 0x00ff0000;

function as_string(value) {
    return value == null ? "" : "" + value;
}

function read_stdin() {
    let input = fs.open("/dev/stdin", "r");
    if (!input)
        return "";
    let data = input.read("all");
    input.close();
    return data == null ? "" : data;
}

function read_stdin_json() {
    let data = read_stdin();
    try {
        return json(data);
    }
    catch (e) {
        return null;
    }
}

function read_json_file(path) {
    let data = fs.readfile(as_string(path));
    if (data == null)
        return null;

    try {
        return json(data);
    }
    catch (e) {
        return null;
    }
}

function string_starts_with(value, prefix) {
    value = as_string(value);
    prefix = as_string(prefix);
    return substr(value, 0, length(prefix)) == prefix;
}

function whitespace_values(value) {
    let result = [];
    for (let item in split(trim(as_string(value)), /[ \t\r\n]+/))
        if (item != "")
            push(result, item);
    return result;
}

function option_list_values(section, key) {
    let value = type(section) == "object" ? section[key] : null;
    if (type(value) == "array")
        return value;
    return whitespace_values(value);
}

function list_has_value(values, needle) {
    needle = as_string(needle);
    if (needle == "")
        return false;

    for (let value in whitespace_values(values))
        if (value == needle)
            return true;

    return false;
}

function object_or_empty(value) {
    return type(value) == "object" ? value : {};
}

function array_or_empty(value) {
    return type(value) == "array" ? value : [];
}

function contains(values, needle) {
    for (let value in array_or_empty(values))
        if (value == needle)
            return true;
    return false;
}

function option(section, key, fallback) {
    if (fallback == null)
        fallback = "";

    let value = object_or_empty(section)[key];
    if (value == null)
        return fallback;
    if (type(value) == "array")
        return join(" ", value);
    return as_string(value);
}

function list_option(section, key) {
    let value = object_or_empty(section)[key];
    if (value == null)
        return [];
    if (type(value) == "array")
        return value;

    value = trim(as_string(value));
    return value == "" ? [] : split(value, " ");
}

function bool_option(section, key, fallback) {
    if (fallback == null)
        fallback = false;

    let value = option(section, key, fallback ? "1" : "0");
    return value == "1" || value == "true" || value == "yes" || value == "on";
}

function file_executable(path) {
    let stat = fs.stat(as_string(path));
    if (stat == null || stat.mode == null)
        return false;

    return (int(stat.mode) & 73) != 0;
}

function file_nonempty(path) {
    let stat = fs.stat(as_string(path));
    return stat != null && stat.size != null && stat.size > 0;
}

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function command_from_args(args) {
    let parts = [];

    for (let arg in args)
        push(parts, shell_quote(arg));

    return join(" ", parts);
}

function run_args(args) {
    return system(command_from_args(args)) == 0;
}

function command_success_from_args(args) {
    return system(command_from_args(args) + " >/dev/null 2>&1") == 0;
}

function command_output(command) {
    let pipe = fs.popen(command, "r");
    if (!pipe)
        return "";

    let data = pipe.read("all");
    let status = pipe.close();
    if (status != 0 || data == null)
        return "";

    return as_string(data);
}

function command_output_from_args(args) {
    return command_output(command_from_args(args));
}

function command_exists(name) {
    return system("command -v " + shell_quote(name) + " >/dev/null 2>&1") == 0;
}

function log_message(message, level) {
    level = as_string(level || "info");
    run_args([ "logger", "-t", "forkop", "[" + level + "] " + as_string(message) ]);
}

function fail_requirement(message, level) {
    log_message(message, level || "error");
    exit(1);
}

function mkdir_p(paths) {
    let args = [ "mkdir", "-p" ];

    for (let path in array_or_empty(paths))
        if (as_string(path) != "")
            push(args, path);

    return length(args) <= 2 || run_args(args);
}

function safe_rm_rf(path) {
    path = as_string(path);
    if (path == "" || substr(path, 0, length("/var/run/forkop/")) != "/var/run/forkop/")
        return true;

    return run_args([ "rm", "-rf", path ]);
}

function first_line_field_from_text(data, field_index) {
    let newline = index(as_string(data), "\n");
    let line = newline >= 0 ? substr(data, 0, newline) : data;
    let fields = split(trim(as_string(line)), /[ \t\r\n]+/);

    field_index = int(field_index || 0);
    return field_index > 0 && field_index <= length(fields) ? as_string(fields[field_index - 1]) : "";
}

function digit_char(value) {
    return match(as_string(value), /^[0-9]$/) != null;
}

function strip_leading_zeroes(value) {
    value = as_string(value);
    let i = 0;
    while (i < length(value) - 1 && substr(value, i, 1) == "0")
        i++;
    return substr(value, i);
}

function version_compare(lhs, rhs) {
    lhs = as_string(lhs);
    rhs = as_string(rhs);

    let li = 0, ri = 0;
    while (li < length(lhs) || ri < length(rhs)) {
        if (li >= length(lhs))
            return substr(rhs, ri, 1) == "~" ? 1 : -1;
        if (ri >= length(rhs))
            return substr(lhs, li, 1) == "~" ? -1 : 1;

        let lc = substr(lhs, li, 1);
        let rc = substr(rhs, ri, 1);
        if (lc == rc) {
            li++;
            ri++;
            continue;
        }

        if (lc == "~" || rc == "~")
            return lc == "~" ? -1 : 1;

        if (digit_char(lc) && digit_char(rc)) {
            let ls = li, rs = ri;
            while (li < length(lhs) && digit_char(substr(lhs, li, 1)))
                li++;
            while (ri < length(rhs) && digit_char(substr(rhs, ri, 1)))
                ri++;

            let lnum = strip_leading_zeroes(substr(lhs, ls, li - ls));
            let rnum = strip_leading_zeroes(substr(rhs, rs, ri - rs));
            if (length(lnum) != length(rnum))
                return length(lnum) < length(rnum) ? -1 : 1;
            if (lnum != rnum)
                return lnum < rnum ? -1 : 1;
            continue;
        }

        return lc < rc ? -1 : 1;
    }

    return 0;
}

function version_at_least(current, required) {
    return version_compare(current, required) >= 0;
}

function constant_value(constants, name) {
    return as_string(object_or_empty(constants)[name]);
}

function uci_show_list_value(value) {
    return trim(replace(as_string(value), /['"]/g, ""));
}

function stdin_first_line_field(field_index) {
    let data = read_stdin();
    let newline = index(data, "\n");
    let line = newline >= 0 ? substr(data, 0, newline) : data;
    let fields = split(trim(as_string(line)), /[ \t\r\n]+/);

    field_index = int(field_index || 0);
    if (field_index > 0 && field_index <= length(fields))
        print(fields[field_index - 1], "\n");
}

function enum_valid(value, start_index) {
    value = as_string(value);
    for (let i = start_index; i < length(ARGV); i++)
        if (value == as_string(ARGV[i]))
            return true;
    return false;
}

function regex_valid(pattern) {
    pattern = as_string(pattern);
    if (pattern == "")
        return true;

    try {
        regexp(pattern);
        return true;
    }
    catch (e) {
        return false;
    }
}

function combined_domain_valid(value) {
    value = trim(as_string(value));
    if (value == "")
        return true;

    let normalized = rule_config.prefixed_domain_kind_value(value);
    if (normalized == null)
        return false;

    return normalized.kind != "domain_regex" || regex_valid(normalized.value);
}

function combined_domain_text_valid(value) {
    for (let item in rule_config.text_list_values(value, "comma-space"))
        if (!combined_domain_valid(item))
            return false;
    return true;
}

function community_service_valid(value, services) {
    return list_has_value(services, value);
}

function remote_reference(value) {
    return string_starts_with(value, "http://") || string_starts_with(value, "https://");
}

function absolute_reference(value) {
    value = as_string(value);
    return string_starts_with(value, "/");
}

function ruleset_reference_valid(reference, community_services) {
    reference = as_string(reference);
    let path = lc(replace(reference, /[?#].*$/, ""));
    if (match(path, /\.ya?ml$/) != null)
        return false;

    return reference == "" ||
        community_service_valid(reference, community_services) ||
        remote_reference(reference) ||
        absolute_reference(reference);
}

function valid_outbound() {
    let value = read_stdin_json();
    return type(value) == "object" && type(value.type) == "string";
}

function valid_inbound() {
    let value = read_stdin_json();
    return type(value) == "object" && type(value.type) == "string";
}

function bool_flag(value) {
    value = as_string(value);
    return value == "1" || value == "true";
}

function outbound_detour_source_action(action) {
    action = as_string(action);
    return connections.is_connections_action(action);
}

function outbound_detour_target_action(action) {
    action = as_string(action);
    return connections.is_connections_action(action);
}

function outbound_detour_rows() {
    let rows = [];

    for (let line in split(read_stdin(), "\n")) {
        line = replace(as_string(line), /\r/g, "");
        if (trim(line) == "")
            continue;

        let fields = split(line, "\t");
        let row = {
            section: as_string(fields[0]),
            enabled: bool_flag(fields[1]),
            action: as_string(fields[2]),
            detour_enabled: bool_flag(fields[3]),
            detour_section: as_string(fields[4])
        };

        push(rows, row);
    }

    return rows;
}

function outbound_detour_rows_by_section(rows) {
    let by_section = {};

    for (let row in array_or_empty(rows))
        if (row.section != "")
            by_section[row.section] = row;

    return {
        rows: rows,
        by_section: by_section
    };
}

function outbound_detour_chain_reaches_source(by_section, source_section, current_section) {
    let seen = {};

    while (current_section != "") {
        if (current_section == source_section)
            return true;

        if (seen[current_section])
            return false;
        seen[current_section] = true;

        let row = by_section[current_section];
        if (type(row) != "object" || !row.enabled || !outbound_detour_source_action(row.action))
            return false;

        if (!row.detour_enabled)
            return false;

        current_section = row.detour_section;
    }

    return false;
}

function fail_outbound_detour(message) {
    print(message, "\n");
    exit(1);
}

function fail_validation(message) {
    print(message, "\n");
    exit(1);
}

function validate_outbound_detours_rows(rows) {
    let parsed = outbound_detour_rows_by_section(rows);

    for (let row in parsed.rows) {
        if (!row.enabled || !row.detour_enabled)
            continue;

        if (!outbound_detour_source_action(row.action))
            fail_outbound_detour("Outbound cascade is supported only for Connection rules, but rule '" +
                row.section + "' uses action '" + row.action + "'. Aborted.");

        if (row.detour_section == "")
            fail_outbound_detour("Outbound cascade is enabled for rule '" + row.section +
                "', but no intermediate rule is selected. Aborted.");

        if (row.detour_section == row.section)
            fail_outbound_detour("Outbound cascade for rule '" + row.section + "' cannot point to itself. Aborted.");

        let target = parsed.by_section[row.detour_section];
        if (type(target) != "object")
            fail_outbound_detour("Outbound cascade for rule '" + row.section + "' references missing rule '" +
                row.detour_section + "'. Select an enabled Connection rule or disable cascade connection. Aborted.");

        if (!target.enabled)
            fail_outbound_detour("Outbound cascade for rule '" + row.section + "' references disabled rule '" +
                row.detour_section + "'. Select an enabled Connection rule or disable cascade connection. Aborted.");

        if (!outbound_detour_target_action(target.action))
            fail_outbound_detour("Outbound cascade for rule '" + row.section + "' references rule '" +
                row.detour_section + "', but it is not a Connection rule. Select an enabled Connection rule or disable cascade connection. Aborted.");

        if (outbound_detour_chain_reaches_source(parsed.by_section, row.section, row.detour_section))
            fail_outbound_detour("Outbound cascade for rule '" + row.section + "' creates a cycle through '" +
                row.detour_section + "'. Aborted.");

    }
}

function validate_outbound_detours() {
    validate_outbound_detours_rows(outbound_detour_rows());
}

function basic_rule_rows() {
    let rows = [];

    for (let line in split(read_stdin(), "\n")) {
        line = replace(as_string(line), /\r/g, "");
        if (trim(line) == "")
            continue;

        let fields = split(line, "\t");
        push(rows, {
            section: as_string(fields[0]),
            enabled: bool_flag(fields[1]),
            action: as_string(fields[2])
        });
    }

    return rows;
}

function download_section_action_available(action, byedpi_installed, zapret_installed, zapret2_installed) {
    action = as_string(action);
    if (connections.is_connections_action(action))
        return true;
    if (action == "byedpi")
        return bool_flag(byedpi_installed);
    if (action == "zapret")
        return bool_flag(zapret_installed);
    if (action == "zapret2")
        return bool_flag(zapret2_installed);

    return false;
}

function validate_download_section_rows(target_section, byedpi_installed, zapret_installed, zapret2_installed, rows) {
    target_section = as_string(target_section);

    if (target_section == "")
        fail_validation("Downloading external resources through a section is enabled, but no download section is selected. Aborted.");

    let found = false;
    let enabled = false;
    let outbound = false;

    for (let row in array_or_empty(rows)) {
        if (row.section != target_section)
            continue;

        found = true;
        if (!row.enabled)
            continue;

        enabled = true;
        if (download_section_action_available(row.action, byedpi_installed, zapret_installed, zapret2_installed))
            outbound = true;
    }

    if (!found)
        fail_validation("Downloading external resources through a section references missing rule '" + target_section +
            "'. Select an enabled rule that can provide an outbound or disable the option. Aborted.");

    if (!enabled)
        fail_validation("Downloading external resources through a section references disabled rule '" + target_section +
            "'. Select an enabled rule that can provide an outbound or disable the option. Aborted.");

    if (!outbound)
        fail_validation("Downloading external resources through a section references rule '" + target_section +
            "', but it cannot provide an outbound. Select an enabled Connection, Zapret, Zapret2, or ByeDPI rule with its provider installed, or disable the option. Aborted.");
}

function validate_download_section(target_section, byedpi_installed, zapret_installed, zapret2_installed) {
    validate_download_section_rows(target_section, byedpi_installed, zapret_installed, zapret2_installed, basic_rule_rows());
}

function dhcp_has_https_dns_proxy_options(path) {
    let data = fs.readfile(as_string(path));
    if (data == null)
        return null;

    return index(data, "doh_backup_noresolv") >= 0 ||
        index(data, "doh_backup_server") >= 0 ||
        index(data, "doh_server") >= 0;
}

function dhcp_has_https_dns_proxy_options_exit(path) {
    let result = dhcp_has_https_dns_proxy_options(path);
    exit(result == null ? 2 : (result ? 0 : 1));
}

function mwan3_has_enabled_interface_text(data) {
    let prefix = "mwan3.";
    let sections = {};
    let enabled = {};

    for (let line in split(as_string(data), "\n")) {
        let equals = index(as_string(line), "=");
        if (equals < 0)
            continue;

        let key = substr(line, 0, equals);
        let value = uci_show_list_value(substr(line, equals + 1));
        if (!string_starts_with(key, prefix))
            continue;

        let rest = substr(key, length(prefix));
        if (index(rest, ".") < 0) {
            if (value == "interface")
                sections[key] = true;
            continue;
        }

        let option_dot = rindex(key, ".");
        let section = substr(key, 0, option_dot);
        let option = substr(key, option_dot + 1);
        if (option == "enabled")
            enabled[section] = value;
    }

    for (let section, _ in sections)
        if (enabled[section] == "1")
            return true;

    return false;
}

function mwan3_has_enabled_interface() {
    return mwan3_has_enabled_interface_text(read_stdin());
}

function mwan3_has_enabled_interface_from_sections() {
    let uci = uci_core();
    for (let section in uci.section_objects("mwan3", "interface"))
        if (option(section, "enabled", "0") == "1")
            return true;
    return false;
}

function mwan3_is_active() {
    if (!file_executable("/etc/init.d/mwan3") || !file_nonempty("/etc/config/mwan3"))
        return false;

    if (!mwan3_has_enabled_interface_from_sections())
        return false;

    return command_success_from_args([ "/etc/init.d/mwan3", "status" ]) ||
        command_success_from_args([ "/etc/init.d/mwan3", "enabled" ]);
}

function hex_digit_value(value) {
    let pos = index("0123456789abcdef", lc(as_string(value)));
    return pos >= 0 ? pos : null;
}

function parse_number(value) {
    value = lc(trim(as_string(value)));
    if (value == "")
        return null;

    if (substr(value, 0, 2) == "0x") {
        value = substr(value, 2);
        if (value == "")
            return null;

        let result = 0;
        for (let i = 0; i < length(value); i++) {
            let digit = hex_digit_value(substr(value, i, 1));
            if (digit == null)
                return null;
            result = result * 16 + digit;
        }
        return result;
    }

    return match(value, /^[0-9]+$/) == null ? null : int(value);
}

function zapret_validator() {
    if (zapret_validator_module == null)
        zapret_validator_module = require("providers.zapret.validator");
    return zapret_validator_module;
}

function zapret2_validator() {
    if (zapret2_validator_module == null)
        zapret2_validator_module = require("providers.zapret2.validator");
    return zapret2_validator_module;
}

function byedpi_validator() {
    if (byedpi_validator_module == null)
        byedpi_validator_module = require("providers.byedpi.validator");
    return byedpi_validator_module;
}

function runtime_constants() {
    if (constants_module == null)
        constants_module = require("core.constants");
    return constants_module;
}

function uci_core() {
    if (uci_core_module == null)
        uci_core_module = require("core.uci");
    return uci_core_module;
}

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

function use_fixture_cursor(path) {
    fixture_uci_data = object_or_empty(read_json_file(path));
    connections.set_item_sections_from_data(fixture_uci_data);
}

function settings_section() {
    if (fixture_uci_data != null)
        return object_or_empty(fixture_get_section("settings"));
    let uci = uci_core();
    return object_or_empty(uci.get_all(CONFIG_NAME, "settings"));
}

function sections_by_type(type_name) {
    if (fixture_uci_data != null)
        return fixture_section_list(type_name);

    let result = [];
    let uci = uci_core();
    for (let section in uci.section_objects(CONFIG_NAME, type_name))
        push(result, object_or_empty(section));
    return result;
}

function section_name(section) {
    return option(section, ".name", "");
}

function section_enabled(section) {
    return bool_option(section, "enabled", true);
}

function server_enabled(section) {
    return bool_option(section, "enabled", false);
}

function validate_runtime_display_names(sections, kind, seen) {
    let reserved = object_or_empty(singbox_constants.RESERVED_TAGS);
    for (let section in sections) {
        let name = trim(option(section, "label", "")) || section_name(section);
        if (name == "")
            fail_validation(kind + " has no display name. Aborted.");
        if (index(name, "/") >= 0)
            fail_validation(kind + " display name '" + name + "' contains '/'. Use another character. Aborted.");
        if (reserved[name])
            fail_validation(kind + " display name '" + name + "' is reserved by Forkop. Choose another name. Aborted.");
        if (seen[name])
            fail_validation("Duplicate " + lc(kind) + " display name '" + name + "'. Display names must be unique. Aborted.");
        seen[name] = true;
    }
}

function validate_subscription_tags(section) {
    let seen = {};
    let sources = connections.subscription_urls(section);
    for (let source_index = 0; source_index < length(sources); source_index++) {
        let tag_name = connections.subscription_tag(section, sources[source_index], source_index + 1);
        if (trim(tag_name) == "")
            fail_validation("Subscription in rule '" + section_name(section) + "' has an empty tag. Aborted.");
        if (index(tag_name, "/") >= 0)
            fail_validation("Subscription tag '" + tag_name + "' in rule '" + section_name(section) + "' contains '/'. Use another character. Aborted.");
        if (seen[tag_name])
            fail_validation("Duplicate subscription tag '" + tag_name + "' in rule '" + section_name(section) + "'. Aborted.");
        seen[tag_name] = true;
    }
}

function rule_action(section) {
    return option(section, "action", "");
}

function rule_action_supported(action) {
    return contains([ "connection", "proxy", "outbound", "vpn", "bypass", "block", "dns", "zapret", "zapret2", "byedpi" ], as_string(action));
}

function server_routing_section_action_supported(action) {
    return contains([ "connection", "proxy", "outbound", "vpn", "zapret", "zapret2", "byedpi" ], as_string(action));
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

function validate_duration_option(value, label) {
    if (as_string(value) == "")
        return;

    if (duration_to_seconds_value(value) != null)
        return;

    fail_validation("Invalid duration value for " + label + ": " + value + ". Use sing-box duration format like 1d, 12h or 30m. Aborted.");
}

function validate_required_duration_option(value, label) {
    if (as_string(value) == "")
        fail_validation("Missing duration value for " + label + ". Use sing-box duration format like 1d, 12h or 30m. Aborted.");

    validate_duration_option(value, label);
}

function dns_setting_values(settings, key) {
    let values = [];
    for (let value in option_list_values(settings, key)) {
        value = trim(as_string(value));
        if (value != "")
            push(values, value);
    }
    return values;
}

function validate_dns_settings(settings, sections, context) {
    let dns_strategy = option(settings, "dns_strategy", "prefer_ipv4");
    if (!contains([ "prefer_ipv4", "ipv4_only", "prefer_ipv6", "ipv6_only" ], dns_strategy))
        fail_validation("Unsupported DNS strategy '" + dns_strategy + "'. Use prefer_ipv4, ipv4_only, prefer_ipv6, or ipv6_only. Aborted.");

    for (let strategy_option in [ "dns_main_fallback_strategy", "dns_bootstrap_fallback_strategy" ]) {
        let fallback_strategy = option(settings, strategy_option, "parallel");
        if (!contains([ "sequential", "parallel" ], fallback_strategy))
            fail_validation("Unsupported DNS fallback strategy '" + fallback_strategy + "' for " + strategy_option + ". Use sequential or parallel. Aborted.");
    }

    let main_servers = dns_setting_values(settings, "dns_server");
    let bootstrap_servers = dns_setting_values(settings, "bootstrap_dns_server");
    if (length(main_servers) == 0)
        fail_validation("At least one main DNS server is required. Aborted.");
    if (length(bootstrap_servers) == 0)
        fail_validation("At least one Bootstrap DNS server is required. Aborted.");
    for (let value in main_servers) {
        let parsed = runtime_dns.parse_server_uri(value, false);
        if (parsed.unsupported)
            fail_validation("Invalid main DNS server '" + value + "': " + parsed.unsupported + ". Aborted.");
    }
    for (let value in bootstrap_servers) {
        let parsed = runtime_dns.parse_server_uri(value, true);
        if (parsed.unsupported)
            fail_validation("Invalid Bootstrap DNS server '" + value + "': " + parsed.unsupported + ". Aborted.");
    }

    if (!bool_option(settings, "dns_detour_enabled", false))
        return;

    let target_name = option(settings, "dns_detour_section", "");
    if (target_name == "")
        fail_validation("DNS through a section is enabled, but no section is selected. Aborted.");

    let target = null;
    for (let section in sections)
        if (section_name(section) == target_name) {
            target = {
                section: target_name,
                enabled: section_enabled(section),
                action: rule_action(section)
            };
            break;
        }

    if (target == null)
        fail_validation("DNS through a section references missing rule '" + target_name + "'. Aborted.");
    if (!target.enabled)
        fail_validation("DNS through a section references disabled rule '" + target_name + "'. Aborted.");
    if (!download_section_action_available(target.action, context.byedpi_installed, context.zapret_installed, context.zapret2_installed))
        fail_validation("DNS through a section references rule '" + target_name + "' with unsupported action '" + target.action + "'. Select an enabled Connection, VPN, Zapret, Zapret2, or ByeDPI section. Aborted.");
}

function normalize_port_number_value(value) {
    value = trim(as_string(value));
    if (value == "" || match(value, /^[0-9]+$/) == null)
        return null;

    let number = int(value);
    return number >= 1 && number <= 65535 ? number : null;
}

function normalize_port_condition_value(value) {
    value = trim(as_string(value));
    if (value == "")
        return null;

    let dash = index(value, "-");
    if (dash < 0)
        return normalize_port_number_value(value);

    let start = normalize_port_number_value(substr(value, 0, dash));
    let end = normalize_port_number_value(substr(value, dash + 1));
    if (start == null || end == null || start > end)
        return null;

    return start == end ? start : sprintf("%d-%d", start, end);
}

function validate_port_condition_value(value, section) {
    if (normalize_port_condition_value(value) != null)
        return;

    fail_validation("Invalid port condition '" + value + "' in rule '" + section + "'. Use a single port or range like 80 or 1000-2000. Aborted.");
}

function valid_http_url(value) {
    value = trim(as_string(value));
    if (value == "" || match(value, /[ \t\r\n]/) != null)
        return false;

    let scheme = lc(core_url.scheme(value));
    if (scheme != "http" && scheme != "https")
        return false;

    return core_url.host(value) != "";
}

function validate_subscription_source_entry_value(entry, section) {
    if (index(as_string(entry), "|") >= 0)
        fail_validation("Invalid subscription URL in rule '" + section + "': Configure User-Agent in the subscription item settings. Aborted.");

    if (valid_http_url(entry))
        return;

    fail_validation("Invalid subscription URL in rule '" + section + "': Use an http:// or https:// URL. Aborted.");
}

function validate_http_url_option(value, label) {
    if (valid_http_url(value))
        return;

    fail_validation("Invalid URL value for " + label + ": " + value + ". Use http:// or https:// URL. Aborted.");
}

function validate_urltest_regex_value(value, section) {
    if (as_string(value) == "" || regex_valid(value))
        return;

    fail_validation("Invalid URLTest regular expression '" + value + "' in rule '" + section + "'. Aborted.");
}

function validate_urltest_identifier_value(value, section) {
    value = as_string(value);
    if (value != "" && match(value, /^[A-Za-z0-9_]+$/) != null)
        return;

    fail_validation("Invalid URLTest identifier '" + value + "' in rule '" + section + "'. Use latin letters, digits and underscores. Aborted.");
}

function validate_fallback_identifier_value(value, section) {
    value = as_string(value);
    if (value != "" && match(value, /^[A-Za-z0-9_]+$/) != null)
        return;

    fail_validation("Invalid fallback identifier '" + value + "' in rule '" + section + "'. Use latin letters, digits and underscores. Aborted.");
}

function validate_urltest_tolerance_value(value, section, urltest_id) {
    value = trim(as_string(value));
    if (match(value, /^[0-9]+$/) != null) {
        let parsed = int(value, 10);
        if (parsed >= 0 && parsed <= 10000)
            return;
    }

    fail_validation("Invalid URLTest tolerance '" + value + "' in rule '" + section + "', URLTest '" + urltest_id + "'. Use a number from 0 to 10000. Aborted.");
}

function validate_fallback_level_order(value, section, group_id, level_id) {
    value = trim(as_string(value));
    if (match(value, /^[0-9]+$/) != null)
        return;

    fail_validation("Invalid fallback level order '" + value + "' in rule '" + section + "', fallback '" + group_id + "', level '" + level_id + "'. Use a non-negative integer. Aborted.");
}

function fallback_expected_status_valid(value) {
    value = trim(as_string(value));
    if (value == "" || value == "*")
        return true;

    let parts = split(replace(value, /,/g, "/"), "/");
    if (length(parts) > 28)
        return false;

    for (let part in parts) {
        part = trim(as_string(part));
        if (part == "")
            continue;

        let bounds = split(part, "-");
        if (length(bounds) < 1 || length(bounds) > 2)
            return false;
        let parsed_bounds = [];
        for (let bound in bounds) {
            bound = replace(trim(as_string(bound)), /[\[\] ]/g, "");
            if (match(bound, /^[0-9]+$/) == null)
                return false;
            let parsed = int(bound, 10);
            if (parsed < 100 || parsed > 599)
                return false;
            push(parsed_bounds, parsed);
        }
        if (length(parsed_bounds) == 2 && parsed_bounds[0] > parsed_bounds[1])
            return false;
    }
    return true;
}

function validate_server_filter_mode(value, context, direct_allowed) {
    if (contains([ "all", "exclude", "include" ], value) ||
        (direct_allowed && value == "direct"))
        return;

    fail_validation("Invalid server filter mode '" + value + "' in " + context + ". Aborted.");
}

function validate_server_filter_regexes(mode, include_regex, exclude_regex, section) {
    if (mode == "include")
        validate_urltest_regex_value(include_regex, section);
    if (mode == "include" || mode == "exclude")
        validate_urltest_regex_value(exclude_regex, section);
}

function validate_fallback_group(section, group_id) {
    let name = section_name(section);
    validate_fallback_identifier_value(group_id, name);

    if (trim(connections.fallback_group_display_name(section, group_id)) == "")
        fail_validation("Fallback group '" + group_id + "' in rule '" + name + "' has no display name. Aborted.");

    let option_prefix = "rule." + name + ".fallback." + group_id + ".";
    let health_check_interval = connections.fallback_group_health_check_interval(section, group_id);
    let idle_timeout = connections.fallback_group_idle_timeout(section, group_id);
    validate_http_url_option(connections.fallback_group_health_check_url(section, group_id), option_prefix + "health_check_url");
    validate_required_duration_option(health_check_interval, option_prefix + "health_check_interval");
    validate_required_duration_option(connections.fallback_group_health_check_timeout(section, group_id), option_prefix + "health_check_timeout");
    let max_failed_times = connections.fallback_group_max_failed_times(section, group_id);
    if (match(max_failed_times, /^[1-9][0-9]*$/) == null || int(max_failed_times, 10) > 2147483647)
        fail_validation("Fallback group '" + group_id + "' in rule '" + name + "' has an invalid max_failed_times value. Use a positive integer. Aborted.");
    let expected_status = connections.fallback_group_expected_status(section, group_id);
    if (!fallback_expected_status_valid(expected_status))
        fail_validation("Fallback group '" + group_id + "' in rule '" + name + "' has an invalid expected_status value. Use *, status codes, or ranges such as 204/200-299. Aborted.");
    validate_required_duration_option(idle_timeout, option_prefix + "idle_timeout");
    if (duration_to_seconds_value(health_check_interval) > duration_to_seconds_value(idle_timeout))
        fail_validation("Fallback group '" + group_id + "' in rule '" + name + "' has a health check interval longer than its idle timeout. Increase the idle timeout or shorten the health check interval. Aborted.");

    let levels = connections.fallback_levels(group_id);
    if (length(levels) == 0)
        fail_validation("Fallback group '" + group_id + "' in rule '" + name + "' has no server groups. Add at least one server group. Aborted.");

    let level_names = {};
    for (let level_id in levels) {
        validate_fallback_identifier_value(level_id, name);
        let level_name = trim(connections.fallback_level_display_name(group_id, level_id));
        if (level_name == "")
            fail_validation("Server group '" + level_id + "' in rule '" + name + "', fallback '" + group_id + "' has no display name. Aborted.");
        if (level_names[level_name])
            fail_validation("Fallback '" + group_id + "' in rule '" + name + "' has duplicate server group name '" + level_name + "'. Aborted.");
        level_names[level_name] = true;

        validate_fallback_level_order(connections.fallback_level_order(group_id, level_id), name, group_id, level_id);
        let mode = connections.fallback_level_mode(group_id, level_id);
        validate_server_filter_mode(mode, "Server group '" + level_id + "'", true);
        validate_server_filter_regexes(
            mode,
            connections.fallback_level_include_regex(group_id, level_id),
            connections.fallback_level_exclude_regex(group_id, level_id),
            name
        );
    }
}

function validate_combined_domain_value(value, section) {
    if (as_string(value) == "" || combined_domain_valid(value))
        return;

    fail_validation("Invalid domain condition '" + value + "' in rule '" + section + "'. Use plain domains or full:, keyword:, regex: prefixes. Aborted.");
}

function validate_combined_domain_text_value(value, section) {
    if (as_string(value) == "" || combined_domain_text_valid(value))
        return;

    fail_validation("Invalid domain conditions in rule '" + section + "'. Use plain domains or full:, keyword:, regex: prefixes. Aborted.");
}

function validate_service_value(service, context) {
    if (community_service_valid(service, context.community_services))
        return;

    fail_validation("Invalid service in community lists: " + service + ". Check config and LuCI cache. Aborted.");
}

function validate_ruleset_reference_value(reference, context) {
    if (ruleset_reference_valid(reference, context.community_services))
        return;

    fail_validation("Unknown rule set reference '" + reference + "'. Aborted.");
}

function validate_common_rule_references(section, context) {
    for (let value in connections.community_lists(section))
        validate_service_value(value, context);
    for (let value in connections.rule_sets(section))
        validate_ruleset_reference_value(value, context);
    for (let value in connections.rule_sets_with_subnets(section))
        validate_ruleset_reference_value(value, context);
}

function outbound_json_object(value) {
    try {
        value = json(as_string(value));
    }
    catch (e) {
        return null;
    }

    return type(value) == "object" ? value : null;
}

function valid_outbound_json(value) {
    value = outbound_json_object(value);
    if (value == null || type(value.type) != "string")
        return false;

    let outbound_type = as_string(value.type);
    return outbound_type != "" && outbound_type == trim(outbound_type) && outbound_type == lc(outbound_type);
}

function validate_outbound_json_rule(section) {
    let name = section_name(section);
    let outbound_json = option(section, "outbound_json", "");

    if (outbound_json == "")
        fail_validation("JSON outbound rule '" + name + "' has empty outbound_json. Aborted.");

    if (!valid_outbound_json(outbound_json))
        fail_validation("JSON outbound rule '" + name + "' must contain a valid sing-box outbound JSON object with a lowercase type field without surrounding whitespace. Aborted.");
}

function validate_outbound_json_values(section) {
    let name = section_name(section);
    let values = connections.outbound_jsons(section);
    let require_user_tag = length(list_option(section, "outbound_jsons")) > 0;
    let tags = {};

    for (let value in values) {
        if (as_string(value) == "")
            fail_validation("Connection rule '" + name + "' has empty JSON outbound. Aborted.");

        if (!valid_outbound_json(value))
            fail_validation("Connection rule '" + name + "' must contain valid sing-box outbound JSON objects with lowercase type fields without surrounding whitespace. Aborted.");

        let outbound = outbound_json_object(value);
        let tag_name = trim(as_string(outbound.tag || ""));
        if (tag_name == "" && require_user_tag)
            fail_validation("Connection rule '" + name + "' has JSON outbound without a non-empty tag. Aborted.");
        if (tag_name != "" && tags[tag_name])
            fail_validation("Connection rule '" + name + "' has duplicate JSON outbound tag '" + tag_name + "'. Aborted.");
        if (tag_name != "")
            tags[tag_name] = true;
    }
}

function valid_wireguard_key(value) {
    value = trim(as_string(value));
    if (match(value, /^[A-Za-z0-9+\/]{43}=$/) == null)
        return false;

    let decoded = null;
    try {
        decoded = b64dec(value);
    }
    catch (e) {
        return false;
    }
    return decoded != null && length(decoded) == 32;
}

function valid_amnezia_range(value) {
    value = trim(as_string(value));
    if (value == "")
        return false;

    let parts = split(value, "-");
    if (length(parts) > 2)
        return false;

    for (let part in parts)
        if (match(part, /^[0-9]+$/) == null || int(part) < 0 || int(part) > 4294967295)
            return false;

    return length(parts) == 1 || int(parts[0]) <= int(parts[1]);
}

function validate_tunnel_amnezia(endpoint, name) {
    let amnezia = endpoint.amnezia;
    if (type(amnezia) != "object")
        return;

    for (let key in [ "h1", "h2", "h3", "h4", "content_padding_addition", "rekey_after_time", "rekey_timeout", "reject_after_time", "keepalive_timeout", "max_handshake_attempts" ])
        if (amnezia[key] != null && !valid_amnezia_range(amnezia[key]))
            fail_validation("Connection rule '" + name + "' contains an invalid AmneziaWG " + key + " range. Use values from 0 to 4294967295 with the start no greater than the end. Aborted.");

    if (amnezia.header_protection_key != null &&
        trim(as_string(amnezia.header_protection_key)) != "" &&
        !valid_wireguard_key(amnezia.header_protection_key))
        fail_validation("Connection rule '" + name + "' contains an invalid AmneziaWG header protection key. Use a standard base64-encoded 32-byte value. Aborted.");
}

function validate_tailscale_tunnel_detour(source_name, detour) {
    detour = trim(as_string(detour));
    if (detour == "")
        return;
    if (detour == singbox_constants.outbound_tag(source_name))
        fail_validation("Connection rule '" + source_name + "' cannot use itself for the Tailscale control plane. Aborted.");

    for (let candidate in sections_by_type("section"))
        if (section_enabled(candidate) &&
            connections.is_connections_action(rule_action(candidate)) &&
            singbox_constants.outbound_tag(section_name(candidate)) == detour)
            return;

    fail_validation("Connection rule '" + source_name + "' references an unavailable Tailscale control-plane section. Aborted.");
}

function validate_tunnel_values(section) {
    let name = section_name(section);

    for (let tunnel_id in connections.tunnels(section)) {
        let tunnel = connections.tunnel_child(section, tunnel_id);
        let endpoint = connections.tunnel_endpoint(tunnel);
        let endpoint_type = lc(trim(as_string(endpoint.type || "")));
        let wrapper_kind = lc(trim(as_string(connections.option(tunnel, "kind", "wireguard"))));
        if (endpoint_type == "" ||
            (endpoint_type != "wireguard" && endpoint_type != "warp" && endpoint_type != "tailscale" && wrapper_kind != "json"))
            fail_validation("Connection rule '" + name + "' contains an invalid tunnel endpoint. Aborted.");
        if (wrapper_kind != "json" && trim(as_string(connections.option(tunnel, "name", ""))) == "")
            fail_validation("Connection rule '" + name + "' contains a tunnel without a name. Aborted.");

        if (wrapper_kind == "json") {
            let json_endpoint_type = as_string(endpoint.type || "");
            if (json_endpoint_type != trim(json_endpoint_type) ||
                !contains(singbox_constants.JSON_ENDPOINT_TYPES, json_endpoint_type))
                fail_validation("Connection rule '" + name + "' contains unsupported JSON endpoint type '" + json_endpoint_type + "'. Aborted.");
            if (trim(as_string(endpoint.tag || "")) == "")
                fail_validation("Connection rule '" + name + "' contains a JSON endpoint without a tag. Aborted.");
            continue;
        }

        if (endpoint_type == "tailscale") {
            if (trim(as_string(endpoint.auth_key || "")) == "" ||
                trim(as_string(endpoint.hostname || "")) == "" ||
                trim(as_string(endpoint.exit_node || "")) == "")
                fail_validation("Connection rule '" + name + "' contains an incomplete Tailscale endpoint. Aborted.");
            validate_http_url_option(endpoint.control_url || "https://controlplane.tailscale.com", "rule." + name + ".tunnel.control_url");
            let detour_section = connections.option(tunnel, "tailscale_detour_section", "");
            validate_tailscale_tunnel_detour(name, detour_section == "" ? "" : singbox_constants.outbound_tag(detour_section));
            continue;
        }

        validate_tunnel_amnezia(endpoint, name);

        if (endpoint_type == "warp" && endpoint.persistent_keepalive_interval != null &&
            !valid_amnezia_range(endpoint.persistent_keepalive_interval))
            fail_validation("Connection rule '" + name + "' contains an invalid WARP persistent keepalive interval. Use values from 0 to 4294967295 with the start no greater than the end. Aborted.");

        if (endpoint_type == "warp") {
            let profile = object_or_empty(endpoint.profile);
            let profile_values = 0;
            for (let key in [ "id", "auth_token", "private_key" ])
                if (trim(as_string(profile[key] || "")) != "")
                    profile_values++;
            if (profile_values != 3)
                fail_validation("Connection rule '" + name + "' contains an incomplete WARP profile. Generate a profile and fill all profile fields. Aborted.");
            continue;
        }

        let peers = array_or_empty(endpoint.peers);
        if (length(array_or_empty(endpoint.address)) == 0 ||
            trim(as_string(endpoint.private_key || "")) == "" ||
            length(peers) == 0)
            fail_validation("Connection rule '" + name + "' contains an incomplete WireGuard endpoint. Aborted.");

        if (!valid_wireguard_key(endpoint.private_key))
            fail_validation("Connection rule '" + name + "' contains an invalid WireGuard private key. Use standard base64-encoded 32-byte values. Aborted.");

        for (let address in array_or_empty(endpoint.address))
            if (type(address) != "string" || !core_ip.valid_ip_cidr(trim(address)))
                fail_validation("Connection rule '" + name + "' contains an invalid WireGuard address. Use IP addresses with CIDR prefixes. Aborted.");

        for (let peer in peers) {
            peer = object_or_empty(peer);
            let port = int(peer.port || 0);
            if (trim(as_string(peer.address || "")) == "" ||
                trim(as_string(peer.public_key || "")) == "" ||
                port < 1 || port > 65535)
                fail_validation("Connection rule '" + name + "' contains an invalid WireGuard peer. Aborted.");

            if (!valid_wireguard_key(peer.public_key))
                fail_validation("Connection rule '" + name + "' contains an invalid WireGuard peer public key. Use standard base64-encoded 32-byte values. Aborted.");

            if (peer.pre_shared_key != null && trim(as_string(peer.pre_shared_key)) != "" &&
                !valid_wireguard_key(peer.pre_shared_key))
                fail_validation("Connection rule '" + name + "' contains an invalid WireGuard pre-shared key. Use standard base64-encoded 32-byte values. Aborted.");

            if (peer.persistent_keepalive_interval != null &&
                !valid_amnezia_range(peer.persistent_keepalive_interval))
                fail_validation("Connection rule '" + name + "' contains an invalid WireGuard persistent keepalive interval. Use values from 0 to 4294967295 with the start no greater than the end. Aborted.");

            let allowed_ips = peer.allowed_ips;
            if (type(allowed_ips) == "string")
                allowed_ips = [ allowed_ips ];
            if (type(allowed_ips) != "array" || length(allowed_ips) == 0)
                fail_validation("Connection rule '" + name + "' contains a WireGuard peer without AllowedIPs. Add at least one CIDR subnet. Aborted.");
            for (let allowed_ip in allowed_ips)
                if (type(allowed_ip) != "string" || !core_ip.valid_ip_cidr(trim(allowed_ip)))
                    fail_validation("Connection rule '" + name + "' contains an invalid WireGuard AllowedIPs subnet. Use IP addresses with CIDR prefixes. Aborted.");
        }
    }
}

function validate_json_inbound_values() {
    for (let server in sections_by_type("server")) {
        server = object_or_empty(server);
        if (!server_enabled(server) || option(server, "protocol", "") != "json_inbound")
            continue;

        let name = section_name(server);
        let inbound = null;
        try {
            inbound = json(option(server, "inbound_json", ""));
        }
        catch (e) {
            fail_validation("Server '" + name + "' contains invalid JSON inbound. Aborted.");
        }

        if (type(inbound) != "object" || type(inbound.type) != "string" || trim(as_string(inbound.type)) == "")
            fail_validation("Server '" + name + "' must contain a JSON inbound object with a type field. Aborted.");

        let inbound_type = as_string(inbound.type);
        if (inbound_type != trim(inbound_type) ||
            !contains(singbox_constants.JSON_INBOUND_TYPES, inbound_type))
            fail_validation("Server '" + name + "' contains unsupported JSON inbound type '" + inbound_type + "'. Aborted.");
    }
}

function rule_has_subscription_urls(section) {
    return length(connections.subscription_urls(section)) > 0;
}

function subscription_update_interval_for_source(section, entry) {
    if (!connections.subscription_update_enabled(section, entry))
        return "";
    let value = connections.subscription_update_interval(section, entry);
    return value != "" ? value : "1h";
}

function validate_subscription_request_profile(section, entry) {
    let parsed = subscription_headers_module.parse_header_lines(
        connections.subscription_headers(section, entry)
    );
    if (!parsed.valid)
        fail_validation("Subscription source in rule '" + section_name(section) + "' has invalid " + parsed.message + ". Aborted.");
}

function validate_subscription_filter(section, entry) {
    let name = section_name(section);
    let settings = connections.subscription_url_settings(section, entry);
    let mode = option(settings, "server_filter_mode", "all");
    validate_server_filter_mode(mode, "subscription in rule '" + name + "'", false);
    validate_server_filter_regexes(
        mode,
        option(settings, "include_regex", ""),
        option(settings, "exclude_regex", ""),
        name
    );
}

function validate_provider_strategy(kind, section, context) {
    let name = section_name(section);

    if (kind == "zapret") {
        let raw = zapret_validator().strategy_or_default(option(section, "nfqws_opt", ""), context.zapret_default_nfqws_opt);
        let result = zapret_validator().validate_strategy("nfqws", raw, context.zapret_legacy_default_nfqws_opt);
        if (!result.valid)
            fail_validation("Zapret rule '" + name + "' uses invalid NFQWS strategy: " + result.message + " Aborted.");
        return;
    }

    if (kind == "zapret2") {
        let raw = zapret2_validator().strategy_or_default(option(section, "nfqws2_opt", ""), context.zapret2_default_nfqws2_opt);
        let result = zapret2_validator().validate_strategy("nfqws2", raw, "");
        if (!result.valid)
            fail_validation("Zapret2 rule '" + name + "' uses invalid NFQWS2 strategy: " + result.message + " Aborted.");
        return;
    }

    let raw = byedpi_validator().strategy_or_default(option(section, "byedpi_cmd_opts", ""), context.byedpi_default_cmd_opts);
    let result = byedpi_validator().validate_byedpi_strategy(raw);
    if (!result.valid)
        fail_validation("Invalid ByeDPI strategy for rule '" + name + "': " + result.message);
}

function dns_action_has_domain_matchers(section) {
    for (let key in [ "domain", "domain_suffix", "domain_keyword", "domain_regex" ])
        if (option(section, key, "") != "" || option(section, key + "_text", "") != "" || length(list_option(section, key)) > 0)
            return true;

    return length(connections.community_lists(section)) > 0 ||
        length(connections.rule_sets(section)) > 0;
}

function validate_dns_action(section, sections, context) {
    let name = section_name(section);
    let fallback_strategy = option(section, "dns_fallback_strategy", "parallel");
    if (!contains([ "sequential", "parallel" ], fallback_strategy))
        fail_validation("DNS rule '" + name + "' uses unsupported fallback strategy '" + fallback_strategy + "'. Use sequential or parallel. Aborted.");
    let dns_servers = dns_setting_values(section, "dns_server");
    if (length(dns_servers) == 0)
        fail_validation("DNS rule '" + name + "' must contain at least one DNS server. Aborted.");
    for (let dns_server in dns_servers) {
        let parsed = runtime_dns.parse_server_uri(dns_server, false);
        if (parsed.unsupported)
            fail_validation("DNS rule '" + name + "' has an invalid DNS server '" + dns_server + "': " + parsed.unsupported + ". Aborted.");
    }
    if (length(connections.rule_sets_with_subnets(section)) > 0)
        fail_validation("DNS rule '" + name + "' can use domain-only rule sets, but subnet extraction is enabled. Disable 'Include IP addresses and subnets'. Aborted.");
    if (!dns_action_has_domain_matchers(section) && length(list_option(section, "fully_routed_ips")) == 0)
        fail_validation("DNS rule '" + name + "' must contain at least one domain condition or domain rule set. Aborted.");
    if (!bool_option(section, "dns_detour_enabled", false))
        return;

    let target_name = option(section, "dns_detour_section", "");
    if (target_name == "")
        fail_validation("DNS rule '" + name + "' routes DNS through a section, but no section is selected. Aborted.");
    if (target_name == name)
        fail_validation("DNS rule '" + name + "' cannot use itself as a DNS detour. Aborted.");

    let target = null;
    for (let candidate in sections)
        if (section_name(candidate) == target_name) {
            target = candidate;
            break;
        }
    if (target == null)
        fail_validation("DNS rule '" + name + "' references missing detour section '" + target_name + "'. Aborted.");
    if (!section_enabled(target))
        fail_validation("DNS rule '" + name + "' references disabled detour section '" + target_name + "'. Aborted.");
    if (!download_section_action_available(rule_action(target), context.byedpi_installed, context.zapret_installed, context.zapret2_installed))
        fail_validation("DNS rule '" + name + "' references detour section '" + target_name + "' with unsupported action '" + rule_action(target) + "'. Select an enabled Connection, VPN, Zapret, Zapret2, or ByeDPI section. Aborted.");
}

function validate_rule(section, sections, context) {
    if (!section_enabled(section))
        return;

    let name = section_name(section);
    let action = rule_action(section);
    if (action == "")
        fail_validation("Enabled rule '" + name + "' has no action. Aborted.");
    if (!rule_action_supported(action))
        fail_validation("Enabled rule '" + name + "' uses unsupported action '" + action + "'. Aborted.");

    if (action != "dns")
        for (let value in list_option(section, "ports"))
            validate_port_condition_value(value, name);

    if (action == "dns")
        validate_dns_action(section, sections, context);

    if (action == "zapret") {
        if (!context.zapret_installed) {
            validate_common_rule_references(section, context);
            return;
        }
        validate_provider_strategy("zapret", section, context);
    }

    if (action == "zapret2") {
        if (!context.zapret2_installed) {
            validate_common_rule_references(section, context);
            return;
        }
        validate_provider_strategy("zapret2", section, context);
    }

    if (action == "byedpi") {
        if (!context.byedpi_installed) {
            validate_common_rule_references(section, context);
            return;
        }
        validate_provider_strategy("byedpi", section, context);
    }

    if (connections.is_connections_action(action)) {
        for (let urltest_id in connections.urltests(section)) {
            validate_urltest_identifier_value(urltest_id, name);

            let check_interval = connections.urltest_check_interval(section, urltest_id);
            validate_required_duration_option(check_interval, "rule." + name + ".urltest." + urltest_id + ".urltest_check_interval");
            validate_urltest_tolerance_value(connections.urltest_tolerance(section, urltest_id), name, urltest_id);
            validate_http_url_option(connections.urltest_testing_url(section, urltest_id), "rule." + name + ".urltest." + urltest_id + ".testing_url");
            let idle_timeout = connections.urltest_idle_timeout(section, urltest_id);
            if (idle_timeout != "")
                validate_required_duration_option(idle_timeout, "rule." + name + ".urltest." + urltest_id + ".idle_timeout");
            let effective_idle_timeout = idle_timeout != ""
                ? idle_timeout
                : as_string(singbox_constants.URLTEST_DEFAULT_IDLE_TIMEOUT || "30m");
            if (duration_to_seconds_value(check_interval) > duration_to_seconds_value(effective_idle_timeout))
                fail_validation("URLTest '" + urltest_id + "' in rule '" + name + "' has a check interval longer than its idle timeout. Increase the idle timeout or shorten the check interval. Aborted.");

            let filter_mode = connections.urltest_filter_mode(section, urltest_id);
            validate_server_filter_mode(filter_mode, "URLTest '" + urltest_id + "'", false);
            validate_server_filter_regexes(
                filter_mode,
                connections.urltest_include_regex(section, urltest_id),
                connections.urltest_exclude_regex(section, urltest_id),
                name
            );
        }

        let fallback_names = {};
        for (let group_id in connections.fallback_groups(section)) {
            let fallback_name = trim(connections.fallback_group_display_name(section, group_id));
            if (fallback_names[fallback_name])
                fail_validation("Connection rule '" + name + "' has duplicate fallback name '" + fallback_name + "'. Aborted.");
            fallback_names[fallback_name] = true;
            validate_fallback_group(section, group_id);
        }

        if (rule_has_subscription_urls(section)) {
            for (let value in connections.subscription_urls(section)) {
                validate_subscription_source_entry_value(value, name);
                validate_subscription_request_profile(section, value);
                validate_subscription_filter(section, value);
                let subscription_update_interval = subscription_update_interval_for_source(section, value);
                if (subscription_update_interval != "")
                    validate_required_duration_option(subscription_update_interval, "rule." + name + ".subscription_update_interval");
            }
        }

        validate_outbound_json_values(section);
        validate_tunnel_values(section);
    }

    if (action == "outbound")
        validate_outbound_json_rule(section);

    validate_combined_domain_text_value(option(section, "domain", ""), name);
    for (let value in list_option(section, "domain_suffix"))
        validate_combined_domain_value(value, name);
    validate_combined_domain_text_value(option(section, "domain_suffix_text", ""), name);
    validate_common_rule_references(section, context);
    if (connections.is_connections_action(action) && !connections.has_connection_sources(section))
        log_message("Connection rule '" + name + "' has no configured outbounds.", "error");
}

function download_via_proxy_option_for_purpose(purpose) {
    purpose = as_string(purpose || "lists");
    if (purpose == "lists")
        return "download_lists_via_proxy";
    if (purpose == "components")
        return "download_components_via_proxy";
    return "";
}

function download_via_proxy_section_option_for_purpose(purpose) {
    purpose = as_string(purpose || "lists");
    if (purpose == "lists")
        return "download_lists_via_proxy_section";
    if (purpose == "components")
        return "download_components_via_proxy_section";
    return "";
}

function download_via_proxy_section(settings, purpose) {
    let enabled_option = download_via_proxy_option_for_purpose(purpose);
    if (enabled_option == "" || !bool_option(settings, enabled_option, false))
        return "";

    let section_option = download_via_proxy_section_option_for_purpose(purpose);
    let configured = section_option != "" ? option(settings, section_option, "") : "";
    if (configured != "")
        return configured;

    return option(settings, "download_lists_via_proxy_section", "");
}

function download_via_proxy_enabled(settings, purpose) {
    let enabled_option = download_via_proxy_option_for_purpose(purpose);
    return enabled_option != "" && bool_option(settings, enabled_option, false);
}

function basic_rows_from_sections(sections) {
    let rows = [];
    for (let section in sections) {
        push(rows, {
            section: section_name(section),
            enabled: section_enabled(section),
            action: rule_action(section)
        });
    }
    return rows;
}

function detour_rows_from_sections(sections) {
    let rows = [];
    for (let section in sections) {
        push(rows, {
            section: section_name(section),
            enabled: section_enabled(section),
            action: rule_action(section),
            detour_enabled: bool_option(section, "outbound_detour_enabled", false),
            detour_section: option(section, "outbound_detour_section", "")
        });
    }
    return rows;
}

function validate_subscription_download_sections(sections, context) {
    let rows = basic_rows_from_sections(sections);

    for (let section in sections) {
        section = object_or_empty(section);
        if (!section_enabled(section))
            continue;

        let name = section_name(section);
        for (let entry in connections.subscription_urls(section)) {
            let target = connections.subscription_download_section(section, entry);
            if (target == "")
                continue;

            if (target == name)
                fail_validation("Subscription source in rule '" + name + "' cannot be downloaded through the same rule. Select another rule or disable download-through-section. Aborted.");

            validate_download_section_rows(
                target,
                context.byedpi_installed,
                context.zapret_installed,
                context.zapret2_installed,
                rows
            );
        }
    }
}

function basic_rows_by_section(rows) {
    let result = {};
    for (let row in array_or_empty(rows))
        if (type(row) == "object" && row.section != "")
            result[row.section] = row;
    return result;
}

function validate_server_routing_sections(sections) {
    let by_section = basic_rows_by_section(basic_rows_from_sections(sections));

    for (let server in sections_by_type("server")) {
        server = object_or_empty(server);
        if (!server_enabled(server))
            continue;

        let name = section_name(server);
        if (option(server, "protocol", "") == "tailscale" &&
            bool_option(server, "tailscale_detour_enabled", false)) {
            let detour_name = option(server, "tailscale_detour_section", "");
            if (detour_name == "")
                fail_validation("Tailscale server '" + name + "' has no control-plane section selected. Aborted.");
            if (detour_name == name)
                fail_validation("Tailscale server '" + name + "' cannot use itself for the control plane. Aborted.");
            let detour_target = by_section[detour_name];
            if (type(detour_target) != "object" || !detour_target.enabled ||
                !connections.is_connections_action(detour_target.action))
                fail_validation("Tailscale server '" + name + "' references an unavailable control-plane section. Aborted.");
        }
        let mode = option(server, "routing_mode", "rules");
        if (!contains([ "rules", "direct", "section" ], mode))
            fail_validation("Server '" + name + "' uses unsupported routing mode '" + mode + "'. Aborted.");

        if (mode != "section")
            continue;

        let target_name = option(server, "routing_section", "");
        if (target_name == "")
            fail_validation("Server '" + name + "' uses selected-section routing, but no routing section is selected. Aborted.");

        let target = by_section[target_name];
        if (type(target) != "object")
            fail_validation("Server '" + name + "' references missing routing section '" + target_name + "'. Aborted.");
        if (!target.enabled)
            fail_validation("Server '" + name + "' references disabled routing section '" + target_name + "'. Aborted.");
        if (!server_routing_section_action_supported(target.action))
            fail_validation("Server '" + name + "' references routing section '" + target_name + "' with unsupported action '" + target.action + "'. Select a Connection, proxy, JSON outbound, VPN, Zapret, Zapret2, or ByeDPI section. Aborted.");
    }
}

function validate_native_rule_set_update_settings(settings) {
    if (!bool_option(settings, "list_update_enabled", true))
        return;

    let update_interval = option(settings, "update_interval", "1d");
    if (update_interval == "")
        update_interval = "1d";
    validate_required_duration_option(update_interval, "settings.update_interval");
}

function validate_runtime_mark_ranges_context(context) {
    let fakeip_mark = parse_number(context.nft_fakeip_mark);
    let outbound_mark = parse_number(context.nft_outbound_mark);

    if (fakeip_mark == null || outbound_mark == null)
        fail_validation("Forkop marks contain invalid numeric constants. Aborted.");
    if ((fakeip_mark & TAILSCALE_FWMARK_MASK) != 0)
        fail_validation("FakeIP mark overlaps Tailscale fwmark mask 0x00ff0000. Aborted.");
    if ((outbound_mark & TAILSCALE_FWMARK_MASK) != 0)
        fail_validation("Outbound mark overlaps Tailscale fwmark mask 0x00ff0000. Aborted.");

    let ranges = [
        [ "Zapret", context.zapret_route_mark_base, context.zapret_queue_range_size, fakeip_mark, "FakeIP mark " + context.nft_fakeip_mark ],
        [ "Zapret", context.zapret_route_mark_base, context.zapret_queue_range_size, outbound_mark, "outbound mark " + context.nft_outbound_mark ],
        [ "Zapret2", context.zapret2_route_mark_base, context.zapret2_queue_range_size, fakeip_mark, "FakeIP mark " + context.nft_fakeip_mark ],
        [ "Zapret2", context.zapret2_route_mark_base, context.zapret2_queue_range_size, outbound_mark, "outbound mark " + context.nft_outbound_mark ],
        [ "Zapret", context.zapret_route_mark_base, context.zapret_queue_range_size, TAILSCALE_FWMARK_MASK, "Tailscale fwmark mask 0x00ff0000" ],
        [ "Zapret2", context.zapret2_route_mark_base, context.zapret2_queue_range_size, TAILSCALE_FWMARK_MASK, "Tailscale fwmark mask 0x00ff0000" ]
    ];

    for (let range in ranges) {
        let label = as_string(range[0]);
        let base = parse_number(range[1]);
        let range_size = parse_number(range[2]);
        let mark_mask = range[3];
        let mark_mask_label = as_string(range[4]);

        if (base == null || range_size == null || mark_mask == null)
            fail_validation(label + " route mark range contains invalid numeric constants. Aborted.");

        for (let index_value = 1; index_value <= range_size; index_value++) {
            let mark_value = base + index_value;
            if ((mark_value & mark_mask) != 0)
                fail_validation(label + " route mark range overlaps " + mark_mask_label + ". Aborted.");
        }
    }
}

function validate_runtime_config(context) {
    let settings = settings_section();
    let sections = sections_by_type("section");
    let servers = sections_by_type("server");

    let display_names = {};
    validate_runtime_display_names(sections, "Section", display_names);
    validate_runtime_display_names(servers, "Server", display_names);
    validate_runtime_mark_ranges_context(context);
    validate_dns_settings(settings, sections, context);
    validate_native_rule_set_update_settings(settings);
    validate_http_url_option(option(settings, "latency_test_url", DEFAULT_LATENCY_TEST_URL) || DEFAULT_LATENCY_TEST_URL, "settings.latency_test_url");

    if (download_via_proxy_enabled(settings, "lists")) {
        validate_download_section_rows(
            download_via_proxy_section(settings, "lists"),
            context.byedpi_installed,
            context.zapret_installed,
            context.zapret2_installed,
            basic_rows_from_sections(sections)
        );
    }
    if (download_via_proxy_enabled(settings, "components")) {
        validate_download_section_rows(
            download_via_proxy_section(settings, "components"),
            context.byedpi_installed,
            context.zapret_installed,
            context.zapret2_installed,
            basic_rows_from_sections(sections)
        );
    }

    validate_outbound_detours_rows(detour_rows_from_sections(sections));
    validate_subscription_download_sections(sections, context);
    validate_json_inbound_values();
    validate_server_routing_sections(sections);

    for (let section in sections) {
        validate_subscription_tags(section);
        validate_rule(section, sections, context);
    }
}

function context_from_runtime() {
    let constants = object_or_empty(runtime_constants());

    return {
        constants,
        community_services: constant_value(constants, "COMMUNITY_SERVICES"),
        byedpi_default_cmd_opts: constant_value(constants, "BYEDPI_DEFAULT_CMD_OPTS"),
        zapret_default_nfqws_opt: constant_value(constants, "ZAPRET_DEFAULT_NFQWS_OPT"),
        zapret_legacy_default_nfqws_opt: constant_value(constants, "ZAPRET_LEGACY_DEFAULT_NFQWS_OPT"),
        zapret2_default_nfqws2_opt: constant_value(constants, "ZAPRET2_DEFAULT_NFQWS2_OPT"),
        byedpi_installed: file_executable(constant_value(constants, "BYEDPI_BIN")),
        zapret_installed: file_executable(constant_value(constants, "ZAPRET_PROVIDER_NFQWS_BIN")),
        zapret2_installed: file_executable(constant_value(constants, "ZAPRET2_PROVIDER_NFQWS2_BIN")),
        zapret_provider_nfqws_bin: constant_value(constants, "ZAPRET_PROVIDER_NFQWS_BIN"),
        zapret2_provider_nfqws2_bin: constant_value(constants, "ZAPRET2_PROVIDER_NFQWS2_BIN"),
        zapret_route_mark_base: constant_value(constants, "ZAPRET_ROUTE_MARK_BASE"),
        zapret_queue_range_size: constant_value(constants, "ZAPRET_QUEUE_RANGE_SIZE"),
        zapret2_route_mark_base: constant_value(constants, "ZAPRET2_ROUTE_MARK_BASE"),
        zapret2_queue_range_size: constant_value(constants, "ZAPRET2_QUEUE_RANGE_SIZE"),
        nft_fakeip_mark: constant_value(constants, "NFT_FAKEIP_MARK"),
        nft_outbound_mark: constant_value(constants, "NFT_OUTBOUND_MARK"),
        coreutils_base64_required_version: constant_value(constants, "COREUTILS_BASE64_REQUIRED_VERSION"),
        sing_box_required_version: constant_value(constants, "SB_REQUIRED_VERSION"),
        zapret_legacy_runtime_base_dir: constant_value(constants, "ZAPRET_LEGACY_RUNTIME_BASE_DIR"),
        zapret_state_dir: constant_value(constants, "ZAPRET_STATE_DIR"),
        zapret_pid_dir: constant_value(constants, "ZAPRET_PID_DIR"),
        zapret_child_pid_dir: constant_value(constants, "ZAPRET_CHILD_PID_DIR"),
        zapret_log_dir: constant_value(constants, "ZAPRET_LOG_DIR"),
        zapret2_state_dir: constant_value(constants, "ZAPRET2_STATE_DIR"),
        zapret2_pid_dir: constant_value(constants, "ZAPRET2_PID_DIR"),
        zapret2_child_pid_dir: constant_value(constants, "ZAPRET2_CHILD_PID_DIR"),
        zapret2_log_dir: constant_value(constants, "ZAPRET2_LOG_DIR"),
        byedpi_bin: constant_value(constants, "BYEDPI_BIN"),
        byedpi_state_dir: constant_value(constants, "BYEDPI_STATE_DIR"),
        byedpi_pid_dir: constant_value(constants, "BYEDPI_PID_DIR"),
        byedpi_child_pid_dir: constant_value(constants, "BYEDPI_CHILD_PID_DIR"),
        byedpi_log_dir: constant_value(constants, "BYEDPI_LOG_DIR")
    };
}

function service_exists(service) {
    return file_executable("/etc/init.d/" + as_string(service));
}

function has_outbound_section(ctx) {
    for (let section in sections_by_type("section")) {
        if (!section_enabled(section))
            continue;

        let action = rule_action(section);
        if (action == "byedpi" && ctx.byedpi_installed)
            return true;
        if (action == "zapret" && ctx.zapret_installed)
            return true;
        if (action == "zapret2" && ctx.zapret2_installed)
            return true;

        if (length(connections.connection_urls(section)) > 0 ||
            length(connections.subscription_urls(section)) > 0 ||
            length(connections.outbound_jsons(section)) > 0 ||
            length(connections.tunnels(section)) > 0 ||
            length(connections.interfaces(section)) > 0)
            return true;
    }

    return false;
}

function has_enabled_rule_action(action) {
    action = as_string(action);

    for (let section in sections_by_type("section"))
        if (section_enabled(section) && rule_action(section) == action)
            return true;

    return false;
}

function cleanup_legacy_zapret_runtime(ctx) {
    let base = as_string(ctx.zapret_legacy_runtime_base_dir);
    if (base == "")
        return;

    let needle = base + "/nfq/nfqws";
    for (let line in split(command_output_from_args([ "ps", "w" ]), "\n")) {
        if (index(as_string(line), needle) < 0)
            continue;

        let fields = split(trim(as_string(line)), /[ \t]+/);
        let pid = length(fields) > 0 ? as_string(fields[0]) : "";
        if (match(pid, /^[0-9]+$/) != null)
            run_args([ "kill", pid ]);
    }

    safe_rm_rf(base);
}

function check_provider_requirement(action, display_name, bin_path, dirs, missing_message, prepare_failure_message) {
    if (!has_enabled_rule_action(action))
        return;

    if (!file_executable(bin_path)) {
        log_message(missing_message, "error");
        return;
    }

    if (!mkdir_p(dirs))
        fail_requirement(prepare_failure_message, "error");
}

function check_provider_requirements(ctx) {
    cleanup_legacy_zapret_runtime(ctx);

    check_provider_requirement(
        "zapret",
        "Zapret",
        ctx.zapret_provider_nfqws_bin,
        [ ctx.zapret_state_dir, ctx.zapret_pid_dir, ctx.zapret_child_pid_dir, ctx.zapret_log_dir ],
        "Zapret provider is not available at " + ctx.zapret_provider_nfqws_bin + ". Rules with action 'zapret' will be skipped until the zapret provider is installed.",
        "Failed to prepare the Forkop zapret state directory in " + ctx.zapret_state_dir + ". Aborted."
    );

    check_provider_requirement(
        "zapret2",
        "Zapret2",
        ctx.zapret2_provider_nfqws2_bin,
        [ ctx.zapret2_state_dir, ctx.zapret2_pid_dir, ctx.zapret2_child_pid_dir, ctx.zapret2_log_dir ],
        "Zapret2 provider is not available at " + ctx.zapret2_provider_nfqws2_bin + ". Rules with action 'zapret2' will be skipped until the zapret2 provider is installed.",
        "Failed to prepare the Forkop zapret2 state directory in " + ctx.zapret2_state_dir + ". Aborted."
    );

    check_provider_requirement(
        "byedpi",
        "ByeDPI",
        ctx.byedpi_bin,
        [ ctx.byedpi_state_dir, ctx.byedpi_pid_dir, ctx.byedpi_child_pid_dir, ctx.byedpi_log_dir ],
        "ByeDPI provider is not available at " + ctx.byedpi_bin + ". Rules with action 'byedpi' will be skipped until the byedpi package is installed.",
        "Failed to prepare the Forkop ByeDPI state directory in " + ctx.byedpi_state_dir + ". Aborted."
    );
}

function check_runtime_requirements() {
    log_message("Checking required packages and runtime settings", "info");

    let ctx = context_from_runtime();
    let sing_box_version = trim(as_string(fs.readfile(SING_BOX_FORKOP_VERSION_FILE)));
    if (match(sing_box_version, /^[0-9][0-9A-Za-z._+~-]*-extended-[0-9][0-9A-Za-z._+~-]*-f[0-9]+$/) == null &&
        match(sing_box_version, /^[0-9][0-9A-Za-z._+~-]*-forkop[.][0-9]+$/) == null)
        sing_box_version = "";
    sing_box_version = replace(sing_box_version, /~/g, "-");
    let coreutils_base64_version = first_line_field_from_text(command_output("base64 --version 2>/dev/null"), 4);

    if (!command_exists("sing-box"))
        fail_requirement("Binary 'sing-box' is not available. Reinstall sing-box-forkop. Aborted.", "error");
    if (sing_box_version == "")
        fail_requirement("Failed to read sing-box-forkop version. Reinstall sing-box-forkop. Aborted.", "error");
    else if (!version_at_least(sing_box_version, ctx.sing_box_required_version)) {
        fail_requirement("Package 'sing-box-forkop' version (" + sing_box_version + ") is lower than the required minimum (" + ctx.sing_box_required_version + "). Update it from Forkop Components. Aborted.", "error");
    }

    if (!service_exists("sing-box"))
        fail_requirement("Service 'sing-box' is missing. Reinstall sing-box-forkop. Aborted.", "error");

    if (coreutils_base64_version == "")
        fail_requirement("Package 'coreutils-base64' is not installed. Aborted.", "error");
    else if (!version_at_least(coreutils_base64_version, ctx.coreutils_base64_required_version))
        log_message("Package 'coreutils-base64' version (" + coreutils_base64_version + ") is lower than the required minimum (" + ctx.coreutils_base64_required_version + "). This may cause issues when decoding base64 streams with missing padding, as automatic padding support is not available in older versions.", "warn");

    if (dhcp_has_https_dns_proxy_options("/etc/config/dhcp") === true)
        log_message("https-dns-proxy is enabled in DHCP config. Disable it or edit /etc/config/dhcp before starting Forkop.", "error");

    if (has_outbound_section(ctx))
        log_message("Proxy outbound configuration found", "debug");
    else
        log_message("No proxy outbound sections found. Forkop will use direct and/or provider-only routing.", "warn");

    check_provider_requirements(ctx);
}

function context_override_value(overrides, defaults, key) {
    let value = object_or_empty(overrides)[key];
    if (value != null)
        return as_string(value);
    return as_string(object_or_empty(defaults)[key]);
}

function context_override_bool(overrides, defaults, key) {
    let value = object_or_empty(overrides)[key];
    if (value != null)
        return bool_flag(value);
    return bool_flag(object_or_empty(defaults)[key]);
}

function context_from_json(value, defaults) {
    try {
        value = json(as_string(value));
    }
    catch (e) {
        value = {};
    }

    value = object_or_empty(value);
    defaults = object_or_empty(defaults);

    return {
        community_services: context_override_value(value, defaults, "community_services"),
        byedpi_default_cmd_opts: context_override_value(value, defaults, "byedpi_default_cmd_opts"),
        zapret_default_nfqws_opt: context_override_value(value, defaults, "zapret_default_nfqws_opt"),
        zapret_legacy_default_nfqws_opt: context_override_value(value, defaults, "zapret_legacy_default_nfqws_opt"),
        zapret2_default_nfqws2_opt: context_override_value(value, defaults, "zapret2_default_nfqws2_opt"),
        byedpi_installed: context_override_bool(value, defaults, "byedpi_installed"),
        zapret_installed: context_override_bool(value, defaults, "zapret_installed"),
        zapret2_installed: context_override_bool(value, defaults, "zapret2_installed"),
        zapret_route_mark_base: context_override_value(value, defaults, "zapret_route_mark_base"),
        zapret_queue_range_size: context_override_value(value, defaults, "zapret_queue_range_size"),
        zapret2_route_mark_base: context_override_value(value, defaults, "zapret2_route_mark_base"),
        zapret2_queue_range_size: context_override_value(value, defaults, "zapret2_queue_range_size"),
        nft_fakeip_mark: context_override_value(value, defaults, "nft_fakeip_mark"),
        nft_outbound_mark: context_override_value(value, defaults, "nft_outbound_mark")
    };
}

let mode = ARGV[0] || "";

if (mode == "stdin-first-line-field")
    stdin_first_line_field(ARGV[1]);
else if (mode == "enum-valid")
    exit(enum_valid(ARGV[1], 2) ? 0 : 1);
else if (mode == "regex-valid")
    exit(regex_valid(ARGV[1]) ? 0 : 1);
else if (mode == "combined-domain-valid")
    exit(combined_domain_valid(ARGV[1]) ? 0 : 1);
else if (mode == "combined-domain-text-valid")
    exit(combined_domain_text_valid(ARGV[1]) ? 0 : 1);
else if (mode == "community-service-valid")
    exit(community_service_valid(ARGV[1], ARGV[2]) ? 0 : 1);
else if (mode == "ruleset-reference-valid")
    exit(ruleset_reference_valid(ARGV[1], ARGV[2]) ? 0 : 1);
else if (mode == "valid-outbound")
    exit(valid_outbound() ? 0 : 1);
else if (mode == "valid-inbound")
    exit(valid_inbound() ? 0 : 1);
else if (mode == "validate-outbound-detours")
    validate_outbound_detours();
else if (mode == "validate-download-section")
    validate_download_section(ARGV[1], ARGV[2], ARGV[3], ARGV[4]);
else if (mode == "dhcp-has-https-dns-proxy-options")
    dhcp_has_https_dns_proxy_options_exit(ARGV[1]);
else if (mode == "mwan3-has-enabled-interface")
    exit(mwan3_has_enabled_interface() ? 0 : 1);
else if (mode == "mwan3-is-active")
    exit(mwan3_is_active() ? 0 : 1);
else if (mode == "check-requirements")
    check_runtime_requirements();
else if (mode == "validate-runtime")
    validate_runtime_config(context_from_runtime());
else if (mode == "validate-runtime-fixture") {
    use_fixture_cursor(ARGV[1]);
    validate_runtime_config(context_from_json(ARGV[2], context_from_runtime()));
}
else {
    warn("Usage: config/validator.uc <operation> ...\n");
    exit(1);
}
