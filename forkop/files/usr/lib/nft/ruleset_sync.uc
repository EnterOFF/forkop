#!/usr/bin/env ucode

let fs = require("fs");
let common = require("core.common");
let core_ip = require("core.ip");
let rule_config = require("config.rule");
let connections = require("config.connections");
let runtime_rulesets = require("singbox.rulesets");
let uci_core = require("core.uci");

const DEFAULT_TABLE = getenv("NFT_TABLE_NAME") || "ForkopTable";
const MAX_ELEMENTS_PER_LINE = 256;
const MAX_LINE_LENGTH = 8192;
const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || "forkop";
const LIB_DIR = getenv("FORKOP_LIB") || "/usr/lib/forkop";
const SING_BOX_CONFIG = getenv("FORKOP_SING_BOX_CONFIG") || "/etc/sing-box/config.json";
const WORKER_PID_FILE = getenv("FORKOP_RULESET_SYNC_PID_FILE") || "/var/run/forkop/ruleset-sync.pid";
const WORKER_RETRY_SECONDS = getenv("FORKOP_RULESET_SYNC_RETRY_SECONDS") || "3";
const SCRIPT_PATH = getenv("FORKOP_RULESET_SYNC_UC") || LIB_DIR + "/nft/ruleset_sync.uc";
const UBUS_BIN = getenv("FORKOP_UBUS_BIN") || "ubus";
const PROCD_SERVICE_NAME = getenv("FORKOP_RULESET_SYNC_SERVICE_NAME") || "forkop-ruleset-sync";
let last_applied_script = null;

function as_string(value) {
    return value == null ? "" : "" + value;
}

function object_or_empty(value) {
    return type(value) == "object" ? value : {};
}

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function command_from_args(args) {
    let result = [];
    for (let arg in args)
        push(result, shell_quote(arg));
    return join(" ", result);
}

function command_capture(args) {
    let pipe = fs.popen(command_from_args(args), "r");
    if (!pipe)
        return { status: 1, output: "" };
    let output = pipe.read("all");
    let status = pipe.close();
    return { status, output: output == null ? "" : as_string(output) };
}

function command_success(args) {
    return system(command_from_args(args) + " >/dev/null 2>&1") == 0;
}

function log_message(message, level) {
    command_success([ "logger", "-t", "forkop", "[" + as_string(level || "info") + "] " + as_string(message) ]);
}

function owner_pid() {
    let stat = as_string(fs.readfile("/proc/self/stat"));
    let separator = index(stat, " ");
    return separator > 0 ? substr(stat, 0, separator) : "0";
}

function pid_running(pid) {
    pid = as_string(pid);
    return match(pid, /^[0-9]+$/) != null && command_success([ "kill", "-0", pid ]);
}

function path_basename(path) {
    path = as_string(path);
    let slash = rindex(path, "/");
    return slash >= 0 ? substr(path, slash + 1) : path;
}

function worker_cmdline_matches(cmdline) {
    cmdline = as_string(cmdline);
    let first_separator = index(cmdline, "\0");
    let executable = first_separator >= 0 ? substr(cmdline, 0, first_separator) : cmdline;
    return path_basename(executable) == "ucode" &&
        index(cmdline, "\0" + SCRIPT_PATH + "\0worker\0") >= 0;
}

function pid_is_worker(pid) {
    pid = as_string(pid);
    return pid_running(pid) && worker_cmdline_matches(fs.readfile("/proc/" + pid + "/cmdline"));
}

function safe_identifier(value) {
    return match(as_string(value), /^[A-Za-z0-9_]+$/) != null;
}

function fail(plan, message) {
    if (plan.error == "")
        plan.error = as_string(message);
    return false;
}

function add_unique(values, seen, value) {
    value = as_string(value);
    if (seen[value])
        return false;
    seen[value] = true;
    push(values, value);
    return true;
}

function add_rule_set_ip(plan, prefix) {
    push(plan.rule_set_ip_values, prefix);
}

