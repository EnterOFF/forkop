#!/usr/bin/env ucode

let fs = require("fs");
let common = require("core.common");

const IP_BIN = getenv("FORKOP_IP_BIN") || "/usr/libexec/ip-full";

let as_string = common.as_string;
let parse_mark_number = common.parse_number;

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
    let pipe = fs.popen(command_from_args(args) + " 2>/dev/null", "r");
    if (!pipe)
        return "";

    let data = pipe.read("all");
    let status = pipe.close();
    return status == 0 && data != null ? as_string(data) : "";
}

function command_success_from_args(args) {
    return system(command_from_args(args) + " >/dev/null 2>&1") == 0;
}

// Whether the runtime table is loaded, and nothing else. Asked without -t, nft
// prints every element of every set first, which on a real rule set is seconds
// of work and megabytes of output to answer a yes or no.
function table_present(table) {
    return command_success_from_args([ "nft", "-t", "list", "table", "inet", as_string(table) ]);
}

function normalized_fields(line) {
    line = trim(replace(as_string(line), /\r/g, ""));
    line = replace(line, /[[:space:]]+/g, " ");
    return line == "" ? [] : split(line, " ");
}

function rule_line_has_fwmark(fields, expected_mark) {
    for (let i = 0; i + 1 < length(fields); i++) {
        if (fields[i] != "fwmark")
            continue;

        let parts = split(fields[i + 1], "/");
        if (length(parts) == 2 && parse_mark_number(parts[0]) == expected_mark &&
            parse_mark_number(parts[1]) == expected_mark)
            return true;
    }
    return false;
}

// The rule list is requested for a single table, so the query itself proves
// the table. Matching the printed table name would be wrong: any other
// package that registers the same table id in /etc/iproute2/rt_tables, for
// example `105 podkop`, can own the name that iproute2 prints for table 105.
function has_tproxy_marking_rule_text(rule_list, mark) {
    let expected_mark = parse_mark_number(mark);
    if (expected_mark == null)
        return false;

    for (let line in split(as_string(rule_list), "\n")) {
        let fields = normalized_fields(line);
        if (length(fields) > 0 && rule_line_has_fwmark(fields, expected_mark))
            return true;
    }
    return false;
}

function has_local_default_route_text(route_list, family) {
    family = int(family || 4);
    for (let line in split(as_string(route_list), "\n")) {
        line = replace(trim(replace(as_string(line), /\r/g, "")), /[[:space:]]+/g, " ");
        if (family == 4 && index(line, "local default dev lo scope host") >= 0)
            return true;
        if (family == 6 && (index(line, "local ::") >= 0 || index(line, "local default") >= 0) &&
            index(line, " dev lo") >= 0)
            return true;
    }
    return false;
}

function rt_table_has_entry(text, table_id, table_name) {
    table_id = as_string(table_id);
    table_name = as_string(table_name);
    for (let line in split(as_string(text), "\n")) {
        let fields = normalized_fields(line);
        if (length(fields) >= 2 && fields[0] == table_id && fields[1] == table_name)
            return true;
    }
    return false;
}

function tproxy_route4_present(table) {
    return has_local_default_route_text(command_output_from_args([ IP_BIN, "route", "list", "table", table ]), 4);
}

function tproxy_route6_present(table) {
    return has_local_default_route_text(command_output_from_args([ IP_BIN, "-6", "route", "list", "table", table ]), 6);
}

function tproxy_route_present(table) {
    return tproxy_route4_present(table) && tproxy_route6_present(table);
}

function tproxy_marking_rule4_present(table, mark) {
    return has_tproxy_marking_rule_text(
        command_output_from_args([ IP_BIN, "-4", "rule", "list", "table", table ]), mark);
}

function tproxy_marking_rule6_present(table, mark) {
    return has_tproxy_marking_rule_text(
        command_output_from_args([ IP_BIN, "-6", "rule", "list", "table", table ]), mark);
}

function tproxy_marking_rule_present(table, mark) {
    return tproxy_marking_rule4_present(table, mark) && tproxy_marking_rule6_present(table, mark);
}

function tproxy_route_rule_present(table, mark) {
    return tproxy_route_present(table) && tproxy_marking_rule_present(table, mark);
}

return {
    table_present,
    rt_table_has_entry,
    tproxy_route4_present,
    tproxy_route6_present,
    tproxy_route_present,
    tproxy_marking_rule4_present,
    tproxy_marking_rule6_present,
    tproxy_marking_rule_present,
    tproxy_route_rule_present
};
