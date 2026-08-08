#!/usr/bin/env ucode

let fs = require("fs");
let uci_core = require("core.uci");
let common = require("core.common");

const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || "forkop";
const LIB_DIR = getenv("FORKOP_LIB") || "/usr/lib/forkop";
const SING_BOX_FORKOP_VERSION_FILE = getenv("SING_BOX_FORKOP_VERSION_FILE") || "/usr/share/sing-box-forkop/version";
const PACKAGES_UC = LIB_DIR + "/core/packages.uc";
const NFT_TABLE_NAME = getenv("NFT_TABLE_NAME") || "ForkopTable";
const NFT_COMMON_SET_NAME = getenv("NFT_COMMON_SET_NAME") || "forkop_subnets";
const NFT_COMMON6_SET_NAME = getenv("NFT_COMMON6_SET_NAME") || "forkop_subnets6";
const NFT_PORT_SET_NAME = getenv("NFT_PORT_SET_NAME") || "forkop_ports";
const NFT_IP_PORT_SET_NAME = getenv("NFT_IP_PORT_SET_NAME") || "forkop_ip_ports";
const NFT_IP_PORT6_SET_NAME = getenv("NFT_IP_PORT6_SET_NAME") || "forkop_ip6_ports";
const NFT_INTERFACE_SET_NAME = getenv("NFT_INTERFACE_SET_NAME") || "forkop_interfaces";
const NFT_LOCALV4_SET_NAME = getenv("NFT_LOCALV4_SET_NAME") || "localv4";
const NFT_LOCALV6_SET_NAME = getenv("NFT_LOCALV6_SET_NAME") || "localv6";
const NFT_FAKEIP_MARK = getenv("NFT_FAKEIP_MARK") || "0x04000000";
const SB_SERVICE_MIXED_INBOUND_ADDRESS = getenv("SB_SERVICE_MIXED_INBOUND_ADDRESS") || "127.0.0.1";
const SB_SERVICE_MIXED_INBOUND_PORT = getenv("SB_SERVICE_MIXED_INBOUND_PORT") || "4534";
const SING_BOX_BIN = getenv("FORKOP_SING_BOX_BIN") || "/usr/bin/sing-box";

function as_string(value) {
    return value == null ? "" : "" + value;
}

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function command_from_args(args) {
    let parts = [];
    for (let arg in args)
        push(parts, shell_quote(arg));
    return join(" ", parts);
}

function command_output(command) {
    let pipe = fs.popen(command, "r");
    if (!pipe)
        return "";

    let data = pipe.read("all");
    let status = pipe.close();
    if (status != 0 || data == null)
        return "";
    return as_string(data);
}

function command_output_from_args(args) {
    return command_output(command_from_args(args));
}

function command_status(command) {
    let status = int(system(command));
    return status > 255 ? int(status / 256) : status;
}

function command_success_from_args(args) {
    return system(command_from_args(args) + " >/dev/null 2>&1") == 0;
}

function remove_file(path) {
    try {
        fs.unlink(as_string(path));
    }
    catch (e) {
    }
}

function remove_files(paths) {
    for (let path in paths)
        if (as_string(path) != "")
            remove_file(path);
}

function object_or_empty(value) {
    return type(value) == "object" ? value : {};
}

function array_or_empty(value) {
    return type(value) == "array" ? value : [];
}

function option(section, key, fallback) {
    if (fallback == null)
        fallback = "";

    let value = object_or_empty(section)[key];
    if (value == null)
        return fallback;
    if (type(value) == "array")
        return join(" ", value);
    return as_string(value);
}

function arg_bool(value) {
    value = lc(as_string(value));
    return value == "true" || value == "1" || value == "yes" || value == "on";
}

function bool_option(section, key, fallback) {
    let value = object_or_empty(section)[key];
    return value == null ? !!fallback : arg_bool(value);
}

function whitespace_items(value) {
    let result = [];
    if (type(value) == "array") {
        for (let item in value) {
            item = as_string(item);
            if (item != "")
                push(result, item);
        }
        return result;
    }

    for (let item in split(trim(as_string(value)), /[ \t\r\n]+/))
        if (item != "")
            push(result, item);
    return result;
}

function file_exists(path) {
    return fs.stat(as_string(path)) != null;
}

function parent_dir(path) {
    path = as_string(path);
    let slash = rindex(path, "/");
    return slash >= 0 ? substr(path, 0, slash) : "";
}

function ensure_dir(path) {
    return command_success_from_args([ "mkdir", "-p", path ]);
}

function ensure_parent_dir(path) {
    let dir = parent_dir(path);
    return dir == "" || dir == "." || ensure_dir(dir);
}

