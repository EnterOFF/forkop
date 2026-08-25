#!/usr/bin/env ucode

let fs = require("fs");
let constants = require("core.constants");
let uci_core = require("core.uci");

const LIB_DIR = getenv("FORKOP_LIB") || "/usr/lib/forkop";
const BIN_PATH = getenv("FORKOP_BIN") || constants.FORKOP_BIN || "/usr/bin/forkop";
const SERVICE_INIT = getenv("FORKOP_SERVICE_INIT") || constants.FORKOP_SERVICE_INIT || "/etc/init.d/forkop";
const FORKOP_VERSION = getenv("FORKOP_VERSION") || constants.FORKOP_VERSION || "";
const FORKOP_RELEASE_REPO = getenv("FORKOP_RELEASE_REPO") || constants.FORKOP_RELEASE_REPO || "ushan0v/forkop";
const SING_BOX_FORKOP_RELEASE_REPO = getenv("SING_BOX_FORKOP_RELEASE_REPO") || "ushan0v/sing-box-forkop";
const RUNTIME_STATE_DIR = getenv("FORKOP_RUNTIME_STATE_DIR") || "/var/run/forkop";
const FORKOP_LATEST_VERSION_FILE = getenv("FORKOP_LATEST_VERSION_FILE") || "/tmp/forkop.latest-version.cache";
const SING_BOX_FORKOP_VERSION_FILE = getenv("SING_BOX_FORKOP_VERSION_FILE") || "/usr/share/sing-box-forkop/version";
const COMPONENT_LOCK_DIR = getenv("UPDATES_LOCK_DIR") || RUNTIME_STATE_DIR + "/component-action.lock";
const TMP_STALE_TTL_MINUTES = getenv("UPDATES_TMP_STALE_TTL_MINUTES") || "30";
const TMP_FILE_STALE_TTL_MINUTES = getenv("UPDATES_TMP_FILE_STALE_TTL_MINUTES") || "10";

let tmp_dir = "";
let lock_held = false;
let forkop_was_running = false;
let forkop_stopped_for_sing_box_change = false;