function section_values(section, key) {
    let raw = object_or_empty(section)[key];
    let list_values = type(raw) == "array" ? raw : [];
    let option_values = type(raw) == "array" ? [] : rule_config.text_list_values(raw, "comma-space");
    let text_values = rule_config.text_list_values(object_or_empty(section)[key + "_text"], "comma-space");
    let text_mode = as_string(object_or_empty(section)[key + "_text_mode"] || "0");
    let all_text_mode = as_string(object_or_empty(section).conditions_text_mode || "0");

    if (text_mode == "1" || all_text_mode == "1")
        return text_values;
    if (length(list_values) > 0)
        return list_values;
    if (length(option_values) > 0)
        return option_values;
    return text_values;
}

function section_port_values(section) {
    let result = [];
    let raw = object_or_empty(section).ports;

    if (type(raw) == "array") {
        for (let value in raw)
            push(result, value);
    }
    else {
        for (let value in rule_config.text_list_values(raw, "comma-space"))
            push(result, value);
    }

    for (let value in rule_config.text_list_values(object_or_empty(section).ports_text, "comma-space"))
        push(result, value);
    return result;
}

function parse_port_range(plan, value, label) {
    value = trim(as_string(value));
    let matched = match(value, /^([0-9]+)(-([0-9]+))?$/);
    if (matched == null) {
        fail(plan, label + ": invalid port " + value);
        return null;
    }

    let start = int(matched[1]);
    let end = matched[3] == null ? start : int(matched[3]);
    if (start < 1 || end > 65535 || start > end) {
        fail(plan, label + ": invalid port " + value);
        return null;
    }
    return { start, end };
}

function normalize_ranges(ranges) {
    sort(ranges, function(left, right) {
        return left.start == right.start ? left.end - right.end : left.start - right.start;
    });

    let result = [];
    for (let current in ranges) {
        let last = length(result) > 0 ? result[length(result) - 1] : null;
        if (last != null && current.start <= last.end + 1) {
            if (current.end > last.end)
                last.end = current.end;
            continue;
        }
        push(result, { start: current.start, end: current.end });
    }
    return result;
}

function section_port_ranges(plan, section) {
    let ranges = [];
    for (let value in section_port_values(section)) {
        let parsed = parse_port_range(plan, value, "section " + as_string(section[".name"]));
        if (parsed == null)
            return null;
        push(ranges, parsed);
    }
    return normalize_ranges(ranges);
}

function snapshot_port_ranges(plan, values, label) {
    if (type(values) != "array") {
        fail(plan, label + ": port_ranges must be an array");
        return null;
    }

    let result = [];
    for (let value in values) {
        if (type(value) != "object" || type(value.start) != "int" || type(value.end) != "int" ||
            value.start < 1 || value.end > 65535 || value.start > value.end) {
            fail(plan, label + ": invalid port range");
            return null;
        }
        push(result, { start: value.start, end: value.end });
    }
    return normalize_ranges(result);
}

function intersect_ranges(first, second) {
    let result = [];
    for (let left in first) {
        for (let right in second) {
            let start = max(left.start, right.start);
            let end = min(left.end, right.end);
            if (start <= end)
                push(result, { start, end });
        }
    }
    return normalize_ranges(result);
}

function port_text(value) {
    return value.start == value.end ? as_string(value.start) : value.start + "-" + value.end;
}

function provider_prefix_is_nft_safe(prefix, family) {
    return family == 4
        ? index(prefix, ".") >= 0 && match(prefix, /[^0-9.\/]/) == null
        : family == 6 && index(prefix, ":") >= 0 && match(prefix, /[^0-9A-Fa-f:.\/]/) == null;
}

function add_prefix(plan, prefix, family, ranges, from_rule_set) {
    prefix = trim(as_string(prefix));
    let valid = provider_prefix_is_nft_safe(prefix, family);
    if ((family != 4 && family != 6) || (from_rule_set ? !valid : !core_ip.nft_ip_or_cidr(prefix) || core_ip.ip_family(prefix) != family))
        return fail(plan, "invalid IP prefix: " + prefix);

    let plain = family == 4 ? plan.ipv4 : plan.ipv6;
    let scoped = family == 4 ? plan.scoped_ipv4 : plan.scoped_ipv6;
    if (length(ranges) == 0) {
        push(plain.values, prefix);
        if (from_rule_set)
            add_rule_set_ip(plan, prefix);
        return true;
    }

    for (let range in ranges)
        push(scoped.values, prefix + " . " + port_text(range));
    if (from_rule_set)
        add_rule_set_ip(plan, prefix);
    return true;
}