function temp_path() {
    return trim(command_output_from_args([ "mktemp" ]));
}

function md5_file(path) {
    let line = trim(command_output_from_args([ "md5sum", as_string(path) ]));
    return length(line) >= 32 ? substr(line, 0, 32) : "";
}

function sing_box_version() {
    for (let package_name in [ "sing-box-forkop-compressed", "sing-box-forkop" ]) {
        let version = trim(command_output_from_args([ "ucode", "-L", LIB_DIR, PACKAGES_UC, "version", package_name ]));
        if (version != "")
            return replace(version, /~/g, "-");
    }
    let marker = fs.readfile(SING_BOX_FORKOP_VERSION_FILE);
    if (marker != null)
        return replace(trim(as_string(marker)), /~/g, "-");
    return "";
}

function module_command(args) {
    let command_args = [ "ucode", "-L", LIB_DIR ];
    for (let arg in args)
        push(command_args, arg);
    return command_from_args(command_args);
}

function module_success(args) {
    return command_status(module_command(args)) == 0;
}

function log_message(message, level) {
    level = as_string(level || "info");
    command_success_from_args([ "logger", "-t", "forkop", "[" + level + "] " + as_string(message) ]);
}

function uci_settings() {
    return object_or_empty(uci_core.get_all(CONFIG_NAME, "settings"));
}

function uci_path(config, section, key) {
    return as_string(config) + "." + as_string(section) + "." + as_string(key);
}

function uci_get_option(config, section, key) {
    return trim(uci_core.get(uci_path(config, section, key)));
}

function ensure_sing_box_main_section() {
    if (uci_core.exists("sing-box.main"))
        return true;
    return uci_core.set_section("sing-box.main", "sing-box");
}

function uci_set_option(config, section, key, value) {
    if (!uci_core.exists(as_string(config) + "." + as_string(section)))
        return false;
    return uci_core.set(uci_path(config, section, key), value);
}

function uci_commit(config) {
    return uci_core.commit(config);
}

function configure_service() {
    let settings = uci_settings();

    if (!ensure_sing_box_main_section())
        exit(1);

    let changed = false;
    if (uci_get_option("sing-box", "main", "enabled") != "1") {
        if (!uci_set_option("sing-box", "main", "enabled", "1"))
            exit(1);
        changed = true;
        log_message("sing-box service has been enabled", "info");
    }

    if (uci_get_option("sing-box", "main", "user") != "root") {
        if (!uci_set_option("sing-box", "main", "user", "root"))
            exit(1);
        changed = true;
        log_message("sing-box service user has been changed to root", "info");
    }

    let config_path = option(settings, "config_path", "");
    let conffile = uci_get_option("sing-box", "main", "conffile");
    if (conffile != config_path) {
        if (!uci_set_option("sing-box", "main", "conffile", config_path))
            exit(1);
        changed = true;
        log_message("sing-box service config path set to " + config_path, "info");
    }

    if (changed && !uci_commit("sing-box"))
        exit(1);

    if (file_exists("/etc/rc.d/S99sing-box")) {
        log_message("Disabling standalone sing-box autostart", "info");
        command_success_from_args([ "/etc/init.d/sing-box", "disable" ]);
    }
}

function download_via_proxy_option_for_purpose(purpose) {
    purpose = as_string(purpose || "lists");
    if (purpose == "lists")
        return "download_lists_via_proxy";
    if (purpose == "components")
        return "download_components_via_proxy";
    return "";
}

function download_via_proxy_section_option_for_purpose(purpose) {
    purpose = as_string(purpose || "lists");
    if (purpose == "lists")
        return "download_lists_via_proxy_section";
    if (purpose == "components")
        return "download_components_via_proxy_section";
    return "";
}

function download_via_proxy_section(settings, purpose) {
    let enabled_option = download_via_proxy_option_for_purpose(purpose);
    if (enabled_option == "" || !bool_option(settings, enabled_option, false))
        return "";

    let section_option = download_via_proxy_section_option_for_purpose(purpose);
    let configured = section_option != "" ? option(settings, section_option, "") : "";
    if (configured != "")
        return configured;

    return option(settings, "download_lists_via_proxy_section", "");
}

function service_proxy_port_for_purpose(purpose) {
    return int(SB_SERVICE_MIXED_INBOUND_PORT) + (as_string(purpose || "lists") == "components" ? 1 : 0);
}

function service_proxy_address(settings, purpose) {
    return download_via_proxy_section(settings, purpose) != "" ?
        SB_SERVICE_MIXED_INBOUND_ADDRESS + ":" + service_proxy_port_for_purpose(purpose) : "";
}

