#!/usr/bin/env ucode

// What one Forkop section contributes to the nftables runtime table.
//
// nft/apply.uc builds the table and nft/ruleset_sync.uc refills its sets from
// the rule-set providers, and the two have to agree about every section: a set
// apply.uc does not create is a set ruleset_sync must not flush, and a matcher
// one of them reads from `_text` while the other reads the list option is a
// matcher that silently reaches only half the table. Each of those questions
// used to be answered twice, in two files, from different options. They are
// answered here once.

let common = require("core.common");
let connections = require("config.connections");
let rule_config = require("config.rule");
let runtime_rulesets = require("singbox.rulesets");

let as_string = common.as_string;
let object_or_empty = common.object_or_empty;

// Every action whose traffic the table marks for the transparent proxy. bypass
// reaches nft as well, to accept traffic before one of those rules can mark it.
const CAPTURE_ACTIONS = {
    connection: true,
    proxy: true,
    outbound: true,
    vpn: true,
    block: true
};

const SET_SUFFIXES = {
    subnets: "_subnets",
    subnets6: "_subnets6",
    ports: "_ports",
    ip_ports: "_ip_ports",
    ip6_ports: "_ip6_ports",
    proto_ports: "_proto_ports",
    proto6_ports: "_proto6_ports",
    sources: "_sources",
    sources6: "_sources6",
    fully_sources: "_fully_sources",
    fully_sources6: "_fully_sources6"
};

function section_name(section) {
    return as_string(object_or_empty(section)[".name"]);
}

function enabled(section) {
    return common.bool_option(section, "enabled", true);
}

// "bypass", "capture" or "" for a section the table has no rule for at all.
function priority_action(section) {
    let action = common.option(section, "action", "");
    if (action == "bypass")
        return "bypass";
    return CAPTURE_ACTIONS[action] == true ? "capture" : "";
}

function set_names(section) {
    let prefix = "forkop_rule_" + section_name(section);
    let result = {};

    for (let key in keys(SET_SUFFIXES))
        result[key] = prefix + SET_SUFFIXES[key];

    return result;
}

// The rule-set providers that can hand this section IP prefixes: the built-in
// lists that carry subnets and every custom rule set the user asked to import
// subnets from. Their number is also the answer to "does this section get
// subnets from anywhere but its own configuration".
function subnet_source_tags(section) {
    section = object_or_empty(section);
    let name = section_name(section);
    let result = [];
    let seen = {};

    for (let community in connections.community_lists(section)) {
        let tag = runtime_rulesets.community_tag(name, community);
        if (rule_config.community_service_has_subnet_list(community) && !seen[tag]) {
            seen[tag] = true;
            push(result, tag);
        }
    }

    for (let reference in connections.rule_sets_with_subnets(section)) {
        let tag = runtime_rulesets.custom_reference_tag(reference);
        if (!seen[tag]) {
            seen[tag] = true;
            push(result, tag);
        }
    }

    return result;
}

// One walk over a section's conditions answers everything the builders ask, and
// each answer on its own costs such a walk.
//
// The `needs_*` flags are the contract between the two callers: they say which
// sets the rules reference, which is both which sets have to be created and
// which ones hold elements.
//
// `tags` overrides which providers feed the section, which is how a test fixture
// pins a snapshot without a rule set URL that hashes to the name it needs. The
// flags are derived from it either way, so the override cannot describe a section
// the builders would treat differently.
function matchers(section, tags) {
    section = object_or_empty(section);

    let action = priority_action(section);
    let sources = connections.device_matchers(section, "source_ip_cidr");
    let fully = connections.device_matchers(section, "fully_routed_ips");
    let ports = connections.rule_ports_csv(section);
    let subnets = connections.rule_condition_csv(section, "ip_cidr", "subnets");
    if (type(tags) != "array")
        tags = subnet_source_tags(section);
    let ip_matchers = subnets != "" || length(tags) > 0;
    // A port on its own selects traffic. A port next to a destination - an
    // address, a domain, a rule set - is a condition on that destination
    // instead, and is matched together with it rather than on its own.
    let port_only = ports != "" && subnets == "" && !connections.has_dns_matchers(section);

    return {
        action: action,
        sets: set_names(section),
        subnets: subnets,
        ports: ports,
        subnet_tags: tags,
        sources: sources,
        fully: fully,
        needed: action != "" && (fully.selected || ip_matchers || port_only),
        // Without ports every prefix is matched on its own; with them each one
        // is matched together with a port, and a provider can carry port
        // constraints of its own either way.
        needs_subnet_sets: ip_matchers && ports == "",
        needs_ip_port_sets: ip_matchers && (ports != "" || length(tags) > 0),
        // A provider can also limit addresses to one transport, which the pair
        // above cannot say: one set is read by a rule per transport, so an
        // address in it is matched on both. Those addresses carry the transport
        // in the set key instead, and only a provider produces them.
        needs_proto_port_sets: length(tags) > 0,
        needs_port_set: port_only,
        needs_source_sets: length(sources.ips) > 0,
        needs_fully_source_sets: length(fully.ips) > 0
    };
}

// The enabled sections that reach the table, each with its classification, in
// configuration order. A duplicate name would have two sections claim the same
// sets, so it is reported rather than silently applied twice.
function with_priority_sets(sections) {
    let result = [];
    let seen = {};

    for (let section in sections) {
        section = object_or_empty(section);
        if (!enabled(section))
            continue;

        let entry = matchers(section);
        if (!entry.needed)
            continue;

        let name = section_name(section);
        if (seen[name])
            return { error: "duplicate nft section: " + name, sections: [] };
        seen[name] = true;

        push(result, { section: section, matchers: entry });
    }

    return { error: "", sections: result };
}

return {
    enabled,
    priority_action,
    set_names,
    subnet_source_tags,
    matchers,
    with_priority_sets
};
