#!/usr/bin/env ucode

// Which rule-set tags belong to which connection section. The dashboard needs
// this to refresh the lists of one section instead of every list at once, and
// it cannot work the tags out for itself: a built-in list is named per section
// and a custom reference is named from a hash of the reference. Both names are
// produced by singbox/rulesets.uc, so the answer is computed by the same code
// that generates the runtime configuration rather than restated in the UI.
//
// This lives apart from service/ui.uc on purpose. Reading these fields pulls in
// config/connections.uc, and service/ui.uc answers the status poll, where every
// extra module is parsed behind every refresh.

let uci_core = require("core.uci");
let connections = require("config.connections");
let rulesets = require("singbox.rulesets");

const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || "forkop";

function as_string(value) {
    return value == null ? "" : "" + value;
}

function object_or_empty(value) {
    return type(value) == "object" ? value : {};
}

// A custom reference resolves to one shared tag, so two sections pointing at
// the same list name it identically and refreshing either refreshes both. That
// is the runtime's own model: a rule set exists once, however many sections use
// it.
function section_tags(section) {
    section = object_or_empty(section);
    let section_name = as_string(section[".name"]);
    if (section_name == "")
        return [];

    let tags = [];
    let seen = {};

    function add(tag) {
        tag = as_string(tag);
        if (tag == "" || seen[tag])
            return;
        seen[tag] = true;
        push(tags, tag);
    }

    for (let community in connections.community_lists(section))
        add(rulesets.community_tag(section_name, as_string(community)));
    for (let reference in connections.rule_sets(section))
        add(rulesets.custom_reference_tag(as_string(reference)));
    for (let reference in connections.rule_sets_with_subnets(section))
        add(rulesets.custom_reference_tag(as_string(reference)));

    return tags;
}

// Sections with no rule set at all are left out entirely: the caller shows the
// refresh control only for the ones present here.
function section_tag_map() {
    let result = {};

    for (let section in uci_core.section_objects(CONFIG_NAME, "section")) {
        section = object_or_empty(section);
        let section_name = as_string(section[".name"]);
        let tags = section_tags(section);
        if (section_name != "" && length(tags) > 0)
            result[section_name] = tags;
    }

    return result;
}

function section_rule_sets_json() {
    print(sprintf("%J", section_tag_map()), "\n");
}

let mode = ARGV[0] || "";

if (mode == "get-section-rule-sets") {
    section_rule_sets_json();
    exit(0);
}

warn("Usage: singbox/section_rulesets.uc get-section-rule-sets\n");
exit(1);
