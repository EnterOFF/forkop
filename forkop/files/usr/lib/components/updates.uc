#!/usr/bin/env ucode

let fs = require("fs");
let uci_core = require("core.uci");
let connections = require("config.connections");
const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || "forkop";
const LIB_DIR = getenv("FORKOP_LIB") || "/usr/lib/forkop";
const BIN_PATH = getenv("FORKOP_BIN") || "/usr/bin/forkop";
const RUNTIME_STATE_DIR = getenv("FORKOP_RUNTIME_STATE_DIR") || "/var/run/forkop";
const SERVICE_INIT = getenv("FORKOP_SERVICE_INIT") || "/etc/init.d/forkop";
const COMPONENT_JOB_DIR = getenv("UPDATES_JOB_DIR") || getenv("FORKOP_UI_COMPONENT_ACTION_DIR") || "/var/run/forkop/component-actions";
const COMPONENT_UPDATE_CHECK_CACHE_DIR = getenv("FORKOP_COMPONENT_UPDATE_CHECK_CACHE_DIR") || RUNTIME_STATE_DIR + "/component-update-checks";
const COMPONENT_UPDATE_CHECK_STATE_FILE = getenv("FORKOP_COMPONENT_UPDATE_CHECK_STATE_FILE") || RUNTIME_STATE_DIR + "/component-update-check.timestamp";
const COMPONENT_UPDATE_CHECK_LOCK_DIR = getenv("FORKOP_COMPONENT_UPDATE_CHECK_LOCK_DIR") || RUNTIME_STATE_DIR + "/component-update-check.lock";
const COMPONENT_JOB_FINISHED_TTL_MINUTES = getenv("UPDATES_JOB_FINISHED_TTL_MINUTES") || "60";
const COMPONENT_JOB_ORPHAN_OUTPUT_TTL_MINUTES = getenv("UPDATES_JOB_ORPHAN_OUTPUT_TTL_MINUTES") || "60";
const COMPONENT_JOB_STALE_GRACE_SECONDS = getenv("UPDATES_JOB_STALE_GRACE_SECONDS") || getenv("FORKOP_UI_ACTION_STALE_GRACE_SECONDS") || "15";

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

function command_status(command) {
    let status = int(system(command));
    return status > 255 ? int(status / 256) : status;
}

function command_success_from_args(args) {
    return system(command_from_args(args) + " >/dev/null 2>&1") == 0;
}

function now_seconds() {
    return int(clock()[0]);
}

function ensure_dir(path) {
    return command_success_from_args([ "mkdir", "-p", path ]);
}