function as_string(value) {
    return value == null ? "" : "" + value;
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

function command_env(assignments) {
    let parts = [];
    for (let name, value in assignments)
        push(parts, name + "=" + shell_quote(value));
    return join(" ", parts);
}

function command_status(command) {
    let status = int(system(command));
    return status > 255 ? int(status / 256) : status;
}

function command_success(command) {
    return command_status("(" + command + ") >/dev/null 2>&1") == 0;
}

function command_success_from_args(args) {
    return command_success(command_from_args(args));
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
    return command_success_from_args([ "command", "-v", name ]);
}

function write_json(value) {
    print(sprintf("%J", value), "\n");
}

function write_file(path, value) {
    return fs.writefile(as_string(path), as_string(value)) != null;
}

function read_file(path) {
    let data = fs.readfile(as_string(path));
    return data == null ? "" : as_string(data);
}

function remove_file(path) {
    try {
        fs.unlink(as_string(path));
    }
    catch (e) {
    }
}

function ensure_dir(path) {
    return command_success_from_args([ "mkdir", "-p", as_string(path) ]);
}

function file_exists(path) {
    return fs.stat(as_string(path)) != null;
}

function file_nonempty(path) {
    let stat = fs.stat(as_string(path));
    return stat != null && int(stat.size || 0) > 0;
}

function path_basename(path) {
    let parts = split(as_string(path), "/");
    return length(parts) > 0 ? as_string(parts[length(parts) - 1]) : "";
}

function now_seconds() {
    return int(clock()[0]);
}

function owner_pid() {
    let stat = as_string(fs.readfile("/proc/self/stat"));
    let separator = index(stat, " ");
    return separator > 0 ? substr(stat, 0, separator) : "0";
}

function pid_running(pid) {
    pid = as_string(pid);
    return match(pid, /^[0-9]+$/) != null && command_success_from_args([ "kill", "-0", pid ]);
}

function log_message(message, level) {
    level = as_string(level || "info");
    command_success_from_args([ "logger", "-t", "forkop", "[" + level + "] " + as_string(message) ]);
}

function updates_log(message, level) {
    log_message("Updates: " + as_string(message), level || "info");
}

function module_command(args) {
    let command_args = [ "ucode", "-L", LIB_DIR ];
    for (let arg in args)
        push(command_args, arg);
    return command_from_args(command_args);
}

function module_output(args) {
    return command_output(module_command(args));
}

function module_success(args) {
    return command_success(module_command(args));
}

function helper_output(mode, args) {
    let command_args = [ LIB_DIR + "/components/updater.uc", mode ];
    for (let arg in (type(args) == "array" ? args : []))
        push(command_args, arg);
    return module_output(command_args);
}

function helper_success(mode, args) {
    let command_args = [ LIB_DIR + "/components/updater.uc", mode ];
    for (let arg in (type(args) == "array" ? args : []))
        push(command_args, arg);
    return module_success(command_args);
}

function cleanup_stale_tmp_files() {
    command_success_from_args([ "find", "/tmp", "-maxdepth", "1", "-type", "d", "-name", "forkop-updates.*", "-mmin", "+" + as_string(TMP_STALE_TTL_MINUTES), "-exec", "rm", "-rf", "{}", "+" ]);
    command_success_from_args([ "find", "/tmp", "-maxdepth", "1", "-type", "f", "(", "-name", "forkop-updates-command.*", "-o", "-name", "forkop-updates-http.*", ")", "-mmin", "+" + as_string(TMP_FILE_STALE_TTL_MINUTES), "-delete" ]);
}

function init_tmp_dir() {
    if (tmp_dir != "")
        return true;

    cleanup_stale_tmp_files();
    tmp_dir = trim(command_output_from_args([ "mktemp", "-d", "/tmp/forkop-updates.XXXXXX" ]));
    if (tmp_dir == "") {
        tmp_dir = "/tmp/forkop-updates." + owner_pid();
        if (!ensure_dir(tmp_dir)) {
            tmp_dir = "";
            return false;
        }
    }
    return true;
}

function make_tmp_file(prefix) {
    init_tmp_dir();
    let base = tmp_dir != "" ? tmp_dir + "/" + as_string(prefix) + ".XXXXXX" : "/tmp/forkop-updates-" + as_string(prefix) + ".XXXXXX";
    let path = trim(command_output_from_args([ "mktemp", base ]));
    if (path == "") {
        path = (tmp_dir != "" ? tmp_dir : "/tmp") + "/" + as_string(prefix) + "." + owner_pid() + "." + now_seconds();
        if (!write_file(path, ""))
            return "";
    }
    return path;
}

function helper_output_input(input, mode, args) {
    let input_path = make_tmp_file("helper-input");
    if (input_path == "")
        return "";
    write_file(input_path, as_string(input));

    let command_args = [ LIB_DIR + "/components/updater.uc", mode ];
    for (let arg in (type(args) == "array" ? args : []))
        push(command_args, arg);
    let output = command_output(command_from_args([ "cat", input_path ]) + " | " + module_command(command_args));
    remove_file(input_path);
    return output;
}

function helper_success_input(input, mode, args) {
    let input_path = make_tmp_file("helper-input");
    if (input_path == "")
        return false;
    write_file(input_path, as_string(input));

    let command_args = [ LIB_DIR + "/components/updater.uc", mode ];
    for (let arg in (type(args) == "array" ? args : []))
        push(command_args, arg);
    let ok = command_success(command_from_args([ "cat", input_path ]) + " | " + module_command(command_args));
    remove_file(input_path);
    return ok;
}

function cleanup_tmp_dir() {
    if (tmp_dir != "") {
        command_success_from_args([ "rm", "-rf", tmp_dir ]);
        tmp_dir = "";
    }
    cleanup_stale_tmp_files();
}

function acquire_component_lock() {
    ensure_dir(RUNTIME_STATE_DIR);
    if (command_success_from_args([ "mkdir", COMPONENT_LOCK_DIR ])) {
        write_file(COMPONENT_LOCK_DIR + "/pid", owner_pid() + "\n");
        lock_held = true;
        return true;
    }

    let current_owner = trim(read_file(COMPONENT_LOCK_DIR + "/pid"));
    if (current_owner != "" && pid_running(current_owner))
        return false;

    remove_file(COMPONENT_LOCK_DIR + "/pid");
    command_success_from_args([ "rmdir", COMPONENT_LOCK_DIR ]);
    if (!command_success_from_args([ "mkdir", COMPONENT_LOCK_DIR ]))
        return false;

    write_file(COMPONENT_LOCK_DIR + "/pid", owner_pid() + "\n");
    lock_held = true;
    return true;
}

function release_component_lock() {
    if (!lock_held)
        return;
    remove_file(COMPONENT_LOCK_DIR + "/pid");
    command_success_from_args([ "rmdir", COMPONENT_LOCK_DIR ]);
    lock_held = false;
}

function cleanup_action() {
    cleanup_tmp_dir();
    release_component_lock();
}

function updates_response(success, component, action, message, current_version, latest_version, changed, status, release_url) {
    write_json({
        success: !!success,
        kind: "component",
        component: as_string(component),
        action: as_string(action),
        message: as_string(message),
        current_version: as_string(current_version),
        latest_version: as_string(latest_version),
        changed: int(changed || 0),
        status: as_string(status),
        release_url: as_string(release_url)
    });
}

function restart_forkop_after_failed_sing_box_change() {
    if (!forkop_stopped_for_sing_box_change || !forkop_was_running || !file_exists(SERVICE_INIT))
        return;
    updates_log("Restarting Forkop after failed sing-box component change");
    if (!command_success_from_args([ SERVICE_INIT, "start" ]))
        command_success_from_args([ SERVICE_INIT, "restart" ]);
}

function action_success(component, action, message, current_version, latest_version, changed, status, release_url) {
    updates_response(true, component, action, message, current_version, latest_version, changed || 0, status || "", release_url || "");
    cleanup_action();
    exit(0);
}

function action_fail(component, action, message, current_version, latest_version, status, release_url) {
    updates_log(message, "error");
    restart_forkop_after_failed_sing_box_change();
    updates_response(false, component, action, message, current_version || "", latest_version || "", 0, status || "", release_url || "");
    cleanup_action();
    exit(1);
}

function run_logged(description, command) {
    init_tmp_dir();
    let output_file = make_tmp_file("command");
    if (output_file == "")
        output_file = "/tmp/forkop-updates-command." + owner_pid();

    updates_log(description);
    let status = command_status(as_string(command) + " >" + shell_quote(output_file) + " 2>&1");
    for (let line in split(read_file(output_file), "\n"))
        if (trim(as_string(line)) != "")
            updates_log(line);
    remove_file(output_file);
    if (status != 0)
        updates_log(description + " failed with exit code " + status, "warn");
    return status == 0;
}

function is_apk() {
    return command_exists("apk");
}

function pkg_is_installed(package_name) {
    package_name = as_string(package_name);
    if (is_apk())
        return command_success_from_args([ "apk", "info", "-e", package_name ]);
    return module_success([ LIB_DIR + "/core/packages.uc", "opkg-installed", package_name ]);
}

function installed_package_version(package_name) {
    package_name = as_string(package_name);
    if (is_apk()) {
        if (!pkg_is_installed(package_name))
            return "";
        return trim(module_output([ LIB_DIR + "/core/packages.uc", "apk-version", package_name ]));
    }
    return trim(module_output([ LIB_DIR + "/core/packages.uc", "opkg-version", package_name ]));
}

function pkg_list_update_command() {
    return is_apk() ? "apk update </dev/null" : "opkg update </dev/null";
}

function pkg_install_files_command(files) {
    let args = is_apk() ?
        [ "apk", "add", "--allow-untrusted" ] :
        [ "opkg", "install", "--force-reinstall", "--force-overwrite", "--force-downgrade" ];
    for (let file in files)
        push(args, file);
    return command_from_args(args) + " </dev/null";
}

function run_logged_pkg_remove_sing_box_conflict(package_name, description) {
    if (!pkg_is_installed(package_name)) {
        updates_log(description);
        return true;
    }

    let command = is_apk() ?
        command_from_args([ "apk", "del", "--force-broken-world", package_name ]) + " </dev/null" :
        command_from_args([ "opkg", "remove", "--force-depends", package_name ]) + " </dev/null";
    return run_logged(description, command);
}

function compare_versions(lhs, rhs) {
    lhs = as_string(lhs);
    rhs = as_string(rhs);
    if (lhs == "" || rhs == "")
        return null;
    if (lhs == rhs)
        return 0;

    if (is_apk()) {
        let apk_result = trim(command_output_from_args([ "apk", "version", "-t", lhs, rhs ]));
        if (apk_result == ">")
            return 1;
        if (apk_result == "<")
            return -1;
        if (apk_result == "=")
            return 0;
    }

    if (command_exists("opkg")) {
        if (command_success_from_args([ "opkg", "compare-versions", lhs, ">", rhs ]))
            return 1;
        if (command_success_from_args([ "opkg", "compare-versions", lhs, "<", rhs ]))
            return -1;
        if (command_success_from_args([ "opkg", "compare-versions", lhs, "=", rhs ]))
            return 0;
    }

    return module_success([ LIB_DIR + "/core/version.uc", "version-at-least", lhs, rhs ]) ? 1 : -1;
}

function status_from_compare(compare_result) {
    if (compare_result == -1)
        return "outdated";
    if (compare_result == 0)
        return "latest";
    if (compare_result == 1)
        return "dev";
    return "";
}

function check_success_compared(component, current_version, latest_version, compare_current_version, compare_latest_version, release_url) {
    let compare_result = compare_versions(compare_current_version, compare_latest_version);
    if (compare_result == null)
        action_fail(component, "check_update", "Failed to compare versions", current_version, latest_version);

    let status = status_from_compare(compare_result);
    if (status == "")
        action_fail(component, "check_update", "Failed to compare versions", current_version, latest_version);

    let result_row = trim(helper_output("updates-check-result-row", [ component, current_version, latest_version, status ]));
    if (result_row == "")
        action_fail(component, "check_update", "Failed to compare versions", current_version, latest_version);

    let fields = split(result_row, "\t");
    let message = as_string(fields[0] || "");
    let log_line = length(fields) > 1 ? as_string(fields[1]) : message;
    updates_log(log_line);
    action_success(component, "check_update", message, current_version, latest_version, 0, status, release_url || "");
}

function check_success(component, current_version, latest_version, release_url) {
    check_success_compared(component, current_version, latest_version, current_version, latest_version, release_url || "");
}

function read_openwrt_release_value(key) {
    return trim(helper_output("openwrt-release-value", [ "/etc/openwrt_release", key ]));
}

function service_proxy_address() {
    if (!file_exists(LIB_DIR + "/singbox/runtime.uc"))
        return "";
    if (file_exists(LIB_DIR + "/service/state.uc") &&
        !module_success([ LIB_DIR + "/service/state.uc", "sing-box-service-running" ]))
        return "";
    return trim(module_output([ LIB_DIR + "/singbox/runtime.uc", "service-proxy-address", "components" ]));
}

function http_get_once(url, output_path, proxy_address, timeout) {
    url = as_string(url);
    output_path = as_string(output_path);
    proxy_address = as_string(proxy_address);
    timeout = as_string(timeout || "30");

    if (command_exists("curl")) {
        let args = [ "curl", "--connect-timeout", "5", "-m", timeout, "-fsSL" ];
        if (proxy_address != "") {
            push(args, "-x");
            push(args, "http://" + proxy_address);
        }
        push(args, url);
        push(args, "-o");
        push(args, output_path);
        return command_success_from_args(args);
    }

    if (command_exists("wget")) {
        let command = command_from_args([ "wget", "-T", timeout, "-q", "-O", output_path, url ]);
        if (proxy_address != "")
            command = command_env({ http_proxy: "http://" + proxy_address, https_proxy: "http://" + proxy_address }) + " " + command;
        return command_success(command);
    }

    return false;
}

function http_get(url) {
    init_tmp_dir();
    let output_path = make_tmp_file("http");
    if (output_path == "")
        return "";

    let proxy_address = service_proxy_address();
    if (proxy_address != "") {
        if (http_get_once(url, output_path, proxy_address, "30")) {
            let data = read_file(output_path);
            remove_file(output_path);
            return data;
        }
        remove_file(output_path);
        updates_log("HTTP request via service proxy failed for " + as_string(url) + "; retrying directly", "warn");
    }

    if (http_get_once(url, output_path, "", "30")) {
        let data = read_file(output_path);
        remove_file(output_path);
        return data;
    }

    remove_file(output_path);
    return "";
}

function download_file_once(url, output_path) {
    let proxy_address = service_proxy_address();
    if (proxy_address != "") {
        if (http_get_once(url, output_path, proxy_address, "120"))
            return true;
        remove_file(output_path);
        updates_log("Download via service proxy failed for " + as_string(url) + "; retrying directly", "warn");
    }
    return http_get_once(url, output_path, "", "120");
}

function download_with_retry(url, output_path, label) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        updates_log("Downloading " + as_string(label) + " (" + attempt + "/3)");
        if (download_file_once(url, output_path) && file_nonempty(output_path))
            return true;
        remove_file(output_path);
        updates_log("Retrying " + as_string(label), "warn");
    }
    return false;
}

