#!/usr/bin/env ucode

let fs = require("fs");
let constants = require("core.constants");
let core_netstat = require("core.netstat");
let uci_core = require("core.uci");

function as_string(value) {
    return value == null ? "" : "" + value;
}

function constant_value(name, fallback) {
    let value = constants[name];
    return value == null ? as_string(fallback) : as_string(value);
}

const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || constant_value("FORKOP_CONFIG_NAME", "forkop");
const CONFIG_FILE = getenv("FORKOP_CONFIG_FILE") || "/etc/config/" + CONFIG_NAME;
const LIB_DIR = getenv("FORKOP_LIB") || "/usr/lib/forkop";
const BIN_PATH = getenv("FORKOP_BIN") || constant_value("FORKOP_BIN", "/usr/bin/forkop");
const SERVICE_INIT = getenv("FORKOP_SERVICE_INIT") || constant_value("FORKOP_SERVICE_INIT", "/etc/init.d/forkop");
const SERVICE_NAME = getenv("FORKOP_SERVICE_NAME") || constant_value("FORKOP_SERVICE_NAME", "forkop");
const LUCI_VIEW_DIR = getenv("FORKOP_LUCI_VIEW_DIR") || constant_value("FORKOP_LUCI_VIEW_DIR", "/www/luci-static/resources/view/forkop");
const LUCI_I18N_DOMAIN = getenv("FORKOP_LUCI_I18N_DOMAIN") || constant_value("FORKOP_LUCI_I18N_DOMAIN", "forkop");

const RUNTIME_STATE_DIR = getenv("FORKOP_RUNTIME_STATE_DIR") || "/var/run/forkop";
const SYSTEM_INFO_CACHE_FILE = getenv("FORKOP_SYSTEM_INFO_CACHE_FILE") || RUNTIME_STATE_DIR + "/system-info.json";
const RELOAD_STATE_FILE = getenv("FORKOP_RELOAD_STATE_FILE") || RUNTIME_STATE_DIR + "/reload-state";
const RELOAD_STATE_SNAPSHOT_FILE = getenv("FORKOP_RELOAD_STATE_SNAPSHOT_FILE") || RUNTIME_STATE_DIR + "/reload-state.snapshot." + clock()[0] + "." + clock()[1];
const PENDING_RELOAD_FILE = getenv("FORKOP_PENDING_RELOAD_FILE") || RUNTIME_STATE_DIR + "/reload.pending";
const SERVICE_TRIGGER_SYNC_FILE = getenv("FORKOP_SERVICE_TRIGGER_SYNC_FILE") || RUNTIME_STATE_DIR + "/service-triggers.sync";
const SECTION_CACHE_DIR = getenv("FORKOP_SECTION_CACHE_DIR") || RUNTIME_STATE_DIR + "/section-cache";
const RULE_CONDITION_CACHE_DIR = getenv("FORKOP_RULE_CONDITION_CACHE_DIR") || RUNTIME_STATE_DIR + "/rule-condition-cache";
const RELOAD_LOCK_DIR = getenv("FORKOP_RELOAD_LOCK_DIR") || "/var/run/forkop.reload.lock";
const START_LOCK_DIR = getenv("FORKOP_START_LOCK_DIR") || RUNTIME_STATE_DIR + "/start.lock";
const START_LOCK_TIMEOUT = int(getenv("FORKOP_START_LOCK_TIMEOUT") || "360");
const SING_BOX_PLANNED_STOP_FILE = getenv("FORKOP_SING_BOX_PLANNED_STOP_FILE") || RUNTIME_STATE_DIR + "/sing-box-watch.planned-stop";
const INTERNAL_CONFIG_TRIGGER_GUARD = getenv("FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD") || "/var/run/forkop.internal-config-change";

const COMPONENT_UPDATE_CHECK_CRON_MARKER = getenv("FORKOP_COMPONENT_UPDATE_CHECK_CRON_MARKER") || "# forkop-component-update-check";
const RELOAD_STATE_FORMAT = int(getenv("FORKOP_RELOAD_STATE_FORMAT") || "1");
const RUNTIME_CACHE_FORMAT = int(getenv("FORKOP_RUNTIME_CACHE_FORMAT") || "8");
const RUNTIME_STABLE_MIN_AGE = int(getenv("FORKOP_RUNTIME_STABLE_MIN_AGE") || "2");
const SING_BOX_START_STABLE_MIN_AGE = int(getenv("FORKOP_SING_BOX_START_STABLE_MIN_AGE") || "8");
const NFT_POPULATE_ENABLED_DEFAULT = int(getenv("FORKOP_NFT_POPULATE_ENABLED") || "1");

const RT_TABLE_NAME = constant_value("RT_TABLE_NAME", "forkop");
const NFT_TABLE_NAME = constant_value("NFT_TABLE_NAME", "ForkopTable");
const NFT_LOCALV4_SET_NAME = constant_value("NFT_LOCALV4_SET_NAME", "localv4");
const NFT_LOCALV6_SET_NAME = constant_value("NFT_LOCALV6_SET_NAME", "localv6");
const NFT_COMMON_SET_NAME = constant_value("NFT_COMMON_SET_NAME", "forkop_subnets");
const NFT_COMMON6_SET_NAME = constant_value("NFT_COMMON6_SET_NAME", "forkop_subnets6");
const NFT_PORT_SET_NAME = constant_value("NFT_PORT_SET_NAME", "forkop_ports");
const NFT_IP_PORT_SET_NAME = constant_value("NFT_IP_PORT_SET_NAME", "forkop_ip_ports");
const NFT_IP_PORT6_SET_NAME = constant_value("NFT_IP_PORT6_SET_NAME", "forkop_ip6_ports");
const NFT_INTERFACE_SET_NAME = constant_value("NFT_INTERFACE_SET_NAME", "forkop_interfaces");
const NFT_FAKEIP_MARK = constant_value("NFT_FAKEIP_MARK", "0x04000000");
const NFT_OUTBOUND_MARK = constant_value("NFT_OUTBOUND_MARK", "0x08000000");

const SB_FAKEIP_INET4_RANGE = constant_value("SB_FAKEIP_INET4_RANGE", "198.18.0.0/15");
const SB_FAKEIP_INET6_RANGE = constant_value("SB_FAKEIP_INET6_RANGE", "fc00::/18");
const SB_TPROXY_INBOUND6_ADDRESS = constant_value("SB_TPROXY_INBOUND6_ADDRESS", "::1");
const SB_TPROXY_INBOUND_PORT = constant_value("SB_TPROXY_INBOUND_PORT", "1602");
const SB_SERVICE_MIXED_INBOUND_ADDRESS = constant_value("SB_SERVICE_MIXED_INBOUND_ADDRESS", "127.0.0.1");
const SB_SERVICE_MIXED_INBOUND_PORT = constant_value("SB_SERVICE_MIXED_INBOUND_PORT", "4534");