function log_message(message, level) {
    level = as_string(level || "info");
    command_success_from_args([ "logger", "-t", "forkop", "[" + level + "] " + as_string(message) ]);
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

function write_json(value) {
    print(sprintf("%J", value), "\n");
}

function json_text(value) {
    return sprintf("%J", value) + "\n";
}

function write_file(path, value) {
    return fs.writefile(as_string(path), as_string(value)) != null;
}

function write_state_file(path, value) {
    path = as_string(path);
    let stamp = clock();
    let tmp_path = sprintf("%s.%d.%d.tmp", path, stamp[0], stamp[1]);

    if (!write_file(tmp_path, json_text(value))) {
        fs.unlink(tmp_path);
        return false;
    }
    if (!fs.rename(tmp_path, path)) {
        fs.unlink(tmp_path);
        return false;
    }
    return true;
}

function remove_file(path) {
    try {
        fs.unlink(as_string(path));
    }
    catch (e) {
    }
}

function file_first_line_value(path) {
    let data = fs.readfile(path);
    if (data == null)
        return "";

    let newline = index(data, "\n");
    return newline >= 0 ? substr(data, 0, newline) : data;
}

function arg_bool(value) {
    value = lc(as_string(value));
    return value == "true" || value == "1" || value == "yes" || value == "on";
}

function arg_number(value) {
    value = as_string(value);
    if (value == "" || match(value, /[^0-9-]/))
        return 0;
    return int(value);
}

function object_or_empty(value) {
    return type(value) == "object" ? value : {};
}

function text_first_chars(value, max_chars) {
    value = as_string(value);
    max_chars = int(max_chars || "0", 10) || 0;
    return max_chars > 0 && length(value) > max_chars ? substr(value, 0, max_chars) : value;
}

function file_last_nonblank_line_value(path, fallback, max_chars) {
    let data = fs.readfile(path);
    let result = "";

    if (data != null) {
        for (let line in split(as_string(data), "\n"))
            if (match(line, /^[[:space:]]*$/) == null)
                result = line;
    }

    if (result == "")
        result = as_string(fallback);

    return text_first_chars(result, max_chars);
}

function array_or_empty(value) {
    return type(value) == "array" ? value : [];
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

function bool_option(section, key, fallback) {
    let value = object_or_empty(section)[key];
    return value == null ? !!fallback : arg_bool(value);
}

function section_name(section) {
    return as_string(object_or_empty(section)[".name"]);
}

function temp_path() {
    return trim(command_output_from_args([ "mktemp" ]));
}

function owner_pid() {
    let stat = as_string(fs.readfile("/proc/self/stat"));
    let separator = index(stat, " ");
    return separator > 0 ? substr(stat, 0, separator) : "0";
}

function uci_sections(type_name) {
    return uci_core.section_objects(CONFIG_NAME, as_string(type_name));
}

function uci_settings() {
    return object_or_empty(uci_core.get_all(CONFIG_NAME, "settings"));
}

function module_command(args) {
    let command_args = [ "ucode", "-L", LIB_DIR ];
    for (let arg in args)
        push(command_args, arg);
    return command_from_args(command_args);
}

function module_status(args) {
    return command_status(module_command(args));
}

function module_success(args) {
    return module_status(args) == 0;
}

function service_state_success(args) {
    let command_args = [ LIB_DIR + "/service/state.uc" ];
    for (let arg in args)
        push(command_args, arg);
    return module_success(command_args);
}

function acquire_runtime_lock(lock_dir, wait) {
    return service_state_success([
        wait ? "acquire-runtime-dir-lock-wait" : "acquire-runtime-dir-lock",
        lock_dir,
        owner_pid(),
        "300"
    ]);
}

function release_runtime_lock(lock_dir) {
    service_state_success([ "release-runtime-dir-lock", lock_dir, owner_pid() ]);
}

function unsigned_number(value) {
    value = as_string(value);
    if (value == "" || match(value, /[^0-9]/) != null)
        return null;
    return int(value);
}

function update_due_status(now_value, last_run_value, interval_value) {
    let now = unsigned_number(now_value);
    let interval = unsigned_number(interval_value);

    if (now == null || interval == null || interval <= 0)
        return 2;

    let last_run = unsigned_number(last_run_value);
    if (last_run == null)
        last_run = 0;

    if (last_run > 0 && now - last_run < interval)
        return 1;

    return 0;
}

function update_is_due(now_value, last_run_value, interval_value) {
    exit(update_due_status(now_value, last_run_value, interval_value));
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
        total = total + amount * multipliers[unit];
        rest = substr(rest, length(token));
    }

    if (total <= 0)
        return null;

    return int(total + 0.5);
}

function duration_to_seconds(value) {
    let seconds = duration_to_seconds_value(value);
    if (seconds == null)
        exit(1);

    print(seconds, "\n");
}

function due_check_cron_schedule_text(value) {
    let seconds = arg_number(value);

    if (seconds <= 60)
        return "* * * * *";

    if (seconds % 86400 == 0)
        return "0 0 * * *";

    if (seconds % 3600 == 0) {
        let hours = seconds / 3600;
        if (hours >= 1 && hours <= 23)
            return hours == 1 ? "0 * * * *" : "0 */" + hours + " * * *";
    }

    if (seconds % 60 == 0) {
        let minutes = seconds / 60;
        if (minutes >= 1 && minutes <= 59)
            return minutes == 1 ? "* * * * *" : "*/" + minutes + " * * * *";
    }

    return "* * * * *";
}

function due_check_cron_schedule(value) {
    print(due_check_cron_schedule_text(value), "\n");
}

function settings_component_update_check_interval(settings) {
    settings = object_or_empty(settings);

    if (!bool_option(settings, "component_update_check_enabled", false))
        return "";

    let value = option(settings, "component_update_check_interval", "1d");
    return value != "" ? value : "1d";
}

function line_contains_any_marker(line, markers) {
    line = as_string(line);
    for (let marker in markers) {
        marker = as_string(marker);
        if (marker != "" && index(line, marker) >= 0)
            return true;
    }

    return false;
}

function filter_cron_markers_text(data, markers) {
    data = as_string(data);
    if (data == "")
        return "";

    let lines = split(data, "\n");
    let has_trailing_newline = substr(data, length(data) - 1) == "\n";
    let result = "";

    for (let i = 0; i < length(lines); i++) {
        let line = as_string(lines[i]);
        if (i == length(lines) - 1 && has_trailing_newline && line == "")
            continue;
        if (line_contains_any_marker(line, markers))
            continue;
        result += line + "\n";
    }

    return result;
}

function cron_refresh_plan_rows(settings, bin, component_marker) {
    let status = 0;
    let rows = [];

    let component_interval = settings_component_update_check_interval(settings);
    if (component_interval != "") {
        let component_seconds = duration_to_seconds_value(component_interval);
        if (component_seconds == null) {
            push(rows, "component-error\t" + as_string(component_interval));
            status = 1;
        }
        else {
            push(rows, "component\t" + due_check_cron_schedule_text(component_seconds) + " " + as_string(bin) + " component_updates_if_due " + as_string(component_marker));
        }
    }

    return {
        status,
        rows
    };
}

function print_cron_refresh_plan(result) {
    result = object_or_empty(result);
    for (let row in result.rows)
        print(row, "\n");
    exit(int(result.status || 0));
}

function cron_refresh_plan(settings, bin, component_marker) {
    print_cron_refresh_plan(cron_refresh_plan_rows(settings, bin, component_marker));
}

function cron_refresh_apply_result(settings, existing_crontab, bin, component_marker) {
    let plan = cron_refresh_plan_rows(settings, bin, component_marker);
    let filtered_crontab = filter_cron_markers_text(existing_crontab, [ component_marker ]);
    let cron_jobs = "";
    let logs = [ { level: "info", message: "The cron job removed" } ];
    let tab = "\t";

    for (let row in plan.rows) {
        let line = as_string(row);
        let separator = index(line, tab);
        let type = separator >= 0 ? substr(line, 0, separator) : line;
        let rest = separator >= 0 ? substr(line, separator + 1) : "";

        if (type == "component") {
            cron_jobs += rest + "\n";
            push(logs, { level: "info", message: "The component update check cron job has been created: " + rest });
        }
        else if (type == "component-error") {
            push(logs, { level: "error", message: "Invalid component_update_check_interval value: " + rest });
        }
    }

    return {
        status: int(plan.status || 0),
        crontab: filtered_crontab + (int(plan.status || 0) == 0 ? cron_jobs : ""),
        logs
    };
}

function write_crontab_text(text) {
    let tmp = trim(command_output_from_args([ "mktemp" ]));
    if (tmp == "")
        return false;

    if (fs.writefile(tmp, as_string(text)) == null) {
        fs.unlink(tmp);
        return false;
    }

    let ok = command_success_from_args([ "crontab", tmp ]);
    fs.unlink(tmp);
    return ok;
}

function log_cron_apply_result(result) {
    for (let item in array_or_empty(object_or_empty(result).logs))
        log_message(item.message, item.level);
}

function remove_cron_jobs(component_marker) {
    let crontab = command_output_from_args([ "crontab", "-l" ]);
    let result = {
        crontab: filter_cron_markers_text(crontab, [ component_marker ]),
        logs: [ { level: "info", message: "The cron job removed" } ]
    };

    if (!write_crontab_text(result.crontab))
        exit(1);

    log_cron_apply_result(result);
}

function refresh_cron_from_sources(settings, bin, component_marker) {
    let result = cron_refresh_apply_result(
        settings,
        command_output_from_args([ "crontab", "-l" ]),
        bin,
        component_marker
    );

    if (!write_crontab_text(result.crontab))
        exit(1);

    log_cron_apply_result(result);
    exit(result.status);
}

function json_length(path) {
    let value = read_json_file(path);
    if (type(value) == "array" || type(value) == "object")
        print(length(value), "\n");
    else
        print("0\n");
}

function job_started_at_within_grace(value, now, grace_seconds) {
    let started_at = arg_number(value);
    now = arg_number(now);
    grace_seconds = arg_number(grace_seconds);

    if (started_at <= 0 || now <= 0)
        return false;

    return now - started_at < grace_seconds;
}

function job_pid_valid(pid) {
    pid = as_string(pid);
    return pid != "" && match(pid, /^[0-9]+$/) != null;
}

function pid_running(pid) {
    pid = as_string(pid);
    return job_pid_valid(pid) && command_success_from_args([ "kill", "-0", pid ]);
}

function component_job_json_response(success, job_id, message) {
    write_json({
        success: arg_bool(success),
        job_id: as_string(job_id),
        message: as_string(message)
    });
}

function component_action_status_error(message) {
    write_json({
        success: false,
        running: false,
        kind: "component",
        component: "unknown",
        action: "status",
        message: as_string(message),
        current_version: "",
        latest_version: "",
        changed: 0,
        status: "",
        exit_code: null
    });
}

function component_action_status_error_exit(message) {
    component_action_status_error(message);
    exit(1);
}

function component_running_job_state_value(component, action, started_at) {
    return {
        success: true,
        running: true,
        kind: "component",
        component: as_string(component),
        action: as_string(action),
        message: "Component action is running",
        pid: null,
        started_at: arg_number(started_at),
        updated_at: null,
        current_version: "",
        latest_version: "",
        changed: 0,
        status: "",
        exit_code: null
    };
}

function normalize_component_name(component) {
    component = as_string(component);
    if (component == "sing-box" || component == "singbox")
        return "sing_box";
    if (component == "forkop")
        return "forkop";
    return component;
}

function valid_component_name(component) {
    component = normalize_component_name(component);
    return component == "forkop" || component == "sing_box" || component == "zapret" ||
        component == "zapret2" || component == "byedpi";
}

function component_update_check_cache_path(component) {
    component = normalize_component_name(component);
    if (!valid_component_name(component))
        return "";
    return COMPONENT_UPDATE_CHECK_CACHE_DIR + "/" + component + ".json";
}

function component_update_check_cache_enabled() {
    return settings_component_update_check_interval(uci_settings()) != "";
}

function component_update_check_result_cacheable(value) {
    value = object_or_empty(value);
    let status = as_string(value.status || "");
    return value.success === true && as_string(value.action) == "check_update" &&
        valid_component_name(value.component) &&
        (status == "latest" || status == "outdated" || status == "dev");
}

function cache_component_update_check_result(value, notify_update) {
    value = object_or_empty(value);
    if (!component_update_check_result_cacheable(value))
        return false;

    let component = normalize_component_name(value.component);
    let path = component_update_check_cache_path(component);
    if (path == "" || !ensure_dir(COMPONENT_UPDATE_CHECK_CACHE_DIR))
        return false;

    let previous = object_or_empty(read_json_file(path));
    let cached = {
        success: true,
        component,
        action: "check_update",
        message: as_string(value.message),
        current_version: as_string(value.current_version),
        latest_version: as_string(value.latest_version),
        release_url: as_string(value.release_url),
        changed: 0,
        status: as_string(value.status),
        updated_at: now_seconds()
    };
    if (!write_state_file(path, cached))
        return false;

    if (arg_bool(notify_update) && cached.status == "outdated" &&
        (as_string(previous.status) != "outdated" ||
            as_string(previous.latest_version) != cached.latest_version)) {
        log_message("[component-update] " + component + " " + cached.latest_version, "info");
    }

    return true;
}

function update_component_check_cache_from_action(value) {
    value = object_or_empty(value);
    let component = normalize_component_name(value.component);
    let action = as_string(value.action);
    let path = component_update_check_cache_path(component);
    if (path == "")
        return;

    if (action == "remove" && value.success === true) {
        remove_file(path);
        return;
    }

    if (!component_update_check_cache_enabled())
        return;

    if (action == "check_update") {
        cache_component_update_check_result(value, false);
        return;
    }

    if (value.success === true && (action == "install" || match(action, /^install_/) != null)) {
        let latest_version = as_string(value.latest_version);
        if (latest_version == "")
            latest_version = as_string(value.current_version);
        cache_component_update_check_result({
            success: true,
            component,
            action: "check_update",
            message: "Latest version is installed",
            current_version: as_string(value.current_version),
            latest_version,
            release_url: as_string(value.release_url),
            status: "latest"
        }, false);
    }
}

function clear_component_update_check_cache() {
    for (let path in fs.glob(COMPONENT_UPDATE_CHECK_CACHE_DIR + "/*.json"))
        remove_file(path);
    remove_file(COMPONENT_UPDATE_CHECK_STATE_FILE);
}

function component_update_check_cache() {
    let enabled = component_update_check_cache_enabled();
    let results = [];

    if (enabled) {
        for (let component in [ "forkop", "sing_box", "zapret", "zapret2", "byedpi" ]) {
            let value = read_json_file(component_update_check_cache_path(component));
            if (component_update_check_result_cacheable(value))
                push(results, value);
        }
    }

    write_json({ enabled, results });
}

function valid_component_job_id(job_id) {
    job_id = as_string(job_id);
    return job_id != "" && job_id != "." && job_id != ".." && match(job_id, /[^A-Za-z0-9._-]/) == null;
}

function component_job_state_path_value(job_id) {
    if (!valid_component_job_id(job_id))
        return "";
    return COMPONENT_JOB_DIR + "/" + as_string(job_id) + ".json";
}

function component_job_id() {
    let stamp = clock();
    return sprintf("%d-%d", stamp[0], stamp[1]);
}

function component_job_output_path(job_id) {
    return COMPONENT_JOB_DIR + "/" + as_string(job_id) + ".out";
}

function component_job_output_path_from_state(path) {
    path = as_string(path);
    if (length(path) >= 5 && substr(path, length(path) - 5) == ".json")
        return substr(path, 0, length(path) - 5) + ".out";
    return path + ".out";
}

function remove_component_job_state(path) {
    let output_path = component_job_output_path_from_state(path);
    remove_file(path);
    remove_file(output_path);
    remove_file(output_path + ".json");
}

function component_job_running_is(path, expected) {
    let value = read_json_file(path);
    let running = type(value) == "object" && value.running === true;
    return running == arg_bool(expected);
}

function ensure_component_runtime_dirs() {
    return ensure_dir(COMPONENT_JOB_DIR);
}

function write_component_stale_job_state(path) {
    let value = object_or_empty(read_json_file(path));
    value.success = false;
    value.running = false;
    value.kind = "component";
    value.message = "Component action job is stale or the worker process exited unexpectedly";
    value.changed = 0;
    value.status = "";
    value.exit_code = null;
    value.updated_at = now_seconds();
    return write_state_file(path, value);
}

function refresh_component_running_job_state(path) {
    let value = read_json_file(path);
    if (type(value) != "object" || value.running !== true)
        return;

    let now = now_seconds();
    let within_grace = job_started_at_within_grace(value.started_at, now, COMPONENT_JOB_STALE_GRACE_SECONDS);
    let pid = as_string(value.pid || "");

    if (!job_pid_valid(pid)) {
        if (!within_grace)
            write_component_stale_job_state(path);
        return;
    }

    if (pid_running(pid) || within_grace)
        return;

    command_success_from_args([ "sleep", "1" ]);
    value = read_json_file(path);
    if (type(value) != "object" || value.running !== true)
        return;
    if (pid_running(pid))
        return;

    write_component_stale_job_state(path);
}

function path_basename_without_suffix(path, suffix) {
    let parts = split(as_string(path), "/");
    let name = length(parts) > 0 ? as_string(parts[length(parts) - 1]) : "";
    suffix = as_string(suffix);
    if (length(name) >= length(suffix) && substr(name, length(name) - length(suffix)) == suffix)
        return substr(name, 0, length(name) - length(suffix));
    return name;
}

function component_cleanup_jobs() {
    ensure_dir(COMPONENT_JOB_DIR);

    for (let path in fs.glob(COMPONENT_JOB_DIR + "/*.json"))
        refresh_component_running_job_state(path);

    for (let output_path in fs.glob(COMPONENT_JOB_DIR + "/*.out")) {
        let state_file = component_job_state_path_value(path_basename_without_suffix(output_path, ".out"));
        if (state_file == "" || fs.stat(state_file) == null || !component_job_running_is(state_file, true)) {
            remove_file(output_path);
            remove_file(output_path + ".json");
        }
    }

    command_success_from_args([
        "find",
        COMPONENT_JOB_DIR,
        "-type", "f",
        "-name", "*.out",
        "-mmin", "+" + as_string(COMPONENT_JOB_ORPHAN_OUTPUT_TTL_MINUTES),
        "-delete"
    ]);
    command_success_from_args([
        "find",
        COMPONENT_JOB_DIR,
        "-type", "f",
        "-name", "*.out.json",
        "-mmin", "+" + as_string(COMPONENT_JOB_ORPHAN_OUTPUT_TTL_MINUTES),
        "-delete"
    ]);
    command_success_from_args([
        "find",
        COMPONENT_JOB_DIR,
        "-type", "f",
        "-name", "*.json.*",
        "-mmin", "+10",
        "-delete"
    ]);

    let old = command_output_from_args([
        "find",
        COMPONENT_JOB_DIR,
        "-type", "f",
        "-name", "*.json",
        "-mmin", "+" + as_string(COMPONENT_JOB_FINISHED_TTL_MINUTES)
    ]);

    for (let path in split(old, "\n")) {
        path = trim(as_string(path));
        if (path != "" && component_job_running_is(path, false))
            remove_component_job_state(path);
    }
}

function set_component_running_job_pid(path, pid) {
    pid = as_string(pid);
    if (!job_pid_valid(pid))
        return false;

    let value = object_or_empty(read_json_file(path));
    if (value.running === true) {
        value.pid = pid;
        return write_state_file(path, value);
    }

    return false;
}

function output_json_object(path) {
    let data = as_string(fs.readfile(path) || "");

    try {
        let value = json(data);
        if (type(value) == "object")
            return value;
    }
    catch (e) {
    }

    let result = null;
    for (let line in split(data, "\n")) {
        line = trim(as_string(line));
        let start = index(line, "{");
        if (start < 0)
            continue;
        try {
            let value = json(substr(line, start));
            if (type(value) == "object")
                result = value;
        }
        catch (e) {
        }
    }

    return result;
}

function component_fallback_job_state(component, action, message, exit_code, updated_at) {
    return {
        success: false,
        running: false,
        kind: "component",
        component: as_string(component),
        action: as_string(action),
        message: as_string(message),
        current_version: "",
        latest_version: "",
        changed: 0,
        status: "",
        exit_code: arg_number(exit_code),
        updated_at: arg_number(updated_at)
    };
}

function finish_component_job(path, component, action, exit_code, output_file) {
    let updated_at = now_seconds();
    let value = output_json_object(output_file);
    let ok;

    if (type(value) == "object") {
        value.running = false;
        value.kind = "component";
        value.exit_code = arg_number(exit_code);
        value.updated_at = updated_at;
        update_component_check_cache_from_action(value);
        ok = write_state_file(path, value);
    }
    else {
        let raw_output = file_last_nonblank_line_value(output_file, "Failed to execute", 240);
        ok = write_state_file(path, component_fallback_job_state(component, action, raw_output, exit_code, updated_at));
    }

    remove_file(output_file);
    remove_file(output_file + ".json");
    return ok;
}

function component_worker_env() {
    return {
        FORKOP_CONFIG_NAME: CONFIG_NAME,
        FORKOP_LIB: LIB_DIR,
        FORKOP_BIN: BIN_PATH,
        FORKOP_SERVICE_INIT: SERVICE_INIT,
        UPDATES_JOB_DIR: COMPONENT_JOB_DIR,
        UPDATES_JOB_FINISHED_TTL_MINUTES: COMPONENT_JOB_FINISHED_TTL_MINUTES,
        UPDATES_JOB_ORPHAN_OUTPUT_TTL_MINUTES: COMPONENT_JOB_ORPHAN_OUTPUT_TTL_MINUTES,
        UPDATES_JOB_STALE_GRACE_SECONDS: COMPONENT_JOB_STALE_GRACE_SECONDS,
        FORKOP_UI_COMPONENT_ACTION_TRACKED: "1"
    };
}

function launch_component_worker(args) {
    let command_args = [ "ucode", "-L", LIB_DIR, LIB_DIR + "/components/updates.uc" ];
    for (let arg in args)
        push(command_args, arg);

    let command = command_env(component_worker_env()) + " " +
        command_from_args(command_args) +
        " >/dev/null 2>&1 1000>&- & echo $!";
    return trim(command_output("sh -c " + shell_quote(command)));
}

function component_action_worker(state_file, output_file, component, action) {
    component = normalize_component_name(component);
    let command = command_env(component_worker_env()) + " " +
        command_from_args([
            "ucode",
            "-L", LIB_DIR,
            LIB_DIR + "/components/action.uc",
            "component-action",
            as_string(component),
            as_string(action)
        ]) + " >" + shell_quote(output_file) + " 2>&1";
    let status = command_status(command);

    finish_component_job(state_file, component, action, status, output_file);
}

function component_action_async(component, action) {
    component = normalize_component_name(component);
    if (!ensure_component_runtime_dirs()) {
        component_job_json_response(false, "", "Failed to create component action state directory");
        exit(1);
    }

    component_cleanup_jobs();

    let job_id = component_job_id();
    let state_file = component_job_state_path_value(job_id);
    if (state_file == "") {
        component_job_json_response(false, "", "Failed to prepare component action job");
        exit(1);
    }

    if (!write_state_file(state_file, component_running_job_state_value(component, action, now_seconds()))) {
        component_job_json_response(false, "", "Failed to write component action state");
        exit(1);
    }

    let output_file = component_job_output_path(job_id);
    let pid = launch_component_worker([
        "component-action-worker",
        state_file,
        output_file,
        as_string(component),
        as_string(action)
    ]);

    if (pid == "" || !set_component_running_job_pid(state_file, pid)) {
        if (pid != "")
            command_success_from_args([ "kill", pid ]);
        component_job_json_response(false, "", "Failed to write component action worker pid");
        exit(1);
    }

    component_job_json_response(true, job_id, "Component action started");
}

function component_action_status(job_id) {
    ensure_dir(COMPONENT_JOB_DIR);
    component_cleanup_jobs();

    let state_file = component_job_state_path_value(job_id);
    if (state_file == "")
        component_action_status_error_exit("Invalid component action job id");

    if (fs.stat(state_file) == null)
        component_action_status_error_exit("Component action job was not found");

    refresh_component_running_job_state(state_file);
    print(as_string(fs.readfile(state_file)));
}

function automatic_component_check_names() {
    let result = [ "forkop" ];

    if (fs.stat("/usr/bin/sing-box") != null)
        push(result, "sing_box");
    if (module_success([ LIB_DIR + "/providers/zapret/runtime.uc", "installed" ]))
        push(result, "zapret");
    if (module_success([ LIB_DIR + "/providers/zapret2/runtime.uc", "installed" ]))
        push(result, "zapret2");
    if (module_success([ LIB_DIR + "/providers/byedpi/runtime.uc", "installed" ]))
        push(result, "byedpi");

    return result;
}

function run_automatic_component_update_check(component) {
    let output_file = temp_path();
    if (output_file == "")
        return false;

    let command = command_env(component_worker_env()) + " " +
        command_from_args([
            "ucode",
            "-L", LIB_DIR,
            LIB_DIR + "/components/action.uc",
            "component-action",
            as_string(component),
            "check_update"
        ]) + " >" + shell_quote(output_file) + " 2>&1";
    let status = command_status(command);
    let value = output_json_object(output_file);
    remove_file(output_file);

    if (status != 0 || !component_update_check_result_cacheable(value))
        return false;

    return cache_component_update_check_result(value, true);
}

function component_updates_if_due() {
    let interval = settings_component_update_check_interval(uci_settings());
    if (interval == "")
        exit(0);

    let seconds = duration_to_seconds_value(interval);
    if (seconds == null) {
        log_message("Invalid component_update_check_interval value: " + interval, "error");
        exit(1);
    }

    let due = update_due_status(
        now_seconds(),
        file_first_line_value(COMPONENT_UPDATE_CHECK_STATE_FILE),
        seconds
    );
    if (due == 1)
        exit(0);
    if (due != 0)
        exit(1);

    if (!acquire_runtime_lock(COMPONENT_UPDATE_CHECK_LOCK_DIR, false))
        exit(0);

    due = update_due_status(
        now_seconds(),
        file_first_line_value(COMPONENT_UPDATE_CHECK_STATE_FILE),
        seconds
    );
    if (due != 0) {
        release_runtime_lock(COMPONENT_UPDATE_CHECK_LOCK_DIR);
        exit(due == 1 ? 0 : 1);
    }

    ensure_dir(COMPONENT_UPDATE_CHECK_CACHE_DIR);
    for (let component in automatic_component_check_names())
        run_automatic_component_update_check(component);

    if (!write_file(COMPONENT_UPDATE_CHECK_STATE_FILE, as_string(now_seconds()) + "\n")) {
        release_runtime_lock(COMPONENT_UPDATE_CHECK_LOCK_DIR);
        log_message("Failed to write component update check timestamp", "error");
        exit(1);
    }
    release_runtime_lock(COMPONENT_UPDATE_CHECK_LOCK_DIR);
}

function native_subscription_provider_tag(section, source_index) {
    return section_name(section) + "-subscription-" + source_index + "-provider";
}

function native_subscription_api_url(settings) {
    let config = read_json_file(option(settings, "config_path", "/etc/sing-box/config.json"));
    let experimental = object_or_empty(object_or_empty(config).experimental);
    let controller = option(object_or_empty(experimental.clash_api), "external_controller", "");
    if (controller == "") {
        let address = option(settings, "service_listen_address", "");
        if (address == "")
            return "";
        controller = address + ":9090";
    }
    if (substr(controller, 0, 8) == "0.0.0.0:")
        controller = "127.0.0.1:" + substr(controller, 8);
    return "http://" + controller;
}

function update_native_subscription_provider(tag, settings) {
    if (match(as_string(tag), /^[A-Za-z0-9_-]+$/) == null)
        return false;

    let api_url = native_subscription_api_url(settings);
    if (api_url == "")
        return false;

    let args = [
        "curl", "-fsS", "-X", "PUT",
        api_url + "/providers/proxies/" + as_string(tag)
    ];
    let secret = option(settings, "yacd_secret_key", "");
    if (secret != "") {
        push(args, "-H");
        push(args, "Authorization: Bearer " + secret);
    }
    return command_status(command_from_args(args)) == 0;
}

function subscription_update_common(target_section, target_source_index) {
    target_section = as_string(target_section);
    let selected_index = as_string(target_source_index) != "" ? arg_number(target_source_index) : 0;
    let settings = uci_settings();
    let found = 0;
    let failed = 0;

    for (let section in uci_sections("section")) {
        if (target_section != "" && section_name(section) != target_section)
            continue;
        let sources = connections.subscription_urls(section);
        for (let i = 0; i < length(sources); i++) {
            if (selected_index > 0 && i + 1 != selected_index)
                continue;
            found++;
            let tag = native_subscription_provider_tag(section, i + 1);
            if (!update_native_subscription_provider(tag, settings)) {
                log_message("Failed to refresh subscription provider " + tag, "error");
                failed++;
            }
        }
    }

    if (found == 0) {
        log_message("No matching subscription provider was found", "error");
        return 1;
    }
    if (failed > 0) {
        log_message("Failed to refresh " + failed + " of " + found + " subscription providers", "error");
        return 1;
    }
    return 0;
}

function subscription_update(target_section, target_source_index) {
    exit(subscription_update_common(target_section, target_source_index));
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

function fixture_cron_refresh_plan(path, bin, component_marker) {
    let data = object_or_empty(read_json_file(path));
    cron_refresh_plan(
        object_or_empty(data.settings),
        bin,
        component_marker
    );
}

function fixture_cron_refresh_apply(path, existing_crontab_path, bin, component_marker) {
    let data = object_or_empty(read_json_file(path));
    let result = cron_refresh_apply_result(
        object_or_empty(data.settings),
        fs.readfile(as_string(existing_crontab_path)) || "",
        bin,
        component_marker
    );

    write_json({
        crontab: result.crontab,
        logs: result.logs
    });
    exit(result.status);
}

function uci_cron_refresh_plan(bin, component_marker) {
    cron_refresh_plan(
        uci_settings(),
        bin,
        component_marker
    );
}

function uci_refresh_cron(bin, component_marker) {
    let settings = uci_settings();
    if (settings_component_update_check_interval(settings) == "")
        clear_component_update_check_cache();
    refresh_cron_from_sources(
        settings,
        bin,
        component_marker
    );
}

let mode = ARGV[0] || "";

if (mode == "json-length")
    json_length(ARGV[1]);
else if (mode == "update-is-due")
    update_is_due(ARGV[1], ARGV[2], ARGV[3]);
else if (mode == "duration-to-seconds")
    duration_to_seconds(ARGV[1]);
else if (mode == "due-check-cron-schedule")
    due_check_cron_schedule(ARGV[1]);
else if (mode == "cron-refresh-plan")
    uci_cron_refresh_plan(ARGV[1], ARGV[2]);
else if (mode == "cron-refresh-plan-fixture")
    fixture_cron_refresh_plan(ARGV[1], ARGV[2], ARGV[3]);
else if (mode == "refresh-cron-from-uci")
    uci_refresh_cron(ARGV[1], ARGV[2]);
else if (mode == "refresh-cron-fixture")
    fixture_cron_refresh_apply(ARGV[1], ARGV[2], ARGV[3], ARGV[4]);
else if (mode == "remove-cron-jobs")
    remove_cron_jobs(ARGV[1]);
else if (mode == "subscription-update")
    subscription_update(ARGV[1], ARGV[2]);
else if (mode == "component-action-worker")
    component_action_worker(ARGV[1], ARGV[2], ARGV[3], ARGV[4]);
else if (mode == "component-action-async")
    component_action_async(ARGV[1], ARGV[2]);
else if (mode == "component-action-status")
    component_action_status(ARGV[1]);
else if (mode == "component-updates-if-due")
    component_updates_if_due();
else if (mode == "component-update-check-cache")
    component_update_check_cache();
else {
    warn("Usage: components/updates.uc <operation> ...\n");
    exit(1);
}
