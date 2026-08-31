#!/usr/bin/env ucode

let fs = require("fs");
let constants = require("core.constants");
let core_netstat = require("core.netstat");
let uci_core = require("core.uci");
let nft_state = require("nft.state");

function as_string(value) {
    return value == null ? "" : "" + value;
}

function constant_value(name, fallback) {
    let value = constants[name];
    return value == null ? as_string(fallback) : as_string(value);
}

const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || constant_value("FORKOP_CONFIG_NAME", "forkop");
const CONFIG_FILE = getenv("FORKOP_CONFIG_FILE") || "/etc/config/" + CONFIG_NAME;
// Routing table and rule cleanup must use the same binary that created them:
// BusyBox `ip` does not report or remove the Forkop table entries reliably.
const IP_BIN = getenv("FORKOP_IP_BIN") || "/usr/libexec/ip-full";
const LIB_DIR = getenv("FORKOP_LIB") || "/usr/lib/forkop";
const BIN_PATH = getenv("FORKOP_BIN") || constant_value("FORKOP_BIN", "/usr/bin/forkop");
const SERVICE_INIT = getenv("FORKOP_SERVICE_INIT") || constant_value("FORKOP_SERVICE_INIT", "/etc/init.d/forkop");
const SING_BOX_INIT = getenv("FORKOP_SING_BOX_INIT") || "/etc/init.d/sing-box";
const SERVICE_NAME = getenv("FORKOP_SERVICE_NAME") || constant_value("FORKOP_SERVICE_NAME", "forkop");
const LUCI_VIEW_DIR = getenv("FORKOP_LUCI_VIEW_DIR") || constant_value("FORKOP_LUCI_VIEW_DIR", "/www/luci-static/resources/view/forkop");
const LUCI_I18N_DOMAIN = getenv("FORKOP_LUCI_I18N_DOMAIN") || constant_value("FORKOP_LUCI_I18N_DOMAIN", "forkop");

const RUNTIME_STATE_DIR = getenv("FORKOP_RUNTIME_STATE_DIR") || "/var/run/forkop";
const RELOAD_STATE_FILE = getenv("FORKOP_RELOAD_STATE_FILE") || RUNTIME_STATE_DIR + "/reload-state";
const RELOAD_STATE_SNAPSHOT_FILE = getenv("FORKOP_RELOAD_STATE_SNAPSHOT_FILE") || RUNTIME_STATE_DIR + "/reload-state.snapshot." + clock()[0] + "." + clock()[1];
const PENDING_RELOAD_FILE = getenv("FORKOP_PENDING_RELOAD_FILE") || RUNTIME_STATE_DIR + "/reload.pending";
const SERVICE_TRIGGER_SYNC_FILE = getenv("FORKOP_SERVICE_TRIGGER_SYNC_FILE") || RUNTIME_STATE_DIR + "/service-triggers.sync";
const RELOAD_LOCK_DIR = getenv("FORKOP_RELOAD_LOCK_DIR") || "/var/run/forkop.reload.lock";
const START_LOCK_DIR = getenv("FORKOP_START_LOCK_DIR") || RUNTIME_STATE_DIR + "/start.lock";
const START_LOCK_TIMEOUT = int(getenv("FORKOP_START_LOCK_TIMEOUT") || "360");
const SING_BOX_PLANNED_STOP_FILE = getenv("FORKOP_SING_BOX_PLANNED_STOP_FILE") || RUNTIME_STATE_DIR + "/sing-box-watch.planned-stop";