const ZAPRET_PROVIDER_NFQWS_BIN = constant_value("ZAPRET_PROVIDER_NFQWS_BIN", "/opt/zapret/nfq/nfqws");
const ZAPRET_ROUTE_MARK_BASE = constant_value("ZAPRET_ROUTE_MARK_BASE", "0x01000000");
const ZAPRET_QUEUE_BASE = constant_value("ZAPRET_QUEUE_BASE", "4000");
const ZAPRET_DESYNC_MARK = constant_value("ZAPRET_DESYNC_MARK", "0x40000000");
const ZAPRET_DESYNC_MARK_POSTNAT = constant_value("ZAPRET_DESYNC_MARK_POSTNAT", "0x20000000");
const ZAPRET2_PROVIDER_NFQWS2_BIN = constant_value("ZAPRET2_PROVIDER_NFQWS2_BIN", "/opt/zapret2/nfq2/nfqws2");
const ZAPRET2_ROUTE_MARK_BASE = constant_value("ZAPRET2_ROUTE_MARK_BASE", "0x02000000");
const ZAPRET2_QUEUE_BASE = constant_value("ZAPRET2_QUEUE_BASE", "4300");
const ZAPRET2_DESYNC_MARK = constant_value("ZAPRET2_DESYNC_MARK", "0x40000000");
const ZAPRET2_DESYNC_MARK_POSTNAT = constant_value("ZAPRET2_DESYNC_MARK_POSTNAT", "0x20000000");
const BYEDPI_BIN = constant_value("BYEDPI_BIN", "/usr/bin/ciadpi");

const DNS_APPLY_UC = LIB_DIR + "/dns/apply.uc";
const VALIDATOR_UC = LIB_DIR + "/config/validator.uc";
const SERVER_UC = LIB_DIR + "/server/service.uc";
const NFT_UC = LIB_DIR + "/nft/apply.uc";
const RULESET_SYNC_UC = LIB_DIR + "/nft/ruleset_sync.uc";
const SINGBOX_WATCH_UC = LIB_DIR + "/service/singbox_watch.uc";
const SINGBOX_UC = LIB_DIR + "/singbox/runtime.uc";
const UPDATES_UC = LIB_DIR + "/components/updates.uc";
const STATE_UC = LIB_DIR + "/service/state.uc";
const RELOAD_UC = LIB_DIR + "/service/reload.uc";
const UI_UC = LIB_DIR + "/service/ui.uc";
const DIAGNOSTICS_UC = LIB_DIR + "/diagnostics/runtime.uc";
const ZAPRET_UC = LIB_DIR + "/providers/zapret/runtime.uc";
const ZAPRET2_UC = LIB_DIR + "/providers/zapret2/runtime.uc";
const BYEDPI_UC = LIB_DIR + "/providers/byedpi/runtime.uc";
const PACKAGES_UC = LIB_DIR + "/core/packages.uc";

let nft_populate_enabled = NFT_POPULATE_ENABLED_DEFAULT;
let rule_condition_cache_enabled = 0;
let startup_config_fingerprint = "";

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function command_from_args(args) {
    let parts = [];
    for (let arg in args)
        push(parts, shell_quote(arg));
    return join(" ", parts);
}

function normalize_status(status) {
    status = int(status);
    return status > 255 ? int(status / 256) : status;
}

function command_status(command) {
    return normalize_status(system(command));
}

function command_capture(command) {
    let pipe = fs.popen(command, "r");
    if (!pipe)
        return { status: 1, output: "" };

    let data = pipe.read("all");
    let status = normalize_status(pipe.close());
    return { status, output: data == null ? "" : as_string(data) };
}

