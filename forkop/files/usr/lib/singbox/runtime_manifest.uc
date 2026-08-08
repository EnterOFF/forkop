#!/usr/bin/env ucode

let common = require("core.common");

let as_string = common.as_string;
let object_or_empty = common.object_or_empty;

const FORMAT_VERSION = 1;
const CONFIG_SUFFIX = ".runtime-manifest.json";

function config_path(config_path) {
    return as_string(config_path) + CONFIG_SUFFIX;
}

function new_manifest() {
    return {
        version: FORMAT_VERSION,
        sections: {}
    };
}

function new_section_state() {
    return {
        outboundMetadata: { names: {}, protocols: {} }
    };
}

function remember_outbound_name(state, tag_name, display_name) {
    if (type(state) == "object")
        state.outboundMetadata.names[tag_name] = display_name;
}

function remember_section(manifest, section_name, state) {
    if (type(manifest) != "object" || type(state) != "object")
        return;
    manifest.sections[as_string(section_name)] = object_or_empty(state.outboundMetadata);
}

return {
    config_path,
    new_manifest,
    new_section_state,
    remember_outbound_name,
    remember_section
};
