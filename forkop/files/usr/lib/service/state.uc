#!/usr/bin/env ucode

let health = require("service.health");
const HEALTH_MODE = ARGV[0] || "";

if (HEALTH_MODE == "sing-box-service-runtime-pid") {
    let pid = health.sing_box_service_pid_runtime();
    if (pid <= 0)
        exit(1);
    print(pid, "\n");
    exit(0);
}
else if (HEALTH_MODE == "sing-box-service-running")
    exit(health.sing_box_service_running() ? 0 : 1);
else if (HEALTH_MODE == "sing-box-service-stable")
    exit(health.sing_box_service_stable(ARGV[1]) ? 0 : 1);
else if (HEALTH_MODE == "forkop-running")
    exit(health.forkop_running(ARGV[1], ARGV[2], ARGV[3]) ? 0 : 1);
else if (HEALTH_MODE == "forkop-stably-running")
    exit(health.forkop_stably_running(ARGV[1], ARGV[2], ARGV[3], ARGV[4]) ? 0 : 1);

let fs = require("fs");
let core_common = require("core.common");
let uci_core = require("core.uci");
let rule_config = require("config.rule");
let connections = require("config.connections");
let zapret_validator = require("providers.zapret.validator");
let zapret2_validator = require("providers.zapret2.validator");
let byedpi_validator = require("providers.byedpi.validator");
const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || "forkop";
const DEFAULT_PENDING_RELOAD_FILE = getenv("FORKOP_PENDING_RELOAD_FILE") || "/var/run/forkop/reload.pending";
const DEFAULT_SERVICE_INIT = getenv("FORKOP_SERVICE_INIT") || "/etc/init.d/forkop";
const SING_BOX_INIT = getenv("FORKOP_SING_BOX_INIT") || "/etc/init.d/sing-box";
const ZAPRET_DEFAULT_NFQWS_OPT = getenv("ZAPRET_DEFAULT_NFQWS_OPT") || "";
const ZAPRET2_DEFAULT_NFQWS2_OPT = getenv("ZAPRET2_DEFAULT_NFQWS2_OPT") || "";
const BYEDPI_DEFAULT_CMD_OPTS = getenv("BYEDPI_DEFAULT_CMD_OPTS") || "";
const SING_BOX_START_MAX_WAIT_SECONDS = int(getenv("FORKOP_SING_BOX_START_MAX_WAIT_SECONDS") || "300");
const RUNTIME_DIR_LOCK_OWNER_GRACE = int(getenv("FORKOP_RUNTIME_DIR_LOCK_OWNER_GRACE") || "30");

let sing_box_service_pid_from_value = health.sing_box_service_pid_from_value;
let sing_box_service_pid_runtime = health.sing_box_service_pid_runtime;
let pid_is_sing_box = health.pid_is_sing_box;
let process_start_ticks = health.process_start_ticks;
let process_age_seconds_from_ticks = health.process_age_seconds_from_ticks;
let process_age_seconds = health.process_age_seconds;
let sing_box_service_running = health.sing_box_service_running;
let sing_box_service_stable = health.sing_box_service_stable;
let sing_box_runtime_ports_ready = health.sing_box_runtime_ports_ready;
let forkop_runtime_network_configured = health.forkop_runtime_network_configured;
let forkop_running = health.forkop_running;
let forkop_stably_running = health.forkop_stably_running;

function as_string(value) {
    return value == null ? "" : "" + value;
}

function read_json_file(path) {
    let data = fs.readfile(path);
    if (data == null)
        return null;

    try {
        return json(data);
    }
    catch (e) {
        return null;
    }
}

function write_text_file(path, text) {
    let result = fs.writefile(path, as_string(text));
    if (result == null)
        return false;
    if (type(result) == "boolean" && !result)
        return false;
    return true;
}