function fetch_github_release_json(owner, repo) {
    let response = http_get("https://api.github.com/repos/" + as_string(owner) + "/" + as_string(repo) + "/releases/latest");
    if (response == "" || !helper_success_input(response, "github-response-ok", []))
        return "";
    return response;
}

function latest_forkop_release_json() {
    let parts = split(FORKOP_RELEASE_REPO, "/");
    if (length(parts) != 2 || as_string(parts[0]) == "" || as_string(parts[1]) == "")
        return "";
    return fetch_github_release_json(parts[0], parts[1]);
}

function latest_forkop_version() {
    let response = latest_forkop_release_json();
    if (response == "")
        return "";
    return trim(helper_output_input(response, "object-get-default", [ "tag_name", "" ]));
}

function fetch_forkop_latest_release_metadata() {
    let response = latest_forkop_release_json();
    if (response == "")
        return "";
    return trim(helper_output_input(response, "release-metadata-tsv", []));
}

function write_forkop_latest_version_cache(value, timestamp) {
    if (as_string(value) == "")
        return;
    write_file(FORKOP_LATEST_VERSION_FILE, as_string(value) + "\n" + as_string(timestamp) + "\n");
}

// System information is worked out on demand now, so there is nothing to drop
// for it. What upstream last reported still is not, and a component action is
// exactly when that answer stops being true.
function clear_version_caches() {
    remove_file(FORKOP_LATEST_VERSION_FILE);
}