function add_prefix_array(plan, values, family, ranges, label, from_rule_set) {
    if (type(values) != "array")
        return fail(plan, label + " must be an array");
    for (let prefix in values)
        if (!add_prefix(plan, prefix, family, ranges, from_rule_set))
            return false;
    return true;
}

function add_scoped_groups(plan, groups, family, section_ranges, label) {
    if (type(groups) != "array")
        return fail(plan, label + " must be an array");

    for (let i = 0; i < length(groups); i++) {
        let group = groups[i];
        if (type(group) != "object" || type(group.prefixes) != "array" || length(group.prefixes) == 0)
            return fail(plan, label + "[" + i + "]: invalid prefixes");

        let ranges = snapshot_port_ranges(plan, group.port_ranges, label + "[" + i + "]");
        if (ranges == null || length(ranges) == 0)
            return ranges == null ? false : fail(plan, label + "[" + i + "]: empty port_ranges");
        if (length(section_ranges) > 0)
            ranges = intersect_ranges(ranges, section_ranges);

        for (let prefix in group.prefixes) {
            prefix = trim(as_string(prefix));
            if (!provider_prefix_is_nft_safe(prefix, family))
                return fail(plan, "invalid IP prefix: " + prefix);
            let scoped = family == 4 ? plan.scoped_ipv4 : plan.scoped_ipv6;
            for (let range in ranges)
                push(scoped.values, prefix + " . " + port_text(range));
            if (length(ranges) > 0)
                add_rule_set_ip(plan, prefix);
        }
    }
    return true;
}

function validate_skipped(plan, skipped, label) {
    if (skipped == null)
        return true;
    if (type(skipped) != "array")
        return fail(plan, label + ": skipped must be an array");
    for (let item in skipped)
        if (type(item) != "object" || type(item.path) != "string" || item.path == "" ||
            type(item.reason) != "string" || item.reason == "")
            return fail(plan, label + ": invalid skipped entry");
    plan.skipped += length(skipped);
    return true;
}

function add_provider(plan, provider, tag, section_ranges) {
    let label = "provider " + as_string(tag);
    if (type(provider) != "object" || type(provider.revision) != "int" || provider.revision < 1)
        return fail(plan, label + ": provider is not loaded");

    let ip_cidr = provider.ip_cidr;
    if (type(ip_cidr) != "object")
        return fail(plan, label + ": missing ip_cidr snapshot");

    return validate_skipped(plan, ip_cidr.skipped, label) &&
        add_prefix_array(plan, ip_cidr.ipv4, 4, section_ranges, label + ".ip_cidr.ipv4", true) &&
        add_prefix_array(plan, ip_cidr.ipv6, 6, section_ranges, label + ".ip_cidr.ipv6", true) &&
        add_scoped_groups(plan, ip_cidr.scoped_ipv4, 4, section_ranges, label + ".ip_cidr.scoped_ipv4") &&
        add_scoped_groups(plan, ip_cidr.scoped_ipv6, 6, section_ranges, label + ".ip_cidr.scoped_ipv6");
}

function append_set_transaction(lines, table, set_name, elements) {
    push(lines, "flush set inet " + table + " " + set_name);
    sort(elements);

    let prefix = "add element inet " + table + " " + set_name + " { ";
    let chunk = [];
    let chunk_length = length(prefix) + 2;
    let last = null;
    for (let element in elements) {
        if (element == last)
            continue;
        last = element;
        let added_length = length(element) + (length(chunk) > 0 ? 2 : 0);
        if (length(chunk) > 0 &&
            (length(chunk) >= MAX_ELEMENTS_PER_LINE || chunk_length + added_length > MAX_LINE_LENGTH)) {
            push(lines, prefix + join(", ", chunk) + " }");
            chunk = [];
            chunk_length = length(prefix) + 2;
        }
        push(chunk, element);
        chunk_length += added_length;
    }
    if (length(chunk) > 0)
        push(lines, prefix + join(", ", chunk) + " }");
}