function command_output(command) {
    let result = command_capture(command);
    return result.status == 0 ? result.output : "";
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

function write_json(value) {
    print(sprintf("%J", value), "\n");
}

function command_success(command) {
    return command_status(command + " >/dev/null 2>&1") == 0;
}

function command_status_from_args(args) {
    return command_status(command_from_args(args));
}

function command_output_from_args(args) {
    return command_output(command_from_args(args) + " 2>/dev/null");
}

function command_success_from_args(args) {
    return command_status(command_from_args(args) + " >/dev/null 2>&1") == 0;
}

function external_config_fingerprint() {
    let data = fs.readfile(CONFIG_FILE);
    if (data == null)
        return "";

    let lines = [];
    for (let line in split(as_string(data), "\n"))
        if (match(as_string(line), /^[ \t]*option[ \t]+shutdown_correctly([ \t]|$)/) == null)
            push(lines, line);

    return join("\n", lines);
}

function trim(value) {
    return replace(as_string(value), /^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

function owner_pid() {
    let stat = as_string(fs.readfile("/proc/self/stat"));
    let separator = index(stat, " ");
    return separator > 0 ? substr(stat, 0, separator) : "0";
}

function bool_text(value) {
    value = lc(as_string(value));
    return value == "1" || value == "true" || value == "yes" || value == "on";
}

function object_or_empty(value) {
    return type(value) == "object" ? value : {};
}

function array_or_empty(value) {
    return type(value) == "array" ? value : [];
}

function string_array_contains(values, needle) {
    needle = as_string(needle);
    if (needle == "")
        return false;

    for (let item in array_or_empty(values))
        if (as_string(item) == needle)
            return true;

    return false;
}

function write_file(path, value) {
    return fs.writefile(as_string(path), as_string(value));
}

function remove_file(path) {
    return fs.unlink(as_string(path)) || true;
}

function ensure_dir(path) {
    path = as_string(path);
    return path == "" || fs.mkdir(path, 0755) || fs.stat(path) != null;
}

function mark_sing_box_planned_stop() {
    if (!ensure_dir(RUNTIME_STATE_DIR))
        return false;
    let written = write_file(SING_BOX_PLANNED_STOP_FILE, owner_pid() + "\n");
    return written != null && written !== false;
}

function clear_sing_box_planned_stop() {
    if (fs.stat(SING_BOX_PLANNED_STOP_FILE) == null)
        return true;
    fs.unlink(SING_BOX_PLANNED_STOP_FILE);
    return fs.stat(SING_BOX_PLANNED_STOP_FILE) == null;
}

function sing_box_planned_stop() {
    return fs.stat(SING_BOX_PLANNED_STOP_FILE) != null;
}

function log_message(message, level) {
    level = as_string(level || "info");
    command_success_from_args([ "logger", "-t", SERVICE_NAME, "[" + level + "] " + as_string(message) ]);
}

function lifecycle_env() {
    return {
        FORKOP_CONFIG_NAME: CONFIG_NAME,
        FORKOP_LIB: LIB_DIR,
        FORKOP_BIN: BIN_PATH,
        FORKOP_SERVICE_INIT: SERVICE_INIT,
        FORKOP_RUNTIME_STATE_DIR: RUNTIME_STATE_DIR,
        FORKOP_SYSTEM_INFO_CACHE_FILE: SYSTEM_INFO_CACHE_FILE,
        FORKOP_SECTION_CACHE_DIR: SECTION_CACHE_DIR,
        FORKOP_RULE_CONDITION_CACHE_DIR: RULE_CONDITION_CACHE_DIR,
        FORKOP_RUNTIME_CACHE_FORMAT: as_string(RUNTIME_CACHE_FORMAT),
        FORKOP_PENDING_RELOAD_FILE: PENDING_RELOAD_FILE,
        FORKOP_RELOAD_LOCK_DIR: RELOAD_LOCK_DIR,
        FORKOP_SING_BOX_PLANNED_STOP_FILE: SING_BOX_PLANNED_STOP_FILE,
        SB_SERVICE_MIXED_INBOUND_ADDRESS: SB_SERVICE_MIXED_INBOUND_ADDRESS,
        SB_SERVICE_MIXED_INBOUND_PORT: SB_SERVICE_MIXED_INBOUND_PORT,
        ZAPRET_PROVIDER_NFQWS_BIN: ZAPRET_PROVIDER_NFQWS_BIN,
        ZAPRET2_PROVIDER_NFQWS2_BIN: ZAPRET2_PROVIDER_NFQWS2_BIN,
        BYEDPI_BIN: BYEDPI_BIN,
        FORKOP_RULE_CONDITION_CACHE_ENABLED: as_string(rule_condition_cache_enabled)
    };
}

function command_env(assignments) {
    let parts = [];
    for (let name, value in assignments)
        push(parts, as_string(name) + "=" + shell_quote(value));
    return join(" ", parts);
}

function module_args(module_path, args) {
    let result = [ "ucode", "-L", LIB_DIR, module_path ];
    for (let arg in (type(args) == "array" ? args : []))
        push(result, arg);
    return result;
}

function module_command(module_path, args) {
    return command_env(lifecycle_env()) + " " + command_from_args(module_args(module_path, args));
}

function module_capture(module_path, args) {
    return command_capture(module_command(module_path, args));
}

function module_status(module_path, args) {
    return command_status(module_command(module_path, args));
}

function module_success(module_path, args) {
    return module_status(module_path, args) == 0;
}

function mark_pending_reload(reason) {
    return module_success(STATE_UC, [ "mark-pending-reload", PENDING_RELOAD_FILE, reason ]);
}

function pending_reload_log_context(reason) {
    reason = as_string(reason);
    if (reason == "config_changed_during_reload")
        return "current reload";
    return "startup";
}

function mark_pending_reload_if_config_changed(initial_fingerprint, reason) {
    initial_fingerprint = as_string(initial_fingerprint);
    if (initial_fingerprint == "")
        return false;

    let current_fingerprint = external_config_fingerprint();
    if (current_fingerprint == "" || current_fingerprint == initial_fingerprint)
        return false;

    let context = pending_reload_log_context(reason);
    if (mark_pending_reload(reason)) {
        log_message("Configuration changed during " + context + "; queued reload after " + context + " completes", "info");
        return true;
    }

    log_message("Configuration changed during " + context + ", but pending reload could not be queued", "warn");
    return false;
}

function finish_reload_status(status, initial_fingerprint) {
    status = int(status || 0);
    if (status == 0)
        mark_pending_reload_if_config_changed(initial_fingerprint, "config_changed_during_reload");
    return status;
}

function module_output(module_path, args) {
    let result = module_capture(module_path, args);
    return result.status == 0 ? result.output : "";
}

function selector_state_from_proxies_payload(payload) {
    let result = {};
    let proxies = object_or_empty(object_or_empty(payload).proxies);

    for (let tag, proxy in proxies) {
        proxy = object_or_empty(proxy);
        let proxy_type = lc(as_string(proxy.type || ""));
        let selected = as_string(proxy.now || "");

        if (proxy_type == "selector" && string_array_contains(proxy.all, selected))
            result[as_string(tag)] = selected;
    }

    return result;
}

function selector_restore_pairs(snapshot, payload) {
    let result = [];
    snapshot = object_or_empty(snapshot);
    let proxies = object_or_empty(object_or_empty(payload).proxies);

    for (let group, selected in snapshot) {
        group = as_string(group);
        selected = as_string(selected);

        if (group == "" || selected == "")
            continue;

        let proxy = object_or_empty(proxies[group]);
        if (lc(as_string(proxy.type || "")) != "selector")
            continue;
        if (!string_array_contains(proxy.all, selected))
            continue;
        if (as_string(proxy.now || "") == selected)
            continue;

        push(result, { group, proxy: selected });
    }

    return result;
}

function clash_api_json(action, arg1, arg2, arg3) {
    let result = module_capture(DIAGNOSTICS_UC, [
        "clash-api",
        action,
        as_string(arg1 || ""),
        as_string(arg2 || ""),
        as_string(arg3 || "")
    ]);
    if (result.status != 0)
        return null;

    try {
        return json(result.output);
    }
    catch (e) {
        return null;
    }
}

function capture_selector_state() {
    return selector_state_from_proxies_payload(clash_api_json("get_proxies"));
}

function restore_selector_state(snapshot) {
    let pairs = selector_restore_pairs(snapshot, clash_api_json("get_proxies"));

    for (let pair in pairs)
        module_success(DIAGNOSTICS_UC, [ "clash-api", "set_group_proxy", pair.group, pair.proxy, "" ]);
}

function module_background(module_path, args) {
    return command_status(module_command(module_path, args) + " >/dev/null 2>&1 1000>&- &") == 0;
}

function config_get(path, fallback) {
    path = as_string(path);
    if (!uci_core.exists(path))
        return as_string(fallback);
    return trim(uci_core.get(path));
}

function config_set(path, value) {
    return uci_core.set(path, value);
}

function file_md5(path) {
    path = as_string(path);
    if (path == "" || fs.stat(path) == null)
        return "";

    let output = command_output("md5sum " + shell_quote(path) + " 2>/dev/null");
    let fields = split(trim(output), /[ \t\r\n]+/);
    return length(fields) > 0 ? as_string(fields[0]) : "";
}

function current_config_hash() {
    return file_md5(CONFIG_FILE);
}

function mark_internal_config_guard() {
    let hash = current_config_hash();
    if (hash == "") {
        fs.unlink(INTERNAL_CONFIG_TRIGGER_GUARD);
        return;
    }

    let stamp = clock();
    let tmp_path = INTERNAL_CONFIG_TRIGGER_GUARD + "." + stamp[0] + "." + stamp[1];
    fs.writefile(tmp_path, as_string(stamp[0]) + "\n" + hash + "\n");
    if (!fs.rename(tmp_path, INTERNAL_CONFIG_TRIGGER_GUARD))
        fs.unlink(tmp_path);
}

function config_commit() {
    if (!uci_core.commit(CONFIG_NAME))
        return 1;
    mark_internal_config_guard();
    return 0;
}

function mark_runtime_stopped_clean() {
    let status = 0;
    if (!config_set(CONFIG_NAME + ".settings.shutdown_correctly", "1"))
        status = 1;
    else {
        let commit_status = config_commit();
        if (commit_status != 0)
            status = commit_status;
    }

    module_success(STATE_UC, [ "clear-reload-state", RELOAD_STATE_FILE, RELOAD_STATE_SNAPSHOT_FILE ]);
    return status;
}

function setting_bool(name, fallback) {
    let value = config_get(CONFIG_NAME + ".settings." + as_string(name), fallback ? "1" : "0");
    return bool_text(value);
}

function dns_apply_status(args) {
    return module_status(DNS_APPLY_UC, args);
}

function dns_apply_success(args) {
    return dns_apply_status(args) == 0;
}

function dnsmasq_configure(force) {
    let args = [ "configure" ];
    if (force)
        push(args, "force");
    return dns_apply_status(args);
}

function dnsmasq_restore(force) {
    let args = [ "restore" ];
    if (force)
        push(args, "force");
    return dns_apply_status(args);
}

function dnsmasq_restore_fail_safe() {
    return dns_apply_status([ "failsafe-restore" ]);
}

function dnsmasq_has_forkop_managed_state() {
    return dns_apply_success([ "has-managed-state" ]);
}

function validate_start_config() {
    let status = module_status(VALIDATOR_UC, [ "check-requirements" ]);
    if (status != 0)
        return status;

    status = module_status(SERVER_UC, [ "prepare-all-defaults" ]);
    if (status != 0)
        return status;

    status = module_status(VALIDATOR_UC, [ "validate-runtime" ]);
    if (status != 0) {
        log_message("Runtime config validation failed. Aborted.", "fatal");
        return status;
    }

    return 0;
}

function nft_rebuild_runtime() {
    return module_status(NFT_UC, [
        "nft-rebuild-runtime-from-uci",
        RT_TABLE_NAME,
        NFT_TABLE_NAME,
        NFT_LOCALV4_SET_NAME,
        NFT_COMMON_SET_NAME,
        NFT_PORT_SET_NAME,
        NFT_IP_PORT_SET_NAME,
        NFT_INTERFACE_SET_NAME,
        NFT_FAKEIP_MARK,
        NFT_OUTBOUND_MARK,
        SB_FAKEIP_INET4_RANGE,
        SB_TPROXY_INBOUND_PORT,
        ZAPRET_PROVIDER_NFQWS_BIN,
        ZAPRET_ROUTE_MARK_BASE,
        ZAPRET_QUEUE_BASE,
        ZAPRET_DESYNC_MARK,
        ZAPRET_DESYNC_MARK_POSTNAT,
        ZAPRET2_PROVIDER_NFQWS2_BIN,
        ZAPRET2_ROUTE_MARK_BASE,
        ZAPRET2_QUEUE_BASE,
        ZAPRET2_DESYNC_MARK,
        ZAPRET2_DESYNC_MARK_POSTNAT,
        NFT_LOCALV6_SET_NAME,
        NFT_COMMON6_SET_NAME,
        NFT_IP_PORT6_SET_NAME,
        SB_FAKEIP_INET6_RANGE,
        SB_TPROXY_INBOUND6_ADDRESS
    ]);
}

function nft_populate_runtime_sets() {
    return module_status(NFT_UC, [
        "nft-populate-runtime-sets-from-uci",
        as_string(nft_populate_enabled),
        "",
        NFT_TABLE_NAME,
        NFT_COMMON_SET_NAME,
        NFT_PORT_SET_NAME,
        NFT_IP_PORT_SET_NAME,
        NFT_INTERFACE_SET_NAME,
        NFT_LOCALV4_SET_NAME,
        NFT_FAKEIP_MARK,
        NFT_COMMON6_SET_NAME,
        NFT_IP_PORT6_SET_NAME,
        NFT_LOCALV6_SET_NAME
    ]);
}

function singbox_init_config() {
    return module_status(SINGBOX_UC, [ "init-config", as_string(nft_populate_enabled), "0" ]);
}

function singbox_init_config_for_live_reload() {
    return module_status(SINGBOX_UC, [ "init-config", as_string(nft_populate_enabled), "1" ]);
}

function clash_controller_preflight(config_path, netstat_data) {
    config_path = as_string(config_path || config_get(CONFIG_NAME + ".settings.config_path", ""));
    let config = read_json_file(config_path);
    let experimental = type(config) == "object" && type(config.experimental) == "object" ? config.experimental : {};
    let clash_api = type(experimental.clash_api) == "object" ? experimental.clash_api : {};
    let controller = as_string(clash_api.external_controller);
    if (controller == "")
        return 0;

    if (netstat_data == null)
        netstat_data = command_output_from_args([ "netstat", "-lnt" ]);
    if (!core_netstat.tcp_endpoint_in_use(netstat_data, controller))
        return 0;

    log_message("Clash API address " + controller + " is already in use by another process. Aborted.", "fatal");
    return 1;
}

function refresh_cron() {
    return module_status(UPDATES_UC, [
        "refresh-cron-from-uci",
        BIN_PATH,
        COMPONENT_UPDATE_CHECK_CRON_MARKER
    ]);
}

function remove_cron_jobs() {
    return module_status(UPDATES_UC, [
        "remove-cron-jobs",
        COMPONENT_UPDATE_CHECK_CRON_MARKER
    ]);
}

function start_main() {
    let status;

    log_message("Starting Forkop", "info");

    status = validate_start_config();
    if (status != 0)
        return status;

    startup_config_fingerprint = external_config_fingerprint();

    status = module_status(NFT_UC, [ "ensure-bridge-netfilter-disabled" ]);
    if (status != 0)
        return status;

    module_success(STATE_UC, [ "sync-time-if-needed" ]);

    status = nft_rebuild_runtime();
    if (status != 0)
        return status;

    status = module_status(SINGBOX_UC, [ "configure-service" ]);
    if (status != 0)
        return status;

    status = singbox_init_config();
    if (status != 0)
        return status;

    status = clash_controller_preflight();
    if (status != 0)
        return status;

    status = refresh_cron();
    if (status != 0)
        return status;

    module_success(BYEDPI_UC, [ "start-runtime" ]);

    if (!command_success_from_args([ "/etc/init.d/sing-box", "start" ])) {
        log_message("Failed to start sing-box. Aborted.", "fatal");
        return 1;
    }

    status = module_status(STATE_UC, [
        "wait-forkop-stable-start",
        RT_TABLE_NAME,
        NFT_TABLE_NAME,
        NFT_FAKEIP_MARK,
        as_string(SING_BOX_START_STABLE_MIN_AGE)
    ]);
    if (status != 0) {
        log_message("sing-box did not reach a stable running state after start. Aborted.", "fatal");
        return status;
    }

    status = module_status(SINGBOX_WATCH_UC, [ "start-worker" ]);
    if (status != 0)
        return status;

    module_success(ZAPRET_UC, [ "start-runtime" ]);
    module_success(ZAPRET2_UC, [ "start-runtime" ]);

    status = module_status(RULESET_SYNC_UC, [ "start-worker" ]);
    if (status != 0)
        return status;

    return 0;
}

function start_impl() {
    if (command_success_from_args([ "pgrep", "-x", "sing-box" ]) ||
        command_success_from_args([ "pgrep", "-f", "^/usr/bin/sing-box[[:space:]]" ])) {
        log_message("sing-box is still running; refusing to start a second process", "error");
        return 1;
    }

    let status = start_main();
    if (status != 0)
        return status;

    if (!setting_bool("dont_touch_dhcp", false)) {
        status = dnsmasq_configure(false);
        if (status != 0)
            return status;
    }
    else if (dnsmasq_has_forkop_managed_state()) {
        status = dnsmasq_restore(true);
        if (status != 0)
            return status;
    }

    if (!config_set(CONFIG_NAME + ".settings.shutdown_correctly", "0"))
        return 1;

    status = config_commit();
    if (status != 0)
        return status;

    status = module_status(STATE_UC, [
        "write-current-reload-state-clean",
        RELOAD_STATE_FILE,
        as_string(RELOAD_STATE_FORMAT),
        RULE_CONDITION_CACHE_DIR
    ]);
    if (status != 0)
        return status;

    if (!clear_sing_box_planned_stop()) {
        log_message("Failed to arm the sing-box crash watcher after start", "error");
        return 1;
    }

    module_background(DIAGNOSTICS_UC, [ "get-system-info" ]);
    return 0;
}

function stop_main() {
    let status = 0;

    log_message("Stopping Forkop", "info");
    module_success(SINGBOX_WATCH_UC, [ "stop-worker" ]);
    module_success(RULESET_SYNC_UC, [ "stop-worker" ]);
    remove_cron_jobs();

    module_success(ZAPRET_UC, [ "stop-runtime" ]);
    module_success(ZAPRET2_UC, [ "stop-runtime" ]);
    module_success(BYEDPI_UC, [ "stop-runtime" ]);

    if (command_success_from_args([ "nft", "list", "table", "inet", NFT_TABLE_NAME ]))
        command_success_from_args([ "nft", "delete", "table", "inet", NFT_TABLE_NAME ]);

    if (module_success(NFT_UC, [ "tproxy-marking-rule4-present", RT_TABLE_NAME, NFT_FAKEIP_MARK ]))
        command_success_from_args([ "ip", "-4", "rule", "del", "fwmark", NFT_FAKEIP_MARK + "/" + NFT_FAKEIP_MARK, "table", RT_TABLE_NAME, "priority", "105" ]);
    if (module_success(NFT_UC, [ "tproxy-marking-rule6-present", RT_TABLE_NAME, NFT_FAKEIP_MARK ]))
        command_success_from_args([ "ip", "-6", "rule", "del", "fwmark", NFT_FAKEIP_MARK + "/" + NFT_FAKEIP_MARK, "table", RT_TABLE_NAME, "priority", "105" ]);

    if (module_success(NFT_UC, [ "tproxy-route4-present", RT_TABLE_NAME ]))
        command_success_from_args([ "ip", "route", "flush", "table", RT_TABLE_NAME ]);
    if (module_success(NFT_UC, [ "tproxy-route6-present", RT_TABLE_NAME ]))
        command_success_from_args([ "ip", "-6", "route", "flush", "table", RT_TABLE_NAME ]);

    let sing_box_status = command_status_from_args([ "/etc/init.d/sing-box", "stop" ]);
    if (sing_box_status != 0)
        status = sing_box_status;
    if (!module_success(STATE_UC, [
        "wait-sing-box-stopped",
        getenv("FORKOP_SING_BOX_RELOAD_PID_TIMEOUT") || "15"
    ]))
        status = status == 0 ? 1 : status;

    return status;
}

function cleanup_failed_runtime() {
    let status = 0;

    log_message("Cleaning up Forkop runtime after failed start/reload", "info");

    let stop_status = stop_main();
    if (stop_status != 0)
        status = stop_status;

    let dns_status = dnsmasq_restore_fail_safe();
    if (dns_status != 0 && status == 0)
        status = dns_status;

    if (status == 0) {
        let mark_status = mark_runtime_stopped_clean();
        if (mark_status != 0)
            status = mark_status;
    }

    if (status != 0)
        log_message("Failed to fully clean up Forkop runtime after start/reload failure", "warn");

    return status;
}

function cleanup_crashed_sing_box(exit_code) {
    let suffix = match(as_string(exit_code), /^[0-9]+$/) != null ? " (exit code " + as_string(exit_code) + ")" : "";
    let pid = owner_pid();
    if (!module_success(STATE_UC, [ "acquire-runtime-dir-lock-wait", START_LOCK_DIR, pid, as_string(START_LOCK_TIMEOUT) ])) {
        log_message("Timed out waiting for Forkop lifecycle cleanup lock", "error");
        return 1;
    }
    if (sing_box_planned_stop()) {
        module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, pid ]);
        return 0;
    }
    if (module_success(STATE_UC, [ "forkop-running", RT_TABLE_NAME, NFT_TABLE_NAME, NFT_FAKEIP_MARK ])) {
        module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, pid ]);
        return 0;
    }
    log_message("sing-box stopped after repeated crashes" + suffix, "fatal");
    let status = cleanup_failed_runtime();
    module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, pid ]);
    return status;
}

