#!/usr/bin/env ucode

let fs = require("fs");
let common = require("core.common");
let core_ip = require("core.ip");
let rule_config = require("config.rule");
let nft_sections = require("nft.sections");
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
// One process owns it and rewrites it per section, so asking mktemp for a path
// adds nothing.
const TRANSACTION_FILE = (getenv("TMPDIR") || "/tmp") +
    "/forkop-ruleset-sync." + clock()[0] + "." + clock()[1] + ".nft";

// What each section's sets were last filled from, so a provider event that
// changed nothing this section reads costs neither a rebuild nor a transaction,
// and the revisions those keys were made of, so a core that restarted and began
// counting again cannot be mistaken for one that changed nothing.
let applied_keys = {};
let applied_revisions = {};

// A rule set that is still downloading, or one whose download keeps failing, is
// a reason to wait rather than a new event every three seconds. The reason is
// reported when it appears and again when it changes.
let deferred_reason = null;

let as_string = common.as_string;
let object_or_empty = common.object_or_empty;

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

// The section's own ports, read through the owner every other reader of that
// option uses. It has already dropped what is not a port, so an unusable value
// leaves the rules and the sets agreeing instead of stopping the sync.
function section_port_ranges(ports_csv) {
    let ranges = [];

    for (let value in split(as_string(ports_csv), ",")) {
        let matched = match(trim(value), /^([0-9]+)(-([0-9]+))?$/);
        if (matched == null)
            continue;

        let start = int(matched[1]);
        let end = matched[3] == null ? start : int(matched[3]);
        push(ranges, { start: start, end: end });
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
                push(result, { start: start, end: end });
        }
    }
    return normalize_ranges(result);
}

function port_text(value) {
    return value.start == value.end ? as_string(value.start) : value.start + "-" + value.end;
}

// A provider prefix goes into an nft transaction unquoted, so it is checked for
// anything that is not part of an address before it gets there. The check also
// refuses surrounding whitespace, which is why the value is stored as it came
// rather than trimmed: on a country-sized list, one copy of every prefix is
// megabytes of nothing.
function provider_prefix_is_nft_safe(prefix, family) {
    return family == 4
        ? index(prefix, ".") >= 0 && match(prefix, /[^0-9.\/]/) == null
        : family == 6 && index(prefix, ":") >= 0 && match(prefix, /[^0-9A-Fa-f:.\/]/) == null;
}

// Where an address ends up is decided by what constrains it. Nothing at all
// makes it a plain address; ports alone make it a pair, which a rule per
// transport reads; a transport makes it a triple, whose set says which transport
// it belongs to. `protocols` empty means the addresses are not limited to one.
function push_prefix(plan, prefix, family, ranges, protocols) {
    if (length(protocols) > 0) {
        let scoped = family == 4 ? plan.proto_ipv4 : plan.proto_ipv6;
        let texts = length(ranges) > 0 ? map(ranges, port_text) : [ "1-65535" ];
        for (let protocol in protocols)
            for (let port in texts)
                push(scoped, prefix + " . " + protocol + " . " + port);
        return;
    }

    if (length(ranges) == 0) {
        push(family == 4 ? plan.ipv4 : plan.ipv6, prefix);
        return;
    }

    let scoped = family == 4 ? plan.scoped_ipv4 : plan.scoped_ipv6;
    for (let range in ranges)
        push(scoped, prefix + " . " + port_text(range));
}

function add_provider_prefix(plan, prefix, family, ranges, protocols) {
    if (!provider_prefix_is_nft_safe(as_string(prefix), family))
        return fail(plan, "invalid IP prefix: " + as_string(prefix));

    push_prefix(plan, prefix, family, ranges, protocols);
    return true;
}

function add_provider_prefix_array(plan, values, family, ranges, label) {
    if (type(values) != "array")
        return fail(plan, label + " must be an array");

    for (let prefix in values)
        if (!add_provider_prefix(plan, prefix, family, ranges, []))
            return false;
    return true;
}

// The section's own addresses, which are user input rather than something the
// core produced: one that nft cannot match is dropped, exactly as the rules
// built from the same option drop it, instead of stopping every section's sync.
function add_inline_prefixes(plan, csv, ranges) {
    for (let value in split(as_string(csv), ",")) {
        if (value == "")
            continue;

        let family = core_ip.nft_ip_family(value);
        if (family == 0)
            continue;
        push_prefix(plan, value, family, ranges, []);
    }
}