function finalize_rule_set_ip_count(plan) {
    sort(plan.rule_set_ip_values);
    let last = null;
    for (let prefix in plan.rule_set_ip_values) {
        if (prefix != last) {
            plan.rule_set_ips++;
            last = prefix;
        }
    }
    plan.rule_set_ip_values = null;
}

function fixture_tags(section) {
    let raw = object_or_empty(section).rule_set_tags;
    if (type(raw) == "array")
        return raw;
    return rule_config.text_list_values(raw, "comma-space");
}

function expected_nft_tags(section) {
    section = object_or_empty(section);
    let section_name = as_string(section[".name"]);
    let result = [];
    let seen = {};

    for (let community in connections.community_lists(section))
        if (rule_config.community_service_has_subnet_list(community))
            add_unique(result, seen, runtime_rulesets.community_tag(section_name, community));
    for (let reference in connections.rule_sets_with_subnets(section))
        add_unique(result, seen, runtime_rulesets.custom_reference_tag(reference));
    return result;
}

function priority_action(action) {
    action = as_string(action);
    if (action == "bypass")
        return true;
    return action == "connection" || action == "proxy" || action == "outbound" || action == "vpn" ||
        action == "block" || action == "zapret" || action == "zapret2" || action == "byedpi";
}

function section_needs_priority_sets(section) {
    section = object_or_empty(section);
    if (!common.bool_option(section, "enabled", true) || !priority_action(section.action))
        return false;

    let inline_ip = length(section_values(section, "ip_cidr")) > 0;
    let subnet_sources = length(expected_nft_tags(section)) > 0;
    let port_only = length(section_port_values(section)) > 0 &&
        !inline_ip && !connections.has_dns_matchers(section);
    return length(common.list_option(section, "fully_routed_ips")) > 0 || inline_ip || subnet_sources || port_only;
}

function build_plan(snapshot, section, tags, table) {
    section = object_or_empty(section);
    table = as_string(table || DEFAULT_TABLE);
    let section_name = as_string(section[".name"]);
    let plan = {
        error: "",
        summary: "",
        script: "",
        rule_set_ips: 0,
        rule_set_ip_values: [],
        skipped: 0,
        ipv4: { values: [] },
        ipv6: { values: [] },
        scoped_ipv4: { values: [] },
        scoped_ipv6: { values: [] }
    };

    if (!safe_identifier(table) || !safe_identifier(section_name)) {
        fail(plan, "unsafe nftables table or section name");
        return plan;
    }
    if (type(snapshot) != "object" || type(snapshot.providers) != "object" ||
        type(snapshot.revision) != "int" || snapshot.revision < 0) {
        fail(plan, "malformed rule-set provider snapshot");
        return plan;
    }
    if (type(tags) != "array") {
        fail(plan, "expected rule-set tags must be an array");
        return plan;
    }

    let ports = section_port_ranges(plan, section);
    if (ports == null)
        return plan;
    for (let prefix in section_values(section, "ip_cidr"))
        if (!add_prefix(plan, prefix, core_ip.ip_family(trim(as_string(prefix))), ports))
            return plan;

    let seen_tags = {};
    for (let tag_value in tags) {
        let tag = as_string(tag_value);
        if (tag == "") {
            fail(plan, "empty expected rule-set tag");
            return plan;
        }
        if (seen_tags[tag])
            continue;
        seen_tags[tag] = true;
        if (snapshot.providers[tag] == null) {
            fail(plan, "missing rule-set provider: " + tag);
            return plan;
        }
        if (!add_provider(plan, snapshot.providers[tag], tag, ports))
            return plan;
    }

    finalize_rule_set_ip_count(plan);

    let prefix = "forkop_rule_" + section_name;
    let lines = [];
    append_set_transaction(lines, table, prefix + "_subnets", plan.ipv4.values);
    append_set_transaction(lines, table, prefix + "_subnets6", plan.ipv6.values);
    append_set_transaction(lines, table, prefix + "_ip_ports", plan.scoped_ipv4.values);
    append_set_transaction(lines, table, prefix + "_ip6_ports", plan.scoped_ipv6.values);
    plan.script = join("\n", lines) + "\n";
    plan.summary = "Added " + plan.rule_set_ips + " IP addresses from rule sets to nft";
    return plan;
}

