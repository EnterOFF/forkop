// Builds the throwaway sing-box configuration the proxy check runs against.
// The check only has to reach one address through one outbound, so everything
// that would make a second core fight the running one — inbounds, services,
// the shared cache and the Clash API — is stripped out first.

function as_string(value) {
    return value == null ? "" : "" + value;
}

function array_or_empty(value) {
    return type(value) == "array" ? value : [];
}

function contains(values, needle) {
    needle = as_string(needle);
    for (let value in array_or_empty(values))
        if (as_string(value) == needle)
            return true;
    return false;
}

function rule_references_rule_set(rule, tags) {
    if (type(rule) != "object")
        return false;

    for (let nested in array_or_empty(rule.rules))
        if (rule_references_rule_set(nested, tags))
            return true;

    let referenced = type(rule.rule_set) == "array" ? rule.rule_set : [ rule.rule_set ];
    for (let tag in referenced)
        if (tag != null && tags[as_string(tag)])
            return true;
    return false;
}

function drop_rules_for_rule_sets(rules, tags) {
    let result = [];
    for (let rule in array_or_empty(rules))
        if (!rule_references_rule_set(rule, tags))
            push(result, rule);
    return result;
}

// The check runs with a fresh cache file, so remote rule-sets would have to be
// downloaded again. That download resolves its host through the FakeIP rules
// of the very configuration under test and then dials 198.18.0.0/15 without
// TPROXY, which fails rule-set initialization before the proxy is ever
// reached. The proxy check does not match traffic, so remote rule-sets and the
// rules referencing them are dropped from the temporary configuration.
function strip_remote_rule_sets(config) {
    let kept = [];
    let removed = {};
    for (let rule_set in array_or_empty(config.route && config.route.rule_set)) {
        if (type(rule_set) == "object" && as_string(rule_set.type) == "remote")
            removed[as_string(rule_set.tag)] = true;
        else
            push(kept, rule_set);
    }

    if (type(config.route) == "object") {
        config.route.rule_set = kept;
        config.route.rules = drop_rules_for_rule_sets(config.route.rules, removed);
    }
    if (type(config.dns) == "object")
        config.dns.rules = drop_rules_for_rule_sets(config.dns.rules, removed);
}

function prepare_config(config, cache_path) {
    config = type(config) == "object" ? config : {};
    config.inbounds = [];
    config.services = [];
    if (type(config.experimental) == "object") {
        if (type(config.experimental.cache_file) == "object")
            config.experimental.cache_file.path = as_string(cache_path);
        delete config.experimental.clash_api;
    }
    strip_remote_rule_sets(config);
    return config;
}

// A single domain is generated as a plain string, so the matcher accepts both
// shapes. Missing the rule would send the check through the default outbound
// and report the router address instead of the proxy address.
function rule_matches_domain(rule, domain) {
    if (type(rule.domain) == "array")
        return contains(rule.domain, domain);
    return rule.domain != null && as_string(rule.domain) == as_string(domain);
}

function outbound_tag(config, domain) {
    config = type(config) == "object" ? config : {};
    for (let rule in array_or_empty(config.route && config.route.rules)) {
        if (type(rule) != "object")
            continue;
        if (rule_matches_domain(rule, domain))
            return as_string(rule.outbound || "");
    }
    return "";
}

return { prepare_config, outbound_tag, strip_remote_rule_sets };