// The transports a provider group is limited to. Only the two nft can be told to
// match are accepted: the core exports nothing else, so anything else is a
// snapshot this reader does not understand rather than a value to guess at.
function snapshot_protocols(plan, values, label) {
    if (values == null)
        return [];
    if (type(values) != "array") {
        fail(plan, label + ": networks must be an array");
        return null;
    }

    let result = [];
    for (let value in values) {
        if (value != "tcp" && value != "udp") {
            fail(plan, label + ": unsupported network " + as_string(value));
            return null;
        }
        if (!(value in result))
            push(result, value);
    }
    return result;
}

// A group is constrained by transports, by ports, or by both. Neither would make
// it a plain address, which the core exports as one, so a group carrying no
// constraint at all is a snapshot that contradicts itself.
function add_scoped_groups(plan, groups, family, section_ranges, label) {
    if (type(groups) != "array")
        return fail(plan, label + " must be an array");

    for (let i = 0; i < length(groups); i++) {
        let group = groups[i];
        if (type(group) != "object" || type(group.prefixes) != "array" || length(group.prefixes) == 0)
            return fail(plan, label + "[" + i + "]: invalid prefixes");

        let protocols = snapshot_protocols(plan, group.networks, label + "[" + i + "]");
        if (protocols == null)
            return false;

        let ranges = snapshot_port_ranges(plan, group.port_ranges, label + "[" + i + "]");
        if (ranges == null)
            return false;
        if (length(ranges) == 0 && length(protocols) == 0)
            return fail(plan, label + "[" + i + "]: unconstrained group");

        // The section's own ports narrow the group: one limited to a transport
        // and no particular port is limited to the section's ports on it, and one
        // the section's ports do not overlap selects nothing.
        if (length(section_ranges) > 0) {
            ranges = length(ranges) > 0 ? intersect_ranges(ranges, section_ranges) : section_ranges;
            if (length(ranges) == 0)
                continue;
        }

        for (let prefix in group.prefixes)
            if (!add_provider_prefix(plan, prefix, family, ranges, protocols))
                return false;
    }
    return true;
}

function add_provider(plan, provider, tag, section_ranges) {
    let label = "provider " + as_string(tag);
    if (type(provider) != "object" || type(provider.revision) != "int" || provider.revision < 1)
        return fail(plan, label + ": provider is not loaded");

    let ip_cidr = provider.ip_cidr;
    if (type(ip_cidr) != "object")
        return fail(plan, label + ": missing ip_cidr snapshot");

    // The snapshot also lists the rules the core could not express as addresses.
    // Nothing here reads them: what the sets ended up holding is the one number
    // worth a line, and a second one saying part of a third-party list is not
    // expressible fires on every sync and cannot be acted on.
    return add_provider_prefix_array(plan, ip_cidr.ipv4, 4, section_ranges, label + ".ip_cidr.ipv4") &&
        add_provider_prefix_array(plan, ip_cidr.ipv6, 6, section_ranges, label + ".ip_cidr.ipv6") &&
        add_scoped_groups(plan, ip_cidr.scoped_ipv4, 4, section_ranges, label + ".ip_cidr.scoped_ipv4") &&
        add_scoped_groups(plan, ip_cidr.scoped_ipv6, 6, section_ranges, label + ".ip_cidr.scoped_ipv6");
}

// One set replaced in place: nft applies a file as a single transaction, so the
// flush and the elements that follow it are never observed apart.
//
// The elements are sorted to drop the duplicates two providers of the same
// section produce, and written in bounded groups because nft parses one command
// at a time and a single command holding a country's worth of addresses is a
// line no editor and no log can show.
//
// The sort also groups a scoped set by address, because the " . " that separates
// the port begins with a space and no address holds one. That is what makes
// counting the addresses a set ends up holding a walk rather than a second pass.
function write_set_transaction(handle, table, set_name, elements) {
    handle.write("flush set inet " + table + " " + set_name + "\n");
    sort(elements);

    let prefix = "add element inet " + table + " " + set_name + " { ";
    let chunk = [];
    let chunk_length = length(prefix) + 2;
    let last = null;
    let last_address = null;
    let addresses = 0;

    for (let element in elements) {
        if (element == last)
            continue;
        last = element;

        let separator = index(element, " . ");
        let address = separator < 0 ? element : substr(element, 0, separator);
        if (address != last_address) {
            last_address = address;
            addresses++;
        }

        let added_length = length(element) + (length(chunk) > 0 ? 2 : 0);
        if (length(chunk) > 0 &&
            (length(chunk) >= MAX_ELEMENTS_PER_LINE || chunk_length + added_length > MAX_LINE_LENGTH)) {
            handle.write(prefix + join(", ", chunk) + " }\n");
            chunk = [];
            chunk_length = length(prefix) + 2;
        }
        push(chunk, element);
        chunk_length += added_length;
    }

    if (length(chunk) > 0)
        handle.write(prefix + join(", ", chunk) + " }\n");

    return addresses;
}