function apply_plan(plan) {
    if (type(plan) != "object" || plan.error != "")
        return false;
    if (plan.script == "")
        return true;

    let pipe = fs.popen("nft -f -", "w");
    if (!pipe)
        return false;
    let written = pipe.write(plan.script);
    let status = pipe.close();
    return written != null && status == 0;
}

function build_batch(snapshot, sections, table) {
    table = as_string(table || DEFAULT_TABLE);
    let batch = {
        error: "",
        summary: "",
        script: "",
        rule_set_ips: 0,
        skipped: 0,
        sections: 0
    };

    if (!safe_identifier(table)) {
        fail(batch, "unsafe nftables table name");
        return batch;
    }
    if (type(snapshot) != "object" || type(snapshot.providers) != "object" ||
        type(snapshot.revision) != "int" || snapshot.revision < 0) {
        fail(batch, "malformed rule-set provider snapshot");
        return batch;
    }
    if (type(sections) != "array") {
        fail(batch, "sections must be an array");
        return batch;
    }

    let seen_sections = {};
    for (let section in sections) {
        if (!section_needs_priority_sets(section))
            continue;

        let section_name = as_string(object_or_empty(section)[".name"]);
        if (seen_sections[section_name]) {
            fail(batch, "duplicate nft section: " + section_name);
            return batch;
        }
        seen_sections[section_name] = true;

        let plan = build_plan(snapshot, section, expected_nft_tags(section), table);
        if (plan.error != "") {
            fail(batch, plan.error);
            return batch;
        }
        batch.script += plan.script;
        batch.rule_set_ips += plan.rule_set_ips;
        batch.skipped += plan.skipped;
        batch.sections++;
    }

    batch.summary = "Added " + batch.rule_set_ips + " IP addresses from rule sets to nft";
    return batch;
}

function native_source_sections(sections) {
    let result = [];
    for (let section in sections)
        if (section_needs_priority_sets(section) && length(expected_nft_tags(section)) > 0)
            push(result, section);
    return result;
}

function runtime_sections() {
    return uci_core.section_objects(CONFIG_NAME, "section");
}

function native_api_config() {
    let config = object_or_empty(common.read_json_file(SING_BOX_CONFIG));
    let clash = object_or_empty(object_or_empty(config.experimental).clash_api);
    let controller = as_string(clash.external_controller);
    if (controller == "")
        return null;
    if (substr(controller, 0, 8) == "0.0.0.0:")
        controller = "127.0.0.1:" + substr(controller, 8);
    else if (substr(controller, 0, 5) == "[::]:")
        controller = "127.0.0.1:" + substr(controller, 5);
    else if (substr(controller, 0, 3) == ":::")
        controller = "127.0.0.1:" + substr(controller, 3);
    else if (substr(controller, 0, 1) == ":")
        controller = "127.0.0.1" + controller;
    return {
        url: "http://" + controller,
        secret: as_string(clash.secret)
    };
}

function native_api_request(path, maximum_time) {
    let api = native_api_config();
    if (api == null)
        return { status: 1, output: "" };

    let args = [
        "curl", "-fsS", "--connect-timeout", "2", "--max-time", as_string(maximum_time)
    ];
    if (api.secret != "") {
        push(args, "--header");
        push(args, "Authorization: Bearer " + api.secret);
    }
    push(args, api.url + as_string(path));
    return command_capture(args);
}

function parse_json(value) {
    try {
        return json(as_string(value));
    }
    catch (e) {
        return null;
    }
}

function apply_runtime_snapshot(snapshot, sections) {
    let batch = build_batch(snapshot, sections, DEFAULT_TABLE);
    if (batch.error != "") {
        log_message("Native rule-set nft sync deferred: " + batch.error, "warn");
        return false;
    }
    if (last_applied_script != null && batch.script == last_applied_script)
        return true;
    if (!apply_plan(batch)) {
        log_message("Native rule-set nft sync failed", "error");
        return false;
    }
    last_applied_script = batch.script;
    log_message(batch.summary, "info");
    return true;
}