function abort_reload(status, runtime_changed) {
    status = int(status || 0);
    if (status == 0)
        status = 1;

    if (runtime_changed)
        cleanup_failed_runtime();
    else
        remove_file(RELOAD_STATE_SNAPSHOT_FILE);

    return status;
}

function start() {
    if (module_success(STATE_UC, [ "forkop-running", RT_TABLE_NAME, NFT_TABLE_NAME, NFT_FAKEIP_MARK ])) {
        log_message("Forkop is already running; duplicate start skipped", "info");
        return 0;
    }
    if (!module_success(STATE_UC, [ "acquire-runtime-dir-lock-wait", START_LOCK_DIR, owner_pid(), as_string(START_LOCK_TIMEOUT) ])) {
        log_message("Timed out waiting for another Forkop start to finish", "error");
        return 1;
    }
    if (module_success(STATE_UC, [ "forkop-running", RT_TABLE_NAME, NFT_TABLE_NAME, NFT_FAKEIP_MARK ])) {
        module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, owner_pid() ]);
        log_message("Forkop became ready while another start was running; duplicate start skipped", "info");
        return 0;
    }
    if (module_success(STATE_UC, [ "sing-box-service-running" ])) {
        let cleanup_status = cleanup_failed_runtime();
        if (cleanup_status != 0 || module_success(STATE_UC, [ "sing-box-service-running" ])) {
            log_message("A previous sing-box process could not be stopped safely; refusing a second start", "error");
            module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, owner_pid() ]);
            return cleanup_status != 0 ? cleanup_status : 1;
        }
    }

    let status = start_impl();

    if (status != 0) {
        cleanup_failed_runtime();
        module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, owner_pid() ]);
        return status;
    }

    mark_pending_reload_if_config_changed(startup_config_fingerprint, "config_changed_during_start");

    status = module_status(STATE_UC, [
        "wait-forkop-stable-start",
        RT_TABLE_NAME,
        NFT_TABLE_NAME,
        NFT_FAKEIP_MARK,
        as_string(RUNTIME_STABLE_MIN_AGE)
    ]);
    if (status != 0) {
        log_message("Startup verification failed after Forkop was started; rolling back DNS changes", "warn");
        cleanup_failed_runtime();
        module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, owner_pid() ]);
        return status;
    }

    module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, owner_pid() ]);
    return 0;
}