const COMPONENT_UPDATE_CHECK_CRON_MARKER = getenv("FORKOP_COMPONENT_UPDATE_CHECK_CRON_MARKER") || "# forkop-component-update-check";
const RELOAD_STATE_FORMAT = int(getenv("FORKOP_RELOAD_STATE_FORMAT") || "3");
// Both lifecycle verifications are the same wait with a different window. A
// start watches a fresh sing-box long enough to see an early crash; a reload
// leaves the process in place and only has to outlast the gap between the HUP
// signal and the ports dropping - measured at 0.2 s on the router, so two
// seconds is a tenfold margin. The hold is how many consecutive one-second
// observations must see readiness before either wait believes it.
const START_READY_WINDOW = int(getenv("FORKOP_START_READY_WINDOW") || "8");
const RELOAD_READY_WINDOW = int(getenv("FORKOP_RELOAD_READY_WINDOW") || "2");
const READY_HOLD = int(getenv("FORKOP_READY_HOLD") || "2");

// The runtime table, its sets and the FakeIP mark are the ones this module tears
// down again on stop. nft/apply.uc reads the rest of that table itself, so the
// names it needs are not repeated here.
const RT_TABLE_NAME = constant_value("RT_TABLE_NAME", "forkop");
const NFT_TABLE_NAME = constant_value("NFT_TABLE_NAME", "ForkopTable");
const NFT_FAKEIP_MARK = constant_value("NFT_FAKEIP_MARK", "0x04000000");

const SB_SERVICE_MIXED_INBOUND_ADDRESS = constant_value("SB_SERVICE_MIXED_INBOUND_ADDRESS", "127.0.0.1");
const SB_SERVICE_MIXED_INBOUND_PORT = constant_value("SB_SERVICE_MIXED_INBOUND_PORT", "4534");

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
const PACKAGES_UC = LIB_DIR + "/core/packages.uc";

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

