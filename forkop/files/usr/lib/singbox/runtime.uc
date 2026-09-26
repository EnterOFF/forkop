// The sing-box service as Forkop runs it: its procd settings, the configuration
// file generated for it, and what the core says about itself.

let fs = require("fs");
let common = require("core.common");
let exec = require("core.exec");
let uci = require("core.uci");
let singbox_constants = require("singbox.constants");
let packages = require("core.packages");
let connections = require("config.connections");
let generator = require("singbox.generator");

const CONFIG_NAME = "forkop";

function settings() {
    return uci.get_all(CONFIG_NAME, "settings") ?? {};
}

function set_service_option(key, value, message) {
    if (trim(uci.get("sing-box.main." + key)) == value)
        return false;
    if (!uci.set("sing-box.main." + key, value))
        die("Failed to set sing-box." + key + ". Aborted.");
    exec.log("info", message);
    return true;
}

// Forkop starts sing-box itself, through the core's own init script configured to
// run the generated file as root; the core's autostart would start it without
// the rules around it.
function configure_service() {
    if (!uci.exists("sing-box.main") && !uci.set_section("sing-box.main", "sing-box"))
        die("Failed to create the sing-box service section. Aborted.");

    let config_path = common.option(settings(), "config_path", "");
    let changed = set_service_option("enabled", "1", "sing-box service has been enabled");
    changed = set_service_option("user", "root", "sing-box service user has been changed to root") || changed;
    changed = set_service_option("conffile", config_path, "sing-box service config path set to " + config_path) || changed;
    if (changed && !uci.commit("sing-box"))
        die("Failed to commit the sing-box service settings. Aborted.");

    if (fs.stat("/etc/rc.d/S99sing-box") != null) {
        exec.log("info", "Disabling standalone sing-box autostart");
        exec.ok([ "/etc/init.d/sing-box", "disable" ]);
    }
}

// The mixed inbound a download goes through when a section is chosen for it; the
// component downloads have the port after the list downloads.
function proxy_address(purpose) {
    if (connections.download_via_proxy_section(settings(), purpose) == "")
        return "";
    let port = purpose == "components" ? singbox_constants.COMPONENTS_MIXED_INBOUND_PORT : singbox_constants.SERVICE_MIXED_INBOUND_PORT;
    return singbox_constants.SERVICE_MIXED_INBOUND_ADDRESS + ":" + port;
}

function interface_ipv4_address(name) {
    let status = common.parse_json(exec.output([ "ubus", "call", "network.interface." + name, "status" ]));
    return common.as_string(status?.["ipv4-address"]?.[0]?.address);
}

