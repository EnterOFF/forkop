#!/usr/bin/env ucode

let fs = require("fs");
let common = require("core.common");
let constants = require("core.constants");
let core_ip = require("core.ip");
let uci_core = require("core.uci");
let rule_config = require("config.rule");
let connections = require("config.connections");
let runtime_constants = require("singbox.constants");
let nft_state = require("nft.state");
let nft_sections = require("nft.sections");
let zapret_provider = require("providers.zapret.common");
let zapret2_provider = require("providers.zapret2.common");
const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || "forkop";
const IP_BIN = getenv("FORKOP_IP_BIN") || "/usr/libexec/ip-full";
// service/package.uc removes the routing table entry this module writes and reads
// the same override to find the file.
const RT_TABLES_PATH = getenv("FORKOP_RT_TABLES") || "/etc/iproute2/rt_tables";
// Unique to this process, so asking mktemp for a path adds nothing.
const TEMP_FILE_PREFIX = (getenv("TMPDIR") || "/tmp") +
    "/forkop-nft." + clock()[0] + "." + clock()[1];
const SIGNATURE_TEMP_FILE = TEMP_FILE_PREFIX + ".signature";
const NFT_ERROR_TEMP_FILE = TEMP_FILE_PREFIX + ".error";

// The runtime table, its sets, the marks and the FakeIP ranges are named once in
// core/constants.uc, which is also where it applies their environment overrides.
// The rebuild entry point reads them here instead of taking them from a caller
// that could only have read the same table.
const RT_TABLE_NAME = constants.RT_TABLE_NAME;
const NFT_TABLE_NAME = constants.NFT_TABLE_NAME;
const NFT_LOCALV4_SET_NAME = constants.NFT_LOCALV4_SET_NAME;
const NFT_LOCALV6_SET_NAME = constants.NFT_LOCALV6_SET_NAME;
const NFT_COMMON_SET_NAME = constants.NFT_COMMON_SET_NAME;
const NFT_COMMON6_SET_NAME = constants.NFT_COMMON6_SET_NAME;
const NFT_PORT_SET_NAME = constants.NFT_PORT_SET_NAME;
const NFT_IP_PORT_SET_NAME = constants.NFT_IP_PORT_SET_NAME;
const NFT_IP_PORT6_SET_NAME = constants.NFT_IP_PORT6_SET_NAME;
const NFT_INTERFACE_SET_NAME = constants.NFT_INTERFACE_SET_NAME;
const NFT_FAKEIP_MARK = constants.NFT_FAKEIP_MARK;
const NFT_OUTBOUND_MARK = constants.NFT_OUTBOUND_MARK;
const SB_FAKEIP_INET4_RANGE = constants.SB_FAKEIP_INET4_RANGE;
const SB_FAKEIP_INET6_RANGE = constants.SB_FAKEIP_INET6_RANGE;
const SB_TPROXY_INBOUND_PORT = constants.SB_TPROXY_INBOUND_PORT;
const SB_TPROXY_INBOUND6_ADDRESS = constants.SB_TPROXY_INBOUND6_ADDRESS;

let as_string = common.as_string;
let object_or_empty = common.object_or_empty;
let common_read_json_file = common.read_json_file;
let bool_option = common.bool_option;
let parse_number = common.parse_number;
let rt_table_has_entry = nft_state.rt_table_has_entry;
let tproxy_route4_present = nft_state.tproxy_route4_present;
let tproxy_route6_present = nft_state.tproxy_route6_present;
let tproxy_marking_rule4_present = nft_state.tproxy_marking_rule4_present;
let tproxy_marking_rule6_present = nft_state.tproxy_marking_rule6_present;

