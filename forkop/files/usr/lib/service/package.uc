// What the package scripts run on a live router: the backend's prerm and
// postinst and the LuCI app's. The scripts skip an image build themselves.

let fs = require("fs");
let exec = require("core.exec");
let constants = require("core.constants");
let bytecode = require("core.bytecode");

const FIREWALL_INPUT_MARKER = "forkop: TPROXY traffic";

let paths = {
    init: constants.FORKOP_SERVICE_INIT,
    state_service_init: "/etc/init.d/forkop-state",
    was_running: "/tmp/forkop-package-was-running",
    firewall_init: "/etc/init.d/firewall",
    firewall_input_include: "/usr/share/nftables.d/chain-pre/input/forkop.nft",
    rpcd_init: "/etc/init.d/rpcd",
    luci_index_cache: [ "/var/luci-indexcache*", "/tmp/luci-indexcache*" ],
    // What releases up to 1.0.5 left behind: answers kept in files that are
    // worked out on demand now, and the module and state directories of retired
    // features, which the package manager empties of its own files and leaves.
    obsolete: [
        "/var/run/forkop/system-info.json",
        "/tmp/forkop/system-info.json",
        "/var/run/forkop/component-update-check.timestamp",
        "/var/run/forkop/component-update-checks",
        "/var/run/forkop/zapret",
        "/var/run/forkop/zapret2",
        "/var/run/forkop/byedpi",
        "/var/run/forkop/zapret-runtime",
        "/usr/lib/forkop/dns",
        "/usr/lib/forkop/providers",
        "/usr/lib/forkop/routing",
        "/usr/lib/forkop/subscription"
    ]
};

function exists(path) {
    return fs.stat(path) != null;
}

function remove(path) {
    if (exists(path))
        exec.status([ "rm", "-rf", path ]);
}

// fw4 reads /usr/share/nftables.d only while it builds its ruleset, so the
// input accept the package ships stays out of a running firewall until
// something reloads it. A firewall that is not loaded picks it up when it starts.
function load_firewall_input_include() {
    if (!exists(paths.firewall_input_include) || !exists(paths.firewall_init))
        return;
    let chain = exec.output([ "nft", "list", "chain", "inet", "fw4", "input" ]);
    if (chain == null || trim(chain) == "" || index(chain, FIREWALL_INPUT_MARKER) >= 0)
        return;
    if (!exec.ok([ paths.firewall_init, "reload" ]))
        exec.log("warning", "Failed to reload the firewall. Reload it manually so Forkop traffic is accepted in the input chain");
}

// The state service holds the library in memory, so an install hands it the
// new one. Its init script registers nothing where the LuCI page is missing.
function restart_state_service() {
    if (!exists(paths.state_service_init))
        return;
    exec.ok([ paths.state_service_init, "enable" ]);
    exec.ok([ paths.state_service_init, "restart" ]);
}

// An upgrade stops the service and postinst starts it again if it was running.
// A removal takes autostart away first: while /etc/rc.d/S99forkop exists, a
// WAN-up trigger can start the service in the middle of the removal. The
// routing table name goes last, after the stop that needs it.
function prerm(action) {
    let upgrade = action == "upgrade";
    fs.unlink(paths.was_running);
    if (upgrade && exec.ok([ paths.init, "status" ]))
        fs.writefile(paths.was_running, "1\n");
    if (!upgrade) {
        exec.ok([ paths.init, "disable" ]);
        if (exists(paths.state_service_init)) {
            exec.ok([ paths.state_service_init, "disable" ]);
            exec.ok([ paths.state_service_init, "stop" ]);
        }
    }
    exec.ok([ paths.init, "stop" ]);
    bytecode.invalidate_validation_stamp();
    if (!upgrade && !require("nft.apply").remove_rt_table_entry())
        return 1;
    return 0;
}

// The firewall include is what lets an isolated zone reach the TPROXY inbound,
// so it is loaded before a service that was running comes back.
function postinst() {
    bytecode.invalidate_validation_stamp();
    for (let path in paths.obsolete)
        remove(path);
    restart_state_service();
    load_firewall_input_include();
    if (!exists(paths.was_running))
        return 0;
    if (!exec.ok([ paths.init, "start" ]))
        return 1;
    fs.unlink(paths.was_running);
    return 0;
}

// Installing the page is what starts the state service, and removing it stops it.
function luci_postinst() {
    for (let pattern in paths.luci_index_cache)
        for (let path in fs.glob(pattern))
            fs.unlink(path);
    restart_state_service();
    if (exists(paths.rpcd_init))
        exec.ok([ paths.rpcd_init, "reload" ]);
    exec.log("info", "Package defaults applied");
    return 0;
}

function luci_prerm() {
    if (exists(paths.state_service_init))
        exec.ok([ paths.state_service_init, "stop" ]);
    return 0;
}

return { paths, prerm, postinst, luci_postinst, luci_prerm };