function device_ipv4_address(device) {
    let matched = match(exec.output([ "ip", "-4", "addr", "show", "dev", device ]) ?? "", /inet[ \t]+([0-9.]+)\//);
    return matched ? matched[1] : "";
}

// The address the service inbounds listen on: the one configured, else the LAN's.
function listen_address(values) {
    values ??= settings();
    let configured = common.option(values, "service_listen_address", "");
    if (configured != "") {
        exec.log("warn", "service_listen_address is set manually; automatic listen-address detection is skipped");
        return configured;
    }

    let address = interface_ipv4_address("lan");
    for (let name in common.words(common.option(values, "source_network_interfaces", "br-lan"))) {
        if (address != "")
            break;
        address = interface_ipv4_address(name) || device_ipv4_address(name);
    }
    if (address == "")
        exec.log("error", "Failed to determine the listening IP address. Please open an issue to report this problem: https://github.com/ushan0v/forkop/issues");
    return address;
}

// mwan3 owns egress routing while it has an enabled interface and is running or
// set to start, and sing-box must then leave the interface choice to it.
function mwan3_active() {
    if (((fs.stat("/etc/init.d/mwan3")?.mode ?? 0) & 0111) == 0 || (fs.stat("/etc/config/mwan3")?.size ?? 0) == 0)
        return false;
    if (length(filter(uci.section_objects("mwan3", "interface"), (s) => common.option(s, "enabled", "0") == "1")) == 0)
        return false;
    return exec.ok([ "/etc/init.d/mwan3", "status" ]) || exec.ok([ "/etc/init.d/mwan3", "enabled" ]);
}

function check(text) {
    let now = clock();
    let path = sprintf("/tmp/forkop-sing-box-check.%d.%d.json", now[0], now[1]);
    if (!common.write_file(path, text))
        die("Failed to write the generated sing-box configuration. Aborted.");
    let result = exec.combined([ "sing-box", "-c", path, "check" ]);
    fs.unlink(path);
    if (result.status == 0)
        return;
    let reason = filter(split(result.output, "\n"), (line) => trim(line) != "")[0] ?? "exit status " + result.status;
    die("Generated sing-box configuration is invalid: " + reason + ". Aborted.");
}

// Generates the configuration and writes it where the service reads it. Returns
// whether the file changed. The check needs the core stopped: a running one
// holds the cache file the check opens.
function write_config(checked) {
    let values = settings();
    let path = common.option(values, "config_path", "");
    if (path == "")
        die("sing-box config path is empty. Aborted.");

    // sing-box refuses to start without the directory of its cache file, and a
    // reboot empties /tmp while the configuration stays as it was.
    if (!common.ensure_dir(common.parent_dir(common.option(values, "cache_path", singbox_constants.TMP_SING_BOX_FOLDER + "/cache.db"))))
        die("Failed to create the directory of the sing-box cache file. Aborted.");

    let mwan3 = mwan3_active();
    let output_interface = common.option(values, "output_network_interface", "");
    if (mwan3 && output_interface != "")
        exec.log("warn", "mwan3 is active and Output Network Interface is set to '" + output_interface + "'; sing-box egress is pinned to this interface");
    else if (mwan3)
        exec.log("warn", "mwan3 is active; disabling sing-box auto_detect_interface so mwan3 can control egress routing");

    let text;
    try {
        text = sprintf("%J\n", generator.build({ service_address: listen_address(values), mwan3_active: mwan3 }));
    }
    catch (e) {
        die("Failed to generate sing-box configuration: " + e.message);
    }
    if (checked)
        check(text);

    if (fs.readfile(path) == text) {
        exec.log("info", "sing-box configuration is unchanged");
        return false;
    }
    exec.log("info", "sing-box configuration changed; updating " + path);
    if (!common.write_file_atomic(path, text))
        die("Failed to write the generated sing-box configuration. Aborted.");
    return true;
}

function version() {
    for (let name in [ "sing-box-forkop-compressed", "sing-box-forkop" ]) {
        let value = packages.version(name);
        if (value != "")
            return replace(value, /~/g, "-");
    }
    return replace(trim(fs.readfile(packages.paths.sing_box_version) ?? ""), /~/g, "-");
}

function process_running() {
    return exec.ok([ "pgrep", "-x", "sing-box" ]) || exec.ok([ "pgrep", "-f", "^/usr/bin/sing-box[[:space:]]" ]);
}

function warp_profile() {
    let profile = common.parse_json(exec.output([ "sing-box", "generate", "warp-profile", "--json" ]));
    let result = { id: profile?.id, auth_token: profile?.auth_token, private_key: profile?.private_key };
    for (let key, value in result)
        if (type(value) != "string" || value == "") {
            exec.log("error", "Failed to generate WARP profile.");
            die("Failed to generate WARP profile.");
        }
    return result;
}

let exports = {
    configure_service, write_config, proxy_address, listen_address, device_ipv4_address,
    mwan3_active, version, process_running, warp_profile
};

// A caller frame, or no arguments at all, means the module was required.
if (sourcepath(1) != null || ARGV[0] == null)
    return exports;

// The component manager asks for its download proxy as a program.
let mode = ARGV[0];
if (mode != "service-proxy-address") {
    warn("Usage: singbox/runtime.uc service-proxy-address <lists|components>\n");
    exit(1);
}
print(proxy_address(ARGV[1] ?? "lists"), "\n");