function unlink_file(path) {
    try {
        fs.unlink(as_string(path));
    }
    catch (e) {
    }
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

function command_output_from_args(args) {
    let pipe = fs.popen(command_from_args(args), "r");
    if (!pipe)
        return "";

    let data = pipe.read("all");
    let status = pipe.close();
    if (status != 0 || data == null)
        return "";

    return as_string(data);
}

function command_trimmed_output_from_args(args) {
    return replace(command_output_from_args(args), /[\r\n]+$/g, "");
}

function command_success_from_args(args) {
    return system(command_from_args(args) + " >/dev/null 2>&1") == 0;
}

function uci_get(path) {
    return uci_core.get(path);
}

function uci_exists(path) {
    return uci_core.exists(path);
}

function object_or_empty(value) {
    return type(value) == "object" ? value : {};
}

function read_state_value(path, needle) {
    let data = fs.readfile(path);
    if (data == null)
        exit(1);

    needle = as_string(needle);
    for (let line in split(data, "\n")) {
        let equals = index(line, "=");
        let key = equals >= 0 ? substr(line, 0, equals) : line;
        if (key == needle) {
            print(equals >= 0 ? substr(line, equals + 1) : line, "\n");
            return;
        }
    }
}

const RELOAD_STATE_FIELDS = [
    "format",
    "service_trigger_signature",
    "dnsmasq_signature",
    "sing_box_signature",
    "nft_signature",
    "zapret_queue_signature",
    "zapret_runtime_signature",
    "zapret2_queue_signature",
    "zapret2_runtime_signature",
    "byedpi_runtime_signature",
    "cron_signature",
    "dont_touch_dhcp"
];

function reload_state_text(values) {
    let output = "";
    values = object_or_empty(values);

    for (let field in RELOAD_STATE_FIELDS)
        output += field + "=" + as_string(values[field]) + "\n";

    return output;
}

function parent_dir(path) {
    path = as_string(path);
    let slash = rindex(path, "/");
    if (slash < 0)
        return "";
    return substr(path, 0, slash);
}

function ensure_parent_dir(path) {
    let dir = parent_dir(path);
    if (dir == "" || dir == ".")
        return true;
    return command_success_from_args([ "mkdir", "-p", dir ]);
}

function numeric_text(value) {
    return match(as_string(value), /^[0-9]+$/) != null;
}

function current_epoch() {
    let value = command_trimmed_output_from_args([ "date", "+%s" ]);
    return numeric_text(value) ? value : "0";
}

function current_year() {
    let value = command_trimmed_output_from_args([ "date", "+%Y" ]);
    return numeric_text(value) ? int(value) : null;
}

function time_sync_needed(year) {
    if (year == null)
        return false;
    return int(year) < 2024;
}

function sync_time_if_needed() {
    if (!time_sync_needed(current_year()))
        return;

    command_success_from_args([
        "/usr/sbin/ntpd",
        "-q",
        "-p", "194.190.168.1",
        "-p", "216.239.35.0",
        "-p", "216.239.35.4",
        "-p", "162.159.200.1",
        "-p", "162.159.200.123"
    ]);
}

function mark_pending_reload(path, reason) {
    path = as_string(path || DEFAULT_PENDING_RELOAD_FILE);
    reason = as_string(reason || "pending");

    if (!ensure_parent_dir(path))
        exit(1);

    if (!write_text_file(path, "reason=" + reason + "\nupdated_at=" + current_epoch() + "\n"))
        exit(1);
}

function consume_pending_reload(path) {
    path = as_string(path || DEFAULT_PENDING_RELOAD_FILE);
    if (fs.stat(path) == null)
        return false;

    unlink_file(path);
    return true;
}

function run_pending_reload_if_requested(path, init_script) {
    path = as_string(path || DEFAULT_PENDING_RELOAD_FILE);
    init_script = as_string(init_script || DEFAULT_SERVICE_INIT);

    if (!consume_pending_reload(path))
        return;

    command_success_from_args([ "logger", "-t", "forkop", "[info] Applying pending Forkop reload" ]);
    system(shell_quote(init_script) + " reload pending >/dev/null 2>&1 1000>&- &");
}

function first_line_value(path) {
    let data = fs.readfile(path);
    if (data == null)
        return "";

    let newline = index(data, "\n");
    return newline >= 0 ? substr(data, 0, newline) : data;
}

function pid_alive(pid) {
    pid = as_string(pid);
    return match(pid, /^[0-9]+$/) != null && command_success_from_args([ "kill", "-0", pid ]);
}

function lock_dir_write_owner(lock_dir, owner_pid) {
    return write_text_file(as_string(lock_dir) + "/pid", as_string(owner_pid) + "\n");
}

// True while another process owns the lock. mkdir() and writing the owner pid
// are separate operations, so a freshly created lock gets time to receive its
// owner before an empty pid counts as stale; otherwise two simultaneous
// service actions can both proceed.
function runtime_dir_lock_held(lock_dir) {
    lock_dir = as_string(lock_dir);
    let lock_stat = lock_dir == "" ? null : fs.stat(lock_dir);
    if (lock_stat == null)
        return false;

    let current_owner = first_line_value(lock_dir + "/pid");
    if (pid_alive(current_owner))
        return true;
    if (current_owner != "")
        return false;

    let lock_age = (int(current_epoch(), 10) || 0) - int(lock_stat.mtime || 0);
    return lock_age >= 0 && lock_age < RUNTIME_DIR_LOCK_OWNER_GRACE;
}

function release_runtime_dir_lock(lock_dir, owner_pid) {
    lock_dir = as_string(lock_dir);
    owner_pid = as_string(owner_pid);
    if (lock_dir == "" || owner_pid == "")
        return;

    if (first_line_value(lock_dir + "/pid") != owner_pid)
        return;

    command_success_from_args([ "rm", "-f", lock_dir + "/pid" ]);
    command_success_from_args([ "rmdir", lock_dir ]);
}

function acquire_runtime_dir_lock(lock_dir, owner_pid) {
    lock_dir = as_string(lock_dir);
    owner_pid = as_string(owner_pid);
    if (lock_dir == "" || owner_pid == "")
        return false;
    if (!ensure_parent_dir(lock_dir))
        return false;

    if (command_success_from_args([ "mkdir", lock_dir ])) {
        if (lock_dir_write_owner(lock_dir, owner_pid))
            return true;
        release_runtime_dir_lock(lock_dir, owner_pid);
        return false;
    }

    if (runtime_dir_lock_held(lock_dir))
        return false;

    command_success_from_args([ "rm", "-f", lock_dir + "/pid" ]);
    if (!command_success_from_args([ "rmdir", lock_dir ]))
        return false;
    if (!command_success_from_args([ "mkdir", lock_dir ]))
        return false;

    if (lock_dir_write_owner(lock_dir, owner_pid))
        return true;

    release_runtime_dir_lock(lock_dir, owner_pid);
    return false;
}

function acquire_runtime_dir_lock_wait(lock_dir, owner_pid, timeout) {
    let timeout_text = as_string(timeout == null ? "300" : timeout);
    timeout = numeric_text(timeout_text) ? int(timeout_text, 10) : 300;
    let start = int(current_epoch(), 10) || 0;

    while (!acquire_runtime_dir_lock(lock_dir, owner_pid)) {
        let now = int(current_epoch(), 10) || start;
        if (now - start >= timeout)
            return false;
        command_success_from_args([ "sleep", "2" ]);
    }

    return true;
}

function write_reload_state(path, values) {
    if (!ensure_parent_dir(path))
        exit(1);

    if (!fs.writefile(path, reload_state_text(values)))
        exit(1);
}

function copy_file(source, target) {
    let data = fs.readfile(source);
    if (data == null)
        return false;
    if (!ensure_parent_dir(target))
        return false;
    return write_text_file(target, data);
}

function cleanup_rule_condition_cache(path) {
    path = as_string(path);
    if (path != "")
        command_success_from_args([ "rm", "-rf", path ]);
    system("rm -rf /tmp/forkop-rule-cache.* >/dev/null 2>&1");
}

function cleanup_reload_state_snapshots(path) {
    path = as_string(path);
    if (path == "")
        return;

    for (let snapshot_path in fs.glob(path + ".snapshot.*"))
        unlink_file(snapshot_path);
}

function clear_reload_state(path, snapshot_path) {
    unlink_file(path);
    if (as_string(snapshot_path) != "")
        unlink_file(snapshot_path);
    cleanup_reload_state_snapshots(path);
}

function arg_bool(value) {
    value = lc(as_string(value));
    return value == "1" || value == "true" || value == "yes" || value == "on";
}

function sing_box_runtime_reload_needed(config_hash_before, config_hash_after, force) {
    return arg_bool(force) || as_string(config_hash_before) != as_string(config_hash_after);
}

function sing_box_process_running() {
    return command_success_from_args([ "pgrep", "-x", "sing-box" ]) ||
        command_success_from_args([ "pgrep", "-f", "^/usr/bin/sing-box[[:space:]]" ]);
}

function wait_sing_box_stopped(timeout) {
    timeout = int(timeout || 15);
    while (timeout > 0) {
        if (!sing_box_process_running() && !sing_box_service_running())
            return true;
        command_success_from_args([ "sleep", "1" ]);
        timeout--;
    }
    return !sing_box_process_running() && !sing_box_service_running();
}

function reload_sing_box_runtime(config_hash_before, config_hash_after, force) {
    if (!sing_box_runtime_reload_needed(config_hash_before, config_hash_after, force)) {
        command_success_from_args([ "logger", "-t", "forkop", "[info] sing-box reload skipped: configuration is unchanged" ]);
        return;
    }

    command_success_from_args([ "logger", "-t", "forkop", "[info] Reloading sing-box runtime" ]);
    if (!command_success_from_args([ SING_BOX_INIT, "reload" ])) {
        command_success_from_args([ "logger", "-t", "forkop", "[fatal] Failed to reload sing-box. Aborted." ]);
        exit(1);
    }
}

function wait_forkop_stable_start(rt_table, nft_table, mark, min_age) {
    min_age = int(min_age || 2);

    let pid = sing_box_service_pid_runtime();
    if (pid <= 0 || !pid_is_sing_box(pid))
        return false;

    let start_ticks = process_start_ticks(fs.readfile("/proc/" + pid + "/stat"));
    if (start_ticks == null)
        return false;

    let waited = 0;
    while (true) {
        let age = process_age_seconds(pid, start_ticks);
        if (age == null)
            return false;

        if (age >= min_age && sing_box_runtime_ports_ready() &&
            forkop_runtime_network_configured(rt_table, nft_table, mark))
            return true;

        if (waited >= SING_BOX_START_MAX_WAIT_SECONDS)
            return false;

        command_success_from_args([ "sleep", "1" ]);
        waited++;
    }

    return false;
}

function whitespace_fields(value) {
    value = as_string(value);
    let result = [];
    for (let item in split(trim(value), /[ \t\r\n]+/))
        if (item != "")
            push(result, item);
    return result;
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

function list_option(section, key, fallback) {
    let value = object_or_empty(section)[key];
    if (type(value) == "array")
        return value;

    value = trim(as_string(value));
    if (value != "")
        return split(value, /[ \t\r\n]+/);

    fallback = as_string(fallback);
    return fallback == "" ? [] : [ fallback ];
}

function bool_option(section, key, fallback) {
    return arg_bool(option(section, key, fallback ? "1" : "0"));
}

function bool_value(value) {
    return arg_bool(value) ? "1" : "0";
}

function bool_option_value(section, key, fallback) {
    return bool_option(section, key, fallback) ? "1" : "0";
}

function section_name(section) {
    return as_string(object_or_empty(section)[".name"]);
}

function str_startswith(value, prefix) {
    value = as_string(value);
    prefix = as_string(prefix);
    return substr(value, 0, length(prefix)) == prefix;
}

function reference_is_remote(value) {
    return str_startswith(value, "http://") || str_startswith(value, "https://");
}

function list_has_remote_references(value) {
    for (let item in whitespace_fields(value))
        if (reference_is_remote(item))
            return true;
    return false;
}

function signature_add_value(body, key, value) {
    return body + "[" + as_string(key) + "]\n" + as_string(value) + "\n";
}

function signature_hash(body) {
    let path = trim(command_output_from_args([ "mktemp" ]));
    if (path == "")
        return "";

    if (!write_text_file(path, body)) {
        unlink_file(path);
        return "";
    }

    let hash_line = command_output_from_args([ "md5sum", path ]);
    unlink_file(path);
    hash_line = trim(hash_line);

    return length(hash_line) >= 32 ? substr(hash_line, 0, 32) : "";
}

function print_signature_hash(body) {
    let hash = signature_hash(body);
    if (hash == "")
        return false;

    print(hash, "\n");
    return true;
}

function dont_touch_dhcp_value(settings) {
    return bool_option(settings, "dont_touch_dhcp", false) ? "1" : "0";
}

function service_trigger_signature_body(settings) {
    let enabled = bool_option(settings, "enable_badwan_interface_monitoring", false);
    let body = signature_add_value("", "settings.enable_badwan_interface_monitoring", enabled ? "1" : "0");

    if (enabled) {
        body = signature_add_value(body, "settings.badwan_monitored_interfaces", option(settings, "badwan_monitored_interfaces", ""));
        body = signature_add_value(body, "settings.badwan_reload_delay", option(settings, "badwan_reload_delay", "2000"));
    }

    return body;
}

function dnsmasq_signature_body(settings, dnsmasq, legacy_dnsmasq_present) {
    let body = "";

    body = signature_add_value(body, "settings.dont_touch_dhcp", dont_touch_dhcp_value(settings));
    body = signature_add_value(body, "dhcp.@dnsmasq[0].server", option(dnsmasq, "server", ""));
    body = signature_add_value(body, "dhcp.@dnsmasq[0].noresolv", option(dnsmasq, "noresolv", ""));
    body = signature_add_value(body, "dhcp.@dnsmasq[0].cachesize", option(dnsmasq, "cachesize", ""));
    body = signature_add_value(body, "dhcp.@dnsmasq[0].forkop_server", option(dnsmasq, "forkop_server", ""));
    body = signature_add_value(body, "dhcp.@dnsmasq[0].forkop_noresolv", option(dnsmasq, "forkop_noresolv", ""));
    body = signature_add_value(body, "dhcp.@dnsmasq[0].forkop_cachesize", option(dnsmasq, "forkop_cachesize", ""));
    body = signature_add_value(body, "dhcp.forkop.present", arg_bool(legacy_dnsmasq_present) ? "1" : "0");

    return body;
}

function settings_update_interval(settings) {
    settings = object_or_empty(settings);

    if (!bool_option(settings, "list_update_enabled", true))
        return "";

    let value = option(settings, "update_interval", "1d");
    return value != "" ? value : "1d";
}

function settings_component_update_check_interval(settings) {
    settings = object_or_empty(settings);

    if (!bool_option(settings, "component_update_check_enabled", false))
        return "";

    let value = option(settings, "component_update_check_interval", "1d");
    return value != "" ? value : "1d";
}

function nft_runtime_signature_body(settings, sections) {
    let body = "";

    body = signature_add_value(body, "settings.source_network_interfaces", option(settings, "source_network_interfaces", "br-lan"));
    body = signature_add_value(body, "settings.exclude_ntp", bool_option(settings, "exclude_ntp", false) ? "1" : "0");

    for (let section in sections) {
        section = object_or_empty(section);
        let name = section_name(section);
        if (name == "" || !bool_option(section, "enabled", true))
            continue;

        let action = option(section, "action", "");
        body = signature_add_value(body, "rule." + name + ".action", action);
        if (action == "dns") {
            body = signature_add_value(body, "rule." + name + ".source_ip_cidr", connections.source_signature_value(section));
            body = signature_add_value(body, "rule." + name + ".source_aware_dns", connections.has_dns_matchers(section) ? "1" : "0");
            body = signature_add_value(body, "rule." + name + ".fully_routed_ips", option(section, "fully_routed_ips", ""));
            continue;
        }
        body = signature_add_value(body, "rule." + name + ".ip_cidr", connections.rule_condition_csv(section, "ip_cidr", "subnets"));
        body = signature_add_value(body, "rule." + name + ".source_ip_cidr", connections.source_signature_value(section));
        body = signature_add_value(body, "rule." + name + ".source_aware_dns", connections.has_dns_matchers(section) ? "1" : "0");
        body = signature_add_value(body, "rule." + name + ".ports", connections.rule_ports_csv(section));
        body = signature_add_value(body, "rule." + name + ".fully_routed_ips", option(section, "fully_routed_ips", ""));
        body = signature_add_value(body, "rule." + name + ".community_subnet_lists", rule_config.filter_community_subnet_lists_value(connections.community_lists_value(section)));
        body = signature_add_value(body, "rule." + name + ".rule_set_with_subnets", connections.rule_sets_with_subnets_value(section));
    }

    return body;
}

function section_subscription_update_interval(section) {
    let result = "";
    let result_seconds = 0;

    for (let entry in connections.subscription_urls(section)) {
        if (!connections.subscription_update_enabled(section, entry))
            continue;

        let value = connections.subscription_update_interval(section, entry);
        if (value == "")
            value = "1h";
        let seconds = core_common.duration_to_seconds(value);
        if (result == "" || (seconds != null && (result_seconds == 0 || seconds < result_seconds))) {
            result = value;
            result_seconds = seconds == null ? 0 : seconds;
        }
    }

    return result;
}

function connection_urls_signature(section) {
    return sprintf("%J", connections.connection_urls(section));
}

function subscription_urls_signature(section) {
    let result = [];
    for (let entry in connections.subscription_urls(section)) {
        let settings = connections.subscription_url_settings(section, entry);
        push(result, {
            url: entry,
            subscription_update_enabled: connections.subscription_update_enabled(section, entry) ? "1" : "0",
            subscription_update_interval: connections.subscription_update_interval(section, entry),
            download_via_proxy_section: connections.subscription_download_section(section, entry),
            header: connections.subscription_headers(section, entry),
            show_dashboard_metadata: connections.subscription_dashboard_metadata_enabled(section, entry) ? "1" : "0",
            show_subscription_name: connections.subscription_show_name(section, entry) ? "1" : "0",
            tag: connections.subscription_tag(section, entry),
            server_filter_mode: option(settings, "server_filter_mode", "all"),
            include_outbounds: list_option(settings, "include_outbounds"),
            include_regex: option(settings, "include_regex", ""),
            exclude_outbounds: list_option(settings, "exclude_outbounds"),
            exclude_regex: option(settings, "exclude_regex", ""),
            exclude_types: connections.subscription_exclude_types(section, entry),
            override: connections.subscription_override(section, entry)
        });
    }
    return sprintf("%J", result);
}

function interfaces_signature(section) {
    let result = [];
    for (let entry in connections.interfaces(section)) {
        push(result, {
            name: entry,
            domain_resolver_enabled: connections.interface_domain_resolver_enabled(section, entry) ? "1" : "0",
            domain_resolver_dns_server: connections.interface_domain_resolver_dns_servers(section, entry),
            domain_resolver_dns_fallback_strategy: connections.interface_domain_resolver_dns_fallback_strategy(section, entry),
            domain_resolver_dns_detour_enabled: connections.interface_domain_resolver_dns_detour_enabled(section, entry) ? "1" : "0",
            domain_resolver_dns_detour_section: connections.interface_domain_resolver_dns_detour_section(section, entry)
        });
    }
    return sprintf("%J", result);
}

function urltests_signature(section) {
    let result = [];
    for (let entry in connections.urltests(section)) {
        push(result, {
            id: entry,
            display_name: connections.urltest_display_name(section, entry),
            check_interval: connections.urltest_check_interval(section, entry),
            tolerance: connections.urltest_tolerance(section, entry),
            testing_url: connections.urltest_testing_url(section, entry),
            expected_status: connections.urltest_expected_status(section, entry),
            idle_timeout: connections.urltest_idle_timeout(section, entry),
            interrupt_exist_connections: connections.urltest_interrupt_exist_connections(section, entry) ? "1" : "0",
            hide_dashboard_members: connections.urltest_hide_dashboard_members(section, entry) ? "1" : "0",
            server_filter_mode: connections.urltest_filter_mode(section, entry),
            include_outbounds: connections.urltest_include_outbounds(section, entry),
            include_regex: connections.urltest_include_regex(section, entry),
            exclude_outbounds: connections.urltest_exclude_outbounds(section, entry),
            exclude_regex: connections.urltest_exclude_regex(section, entry),
            exclude_types: connections.urltest_exclude_types(section, entry)
        });
    }
    return sprintf("%J", result);
}

function fallback_groups_signature(section) {
    let result = [];
    for (let group_id in connections.fallback_groups(section)) {
        let levels = [];
        for (let level_id in connections.fallback_levels(group_id)) {
            push(levels, {
                id: level_id,
                display_name: connections.fallback_level_display_name(group_id, level_id),
                order: connections.fallback_level_order(group_id, level_id),
                server_filter_mode: connections.fallback_level_mode(group_id, level_id),
                include_outbounds: connections.fallback_level_include_outbounds(group_id, level_id),
                include_regex: connections.fallback_level_include_regex(group_id, level_id),
                exclude_outbounds: connections.fallback_level_exclude_outbounds(group_id, level_id),
                exclude_regex: connections.fallback_level_exclude_regex(group_id, level_id),
                exclude_types: connections.fallback_level_exclude_types(group_id, level_id),
                include_groups: connections.fallback_level_include_groups(group_id, level_id)
            });
        }

        push(result, {
            id: group_id,
            display_name: connections.fallback_group_display_name(section, group_id),
            health_check_url: connections.fallback_group_health_check_url(section, group_id),
            health_check_interval: connections.fallback_group_health_check_interval(section, group_id),
            health_check_timeout: connections.fallback_group_health_check_timeout(section, group_id),
            attempt_timeout: connections.fallback_group_attempt_timeout(section, group_id),
            expected_status: connections.fallback_group_expected_status(section, group_id),
            idle_timeout: connections.fallback_group_idle_timeout(section, group_id),
            interrupt_exist_connections: connections.fallback_group_interrupt_exist_connections(section, group_id) ? "1" : "0",
            hide_dashboard_members: connections.fallback_group_hide_dashboard_members(section, group_id) ? "1" : "0",
            levels
        });
    }
    return sprintf("%J", result);
}

function section_urltest_check_interval(section) {
    let urltests = connections.urltests(section);
    if (length(urltests) == 0)
        return "";

    let result = "";
    let result_seconds = 0;
    for (let urltest_id in urltests) {
        let value = connections.urltest_check_interval(section, urltest_id);
        if (value == "")
            value = "3m";
        let seconds = core_common.duration_to_seconds(value);
        if (result == "" || (seconds != null && (result_seconds == 0 || seconds < result_seconds))) {
            result = value;
            result_seconds = seconds == null ? 0 : seconds;
        }
    }

    return result;
}

function cron_signature_body(settings) {
    return signature_add_value("", "settings.component_update_check_interval", settings_component_update_check_interval(settings));
}

function sing_box_signature_has_remote_ruleset_sources(sections) {
    for (let section in sections) {
        section = object_or_empty(section);
        if (!bool_option(section, "enabled", true))
            continue;

        if (length(connections.community_lists(section)) > 0 ||
            list_has_remote_references(connections.rule_sets_value(section)) ||
            list_has_remote_references(connections.rule_sets_with_subnets_value(section)))
            return true;
    }

    return false;
}

function sing_box_signature_enabled_action_index(sections, target_section, action) {
    let result = 0;
    target_section = as_string(target_section);
    action = as_string(action);

    for (let section in sections) {
        section = object_or_empty(section);
        if (section_name(section) == "" ||
            !bool_option(section, "enabled", true) ||
            option(section, "action", "") != action)
            continue;

        result++;
        if (section_name(section) == target_section)
            return result;
    }

    return 0;
}

function signature_add_mixed_proxy_body(body, section, prefix) {
    let mixed_proxy_enabled = bool_option_value(section, "mixed_proxy_enabled", false);
    body = signature_add_value(body, prefix + ".mixed_proxy_enabled", mixed_proxy_enabled);

    if (mixed_proxy_enabled == "1") {
        body = signature_add_value(body, prefix + ".mixed_proxy_port", option(section, "mixed_proxy_port", ""));
        let auth_enabled = bool_option_value(section, "mixed_proxy_auth_enabled", false);
        body = signature_add_value(body, prefix + ".mixed_proxy_auth_enabled", auth_enabled);
        if (auth_enabled == "1") {
            body = signature_add_value(body, prefix + ".mixed_proxy_username", option(section, "mixed_proxy_username", ""));
            body = signature_add_value(body, prefix + ".mixed_proxy_password", option(section, "mixed_proxy_password", ""));
        }
    }

    return body;
}

function signature_add_outbound_detour_body(body, section, prefix) {
    let outbound_detour_enabled = bool_option_value(section, "outbound_detour_enabled", false);
    body = signature_add_value(body, prefix + ".outbound_detour_enabled", outbound_detour_enabled);

    if (outbound_detour_enabled == "1")
        body = signature_add_value(body, prefix + ".outbound_detour_section", option(section, "outbound_detour_section", ""));

    return body;
}

function append_sing_box_rule_signature_body(body, section, sections) {
    section = object_or_empty(section);
    let name = section_name(section);
    if (name == "" || !bool_option(section, "enabled", true))
        return body;

    let action = option(section, "action", "");
    if (action == "")
        return body;

    let prefix = "rule." + name;
    body = signature_add_value(body, prefix + ".action", action);
    // The display name is the prefix of every outbound and inbound tag this
    // section generates, so renaming it rewrites the whole runtime graph.
    body = signature_add_value(body, prefix + ".label", connections.section_display_name(section));

    if (connections.is_connections_action(action)) {
        body = signature_add_value(body, prefix + ".connection_urls", connection_urls_signature(section));
        body = signature_add_value(body, prefix + ".subscription_urls", subscription_urls_signature(section));
        body = signature_add_value(body, prefix + ".interfaces", interfaces_signature(section));
        body = signature_add_value(body, prefix + ".outbound_jsons", option(section, "outbound_jsons", ""));
        body = signature_add_value(body, prefix + ".tunnels", connections.tunnels_signature(section));
        body = signature_add_value(body, prefix + ".legacy_interface", option(section, "interface", ""));
        body = signature_add_value(body, prefix + ".legacy_outbound_json", option(section, "outbound_json", ""));
        body = signature_add_value(body, prefix + ".urltests", urltests_signature(section));
        body = signature_add_value(body, prefix + ".fallback_groups", fallback_groups_signature(section));
        body = signature_add_value(body, prefix + ".urltest_enabled", bool_option_value(section, "urltest_enabled", false));
        body = signature_add_value(body, prefix + ".urltest_check_interval", section_urltest_check_interval(section));
        body = signature_add_value(body, prefix + ".urltest_tolerance", option(section, "urltest_tolerance", "50"));
        body = signature_add_value(body, prefix + ".urltest_testing_url", option(section, "urltest_testing_url", "https://www.gstatic.com/generate_204"));
        body = signature_add_value(body, prefix + ".urltest_expected_status", option(section, "urltest_expected_status", "*"));
        body = signature_add_value(body, prefix + ".urltest_filter_mode", option(section, "urltest_filter_mode", "disabled"));
        body = signature_add_value(body, prefix + ".urltest_exclude_outbounds", option(section, "urltest_exclude_outbounds", ""));
        body = signature_add_value(body, prefix + ".urltest_exclude_regex", option(section, "urltest_exclude_regex", ""));
        body = signature_add_value(body, prefix + ".urltest_include_outbounds", option(section, "urltest_include_outbounds", ""));
        body = signature_add_value(body, prefix + ".urltest_include_regex", option(section, "urltest_include_regex", ""));
        body = signature_add_value(body, prefix + ".subscription_update_interval", section_subscription_update_interval(section));
        body = signature_add_outbound_detour_body(body, section, prefix);
        body = signature_add_mixed_proxy_body(body, section, prefix);
        body = signature_add_value(body, prefix + ".resolve_real_ip_for_routing", bool_option_value(section, "resolve_real_ip_for_routing", false));
    }
    else if (action == "byedpi") {
        body = signature_add_value(body, prefix + ".byedpi_index", sing_box_signature_enabled_action_index(sections, name, "byedpi"));
        body = signature_add_mixed_proxy_body(body, section, prefix);
        body = signature_add_value(body, prefix + ".resolve_real_ip_for_routing", "1");
    }
    else if (action == "zapret" || action == "zapret2") {
        body = signature_add_mixed_proxy_body(body, section, prefix);
    }
    else if (action == "dns") {
        for (let value in list_option(section, "dns_server"))
            body = signature_add_value(body, prefix + ".dns_server", value);
        body = signature_add_value(body, prefix + ".dns_fallback_strategy", option(section, "dns_fallback_strategy", "parallel"));
        body = signature_add_value(body, prefix + ".dns_detour_enabled", bool_option_value(section, "dns_detour_enabled", false));
        if (bool_option(section, "dns_detour_enabled", false))
            body = signature_add_value(body, prefix + ".dns_detour_section", option(section, "dns_detour_section", ""));
    }

    body = signature_add_value(body, prefix + ".domain", connections.rule_condition_csv(section, "domain", "domains"));
    body = signature_add_value(body, prefix + ".domain_suffix", connections.rule_condition_csv(section, "domain_suffix", "domains"));
    body = signature_add_value(body, prefix + ".domain_keyword", connections.rule_condition_csv(section, "domain_keyword", "generic"));
    body = signature_add_value(body, prefix + ".domain_regex", connections.rule_condition_csv(section, "domain_regex", "generic"));
    if (action != "dns")
        body = signature_add_value(body, prefix + ".ip_cidr", connections.rule_condition_csv(section, "ip_cidr", "subnets"));
    body = signature_add_value(body, prefix + ".source_ip_cidr", connections.source_signature_value(section));
    if (action != "dns")
        body = signature_add_value(body, prefix + ".ports", connections.rule_ports_csv(section));
    body = signature_add_value(body, prefix + ".fully_routed_ips", option(section, "fully_routed_ips", ""));
    body = signature_add_value(body, prefix + ".community_lists", connections.community_lists_value(section));
    body = signature_add_value(body, prefix + ".rule_set", connections.rule_sets_value(section));
    if (action != "dns")
        body = signature_add_value(body, prefix + ".rule_set_with_subnets", connections.rule_sets_with_subnets_value(section));

    return body;
}

function append_sing_box_server_signature_body(body, server) {
    server = object_or_empty(server);
    let name = section_name(server);
    if (name == "")
        return body;

    let prefix = "server." + name;
    let enabled = bool_option_value(server, "enabled", false);
    body = signature_add_value(body, prefix + ".enabled", enabled);
    if (enabled != "1")
        return body;

    if (option(server, "protocol", "vless") == "mixed")
        body = signature_add_value(body, prefix + ".mixed_auth_enabled", bool_option_value(server, "mixed_auth_enabled", false));

    // Every option the generator reads, and only those: a field that never reaches
    // the configuration - the public address, the client fingerprint and the Reality
    // public key go into share links alone - would reload sing-box for a change it
    // cannot see.
    let fields = [
        [ "label", name ],
        [ "protocol", "vless" ],
        [ "listen", "0.0.0.0" ],
        [ "listen_port", "" ],
        [ "inbound_json", "" ],
        [ "routing_mode", "rules" ],
        [ "routing_section", "" ],
        [ "security", "reality" ],
        [ "tls_server_name", "" ],
        [ "tls_alpn", "" ],
        [ "tls_certificate_path", "" ],
        [ "tls_key_path", "" ],
        [ "reality_private_key", "" ],
        [ "reality_short_id", "" ],
        [ "transport", "tcp" ],
        [ "transport_path", "" ],
        [ "transport_host", "" ],
        [ "transport_service_name", "" ],
        [ "transport_hosts", "" ],
        [ "transport_xhttp_mode", "" ],
        [ "tcp_fast_open", "" ],
        [ "shadowsocks_method", "" ],
        [ "shadowsocks_psk", "" ],
        [ "multiplex_enabled", "" ],
        [ "multiplex_padding", "" ],
        [ "hysteria2_up_mbps", "" ],
        [ "hysteria2_down_mbps", "" ],
        [ "hysteria2_obfs_type", "" ],
        [ "hysteria2_obfs_password", "" ],
        [ "hysteria2_ignore_client_bandwidth", "" ],
        [ "hysteria2_masquerade", "" ],
        [ "naive_network", "tcp" ],
        [ "ssh_host_key_path", "" ],
        [ "mieru_transport", "TCP" ],
        [ "tuic_congestion_control", "cubic" ],
        [ "tuic_heartbeat", "10s" ],
        [ "tuic_zero_rtt_handshake", "0" ],
        [ "mtproto_faketls", "" ],
        [ "tailscale_auth_key", "" ],
        [ "tailscale_detour_enabled", "" ],
        [ "tailscale_detour_section", "" ],
        [ "tailscale_control_url", "" ],
        [ "tailscale_hostname", "" ],
        [ "tailscale_advertise_exit_node", "" ],
        [ "tailscale_accept_routes", "" ],
        [ "tailscale_advertise_routes", "" ],
        [ "tailscale_ephemeral", "" ]
    ];

    for (let field in fields)
        body = signature_add_value(body, prefix + "." + field[0], option(server, field[0], field[1]));

    // Clients decide who the inbound accepts, so a changed, added or removed client
    // has to move the signature the same way a server option does.
    for (let client in connections.server_clients(server)) {
        let client_prefix = prefix + ".client." + section_name(client);
        for (let field in [ "name", "uuid", "password", "secret", "flow",
            "routing_override", "routing_mode", "routing_section" ])
            body = signature_add_value(body, client_prefix + "." + field, option(client, field, ""));
        for (let value in list_option(client, "authorized_keys"))
            body = signature_add_value(body, client_prefix + ".authorized_keys", value);
    }

    return body;
}

function sing_box_signature_body(settings, sections, servers, mwan3_active) {
    settings = object_or_empty(settings);
    let body = "";

    body = signature_add_value(body, "settings.dns_strategy", option(settings, "dns_strategy", "prefer_ipv4"));
    for (let value in list_option(settings, "dns_server", "77.88.8.8"))
        body = signature_add_value(body, "settings.dns_server", value);
    for (let value in list_option(settings, "bootstrap_dns_server", "77.88.8.8"))
        body = signature_add_value(body, "settings.bootstrap_dns_server", value);
    body = signature_add_value(body, "settings.dns_main_fallback_strategy", option(settings, "dns_main_fallback_strategy", "parallel"));
    body = signature_add_value(body, "settings.dns_bootstrap_fallback_strategy", option(settings, "dns_bootstrap_fallback_strategy", "parallel"));
    let dns_detour_enabled = bool_option_value(settings, "dns_detour_enabled", false);
    body = signature_add_value(body, "settings.dns_detour_enabled", dns_detour_enabled);
    if (dns_detour_enabled == "1")
        body = signature_add_value(body, "settings.dns_detour_section", option(settings, "dns_detour_section", ""));
    body = signature_add_value(body, "settings.dns_rewrite_ttl", option(settings, "dns_rewrite_ttl", "60"));
    body = signature_add_value(body, "settings.output_network_interface", option(settings, "output_network_interface", ""));
    body = signature_add_value(body, "settings.disable_quic", bool_option_value(settings, "disable_quic", false));
    body = signature_add_value(body, "settings.bittorrent_direct", bool_option_value(settings, "bittorrent_direct", false));
    body = signature_add_value(body, "settings.unified_delay", bool_option_value(settings, "unified_delay", false));
    body = signature_add_value(body, "settings.static_hosts_text", option(settings, "static_hosts_text", ""));
    if (sing_box_signature_has_remote_ruleset_sources(sections))
        body = signature_add_value(body, "settings.update_interval", settings_update_interval(settings));
    body = signature_add_value(body, "settings.cache_path", option(settings, "cache_path", "/tmp/sing-box/cache.db"));
    body = signature_add_value(body, "settings.config_path", option(settings, "config_path", ""));
    body = signature_add_value(body, "settings.log_level", option(settings, "log_level", "warn"));
    body = signature_add_value(body, "settings.service_listen_address", option(settings, "service_listen_address", ""));
    body = signature_add_value(body, "runtime.mwan3_active", bool_value(mwan3_active));

    let enable_yacd = bool_option_value(settings, "enable_yacd", false);
    body = signature_add_value(body, "settings.enable_yacd", enable_yacd);
    if (enable_yacd == "1") {
        body = signature_add_value(body, "settings.enable_yacd_wan_access", bool_option_value(settings, "enable_yacd_wan_access", false));
        body = signature_add_value(body, "settings.yacd_secret_key", option(settings, "yacd_secret_key", ""));
    }

    body = signature_add_value(body, "settings.download_lists_via_proxy", bool_option_value(settings, "download_lists_via_proxy", false));
    body = signature_add_value(body, "settings.download_components_via_proxy", bool_option_value(settings, "download_components_via_proxy", false));
    if (connections.download_via_proxy_enabled(settings, "lists"))
        body = signature_add_value(body, "settings.download_lists_via_proxy_section", option(settings, "download_lists_via_proxy_section", ""));
    if (connections.download_via_proxy_enabled(settings, "components"))
        body = signature_add_value(body, "settings.download_components_via_proxy_section", option(settings, "download_components_via_proxy_section", ""));

    for (let section in sections)
        body = append_sing_box_rule_signature_body(body, object_or_empty(section), sections);

    for (let server in servers)
        body = append_sing_box_server_signature_body(body, object_or_empty(server));

    return body;
}

function section_action_is_enabled(section, action) {
    return section_name(section) != "" &&
        bool_option(section, "enabled", true) &&
        option(section, "action", "") == as_string(action);
}

function action_queue_signature_body(sections, action, signature_key) {
    let body = "";

    for (let section in sections) {
        section = object_or_empty(section);
        if (section_action_is_enabled(section, action))
            body = signature_add_value(body, signature_key, section_name(section));
    }

    return body;
}

function section_user_domains_for_list_type(section) {
    let list_type = option(section, "user_domain_list_type", "disabled");

    if (list_type == "dynamic")
        return option(section, "user_domains", "");
    if (list_type == "text")
        return option(section, "user_domains_text", "");
    return "";
}

function append_zapret_runtime_signature_body(body, section, signature_prefix, opt_key, normalized_opt) {
    let name = section_name(section);
    let user_domain_list_type = option(section, "user_domain_list_type", "disabled");

    body = signature_add_value(body, signature_prefix + "." + name + "." + opt_key, normalized_opt);
    body = signature_add_value(body, signature_prefix + "." + name + ".domain", connections.rule_condition_csv(section, "domain", "domains"));
    body = signature_add_value(body, signature_prefix + "." + name + ".domain_suffix", connections.rule_condition_csv(section, "domain_suffix", "domains"));
    body = signature_add_value(body, signature_prefix + "." + name + ".community_lists", connections.community_lists_value(section));
    body = signature_add_value(body, signature_prefix + "." + name + ".rule_set", connections.rule_sets_value(section));
    body = signature_add_value(body, signature_prefix + "." + name + ".rule_set_with_subnets", connections.rule_sets_with_subnets_value(section));
    body = signature_add_value(body, signature_prefix + "." + name + ".user_domain_list_type", user_domain_list_type);
    body = signature_add_value(body, signature_prefix + "." + name + ".user_domains", section_user_domains_for_list_type(section));

    return body;
}

function zapret_runtime_signature_body(sections) {
    let body = "";

    for (let section in sections) {
        section = object_or_empty(section);
        if (!section_action_is_enabled(section, "zapret"))
            continue;

        body = append_zapret_runtime_signature_body(
        body,
        section,
        "zapret",
        "nfqws_opt",
            zapret_validator.strategy_or_default(option(section, "nfqws_opt", ""), ZAPRET_DEFAULT_NFQWS_OPT)
        );
    }

    return body;
}

function zapret2_runtime_signature_body(sections) {
    let body = "";

    for (let section in sections) {
        section = object_or_empty(section);
        if (!section_action_is_enabled(section, "zapret2"))
            continue;

        body = append_zapret_runtime_signature_body(
        body,
        section,
        "zapret2",
        "nfqws2_opt",
            zapret2_validator.strategy_or_default(option(section, "nfqws2_opt", ""), ZAPRET2_DEFAULT_NFQWS2_OPT)
        );
    }

    return body;
}

function enabled_action_index(sections, target_section, action) {
    let result = 0;
    target_section = as_string(target_section);
    action = as_string(action);

    for (let section in sections) {
        section = object_or_empty(section);
        if (!section_action_is_enabled(section, action))
            continue;

        result++;
        if (section_name(section) == target_section)
            return result;
    }

    return 0;
}

function byedpi_runtime_signature_body(sections) {
    let body = "";

    for (let section in sections) {
        section = object_or_empty(section);
        if (!section_action_is_enabled(section, "byedpi"))
            continue;

        let name = section_name(section);
        body = signature_add_value(body, "byedpi." + name + ".index", enabled_action_index(sections, name, "byedpi"));
        body = signature_add_value(body, "byedpi." + name + ".byedpi_cmd_opts", byedpi_validator.strategy_or_default(option(section, "byedpi_cmd_opts", ""), BYEDPI_DEFAULT_CMD_OPTS));
    }

    return body;
}

function reload_state_values_from_sources(format, settings, sections, servers, dnsmasq, legacy_dnsmasq_present, mwan3_active_value) {
    return {
        format: as_string(format),
        service_trigger_signature: signature_hash(service_trigger_signature_body(settings)),
        dnsmasq_signature: signature_hash(dnsmasq_signature_body(settings, dnsmasq, legacy_dnsmasq_present)),
        sing_box_signature: signature_hash(sing_box_signature_body(settings, sections, servers, mwan3_active_value)),
        nft_signature: signature_hash(nft_runtime_signature_body(settings, sections)),
        zapret_queue_signature: signature_hash(action_queue_signature_body(sections, "zapret", "zapret_queue.section")),
        zapret_runtime_signature: signature_hash(zapret_runtime_signature_body(sections)),
        zapret2_queue_signature: signature_hash(action_queue_signature_body(sections, "zapret2", "zapret2_queue.section")),
        zapret2_runtime_signature: signature_hash(zapret2_runtime_signature_body(sections)),
        byedpi_runtime_signature: signature_hash(byedpi_runtime_signature_body(sections)),
        cron_signature: signature_hash(cron_signature_body(settings)),
        dont_touch_dhcp: dont_touch_dhcp_value(settings)
    };
}

function fixture_section_list(data, type_name) {
    type_name = as_string(type_name || "section");
    let value = object_or_empty(data)[type_name];
    if (type(value) == "array")
        return value;
    if (type(value) == "object")
        return [ value ];

    let plural = object_or_empty(data)[type_name + "s"];
    return type(plural) == "array" ? plural : [];
}

function uci_sections(type_name) {
    return uci_core.section_objects(CONFIG_NAME, type_name);
}

function uci_servers() {
    return uci_sections("server");
}

function mwan3_has_enabled_interface() {
    for (let section in uci_core.section_objects("mwan3", "interface"))
        if (option(section, "enabled", "0") == "1")
            return true;

    return false;
}

function mwan3_active() {
    if (!command_success_from_args([ "test", "-x", "/etc/init.d/mwan3" ]))
        return false;
    if (!command_success_from_args([ "test", "-s", "/etc/config/mwan3" ]))
        return false;
    if (!mwan3_has_enabled_interface())
        return false;

    return command_success_from_args([ "/etc/init.d/mwan3", "status" ]) ||
        command_success_from_args([ "/etc/init.d/mwan3", "enabled" ]);
}

function fixture_servers(data) {
    return fixture_section_list(data, "server");
}

function fixture_data(path) {
    let data = object_or_empty(read_json_file(path));
    connections.set_item_sections_from_data(data);
    return data;
}

function fixture_settings(data) {
    return object_or_empty(object_or_empty(data).settings);
}

function fixture_dnsmasq(data) {
    return object_or_empty(object_or_empty(data).dhcp_dnsmasq);
}

function fixture_legacy_dnsmasq_present(data) {
    return object_or_empty(data).legacy_dnsmasq_present;
}

function fixture_mwan3_active(data) {
    return arg_bool(object_or_empty(object_or_empty(data).runtime).mwan3_active);
}

function uci_settings() {
    return object_or_empty(uci_core.get_all(CONFIG_NAME, "settings"));
}

function uci_dnsmasq() {
    return {
        server: uci_get("dhcp.@dnsmasq[0].server"),
        noresolv: uci_get("dhcp.@dnsmasq[0].noresolv"),
        cachesize: uci_get("dhcp.@dnsmasq[0].cachesize"),
        forkop_server: uci_get("dhcp.@dnsmasq[0].forkop_server"),
        forkop_noresolv: uci_get("dhcp.@dnsmasq[0].forkop_noresolv"),
        forkop_cachesize: uci_get("dhcp.@dnsmasq[0].forkop_cachesize")
    };
}

function current_reload_state_values(format) {
    let settings = uci_settings();
    let sections = uci_sections("section");

    return reload_state_values_from_sources(
        format,
        settings,
        sections,
        uci_servers(),
        uci_dnsmasq(),
        uci_exists("dhcp.forkop"),
        mwan3_active()
    );
}

function capture_reload_state(path, format) {
    write_reload_state(path, current_reload_state_values(format || "1"));
}

function write_current_reload_state_clean(path, format, cache_dir) {
    write_reload_state(path, current_reload_state_values(format || "1"));
    cleanup_rule_condition_cache(cache_dir);
    cleanup_reload_state_snapshots(path);
}

function write_captured_reload_state(path, snapshot_path, format, cache_dir, cleanup_cache, clear_snapshot) {
    snapshot_path = as_string(snapshot_path);
    if (snapshot_path == "") {
        if (as_string(cleanup_cache) == "1")
            write_current_reload_state_clean(path, format, cache_dir);
        else
            write_reload_state(path, current_reload_state_values(format || "1"));
        return;
    }

    if (fs.stat(snapshot_path) == null)
        capture_reload_state(snapshot_path, format || "1");

    if (!copy_file(snapshot_path, path))
        exit(1);

    if (as_string(cleanup_cache) == "1")
        cleanup_rule_condition_cache(cache_dir);
    if (as_string(clear_snapshot) == "1")
        unlink_file(snapshot_path);
}

function fixture_reload_state_values(data, format) {
    data = object_or_empty(data);
    let settings = fixture_settings(data);
    let sections = fixture_section_list(data);

    return reload_state_values_from_sources(
        format,
        settings,
        sections,
        fixture_servers(data),
        fixture_dnsmasq(data),
        fixture_legacy_dnsmasq_present(data),
        fixture_mwan3_active(data)
    );
}

let mode = ARGV[0];

if (mode == "get")
    read_state_value(ARGV[1], ARGV[2]);
else if (mode == "time-sync-needed")
    exit(time_sync_needed(ARGV[1]) ? 0 : 1);
else if (mode == "sync-time-if-needed")
    sync_time_if_needed();
else if (mode == "mark-pending-reload")
    mark_pending_reload(ARGV[1], ARGV[2]);
else if (mode == "consume-pending-reload")
    exit(consume_pending_reload(ARGV[1]) ? 0 : 1);
else if (mode == "run-pending-reload-if-requested")
    run_pending_reload_if_requested(ARGV[1], ARGV[2]);
else if (mode == "runtime-dir-lock-held")
    exit(runtime_dir_lock_held(ARGV[1]) ? 0 : 1);
else if (mode == "acquire-runtime-dir-lock")
    exit(acquire_runtime_dir_lock(ARGV[1], ARGV[2]) ? 0 : 1);
else if (mode == "acquire-runtime-dir-lock-wait")
    exit(acquire_runtime_dir_lock_wait(ARGV[1], ARGV[2], ARGV[3]) ? 0 : 1);
else if (mode == "release-runtime-dir-lock")
    release_runtime_dir_lock(ARGV[1], ARGV[2]);
else if (mode == "wait-sing-box-stopped")
    exit(wait_sing_box_stopped(ARGV[1] || "15") ? 0 : 1);
else if (mode == "reload-sing-box-runtime")
    reload_sing_box_runtime(ARGV[1], ARGV[2], ARGV[3]);
else if (mode == "clear-reload-state")
    clear_reload_state(ARGV[1], ARGV[2]);
else if (mode == "capture-reload-state")
    capture_reload_state(ARGV[1], ARGV[2] || "1");
else if (mode == "write-current-reload-state-clean")
    write_current_reload_state_clean(ARGV[1], ARGV[2] || "1", ARGV[3]);
else if (mode == "write-captured-reload-state")
    write_captured_reload_state(ARGV[1], ARGV[2], ARGV[3] || "1", ARGV[4], ARGV[5], ARGV[6]);
else if (mode == "write-current-reload-state")
    write_reload_state(ARGV[1], current_reload_state_values(ARGV[2] || "1"));
else if (mode == "reload-state-text-fixture") {
    let data = fixture_data(ARGV[1]);
    print(reload_state_text(fixture_reload_state_values(data, ARGV[2] || "1")));
}
else if (mode == "process-age-seconds-fixture") {
    let age = process_age_seconds_from_ticks(ARGV[1], ARGV[2]);
    if (age == null)
        exit(1);
    print(age, "\n");
}
else if (mode == "sing-box-runtime-reload-needed-fixture")
    exit(sing_box_runtime_reload_needed(ARGV[1], ARGV[2], ARGV[3]) ? 0 : 1);
else if (mode == "wait-forkop-stable-start")
    exit(wait_forkop_stable_start(ARGV[1], ARGV[2], ARGV[3], ARGV[4]) ? 0 : 1);
else if (mode == "service-trigger-signature")
    exit(print_signature_hash(service_trigger_signature_body(uci_settings())) ? 0 : 1);
else if (mode == "service-trigger-signature-fixture") {
    let data = fixture_data(ARGV[1]);
    exit(print_signature_hash(service_trigger_signature_body(fixture_settings(data))) ? 0 : 1);
}
else if (mode == "dnsmasq-signature")
    exit(print_signature_hash(dnsmasq_signature_body(uci_settings(), uci_dnsmasq(), uci_exists("dhcp.forkop"))) ? 0 : 1);
else if (mode == "dnsmasq-signature-fixture") {
    let data = fixture_data(ARGV[1]);
    exit(print_signature_hash(dnsmasq_signature_body(fixture_settings(data), fixture_dnsmasq(data), fixture_legacy_dnsmasq_present(data))) ? 0 : 1);
}
else if (mode == "sing-box-signature")
    exit(print_signature_hash(sing_box_signature_body(uci_settings(), uci_sections("section"), uci_servers(), mwan3_active())) ? 0 : 1);
else if (mode == "sing-box-signature-fixture") {
    let data = fixture_data(ARGV[1]);
    exit(print_signature_hash(sing_box_signature_body(fixture_settings(data), fixture_section_list(data), fixture_servers(data), fixture_mwan3_active(data))) ? 0 : 1);
}
else if (mode == "sing-box-signature-body-fixture") {
    let data = fixture_data(ARGV[1]);
    print(sing_box_signature_body(fixture_settings(data), fixture_section_list(data), fixture_servers(data), fixture_mwan3_active(data)));
}
else if (mode == "nft-signature")
    exit(print_signature_hash(nft_runtime_signature_body(uci_settings(), uci_sections("section"))) ? 0 : 1);
else if (mode == "nft-signature-fixture") {
    let data = fixture_data(ARGV[1]);
    exit(print_signature_hash(nft_runtime_signature_body(fixture_settings(data), fixture_section_list(data))) ? 0 : 1);
}
else if (mode == "zapret-queue-signature")
    exit(print_signature_hash(action_queue_signature_body(uci_sections("section"), "zapret", "zapret_queue.section")) ? 0 : 1);
else if (mode == "zapret-queue-signature-fixture") {
    let data = fixture_data(ARGV[1]);
    exit(print_signature_hash(action_queue_signature_body(fixture_section_list(data), "zapret", "zapret_queue.section")) ? 0 : 1);
}
else if (mode == "zapret-runtime-signature")
    exit(print_signature_hash(zapret_runtime_signature_body(uci_sections("section"))) ? 0 : 1);
else if (mode == "zapret-runtime-signature-fixture") {
    let data = fixture_data(ARGV[1]);
    exit(print_signature_hash(zapret_runtime_signature_body(fixture_section_list(data))) ? 0 : 1);
}
else if (mode == "zapret2-queue-signature")
    exit(print_signature_hash(action_queue_signature_body(uci_sections("section"), "zapret2", "zapret2_queue.section")) ? 0 : 1);
else if (mode == "zapret2-queue-signature-fixture") {
    let data = fixture_data(ARGV[1]);
    exit(print_signature_hash(action_queue_signature_body(fixture_section_list(data), "zapret2", "zapret2_queue.section")) ? 0 : 1);
}
else if (mode == "zapret2-runtime-signature")
    exit(print_signature_hash(zapret2_runtime_signature_body(uci_sections("section"))) ? 0 : 1);
else if (mode == "zapret2-runtime-signature-fixture") {
    let data = fixture_data(ARGV[1]);
    exit(print_signature_hash(zapret2_runtime_signature_body(fixture_section_list(data))) ? 0 : 1);
}
else if (mode == "byedpi-runtime-signature")
    exit(print_signature_hash(byedpi_runtime_signature_body(uci_sections("section"))) ? 0 : 1);
else if (mode == "byedpi-runtime-signature-fixture") {
    let data = fixture_data(ARGV[1]);
    exit(print_signature_hash(byedpi_runtime_signature_body(fixture_section_list(data))) ? 0 : 1);
}
else if (mode == "dont-touch-dhcp")
    print(dont_touch_dhcp_value(uci_settings()), "\n");
else if (mode == "dont-touch-dhcp-fixture") {
    let data = fixture_data(ARGV[1]);
    print(dont_touch_dhcp_value(fixture_settings(data)), "\n");
}
else if (mode == "settings-update-interval-fixture") {
    let data = fixture_data(ARGV[1]);
    print(settings_update_interval(fixture_settings(data)), "\n");
}
else if (mode == "subscription-update-interval-fixture") {
    let data = fixture_data(ARGV[1]);
    let sections = fixture_section_list(data);
    let name = as_string(ARGV[2]);
    for (let section in sections) {
        section = object_or_empty(section);
        if (section_name(section) == name) {
            print(section_subscription_update_interval(section), "\n");
            exit(0);
        }
    }
    print("\n");
}
else if (mode == "urltest-check-interval-fixture") {
    let data = fixture_data(ARGV[1]);
    let sections = fixture_section_list(data);
    let name = as_string(ARGV[2]);
    for (let section in sections) {
        section = object_or_empty(section);
        if (section_name(section) == name) {
            print(section_urltest_check_interval(section), "\n");
            exit(0);
        }
    }
    print("\n");
}
else if (mode == "cron-signature")
    exit(print_signature_hash(cron_signature_body(uci_settings())) ? 0 : 1);
else if (mode == "cron-signature-fixture") {
    let data = fixture_data(ARGV[1]);
    exit(print_signature_hash(cron_signature_body(fixture_settings(data))) ? 0 : 1);
}
else {
    warn("Usage: service/state.uc <operation> ...\n");
    exit(1);
}
