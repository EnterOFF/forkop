#!/usr/bin/env ucode

let common = require("core.common");

let as_string = common.as_string;
let array_or_empty = common.array_or_empty;
let object_or_empty = common.object_or_empty;

const FORKOP_RUNTIME_STATE_DIR = getenv("FORKOP_RUNTIME_STATE_DIR") || "/var/run/forkop";
const FORKOP_SECTION_CACHE_DIR = getenv("FORKOP_SECTION_CACHE_DIR") || FORKOP_RUNTIME_STATE_DIR + "/section-cache";
const FORKOP_RUNTIME_CACHE_FORMAT = int(getenv("FORKOP_RUNTIME_CACHE_FORMAT") || "8");

let section_cache_dir = FORKOP_SECTION_CACHE_DIR;

function set_section_cache_dir(path) {
    path = as_string(path);
    if (path != "")
        section_cache_dir = path;
}

function section_cache_path(section_name) {
    return section_cache_dir + "/" + section_name + ".json";
}

function remember_outbound_name(state, tag_name, display_name) {
    if (type(state) != "object")
        return;
    state.outboundMetadata.names[tag_name] = display_name;
}

function remember_urltest_group(state, tag_name, display_name, outbound) {
    if (type(state) != "object" || as_string(outbound.type || "") != "urltest")
        return;

    let group = {
        displayName: as_string(display_name) != "" ? as_string(display_name) : tag_name,
        outbounds: array_or_empty(outbound.outbounds)
    };

    for (let key in [ "url", "interval", "tolerance", "idle_timeout", "interrupt_exist_connections", "hide_dashboard_members" ])
        if (outbound[key] != null)
            group[key] = outbound[key];

    state.urltestGroups[tag_name] = group;
}

function remember_urltest_group_config(state, tag_name, input_group) {
    if (type(state) != "object")
        return;

    input_group = object_or_empty(input_group);
    let output_group = {
        displayName: as_string(input_group.displayName || "") != "" ? as_string(input_group.displayName) : tag_name,
        outbounds: array_or_empty(input_group.outbounds)
    };

    for (let key in [ "url", "interval", "tolerance", "idle_timeout", "interrupt_exist_connections", "hide_dashboard_members" ])
        if (input_group[key] != null)
            output_group[key] = input_group[key];

    state.urltestGroups[tag_name] = output_group;
}

function remember_fallback_group(state, tag_name, group) {
    if (type(state) == "object")
        state.fallbackGroups[tag_name] = object_or_empty(group);
}

function new_section_state(section_name) {
    return {
        version: FORKOP_RUNTIME_CACHE_FORMAT,
        section: section_name,
        outboundMetadata: { names: {}, protocols: {} },
        urltestCandidateTags: [],
        urltestGroups: {},
        fallbackGroups: {}
    };
}

return {
    set_section_cache_dir,
    section_cache_path,
    remember_outbound_name,
    remember_urltest_group,
    remember_urltest_group_config,
    remember_fallback_group,
    new_section_state
};