function arg_bool(value) {
    value = lc(as_string(value));
    return value == "1" || value == "true" || value == "yes";
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

function uci_section(section_name) {
    return object_or_empty(uci_core.get_all(CONFIG_NAME, section_name));
}

function uci_sections(type_name) {
    return uci_core.section_objects(CONFIG_NAME, type_name);
}

function uci_settings() {
    return uci_section("settings");
}

function write_text_file(path, text) {
    let result = fs.writefile(path, as_string(text));
    if (result == null)
        return false;
    if (type(result) == "boolean" && !result)
        return false;
    return true;
}

function file_executable(path) {
    let stat = fs.stat(as_string(path));
    if (stat == null || stat.mode == null)
        return false;

    return (int(stat.mode) & 73) != 0;
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

function run_args(args) {
    return system(command_from_args(args)) == 0;
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

// Set while the ruleset is generated only to be hashed: the same builders run,
// but nothing is applied and nothing is reported as if it had been.
let nft_dry_run = false;

function log_debug(message) {
    if (nft_dry_run)
        return;
    run_args([ "logger", "-t", "forkop", "[debug] " + as_string(message) ]);
}

function log_fatal(message) {
    run_args([ "logger", "-t", "forkop", "[fatal] " + as_string(message) ]);
}

// nftables applies a whole file as one transaction, which is how the rule-set
// sync worker already talks to it. Collecting the commands of an operation and
// handing them over at once replaces about a hundred processes with one and, more
// importantly, removes the window in which the old table has been deleted and
// the rules meant to replace it are still being added one at a time.
//
// Outside a batch each command runs on its own, which is what the individual
// builder entry points below and the tests that drive them expect.
let nft_batch = null;

function nft_batch_open() {
    nft_batch = [];
}

function nft_batch_take() {
    let lines = nft_batch;
    nft_batch = null;
    return lines == null ? [] : lines;
}

function nft_command(args) {
    let parts = [];
    for (let arg in args)
        push(parts, as_string(arg));

    if (nft_batch == null)
        return run_args([ "nft", ...parts ]);

    // A newline would end the command early and hand nft the rest as another
    // one, so a value carrying one is refused rather than written out.
    for (let part in parts)
        if (index(part, "
") >= 0)
            return false;

    push(nft_batch, join(" ", parts));
    return true;
}

// nft names the offending command and then repeats the command itself, which for
// a set element line is thousands of addresses. The first line is the reason -
// unless nft never got to print one, because nft holds every element of every set
// a transaction touches before it commits and a large enough rule set is killed
// rather than refused.
function nft_error_reason(path, status) {
    let signal = common.signal_from_status(status);
    if (signal == 9)
        return "nft ran out of memory; the rules and addresses of this configuration do not fit in this router's memory";
    if (signal != 0)
        return "nft was killed by signal " + signal;

    let data = fs.readfile(path);
    if (data != null) {
        for (let line in split(as_string(data), "
")) {
            line = trim(line);
            if (line != "")
                return length(line) > 200 ? substr(line, 0, 200) : line;
        }
    }

    return "no output";
}

// What nft refused is the only thing that explains a failed rebuild, and it used
// to go to whatever the caller's stderr happened to be. It is read back from a
// file instead, so the reason is logged next to the failure.
function nft_apply_script(lines) {
    let error_path = NFT_ERROR_TEMP_FILE;
    let pipe = fs.popen("nft -f - 2>" + shell_quote(error_path), "w");
    if (!pipe) {
        log_fatal("Failed to run nft");
        return false;
    }

    let written = true;
    for (let line in lines) {
        if (pipe.write(line + "
") == null) {
            written = false;
            break;
        }
    }

    let status = pipe.close();
    if (written && status == 0) {
        unlink_file(error_path);
        return true;
    }

    log_fatal("nft refused the ruleset: " + nft_error_reason(error_path, status));
    unlink_file(error_path);
    return false;
}

function nft_batch_apply() {
    let lines = nft_batch_take();
    return length(lines) == 0 || nft_apply_script(lines);
}

function nft_create_table(name) {
    return nft_command([ "add", "table", "inet", name ]);
}

function nft_create_set(table, name, definition) {
    return nft_command([ "add", "set", "inet", table, name, definition ]);
}

function nft_create_ipv4_set(table, name) {
    return nft_create_set(table, name, "{ type ipv4_addr; flags interval; auto-merge; }");
}

function nft_create_ipv6_set(table, name) {
    return nft_create_set(table, name, "{ type ipv6_addr; flags interval; auto-merge; }");
}

function nft_create_inet_service_set(table, name) {
    return nft_create_set(table, name, "{ type inet_service; flags interval; auto-merge; }");
}

function nft_create_ipv4_port_set(table, name) {
    return nft_create_set(table, name, "{ type ipv4_addr . inet_service; flags interval; auto-merge; }");
}

function nft_create_ipv6_port_set(table, name) {
    return nft_create_set(table, name, "{ type ipv6_addr . inet_service; flags interval; auto-merge; }");
}

function nft_create_ifname_set(table, name) {
    return nft_create_set(table, name, "{ type ifname; flags interval; }");
}

function nft_add_set_elements(table, set_name, elements) {
    return nft_command([ "add", "element", "inet", table, set_name, "{ " + as_string(elements) + " }" ]);
}

function whitespace_values(value) {
    let result = [];

    for (let item in split(replace(as_string(value), /[[:space:]]+/g, " "), " ")) {
        item = trim(item);
        if (item != "")
            push(result, item);
    }

    return result;
}

function nft_create_chain(table, name, definition) {
    return nft_command([ "add", "chain", "inet", table, name, definition ]);
}

function nft_add_rule(table, chain, args) {
    let command = [ "add", "rule", "inet", table, chain ];
    for (let arg in args)
        push(command, arg);
    return nft_command(command);
}

function nft_insert_rule(table, chain, args) {
    let command = [ "insert", "rule", "inet", table, chain ];
    for (let arg in args)
        push(command, arg);
    return nft_command(command);
}

let LOCALV4_RANGES = [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "192.88.99.0/24",
    "192.168.0.0/16",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/4",
    "240.0.0.0-255.255.255.255"
];

let LOCALV6_RANGES = [
    "::/128",
    "::1/128",
    "64:ff9b::/96",
    "100::/64",
    "2001:db8::/32",
    "fc00::/7",
    "fe80::/10",
    "ff00::/8"
];

function default_arg(value, fallback) {
    value = as_string(value);
    return value == "" ? fallback : value;
}

// Which of a section's own sets exist is the contract nft/ruleset_sync.uc
// refills them through, so the rules below and their sets are built from the one
// classification in nft/sections.uc rather than from predicates restated here.
function nft_create_priority_sets(table, matchers) {
    let sets = matchers.sets;

    if (matchers.needs_subnet_sets &&
        (!nft_create_ipv4_set(table, sets.subnets) || !nft_create_ipv6_set(table, sets.subnets6)))
        return false;
    if (matchers.needs_ip_port_sets &&
        (!nft_create_ipv4_port_set(table, sets.ip_ports) || !nft_create_ipv6_port_set(table, sets.ip6_ports)))
        return false;
    if (matchers.needs_port_set && !nft_create_inet_service_set(table, sets.ports))
        return false;
    if (matchers.needs_source_sets &&
        (!nft_create_ipv4_set(table, sets.sources) || !nft_create_ipv6_set(table, sets.sources6)))
        return false;
    if (matchers.needs_fully_source_sets &&
        (!nft_create_ipv4_set(table, sets.fully_sources) || !nft_create_ipv6_set(table, sets.fully_sources6)))
        return false;

    return true;
}

function nft_create_priority_chains(table) {
    return nft_create_chain(table, "priority_rules", "{ }") &&
        nft_create_chain(table, "priority_output_rules", "{ }") &&
        nft_add_rule(table, "priority_output_rules", [ "meta", "mark", "!=", "0", "return" ]);
}

function nft_priority_verdict_args(priority_action, mark) {
    if (priority_action == "bypass")
        return [ "counter", "accept" ];
    return [ "meta", "mark", "set", mark, "counter", "accept" ];
}

function append_array(target, additions) {
    for (let item in additions)
        push(target, item);
    return target;
}

// The context every rule of a section shares: which local set and FakeIP range
// belong to the address family being built, and the verdict its action asks for.
function nft_priority_rule_args(matchers, family, local_set, fakeip_range, match_args, mark, match_source) {
    let ip_key = family == 6 ? "ip6" : "ip";
    let args = [];

    if (match_source && matchers.needs_source_sets)
        append_array(args, [ ip_key, "saddr",
            "@" + as_string(family == 6 ? matchers.sets.sources6 : matchers.sets.sources) ]);

    append_array(args, [ ip_key, "daddr", "!=", "@" + as_string(local_set) ]);
    // A bypass verdict must not claim FakeIP traffic: the address only means
    // anything to the resolver that handed it out.
    if (matchers.action == "bypass")
        append_array(args, [ ip_key, "daddr", "!=", fakeip_range ]);
    append_array(args, match_args);
    append_array(args, nft_priority_verdict_args(matchers.action, mark));
    return args;
}

function nft_priority_prerouting_args(matchers, family, interface_set, local_set, fakeip_range, match_args, mark) {
    let args = [ "iifname", "@" + as_string(interface_set) ];
    append_array(args, nft_priority_rule_args(matchers, family, local_set, fakeip_range, match_args, mark, true));
    return args;
}

// Both chains get the same matcher, seen from the two directions traffic can
// reach it: prerouting for the configured source interfaces, output for the
// router's own traffic. A section scoped to specific client addresses has
// nothing to say about the second, and one scoped to @system nothing about the
// first.
function nft_add_priority_rule_pair(table, chain, context, matchers, match4, match6) {
    let sources = matchers.sources;

    if (chain == "priority_rules") {
        if (sources.selected && length(sources.ips) == 0)
            return true;
        return nft_add_rule(table, chain, nft_priority_prerouting_args(matchers, 4, context.interface_set, context.localv4_set, context.fakeip_range, match4, context.mark)) &&
            nft_add_rule(table, chain, nft_priority_prerouting_args(matchers, 6, context.interface_set, context.localv6_set, context.fakeip6_range, match6, context.mark));
    }

    if (sources.selected && !sources.system)
        return true;
    return nft_add_rule(table, chain, nft_priority_rule_args(matchers, 4, context.localv4_set, context.fakeip_range, match4, context.mark, false)) &&
        nft_add_rule(table, chain, nft_priority_rule_args(matchers, 6, context.localv6_set, context.fakeip6_range, match6, context.mark, false));
}

// Fully routed traffic carries no destination matcher at all, so a capture
// action has to name the protocols it can transparently proxy; bypass accepts
// whatever the address matches.
function nft_fully_routed_protocols(matchers) {
    return matchers.action == "bypass" ? [ "" ] : [ "tcp", "udp" ];
}

function nft_l4proto_args(protocol) {
    return as_string(protocol) == "" ? [] : [ "meta", "l4proto", protocol ];
}

// The same rule as any other of this section, with the protocol standing in for
// the destination matcher it does not have.
function nft_fully_routed_output_args(matchers, family, context, protocol) {
    return nft_priority_rule_args(matchers, family,
        family == 6 ? context.localv6_set : context.localv4_set,
        family == 6 ? context.fakeip6_range : context.fakeip_range,
        nft_l4proto_args(protocol), context.mark, false);
}

// Forwarded traffic is scoped by the addresses the section fully routes rather
// than by the ones it filters, so the source set is named here instead of by the
// shared builder.
function nft_fully_routed_prerouting_args(matchers, family, context, protocol) {
    let ip_key = family == 6 ? "ip6" : "ip";
    let args = [
        "iifname", "@" + as_string(context.interface_set),
        ip_key, "saddr",
        "@" + as_string(family == 6 ? matchers.sets.fully_sources6 : matchers.sets.fully_sources)
    ];

    append_array(args, nft_fully_routed_output_args(matchers, family, context, protocol));
    return args;
}

function nft_add_fully_routed_priority_rules(table, context, matchers) {
    if (!matchers.fully.selected)
        return true;

    let protocols = nft_fully_routed_protocols(matchers);

    if (matchers.needs_fully_source_sets) {
        for (let family in [ 4, 6 ])
            for (let protocol in protocols)
                if (!nft_add_rule(table, "priority_rules", nft_fully_routed_prerouting_args(matchers, family, context, protocol)))
                    return false;
    }

    if (!matchers.fully.system)
        return true;

    for (let family in [ 4, 6 ])
        for (let protocol in protocols)
            if (!nft_add_rule(table, "priority_output_rules", nft_fully_routed_output_args(matchers, family, context, protocol)))
                return false;

    return true;
}

function nft_add_section_priority_rules(table, context, matchers) {
    if (!matchers.needed)
        return true;

    let sets = matchers.sets;
    if (!nft_create_priority_sets(table, matchers))
        return false;

    if (!nft_add_fully_routed_priority_rules(table, context, matchers))
        return false;

    // Every rule below differs only in the chain it lands in and the matchers
    // it carries; the rest of the context is the same for all of them.
    let add_rules = function(match4, match6) {
        for (let chain in [ "priority_rules", "priority_output_rules" ])
            if (!nft_add_priority_rule_pair(table, chain, context, matchers, match4, match6))
                return false;
        return true;
    };

    if (matchers.needs_subnet_sets &&
        !add_rules([ "ip", "daddr", "@" + as_string(sets.subnets) ], [ "ip6", "daddr", "@" + as_string(sets.subnets6) ]))
        return false;

    if (matchers.needs_ip_port_sets) {
        for (let protocol in [ "tcp", "udp" ])
            if (!add_rules(
                [ "ip", "daddr", ".", protocol, "dport", "@" + as_string(sets.ip_ports) ],
                [ "ip6", "daddr", ".", protocol, "dport", "@" + as_string(sets.ip6_ports) ]))
                return false;
    }

    // A port-only matcher is address family agnostic, so both sides of the pair
    // reference the same port set.
    if (matchers.needs_port_set) {
        for (let protocol in [ "tcp", "udp" ]) {
            let ports = [ protocol, "dport", "@" + as_string(sets.ports) ];
            if (!add_rules(ports, ports))
                return false;
        }
    }

    return true;
}

function nft_priority_context(interface_set, localv4_set, localv6_set, mark, fakeip_range, fakeip6_range) {
    return {
        interface_set: interface_set,
        localv4_set: localv4_set,
        localv6_set: default_arg(localv6_set, "localv6"),
        mark: mark,
        fakeip_range: default_arg(fakeip_range, "198.18.0.0/15"),
        fakeip6_range: default_arg(fakeip6_range, "fc00::/18")
    };
}

function nft_add_section_priority_rules_from_sections(sections, table, interface_set, localv4_set, localv6_set, mark, fakeip_range, fakeip6_range) {
    let context = nft_priority_context(interface_set, localv4_set, localv6_set, mark, fakeip_range, fakeip6_range);
    let planned = nft_sections.with_priority_sets(sections);

    if (planned.error != "") {
        log_fatal(planned.error);
        return false;
    }

    for (let entry in planned.sections)
        if (!nft_add_section_priority_rules(table, context, entry.matchers))
            return false;

    return true;
}

function nft_create_runtime_base(table, localv4_set, common_set, port_set, ip_port_set, interface_set, source_interfaces, fakeip_mark, outbound_mark, fakeip_range, tproxy_port, exclude_ntp, localv6_set, common6_set, ip_port6_set, fakeip6_range, tproxy6_address) {
    localv6_set = default_arg(localv6_set, "localv6");
    common6_set = default_arg(common6_set, "forkop_subnets6");
    ip_port6_set = default_arg(ip_port6_set, "forkop_ip6_ports");
    fakeip6_range = default_arg(fakeip6_range, "fc00::/18");
    tproxy6_address = default_arg(tproxy6_address, "::1");

    if (!nft_create_table(table) ||
        !nft_create_ipv4_set(table, localv4_set) ||
        !nft_add_set_elements(table, localv4_set, join(",", LOCALV4_RANGES)) ||
        !nft_create_ipv6_set(table, localv6_set) ||
        !nft_add_set_elements(table, localv6_set, join(",", LOCALV6_RANGES)) ||
        !nft_create_ipv4_set(table, common_set) ||
        !nft_create_ipv6_set(table, common6_set) ||
        !nft_create_inet_service_set(table, port_set) ||
        !nft_create_ipv4_port_set(table, ip_port_set) ||
        !nft_create_ipv6_port_set(table, ip_port6_set) ||
        !nft_create_ifname_set(table, interface_set))
        return false;

    for (let interface in whitespace_values(source_interfaces))
        if (!nft_add_set_elements(table, interface_set, interface))
            return false;

    if (!nft_create_chain(table, "dns_redirect", "{ type nat hook prerouting priority -101; policy accept; }") ||
        !nft_create_chain(table, "mangle", "{ type filter hook prerouting priority -149; policy accept; }") ||
        !nft_create_chain(table, "mangle_output", "{ type route hook output priority -150; policy accept; }") ||
        !nft_create_priority_chains(table) ||
        !nft_create_chain(table, "proxy", "{ type filter hook prerouting priority -100; policy accept; }"))
        return false;

    if (!nft_add_rule(table, "dns_redirect", [ "iifname", "@" + as_string(interface_set), "tcp", "dport", "53", "counter", "redirect", "to", ":" + as_string(runtime_constants.SOURCE_DNS_INBOUND_PORT) ]) ||
        !nft_add_rule(table, "dns_redirect", [ "iifname", "@" + as_string(interface_set), "udp", "dport", "53", "counter", "redirect", "to", ":" + as_string(runtime_constants.SOURCE_DNS_INBOUND_PORT) ]) ||
        !nft_add_rule(table, "mangle", [ "ct", "status", "dnat", "return" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip", "daddr", "@" + as_string(localv4_set), "return" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip6", "daddr", "@" + as_string(localv6_set), "ip6", "daddr", "!=", fakeip6_range, "return" ]) ||
        !nft_add_rule(table, "mangle", [ "jump", "priority_rules" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip", "daddr", "@" + as_string(common_set), "meta", "l4proto", "tcp", "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip", "daddr", "@" + as_string(common_set), "meta", "l4proto", "udp", "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip6", "daddr", "@" + as_string(common6_set), "meta", "l4proto", "tcp", "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip6", "daddr", "@" + as_string(common6_set), "meta", "l4proto", "udp", "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip", "daddr", ".", "tcp", "dport", "@" + as_string(ip_port_set), "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip", "daddr", ".", "udp", "dport", "@" + as_string(ip_port_set), "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip6", "daddr", ".", "tcp", "dport", "@" + as_string(ip_port6_set), "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip6", "daddr", ".", "udp", "dport", "@" + as_string(ip_port6_set), "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip", "daddr", "!=", "@" + as_string(localv4_set), "tcp", "dport", "@" + as_string(port_set), "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip", "daddr", "!=", "@" + as_string(localv4_set), "udp", "dport", "@" + as_string(port_set), "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip6", "daddr", "!=", "@" + as_string(localv6_set), "tcp", "dport", "@" + as_string(port_set), "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip6", "daddr", "!=", "@" + as_string(localv6_set), "udp", "dport", "@" + as_string(port_set), "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip", "daddr", fakeip_range, "meta", "l4proto", "tcp", "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip", "daddr", fakeip_range, "meta", "l4proto", "udp", "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip6", "daddr", fakeip6_range, "meta", "l4proto", "tcp", "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "mangle", [ "iifname", "@" + as_string(interface_set), "ip6", "daddr", fakeip6_range, "meta", "l4proto", "udp", "meta", "mark", "set", fakeip_mark, "counter" ]) ||
        !nft_add_rule(table, "proxy", [ "iifname", "lo", "meta", "mark", "&", fakeip_mark, "==", fakeip_mark, "meta", "l4proto", "tcp", "tproxy", "ip", "to", ":" + as_string(runtime_constants.SYSTEM_TPROXY_INBOUND_PORT), "counter", "accept" ]) ||
        !nft_add_rule(table, "proxy", [ "iifname", "lo", "meta", "mark", "&", fakeip_mark, "==", fakeip_mark, "meta", "l4proto", "udp", "tproxy", "ip", "to", ":" + as_string(runtime_constants.SYSTEM_TPROXY_INBOUND_PORT), "counter", "accept" ]) ||
        !nft_add_rule(table, "proxy", [ "iifname", "lo", "meta", "mark", "&", fakeip_mark, "==", fakeip_mark, "meta", "l4proto", "tcp", "tproxy", "ip6", "to", core_ip.format_ipv6_tproxy_target(tproxy6_address, runtime_constants.SYSTEM_TPROXY_INBOUND_PORT), "counter", "accept" ]) ||
        !nft_add_rule(table, "proxy", [ "iifname", "lo", "meta", "mark", "&", fakeip_mark, "==", fakeip_mark, "meta", "l4proto", "udp", "tproxy", "ip6", "to", core_ip.format_ipv6_tproxy_target(tproxy6_address, runtime_constants.SYSTEM_TPROXY_INBOUND_PORT), "counter", "accept" ]) ||
        !nft_add_rule(table, "proxy", [ "meta", "mark", "&", fakeip_mark, "==", fakeip_mark, "meta", "l4proto", "tcp", "tproxy", "ip", "to", ":" + as_string(tproxy_port), "counter" ]) ||
        !nft_add_rule(table, "proxy", [ "meta", "mark", "&", fakeip_mark, "==", fakeip_mark, "meta", "l4proto", "udp", "tproxy", "ip", "to", ":" + as_string(tproxy_port), "counter" ]) ||
        !nft_add_rule(table, "proxy", [ "meta", "mark", "&", fakeip_mark, "==", fakeip_mark, "meta", "l4proto", "tcp", "tproxy", "ip6", "to", core_ip.format_ipv6_tproxy_target(tproxy6_address, tproxy_port), "counter" ]) ||
        !nft_add_rule(table, "proxy", [ "meta", "mark", "&", fakeip_mark, "==", fakeip_mark, "meta", "l4proto", "udp", "tproxy", "ip6", "to", core_ip.format_ipv6_tproxy_target(tproxy6_address, tproxy_port), "counter" ]) ||
        !nft_add_rule(table, "mangle_output", [ "ip", "daddr", "@" + as_string(localv4_set), "return" ]) ||
        !nft_add_rule(table, "mangle_output", [ "ip6", "daddr", "@" + as_string(localv6_set), "ip6", "daddr", "!=", fakeip6_range, "return" ]) ||
        !nft_add_rule(table, "mangle_output", [ "meta", "mark", outbound_mark, "counter", "return" ]) ||
        !nft_add_rule(table, "mangle_output", [ "jump", "priority_output_rules" ]))
        return false;

    if (arg_bool(exclude_ntp) && !nft_insert_rule(table, "mangle", [ "udp", "dport", "123", "return" ]))
        return false;

    return true;
}

function nft_create_runtime_output_rules(table, common_set, port_set, ip_port_set, fakeip_mark, fakeip_range, common6_set, ip_port6_set, fakeip6_range) {
    common6_set = default_arg(common6_set, "forkop_subnets6");
    ip_port6_set = default_arg(ip_port6_set, "forkop_ip6_ports");
    fakeip6_range = default_arg(fakeip6_range, "fc00::/18");

    return (
        nft_add_rule(table, "mangle_output", [ "ip", "daddr", "@" + as_string(common_set), "meta", "l4proto", "tcp", "meta", "mark", "set", fakeip_mark, "counter" ]) &&
        nft_add_rule(table, "mangle_output", [ "ip", "daddr", "@" + as_string(common_set), "meta", "l4proto", "udp", "meta", "mark", "set", fakeip_mark, "counter" ]) &&
        nft_add_rule(table, "mangle_output", [ "ip6", "daddr", "@" + as_string(common6_set), "meta", "l4proto", "tcp", "meta", "mark", "set", fakeip_mark, "counter" ]) &&
        nft_add_rule(table, "mangle_output", [ "ip6", "daddr", "@" + as_string(common6_set), "meta", "l4proto", "udp", "meta", "mark", "set", fakeip_mark, "counter" ]) &&
        nft_add_rule(table, "mangle_output", [ "ip", "daddr", ".", "tcp", "dport", "@" + as_string(ip_port_set), "meta", "mark", "set", fakeip_mark, "counter" ]) &&
        nft_add_rule(table, "mangle_output", [ "ip", "daddr", ".", "udp", "dport", "@" + as_string(ip_port_set), "meta", "mark", "set", fakeip_mark, "counter" ]) &&
        nft_add_rule(table, "mangle_output", [ "ip6", "daddr", ".", "tcp", "dport", "@" + as_string(ip_port6_set), "meta", "mark", "set", fakeip_mark, "counter" ]) &&
        nft_add_rule(table, "mangle_output", [ "ip6", "daddr", ".", "udp", "dport", "@" + as_string(ip_port6_set), "meta", "mark", "set", fakeip_mark, "counter" ]) &&
        nft_add_rule(table, "mangle_output", [ "tcp", "dport", "@" + as_string(port_set), "meta", "mark", "set", fakeip_mark, "counter" ]) &&
        nft_add_rule(table, "mangle_output", [ "udp", "dport", "@" + as_string(port_set), "meta", "mark", "set", fakeip_mark, "counter" ]) &&
        nft_add_rule(table, "mangle_output", [ "ip", "daddr", fakeip_range, "meta", "l4proto", "tcp", "meta", "mark", "set", fakeip_mark, "counter" ]) &&
        nft_add_rule(table, "mangle_output", [ "ip", "daddr", fakeip_range, "meta", "l4proto", "udp", "meta", "mark", "set", fakeip_mark, "counter" ]) &&
        nft_add_rule(table, "mangle_output", [ "ip6", "daddr", fakeip6_range, "meta", "l4proto", "tcp", "meta", "mark", "set", fakeip_mark, "counter" ]) &&
        nft_add_rule(table, "mangle_output", [ "ip6", "daddr", fakeip6_range, "meta", "l4proto", "udp", "meta", "mark", "set", fakeip_mark, "counter" ])
    );
}

function nft_provider_mark_hex(route_mark_base, index) {
    let base = parse_number(route_mark_base);
    index = int(index || 0);
    if (base == null || index < 1)
        return "";

    return sprintf("0x%08x", base + index);
}

function nft_create_provider_output_rules_from_sections(sections, table, action, provider_bin, route_mark_base, queue_base, desync_mark, desync_mark_postnat) {
    if (!file_executable(provider_bin))
        return true;

    let index = 0;
    let added = false;

    for (let section in sections) {
        section = object_or_empty(section);
        if (!bool_option(section, "enabled", true) || option(section, "action", "") != action)
            continue;

        index++;
        let mark_hex = nft_provider_mark_hex(route_mark_base, index);
        let queue_number = int(queue_base || 0) + index - 1;
        if (mark_hex == "" || queue_number < 0)
            return false;

        if (!added) {
            if (!nft_add_rule(table, "mangle_output", [ "meta", "mark", "&", desync_mark, "==", desync_mark, "return" ]) ||
                !nft_add_rule(table, "mangle_output", [ "meta", "mark", "&", desync_mark_postnat, "==", desync_mark_postnat, "return" ]))
                return false;
            added = true;
        }

        if (!nft_add_rule(table, "mangle_output", [ "meta", "mark", mark_hex, "meta", "l4proto", "tcp", "counter", "queue", "num", queue_number, "bypass" ]) ||
            !nft_add_rule(table, "mangle_output", [ "meta", "mark", mark_hex, "meta", "l4proto", "udp", "counter", "queue", "num", queue_number, "bypass" ]))
            return false;
    }

    return true;
}

// A batch of set elements small enough for one `add element` command. The
// element count travels with the text because the debug line reports it.
function nft_new_chunks() {
    return { lines: [], count: 0 };
}

function nft_write_chunk(chunks, chunk) {
    if (length(chunk) == 0)
        return;

    push(chunks.lines, { count: length(chunk), elements: join(",", chunk) });
    chunks.count += length(chunk);
}

function nft_push_chunk_value(chunks, chunk, value, chunk_size) {
    push(chunk, value);
    if (length(chunk) < chunk_size)
        return chunk;

    nft_write_chunk(chunks, chunk);
    return [];
}

function nft_chunk_size(value) {
    value = int(value || 5000);
    return value > 0 ? value : 5000;
}

function nft_csv_values(csv) {
    let result = [];

    for (let item in split(as_string(csv), ",")) {
        item = trim(replace(as_string(item), /\r/g, ""));
        if (item != "")
            push(result, item);
    }

    return result;
}

// One walk over the addresses fills both families. Asking twice, once per
// family, meant validating every address of a list twice and rejecting it twice.
// `ports_csv` is empty for a plain address set and holds the section's ports
// when each address is matched together with each of them.
function nft_build_family_chunks(values, ports_csv, chunk_size_text) {
    let chunk_size = nft_chunk_size(chunk_size_text);
    let scoped = as_string(ports_csv) != "";
    let ports = [];
    let invalid = [];
    let ipv4 = { chunks: nft_new_chunks(), chunk: [] };
    let ipv6 = { chunks: nft_new_chunks(), chunk: [] };

    for (let port in nft_csv_values(ports_csv)) {
        let normalized = rule_config.normalize_port_condition_value(port);
        if (normalized == null)
            push(invalid, { value: port, message: "is not a valid port or port range" });
        else
            push(ports, normalized);
    }

    for (let value in values) {
        let family = core_ip.nft_ip_family(value);
        if (family == 0) {
            push(invalid, { value: value, message: "is not IP or CIDR" });
            continue;
        }

        let bucket = family == 6 ? ipv6 : ipv4;
        if (!scoped) {
            bucket.chunk = nft_push_chunk_value(bucket.chunks, bucket.chunk, value, chunk_size);
            continue;
        }

        for (let port in ports)
            bucket.chunk = nft_push_chunk_value(bucket.chunks, bucket.chunk, value + " . " + port, chunk_size);
    }

    nft_write_chunk(ipv4.chunks, ipv4.chunk);
    nft_write_chunk(ipv6.chunks, ipv6.chunk);

    return { ipv4: ipv4.chunks, ipv6: ipv6.chunks, invalid: invalid };
}

function nft_log_invalid_elements(invalid) {
    for (let item in invalid)
        log_debug("'" + as_string(item.value) + "' " + as_string(item.message));
}

function nft_add_chunks_to_set(table, set_name, chunks) {
    for (let item in chunks.lines) {
        log_debug("Adding " + item.count + " elements to nft set " + set_name);
        if (!nft_add_set_elements(table, set_name, item.elements))
            return false;
    }

    return true;
}

// The addresses of a matcher always land in a pair of sets, one per family, and
// which pair depends only on whether the matcher carries ports.
function nft_add_values_to_family_sets(values, ports_csv, table, ipv4_set, ipv6_set, chunk_size_text) {
    let prepared = nft_build_family_chunks(values, ports_csv, chunk_size_text);

    nft_log_invalid_elements(prepared.invalid);
    return nft_add_chunks_to_set(table, ipv4_set, prepared.ipv4) &&
        nft_add_chunks_to_set(table, ipv6_set, prepared.ipv6);
}

function nft_add_csv_to_family_sets(csv, ports_csv, table, ipv4_set, ipv6_set, chunk_size_text) {
    return nft_add_values_to_family_sets(nft_csv_values(csv), ports_csv, table, ipv4_set, ipv6_set, chunk_size_text);
}

function nft_add_inline_ip_cidr_matchers(csv, ports_csv, table, common_set, ip_port_set, chunk_size_text, common6_set, ip_port6_set) {
    if (as_string(csv) == "")
        return true;

    if (as_string(ports_csv) != "")
        return nft_add_csv_to_family_sets(csv, ports_csv, table, ip_port_set, default_arg(ip_port6_set, "forkop_ip6_ports"), chunk_size_text);

    return nft_add_csv_to_family_sets(csv, "", table, common_set, default_arg(common6_set, "forkop_subnets6"), chunk_size_text);
}

function ensure_rt_table_entry(path, table_id, table_name) {
    let data = fs.readfile(path);
    if (data != null && rt_table_has_entry(data, table_id, table_name))
        return true;

    data = data == null ? "" : as_string(data);
    if (data != "" && substr(data, length(data) - 1, 1) != "\n")
        data += "\n";

    return write_text_file(path, data + as_string(table_id) + " " + as_string(table_name) + "\n");
}

function ensure_tproxy_route_rule(table, mark, rt_tables_path) {
    rt_tables_path = as_string(rt_tables_path || RT_TABLES_PATH);

    if (!ensure_rt_table_entry(rt_tables_path, "105", table)) {
        log_fatal("Failed to update route table registry. Aborted.");
        return false;
    }

    if (!tproxy_route4_present(table)) {
        log_debug("Added IPv4 tproxy route");
        if (!run_args([ IP_BIN, "route", "add", "local", "0.0.0.0/0", "dev", "lo", "table", table ]) && !tproxy_route4_present(table)) {
            log_fatal("Failed to add IPv4 route for tproxy. Aborted.");
            return false;
        }
    }

    if (!tproxy_route6_present(table)) {
        log_debug("Added IPv6 tproxy route");
        if (!run_args([ IP_BIN, "-6", "route", "add", "local", "::/0", "dev", "lo", "table", table ]) && !tproxy_route6_present(table)) {
            log_fatal("Failed to add IPv6 route for tproxy. Aborted.");
            return false;
        }
    }

    if (!tproxy_marking_rule4_present(table, mark)) {
        log_debug("Creating IPv4 tproxy marking rule");
        if (!run_args([ IP_BIN, "-4", "rule", "add", "fwmark", as_string(mark) + "/" + as_string(mark), "table", table, "priority", "105" ]) && !tproxy_marking_rule4_present(table, mark)) {
            log_fatal("Failed to create IPv4 marking rule. Aborted.");
            return false;
        }
    }

    if (!tproxy_marking_rule6_present(table, mark)) {
        log_debug("Creating IPv6 tproxy marking rule");
        if (!run_args([ IP_BIN, "-6", "rule", "add", "fwmark", as_string(mark) + "/" + as_string(mark), "table", table, "priority", "105" ]) && !tproxy_marking_rule6_present(table, mark)) {
            log_fatal("Failed to create IPv6 marking rule. Aborted.");
            return false;
        }
    }

    return true;
}

function ensure_bridge_netfilter_disabled() {
    if (index(command_output_from_args([ "lsmod" ]), "br_netfilter") < 0)
        return true;

    if (trim(command_output_from_args([ "sysctl", "-n", "net.bridge.bridge-nf-call-iptables" ])) != "1")
        return true;

    log_debug("br_netfilter is enabled; disabling it for transparent proxy routing");
    return run_args([ "sysctl", "-w", "net.bridge.bridge-nf-call-iptables=0" ]) &&
        run_args([ "sysctl", "-w", "net.bridge.bridge-nf-call-ip6tables=0" ]);
}

function signature_hash(body) {
    let path = SIGNATURE_TEMP_FILE;

    if (!write_text_file(path, body)) {
        unlink_file(path);
        return "";
    }

    let hash_line = command_output_from_args([ "md5sum", path ]);
    unlink_file(path);
    hash_line = trim(hash_line);

    return length(hash_line) >= 32 ? substr(hash_line, 0, 32) : "";
}

// The nft signature is the artifact: a hash of the exact commands that would
// build the table. A configuration change that does not change them - a section
// carrying only domains, a renamed outbound, a new subscription URL - leaves it
// alone, and one that does change them cannot fail to move it. What used to sit
// here was a second, hand-written list of the fields believed to matter, which is
// how creating any section came to rebuild the whole table.
function nft_runtime_script(model) {
    nft_dry_run = true;
    nft_batch_open();
    let ok = model();
    let lines = nft_batch_take();
    nft_dry_run = false;

    return ok ? join("
", lines) + "
" : null;
}

function print_nft_runtime_signature(model) {
    let script = nft_runtime_script(model);
    if (script == null)
        return false;

    let hash = signature_hash(script);
    if (hash == "")
        return false;

    print(hash, "
");
    return true;
}

function word_set(value) {
    let result = {};
    for (let item in whitespace_values(value))
        result[item] = true;
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

// Zapret and Zapret2 are the same nfqueue runtime with a different binary, and
// each provider module already owns the binary, the mark base and the queue base
// its rules are built from.
function nft_create_nfqueue_provider_output_rules(table, sections) {
    for (let provider in [ zapret_provider, zapret2_provider ]) {
        let cfg = object_or_empty(provider.config());
        if (!nft_create_provider_output_rules_from_sections(sections, table, cfg.action, cfg.provider_bin, cfg.route_mark_base, cfg.queue_base, cfg.desync_mark, cfg.desync_mark_postnat))
            return false;
    }

    return true;
}

function nft_add_section_source_matchers(matchers, table, chunk_size_text) {
    if (!matchers.needs_source_sets)
        return true;

    return nft_add_values_to_family_sets(matchers.sources.ips, "", table,
        matchers.sets.sources, matchers.sets.sources6, chunk_size_text);
}

function nft_add_section_fully_routed_sources(matchers, table, chunk_size_text) {
    if (!matchers.needs_fully_source_sets)
        return true;

    return nft_add_values_to_family_sets(matchers.fully.ips, "", table,
        matchers.sets.fully_sources, matchers.sets.fully_sources6, chunk_size_text);
}

function system_aware_dns_enabled(sections, deferred_sections) {
    for (let section in sections) {
        if (!bool_option(section, "enabled", true) ||
            deferred_sections[as_string(section[".name"])])
            continue;

        let action = option(section, "action", "");

        if (connections.has_dns_matchers(section)) {
            let devices = connections.device_matchers(section, "source_ip_cidr");
            if (devices.system)
                return true;
        }

        if (action == "bypass" || action == "dns") {
            let devices = connections.device_matchers(section, "fully_routed_ips");
            if (devices.system)
                return true;
        }
    }

    return false;
}

function nft_add_system_dns_redirect(table) {
    return nft_create_chain(table, "system_dns_redirect", "{ type nat hook output priority -151; policy accept; }") &&
        nft_add_rule(table, "system_dns_redirect", [ "meta", "mark", "!=", "0", "return" ]) &&
        nft_add_rule(table, "system_dns_redirect", [ "ip", "daddr", runtime_constants.DNS_INBOUND_ADDRESS, "return" ]) &&
        nft_add_rule(table, "system_dns_redirect", [ "tcp", "dport", "53", "counter", "redirect", "to", ":" + as_string(runtime_constants.SYSTEM_DNS_INBOUND_PORT) ]) &&
        nft_add_rule(table, "system_dns_redirect", [ "udp", "dport", "53", "counter", "redirect", "to", ":" + as_string(runtime_constants.SYSTEM_DNS_INBOUND_PORT) ]);
}

function nft_add_system_aware_dns_support(sections, deferred_sections, table) {
    return !system_aware_dns_enabled(sections, deferred_sections) ||
        nft_add_system_dns_redirect(table);
}

// A deferred section is one whose destinations the rule-set sync worker owns:
// its source addresses still belong here, because they come from the
// configuration and not from a provider.
function nft_populate_runtime_set_for_section(section, matchers, deferred_sections, table) {
    if (!nft_add_section_source_matchers(matchers, table, 5000))
        return false;

    if (deferred_sections[as_string(section[".name"])])
        return true;

    if (!nft_add_section_fully_routed_sources(matchers, table, 5000))
        return false;

    if (!nft_add_inline_ip_cidr_matchers(matchers.subnets, matchers.ports, table,
        matchers.sets.subnets, matchers.sets.ip_ports, 5000, matchers.sets.subnets6, matchers.sets.ip6_ports))
        return false;

    if (matchers.needs_port_set && !nft_add_set_elements(table, matchers.sets.ports, matchers.ports))
        return false;

    return true;
}

function nft_populate_runtime_sets_from_sections(sections, populate_enabled, deferred_section_names, table) {
    if (!arg_bool(populate_enabled))
        return true;

    let deferred_sections = word_set(deferred_section_names);

    if (!nft_add_system_aware_dns_support(sections, deferred_sections, table))
        return false;

    let planned = nft_sections.with_priority_sets(sections);
    if (planned.error != "") {
        log_fatal(planned.error);
        return false;
    }

    for (let entry in planned.sections)
        if (!nft_populate_runtime_set_for_section(entry.section, entry.matchers, deferred_sections, table))
            return false;

    return true;
}

function nft_populate_runtime_sets_from_uci(populate_enabled, deferred_section_names, table) {
    if (!arg_bool(populate_enabled))
        return true;

    nft_batch_open();
    if (!nft_populate_runtime_sets_from_sections(uci_sections("section"), populate_enabled, deferred_section_names, table)) {
        nft_batch_take();
        return false;
    }

    return nft_batch_apply();
}

function nft_populate_runtime_sets_fixture(path, populate_enabled, deferred_section_names, table) {
    let data = object_or_empty(common_read_json_file(path));
    connections.set_item_sections_from_data(data);
    return nft_populate_runtime_sets_from_sections(fixture_section_list(data, "section"), populate_enabled, deferred_section_names, table);
}

// Every nft command the runtime table is made of, and nothing else: the routing
// table and the tproxy rules live outside nft and are set up by the caller. This
// is both what gets applied and what gets hashed into the reload signature, so
// the two cannot disagree about what the table depends on.
function nft_runtime_model(settings, sections, populate) {
    return nft_create_runtime_base(
        NFT_TABLE_NAME, NFT_LOCALV4_SET_NAME, NFT_COMMON_SET_NAME, NFT_PORT_SET_NAME,
        NFT_IP_PORT_SET_NAME, NFT_INTERFACE_SET_NAME,
        option(settings, "source_network_interfaces", "br-lan"),
        NFT_FAKEIP_MARK, NFT_OUTBOUND_MARK, SB_FAKEIP_INET4_RANGE, SB_TPROXY_INBOUND_PORT,
        option(settings, "exclude_ntp", "0"),
        NFT_LOCALV6_SET_NAME, NFT_COMMON6_SET_NAME, NFT_IP_PORT6_SET_NAME,
        SB_FAKEIP_INET6_RANGE, SB_TPROXY_INBOUND6_ADDRESS) &&
        nft_add_section_priority_rules_from_sections(sections, NFT_TABLE_NAME, NFT_INTERFACE_SET_NAME, NFT_LOCALV4_SET_NAME, NFT_LOCALV6_SET_NAME, NFT_FAKEIP_MARK, SB_FAKEIP_INET4_RANGE, SB_FAKEIP_INET6_RANGE) &&
        nft_create_nfqueue_provider_output_rules(NFT_TABLE_NAME, sections) &&
        nft_create_runtime_output_rules(NFT_TABLE_NAME, NFT_COMMON_SET_NAME, NFT_PORT_SET_NAME, NFT_IP_PORT_SET_NAME, NFT_FAKEIP_MARK, SB_FAKEIP_INET4_RANGE, NFT_COMMON6_SET_NAME, NFT_IP_PORT6_SET_NAME, SB_FAKEIP_INET6_RANGE) &&
        (!populate || nft_populate_runtime_sets_from_sections(sections, "1", "", NFT_TABLE_NAME));
}

function nft_create_full_runtime_from_uci() {
    return ensure_tproxy_route_rule(RT_TABLE_NAME, NFT_FAKEIP_MARK) &&
        nft_runtime_model(uci_settings(), uci_sections("section"), false);
}

// The whole table is replaced in one transaction. Creating it before deleting it
// keeps the replace unconditional, because `delete table` on a table that is not
// there aborts the transaction it belongs to.
function nft_runtime_replace_commands() {
    return nft_command([ "table", "inet", NFT_TABLE_NAME ]) &&
        nft_command([ "delete", "table", "inet", NFT_TABLE_NAME ]) &&
        nft_create_full_runtime_from_uci();
}

function nft_rebuild_runtime_from_uci() {
    nft_batch_open();
    if (!nft_runtime_replace_commands()) {
        nft_batch_take();
        return false;
    }

    return nft_batch_apply();
}

// The set elements go into the hash as well: their contents are as much a part
// of the table as the rules that match them, and populating them is the only
// step that puts them there.
function nft_runtime_signature_from_uci() {
    let settings = uci_settings();
    let sections = uci_sections("section");

    return print_nft_runtime_signature(function() {
        return nft_runtime_model(settings, sections, true);
    });
}

function fixture_settings(data) {
    return object_or_empty(object_or_empty(data).settings);
}

function nft_runtime_signature_from_fixture(path) {
    let data = object_or_empty(common_read_json_file(path));
    connections.set_item_sections_from_data(data);
    let settings = fixture_settings(data);
    let sections = fixture_section_list(data, "section");

    return print_nft_runtime_signature(function() {
        return nft_runtime_model(settings, sections, true);
    });
}

let mode = ARGV[0] || "";

if (mode == "nft-create-runtime-base")
    exit(nft_create_runtime_base(ARGV[1], ARGV[2], ARGV[3], ARGV[4], ARGV[5], ARGV[6], ARGV[7], ARGV[8], ARGV[9], ARGV[10], ARGV[11], ARGV[12], ARGV[13], ARGV[14], ARGV[15], ARGV[16], ARGV[17]) ? 0 : 1);
else if (mode == "nft-create-runtime-output-rules")
    exit(nft_create_runtime_output_rules(ARGV[1], ARGV[2], ARGV[3], ARGV[4], ARGV[5], ARGV[6], ARGV[7], ARGV[8], ARGV[9]) ? 0 : 1);
else if (mode == "nft-create-provider-output-rules-fixture")
    exit(nft_create_provider_output_rules_from_sections(fixture_section_list(object_or_empty(common_read_json_file(ARGV[1])), "section"), ARGV[2], ARGV[3], ARGV[4], ARGV[5], ARGV[6], ARGV[7], ARGV[8]) ? 0 : 1);
else if (mode == "nft-add-section-priority-rules-fixture")
    exit(nft_add_section_priority_rules_from_sections(fixture_section_list(object_or_empty(common_read_json_file(ARGV[1])), "section"), ARGV[2], ARGV[3], ARGV[4], ARGV[5], ARGV[6], ARGV[7], ARGV[8]) ? 0 : 1);
else if (mode == "nft-rebuild-runtime-from-uci")
    exit(nft_rebuild_runtime_from_uci() ? 0 : 1);
else if (mode == "nft-populate-runtime-sets-from-uci")
    exit(nft_populate_runtime_sets_from_uci(ARGV[1], ARGV[2], ARGV[3]) ? 0 : 1);
else if (mode == "nft-populate-runtime-sets-fixture")
    exit(nft_populate_runtime_sets_fixture(ARGV[1], ARGV[2], ARGV[3], ARGV[4]) ? 0 : 1);
else if (mode == "nft-runtime-signature")
    exit(nft_runtime_signature_from_uci() ? 0 : 1);
else if (mode == "nft-runtime-signature-fixture")
    exit(nft_runtime_signature_from_fixture(ARGV[1]) ? 0 : 1);
else if (mode == "ensure-tproxy-route-rule")
    exit(ensure_tproxy_route_rule(ARGV[1], ARGV[2], ARGV[3]) ? 0 : 1);
else if (mode == "ensure-bridge-netfilter-disabled")
    exit(ensure_bridge_netfilter_disabled() ? 0 : 1);
else {
    warn("Usage: nft/apply.uc <operation> ...\n");
    exit(1);
}