function disable_sing_box_service_config() {
    if (!uci_core.available())
        return true;
    if (!uci_core.exists("sing-box.main") && !uci_core.set_section("sing-box.main", "sing-box"))
        return false;
    if (!uci_core.set("sing-box.main.enabled", "0"))
        return false;
    return uci_core.commit("sing-box");
}

function prepare_sing_box_service_disabled() {
    disable_sing_box_service_config();
    if (file_exists("/etc/init.d/sing-box")) {
        command_success_from_args([ "/etc/init.d/sing-box", "stop" ]);
        command_success_from_args([ "/etc/init.d/sing-box", "disable" ]);
    }
}

function forkop_status_running_with_timeout() {
    init_tmp_dir();
    let output_file = make_tmp_file("forkop-status");
    if (output_file == "")
        return false;

    let command = command_from_args([ BIN_PATH, "get_status" ]) + " >" + shell_quote(output_file) + " 2>/dev/null & pid=$!; " +
        "( sleep 6; kill $pid 2>/dev/null || true ) & watcher=$!; " +
        "wait $pid 2>/dev/null; rc=$?; kill $watcher 2>/dev/null || true; wait $watcher 2>/dev/null || true; exit $rc";
    let ok = command_status("sh -c " + shell_quote(command)) == 0 &&
        match(read_file(output_file), /"running"[ \t]*:[ \t]*1/) != null;
    remove_file(output_file);
    return ok;
}

function capture_forkop_running_state() {
    forkop_was_running = file_exists(BIN_PATH) && forkop_status_running_with_timeout();
}

function restart_forkop_after_successful_change() {
    if (!file_exists(SERVICE_INIT))
        return;
    if (!forkop_was_running) {
        updates_log("Forkop was not running before component change; restart skipped");
        prepare_sing_box_service_disabled();
        return;
    }
    run_logged("Restarting Forkop after successful component change", command_from_args([ SERVICE_INIT, "restart" ]));
}

function stop_forkop_before_sing_box_change() {
    if (forkop_stopped_for_sing_box_change)
        return;
    forkop_stopped_for_sing_box_change = true;

    if (forkop_was_running && file_exists(SERVICE_INIT))
        run_logged("Stopping Forkop before sing-box package change", command_from_args([ SERVICE_INIT, "stop" ]));

    prepare_sing_box_service_disabled();
}

function wait_forkop_running_after_sing_box_change() {
    if (!forkop_was_running)
        return true;
    if (!file_exists(BIN_PATH))
        return false;

    let waited = 0;
    while (waited < 60) {
        if (forkop_status_running_with_timeout()) {
            command_success_from_args([ "sleep", "8" ]);
            if (forkop_status_running_with_timeout())
                return true;
        }
        command_success_from_args([ "sleep", "4" ]);
        waited += 4;
    }
    return false;
}