function stop_impl() {
    let status = 0;

    if (!mark_sing_box_planned_stop())
        log_message("Failed to mark the planned sing-box stop", "warn");
    module_success(SINGBOX_WATCH_UC, [ "stop-worker" ]);

    if (!setting_bool("dont_touch_dhcp", false)) {
        let dns_status = dnsmasq_restore(false);
        if (dns_status != 0)
            status = dns_status;
    }
    else if (dnsmasq_has_forkop_managed_state()) {
        let dns_status = dnsmasq_restore(true);
        if (dns_status != 0)
            status = dns_status;
    }

    let runtime_status = stop_main();
    if (runtime_status != 0)
        status = runtime_status;

    if (!config_set(CONFIG_NAME + ".settings.shutdown_correctly", "1"))
        status = 1;
    else {
        let commit_status = config_commit();
        if (commit_status != 0)
            status = commit_status;
    }

    module_success(STATE_UC, [ "clear-reload-state", RELOAD_STATE_FILE, RELOAD_STATE_SNAPSHOT_FILE ]);

    if (status != 0)
        dnsmasq_restore_fail_safe();

    return status;
}

function stop() {
    let pid = owner_pid();
    if (!module_success(STATE_UC, [ "acquire-runtime-dir-lock-wait", START_LOCK_DIR, pid, as_string(START_LOCK_TIMEOUT) ])) {
        log_message("Timed out waiting for another Forkop lifecycle action", "error");
        return 1;
    }
    let status = stop_impl();
    module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, pid ]);
    return status;
}

