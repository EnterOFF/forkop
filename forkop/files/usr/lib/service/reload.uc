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
        dnsmasq: current.dnsmasq != previous.dnsmasq,
        sing_box: current.sing_box != previous.sing_box,
        nft: current.nft != previous.nft,
        zapret_queue: current.zapret_queue != previous.zapret_queue,
        zapret_runtime: current.zapret_runtime != previous.zapret_runtime,
        zapret2_queue: current.zapret2_queue != previous.zapret2_queue,
        zapret2_runtime: current.zapret2_runtime != previous.zapret2_runtime,
        byedpi_runtime: current.byedpi_runtime != previous.byedpi_runtime,
        cron: current.cron != previous.cron
    };

    let needs = {
        sing_box_reload: false,
        nft_rebuild: false,
        zapret_restart: false,
        zapret2_restart: false,
        byedpi_restart: false,
        dnsmasq_restore: false,
        cron_refresh: false
    };

    if (changed.sing_box)
        needs.sing_box_reload = true;

    if (changed.nft)
        needs.nft_rebuild = true;

    if (changed.zapret_queue) {
        needs.zapret_restart = true;
        needs.nft_rebuild = true;
        needs.sing_box_reload = true;
    }

    if (changed.zapret_runtime)
        needs.zapret_restart = true;

    if (changed.zapret2_queue) {
        needs.zapret2_restart = true;
        needs.nft_rebuild = true;
        needs.sing_box_reload = true;
    }

    if (changed.zapret2_runtime)
        needs.zapret2_restart = true;

    if (changed.byedpi_runtime)
        needs.byedpi_restart = true;

    if (changed.dnsmasq && context.dnsmasq_managed_state)
        needs.dnsmasq_restore = true;

    if (changed.cron)
        needs.cron_refresh = true;

    if (context.runtime_cache_needs_rebuild) {
        changed.sing_box = true;
        needs.sing_box_reload = true;
    }

    if (context.force_runtime_reload &&
        !needs.sing_box_reload &&
        !needs.nft_rebuild &&
        !needs.zapret_restart &&
        !needs.zapret2_restart &&
        !needs.byedpi_restart &&
        !needs.dnsmasq_restore)
        needs.sing_box_reload = true;

    let has_work =
        needs.sing_box_reload ||
        needs.nft_rebuild ||
        needs.zapret_restart ||
        needs.zapret2_restart ||
        needs.byedpi_restart ||
        needs.dnsmasq_restore ||
        needs.cron_refresh;

    emit_bool("changed_service_triggers", changed.service_triggers);
    emit_bool("changed_dnsmasq", changed.dnsmasq);
    emit_bool("changed_sing_box", changed.sing_box);
    emit_bool("changed_nft", changed.nft);
    emit_bool("changed_zapret_queue", changed.zapret_queue);
    emit_bool("changed_zapret_runtime", changed.zapret_runtime);
    emit_bool("changed_zapret2_queue", changed.zapret2_queue);
    emit_bool("changed_zapret2_runtime", changed.zapret2_runtime);
    emit_bool("changed_byedpi_runtime", changed.byedpi_runtime);
    emit_bool("changed_cron", changed.cron);

    emit_bool("needs_sing_box_reload", needs.sing_box_reload);
    emit_bool("needs_nft_rebuild", needs.nft_rebuild);
    emit_bool("needs_zapret_restart", needs.zapret_restart);
    emit_bool("needs_zapret2_restart", needs.zapret2_restart);
    emit_bool("needs_byedpi_restart", needs.byedpi_restart);
    emit_bool("needs_dnsmasq_restore", needs.dnsmasq_restore);
    emit_bool("needs_cron_refresh", needs.cron_refresh);
    emit_bool("has_work", has_work);
}

function reload_plan() {
    let previous = {
        service_trigger: as_string(ARGV[1]),
        dnsmasq: as_string(ARGV[2]),
        sing_box: as_string(ARGV[3]),
        nft: as_string(ARGV[4]),
        zapret_queue: as_string(ARGV[5]),
        zapret_runtime: as_string(ARGV[6]),
        zapret2_queue: as_string(ARGV[7]),
        zapret2_runtime: as_string(ARGV[8]),
        byedpi_runtime: as_string(ARGV[9]),
        cron: as_string(ARGV[10])
    };

    let current = {
        service_trigger: as_string(ARGV[11]),
        dnsmasq: as_string(ARGV[12]),
        sing_box: as_string(ARGV[13]),
        nft: as_string(ARGV[14]),
        zapret_queue: as_string(ARGV[15]),
        zapret_runtime: as_string(ARGV[16]),
        zapret2_queue: as_string(ARGV[17]),
        zapret2_runtime: as_string(ARGV[18]),
        byedpi_runtime: as_string(ARGV[19]),
        cron: as_string(ARGV[20]),
        dont_touch_dhcp: arg_bool(ARGV[21])
    };

    let context = {
        force_runtime_reload: arg_bool(ARGV[22]),
        dnsmasq_managed_state: arg_bool(ARGV[23]),
        runtime_cache_needs_rebuild: arg_bool(ARGV[24])
    };

    emit_reload_plan(previous, current, context);
}

function read_state_file(path) {
    let data = fs.readfile(path);
    if (data == null)
        return null;

    let state = {};
    let has = {};

    for (let line in split(data, "\n")) {
        if (line == "")
            continue;

        let equals = index(line, "=");
        let key = equals >= 0 ? substr(line, 0, equals) : line;
        if (key == "")
            continue;

        state[key] = equals >= 0 ? substr(line, equals + 1) : "";
        has[key] = true;
    }

    state.__has = has;
    return state;
}

function plan_state_from_file(path) {
    let state = read_state_file(path);
    if (state == null)
        return null;

    return {
        format: as_string(state.format),
        service_trigger: as_string(state.service_trigger_signature || state.restart_signature),
        dnsmasq: as_string(state.dnsmasq_signature),
        sing_box: as_string(state.sing_box_signature),
        nft: as_string(state.nft_signature),
        zapret_queue: as_string(state.zapret_queue_signature),
        zapret_runtime: as_string(state.zapret_runtime_signature),
        zapret2_queue: as_string(state.zapret2_queue_signature),
        zapret2_runtime: as_string(state.zapret2_runtime_signature),
        byedpi_runtime: as_string(state.byedpi_runtime_signature),
        cron: as_string(state.cron_signature),
        dont_touch_dhcp: arg_bool(state.dont_touch_dhcp)
    };
}

function plan_state_files() {
    let previous = plan_state_from_file(ARGV[1]);
    let current = plan_state_from_file(ARGV[2]);
    if (previous == null || current == null || previous.format == "" || previous.format != current.format)
        exit(2);

    let context = {
        force_runtime_reload: arg_bool(ARGV[3]),
        dnsmasq_managed_state: arg_bool(ARGV[4]),
        runtime_cache_needs_rebuild: arg_bool(ARGV[5])
    };

    emit_reload_plan(previous, current, context);
}

let mode = ARGV[0] || "";

if (mode == "plan")
    reload_plan();
else if (mode == "plan-state-files")
    plan_state_files();
else {
    warn("Usage: service/reload.uc plan ...\n");
    warn("       service/reload.uc plan-state-files <previous-state> <current-state> <force-reload> <dnsmasq-managed-state> <runtime-cache-needs-rebuild>\n");
    exit(1);
}