function sync_runtime_once() {
    let sections = runtime_sections();
    if (length(native_source_sections(sections)) == 0)
        return { status: 0, revision: 0, active: false };

    let response = native_api_request("/providers/rules", "10");
    let snapshot = response.status == 0 ? parse_json(response.output) : null;
    if (snapshot == null || type(object_or_empty(snapshot).revision) != "int")
        return { status: 1, revision: 0, active: true };
    return {
        status: apply_runtime_snapshot(snapshot, sections) ? 0 : 1,
        revision: snapshot.revision,
        active: true
    };
}

function parent_dir(path) {
    let slash = rindex(as_string(path), "/");
    return slash <= 0 ? "/" : substr(as_string(path), 0, slash);
}

function worker() {
    let pid = owner_pid();
    command_success([ "mkdir", "-p", parent_dir(WORKER_PID_FILE) ]);
    fs.writefile(WORKER_PID_FILE, pid + "\n");

    let synced = null;
    while (true) {
        if (synced == null || synced.status != 0) {
            synced = sync_runtime_once();
            if (!synced.active)
                break;
            if (synced.status != 0) {
                command_success([ "sleep", WORKER_RETRY_SECONDS ]);
                continue;
            }
        }

        let event = native_api_request(
            "/providers/rules/events?once=1&since=" + as_string(synced.revision),
            "60"
        );
        if (event.status == 28)
            continue;
        let value = event.status == 0 ? parse_json(event.output) : null;
        if (value != null && type(object_or_empty(value).revision) == "int" && value.revision == synced.revision)
            continue;
        synced = sync_runtime_once();
        if (synced.status != 0)
            command_success([ "sleep", WORKER_RETRY_SECONDS ]);
    }

    if (trim(as_string(fs.readfile(WORKER_PID_FILE) || "")) == pid)
        fs.unlink(WORKER_PID_FILE);
}

function procd_service_payload() {
    let instances = {};
    instances.sync = {
        command: [ "ucode", "-L", LIB_DIR, SCRIPT_PATH, "worker" ],
        env: {
            FORKOP_LIB: LIB_DIR,
            FORKOP_CONFIG_NAME: CONFIG_NAME,
            FORKOP_SING_BOX_CONFIG: SING_BOX_CONFIG,
            FORKOP_RULESET_SYNC_PID_FILE: WORKER_PID_FILE,
            FORKOP_RULESET_SYNC_RETRY_SECONDS: WORKER_RETRY_SECONDS,
            FORKOP_RULESET_SYNC_UC: SCRIPT_PATH,
            NFT_TABLE_NAME: DEFAULT_TABLE
        },
        respawn: [ "3600", "5", "0" ],
        stderr: true
    };
    return { name: PROCD_SERVICE_NAME, instances };
}

function procd_add_worker() {
    return command_success([ UBUS_BIN, "call", "service", "add", sprintf("%J", procd_service_payload()) ]);
}

function procd_remove_worker() {
    if (command_success([ UBUS_BIN, "call", "service", "delete", sprintf("%J", { name: PROCD_SERVICE_NAME }) ]))
        return true;

    let result = command_capture([ UBUS_BIN, "call", "service", "list", sprintf("%J", { name: PROCD_SERVICE_NAME }) ]);
    let services = result.status == 0 ? parse_json(result.output) : null;
    return type(services) == "object" && services[PROCD_SERVICE_NAME] == null;
}

function wait_worker_ready(attempts) {
    attempts = int(attempts || 1);
    for (let i = 0; i < attempts; i++) {
        let pid = trim(as_string(fs.readfile(WORKER_PID_FILE) || ""));
        if (pid_is_worker(pid))
            return true;
        if (i + 1 < attempts)
            command_success([ "sleep", "1" ]);
    }
    return false;
}