function opkg_arch_list() {
    return trim(helper_output_input(command_output_from_args([ "opkg", "print-architecture" ]), "updates-opkg-arch-list", []));
}

function resolve_arch_candidates() {
    let arch_list = "";
    if (is_apk()) {
        if (file_exists("/etc/apk/arch"))
            arch_list += " " + trim(helper_output("file-whitespace-list", [ "/etc/apk/arch" ]));
        arch_list += " " + trim(command_output_from_args([ "apk", "--print-arch" ]));
    }
    else {
        arch_list = opkg_arch_list();
    }

    let release_arch = read_openwrt_release_value("DISTRIB_ARCH");
    if (release_arch != "")
        arch_list += " " + release_arch;
    if (!helper_success("string-has-whitespace-field", [ arch_list ]))
        arch_list = trim(command_output_from_args([ "uname", "-m" ]));

    let resolved = trim(helper_output("updates-arch-candidates", [ arch_list ]));
    let fields = split(resolved, "\t");
    if (length(fields) < 2 || as_string(fields[0]) == "" || as_string(fields[1]) == "")
        return null;

    updates_log("Detected package architecture candidates: " + fields[1]);
    return {
        target: as_string(fields[0]),
        candidates: as_string(fields[1])
    };
}

function normalize_sing_box_version(value) {
    return trim(helper_output("updates-normalize-sing-box-version", [ value ]));
}

function sing_box_forkop_package_version(package_name) {
    return package_name == "" ? "" : normalize_sing_box_version(trim(module_output([ LIB_DIR + "/core/packages.uc", "version", package_name ])));
}

function sing_box_forkop_installed_package() {
    if (pkg_is_installed("sing-box-forkop-compressed"))
        return "sing-box-forkop-compressed";
    if (pkg_is_installed("sing-box-forkop"))
        return "sing-box-forkop";
    return "";
}

function sing_box_forkop_target_package() {
    let flavor = as_string(getenv("FORKOP_SING_BOX_INSTALL_FLAVOR"));
    if (flavor == "compressed")
        return "sing-box-forkop-compressed";
    if (flavor == "normal")
        return "sing-box-forkop";
    return sing_box_forkop_installed_package();
}

function latest_sing_box_forkop_release_json() {
    let parts = split(SING_BOX_FORKOP_RELEASE_REPO, "/");
    if (length(parts) != 2 || as_string(parts[0]) == "" || as_string(parts[1]) == "")
        return "";
    return fetch_github_release_json(parts[0], parts[1]);
}

function tagged_sing_box_forkop_release_json(tag) {
    let parts = split(SING_BOX_FORKOP_RELEASE_REPO, "/");
    if (length(parts) != 2 || as_string(parts[0]) == "" || as_string(parts[1]) == "" || as_string(tag) == "")
        return "";
    let response = http_get("https://api.github.com/repos/" + as_string(parts[0]) + "/" + as_string(parts[1]) + "/releases/tags/" + as_string(tag));
    if (response == "" || !helper_success_input(response, "github-response-ok", []))
        return "";
    return response;
}

function resolve_sing_box_forkop_release(package_name, release_tag) {
    let release_json = as_string(release_tag) == "" ? latest_sing_box_forkop_release_json() : tagged_sing_box_forkop_release_json(release_tag);
    if (release_json == "")
        return null;

    let distrib_arch = read_openwrt_release_value("DISTRIB_ARCH");
    let asset_ext = is_apk() ? "apk" : "ipk";
    let asset_url = trim(helper_output_input(release_json, "sing-box-forkop-package-asset-url", [
        package_name,
        distrib_arch,
        asset_ext
    ]));
    let tag = trim(helper_output_input(release_json, "object-get-default", [ "tag_name", "" ]));
    if (asset_url == "" || tag == "")
        return null;

    return {
        tag,
        release_url: trim(helper_output_input(release_json, "object-get-default", [ "html_url", "" ])),
        asset_url,
        asset_name: path_basename(asset_url)
    };
}

function sing_box_rollback_files() {
    return [
        [ "/usr/bin/sing-box", "binary" ],
        [ "/etc/init.d/sing-box", "service" ],
        [ "/usr/lib/libcronet.so", "cronet" ],
        [ SING_BOX_FORKOP_VERSION_FILE, "version" ]
    ];
}

function valid_sing_box_forkop_version(value) {
    value = as_string(value);
    return match(value, /^[0-9][0-9A-Za-z._+~-]*-extended-[0-9][0-9A-Za-z._+~-]*-f[0-9]+$/) != null ||
        match(value, /^[0-9][0-9A-Za-z._+~-]*-forkop[.][0-9]+$/) != null;
}

function markerless_sing_box_version(current_version) {
    current_version = normalize_sing_box_version(current_version);
    if (valid_sing_box_forkop_version(current_version))
        return current_version;

    // Markerless APK metadata loses the named version parts. The service is
    // already stopped here, so this one-time migration cannot overlap the core.
    if (command_success_from_args([ "pgrep", "-x", "sing-box" ]) ||
            command_success_from_args([ "pgrep", "-f", "^/usr/bin/sing-box[[:space:]]" ]))
        return "";
    let binary_version = trim(helper_output_input(
        command_output_from_args([ "/usr/bin/sing-box", "version" ]),
        "stdin-first-line-last-field",
        []
    ));
    return valid_sing_box_forkop_version(binary_version) ? binary_version : "";
}