function ip_addr_first_inet4(data) {
    for (let line in split(as_string(data), "\n")) {
        let matched = match(line, /inet[ \t]+([0-9.]+)\//);
        if (matched)
            return as_string(matched[1]);
    }
    return "";
}

function network_interface_ipv4(name) {
    let data = command_output_from_args([ "ubus", "call", "network.interface." + as_string(name), "status" ]);
    try {
        let value = json(data);
        let addresses = array_or_empty(object_or_empty(value)["ipv4-address"]);
        if (length(addresses) > 0)
            return as_string(object_or_empty(addresses[0]).address);
    }
    catch (e) {
    }
    return "";
}

function device_ipv4_address_value(device) {
    return ip_addr_first_inet4(command_output_from_args([ "ip", "-4", "addr", "show", "dev", as_string(device) ]));
}

function service_listen_address_value(settings) {
    let configured = option(settings, "service_listen_address", "");
    if (configured != "") {
        log_message("service_listen_address is set manually; automatic listen-address detection is skipped", "warn");
        return configured;
    }

    let address = network_interface_ipv4("lan");
    if (address != "")
        return address;

    for (let iface in whitespace_items(option(settings, "source_network_interfaces", "br-lan"))) {
        address = network_interface_ipv4(iface);
        if (address != "")
            return address;
        address = device_ipv4_address_value(iface);
        if (address != "")
            return address;
    }

    log_message("Failed to determine the listening IP address. Please open an issue to report this problem: https://github.com/ushan0v/forkop/issues", "error");
    return "";
}

function log_lines(text, level, prefix) {
    for (let line in split(as_string(text), "\n"))
        if (trim(as_string(line)) != "")
            log_message(as_string(prefix) + as_string(line), level);
}

function first_nonblank_line(path) {
    let data = as_string(fs.readfile(path) || "");
    for (let line in split(data, "\n"))
        if (trim(as_string(line)) != "")
            return as_string(line);
    return "";
}

function last_nonblank_line_value(value) {
    let result = "";
    for (let line in split(as_string(value), "\n"))
        if (trim(as_string(line)) != "")
            result = as_string(line);
    return result;
}

function last_nonblank_line(path) {
    return last_nonblank_line_value(fs.readfile(path) || "");
}

function generator_failure_reason(path, status) {
    let reason = last_nonblank_line(path);
    return reason != "" ? reason : "exit status " + status;
}

function log_file_lines(path, level, prefix) {
    log_lines(fs.readfile(path), level, prefix);
}

function sing_box_check(config_path, output_path) {
    let status = command_status(
        command_from_args([ "sing-box", "-c", config_path, "check" ]) +
        " >" + shell_quote(output_path) + " 2>&1"
    );
    let reason = status == 0 ? "" : first_nonblank_line(output_path);
    if (status != 0 && reason == "")
        reason = "exit status " + status;
    return { status, reason };
}

function sing_box_process_running() {
    return command_success_from_args([ "pgrep", "-x", "sing-box" ]) ||
        command_success_from_args([ "pgrep", "-f", "^/usr/bin/sing-box[[:space:]]" ]);
}

function generate_warp_profile() {
	let output = command_output(
		command_from_args([ SING_BOX_BIN, "generate", "warp-profile", "--json" ]) +
		" 2>/dev/null"
	);
    let profile = null;
    try {
        profile = json(output);
    }
    catch (e) {
    }

    let id = as_string(object_or_empty(profile).id);
    let auth_token = as_string(object_or_empty(profile).auth_token);
    let private_key = as_string(object_or_empty(profile).private_key);
    if (id == "" || auth_token == "" || private_key == "") {
        log_message("Failed to generate WARP profile.", "error");
        warn("Failed to generate WARP profile.\n");
        exit(1);
    }

    print(sprintf("%J", {
        id: id,
        auth_token: auth_token,
        private_key: private_key
    }), "\n");
}

function save_config_file(temp_file_path, config_path) {
    let current_hash = md5_file(config_path);
    let temp_hash = md5_file(temp_file_path);

    if (current_hash != temp_hash) {
        log_message("sing-box configuration changed; updating " + config_path, "info");
        if (!ensure_parent_dir(config_path))
            return false;
        return command_success_from_args([ "mv", "-f", temp_file_path, config_path ]);
    }

    log_message("sing-box configuration is unchanged", "info");
    remove_file(temp_file_path);
    return true;
}

function init_config(populate_nft, skip_check) {
    let settings = uci_settings();
    let config_path = option(settings, "config_path", "");
    if (config_path == "") {
        log_message("sing-box config path is empty. Aborted.", "fatal");
        exit(1);
    }

    let mwan3_active = module_success([ LIB_DIR + "/config/validator.uc", "mwan3-is-active" ]);
    let output_interface = option(settings, "output_network_interface", "");
    if (mwan3_active && output_interface != "")
        log_message("mwan3 is active and Output Network Interface is set to '" + output_interface + "'; sing-box egress is pinned to this interface", "warn");
    else if (mwan3_active)
        log_message("mwan3 is active; disabling sing-box auto_detect_interface so mwan3 can control egress routing", "warn");

    let temp_config = temp_path();
    let runtime_log = temp_path();
    if (temp_config == "" || runtime_log == "") {
        remove_files([ temp_config, runtime_log ]);
        exit(1);
    }

    let generate_status = command_status(
        module_command([
            LIB_DIR + "/singbox/generator.uc",
            "generate-config",
            temp_config,
            service_listen_address_value(settings),
            mwan3_active ? "1" : "0",
            ""
        ]) + " >" + shell_quote(runtime_log) + " 2>&1"
    );
    if (generate_status != 0) {
        let reason = generator_failure_reason(runtime_log, generate_status);
        log_message("Failed to generate sing-box configuration: " + reason, "fatal");
        remove_files([ temp_config, runtime_log ]);
        exit(1);
    }
    log_file_lines(runtime_log, "warn", "sing-box config generator: ");

    let config_unchanged = md5_file(temp_config) == md5_file(config_path);
    let live_core = sing_box_process_running();
    if (!arg_bool(skip_check) && !(live_core && config_unchanged)) {
        if (live_core) {
            log_message("Refusing a standalone sing-box config check while the core is running; use Forkop reload", "error");
            remove_files([ temp_config, runtime_log ]);
            exit(1);
        }
        let check_result = sing_box_check(temp_config, runtime_log);
        if (check_result.status != 0) {
            log_message("Generated sing-box configuration is invalid: " + check_result.reason + ". Aborted.", "fatal");
            remove_files([ temp_config, runtime_log ]);
            exit(1);
        }
    }

    if (populate_nft && !module_success([
        LIB_DIR + "/nft/apply.uc",
        "nft-populate-runtime-sets-from-uci",
        "1",
        "",
        NFT_TABLE_NAME,
        NFT_COMMON_SET_NAME,
        NFT_PORT_SET_NAME,
        NFT_IP_PORT_SET_NAME,
        NFT_INTERFACE_SET_NAME,
        NFT_LOCALV4_SET_NAME,
        NFT_FAKEIP_MARK,
        NFT_COMMON6_SET_NAME,
        NFT_IP_PORT6_SET_NAME,
        NFT_LOCALV6_SET_NAME
    ])) {
        log_message("Failed to update nftables runtime sets from the generated sing-box configuration. Aborted.", "fatal");
        remove_files([ temp_config, runtime_log ]);
        exit(1);
    }

    if (!save_config_file(temp_config, config_path)) {
        remove_file(runtime_log);
        exit(1);
    }
    remove_file(runtime_log);
    print("\n");
}

let mode = ARGV[0] || "";

if (mode == "configure-service")
    configure_service();
else if (mode == "init-config")
    init_config(arg_bool(ARGV[1] || "1"), arg_bool(ARGV[2] || "0"));
else if (mode == "save-config-file-fixture")
    exit(save_config_file(ARGV[1] || "", ARGV[2] || "") ? 0 : 1);
else if (mode == "check-config-fixture") {
    let result = sing_box_check(ARGV[1] || "", ARGV[2] || "");
    if (result.reason != "")
        print(result.reason, "\n");
    exit(result.status);
}
else if (mode == "generator-failure-reason-fixture")
    print(generator_failure_reason(ARGV[1] || "", int(ARGV[2] || "1")), "\n");
else if (mode == "service-proxy-address")
    print(service_proxy_address(uci_settings(), ARGV[1] || "lists"), "\n");
else if (mode == "service-listen-address") {
    let address = service_listen_address_value(uci_settings());
    if (address == "")
        exit(1);
    print(address, "\n");
}
else if (mode == "device-ipv4-address") {
    let address = device_ipv4_address_value(ARGV[1]);
    if (address == "")
        exit(1);
    print(address, "\n");
}
else if (mode == "ip-addr-first-inet4")
    print(ip_addr_first_inet4(fs.readfile("/dev/stdin")), "\n");
else if (mode == "version")
    print(sing_box_version(), "\n");
else if (mode == "generate-warp-profile")
    generate_warp_profile();
else {
    warn("Usage: singbox/runtime.uc <operation> ...\n");
    exit(1);
}
