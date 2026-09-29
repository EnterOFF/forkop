// The forkop command line: the command table, its help and its dispatch.

let exec = require("core.exec");
let constants = require("core.constants");
let library = require("core.library");

// A module that is still a program of its own, run from the same library.
function program(path, mode) {
    return function(args) {
        return exec.run(library.program(path, [ mode, ...args ]));
    };
}

// Only the init script's start registers the service with procd, and that
// registration carries the triggers Apply and a WAN coming up depend on.
function init_script(verb) {
    return function(args) {
        return exec.run([ constants.FORKOP_SERVICE_INIT, verb, ...args ]);
    };
}

// A command the page reads as { success, ... } or { success: false, message }.
function reply(fn) {
    return function(args) {
        try {
            print(sprintf("%J\n", { success: true, ...fn(...args) }));
            return 0;
        }
        catch (e) {
            print(sprintf("%J\n", { success: false, message: e.message }));
            return 1;
        }
    };
}

function warp_profile() {
    try {
        print(sprintf("%J\n", require("singbox.runtime").warp_profile()));
        return 0;
    }
    catch (e) {
        warn(e.message, "\n");
        return 1;
    }
}

function json(fn) {
    return function(args) {
        print(sprintf("%J\n", fn(...args)));
        return 0;
    };
}

// An action the page started or acknowledged, answered as { success, job_id, message }.
function action_reply(fn) {
    return function(args) {
        let result = fn(...args);
        print(sprintf("%J\n", result));
        return result.success ? 0 : 1;
    };
}

// A Clash API answer as { status, body }, or the reason it could not be had.
function clash(fn) {
    return function(args) {
        try {
            print(sprintf("%J\n", fn(require("singbox.clash_http"), ...args)));
            return 0;
        }
        catch (e) {
            warn(e.message, "\n");
            return 1;
        }
    };
}

function diagnostics() {
    return require("diagnostics.runtime");
}

function text(fn) {
    return function(args) {
        let result = fn(...args);
        if (result == null) {
            warn("Configuration file not found\n");
            return 1;
        }
        print(result);
        return 0;
    };
}

function lifecycle() {
    return require("service.lifecycle");
}

function autostart(enabled) {
    if ((enabled ? lifecycle().enable() : lifecycle().disable()) != 0)
        die(enabled ? "Could not enable autostart" : "Could not disable autostart");
    return {};
}

function initd() {
    return require("service.initd");
}

function ui() {
    return require("service.ui");
}

