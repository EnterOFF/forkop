let fs = require("fs");
let core_common = require("core.common");
let core_exec = require("core.exec");
let core_url = require("core.url");
let core_ip = require("core.ip");
let uci_core = require("core.uci");
let constants = require("core.constants");
let rule_config = require("config.rule");
let core_version = require("core.version");
let packages = require("core.packages");
let connections = require("config.connections");
let singbox_constants = require("singbox.constants");
let rulesets = require("singbox.rulesets");
let runtime_dns = require("singbox.dns");
let runtime_servers = require("singbox.servers");
let features = require("singbox.features");
let runtime_urltest = require("singbox.urltest");
let subscription_headers_module = require("singbox.subscription_headers");

let as_string = core_common.as_string;
let object_or_empty = core_common.object_or_empty;
let array_or_empty = core_common.array_or_empty;
let option = core_common.option;
let list_option = core_common.list_option;
let bool_option = core_common.bool_option;
let parse_number = core_common.parse_number;

const CONFIG_NAME = "forkop";
const DEFAULT_LATENCY_TEST_URL = "https://www.gstatic.com/generate_204";
const TAILSCALE_FWMARK_MASK = 0x00ff0000;
const AMNEZIA_SIGNATURE_KEYS = [ "i1", "i2", "i3", "i4", "i5" ];
const AMNEZIA_SIGNATURE_TAGS = [ "b", "c", "t", "r", "rc", "rd", "d", "ds", "dz" ];

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

function contains(values, needle) {
    for (let value in array_or_empty(values))
        if (value == needle)
            return true;
    return false;
}

function file_executable(path) {
    let stat = fs.stat(as_string(path));
    if (stat == null || stat.mode == null)
        return false;

    return (int(stat.mode) & 73) != 0;
}

function command_exists(name) {
    return core_exec.ok([ "sh", "-c", "command -v \"$1\"", "sh", name ]);
}

// Why a pattern sing-box matches with RE2 cannot be matched the same way here, or null.
function regex_problem(pattern) {
    try {
        runtime_urltest.compile(pattern);
        return null;
    }
    catch (e) {
        return e.message;
    }
}

function combined_domain_valid(value) {
    value = trim(as_string(value));
    if (value == "")
        return true;

    let normalized = rule_config.prefixed_domain_kind_value(value);
    if (normalized == null)
        return false;

    return normalized.kind != "domain_regex" || regex_problem(normalized.value) == null;
}

function combined_domain_text_valid(value) {
    for (let item in rule_config.text_list_values(value, "comma-space"))
        if (!combined_domain_valid(item))
            return false;
    return true;
}

function remote_reference(value) {
    return string_starts_with(value, "http://") || string_starts_with(value, "https://");
}

function absolute_reference(value) {
    value = as_string(value);
    return string_starts_with(value, "/");
}

