#!/usr/bin/env ucode

let fs = require("fs");

function as_string(value) {
    return value == null ? "" : "" + value;
}

function arg_bool(value) {
    return value === true || value == "true" || value == "1" || value == 1;
}

function emit(name, value) {
    print(name, "\t", as_string(value), "\n");
}

function emit_bool(name, value) {
    emit(name, value ? "1" : "0");
}

function emit_reload_plan(previous, current, context) {
    let changed = {
        service_triggers: current.service_trigger != previous.service_trigger,
        sing_box: current.sing_box != previous.sing_box,
        nft: current.nft != previous.nft,
        cron: current.cron != previous.cron
    };

    let needs = {
        sing_box_reload: false,
        nft_rebuild: false,
        cron_refresh: false
    };

    if (changed.sing_box)
        needs.sing_box_reload = true;

    if (changed.nft)
        needs.nft_rebuild = true;

    if (changed.cron)
        needs.cron_refresh = true;

    if (context.runtime_cache_needs_rebuild) {
        changed.sing_box = true;
        needs.sing_box_reload = true;
    }

    if (context.force_runtime_reload &&
        !needs.sing_box_reload &&
        !needs.nft_rebuild)
        needs.sing_box_reload = true;

    let has_work =
        needs.sing_box_reload ||
        needs.nft_rebuild ||
        needs.cron_refresh;

    emit_bool("changed_service_triggers", changed.service_triggers);
    emit_bool("changed_sing_box", changed.sing_box);
    emit_bool("changed_nft", changed.nft);
    emit_bool("changed_cron", changed.cron);

    emit_bool("needs_sing_box_reload", needs.sing_box_reload);
    emit_bool("needs_nft_rebuild", needs.nft_rebuild);
    emit_bool("needs_cron_refresh", needs.cron_refresh);
    emit_bool("has_work", has_work);
}

function read_state_file(path) {
    let data = fs.readfile(path);
    if (data == null)
        return null;

    let state = {};

    for (let line in split(data, "\n")) {
        if (line == "")
            continue;

        let equals = index(line, "=");
        let key = equals >= 0 ? substr(line, 0, equals) : line;
        if (key == "")
            continue;

        state[key] = equals >= 0 ? substr(line, equals + 1) : "";
    }

    return state;
}

function plan_state_from_file(path) {
    let state = read_state_file(path);
    if (state == null)
        return null;

    return {
        format: as_string(state.format),
        service_trigger: as_string(state.service_trigger_signature || state.restart_signature),
        sing_box: as_string(state.sing_box_signature),
        nft: as_string(state.nft_signature),
        cron: as_string(state.cron_signature)
    };
}

function plan_state_files() {
    let previous = plan_state_from_file(ARGV[1]);
    let current = plan_state_from_file(ARGV[2]);
    if (previous == null || current == null || previous.format == "" || previous.format != current.format)
        exit(2);

    let context = {
        force_runtime_reload: arg_bool(ARGV[3]),
        runtime_cache_needs_rebuild: arg_bool(ARGV[4])
    };

    emit_reload_plan(previous, current, context);
}

let mode = ARGV[0] || "";

if (mode == "plan-state-files")
    plan_state_files();
else {
    warn("Usage: service/reload.uc plan-state-files <previous-state> <current-state> <force-reload> <runtime-cache-needs-rebuild>\n");
    exit(1);
}