// Written out set by set and released set by set. Collecting the whole script
// first meant holding a second copy of every address as text while nft held the
// first, on a router where nft alone needs about a kilobyte per set element.
//
// Only the sets nft/sections.uc says the section owns are touched. Flushing one
// the rules never referenced aborts the transaction, which is how a section
// carrying nothing but a list of addresses could stop every other section's
// subnets from being loaded.
function render_plan(handle, plan, table, sets) {
    let written = [];

    if (plan.needs_subnet_sets) {
        push(written, [ sets.subnets, plan.ipv4 ]);
        push(written, [ sets.subnets6, plan.ipv6 ]);
    }
    if (plan.needs_ip_port_sets) {
        push(written, [ sets.ip_ports, plan.scoped_ipv4 ]);
        push(written, [ sets.ip6_ports, plan.scoped_ipv6 ]);
    }
    if (plan.needs_proto_port_sets) {
        push(written, [ sets.proto_ports, plan.proto_ipv4 ]);
        push(written, [ sets.proto6_ports, plan.proto_ipv6 ]);
    }

    plan.ipv4 = null;
    plan.ipv6 = null;
    plan.scoped_ipv4 = null;
    plan.scoped_ipv6 = null;
    plan.proto_ipv4 = null;
    plan.proto_ipv6 = null;
    plan.addresses = 0;

    for (let entry in written) {
        plan.addresses += write_set_transaction(handle, table, entry[0], entry[1]);
        entry[1] = null;
    }
}

