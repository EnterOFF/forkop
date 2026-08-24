#!/usr/bin/env ucode

let fs = require("fs");
let uci_core = require("core.uci");
let bytecode = require("core.bytecode");

function as_string(value) {
    return value == null ? "" : "" + value;
}

function env(name, fallback) {
    let value = getenv(name);
    return value == null ? as_string(fallback) : as_string(value);
}

const CONFIG_NAME = env("FORKOP_CONFIG_NAME", "forkop");
const RT_TABLES_PATH = env("FORKOP_RT_TABLES", "/etc/iproute2/rt_tables");
const BIN_PATH = env("FORKOP_BIN", "/usr/bin/forkop");
const INIT_PATH = env("FORKOP_INIT", "/etc/init.d/forkop");
const STATE_SERVICE_INIT = env("FORKOP_STATE_SERVICE_INIT", "/etc/init.d/forkop-state");
const PACKAGE_UPGRADE_STATE = env("FORKOP_PACKAGE_UPGRADE_STATE", "/tmp/forkop-package-was-running");
const FIREWALL_INIT = env("FORKOP_FIREWALL_INIT", "/etc/init.d/firewall");
const FIREWALL_INPUT_INCLUDE = env("FORKOP_FIREWALL_INPUT_INCLUDE", "/usr/share/nftables.d/chain-pre/input/forkop.nft");
const FIREWALL_INPUT_MARKER = "forkop: TPROXY traffic";
const PACKAGE_TEST_MODE = env("FORKOP_PACKAGE_TEST_MODE", "") != "";

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function command_from_args(args) {
    let parts = [];
    for (let arg in args)
        push(parts, shell_quote(arg));
    return join(" ", parts);
}

function command_success_from_args(args) {
    return system(command_from_args(args) + " >/dev/null 2>&1") == 0;
}

function path_exists(path) {
    return fs.stat(as_string(path)) != null;
}

function unlink_if_exists(path) {
    if (path_exists(path))
        fs.unlink(as_string(path));
}

function command_output(command) {
    let proc = fs.popen(as_string(command) + " 2>/dev/null", "r");
    if (proc == null)
        return null;

    let data = proc.read("all");
    proc.close();
    return data == null ? "" : data;
}

// fw4 reads /usr/share/nftables.d only while it builds its ruleset, so the
// input accept the package ships stays out of the running firewall until
// something reloads it. A firewall that is not loaded picks the file up on its
// own next start.
function reload_firewall_input_include() {
    if (!path_exists(FIREWALL_INPUT_INCLUDE) || !path_exists(FIREWALL_INIT))
        return true;

    let input_chain = command_output("nft list chain inet fw4 input");
    if (input_chain == null || trim(input_chain) == "")
        return true;

    if (index(input_chain, FIREWALL_INPUT_MARKER) >= 0)
        return true;

    if (command_success_from_args([ FIREWALL_INIT, "reload" ]))
        return true;

    command_success_from_args([ "logger", "-t", "forkop",
        "[warning] Failed to reload the firewall. Reload it manually so Forkop traffic is accepted in the input chain" ]);
    return false;
}

function remove_rt_tables_entry() {
    let data = fs.readfile(RT_TABLES_PATH);
    if (data == null)
        return true;

    let changed = false;
    let lines = [];
    for (let line in split(data, "\n")) {
        if (index(line, "105 forkop") >= 0) {
            changed = true;
            continue;
        }
        push(lines, line);
    }

    return !changed || fs.writefile(RT_TABLES_PATH, join("\n", lines)) != null;
}

function truthy(value) {
    value = lc(trim(as_string(value)));
    return value == "1" || value == "true" || value == "yes" || value == "on";
}

function dont_touch_dhcp_enabled() {
    return truthy(uci_core.get(CONFIG_NAME + ".settings.dont_touch_dhcp"));
}

function restore_dnsmasq_if_needed() {
    if (dont_touch_dhcp_enabled())
        return;

    command_success_from_args([ BIN_PATH, "restore_dnsmasq" ]);
}

function remember_upgrade_state(action) {
    if (as_string(action) != "upgrade") {
        unlink_if_exists(PACKAGE_UPGRADE_STATE);
        return;
    }

    if (command_success_from_args([ INIT_PATH, "status" ]))
        fs.writefile(PACKAGE_UPGRADE_STATE, "1\n");
}