function restart_runtime_for_reload_locked() {
    let status;
    let selector_state = capture_selector_state();

    log_message("Reload requires a full Forkop runtime restart", "info");

    status = stop_main();
    if (status != 0)
        return status;

    status = start_impl();
    if (status != 0) {
        cleanup_failed_runtime();
        return status;
    }

    status = module_status(STATE_UC, [
        "wait-forkop-stable-start",
        RT_TABLE_NAME,
        NFT_TABLE_NAME,
        NFT_FAKEIP_MARK,
        as_string(RUNTIME_STABLE_MIN_AGE)
    ]);
    if (status != 0) {
        log_message("Reload runtime restart verification failed after Forkop was started; rolling back DNS changes", "fatal");
        cleanup_failed_runtime();
        return status;
    }

    restore_selector_state(selector_state);
    remove_file(RELOAD_STATE_SNAPSHOT_FILE);
    return 0;
}

function write_service_trigger_sync_state(changed) {
    ensure_dir(RUNTIME_STATE_DIR);
    write_file(SERVICE_TRIGGER_SYNC_FILE, as_string(changed) + "\n");
}

function parse_reload_plan(output) {
    let result = {
        changed_service_triggers: 0,
        changed_dnsmasq: 0,
        changed_sing_box: 0,
        changed_nft: 0,
        changed_zapret_queue: 0,
        changed_zapret_runtime: 0,
        changed_zapret2_queue: 0,
        changed_zapret2_runtime: 0,
        changed_byedpi_runtime: 0,
        changed_cron: 0,
        needs_sing_box_reload: 0,
        needs_nft_rebuild: 0,
        needs_zapret_restart: 0,
        needs_zapret2_restart: 0,
        needs_byedpi_restart: 0,
        needs_dnsmasq_configure: 0,
        needs_dnsmasq_restore: 0,
        needs_cron_refresh: 0,
        has_work: 0
    };

    for (let line in split(as_string(output), "\n")) {
        line = as_string(line);
        if (line == "")
            continue;
        let fields = split(line, "\t");
        if (length(fields) < 2)
            continue;
        let key = fields[0];
        if (result[key] != null)
            result[key] = int(fields[1] || 0);
    }

    return result;
}

function append_reload_action(actions, enabled, label) {
    if (!(enabled === true || int(enabled || 0) == 1))
        return actions;
    return actions + (actions != "" ? ", " : "") + label;
}

function reload_actions_summary(plan) {
    let actions = "";
    actions = append_reload_action(actions, plan.needs_sing_box_reload, "sing-box");
    actions = append_reload_action(actions, plan.needs_nft_rebuild, "nftables");
    actions = append_reload_action(actions, plan.needs_zapret_restart, "Zapret");
    actions = append_reload_action(actions, plan.needs_zapret2_restart, "Zapret2");
    actions = append_reload_action(actions, plan.needs_byedpi_restart, "ByeDPI");
    actions = append_reload_action(actions, plan.needs_dnsmasq_configure || plan.needs_dnsmasq_restore, "dnsmasq");
    actions = append_reload_action(actions, plan.needs_cron_refresh, "scheduled jobs");
    return actions;
}