function backup_sing_box_files(current_version) {
    let backups = {};
    let markerless_version = file_exists(SING_BOX_FORKOP_VERSION_FILE) ? "" : markerless_sing_box_version(current_version);
    for (let item in sing_box_rollback_files()) {
        let existed = file_exists(item[0]);
        backups[item[1]] = { existed, path: "" };
        if (!existed && item[1] == "version" && markerless_version != "") {
            let backup_path = tmp_dir + "/sing-box-version.backup";
            if (!write_file(backup_path, markerless_version + "\n"))
                return null;
            backups[item[1]] = { existed: true, path: backup_path };
            continue;
        }
        if (!existed)
            continue;
        let backup_path = tmp_dir + "/sing-box-" + item[1] + ".backup";
        if (!command_success_from_args([ "cp", "-p", item[0], backup_path ]))
            return null;
        backups[item[1]].path = backup_path;
    }
    return backups;
}

function restore_sing_box_files(backups) {
    let restored = true;
    for (let item in sing_box_rollback_files()) {
        let backup = backups[item[1]];
        let existed = type(backup) == "object" && backup.existed === true;
        let backup_path = type(backup) == "object" ? as_string(backup.path || "") : "";
        if (existed && (backup_path == "" || !command_success_from_args([ "cp", "-p", backup_path, item[0] ])))
            restored = false;
        else if (!existed && file_exists(item[0])) {
            remove_file(item[0]);
            if (file_exists(item[0]))
                restored = false;
        }
    }
    return restored;
}

function sing_box_rollback_version(current_version, backups) {
    current_version = normalize_sing_box_version(current_version);
    if (valid_sing_box_forkop_version(current_version))
        return current_version;

    let version_backup = type(backups.version) == "object" ? as_string(backups.version.path || "") : "";
    let backup_version = normalize_sing_box_version(trim(read_file(version_backup)));
    return valid_sing_box_forkop_version(backup_version) ? backup_version : "";
}

function prepare_sing_box_package_rollback(installed_package, current_version, backups) {
    installed_package = as_string(installed_package);
    let rollback = {
        package_name: installed_package,
        package_version: installed_package_version(installed_package),
        package_file: "",
        asset_name: "",
        legacy_package: ""
    };
    if (installed_package == "") {
        for (let package_name in [ "sing-box", "sing-box-tiny", "sing-box-extended" ])
            if (pkg_is_installed(package_name)) {
                rollback.legacy_package = package_name;
                break;
            }
        return rollback;
    }

    let rollback_version = sing_box_rollback_version(current_version, backups);
    if (rollback.package_version == "" || rollback_version == "")
        return null;
    let release = resolve_sing_box_forkop_release(installed_package, "v" + rollback_version);
    if (release == null || normalize_sing_box_version(release.tag) != rollback_version)
        return null;
    rollback.asset_name = release.asset_name;
    rollback.package_file = tmp_dir + "/sing-box-rollback-" + release.asset_name;
    if (!download_with_retry(release.asset_url, rollback.package_file, release.asset_name))
        return null;
    return rollback;
}

function sing_box_package_state_matches(package_name, rollback) {
    let previous_package = as_string(rollback.package_name);
    if (previous_package == "")
        return !pkg_is_installed(package_name);
    if (!pkg_is_installed(previous_package) ||
            (package_name != previous_package && pkg_is_installed(package_name)))
        return false;
    return installed_package_version(previous_package) == as_string(rollback.package_version);
}

function restore_sing_box_package(package_name, rollback) {
    if (as_string(rollback.package_name) == "") {
        if (pkg_is_installed(package_name) &&
                !run_logged_pkg_remove_sing_box_conflict(package_name, "Removing incomplete " + package_name + " installation"))
            return false;
        return !pkg_is_installed(package_name) &&
            (rollback.legacy_package == "" || pkg_is_installed(rollback.legacy_package));
    }

    let package_file = as_string(rollback.package_file);
    if (!file_nonempty(package_file))
        return false;
    if (!run_logged_pkg_remove_sing_box_conflict(package_name, "Removing incomplete " + package_name + " installation"))
        return false;
    if (rollback.package_name != package_name &&
            !run_logged_pkg_remove_sing_box_conflict(rollback.package_name, "Removing stale " + rollback.package_name + " installation"))
        return false;
    let restored = run_logged("Restoring " + rollback.package_name + " package", pkg_install_files_command([ package_file ]));
    return restored && sing_box_package_state_matches(package_name, rollback);
}

function cleanup_sing_box_package_rollback(rollback) {
    let package_file = type(rollback) == "object" ? as_string(rollback.package_file) : "";
    if (package_file != "")
        remove_file(package_file);
}

function fail_sing_box_forkop_install(action, reason, current_version, latest_version, backups, package_name, rollback, package_file) {
    remove_file(package_file);
    let package_restored = restore_sing_box_package(package_name, rollback);
    let files_restored = restore_sing_box_files(backups);
    cleanup_sing_box_package_rollback(rollback);
    clear_version_caches();
    if (package_restored && files_restored)
        action_fail("sing_box", action, reason + "; previous sing-box installation was restored", current_version, latest_version);
    action_fail("sing_box", action, reason + " and previous sing-box installation could not be restored completely", current_version, latest_version);
}

