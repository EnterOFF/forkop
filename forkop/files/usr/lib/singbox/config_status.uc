#!/usr/bin/env ucode

// What the generated sing-box configuration says about one tagged inbound or
// endpoint. The Servers diagnostics read this to tell a listener that was
// actually written into the configuration from one that only exists in UCI.

let fs = require("fs");

function as_string(value) {
    return value == null ? "" : "" + value;
}

function int_arg(value) {
    value = as_string(value);
    return value == "" ? 0 : int(value, 10);
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

function array_or_empty(value) {
    return type(value) == "array" ? value : [];
}

function write_json(value) {
    print(sprintf("%J", value), "\n");
}

function value_contains(value, needle) {
    if (type(value) == "array") {
        for (let item in value) {
            if (as_string(item) == needle)
                return true;
        }
        return false;
    }

    return as_string(value) == needle;
}

function find_tagged_item(items, tag) {
    for (let item in array_or_empty(items)) {
        if (type(item) == "object" && item.tag == tag)
            return item;
    }

    return null;
}

function tagged_runtime_summary(config_path, section_name, tag) {
    let config = read_json_file(config_path);
    let item = find_tagged_item(config && config[section_name], tag);

    if (item == null) {
        write_json({ exists: 0 });
        return;
    }

    write_json({
        exists: 1,
        type: as_string(item.type),
        listen: as_string(item.listen),
        listen_port: int_arg(item.listen_port)
    });
}

function has_route_rule_for_inbound(config_path, inbound) {
    let config = read_json_file(config_path);
    for (let rule in array_or_empty(config && config.route && config.route.rules)) {
        if (type(rule) == "object" &&
            (rule.action == "route" || rule.action == "reject") &&
            value_contains(rule.inbound, inbound))
            return true;
    }

    return false;
}

let mode = ARGV[0] || "";

if (mode == "inbound-summary")
    tagged_runtime_summary(ARGV[1], "inbounds", ARGV[2]);
else if (mode == "endpoint-summary")
    tagged_runtime_summary(ARGV[1], "endpoints", ARGV[2]);
else if (mode == "has-route-rule-for-inbound")
    exit(has_route_rule_for_inbound(ARGV[1], ARGV[2]) ? 0 : 1);
else {
    warn("Usage: singbox/config_status.uc <operation> ...\n");
    exit(1);
}