function reload_impl(reason) {
    let status;
    let force_runtime_reload = as_string(reason || "") == "on_config_change" ? 0 : 1;
    let reload_config_fingerprint = external_config_fingerprint();
    rule_condition_cache_enabled = force_runtime_reload;

    log_message("Reloading Forkop", "info");

    status = validate_start_config();
    if (status != 0)
        return status;

    if (!module_success(STATE_UC, [ "forkop-running", RT_TABLE_NAME, NFT_TABLE_NAME, NFT_FAKEIP_MARK ])) {
        log_message("Runtime state is incomplete; restarting Forkop runtime", "info");
        return finish_reload_status(restart_runtime_for_reload_locked(), reload_config_fingerprint);
    }

    remove_file(RELOAD_STATE_SNAPSHOT_FILE);
    status = module_status(STATE_UC, [
        "capture-reload-state",
        RELOAD_STATE_SNAPSHOT_FILE,
        as_string(RELOAD_STATE_FORMAT)
    ]);
    if (status != 0)
        return status;

    let current_reload_state_file = trim(command_output_from_args([ "mktemp" ]));
    if (current_reload_state_file == "")
        return abort_reload(1, false);

    status = module_status(STATE_UC, [
        "write-captured-reload-state",
        current_reload_state_file,
        RELOAD_STATE_SNAPSHOT_FILE,
        as_string(RELOAD_STATE_FORMAT),
        "",
        "0",
        "0"
    ]);
    if (status != 0) {
        remove_file(current_reload_state_file);
        return abort_reload(status, false);
    }

    let dnsmasq_managed_state = dnsmasq_has_forkop_managed_state() ? 1 : 0;
    let runtime_cache_needs_rebuild = as_string(getenv("FORKOP_RUNTIME_CACHE_INVALIDATED") || "0") == "1" ? 1 : 0;

    let plan_result = module_capture(RELOAD_UC, [
        "plan-state-files",
        RELOAD_STATE_FILE,
        current_reload_state_file,
        as_string(force_runtime_reload),
        as_string(dnsmasq_managed_state),
        as_string(runtime_cache_needs_rebuild)
    ]);
    remove_file(current_reload_state_file);

    if (plan_result.status != 0) {
        if (plan_result.status == 2) {
            log_message("Reload state is unavailable; restarting Forkop runtime", "info");
            return finish_reload_status(restart_runtime_for_reload_locked(), reload_config_fingerprint);
        }
        return abort_reload(plan_result.status, false);
    }

    let plan = parse_reload_plan(plan_result.output);
    write_service_trigger_sync_state(plan.changed_service_triggers);

    if (plan.has_work == 0) {
        status = module_status(STATE_UC, [
            "write-captured-reload-state",
            RELOAD_STATE_FILE,
            RELOAD_STATE_SNAPSHOT_FILE,
            as_string(RELOAD_STATE_FORMAT),
            RULE_CONDITION_CACHE_DIR,
            "1",
            "1"
        ]);
        if (status == 0)
            log_message("Reload skipped: runtime-relevant configuration is unchanged", "info");
        return finish_reload_status(status, reload_config_fingerprint);
    }

    let actions = reload_actions_summary(plan);
    if (actions != "")
        log_message("Applying reload changes: " + actions, "info");

    if (plan.needs_zapret_restart == 1)
        module_success(ZAPRET_UC, [ "stop-runtime" ]);
    if (plan.needs_zapret2_restart == 1)
        module_success(ZAPRET2_UC, [ "stop-runtime" ]);
    if (plan.needs_byedpi_restart == 1)
        module_success(BYEDPI_UC, [ "stop-runtime" ]);

    let restart_ruleset_sync = plan.needs_nft_rebuild == 1;
    if (restart_ruleset_sync)
        module_success(RULESET_SYNC_UC, [ "stop-worker" ]);

    if (plan.needs_nft_rebuild == 1) {
        log_message("Rebuilding nftables rules", "info");
        status = nft_rebuild_runtime();
        if (status != 0)
            return abort_reload(status, true);
    }

    if (plan.needs_sing_box_reload == 1) {
        status = module_status(SINGBOX_UC, [ "configure-service" ]);
        if (status != 0)
            return abort_reload(status, true);
        let sing_box_config_path = config_get(CONFIG_NAME + ".settings.config_path", "");
        let sing_box_config_hash_before = file_md5(sing_box_config_path);
        let sing_box_pid_result = module_capture(STATE_UC, [ "sing-box-service-runtime-pid" ]);
        let sing_box_pid_before = sing_box_pid_result.status == 0 ? trim(sing_box_pid_result.output) : "";
        nft_populate_enabled = plan.needs_nft_rebuild == 1 ? 1 : 0;
        status = singbox_init_config_for_live_reload();
        if (status != 0)
            return abort_reload(status, true);
        nft_populate_enabled = NFT_POPULATE_ENABLED_DEFAULT;
        status = module_status(STATE_UC, [
            "reload-sing-box-runtime",
            sing_box_pid_before,
            sing_box_config_hash_before,
            file_md5(sing_box_config_path),
            as_string(force_runtime_reload)
        ]);
        if (status != 0)
            return abort_reload(status, true);
        status = module_status(STATE_UC, [
            "wait-forkop-stable-start",
            RT_TABLE_NAME,
            NFT_TABLE_NAME,
            NFT_FAKEIP_MARK,
            as_string(SING_BOX_START_STABLE_MIN_AGE)
        ]);
        if (status != 0) {
            log_message("Reload verification failed after sing-box was reloaded; stopping Forkop runtime", "fatal");
            cleanup_failed_runtime();
            return status;
        }
    }
    else if (plan.needs_nft_rebuild == 1 && nft_populate_enabled == 1) {
        status = nft_populate_runtime_sets();
        if (status != 0)
            return abort_reload(status, true);
    }

    if (restart_ruleset_sync) {
        status = module_status(RULESET_SYNC_UC, [ "start-worker" ]);
        if (status != 0)
            return abort_reload(status, true);
    }

    if (plan.needs_zapret_restart == 1)
        module_success(ZAPRET_UC, [ "start-runtime" ]);
    if (plan.needs_zapret2_restart == 1)
        module_success(ZAPRET2_UC, [ "start-runtime" ]);
    if (plan.needs_byedpi_restart == 1)
        module_success(BYEDPI_UC, [ "start-runtime" ]);

    if (plan.needs_dnsmasq_configure == 1) {
        status = dnsmasq_configure(true);
        if (status != 0)
            return abort_reload(status, true);
        module_success(STATE_UC, [ "capture-reload-state", RELOAD_STATE_SNAPSHOT_FILE, as_string(RELOAD_STATE_FORMAT) ]);
    }
    else if (plan.needs_dnsmasq_restore == 1) {
        status = dnsmasq_restore(true);
        if (status != 0)
            return abort_reload(status, true);
        module_success(STATE_UC, [ "capture-reload-state", RELOAD_STATE_SNAPSHOT_FILE, as_string(RELOAD_STATE_FORMAT) ]);
    }

    if (plan.needs_cron_refresh == 1) {
        status = refresh_cron();
        if (status != 0)
            return abort_reload(status, false);
    }

    return finish_reload_status(module_status(STATE_UC, [
        "write-captured-reload-state",
        RELOAD_STATE_FILE,
        RELOAD_STATE_SNAPSHOT_FILE,
        as_string(RELOAD_STATE_FORMAT),
        RULE_CONDITION_CACHE_DIR,
        "1",
        "1"
    ]), reload_config_fingerprint);
}