function install_sing_box_forkop(action) {
    let installed_package = sing_box_forkop_installed_package();
    let package_name = sing_box_forkop_target_package();
    let current_version = sing_box_forkop_package_version(installed_package);
    if (package_name == "")
        action_fail("sing_box", action, "sing-box-forkop is not installed", current_version);
    let release = resolve_sing_box_forkop_release(package_name);
    if (release == null)
        action_fail("sing_box", action, "Failed to resolve " + package_name + " release", current_version);

    let latest_version = normalize_sing_box_version(release.tag);
    if (action == "check_update") {
        if (installed_package == "")
            action_fail("sing_box", action, "sing-box-forkop is not installed", current_version, latest_version);
        if (current_version == "")
            action_fail("sing_box", action, "Failed to read sing-box-forkop version", current_version, latest_version);
        check_success("sing_box", normalize_sing_box_version(current_version), latest_version, release.release_url);
    }

    let package_file = tmp_dir + "/" + release.asset_name;
    if (!download_with_retry(release.asset_url, package_file, release.asset_name))
        action_fail("sing_box", action, "Failed to download " + package_name + " package", current_version, latest_version);
    if (!run_logged("Updating package lists before " + package_name + " installation", pkg_list_update_command()))
        action_fail("sing_box", action, "Failed to update package lists", current_version, latest_version);

    stop_forkop_before_sing_box_change();

    let backups = backup_sing_box_files(current_version);
    if (backups == null)
        action_fail("sing_box", action, "Failed to back up the current sing-box installation", current_version, latest_version);
    let rollback = prepare_sing_box_package_rollback(installed_package, current_version, backups);
    if (rollback == null)
        action_fail("sing_box", action, "Failed to cache rollback for the current sing-box-forkop package", current_version, latest_version);

    if (as_string(getenv("FORKOP_SING_BOX_INSTALL_FLAVOR")) != "") {
        for (let conflict in [ "sing-box", "sing-box-tiny", "sing-box-extended" ]) {
            if (!run_logged_pkg_remove_sing_box_conflict(conflict, "Removing " + conflict + " before " + package_name + " installation"))
                fail_sing_box_forkop_install(action, "Failed to remove " + conflict, current_version, latest_version, backups, package_name, rollback, package_file);
        }
    }

    if (!run_logged("Installing " + release.asset_name, pkg_install_files_command([ package_file ])))
        fail_sing_box_forkop_install(action, "Failed to install " + package_name, current_version, latest_version, backups, package_name, rollback, package_file);
    remove_file(package_file);

    // Package metadata is the authoritative version and does not start a
    // second Go process beside the active sing-box core on low-memory routers.
    let new_version = sing_box_forkop_package_version(package_name);
    if (!valid_sing_box_forkop_version(new_version))
        fail_sing_box_forkop_install(action, "Installed package failed sing-box-forkop validation", current_version, latest_version, backups, package_name, rollback, package_file);

    if (as_string(getenv("FORKOP_SING_BOX_INSTALL_FLAVOR")) != "") {
        remove_file("/etc/forkop/sing-box-variant");
        remove_file("/etc/forkop/sing-box-version");
    }
    restart_forkop_after_successful_change();
    if (!wait_forkop_running_after_sing_box_change())
        fail_sing_box_forkop_install(action, package_name + " was installed but Forkop did not start cleanly", current_version, latest_version, backups, package_name, rollback, package_file);

    for (let _, backup in backups) {
        let backup_path = type(backup) == "object" ? as_string(backup.path || "") : "";
        if (backup_path != "")
            remove_file(backup_path);
    }
    cleanup_sing_box_package_rollback(rollback);
    clear_version_caches();
    updates_log("Installed " + package_name + " " + new_version);
    action_success("sing_box", action, package_name + " has been installed", new_version, latest_version,
        normalize_sing_box_version(new_version) == latest_version ? 0 : 1, "latest", release.release_url);
}
function check_forkop() {
    let metadata = fetch_forkop_latest_release_metadata();
    let fields = split(metadata, "\t");
    let latest_version = length(fields) > 0 && as_string(fields[0]) != "" ? as_string(fields[0]) : "unknown";
    let release_url = length(fields) > 1 ? as_string(fields[1]) : "";
    if (latest_version == "unknown")
        action_fail("forkop", "check_update", "Failed to check Forkop updates", FORKOP_VERSION, latest_version);

    write_forkop_latest_version_cache(latest_version, now_seconds());
    if (!helper_success("forkop-release-version-valid", [ FORKOP_VERSION ])) {
        updates_log("Forkop current version is not a release version (" + FORKOP_VERSION + ")");
        action_success("forkop", "check_update", "Installed version is newer than release", FORKOP_VERSION, latest_version, 0, "dev", release_url);
    }

    let compare = trim(helper_output("forkop-release-version-compare", [ FORKOP_VERSION, latest_version ]));
    if (compare == "")
        action_fail("forkop", "check_update", "Failed to compare Forkop versions", FORKOP_VERSION, latest_version);
    let status = status_from_compare(int(compare));
    if (status == "")
        action_fail("forkop", "check_update", "Failed to compare Forkop versions", FORKOP_VERSION, latest_version);
    if (status == "latest") {
        updates_log("Forkop is already up to date (" + FORKOP_VERSION + ")");
        action_success("forkop", "check_update", "Latest version is installed", FORKOP_VERSION, latest_version, 0, status, release_url);
    }
    if (status == "outdated") {
        updates_log("Forkop update found: " + FORKOP_VERSION + " -> " + latest_version);
        action_success("forkop", "check_update", "Update is available", FORKOP_VERSION, latest_version, 0, status, release_url);
    }
    updates_log("Forkop installed version is newer than upstream release: " + FORKOP_VERSION + " -> " + latest_version);
    action_success("forkop", "check_update", "Installed version is newer than release", FORKOP_VERSION, latest_version, 0, status, release_url);
}