function prerm_cleanup(action) {
    if (env("IPKG_INSTROOT", "") != "")
        return true;

    remember_upgrade_state(action);
    if (!PACKAGE_TEST_MODE) {
        // While /etc/rc.d/S99forkop exists, a WAN-up trigger can restart the
        // service in the middle of the removal, so autostart goes first. An
        // upgrade keeps it: the service is enabled again only by its own
        // rc.d symlink, which postinst does not recreate.
        if (as_string(action) != "upgrade") {
            command_success_from_args([ INIT_PATH, "disable" ]);
            if (path_exists(STATE_SERVICE_INIT)) {
                command_success_from_args([ STATE_SERVICE_INIT, "disable" ]);
                command_success_from_args([ STATE_SERVICE_INIT, "stop" ]);
            }
        }
        command_success_from_args([ INIT_PATH, "stop" ]);
        restore_dnsmasq_if_needed();
    }
    bytecode.invalidate_validation_stamp();
    return remove_rt_tables_entry();
}

function postinst_restore() {
    if (env("IPKG_INSTROOT", "") != "" || !path_exists(PACKAGE_UPGRADE_STATE))
        return true;

    if (!command_success_from_args([ INIT_PATH, "start" ]))
        return false;

    unlink_if_exists(PACKAGE_UPGRADE_STATE);
    return true;
}

// The firewall include is what lets an isolated zone reach the TPROXY inbound,
// so it goes in before a service that was running is brought back up. Its
// failure is reported but does not fail the installation.
// The state service answers what Forkop is doing, so it runs whether or not
// Forkop does, and it holds the library in memory - an upgrade has to hand it
// the new one rather than leave it serving the old.
function restart_state_service() {
    if (PACKAGE_TEST_MODE || env("IPKG_INSTROOT", "") != "")
        return true;
    if (!path_exists(STATE_SERVICE_INIT))
        return true;

    command_success_from_args([ STATE_SERVICE_INIT, "enable" ]);
    return command_success_from_args([ STATE_SERVICE_INIT, "restart" ]);
}

// Files earlier versions kept answers in. They are worked out on demand now, so
// an upgraded install should not be left with them sitting in /var/run looking
// like they still mean something.
const OBSOLETE_STATE_FILES = [
    "/var/run/forkop/system-info.json",
    "/tmp/forkop/system-info.json",
    "/var/run/forkop/component-update-check.timestamp"
];

const OBSOLETE_STATE_DIRS = [
    "/var/run/forkop/component-update-checks"
];

function remove_obsolete_state_files() {
    for (let path in OBSOLETE_STATE_FILES)
        unlink_if_exists(path);
    for (let path in OBSOLETE_STATE_DIRS) {
        for (let entry in fs.glob(path + "/*"))
            unlink_if_exists(entry);
        try {
            fs.rmdir(path);
        }
        catch (e) {
        }
    }
    return true;
}

function postinst() {
    bytecode.invalidate_validation_stamp();
    remove_obsolete_state_files();
    restart_state_service();
    reload_firewall_input_include();
    return postinst_restore();
}

function luci_cache_globs() {
    let configured = env("FORKOP_LUCI_CACHE_GLOBS", "");
    if (configured != "")
        return split(configured, /[ \t\r\n]+/);

    return [ "/var/luci-indexcache*", "/tmp/luci-indexcache*" ];
}

function remove_luci_index_cache() {
    for (let pattern in luci_cache_globs()) {
        pattern = as_string(pattern);
        if (pattern == "")
            continue;

        for (let path in fs.glob(pattern))
            unlink_if_exists(path);
    }
}

// Removing the page removes the reason for the service.
function luci_prerm() {
    if (PACKAGE_TEST_MODE || env("IPKG_INSTROOT", "") != "")
        return true;
    if (!path_exists(STATE_SERVICE_INIT))
        return true;

    command_success_from_args([ STATE_SERVICE_INIT, "stop" ]);
    return true;
}

function luci_postinst() {
    remove_luci_index_cache();
    // The state service only runs where there is a page to serve, so installing
    // that page is what starts it.
    restart_state_service();
    if (!PACKAGE_TEST_MODE) {
        if (path_exists("/etc/init.d/rpcd"))
            command_success_from_args([ "/etc/init.d/rpcd", "reload" ]);
        command_success_from_args([ "logger", "-t", "forkop", "[info] Package defaults applied" ]);
    }
    return true;
}

let mode = ARGV[0] || "";

if (mode == "prerm")
    exit(prerm_cleanup(ARGV[1]) ? 0 : 1);
else if (mode == "postinst")
    exit(postinst() ? 0 : 1);
else if (mode == "remove-rt-tables-entry")
    exit(remove_rt_tables_entry() ? 0 : 1);
else if (mode == "luci-prerm")
    exit(luci_prerm() ? 0 : 1);
else if (mode == "luci-postinst")
    exit(luci_postinst() ? 0 : 1);
else {
    warn("Usage: service/package.uc <prerm|postinst|remove-rt-tables-entry|luci-postinst>\n");
    exit(1);
}