function reload(reason) {
    let pid = owner_pid();
    if (!module_success(STATE_UC, [ "acquire-runtime-dir-lock-wait", START_LOCK_DIR, pid, as_string(START_LOCK_TIMEOUT) ])) {
        log_message("Timed out waiting for another Forkop lifecycle action", "error");
        return 1;
    }
    let status = reload_impl(reason);
    module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, pid ]);
    return status;
}

function reload_tracked(reason) {
    if (as_string(getenv("FORKOP_UI_ACTION_TRACKED") || "0") == "1")
        return reload(reason);

    let job_id = trim(module_output(UI_UC, [ "service-action-begin-if-idle", "reload", "runtime_reload" ]));
    if (job_id != "")
        module_success(UI_UC, [ "service-action-update-pid", job_id, owner_pid() ]);

    let status = reload(reason);
    if (job_id != "")
        module_success(UI_UC, [ "service-action-finish-after-command", "reload", job_id, as_string(status) ]);

    return status;
}

function restart() {
    log_message("Restarting Forkop", "info");

    let pid = owner_pid();
    if (!module_success(STATE_UC, [ "acquire-runtime-dir-lock-wait", START_LOCK_DIR, pid, as_string(START_LOCK_TIMEOUT) ])) {
        log_message("Timed out waiting for another Forkop start or restart to finish", "error");
        return 1;
    }

    let selector_state = capture_selector_state();
    let status = stop_impl();
    if (status != 0) {
        module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, pid ]);
        return status;
    }

    status = start_impl();
    if (status != 0) {
        cleanup_failed_runtime();
        module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, pid ]);
        return status;
    }

    if (module_success(STATE_UC, [
        "forkop-stably-running",
        RT_TABLE_NAME,
        NFT_TABLE_NAME,
        NFT_FAKEIP_MARK,
        as_string(RUNTIME_STABLE_MIN_AGE)
    ])) {
        restore_selector_state(selector_state);
        module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, pid ]);
        return 0;
    }

    log_message("Restart verification failed after Forkop was started; stopping Forkop runtime", "fatal");
    cleanup_failed_runtime();
    module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, pid ]);
    return 1;
}

function package_manager_remove_if_installed(package_name) {
    package_name = as_string(package_name);
    if (command_success_from_args([ "sh", "-c", "command -v apk" ])) {
        if (command_success_from_args([ "apk", "info", "-e", package_name ]))
            command_success_from_args([ "apk", "del", package_name ]);
        return;
    }

    if (module_success(PACKAGES_UC, [ "opkg-installed", package_name ]))
        command_success_from_args([ "opkg", "remove", "--force-depends", package_name ]);
}

function uninstall() {
    log_message("Uninstalling Forkop", "info");

    if (fs.stat(SERVICE_INIT) != null) {
        stop();
        command_success_from_args([ SERVICE_INIT, "disable" ]);
    }

    dnsmasq_restore_fail_safe();

    if (fs.stat("/etc/init.d/forkop") != null) {
        command_success_from_args([ "/etc/init.d/forkop", "stop" ]);
        command_success_from_args([ "/etc/init.d/forkop", "disable" ]);
    }

    package_manager_remove_if_installed("luci-i18n-forkop-ru");
    package_manager_remove_if_installed("luci-app-forkop");

    command_success_from_args([ "rm", "-rf", "/usr/lib/forkop" ]);
    command_success_from_args([ "rm", "-rf", LUCI_VIEW_DIR ]);
    remove_file(SERVICE_INIT);
    remove_file(BIN_PATH);
    remove_file("/usr/share/luci/menu.d/luci-app-forkop.json");
    remove_file("/usr/share/rpcd/acl.d/luci-app-forkop.json");
    remove_file("/etc/uci-defaults/50_luci-forkop");
    command_success_from_args([ "find", "/usr/lib/lua/luci/i18n", "-maxdepth", "1", "-type", "f", "-name", LUCI_I18N_DOMAIN + ".*.lmo", "-delete" ]);
    remove_file("/usr/lib/lua/luci/i18n/" + LUCI_I18N_DOMAIN + ".ru.lua");
    remove_file("/usr/lib/lua/luci/i18n/" + LUCI_I18N_DOMAIN + ".en.lua");
    command_success("rm -f /var/luci-indexcache* /tmp/luci-indexcache* 2>/dev/null");
    if (fs.stat("/etc/init.d/rpcd") != null)
        command_success_from_args([ "/etc/init.d/rpcd", "reload" ]);

    print("{\"removed\":true}\n");
    return 0;
}

function enable_service() {
    return command_status_from_args([ SERVICE_INIT, "enable" ]);
}

function disable_service() {
    return command_status_from_args([ SERVICE_INIT, "disable" ]);
}

let mode = ARGV[0] || "";
let status = 1;

if (mode == "main")
    status = start_main();
else if (mode == "sing-box-crash-cleanup")
    status = cleanup_crashed_sing_box(ARGV[1]);
else if (mode == "sing-box-planned-stop-guard-fixture") {
    let action = as_string(ARGV[1]);
    if (action == "mark")
        status = mark_sing_box_planned_stop() ? 0 : 1;
    else if (action == "clear")
        status = clear_sing_box_planned_stop() ? 0 : 1;
    else if (action == "check")
        status = sing_box_planned_stop() ? 0 : 1;
}
else if (mode == "start")
    status = start();
else if (mode == "stop")
    status = stop();
else if (mode == "reload")
    status = reload_tracked(ARGV[1] || "");
else if (mode == "restart")
    status = restart();
else if (mode == "enable")
    status = enable_service();
else if (mode == "disable")
    status = disable_service();
else if (mode == "selector-state-from-proxies-fixture") {
    write_json(selector_state_from_proxies_payload(read_json_file(ARGV[1])));
    status = 0;
}
else if (mode == "selector-restore-pairs-fixture") {
    write_json(selector_restore_pairs(read_json_file(ARGV[1]), read_json_file(ARGV[2])));
    status = 0;
}
else if (mode == "clash-controller-preflight-fixture")
    status = clash_controller_preflight(ARGV[1], fs.readfile(ARGV[2]));
else if (mode == "dnsmasq-restore" || mode == "restore-dnsmasq")
    status = dnsmasq_restore_fail_safe();
else if (mode == "uninstall")
    status = uninstall();
else {
    warn("Usage: service/lifecycle.uc <start|stop|reload|restart|main|sing-box-crash-cleanup|sing-box-planned-stop-guard-fixture|enable|disable|dnsmasq-restore|uninstall> ...\n");
    status = 1;
}

exit(status);