function stop_worker() {
    if (!procd_remove_worker())
        return 1;
    let pid = trim(as_string(fs.readfile(WORKER_PID_FILE) || ""));
    if (pid_running(pid) && !pid_is_worker(pid)) {
        fs.unlink(WORKER_PID_FILE);
        return 0;
    }
    for (let i = 0; i < 3 && pid_running(pid); i++)
        command_success([ "sleep", "1" ]);
    if (pid_is_worker(pid)) {
        command_success([ "kill", pid ]);
        command_success([ "sleep", "1" ]);
        if (pid_is_worker(pid))
            command_success([ "kill", "-KILL", pid ]);
    }
    fs.unlink(WORKER_PID_FILE);
    return 0;
}

function start_worker() {
    if (stop_worker() != 0)
        return 1;
    if (length(native_source_sections(runtime_sections())) == 0)
        return 0;

    command_success([ "mkdir", "-p", parent_dir(WORKER_PID_FILE) ]);
    if (!procd_add_worker())
        return 1;
    if (!wait_worker_ready(5)) {
        stop_worker();
        return 1;
    }
    return 0;
}

function fixture_sections(data) {
    let sections = object_or_empty(data).sections;
    if (type(sections) != "array")
        sections = object_or_empty(data).section;
    if (type(sections) == "object")
        sections = [ sections ];
    return type(sections) == "array" ? sections : [];
}

function fixture_section(data, section_name) {
    let sections = fixture_sections(data);
    for (let section in sections)
        if (as_string(object_or_empty(section)[".name"]) == as_string(section_name))
            return section;
    return null;
}

function module_exports() {
    return {
        build_plan,
        build_batch,
        apply_plan,
        expected_nft_tags,
        section_needs_priority_sets,
        native_source_sections,
        native_api_config,
        apply_runtime_snapshot,
        worker_cmdline_matches,
        procd_service_payload
    };
}

if ((sourcepath(1) != null && sourcepath(1) != "") || ARGV[0] == null)
    return module_exports();

let mode = ARGV[0] || "";
if (mode == "render-fixture" || mode == "apply-fixture") {
    let snapshot = common.read_json_file(ARGV[1]);
    let fixture = common.read_json_file(ARGV[2]);
    let section = fixture_section(fixture, ARGV[3]);
    if (section == null) {
        warn("missing fixture section: ", as_string(ARGV[3]), "\n");
        exit(1);
    }

    let tags = object_or_empty(section).rule_set_tags != null ? fixture_tags(section) : expected_nft_tags(section);
    let plan = build_plan(snapshot, section, tags, ARGV[4] || DEFAULT_TABLE);
    if (plan.error != "") {
        warn(plan.error, "\n");
        exit(1);
    }
    if (plan.summary != "")
        warn(plan.summary, "\n");

    if (mode == "render-fixture")
        print(plan.script);
    else if (!apply_plan(plan)) {
        warn("failed to apply rule-set nft transaction\n");
        exit(1);
    }
}
else if (mode == "render-all-fixture" || mode == "apply-all-fixture") {
    let snapshot = common.read_json_file(ARGV[1]);
    let fixture = common.read_json_file(ARGV[2]);
    let batch = build_batch(snapshot, fixture_sections(fixture), ARGV[3] || DEFAULT_TABLE);
    if (batch.error != "") {
        warn(batch.error, "\n");
        exit(1);
    }
    if (batch.summary != "")
        warn(batch.summary, "\n");

    if (mode == "render-all-fixture")
        print(batch.script);
    else if (!apply_plan(batch)) {
        warn("failed to apply rule-set nft transaction\n");
        exit(1);
    }
}
else if (mode == "sync")
    exit(sync_runtime_once().status);
else if (mode == "start-worker")
    exit(start_worker());
else if (mode == "stop-worker")
    exit(stop_worker());
else if (mode == "worker")
    worker();
else if (mode == "worker-cmdline-fixture")
    exit(worker_cmdline_matches(fs.readfile(ARGV[1])) ? 0 : 1);
else if (mode == "procd-service-payload-fixture")
    print(sprintf("%J", procd_service_payload()), "\n");
else {
    warn("Usage: nft/ruleset_sync.uc <sync|start-worker|stop-worker|worker|worker-cmdline-fixture|procd-service-payload-fixture|render-fixture|apply-fixture|render-all-fixture|apply-all-fixture> ...\n");
    exit(1);
}