function build_plan(snapshot, section, matchers, tags, table) {
    section = object_or_empty(section);
    table = as_string(table || DEFAULT_TABLE);
    let section_name = as_string(section[".name"]);
    let plan = {
        error: "",
        section: section_name,
        table: table,
        sets: matchers.sets,
        needs_subnet_sets: matchers.needs_subnet_sets,
        needs_ip_port_sets: matchers.needs_ip_port_sets,
        needs_proto_port_sets: matchers.needs_proto_port_sets,
        addresses: 0,
        ipv4: [],
        ipv6: [],
        scoped_ipv4: [],
        scoped_ipv6: [],
        proto_ipv4: [],
        proto_ipv6: []
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

    let ports = section_port_ranges(matchers.ports);
    add_inline_prefixes(plan, matchers.subnets, ports);

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

    return plan;
}

function provider_revision(snapshot, tag) {
    return int(object_or_empty(object_or_empty(object_or_empty(snapshot).providers)[as_string(tag)]).revision || 0);
}

// A provider revision only grows while the core runs, so one that went backwards
// means the core restarted and started counting again. Nothing may be skipped on
// the strength of a key made before that.
function providers_restarted(snapshot) {
    for (let tag in keys(object_or_empty(object_or_empty(snapshot).providers)))
        if (applied_revisions[tag] != null && provider_revision(snapshot, tag) < applied_revisions[tag])
            return true;

    return false;
}

function remember_provider_revisions(snapshot) {
    let result = {};

    for (let tag in keys(object_or_empty(object_or_empty(snapshot).providers)))
        result[tag] = provider_revision(snapshot, tag);

    applied_revisions = result;
}

// What the rendered transaction is a function of: the section's own conditions
// and the revision of every provider it reads. Unchanged means the sets already
// hold what this sync would write, which is worth knowing before building them,
// because a provider event names no provider and every section is rebuilt.
function plan_key(snapshot, section, matchers, tags) {
    let parts = [ as_string(object_or_empty(section)[".name"]), matchers.subnets, matchers.ports ];

    for (let tag in tags)
        push(parts, as_string(tag) + ":" + provider_revision(snapshot, tag));

    return join("\t", parts);
}

// nft names the offending command and then repeats it, which for a set element
// line is thousands of addresses. The first line is the reason.
function first_line(value) {
    for (let line in split(as_string(value), "\n")) {
        line = trim(line);
        if (line != "")
            return length(line) > 200 ? substr(line, 0, 200) : line;
    }
    return "no output";
}

// nft holds every element of every set a transaction touches before it commits,
// so on a router the size of an OpenWrt device a large enough rule set is killed
// rather than refused. Saying which happened is the difference between a
// configuration error and a list this hardware cannot hold.
function nft_failure_reason(result) {
    let signal = common.signal_from_status(result.status);
    if (signal == 9)
        return "nft ran out of memory; the addresses of this section do not fit in this router's memory";
    if (signal != 0)
        return "nft was killed by signal " + signal;

    return first_line(result.output);
}

// nft names what it refused on stderr, which is merged in here: it is the only
// thing that explains a failed transaction, and left on its own it reaches
// whatever the worker's stderr happened to be.
function nft_apply_file(path) {
    let pipe = fs.popen("nft -f " + shell_quote(path) + " 2>&1", "r");
    if (!pipe)
        return { status: 1, output: "cannot run nft" };

    let output = pipe.read("all");
    let status = pipe.close();
    return { status: status, output: output == null ? "" : as_string(output) };
}

// The transaction goes to a file rather than into nft's stdin so that everything
// this process is holding is released before nft starts allocating.
function apply_plan(plan) {
    let handle = fs.open(TRANSACTION_FILE, "w");
    if (!handle)
        return fail(plan, "cannot write the nft transaction");

    render_plan(handle, plan, plan.table, plan.sets);
    handle.close();

    let result = nft_apply_file(TRANSACTION_FILE);
    fs.unlink(TRANSACTION_FILE);
    if (result.status == 0)
        return true;

    return fail(plan, "section " + plan.section + ": " + nft_failure_reason(result));
}

// The sections whose subnets a provider feeds, which is what the worker exists
// for: with none of them there is nothing to react to.
function native_source_sections(sections) {
    let result = [];

    for (let entry in nft_sections.with_priority_sets(sections).sections)
        if (length(entry.matchers.subnet_tags) > 0)
            push(result, entry);

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

function native_api_args(api, path, maximum_time) {
    let args = [
        "curl", "-fsS", "--connect-timeout", "2", "--max-time", as_string(maximum_time)
    ];
    if (api.secret != "") {
        push(args, "--header");
        push(args, "Authorization: Bearer " + api.secret);
    }
    push(args, api.url + as_string(path));
    return args;
}

function native_api_request(path, maximum_time) {
    let api = native_api_config();
    if (api == null)
        return { status: 1, output: "" };

    return command_capture(native_api_args(api, path, maximum_time));
}

// Parsed straight out of curl's pipe. Read into a string first, the snapshot
// exists twice - once as the body and once as the values parsed out of it - and
// on a country-sized list that second copy is megabytes the router does not have.
function native_api_json(path, maximum_time) {
    let api = native_api_config();
    if (api == null)
        return null;

    let pipe = fs.popen(command_from_args(native_api_args(api, path, maximum_time)) + " 2>/dev/null", "r");
    if (!pipe)
        return null;

    let value = null;
    try {
        value = json(pipe);
    }
    catch (e) {
    }

    return pipe.close() == 0 ? value : null;
}

function parse_json(value) {
    try {
        return json(value);
    }
    catch (e) {
        return null;
    }
}

// One section at a time, all the way through: build it, hand it to nft, drop it.
// nft holds every element of every set a transaction touches, so one transaction
// for the whole configuration costs the sum of the sections where this costs the
// largest one, and the sections have nothing to keep consistent with each other -
// each set is matched by the rules of its own section and by nothing else.
function defer_sync(reason) {
    reason = as_string(reason);
    if (deferred_reason != reason) {
        deferred_reason = reason;
        log_message("Native rule-set nft sync deferred: " + reason, "warn");
    }
    return false;
}

function apply_runtime_snapshot(snapshot, sections) {
    let planned = nft_sections.with_priority_sets(sections);
    if (planned.error != "")
        return defer_sync(planned.error);

    if (providers_restarted(snapshot))
        applied_keys = {};
    remember_provider_revisions(snapshot);

    let addresses = 0;
    let applied = 0;
    let keys_now = {};

    for (let entry in planned.sections) {
        let tags = entry.matchers.subnet_tags;
        let key = plan_key(snapshot, entry.section, entry.matchers, tags);
        let name = as_string(entry.section[".name"]);

        if (applied_keys[name] == key) {
            keys_now[name] = key;
            continue;
        }

        let plan = build_plan(snapshot, entry.section, entry.matchers, tags, DEFAULT_TABLE);
        if (plan.error == "")
            apply_plan(plan);
        if (plan.error != "") {
            applied_keys = keys_now;
            return defer_sync(plan.error);
        }

        addresses += plan.addresses;
        applied++;
        keys_now[name] = key;
    }

    applied_keys = keys_now;
    deferred_reason = null;
    if (applied == 0)
        return true;

    let scope = applied == length(planned.sections)
        ? ""
        : " for " + applied + " of " + length(planned.sections) + " sections";
    log_message("Loaded " + addresses + " subnets into nft" + scope, "info");
    return true;
}

function sync_runtime_once() {
    let sections = runtime_sections();
    if (length(native_source_sections(sections)) == 0)
        return { status: 0, revision: 0, active: false };

    let snapshot = native_api_json("/providers/rules", "10");
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

// A fixture may pin the provider tags of a section directly, so a snapshot can
// be written without a rule set URL that hashes to the name it needs.
function fixture_tags(section) {
    let raw = object_or_empty(section).rule_set_tags;
    if (type(raw) == "array")
        return raw;
    return rule_config.text_list_values(raw, "comma-space");
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
        plan_key,
        apply_plan,
        render_plan,
        native_source_sections,
        native_api_config,
        apply_runtime_snapshot,
        worker_cmdline_matches,
        procd_service_payload
    };
}

if ((sourcepath(1) != null && sourcepath(1) != "") || ARGV[0] == null)
    return module_exports();

// A fixture section is classified the same way a configured one is, except that
// it may name the provider tags itself, so a snapshot can be pinned without a
// rule set URL that hashes to the right name.
function fixture_plan(snapshot, section, table) {
    let tags = object_or_empty(section).rule_set_tags != null ? fixture_tags(section) : null;
    let matchers = nft_sections.matchers(section, tags);

    return build_plan(snapshot, section, matchers, matchers.subnet_tags, table);
}

function abort_on_plan_error(plan) {
    if (plan.error != "") {
        warn(plan.error, "\n");
        exit(1);
    }
}

// One fixture section rendered or applied, and then reported the way the worker
// reports it. The count is what the sets ended up holding, so it is read after
// the transaction was written rather than guessed while it was built.
function run_fixture_plan(snapshot, section, table, apply) {
    let plan = fixture_plan(snapshot, section, table);
    abort_on_plan_error(plan);

    if (apply)
        apply_plan(plan);
    else
        render_plan(fs.stdout, plan, plan.table, plan.sets);
    abort_on_plan_error(plan);

    warn("Loaded ", plan.addresses, " subnets into nft\n");
    return plan;
}

let mode = ARGV[0] || "";
if (mode == "render-fixture" || mode == "apply-fixture") {
    let snapshot = common.read_json_file(ARGV[1]);
    let fixture = common.read_json_file(ARGV[2]);
    let section = fixture_section(fixture, ARGV[3]);
    if (section == null) {
        warn("missing fixture section: ", as_string(ARGV[3]), "\n");
        exit(1);
    }

    run_fixture_plan(snapshot, section, ARGV[4] || DEFAULT_TABLE, mode == "apply-fixture");
}
else if (mode == "render-all-fixture" || mode == "apply-all-fixture") {
    let snapshot = common.read_json_file(ARGV[1]);
    let fixture = common.read_json_file(ARGV[2]);
    let table = ARGV[3] || DEFAULT_TABLE;
    let planned = nft_sections.with_priority_sets(fixture_sections(fixture));
    if (planned.error != "") {
        warn(planned.error, "\n");
        exit(1);
    }

    for (let entry in planned.sections)
        run_fixture_plan(snapshot, entry.section, table, mode == "apply-all-fixture");
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