function ruleset_reference_valid(reference) {
    reference = as_string(reference);
    let path = lc(replace(reference, /[?#].*$/, ""));
    if (match(path, /\.ya?ml$/) != null)
        return false;

    return reference == "" ||
        rulesets.is_community(reference) ||
        remote_reference(reference) ||
        absolute_reference(reference);
}

function fail_validation(message) {
    die(message);
}

function dhcp_has_https_dns_proxy_options(path) {
    let data = fs.readfile(as_string(path));
    if (data == null)
        return null;

    return index(data, "doh_backup_noresolv") >= 0 ||
        index(data, "doh_backup_server") >= 0 ||
        index(data, "doh_server") >= 0;
}

function settings_section() {
    return object_or_empty(uci_core.get_all(CONFIG_NAME, "settings"));
}

function sections_by_type(type_name) {
    return uci_core.section_objects(CONFIG_NAME, type_name);
}

function section_name(section) {
    return option(section, ".name", "");
}

// How the page names a section or a server: its label, or its id without one.
function section_label(section) {
    return connections.section_display_name(section);
}

function server_label(server) {
    return connections.server_display_name(server);
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
            fail_validation(kind + " has no display name");
        if (index(name, "/") >= 0)
            fail_validation(kind + " display name '" + name + "' contains '/'. Use another character");
        if (reserved[name])
            fail_validation(kind + " display name '" + name + "' is reserved by Forkop. Choose another name");
        if (seen[name])
            fail_validation("Duplicate " + lc(kind) + " display name '" + name + "'. Display names must be unique");
        seen[name] = true;
    }
}

function validate_subscription_tags(section) {
    let seen = {};
    for (let tag_name in connections.subscription_tags(section)) {
        if (trim(tag_name) == "")
            fail_validation("A subscription in section '" + section_label(section) + "' has no tag. Set one in its settings");
        if (index(tag_name, "/") >= 0)
            fail_validation("Subscription tag '" + tag_name + "' in section '" + section_label(section) + "' contains '/'. Use another character");
        if (seen[tag_name])
            fail_validation("Duplicate subscription tag '" + tag_name + "' in section '" + section_label(section) + "'");
        seen[tag_name] = true;
    }
}

function rule_action(section) {
    return option(section, "action", "");
}

function rule_action_supported(action) {
    return contains([ "connection", "proxy", "outbound", "vpn", "bypass", "block", "dns" ], as_string(action));
}

function find_section(sections, name) {
    for (let section in sections)
        if (section_name(section) == name)
            return section;
    return null;
}

// Refuses a reference to anything but an enabled Connection section with
// servers of its own. The runtime leaves out a section without servers, so a
// reference to one would reach sing-box as an outbound that does not exist.
function outbound_section(sections, label, target_name) {
    let target = find_section(sections, target_name);
    let reason = target == null ? "section '" + target_name + "', which does not exist"
        : !section_enabled(target) ? "section '" + section_label(target) + "', which is disabled"
        : !connections.is_connections_action(rule_action(target)) ? "section '" + section_label(target) + "', whose action is '" + rule_action(target) + "'"
        : !connections.has_connection_sources(target) ? "section '" + section_label(target) + "', which has no servers"
        : null;
    if (reason != null)
        fail_validation(label + " points to " + reason + ". Select an enabled Connection section with servers");
    return target;
}

function cascade_target(section) {
    return bool_option(section, "outbound_detour_enabled", false) ? option(section, "outbound_detour_section", "") : null;
}

function validate_outbound_detours(sections) {
    for (let section in sections) {
        let name = section_name(section);
        let target = cascade_target(section);
        if (!section_enabled(section) || target == null)
            continue;

        let label = "The outbound cascade of section '" + section_label(section) + "'";
        if (!connections.is_connections_action(rule_action(section)))
            fail_validation("An outbound cascade needs a Connection section, but section '" + section_label(section) +
                "' has action '" + rule_action(section) + "'");
        if (target == "")
            fail_validation(label + " is enabled, but no intermediate section is selected");
        if (target == name)
            fail_validation(label + " cannot point to its own section");
        outbound_section(sections, label, target);

        let seen = {};
        for (let current = target; current != null && current != "" && !seen[current];) {
            if (current == name)
                fail_validation(label + " loops back through section '" + section_label(target) + "'");
            seen[current] = true;
            let next = find_section(sections, current);
            current = next != null && section_enabled(next) && connections.is_connections_action(rule_action(next)) ? cascade_target(next) : null;
        }
    }
}

function validate_download_section(sections, target_name) {
    if (as_string(target_name) == "")
        fail_validation("Downloading external resources through a section is enabled, but no download section is selected");
    outbound_section(sections, "Downloading external resources through a section", target_name);
}

// A WARP tunnel waits for its profile before it carries anything, so a profile
// requested through the section that holds the tunnel would wait for itself.
function validate_warp_profile_section(target_name) {
    for (let tunnel in sections_by_type("tunnel"))
        if (option(tunnel, "kind", "") == "warp" && option(tunnel, "section", "") == target_name)
            fail_validation("Section '" + connections.section_display_name(target_name) + "' holds WARP tunnel '" +
                option(tunnel, "name", section_name(tunnel)) + "', so it cannot carry the requests for its profile. " +
                "Choose another section for WARP profiles");
}

function validate_duration_option(value, label) {
    if (as_string(value) == "")
        return;

    if (core_common.duration_to_seconds(value) != null)
        return;

    fail_validation("Invalid duration value for " + label + ": " + value + ". Use sing-box duration format like 1d, 12h or 30m");
}

function validate_required_duration_option(value, label) {
    if (as_string(value) == "")
        fail_validation("Missing duration value for " + label + ". Use sing-box duration format like 1d, 12h or 30m");

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
    validate_required_duration_option(option(settings, "dns_timeout", "10s"), "'DNS timeout' in Settings");
    if (bool_option(settings, "dns_optimistic", false))
        validate_required_duration_option(option(settings, "dns_optimistic_timeout", "3d"), "'Maximum age of expired DNS answers' in Settings");
    let dns_strategy = option(settings, "dns_strategy", "prefer_ipv4");
    if (!contains([ "prefer_ipv4", "ipv4_only", "prefer_ipv6", "ipv6_only" ], dns_strategy))
        fail_validation("Unsupported DNS strategy '" + dns_strategy + "'. Use prefer_ipv4, ipv4_only, prefer_ipv6, or ipv6_only");

    for (let strategy_option in [ [ "dns_main_fallback_strategy", "Main DNS Query Mode" ], [ "dns_bootstrap_fallback_strategy", "Bootstrap DNS Query Mode" ] ]) {
        let fallback_strategy = option(settings, strategy_option[0], "parallel");
        if (!contains([ "sequential", "parallel" ], fallback_strategy))
            fail_validation("Unsupported value '" + fallback_strategy + "' of '" + strategy_option[1] + "' in Settings. Use sequential or parallel");
    }

    let main_servers = dns_setting_values(settings, "dns_server");
    let bootstrap_servers = dns_setting_values(settings, "bootstrap_dns_server");
    if (length(main_servers) == 0)
        fail_validation("At least one main DNS server is required");
    if (length(bootstrap_servers) == 0)
        fail_validation("At least one Bootstrap DNS server is required");
    for (let value in main_servers) {
        let parsed = runtime_dns.parse_server_uri(value, false);
        if (parsed.unsupported)
            fail_validation("Invalid main DNS server '" + value + "': " + parsed.unsupported);
    }
    for (let value in bootstrap_servers) {
        let parsed = runtime_dns.parse_server_uri(value, true);
        if (parsed.unsupported)
            fail_validation("Invalid Bootstrap DNS server '" + value + "': " + parsed.unsupported);
    }

    let static_hosts = runtime_dns.static_hosts(settings);
    if (static_hosts.unsupported)
        fail_validation("Static DNS records are invalid: " + static_hosts.unsupported);

    if (!bool_option(settings, "dns_detour_enabled", false))
        return;

    let target_name = option(settings, "dns_detour_section", "");
    if (target_name == "")
        fail_validation("DNS through a section is enabled, but no section is selected");

    outbound_section(sections, "DNS through a section", target_name);
}

// config/rule.uc turns these into the CSV the ruleset and the generated config
// are built from, so what it can normalize is exactly what may be accepted.
function validate_port_condition_value(value, section) {
    if (rule_config.normalize_port_condition_value(value) != null)
        return;

    fail_validation("Invalid port condition '" + value + "' in section '" + section_label(section) + "'. Use a single port or range like 80 or 1000-2000");
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

function valid_local_subscription_path(value) {
    value = trim(as_string(value));
    return match(value, /^\/[-a-zA-Z0-9_\/.]+$/) != null;
}

function validate_subscription_source_entry_value(entry, section) {
    if (index(as_string(entry), "|") >= 0)
        fail_validation("Invalid subscription URL in section '" + section_label(section) + "': set the User-Agent in the subscription headers instead");

    if (valid_http_url(entry) || valid_local_subscription_path(entry))
        return;

    fail_validation("Invalid subscription source '" + entry + "' in section '" + section_label(section) + "'. Use an http:// or https:// URL or an absolute local path");
}

function validate_http_url_option(value, label) {
    if (valid_http_url(value))
        return;

    fail_validation("Invalid URL value for " + label + ": " + value + ". Use http:// or https:// URL");
}

function validate_filter_regex_value(value, owner) {
    let problem = as_string(value) == "" ? null : regex_problem(value);
    if (problem != null)
        fail_validation("Invalid regular expression '" + value + "' in " + owner + ": " + problem);
}

function validate_urltest_tolerance_value(value, owner) {
    value = trim(as_string(value));
    if (match(value, /^[0-9]+$/) != null) {
        let parsed = int(value, 10);
        if (parsed >= 0 && parsed <= 10000)
            return;
    }

    fail_validation("Invalid tolerance '" + value + "' of " + owner + ". Use a number from 0 to 10000");
}

function validate_fallback_level_order(value, owner) {
    value = trim(as_string(value));
    if (match(value, /^[0-9]+$/) != null)
        return;

    fail_validation("Invalid order '" + value + "' of " + owner + ". Use a non-negative integer");
}

function expected_status_valid(value) {
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

    fail_validation("Invalid server filter mode '" + value + "' in " + context);
}

function validate_server_filter_regexes(mode, include_regex, exclude_regex, owner) {
    if (mode == "include")
        validate_filter_regex_value(include_regex, owner);
    if (mode == "include" || mode == "exclude")
        validate_filter_regex_value(exclude_regex, owner);
}

function validate_server_filter_types(values, allowed, context) {
    let supported = {};
    for (let value in array_or_empty(allowed))
        supported[value] = true;

    for (let value in array_or_empty(values)) {
        value = trim(as_string(value));
        if (value != "" && !supported[lc(value)])
            fail_validation("Server type '" + value + "' is not available in " + context);
    }
}

function validate_fallback_group(section, group_id) {
    let group_name = trim(connections.fallback_group_display_name(section, group_id));
    if (group_name == "")
        fail_validation("A fallback group in section '" + section_label(section) + "' has no name");

    let group = "fallback group '" + group_name + "' in section '" + section_label(section) + "'";
    let health_check_interval = connections.fallback_group_health_check_interval(section, group_id);
    let idle_timeout = connections.fallback_group_idle_timeout(section, group_id);
    validate_http_url_option(connections.fallback_group_health_check_url(section, group_id), "'Check URL' of " + group);
    validate_required_duration_option(health_check_interval, "'Check interval' of " + group);
    validate_required_duration_option(connections.fallback_group_health_check_timeout(section, group_id), "'Check timeout' of " + group);
    validate_required_duration_option(connections.fallback_group_attempt_timeout(section, group_id), "'Connection timeout' of " + group);
    let expected_status = connections.fallback_group_expected_status(section, group_id);
    if (!expected_status_valid(expected_status))
        fail_validation("Invalid 'Expected status' of " + group + ". Use *, status codes, or ranges such as 204/200-299");
    validate_required_duration_option(idle_timeout, "'Idle timeout' of " + group);
    if (core_common.duration_to_seconds(health_check_interval) > core_common.duration_to_seconds(idle_timeout))
        fail_validation("The check interval of " + group + " is longer than its idle timeout. Increase the idle timeout or shorten the check interval");

    let levels = connections.fallback_levels(group_id);
    if (length(levels) == 0)
        fail_validation("The " + group + " has no server groups. Add at least one server group");

    let level_names = {};
    for (let level_id in levels) {
        let level_name = trim(connections.fallback_level_display_name(group_id, level_id));
        if (level_name == "")
            fail_validation("A server group of " + group + " has no name");
        if (level_names[level_name])
            fail_validation("The " + group + " has more than one server group named '" + level_name + "'");
        level_names[level_name] = true;

        let level = "server group '" + level_name + "' of " + group;
        validate_fallback_level_order(connections.fallback_level_order(group_id, level_id), level);
        let mode = connections.fallback_level_mode(group_id, level_id);
        validate_server_filter_mode(mode, level, true);
        validate_server_filter_regexes(
            mode,
            connections.fallback_level_include_regex(group_id, level_id),
            connections.fallback_level_exclude_regex(group_id, level_id),
            level
        );
        validate_server_filter_types(
            connections.fallback_level_exclude_types(group_id, level_id),
            singbox_constants.FILTERABLE_GROUP_TYPES,
            level
        );
    }
}

// Only a Fallback level can hold another group, and only a URLTest, because a
// nested Fallback adds nothing its parent levels cannot already express. That
// keeps the references one level deep, so a cycle cannot form.
function validate_section_group_references(section) {
    let urltest_names = {};
    for (let urltest_id in connections.urltests(section)) {
        let display_name = trim(as_string(connections.urltest_display_name(section, urltest_id)));
        if (display_name != "")
            urltest_names[display_name] = true;
    }

    for (let group_id in connections.fallback_groups(section))
        for (let level_id in connections.fallback_levels(group_id))
            for (let value in array_or_empty(connections.fallback_level_include_groups(group_id, level_id))) {
                value = trim(as_string(value));
                if (value != "" && !urltest_names[value])
                    fail_validation("Server group '" + connections.fallback_level_display_name(group_id, level_id) + "' of fallback group '" +
                        connections.fallback_group_display_name(section, group_id) + "' in section '" + section_label(section) +
                        "' includes URLTest '" + value + "', which does not exist");
            }
}

function validate_combined_domain_value(value, section) {
    if (as_string(value) == "" || combined_domain_valid(value))
        return;

    fail_validation("Invalid domain condition '" + value + "' in section '" + section_label(section) + "'. Use plain domains or full:, keyword:, regex: prefixes");
}

function validate_combined_domain_text_value(value, section) {
    if (as_string(value) == "" || combined_domain_text_valid(value))
        return;

    fail_validation("Invalid domain conditions in section '" + section_label(section) + "'. Use plain domains or full:, keyword:, regex: prefixes");
}

function validate_service_value(service, context) {
    if (rulesets.is_community(service))
        return;

    fail_validation("Invalid service in community lists: " + service + ". Check config and LuCI cache");
}

function validate_ruleset_reference_value(reference, context) {
    if (ruleset_reference_valid(reference))
        return;

    fail_validation("Unknown rule set reference '" + reference + "'");
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

// A JSON field reaches sing-box as written, and sing-box says in its log what it
// refuses; Forkop needs no more than an object, and the tag it lists it under.
function validate_outbound_json_rule(section) {
    let name = section_name(section);
    let outbound_json = option(section, "outbound_json", "");

    if (outbound_json == "")
        fail_validation("Section '" + section_label(name) + "' has empty outbound_json");

    if (outbound_json_object(outbound_json) == null)
        fail_validation("Section '" + section_label(name) + "' must contain a JSON object");
}

function validate_outbound_json_values(section) {
    let name = section_name(section);
    let values = connections.outbound_jsons(section);
    let require_user_tag = length(list_option(section, "outbound_jsons")) > 0;
    let tags = {};

    for (let value in values) {
        if (as_string(value) == "")
            fail_validation("Section '" + section_label(name) + "' has empty JSON outbound");

        let outbound = outbound_json_object(value);
        if (outbound == null)
            fail_validation("Section '" + section_label(name) + "' has a JSON outbound that is not a JSON object");

        let tag_name = trim(as_string(outbound.tag || ""));
        if (tag_name == "" && require_user_tag)
            fail_validation("Section '" + section_label(name) + "' has JSON outbound without a non-empty tag");
        if (tag_name != "" && tags[tag_name])
            fail_validation("Section '" + section_label(name) + "' has duplicate JSON outbound tag '" + tag_name + "'");
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

function valid_amnezia_uint(value, maximum) {
    value = trim(as_string(value));
    return value != "" && match(value, /^[0-9]+$/) != null && int(value) <= maximum;
}

// AmneziaWG I1-I5 hold a Custom Protocol Signature: a chain of <tag value>
// packets such as <b 0xdeadbeef><r 4>. The core refuses an unknown tag and
// sends nothing at all for a signature without any tag, so neither reaches it.
function valid_amnezia_signature(value) {
    let rest = trim(as_string(value));
    let tags = 0;

    while (true) {
        let start = index(rest, "<");
        if (start < 0)
            break;

        rest = substr(rest, start + 1);
        let end = index(rest, ">");
        if (end < 0)
            return false;

        let parts = split(trim(substr(rest, 0, end)), /[ \t]+/);
        if (!contains(AMNEZIA_SIGNATURE_TAGS, parts[0]))
            return false;

        tags++;
        rest = substr(rest, end + 1);
    }

    return tags > 0;
}

function validate_tunnel_amnezia(endpoint, owner) {
    let amnezia = endpoint.amnezia;
    if (type(amnezia) != "object")
        return;

    for (let key in [ "random_trailers", "disable_cookies" ])
        if (amnezia[key] != null && type(amnezia[key]) != "bool")
            fail_validation(owner + " has an invalid AmneziaWG " + key + " flag");

    for (let key in [ "h1", "h2", "h3", "h4", "content_padding_addition", "rekey_after_time", "rekey_timeout", "reject_after_time", "keepalive_timeout", "max_handshake_attempts" ])
        if (amnezia[key] != null && !valid_amnezia_range(amnezia[key]))
            fail_validation(owner + " has an invalid AmneziaWG " + key + " range. Use values from 0 to 4294967295 with the start no greater than the end");

    for (let key in [ "jc", "jmin", "jmax" ])
        if (amnezia[key] != null && !valid_amnezia_uint(amnezia[key], 4294967295))
            fail_validation(owner + " has an invalid AmneziaWG " + key + " value. Use whole numbers from 0 to 4294967295");

    for (let key in [ "s1", "s2", "s3", "s4" ])
        if (amnezia[key] != null && !valid_amnezia_uint(amnezia[key], 65535))
            fail_validation(owner + " has an invalid AmneziaWG " + key + " value. Use whole numbers from 0 to 65535");

    for (let key in AMNEZIA_SIGNATURE_KEYS)
        if (amnezia[key] != null && trim(as_string(amnezia[key])) != "" &&
            !valid_amnezia_signature(amnezia[key]))
            fail_validation(owner + " has an invalid AmneziaWG " + key + " signature. Use Custom Protocol Signature tags such as <b 0xdeadbeef><r 4>");

    if (amnezia.header_protection_key != null &&
        trim(as_string(amnezia.header_protection_key)) != "" &&
        !valid_wireguard_key(amnezia.header_protection_key))
        fail_validation(owner + " has an invalid AmneziaWG header protection key. Use a standard base64-encoded 32-byte value");

    // The all-zero key disables header protection in wireguard-go.
    let protection_key = trim(as_string(amnezia.header_protection_key));
    if (protection_key != "" && match(protection_key, /^A{43}=$/) == null)
        for (let key in [ "s1", "s2", "s3", "s4" ])
            if (int(amnezia[key] || 0) < 12)
                fail_validation(owner + " requires AmneziaWG " + key + " of at least 12 bytes when header protection is enabled");
}

function validate_tailscale_tunnel_detour(source_name, detour) {
    detour = trim(as_string(detour));
    if (detour == "")
        return;
    if (detour == source_name)
        fail_validation("Section '" + section_label(source_name) + "' cannot carry its own Tailscale control plane");
    outbound_section(sections_by_type("section"), "The Tailscale control plane of section '" + section_label(source_name) + "'", detour);
}

function validate_tunnel_values(section) {
    let name = section_name(section);

    for (let tunnel_id in connections.tunnels(section)) {
        let tunnel = connections.tunnel_child(section, tunnel_id);
        let tunnel_name = trim(as_string(connections.option(tunnel, "name", "")));
        let owner = (tunnel_name != "" ? "Tunnel '" + tunnel_name + "'" : "A tunnel") + " in section '" + section_label(section) + "'";
        let kind = connections.option(tunnel, "kind", "");
        let amnezia_flags = kind == "amneziawg" ? [ "random_trailers", "disable_cookies" ] :
            kind == "wireguard" || kind == "warp" ? [ "disable_cookies" ] : [];
        for (let key in amnezia_flags) {
            let value = trim(as_string(connections.option(tunnel, "amnezia_" + key, "")));
            if (value != "" && value != "0" && value != "1")
                fail_validation(owner + " has an invalid AmneziaWG " + key + " flag. Use 0 or 1");
        }
        let endpoint = connections.tunnel_endpoint(tunnel);
        let endpoint_type = lc(trim(as_string(endpoint.type || "")));
        let wrapper_kind = lc(trim(as_string(connections.option(tunnel, "kind", "wireguard"))));

        if (wrapper_kind == "json") {
            if (type(core_common.parse_json(connections.option(tunnel, "endpoint_json", ""))) != "object")
                fail_validation(owner + " has a JSON endpoint that is not a JSON object");
            if (trim(as_string(endpoint.tag || "")) == "")
                fail_validation(owner + " has a JSON endpoint without a tag");
            continue;
        }

        if (endpoint_type == "" ||
            (endpoint_type != "wireguard" && endpoint_type != "amneziawg" && endpoint_type != "warp" && endpoint_type != "tailscale" && endpoint_type != "openvpn-client"))
            fail_validation(owner + " has an invalid tunnel endpoint");
        if (trim(as_string(connections.option(tunnel, "name", ""))) == "")
            fail_validation("A tunnel in section '" + section_label(section) + "' has no name");

        if (wrapper_kind == "openvpn-client") {
            if (endpoint_type != "openvpn-client" || (trim(as_string(endpoint.server || "")) == "" && length(array_or_empty(endpoint.servers)) == 0))
                fail_validation(owner + " has an incomplete OpenVPN endpoint");
            if (endpoint.server_port != null && (type(endpoint.server_port) != "int" || endpoint.server_port < 1 || endpoint.server_port > 65535))
                fail_validation(owner + " has an invalid OpenVPN server port");
            if (endpoint.mode == "static_key" && ((!endpoint.static_key && !endpoint.static_key_path) || length(array_or_empty(endpoint.address)) == 0))
                fail_validation(owner + ": static OpenVPN requires a key and tunnel addresses");
            continue;
        }

        if (endpoint_type == "tailscale") {
            if (trim(as_string(endpoint.auth_key || "")) == "" ||
                trim(as_string(endpoint.hostname || "")) == "")
                fail_validation(owner + " has an incomplete Tailscale endpoint");
            validate_http_url_option(endpoint.control_url || "https://controlplane.tailscale.com", "the Tailscale control URL of " + owner);
            let detour_section = connections.option(tunnel, "tailscale_detour_section", "");
            validate_tailscale_tunnel_detour(name, detour_section);
            continue;
        }

        validate_tunnel_amnezia(endpoint, owner);

        if (endpoint_type == "warp" && endpoint.persistent_keepalive_interval != null &&
            !valid_amnezia_range(endpoint.persistent_keepalive_interval))
            fail_validation(owner + " has an invalid WARP persistent keepalive interval. Use values from 0 to 4294967295 with the start no greater than the end");

        if (endpoint_type == "warp") {
            if (endpoint.port != null && (endpoint.port < 1 || endpoint.port > 65535))
                fail_validation(owner + " has an invalid WARP server port");
            let profile = object_or_empty(endpoint.profile);
            let profile_values = 0;
            for (let key in [ "id", "auth_token", "private_key" ])
                if (trim(as_string(profile[key] || "")) != "")
                    profile_values++;
            if (profile_values != 3)
                fail_validation(owner + " has an incomplete WARP profile. Generate a profile and fill all profile fields");
            continue;
        }

        let peers = array_or_empty(endpoint.peers);
        if (length(array_or_empty(endpoint.address)) == 0 ||
            trim(as_string(endpoint.private_key || "")) == "" ||
            length(peers) == 0)
            fail_validation(owner + " has an incomplete WireGuard endpoint");

        if (!valid_wireguard_key(endpoint.private_key))
            fail_validation(owner + " has an invalid WireGuard private key. Use standard base64-encoded 32-byte values");

        for (let address in array_or_empty(endpoint.address))
            if (type(address) != "string" || !core_ip.valid_ip_cidr(trim(address)))
                fail_validation(owner + " has an invalid WireGuard address. Use IP addresses with CIDR prefixes");

        for (let peer in peers) {
            peer = object_or_empty(peer);
            let port = int(peer.port || 0);
            if (trim(as_string(peer.address || "")) == "" ||
                trim(as_string(peer.public_key || "")) == "" ||
                port < 1 || port > 65535)
                fail_validation(owner + " has an invalid WireGuard peer");

            if (!valid_wireguard_key(peer.public_key))
                fail_validation(owner + " has an invalid WireGuard peer public key. Use standard base64-encoded 32-byte values");

            if (peer.pre_shared_key != null && trim(as_string(peer.pre_shared_key)) != "" &&
                !valid_wireguard_key(peer.pre_shared_key))
                fail_validation(owner + " has an invalid WireGuard pre-shared key. Use standard base64-encoded 32-byte values");

            if (peer.persistent_keepalive_interval != null &&
                !valid_amnezia_range(peer.persistent_keepalive_interval))
                fail_validation(owner + " has an invalid WireGuard persistent keepalive interval. Use values from 0 to 4294967295 with the start no greater than the end");

            let allowed_ips = peer.allowed_ips;
            if (type(allowed_ips) == "string")
                allowed_ips = [ allowed_ips ];
            if (type(allowed_ips) != "array" || length(allowed_ips) == 0)
                fail_validation(owner + " has a WireGuard peer without AllowedIPs. Add at least one CIDR subnet");
            for (let allowed_ip in allowed_ips)
                if (type(allowed_ip) != "string" || !core_ip.valid_ip_cidr(trim(allowed_ip)))
                    fail_validation(owner + " has an invalid WireGuard AllowedIPs subnet. Use IP addresses with CIDR prefixes");
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
            fail_validation("Server '" + server_label(name) + "' contains invalid JSON inbound");
        }

        if (type(inbound) != "object")
            fail_validation("Server '" + server_label(name) + "' must contain a JSON inbound object");
    }
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
        fail_validation("A subscription in section '" + section_label(section) + "' has invalid " + parsed.message);
}

function validate_subscription_override(section, entry) {
    let settings = connections.subscription_override(section, entry);
    let context = "a subscription in section '" + section_label(section) + "'";

    for (let value in array_or_empty(settings.rename)) {
        let rule = connections.parse_rename_rule(value);
        if (rule == null)
            fail_validation("Rename rule '" + trim(as_string(value)) + "' in " + context +
                " must be written as 'pattern => replacement'");
        if (regex_problem(rule.pattern) != null)
            fail_validation("Invalid rename pattern '" + rule.pattern + "' in " + context);
        // A group reference reaches as far as the letters, digits and
        // underscores behind it, so '$1x' asks for a group named '1x' and
        // leaves the name empty. '${1}' ends the number instead, and '$$' is
        // a literal dollar sign that never starts a reference.
        if (match(replace(rule.target, "$$", ""), /[$][0-9]+[A-Za-z_]/) != null)
            fail_validation("Rename replacement '" + rule.target + "' in " + context +
                " must write '${1}' where a letter follows the group number");
    }

    let patch = trim(as_string(settings.patch));
    if (patch == "")
        return;

    let parsed;
    try {
        parsed = json(patch);
    }
    catch (e) {
        fail_validation("Additional parameters in " + context + " are not valid JSON");
    }
    if (type(parsed) != "object")
        fail_validation("Additional parameters in " + context + " must be a JSON object");
    for (let path in array_or_empty(singbox_constants.RESERVED_OVERRIDE_PATCH_PATHS)) {
        let node = parsed;
        for (let segment in split(path, ".")) {
            if (type(node) != "object") {
                node = null;
                break;
            }
            node = node[segment];
        }
        if (node != null)
            fail_validation("Additional parameters in " + context + " must not set '" + path +
                "': the cascade connection of the section fills it in");
    }
}

function validate_subscription_filter(section, entry) {
    let owner = "a subscription in section '" + section_label(section) + "'";
    let subscription = connections.subscription_url_child(section, entry);
    let mode = option(subscription, "server_filter_mode", "all");
    validate_server_filter_mode(mode, owner, false);
    validate_server_filter_regexes(
        mode,
        option(subscription, "include_regex", ""),
        option(subscription, "exclude_regex", ""),
        owner
    );
    validate_server_filter_types(
        connections.subscription_exclude_types(section, entry),
        singbox_constants.FILTERABLE_PROVIDER_TYPES,
        owner
    );
}

function dns_action_has_domain_matchers(section) {
    for (let key in [ "domain", "domain_suffix", "domain_keyword", "domain_regex" ])
        if (option(section, key, "") != "" || option(section, key + "_text", "") != "" || length(list_option(section, key)) > 0)
            return true;

    return length(connections.community_lists(section)) > 0 ||
        length(connections.rule_sets(section)) > 0;
}

function validate_interface_domain_resolvers(section, sections, context) {
    let name = section_name(section);
    for (let interface_name in connections.interfaces(section)) {
        if (!connections.interface_domain_resolver_enabled(section, interface_name))
            continue;

        let label = "The resolver of interface '" + interface_name + "' in section '" + section_label(section) + "'";
        let strategy = connections.interface_domain_resolver_dns_fallback_strategy(section, interface_name);
        if (!contains([ "sequential", "parallel" ], strategy))
            fail_validation(label + " uses unsupported DNS query mode '" + strategy + "'. Use sequential or parallel");

        for (let value in connections.interface_domain_resolver_dns_servers(section, interface_name)) {
            let parsed = runtime_dns.parse_server_uri(value, false);
            if (parsed.unsupported)
                fail_validation(label + " has an invalid DNS server '" + value + "': " + parsed.unsupported);
        }

        if (!connections.interface_domain_resolver_dns_detour_enabled(section, interface_name))
            continue;

        let target_name = connections.interface_domain_resolver_dns_detour_section(section, interface_name);
        if (target_name == "")
            fail_validation(label + " routes DNS through a section, but no section is selected");
        if (target_name == name)
            fail_validation(label + " cannot send DNS through its own section");

        outbound_section(sections, label, target_name);
    }
}

function validate_dns_action(section, sections, context) {
    let name = section_name(section);
    let fallback_strategy = option(section, "dns_fallback_strategy", "parallel");
    if (!contains([ "sequential", "parallel" ], fallback_strategy))
        fail_validation("Section '" + section_label(name) + "' uses unsupported DNS query mode '" + fallback_strategy + "'. Use sequential or parallel");
    let dns_servers = dns_setting_values(section, "dns_server");
    if (length(dns_servers) == 0)
        fail_validation("Section '" + section_label(name) + "' must contain at least one DNS server");
    for (let dns_server in dns_servers) {
        let parsed = runtime_dns.parse_server_uri(dns_server, false);
        if (parsed.unsupported)
            fail_validation("Section '" + section_label(name) + "' has an invalid DNS server '" + dns_server + "': " + parsed.unsupported);
    }
    if (length(connections.rule_sets_with_subnets(section)) > 0)
        fail_validation("Section '" + section_label(name) + "' can use domain-only rule sets, but subnet extraction is enabled. Disable 'Include IP addresses and subnets'");
    if (!dns_action_has_domain_matchers(section) && length(list_option(section, "fully_routed_ips")) == 0)
        fail_validation("Section '" + section_label(name) + "' must contain at least one domain condition or domain rule set");
    if (!bool_option(section, "dns_detour_enabled", false))
        return;

    let target_name = option(section, "dns_detour_section", "");
    if (target_name == "")
        fail_validation("Section '" + section_label(name) + "' routes DNS through a section, but no section is selected");
    if (target_name == name)
        fail_validation("Section '" + section_label(name) + "' cannot send DNS through itself");

    outbound_section(sections, "Section '" + section_label(name) + "'", target_name);
}

function validate_rule(section, sections, context) {
    if (!section_enabled(section))
        return;

    let name = section_name(section);
    let action = rule_action(section);
    if (action == "")
        fail_validation("Section '" + section_label(name) + "' has no action");
    if (!rule_action_supported(action))
        fail_validation("Section '" + section_label(name) + "' uses unsupported action '" + action + "'");

    if (action != "dns")
        for (let value in list_option(section, "ports"))
            validate_port_condition_value(value, name);

    if (action == "dns")
        validate_dns_action(section, sections, context);

    if (connections.is_connections_action(action)) {
        for (let urltest_id in connections.urltests(section)) {
            let urltest = "URLTest '" + connections.urltest_display_name(section, urltest_id) + "' in section '" + section_label(section) + "'";
            let check_interval = connections.urltest_check_interval(section, urltest_id);
            validate_required_duration_option(check_interval, "'Check interval' of " + urltest);
            validate_urltest_tolerance_value(connections.urltest_tolerance(section, urltest_id), urltest);
            validate_http_url_option(connections.urltest_testing_url(section, urltest_id), "'Check URL' of " + urltest);
            if (!expected_status_valid(connections.urltest_expected_status(section, urltest_id)))
                fail_validation("Invalid 'Expected status' of " + urltest + ". Use *, status codes, or ranges such as 204/200-299");
            let idle_timeout = connections.urltest_idle_timeout(section, urltest_id);
            if (idle_timeout != "")
                validate_required_duration_option(idle_timeout, "'Idle timeout' of " + urltest);
            let effective_idle_timeout = idle_timeout != ""
                ? idle_timeout
                : as_string(singbox_constants.URLTEST_DEFAULT_IDLE_TIMEOUT || "30m");
            if (core_common.duration_to_seconds(check_interval) > core_common.duration_to_seconds(effective_idle_timeout))
                fail_validation("The check interval of " + urltest + " is longer than its idle timeout. Increase the idle timeout or shorten the check interval");

            let filter_mode = connections.urltest_filter_mode(section, urltest_id);
            validate_server_filter_mode(filter_mode, urltest, false);
            validate_server_filter_regexes(
                filter_mode,
                connections.urltest_include_regex(section, urltest_id),
                connections.urltest_exclude_regex(section, urltest_id),
                urltest
            );
            validate_server_filter_types(
                connections.urltest_exclude_types(section, urltest_id),
                singbox_constants.FILTERABLE_GROUP_TYPES,
                urltest
            );
        }

        let fallback_names = {};
        for (let group_id in connections.fallback_groups(section)) {
            let fallback_name = trim(connections.fallback_group_display_name(section, group_id));
            if (fallback_names[fallback_name])
                fail_validation("Section '" + section_label(name) + "' has more than one fallback group named '" + fallback_name + "'");
            fallback_names[fallback_name] = true;
            validate_fallback_group(section, group_id);
        }

        for (let value in connections.subscription_urls(section)) {
            validate_subscription_source_entry_value(value, name);
            validate_subscription_request_profile(section, value);
            validate_subscription_filter(section, value);
            validate_subscription_override(section, value);
            let subscription_update_interval = subscription_update_interval_for_source(section, value);
            if (subscription_update_interval != "")
                validate_required_duration_option(subscription_update_interval, "'Update interval' of a subscription in section '" + section_label(section) + "'");
        }

        validate_section_group_references(section);
        validate_outbound_json_values(section);
        validate_tunnel_values(section);
        validate_interface_domain_resolvers(section, sections, context);
    }

    if (action == "outbound")
        validate_outbound_json_rule(section);

    validate_combined_domain_text_value(option(section, "domain", ""), name);
    for (let value in list_option(section, "domain_suffix"))
        validate_combined_domain_value(value, name);
    validate_combined_domain_text_value(option(section, "domain_suffix_text", ""), name);
    validate_common_rule_references(section, context);
    if (connections.is_connections_action(action) && !connections.has_connection_sources(section))
        core_exec.log("warn", "Section '" + section_label(section) + "' has no servers and is skipped");
}

function validate_subscription_download_sections(sections, context) {
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
                fail_validation("A subscription in section '" + section_label(section) + "' is downloaded through its own section. Select another section or download it directly");

            validate_download_section(sections, target);
        }
    }
}


// The generator owns what a protocol asks a client for; the check reads the same
// tables instead of keeping a second copy that can drift out of step.
const SERVER_CLIENT_FIELDS = runtime_servers.CLIENT_FIELDS;
const SHADOWSOCKS_2022_KEY_BYTES = runtime_servers.SHADOWSOCKS_2022_KEY_BYTES;
const LOGIN_NAME_PROTOCOLS = runtime_servers.LOGIN_NAME_PROTOCOLS;

function base64_decoded_length(value) {
    value = as_string(value);
    if (value == "" || length(value) % 4 != 0 || match(value, /^[A-Za-z0-9+/]+={0,2}$/) == null)
        return -1;

    let padding = 0;
    for (let i = length(value) - 1; i >= 0 && substr(value, i, 1) == "="; i--)
        padding++;
    return (length(value) / 4) * 3 - padding;
}

// The clients of one server: a name every client can carry, credentials the protocol
// can use, and at least one enabled account so the inbound accepts somebody.
function validate_server_clients(server, protocol, name) {
    let fields = SERVER_CLIENT_FIELDS[protocol];
    if (fields == null || length(fields) == 0)
        return;

    let auth_required = protocol != "mixed" || bool_option(server, "mixed_auth_enabled", true);

    if (!auth_required)
        return;

    let clients = connections.server_clients(server);
    if (length(clients) == 0)
        fail_validation("Server '" + server_label(name) + "' has no clients. Add at least one client");

    let key_bytes = protocol == "shadowsocks"
        ? SHADOWSOCKS_2022_KEY_BYTES[option(server, "shadowsocks_method", "")]
        : null;
    let seen = {};

    for (let client in clients) {
        let client_name = trim(option(client, "name", ""));
        if (client_name == "")
            fail_validation("Server '" + server_label(name) + "' has a client without a name");
        if (seen[lc(client_name)])
            fail_validation("Server '" + server_label(name) + "' has more than one client named '" + client_name + "'");
        seen[lc(client_name)] = true;
        if (LOGIN_NAME_PROTOCOLS[protocol] && match(client_name, /^[A-Za-z0-9._-]+$/) == null)
            fail_validation("Server '" + server_label(name) + "' client '" + client_name + "' is used as an account name and must contain only letters, digits, dots, underscores or hyphens");

        for (let field in fields) {
            let value = option(client, field, "");
            if (field == "password" && !auth_required)
                continue;
            if (value == "")
                fail_validation("Server '" + server_label(name) + "' client '" + client_name + "' has no " + field);
            if (field == "uuid" && match(value, /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/) == null)
                fail_validation("Server '" + server_label(name) + "' client '" + client_name + "' has an invalid UUID");
            if (field == "secret" && match(lc(value), /^[0-9a-f]{32}$/) == null)
                fail_validation("Server '" + server_label(name) + "' client '" + client_name + "' needs a 32 hex character secret");
            if (field == "password" && key_bytes != null && base64_decoded_length(value) != key_bytes)
                fail_validation("Server '" + server_label(name) + "' client '" + client_name + "' needs a base64 pre-shared key of " + key_bytes + " bytes for method '" + option(server, "shadowsocks_method", "") + "'");
        }

        // A client that takes its own route needs a mode the generator can turn into a
        // rule, and a section that is still there.
        if (!bool_option(client, "routing_override", false))
            continue;

        let client_mode = option(client, "routing_mode", "");
        if (client_mode != "rules" && client_mode != "direct" && client_mode != "section")
            fail_validation("Server '" + server_label(name) + "' client '" + client_name + "' has an unsupported routing mode '" + client_mode + "'");
        if (client_mode == "section" && option(client, "routing_section", "") == "")
            fail_validation("Server '" + server_label(name) + "' client '" + client_name + "' has no routing section selected");
        if (client_mode == "section")
            outbound_section(sections_by_type("section"), "Server '" + server_label(name) + "' client '" + client_name + "'", option(client, "routing_section", ""));
    }

    if (key_bytes != null && base64_decoded_length(option(server, "shadowsocks_psk", "")) != key_bytes)
        fail_validation("Server '" + server_label(name) + "' needs a base64 server pre-shared key of " + key_bytes + " bytes for method '" + option(server, "shadowsocks_method", "") + "'");
}

// sing-box binds every inbound itself, so two listeners on one port stop the whole
// service. Reporting the pair here keeps a bad apply from taking the router offline.
// Ports are owned per transport: TCP 443 and UDP 443 are two sockets.
function validate_server_listen_ports() {
    let owners = {};

    for (let port in [
        as_string(singbox_constants.TPROXY_INBOUND_PORT),
        as_string(singbox_constants.SOURCE_DNS_INBOUND_PORT),
        as_string(singbox_constants.SYSTEM_TPROXY_INBOUND_PORT),
        as_string(singbox_constants.SYSTEM_DNS_INBOUND_PORT),
        as_string(singbox_constants.DNS_INBOUND_PORT),
        as_string(singbox_constants.SERVICE_MIXED_INBOUND_PORT),
        as_string(singbox_constants.COMPONENTS_MIXED_INBOUND_PORT),
        as_string(singbox_constants.WARP_PROFILES_MIXED_INBOUND_PORT),
        as_string(singbox_constants.CLASH_API_CONTROLLER_PORT)
    ])
        owners["tcp/" + port] = owners["udp/" + port] = "a Forkop inbound";

    if (bool_option(settings_section(), "enable_native_api", false))
        owners["tcp/9091"] = "the sing-box API";

    for (let server in sections_by_type("server")) {
        server = object_or_empty(server);
        let protocol = option(server, "protocol", "vless");
        if (!server_enabled(server) || protocol == "tailscale")
            continue;

        let name = section_name(server);
        let port, transports;
        if (protocol == "json_inbound") {
            let inbound = core_common.parse_json(option(server, "inbound_json", ""));
            if (type(inbound?.listen_port) != "int")
                continue;
            port = inbound.listen_port;
            transports = runtime_servers.transports(inbound.type, inbound.network);
        }
        else {
            let text = option(server, "listen_port", "");
            if (match(text, /^[0-9]+$/) == null || int(text, 10) < 1 || int(text, 10) > 65535)
                fail_validation("Server '" + server_label(name) + "' has an invalid listen port '" + text + "'");
            port = int(text, 10);
            transports = runtime_servers.listen_transports(server);
        }
        for (let transport in transports)
            if (owners[transport + "/" + port] != null)
                fail_validation("Server '" + server_label(name) + "' listens on " + transport + " port " + port + ", which is already used by " +
                    owners[transport + "/" + port]);
        for (let transport in transports)
            owners[transport + "/" + port] = "server '" + server_label(name) + "'";
    }
}

// Security material a protocol cannot start without. Forkop never sets the inbound
// insecure flag, which is the only thing that would let sing-box invent a keypair
// per handshake, so a missing certificate is a start-up failure and not a default.
function validate_server_security(server, protocol, name) {
    let security = runtime_servers.effective_security(server, protocol);

    // An SSH inbound with no host key gets a fresh one from sing-box on every start,
    // so every client meets a changed fingerprint after every reload. The dialog asks
    // for a path and its button fills it in.
    if (protocol == "ssh" && length(list_option(server, "ssh_host_key_path")) == 0)
        fail_validation("Server '" + server_label(name) + "' has no ssh_host_key_path. Generate a host key or point at your own");

    // TLS needs a certificate, and Forkop no longer invents a path for one: the
    // dialog asks for both and its button fills them in.
    if (security == "tls") {
        for (let field in [ "tls_certificate_path", "tls_key_path" ])
            if (option(server, field, "") == "")
                fail_validation("Server '" + server_label(name) + "' has no " + field + ". Generate a certificate or point at your own");
    }

    // A FakeTLS host is what makes an MTProto secret: the proxy refuses a secret
    // whose first byte is not 0xee and whose host is empty.
    if (protocol == "mtproto" && option(server, "mtproto_faketls", "") == "")
        fail_validation("Server '" + server_label(name) + "' needs a FakeTLS host: MTProto has no secret without one");

    if (security == "reality") {
        // One name for both: the generator borrows the handshake from the site the
        // SNI names, so this is also the check on the handshake target.
        if (option(server, "tls_server_name", "") == "")
            fail_validation("Server '" + server_label(name) + "' uses Reality and needs an SNI");
        for (let field in [ "reality_private_key", "reality_public_key" ]) {
            let key = option(server, field, "");
            if (key == "")
                fail_validation("Server '" + server_label(name) + "' has no " + field + ". Generate a Reality key pair");
            if (match(key, /^[A-Za-z0-9_-]{43}$/) == null)
                fail_validation("Server '" + server_label(name) + "' has an invalid " + field);
        }
        let short_ids = list_option(server, "reality_short_id");
        if (length(short_ids) == 0)
            fail_validation("Server '" + server_label(name) + "' uses Reality and needs a short ID");
        for (let short_id in short_ids) {
            short_id = as_string(short_id);
            if (match(short_id, /^([0-9a-fA-F]{2})+$/) == null)
                fail_validation("Server '" + server_label(name) + "' short ID '" + short_id + "' must use an even number of hex digits");
            if (length(short_id) > 16)
                fail_validation("Server '" + server_label(name) + "' short ID '" + short_id + "' is longer than 16 hex digits");
        }
    }
    else if (security == "tls") {
        let certificate = option(server, "tls_certificate_path", "");
        let key = option(server, "tls_key_path", "");
        if ((certificate == "") != (key == ""))
            fail_validation("Server '" + server_label(name) + "' needs both a certificate path and a key path, or neither");
        if (certificate != "" && certificate == key)
            fail_validation("Server '" + server_label(name) + "' uses the same file as its certificate and its key");
    }

    if (protocol == "hysteria2" && option(server, "hysteria2_obfs_type", "") != "" &&
        option(server, "hysteria2_obfs_password", "") == "")
        fail_validation("Server '" + server_label(name) + "' enables obfuscation and needs an obfuscation password");

    // A multiplexed VLESS client drops the flow before it authenticates, and the
    // inbound then refuses the account with a flow mismatch, so the pair cannot
    // connect at all. The dialog hides the field; a hand written config is named here.
    if (protocol == "vless" && bool_option(server, "multiplex_enabled", false))
        for (let client in connections.server_clients(server)) {
            let flow = option(client, "flow", "");
            if (flow != "" && flow != "none")
                fail_validation("Server '" + server_label(name) + "' client '" + option(client, "name", "") +
                    "' uses flow '" + flow + "' together with multiplex, which no client can connect with");
        }
}

// Values with a closed set the core refuses outright. The dialog offers a list for
// every one of them, so this only catches a configuration written straight through
// uci - but the core refuses these while it builds the listener, which takes the
// whole service down instead of only that server. Each entry was checked against
// `sing-box check` on a listener carrying exactly that value.
const SERVER_ENUMS = [
    [ "listen", "transport", [ "", "tcp", "raw", "ws", "grpc", "http", "httpupgrade", "xhttp" ] ],
    [ "xhttp", "transport_xhttp_mode", [ "", "auto", "packet-up", "stream-up", "stream-one" ] ],
    [ "shadowsocks", "shadowsocks_method", [ "2022-blake3-aes-128-gcm", "2022-blake3-aes-256-gcm",
        "2022-blake3-chacha20-poly1305", "aes-128-gcm", "aes-192-gcm", "aes-256-gcm",
        "chacha20-ietf-poly1305", "xchacha20-ietf-poly1305", "none" ] ],
    [ "mieru", "mieru_transport", [ "TCP", "UDP" ] ],
    [ "naive", "naive_network", [ "", "tcp", "udp", "tcp_udp" ] ],
    [ "tuic", "tuic_congestion_control", [ "", "cubic", "new_reno", "bbr" ] ],
    [ "hysteria2", "hysteria2_obfs_type", [ "", "salamander", "gecko" ] ],
    [ "hysteria2", "hysteria2_bbr_profile", [ "", "standard", "conservative", "aggressive" ] ]
];

function server_enum_applies(scope, protocol, server) {
    if (scope == "listen")
        return runtime_servers.CLIENT_FIELDS[protocol] != null &&
            protocol != "tailscale" && protocol != "json_inbound";
    if (scope == "xhttp")
        return option(server, "transport", "") == "xhttp";
    return scope == protocol;
}

// The files a listener opens while it starts. Forkop writes the ones in its own
// directories before this runs, so a path with nothing behind it is a path the user
// chose and mistyped, and the core dies on it with the service half up.
function validate_server_files(server, protocol, security, name) {
    let paths = [];
    if (security == "tls")
        for (let field in [ "tls_certificate_path", "tls_key_path" ])
            push(paths, [ field, option(server, field, "") ]);
    if (protocol == "ssh")
        for (let path in list_option(server, "ssh_host_key_path"))
            push(paths, [ "ssh_host_key_path", as_string(path) ]);

    for (let entry in paths) {
        if (entry[1] == "")
            continue;
        let stat = fs.stat(entry[1]);
        if (type(stat) != "object" || stat.type != "file" || stat.size == 0)
            fail_validation("Server '" + server_label(name) + "' " + entry[0] + " '" + entry[1] +
                "' does not exist. Point at a file that is there");
    }
}

// Everything else the core parses out of a server option and refuses on its own: a
// listen address that is not an address, a duration it cannot read and a masquerade
// URL whose scheme it does not know.
function validate_server_values(server, protocol, security, name) {
    for (let entry in SERVER_ENUMS) {
        if (!server_enum_applies(entry[0], protocol, server))
            continue;
        let value = option(server, entry[1], "");
        if (!contains(entry[2], value))
            fail_validation("Server '" + server_label(name) + "' has an unsupported " + entry[1] +
                " '" + value + "'");
    }

    if (runtime_servers.CLIENT_FIELDS[protocol] != null && protocol != "tailscale" &&
        protocol != "json_inbound") {
        let listen = option(server, "listen", "::");
        if (!core_ip.valid_ip(listen))
            fail_validation("Server '" + server_label(name) + "' listens on '" + listen +
                "', which is not an IP address");
    }

    if (protocol == "tailscale")
        for (let route in list_option(server, "tailscale_advertise_routes"))
            if (!core_ip.valid_ip_or_cidr(route))
                fail_validation("Tailscale server '" + server_label(name) + "' advertises '" + route + "', which is not an address or a subnet");

    if (protocol == "tuic") {
        let heartbeat = option(server, "tuic_heartbeat", "");
        if (heartbeat != "")
            validate_duration_option(heartbeat, "Server '" + server_label(name) + "' heartbeat");
    }

    if (protocol == "hysteria2") {
        if (option(server, "hysteria2_obfs_type", "") == "gecko") {
            let minimum = option(server, "hysteria2_gecko_min_packet_size", "");
            let maximum = option(server, "hysteria2_gecko_max_packet_size", "");
            for (let value in [ minimum, maximum ])
                if (value != "" && (match(value, /^[0-9]+$/) == null || int(value) < 1 || int(value) > 65535))
                    fail_validation("Server '" + server_label(name) + "' has an invalid Gecko packet size");
            if (minimum != "" && maximum != "" && int(minimum) > int(maximum))
                fail_validation("Server '" + server_label(name) + "' Gecko minimum packet size exceeds the maximum");
        }
        // sing-box reads a masquerade as a URL and picks the mode from its scheme, so
        // anything but those three stops the listener before it binds.
        let masquerade = option(server, "hysteria2_masquerade", "");
        if (masquerade != "" && match(masquerade, /^(https?|file):\/\//) == null)
            fail_validation("Server '" + server_label(name) + "' masquerade '" + masquerade +
                "' must start with https://, http:// or file://");
        for (let field in [ "hysteria2_up_mbps", "hysteria2_down_mbps" ]) {
            let value = option(server, field, "");
            if (value != "" && match(value, /^[0-9]+$/) == null)
                fail_validation("Server '" + server_label(name) + "' " + field + " '" + value +
                    "' must be a whole number of megabits");
        }
    }

    validate_server_files(server, protocol, security, name);
}

function validate_server_clients_and_ports() {
    validate_server_listen_ports();

    for (let server in sections_by_type("server")) {
        server = object_or_empty(server);
        if (!server_enabled(server))
            continue;

        let protocol = option(server, "protocol", "vless");
        if (SERVER_CLIENT_FIELDS[protocol] == null)
            fail_validation("Server '" + server_label(server) + "' uses unsupported protocol '" + protocol + "'");

        validate_server_clients(server, protocol, section_name(server));
        validate_server_security(server, protocol, section_name(server));
        validate_server_values(server, protocol,
            runtime_servers.effective_security(server, protocol), section_name(server));
    }
}

function validate_server_routing_sections(sections) {
    for (let server in sections_by_type("server")) {
        server = object_or_empty(server);
        if (!server_enabled(server))
            continue;

        let name = section_name(server);
        if (option(server, "protocol", "") == "tailscale" &&
            bool_option(server, "tailscale_detour_enabled", false)) {
            let detour_name = option(server, "tailscale_detour_section", "");
            if (detour_name == "")
                fail_validation("Tailscale server '" + server_label(name) + "' has no control-plane section selected");
            if (detour_name == name)
                fail_validation("Tailscale server '" + server_label(name) + "' cannot use itself for the control plane");
            outbound_section(sections, "The control plane of Tailscale server '" + server_label(name) + "'", detour_name);
        }
        let mode = option(server, "routing_mode", "rules");
        if (!contains([ "rules", "direct", "section" ], mode))
            fail_validation("Server '" + server_label(name) + "' uses unsupported routing mode '" + mode + "'");

        if (mode != "section")
            continue;

        let target_name = option(server, "routing_section", "");
        if (target_name == "")
            fail_validation("Server '" + server_label(name) + "' uses selected-section routing, but no routing section is selected");

        outbound_section(sections, "Server '" + server_label(name) + "'", target_name);
    }
}

function validate_native_rule_set_update_settings(settings) {
    if (!bool_option(settings, "list_update_enabled", true))
        return;

    let update_interval = option(settings, "update_interval", "1d");
    if (update_interval == "")
        update_interval = "1d";
    validate_required_duration_option(update_interval, "'List update interval' in Settings");
}

function validate_runtime_mark_ranges_context(context) {
    let fakeip_mark = parse_number(context.nft_fakeip_mark);
    let outbound_mark = parse_number(context.nft_outbound_mark);

    if (fakeip_mark == null || outbound_mark == null)
        fail_validation("Forkop marks contain invalid numeric constants");
    if ((fakeip_mark & TAILSCALE_FWMARK_MASK) != 0)
        fail_validation("FakeIP mark overlaps Tailscale fwmark mask 0x00ff0000");
    if ((outbound_mark & TAILSCALE_FWMARK_MASK) != 0)
        fail_validation("Outbound mark overlaps Tailscale fwmark mask 0x00ff0000");
    if (fakeip_mark == outbound_mark)
        fail_validation("FakeIP mark and outbound mark are the same value");
}

function refuse_without(feature, core_tags, what) {
    let reason = features.unavailable_reason(feature, core_tags);
    if (reason != "")
        fail_validation(what + ", but " + reason + ". Disable it or install a sing-box build that has it");
}

function server_core_type(protocol) {
    return protocol == "mtproto" ? "mtproxy" : protocol;
}

// What the configuration asks of the core that only some builds have. The core
// refuses to start on a static server, tunnel, link or DNS server of a type it
// was built without, so each is refused here by name, with the tags it needs.
// A subscription's servers are not: the core skips one it cannot build and logs
// which tag it lacks.
function validate_core_features(settings, sections, servers, core_tags) {
    for (let server in servers) {
        if (!server_enabled(server))
            continue;
        let name = section_name(server);
        let protocol = option(server, "protocol", "vless");
        let feature = protocol == "tailscale" ? features.type_feature("endpoint", "tailscale")
            : features.type_feature("inbound", server_core_type(protocol));
        if (feature != "")
            refuse_without(feature, core_tags, "Server '" + server_label(name) + "' uses " + protocol);
        if (runtime_servers.effective_security(server, protocol) == "reality")
            refuse_without("utls", core_tags, "Server '" + server_label(name) + "' uses Reality");
        if (protocol == "naive" && contains([ "udp", "tcp_udp" ], option(server, "naive_network", "tcp")))
            refuse_without("quic", core_tags, "Server '" + server_label(name) + "' serves NaiveProxy over QUIC");
    }

    for (let section in sections) {
        if (!section_enabled(section) || !connections.is_connections_action(rule_action(section)))
            continue;
        let name = section_name(section);
        for (let tunnel_id in connections.tunnels(section)) {
            let tunnel = connections.tunnel_child(section, tunnel_id);
            let kind = lc(trim(as_string(connections.option(tunnel, "kind", "wireguard"))));
            let feature = kind == "json" ? "" : features.type_feature("endpoint", kind);
            if (feature != "")
                refuse_without(feature, core_tags, "Section '" + name + "' has a " + kind + " tunnel '" +
                    trim(as_string(connections.option(tunnel, "name", tunnel_id))) + "'");
        }
        for (let link in connections.connection_urls(section)) {
            let label = core_url.scheme(link) + ":// link" + (core_url.fragment(link) != "" ? " '" + core_url.fragment(link) + "'" : "");
            for (let feature in features.link_features(link))
                refuse_without(feature, core_tags, "Section '" + name + "' has a " + label +
                    (feature == "utls" ? " that uses Reality or a TLS fingerprint" : ""));
        }
    }

    let dns_servers = [ ...dns_setting_values(settings, "dns_server"), ...dns_setting_values(settings, "bootstrap_dns_server") ];
    for (let section in sections) {
        if (!section_enabled(section))
            continue;
        if (rule_action(section) == "dns")
            push(dns_servers, ...dns_setting_values(section, "dns_server"));
        if (!connections.is_connections_action(rule_action(section)))
            continue;
        for (let interface_name in connections.interfaces(section))
            if (connections.interface_domain_resolver_enabled(section, interface_name))
                push(dns_servers, ...connections.interface_domain_resolver_dns_servers(section, interface_name));
    }
    for (let value in dns_servers) {
        let parsed = runtime_dns.parse_server_uri(value, false);
        if (parsed.type == "quic" || parsed.type == "h3")
            refuse_without("quic", core_tags, "DNS server '" + value + "' uses " + (parsed.type == "quic" ? "DNS over QUIC" : "DNS over HTTP/3"));
    }

    if (bool_option(settings, "enable_native_api", false))
        refuse_without("api", core_tags, "The sing-box Dashboard and API setting is on");
    if (connections.download_via_proxy_enabled(settings, "warp_profiles"))
        refuse_without("wireguard", core_tags, "Requesting WARP profiles through a section is on");
}

function validate_runtime_config(context) {
    let settings = settings_section();
    let sections = sections_by_type("section");
    let servers = sections_by_type("server");

    let display_names = {};
    validate_runtime_display_names(sections, "Section", display_names);
    validate_runtime_display_names(servers, "Server", display_names);
    if (context.core_tags != null)
        validate_core_features(settings, sections, servers, context.core_tags);
    validate_runtime_mark_ranges_context(context);
    validate_dns_settings(settings, sections, context);
    validate_native_rule_set_update_settings(settings);
    if (bool_option(settings, "enable_native_api", false) && option(settings, "native_api_secret", "") == "")
        fail_validation("The sing-box API is enabled, but 'API secret' in Settings is empty");
    validate_http_url_option(option(settings, "latency_test_url", DEFAULT_LATENCY_TEST_URL) || DEFAULT_LATENCY_TEST_URL, "'Latency test URL' in Settings");

    for (let purpose in [ "lists", "components", "warp_profiles" ])
        if (connections.download_via_proxy_enabled(settings, purpose))
            validate_download_section(sections, connections.download_via_proxy_section(settings, purpose));
    if (connections.download_via_proxy_enabled(settings, "warp_profiles"))
        validate_warp_profile_section(connections.download_via_proxy_section(settings, "warp_profiles"));

    validate_outbound_detours(sections);
    validate_subscription_download_sections(sections, context);
    validate_json_inbound_values();
    validate_server_routing_sections(sections);
    validate_server_clients_and_ports();

    for (let section in sections) {
        validate_subscription_tags(section);
        validate_rule(section, sections, context);
    }
}

function context_from_runtime() {
    return {
        nft_fakeip_mark: as_string(constants.NFT_FAKEIP_MARK),
        nft_outbound_mark: as_string(constants.NFT_OUTBOUND_MARK),
        sing_box_required_version: as_string(constants.SB_REQUIRED_VERSION),
        // Unknown without a core to ask, which the requirement check refuses first.
        core_tags: features.tags()
    };
}

function service_exists(service) {
    return file_executable("/etc/init.d/" + as_string(service));
}

// Only a Connection section builds outbounds from its sources; one whose action
// changed keeps them in the configuration without the runtime using them.
function has_outbound_section() {
    for (let section in sections_by_type("section"))
        if (section_enabled(section) && connections.is_connections_action(rule_action(section)) &&
            connections.has_connection_sources(section))
            return true;
    return false;
}

// Whether the installed system can run Forkop at all. Throws with the reason.
function check_requirements() {
    let ctx = context_from_runtime();
    let sing_box_version = packages.sing_box_version();

    if (!command_exists("sing-box"))
        die("Binary 'sing-box' is not available. Reinstall sing-box-forkop");
    if (sing_box_version == "")
        die("Failed to read sing-box-forkop version. Reinstall sing-box-forkop");
    else if (!core_version.version_at_least(sing_box_version, ctx.sing_box_required_version))
        die("Package 'sing-box-forkop' version (" + sing_box_version + ") is lower than the required minimum (" + ctx.sing_box_required_version + "). Update it from Forkop Components");

    if (ctx.core_tags == null)
        die("Failed to read the tags sing-box was built with from 'sing-box version'. Reinstall sing-box-forkop");
    else if (!features.available(features.REQUIRED, ctx.core_tags))
        die("sing-box was built without with_clash_api. Forkop runs its dashboard, groups, latency tests and subnet sync through the Clash API and cannot start without it. Install a sing-box-forkop package or a core built with with_clash_api");

    if (!service_exists("sing-box"))
        die("Service 'sing-box' is missing. Reinstall sing-box-forkop");

    if (dhcp_has_https_dns_proxy_options("/etc/config/dhcp") === true)
        core_exec.log("warn", "https-dns-proxy is configured in /etc/config/dhcp, and Forkop conflicts with it. Remove https-dns-proxy or its settings in /etc/config/dhcp");

    connections.load();
    if (!has_outbound_section())
        core_exec.log("warn", "No enabled Connection section has servers, so no traffic is proxied");
}

// Refuses a configuration sing-box could not run, by throwing the reason. The
// overrides replace values of the runtime context, for a check about them.
function validate(overrides) {
    connections.load();
    validate_runtime_config({ ...context_from_runtime(), ...object_or_empty(overrides) });
}

return { validate, check_requirements, has_outbound_section };