function resolve_forkop_release(latest_version) {
    let release_json = latest_forkop_release_json();
    if (release_json == "")
        return null;
    let asset_ext = is_apk() ? "apk" : "ipk";
    let i18n_required = pkg_is_installed("luci-i18n-forkop-ru") ? "1" : "0";
    let plan = trim(helper_output_input(release_json, "forkop-release-plan", [ latest_version, asset_ext, i18n_required ]));
    let fields = split(plan, "\t");
    if (length(fields) < 7 || as_string(fields[1]) == "" || as_string(fields[2]) == "" || as_string(fields[3]) == "" || as_string(fields[4]) == "")
        return null;
    return {
        release_url: fields[0],
        backend_name: fields[1],
        backend_url: fields[2],
        app_name: fields[3],
        app_url: fields[4],
        i18n_name: fields[5],
        i18n_url: fields[6]
    };
}

function install_forkop() {
    let latest_version = latest_forkop_version();
    if (latest_version == "")
        latest_version = "unknown";
    if (latest_version == "unknown")
        action_fail("forkop", "install", "Failed to resolve Forkop release", FORKOP_VERSION, latest_version);

    write_forkop_latest_version_cache(latest_version, now_seconds());
    init_tmp_dir() || action_fail("forkop", "install", "Failed to create temporary directory", FORKOP_VERSION, latest_version);
    updates_log("Resolving Forkop release " + latest_version + " packages");
    let release = resolve_forkop_release(latest_version);
    if (release == null)
        action_fail("forkop", "install", "Failed to resolve Forkop release packages", FORKOP_VERSION, latest_version);

    let backend_file = tmp_dir + "/" + release.backend_name;
    let app_file = tmp_dir + "/" + release.app_name;
    let i18n_file = release.i18n_url != "" ? tmp_dir + "/" + release.i18n_name : "";
    if (!download_with_retry(release.backend_url, backend_file, release.backend_name) ||
        !download_with_retry(release.app_url, app_file, release.app_name) ||
        (release.i18n_url != "" && !download_with_retry(release.i18n_url, i18n_file, release.i18n_name)))
        action_fail("forkop", "install", "Failed to download Forkop release packages", FORKOP_VERSION, latest_version);

    if (!run_logged("Installing LuCI app package " + release.app_name, pkg_install_files_command([ app_file ])))
        action_fail("forkop", "install", "Failed to install LuCI app package", FORKOP_VERSION, latest_version);
    if (i18n_file != "" && !run_logged("Installing LuCI Russian i18n package " + release.i18n_name, pkg_install_files_command([ i18n_file ])))
        action_fail("forkop", "install", "Failed to install LuCI Russian i18n package", FORKOP_VERSION, latest_version);
    if (!run_logged("Installing Forkop package " + release.backend_name, pkg_install_files_command([ backend_file ])))
        action_fail("forkop", "install", "Failed to install Forkop package", FORKOP_VERSION, latest_version);

    remove_file("/var/luci-indexcache");
    command_success("rm -f /var/luci-indexcache* /tmp/luci-indexcache* 2>/dev/null");
    command_success("rm -rf /tmp/luci-modulecache/ 2>/dev/null");
    if (file_exists("/etc/init.d/rpcd") && !command_success_from_args([ "/etc/init.d/rpcd", "reload" ]))
        command_success_from_args([ "/etc/init.d/rpcd", "restart" ]);
    command_success_from_args([ "killall", "-HUP", "rpcd" ]);

    restart_forkop_after_successful_change();
    clear_version_caches();
    let new_version = installed_package_version("forkop");
    if (new_version == "")
        new_version = latest_version;
    updates_log("Forkop updated to " + new_version);
    action_success("forkop", "install", "Forkop has been installed", new_version, latest_version, 1, "latest", release.release_url);
}

function dispatch_sing_box(action) {
    install_sing_box_forkop(action);
}

function normalize_component_name(component) {
    component = as_string(component);
    if (component == "sing-box" || component == "singbox")
        return "sing_box";
    if (component == "forkop")
        return "forkop";
    return component;
}

function component_action(component, action) {
    component = normalize_component_name(component);
    action = as_string(action);
    if (!acquire_component_lock())
        action_fail(component != "" ? component : "unknown", action != "" ? action : "unknown", "Another component action is already running");
    if (!init_tmp_dir())
        action_fail(component != "" ? component : "unknown", action != "" ? action : "unknown", "Failed to create temporary directory");
    capture_forkop_running_state();

    if (component == "forkop" && action == "check_update")
        check_forkop();
    else if (component == "forkop" && action == "install")
        install_forkop();
    else if (component == "sing_box" && (action == "check_update" || action == "install"))
        dispatch_sing_box(action);
    else
        action_fail(component != "" ? component : "unknown", action != "" ? action : "unknown", "Unknown component action");
}

let mode = ARGV[0] || "";

if (mode == "component-action")
    component_action(ARGV[1], ARGV[2]);
else if (mode == "latest-forkop-release-json")
    print(latest_forkop_release_json());
else if (mode == "latest-forkop-version")
    print(latest_forkop_version(), "\n");
else if (mode == "forkop-release-metadata")
    print(fetch_forkop_latest_release_metadata(), "\n");
else {
    warn("Usage: components/action.uc <component-action|latest-forkop-version|forkop-release-metadata> ...\n");
    exit(1);
}