const COMMANDS = {
    start: { help: "Start Forkop service", run: init_script("start") },
    stop: { help: "Stop Forkop service", run: init_script("stop") },
    reload: { args: 1, help: "Reload Forkop configuration", run: init_script("reload") },
    restart: { help: "Restart Forkop service", run: init_script("restart") },
    enable: { help: "Enable Forkop autostart", run: reply(() => autostart(true)) },
    disable: { help: "Disable Forkop autostart", run: reply(() => autostart(false)) },
    uninstall: { help: "Remove Forkop files installed outside opkg/apk", run: () => lifecycle().uninstall() },
    check_proxy: { help: "Check proxy connectivity", run: () => diagnostics().check_proxy() },
    check_nft_rules: { help: "Check NFT rules status", run: json(() => diagnostics().nft_rules()) },
    check_sing_box: { help: "Check sing-box installation and status", run: json(() => diagnostics().sing_box()) },
    check_inbounds_config: { help: "Check whether enabled server inbounds are configured", run: json(() => diagnostics().inbounds_config()) },
    check_inbounds: { help: "Check server inbounds from the VPN server tab", run: json(() => diagnostics().inbounds()) },
    check_logs: { help: "Show Forkop logs from system journal", run: () => {
        print(diagnostics().logs());
        return 0;
    } },
    check_fakeip: { help: "Test sing-box FakeIP DNS", run: json(() => diagnostics().fakeip()) },
    check_dns_available: { help: "Check DNS server availability", run: json(() => diagnostics().dns()) },
    global_check: { args: 2, help: "Run global system check", run: (args) => diagnostics().global_check(args[0], args[1]) },
    clash_http: { args: 3, usage: "<method> <path> [body]", help: "Allowlisted Clash API transport fallback", run: clash((api, method, path, body) => api.request(method, path, body)) },
    clash_summary: { help: "Summarize the Clash API state in JSON format", run: clash((api) => api.summary()) },
    show_config: { args: 1, help: "Display current Forkop configuration", run: text((visibility) => diagnostics().show_config(visibility || "masked")) },
    show_version: { help: "Show Forkop version", run: () => { print(constants.FORKOP_VERSION, "\n"); return 0; } },
    show_sing_box_config: { args: 1, help: "Show sing-box configuration", run: text((visibility) => diagnostics().show_sing_box_config(visibility || "masked")) },
    get_status: { help: "Get Forkop service status", run: json(() => diagnostics().status()) },
    get_system_info: { help: "Get system information in JSON format", run: json(() => diagnostics().system_info()) },
    get_subscription_default_headers: { help: "Get default subscription request headers in JSON format", run: json(() => ui().default_headers()) },
    get_ui_state: { help: "Get lightweight UI service/action state in JSON format", run: json(() => ui().current_state()) },
    get_core_features: { help: "Get what the installed sing-box can do, from the tags it was built with, in JSON format", run: json(() => require("singbox.features").report()) },
    get_section_rule_sets: { help: "Map each section to its rule-set tags in JSON format", run: json(() => require("singbox.rulesets").section_tag_map()) },
    service_action_async: { args: 1, usage: "<action>", help: "Start a service action in the background", run: action_reply((action) => ui().start_action(action)) },
    ui_action_ack: { args: 2, usage: "<kind> <job>", help: "Acknowledge a finished UI action state", run: action_reply((kind, job) => ui().acknowledge(kind, job)) },
    generate_reality_keypair: { help: "Generate a sing-box Reality key pair in JSON format", run: reply(() => require("server.service").reality_keypair()) },
    generate_server_certificate: { args: 2, usage: "<subject> <name>", help: "Generate a self-signed TLS key pair in JSON format", run: reply((subject, name) => require("server.service").issue_certificate(subject, name)) },
    generate_ssh_host_key: { args: 1, usage: "<name>", help: "Generate a persistent SSH host key in JSON format", run: reply((name) => require("server.service").issue_ssh_host_key(name)) },
    generate_warp_profile: { help: "Generate a Cloudflare WARP profile in JSON format", run: warp_profile },
    get_tls_certificate_sha256: { args: 1, usage: "<server>", help: "Get a server TLS certificate SHA-256 fingerprint in JSON format", run: reply((name) => require("server.service").certificate_sha256(name)) },
    component_action: { args: 2, usage: "<component> <action>", help: "Manage the Forkop and sing-box components", run: program("components/action.uc", "component-action") },
    component_action_async: { args: 2, usage: "<component> <action>", help: "Start a component action in the background", run: program("components/updates.uc", "component-action-async") },
    component_action_status: { args: 1, usage: "<job>", help: "Get background component action status", run: program("components/updates.uc", "component-action-status") },
    component_updates_if_due: { help: "Check installed components for updates when due", run: program("components/updates.uc", "component-updates-if-due") },
    component_update_check_cache: { help: "Get cached component update check results", run: program("components/updates.uc", "component-update-check-cache") },
    package_prerm: { args: 1, run: (args) => require("service.package").prerm(args[0]) },
    package_postinst: { run: () => require("service.package").postinst() },
    luci_postinst: { run: () => require("service.package").luci_postinst() },
    luci_prerm: { run: () => require("service.package").luci_prerm() },
    sing_box_crash_cleanup: { args: 1, run: (args) => lifecycle().crash_cleanup(args[0]) },
    sing_box_crash_pause: { run: () => lifecycle().crash_pause() },
    sing_box_crash_resume: { run: () => lifecycle().crash_resume() },
    service_action_worker: { args: 3, run: (args) => { ui().worker(args[0], args[1], args[2]); return 0; } },
    initd_start: { args: 1, run: (args) => initd().start(args[0]) },
    initd_stop: { run: () => initd().stop() },
    initd_restart: { run: () => initd().restart() },
    initd_reload: { args: 1, run: (args) => {
        let result = initd().reload(args[0]);
        if (result.sync)
            print("sync\n");
        return result.status;
    } },
    initd_status: { run: () => initd().status() },
    initd_triggers: { run: () => { print(initd().triggers()); return 0; } },
    initd_wan_up: { run: () => initd().wan_up() },
    initd_retry_start: { run: () => initd().retry_start() },
    sing_box_watch: { run: () => require("service.singbox_watch").monitor() },
    sync_rule_sets: { run: () => require("nft.ruleset_sync").worker() }
};

function help() {
    print("Usage: ", constants.FORKOP_BIN, " COMMAND\n\nAvailable commands:\n");
    for (let name, command in COMMANDS) {
        if (command.help == null)
            continue;
        let usage = command.usage == null ? name : name + " " + command.usage;
        print(length(usage) < 28 ? sprintf("    %-28s%s\n", usage, command.help) : sprintf("    %s\n    %28s%s\n", usage, "", command.help));
    }
}

function main(argv, lib) {
    library.set_dir(lib);
    let command = COMMANDS[argv[0] ?? ""];
    if (command == null) {
        help();
        return 1;
    }

    let args = [];
    for (let i = 1; i <= (command.args ?? 0); i++)
        push(args, argv[i] ?? "");
    return command.run(args) ?? 0;
}

return { main, COMMANDS };