function command_capture(command) {
    let pipe = fs.popen(command, "r");
    if (!pipe)
        return { status: 1, output: "" };

    let data = pipe.read("all");
    return { status: pipe.close(), output: data == null ? "" : as_string(data) };
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

function command_success(command) {
    return system(command + " >/dev/null 2>&1") == 0;
}

function command_status_from_args(args) {
    return system(command_from_args(args));
}

function command_output_from_args(args) {
    return command_output(command_from_args(args) + " 2>/dev/null");
}

function command_success_from_args(args) {
    return system(command_from_args(args) + " >/dev/null 2>&1") == 0;
}

function file_executable(path) {
    let stat = fs.stat(as_string(path));
    return stat != null && stat.mode != null && (int(stat.mode) & 73) != 0;
}

function stop_sing_box_service() {
    if (!file_executable(SING_BOX_INIT))
        return 0;
    return command_status_from_args([ SING_BOX_INIT, "stop" ]);
}

function external_config_fingerprint() {
    let data = fs.readfile(CONFIG_FILE);
    return data == null ? "" : as_string(data);
}

function trim(value) {
    return replace(as_string(value), /^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

function owner_pid() {
    let stat = as_string(fs.readfile("/proc/self/stat"));
    let separator = index(stat, " ");
    return separator > 0 ? substr(stat, 0, separator) : "0";
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
    message = as_string(message);
    command_success_from_args([ "logger", "-t", SERVICE_NAME, "[" + level + "] " + message ]);
    // A lifecycle command is asked for by somebody, and the reason it failed is
    // the one thing that caller needs. procd discards the output of the commands
    // it runs itself, so this only ever reaches a person - who until now got an
    // exit code and had to go look the reason up in the system log.
    if (level == "error")
        warn(message, "\n");
}

function lifecycle_env() {
    return {
        FORKOP_CONFIG_NAME: CONFIG_NAME,
        FORKOP_LIB: LIB_DIR,
        FORKOP_BIN: BIN_PATH,
        FORKOP_SERVICE_INIT: SERVICE_INIT,
        FORKOP_RUNTIME_STATE_DIR: RUNTIME_STATE_DIR,
        FORKOP_PENDING_RELOAD_FILE: PENDING_RELOAD_FILE,
        FORKOP_RELOAD_LOCK_DIR: RELOAD_LOCK_DIR,
        FORKOP_SING_BOX_PLANNED_STOP_FILE: SING_BOX_PLANNED_STOP_FILE,
        SB_SERVICE_MIXED_INBOUND_ADDRESS: SB_SERVICE_MIXED_INBOUND_ADDRESS,
        SB_SERVICE_MIXED_INBOUND_PORT: SB_SERVICE_MIXED_INBOUND_PORT
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
    return system(module_command(module_path, args));
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

function module_background(module_path, args) {
    return system(module_command(module_path, args) + " >/dev/null 2>&1 1000>&- &") == 0;
}

function config_get(path, fallback) {
    path = as_string(path);
    if (!uci_core.exists(path))
        return as_string(fallback);
    return trim(uci_core.get(path));
}

function file_md5(path) {
    path = as_string(path);
    if (path == "" || fs.stat(path) == null)
        return "";

    let output = command_output("md5sum " + shell_quote(path) + " 2>/dev/null");
    let fields = split(trim(output), /[ \t\r\n]+/);
    return length(fields) > 0 ? as_string(fields[0]) : "";
}

function mark_runtime_stopped_clean() {
    module_success(STATE_UC, [ "clear-reload-state", RELOAD_STATE_FILE, RELOAD_STATE_SNAPSHOT_FILE ]);
    return 0;
}

function validate_start_config() {
    let status = module_status(VALIDATOR_UC, [ "check-requirements" ]);
    if (status != 0)
        return status;

    status = module_status(SERVER_UC, [ "prepare-all-defaults" ]);
    if (status != 0)
        return status;

    // The validator names the option and the value it refused, so the reason is
    // logged next to the failure instead of being discarded with its output.
    let validation = module_capture(VALIDATOR_UC, [ "validate-runtime" ]);
    if (validation.status != 0) {
        for (let line in split(as_string(validation.output), "\n")) {
            line = trim(line);
            if (line != "")
                log_message(line, "error");
        }
        log_message("Runtime config validation failed. Aborted.", "error");
        return validation.status;
    }

    // Only once the configuration is known good: the firewall opens the ports of the
    // servers that asked for it, and a rejected configuration must not open any.
    module_success(SERVER_UC, [ "sync-firewall" ]);

    return 0;
}

function nft_rebuild_runtime() {
    return module_status(NFT_UC, [ "nft-rebuild-runtime-from-uci" ]);
}

function nft_populate_runtime_sets() {
    return module_status(NFT_UC, [
        "nft-populate-runtime-sets-from-uci",
        "1",
        "",
        NFT_TABLE_NAME
    ]);
}

function singbox_init_config(populate_nft_sets) {
    return module_status(SINGBOX_UC, [ "init-config", populate_nft_sets ? "1" : "0", "0" ]);
}

// A live reload only refills the nft runtime sets when the rules were rebuilt;
// otherwise they still hold what the running configuration put there.
function singbox_init_config_for_live_reload(populate_nft_sets) {
    return module_status(SINGBOX_UC, [ "init-config", populate_nft_sets ? "1" : "0", "1" ]);
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

    status = module_status(SINGBOX_UC, [ "configure-service" ]);
    if (status != 0)
        return status;

    status = singbox_init_config(false);
    if (status != 0)
        return status;

    status = clash_controller_preflight();
    if (status != 0)
        return status;

    status = refresh_cron();
    if (status != 0)
        return status;

    if (!command_success_from_args([ SING_BOX_INIT, "start" ])) {
        log_message("Failed to start sing-box. Aborted.", "fatal");
        return 1;
    }

    status = module_status(STATE_UC, [
        "wait-sing-box-ready",
        as_string(START_READY_WINDOW),
        as_string(READY_HOLD)
    ]);
    if (status != 0) {
        log_message("sing-box did not reach a stable running state after start. Aborted.", "fatal");
        return status;
    }

    status = nft_rebuild_runtime();
    if (status != 0)
        return status;

    status = nft_populate_runtime_sets();
    if (status != 0)
        return status;

    status = module_status(STATE_UC, [
        "wait-forkop-ready",
        RT_TABLE_NAME,
        NFT_TABLE_NAME,
        NFT_FAKEIP_MARK,
        "0",
        "0"
    ]);
    if (status != 0) {
        log_message("Forkop runtime was not ready after nftables activation. Aborted.", "fatal");
        return status;
    }

    status = module_status(SINGBOX_WATCH_UC, [ "start-worker" ]);
    if (status != 0)
        return status;

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

    status = module_status(STATE_UC, [
        "write-current-reload-state-clean",
        RELOAD_STATE_FILE,
        as_string(RELOAD_STATE_FORMAT)
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

function cleanup_network_runtime() {
    let status = 0;

    if (nft_state.table_present(NFT_TABLE_NAME) &&
        (!command_success_from_args([ "nft", "delete", "table", "inet", NFT_TABLE_NAME ]) ||
            nft_state.table_present(NFT_TABLE_NAME))) {
        log_message("Failed to remove the Forkop nftables table", "error");
        status = 1;
    }

    if (nft_state.tproxy_marking_rule4_present(RT_TABLE_NAME, NFT_FAKEIP_MARK) &&
        (!command_success_from_args([ IP_BIN, "-4", "rule", "del", "fwmark", NFT_FAKEIP_MARK + "/" + NFT_FAKEIP_MARK, "table", RT_TABLE_NAME, "priority", "105" ]) ||
            nft_state.tproxy_marking_rule4_present(RT_TABLE_NAME, NFT_FAKEIP_MARK))) {
        log_message("Failed to remove the Forkop IPv4 routing rule", "error");
        status = 1;
    }
    if (nft_state.tproxy_marking_rule6_present(RT_TABLE_NAME, NFT_FAKEIP_MARK) &&
        (!command_success_from_args([ IP_BIN, "-6", "rule", "del", "fwmark", NFT_FAKEIP_MARK + "/" + NFT_FAKEIP_MARK, "table", RT_TABLE_NAME, "priority", "105" ]) ||
            nft_state.tproxy_marking_rule6_present(RT_TABLE_NAME, NFT_FAKEIP_MARK))) {
        log_message("Failed to remove the Forkop IPv6 routing rule", "error");
        status = 1;
    }

    if (nft_state.tproxy_route4_present(RT_TABLE_NAME) &&
        (!command_success_from_args([ IP_BIN, "route", "flush", "table", RT_TABLE_NAME ]) ||
            nft_state.tproxy_route4_present(RT_TABLE_NAME))) {
        log_message("Failed to flush the Forkop IPv4 routing table", "error");
        status = 1;
    }
    if (nft_state.tproxy_route6_present(RT_TABLE_NAME) &&
        (!command_success_from_args([ IP_BIN, "-6", "route", "flush", "table", RT_TABLE_NAME ]) ||
            nft_state.tproxy_route6_present(RT_TABLE_NAME))) {
        log_message("Failed to flush the Forkop IPv6 routing table", "error");
        status = 1;
    }

    return status;
}

function stop_main(preserve_singbox_watcher) {
    let status = 0;

    log_message("Stopping Forkop", "info");
    if (!preserve_singbox_watcher)
        module_success(SINGBOX_WATCH_UC, [ "stop-worker" ]);
    module_success(RULESET_SYNC_UC, [ "stop-worker" ]);
    remove_cron_jobs();

    let network_status = cleanup_network_runtime();
    if (network_status != 0)
        status = network_status;

    let sing_box_status = stop_sing_box_service();
    if (sing_box_status != 0)
        status = sing_box_status;
    if (!module_success(STATE_UC, [
        "wait-sing-box-stopped",
        getenv("FORKOP_SING_BOX_RELOAD_PID_TIMEOUT") || "15"
    ]))
        status = status == 0 ? 1 : status;

    return status;
}

function cleanup_failed_runtime(preserve_singbox_watcher) {
    let status = 0;

    module_success(SERVER_UC, [ "sync-firewall", "clear" ]);

    log_message("Cleaning up Forkop runtime after failed start/reload", "info");

    let stop_status = stop_main(preserve_singbox_watcher);
    if (stop_status != 0)
        status = stop_status;

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
    let status = cleanup_failed_runtime(true);
    if (status == 0 && !module_success(SINGBOX_WATCH_UC, [ "stop-worker" ]))
        status = 1;
    module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, pid ]);
    return status;
}

// The reason is what the page shows: an apply that failed is reported to the user
// out of the log, so every way out of a reload has to say which step gave up. The
// step that failed may have logged more of its own first; this line is the one
// that is always there.
function abort_reload(status, runtime_changed, reason) {
    status = int(status || 0);
    if (status == 0)
        status = 1;

    log_message(as_string(reason) + ". Aborted.", "error");

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

    // start_impl has already verified a ready runtime through wait-forkop-ready;
    // its status is the verdict, and re-checking here would only re-ask a
    // question the wait just answered.
    let status = start_impl();

    if (status != 0) {
        cleanup_failed_runtime();
        module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, owner_pid() ]);
        return status;
    }

    mark_pending_reload_if_config_changed(startup_config_fingerprint, "config_changed_during_start");

    module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, owner_pid() ]);
    return 0;
}

function stop_impl() {
    let status = 0;

    // Nothing listens on the server ports once the runtime is down, so the firewall
    // stops accepting them. A reload keeps them: it takes the runtime down and back
    // up, and closing the ports in between would cost a second firewall reload.
    module_success(SERVER_UC, [ "sync-firewall", "clear" ]);

    if (!mark_sing_box_planned_stop())
        log_message("Failed to mark the planned sing-box stop", "warn");
    module_success(SINGBOX_WATCH_UC, [ "stop-worker" ]);

    let runtime_status = stop_main();
    if (runtime_status != 0)
        status = runtime_status;

    module_success(STATE_UC, [ "clear-reload-state", RELOAD_STATE_FILE, RELOAD_STATE_SNAPSHOT_FILE ]);

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

    log_message("Reload requires a full Forkop runtime restart", "info");

    status = stop_main();
    if (status != 0) {
        // start_impl says why it gave up; this one is otherwise silent.
        log_message("Failed to stop the Forkop runtime before restarting it. Aborted.", "error");
        return status;
    }

    status = start_impl();
    if (status != 0) {
        cleanup_failed_runtime();
        return status;
    }

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
        changed_sing_box: 0,
        changed_nft: 0,
        changed_cron: 0,
        needs_sing_box_reload: 0,
        needs_nft_rebuild: 0,
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

// Carries out the reload the plan asked for. Anything that fails after the
// runtime was touched takes the runtime down with it, so a non-zero status here
// is final: the caller propagates it without cleaning up again.
//
// Nothing is announced up front. Each step below says what it did when it did
// it, which is both narrower and truthful; a list of the subsystems about to be
// touched only named the internal shape of the plan.
function apply_reload_plan(plan, force_runtime_reload) {
    let status;

    let restart_ruleset_sync = plan.needs_nft_rebuild == 1;
    if (restart_ruleset_sync)
        module_success(RULESET_SYNC_UC, [ "stop-worker" ]);

    if (plan.needs_nft_rebuild == 1) {
        log_message("Rebuilding nftables rules", "info");
        status = nft_rebuild_runtime();
        if (status != 0)
            return abort_reload(status, true, "Failed to rebuild the nftables rules");
    }

    if (plan.needs_sing_box_reload == 1) {
        status = module_status(SINGBOX_UC, [ "configure-service" ]);
        if (status != 0)
            return abort_reload(status, true, "Failed to configure the sing-box service");
        let sing_box_config_path = config_get(CONFIG_NAME + ".settings.config_path", "");
        let sing_box_config_hash_before = file_md5(sing_box_config_path);
        status = singbox_init_config_for_live_reload(plan.needs_nft_rebuild == 1);
        if (status != 0)
            return abort_reload(status, true, "Failed to write the sing-box configuration");
        status = module_status(STATE_UC, [
            "reload-sing-box-runtime",
            sing_box_config_hash_before,
            file_md5(sing_box_config_path),
            as_string(force_runtime_reload)
        ]);
        if (status != 0)
            return abort_reload(status, true, "Failed to reload sing-box");
        // The reload window only has to outlast the gap between the HUP signal
        // and sing-box dropping its ports; from there the hold cannot be
        // satisfied until the rebind has finished and readiness has come back.
        status = module_status(STATE_UC, [
            "wait-forkop-ready",
            RT_TABLE_NAME,
            NFT_TABLE_NAME,
            NFT_FAKEIP_MARK,
            as_string(RELOAD_READY_WINDOW),
            as_string(READY_HOLD)
        ]);
        if (status != 0) {
            log_message("Reload verification failed after sing-box was reloaded; stopping Forkop runtime", "fatal");
            cleanup_failed_runtime();
            return status;
        }
    }
    else if (plan.needs_nft_rebuild == 1) {
        status = nft_populate_runtime_sets();
        if (status != 0)
            return abort_reload(status, true, "Failed to fill the nftables runtime sets");
    }

    if (restart_ruleset_sync) {
        status = module_status(RULESET_SYNC_UC, [ "start-worker" ]);
        if (status != 0)
            return abort_reload(status, true, "Failed to start the rule set sync worker");
    }

    if (plan.needs_cron_refresh == 1) {
        status = refresh_cron();
        if (status != 0)
            return abort_reload(status, false, "Failed to refresh the Forkop cron jobs");
    }

    return 0;
}

function reload_impl(reason) {
    let status;
    let force_runtime_reload = as_string(reason || "") == "on_config_change" ? 0 : 1;

    // Not "reloading Forkop": most of the time nothing is restarted, and often
    // there is nothing to do at all.
    log_message("Applying configuration", "info");

    status = validate_start_config();
    if (status != 0)
        return status;

    // After the step that fills in what the configuration left out, the way the
    // start path does it. Validation writes the defaults a new server or a new
    // section needs, so a fingerprint taken before it is a fingerprint of a
    // configuration this reload itself then changed - and the check at the end
    // would read its own writing as somebody else's and queue a second reload
    // that has nothing left to do.
    let reload_config_fingerprint = external_config_fingerprint();

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
        return abort_reload(status, false, "Failed to read the state of the running configuration");

    let current_reload_state_file = trim(command_output_from_args([ "mktemp" ]));
    if (current_reload_state_file == "")
        return abort_reload(1, false, "Failed to create a temporary file for the runtime state");

    status = module_status(STATE_UC, [
        "write-captured-reload-state",
        current_reload_state_file,
        RELOAD_STATE_SNAPSHOT_FILE,
        as_string(RELOAD_STATE_FORMAT),
        "0",
        "0"
    ]);
    if (status != 0) {
        remove_file(current_reload_state_file);
        return abort_reload(status, false, "Failed to write out the state of the running configuration");
    }

    let runtime_cache_needs_rebuild = as_string(getenv("FORKOP_RUNTIME_CACHE_INVALIDATED") || "0") == "1" ? 1 : 0;

    let plan_result = module_capture(RELOAD_UC, [
        "plan-state-files",
        RELOAD_STATE_FILE,
        current_reload_state_file,
        as_string(force_runtime_reload),
        as_string(runtime_cache_needs_rebuild)
    ]);
    remove_file(current_reload_state_file);

    if (plan_result.status != 0) {
        if (plan_result.status == 2) {
            log_message("Reload state is unavailable; restarting Forkop runtime", "info");
            return finish_reload_status(restart_runtime_for_reload_locked(), reload_config_fingerprint);
        }
        return abort_reload(plan_result.status, false, "Failed to work out what the configuration change requires");
    }

    let plan = parse_reload_plan(plan_result.output);
    write_service_trigger_sync_state(plan.changed_service_triggers);

    if (plan.has_work == 0) {
        status = module_status(STATE_UC, [
            "write-captured-reload-state",
            RELOAD_STATE_FILE,
            RELOAD_STATE_SNAPSHOT_FILE,
            as_string(RELOAD_STATE_FORMAT),
            "1",
            "1"
        ]);
        if (status != 0)
            return abort_reload(status, false, "Failed to record the applied configuration");
        log_message("Configuration already applied; nothing to change", "info");
        return finish_reload_status(status, reload_config_fingerprint);
    }

    status = apply_reload_plan(plan, force_runtime_reload);
    if (status != 0)
        return status;

    status = module_status(STATE_UC, [
        "write-captured-reload-state",
        RELOAD_STATE_FILE,
        RELOAD_STATE_SNAPSHOT_FILE,
        as_string(RELOAD_STATE_FORMAT),
        "1",
        "1"
    ]);
    if (status != 0)
        return abort_reload(status, false, "Failed to record the applied configuration");

    log_message("Configuration applied", "info");

    return finish_reload_status(status, reload_config_fingerprint);
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

    let job_id = trim(module_output(UI_UC, [
        "service-action-begin-if-idle",
        "reload",
        "runtime_reload",
        owner_pid()
    ]));

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

    module_success(STATE_UC, [ "release-runtime-dir-lock", START_LOCK_DIR, pid ]);
    return 0;
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

// Autostart is the rc.d symlink, and toggling it has nothing to do with the
// runtime. It used to be toggled through `/etc/init.d/forkop enable`, which
// blocks for as long as any other command on the same service is running:
// sourcing /lib/functions/procd.sh takes a per-service flock before it defines
// anything, so the init script waits whatever a start, stop, restart or reload
// is doing. Measured at 41 s during a restart, from a button that changes a
// symlink.
//
// The link is written directly instead. Every reader of it in this codebase
// already looks for exactly this path, and the priority is checked against the
// init script by tests/service_start_trap.sh so the two cannot drift.
const AUTOSTART_PRIORITY = "99";
const AUTOSTART_LINK = "/etc/rc.d/S" + AUTOSTART_PRIORITY + SERVICE_NAME;
const AUTOSTART_TARGET = "../init.d/" + SERVICE_NAME;

function enable_service() {
    if (!command_success_from_args([ "mkdir", "-p", "/etc/rc.d" ]))
        return 1;
    return command_success_from_args([ "ln", "-sf", AUTOSTART_TARGET, AUTOSTART_LINK ]) ? 0 : 1;
}

function disable_service() {
    // The stop link is removed too: the init script declares no STOP, so one
    // should not exist, but an older install or a hand-made link might.
    command_success_from_args([ "rm", "-f", "/etc/rc.d/K" + AUTOSTART_PRIORITY + SERVICE_NAME ]);
    return command_success_from_args([ "rm", "-f", AUTOSTART_LINK ]) ? 0 : 1;
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
else if (mode == "network-cleanup-fixture")
    status = cleanup_network_runtime();
else if (mode == "sing-box-stop-service-fixture")
    status = stop_sing_box_service();
else if (mode == "log-message-fixture") {
    log_message(ARGV[2], ARGV[1]);
    status = 0;
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
else if (mode == "clash-controller-preflight-fixture")
    status = clash_controller_preflight(ARGV[1], fs.readfile(ARGV[2]));
else if (mode == "uninstall")
    status = uninstall();
else {
    warn("Usage: service/lifecycle.uc <start|stop|reload|restart|main|sing-box-crash-cleanup|sing-box-planned-stop-guard-fixture|enable|disable|uninstall> ...\n");
    status = 1;
}

exit(status);
