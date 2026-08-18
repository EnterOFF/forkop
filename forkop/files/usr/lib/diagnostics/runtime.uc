#!/usr/bin/env ucode

let fs = require("fs");
let constants = require("core.constants");
let core_ip = require("core.ip");
let uci_core = require("core.uci");
let runtime_dns = require("singbox.dns");
let netstat = require("core.netstat");

const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || constants.FORKOP_CONFIG_NAME || "forkop";
const LIB_DIR = getenv("FORKOP_LIB") || "/usr/lib/forkop";
const FORKOP_VERSION = getenv("FORKOP_VERSION") || constants.FORKOP_VERSION || "";
const FORKOP_CONFIG = getenv("FORKOP_CONFIG") || constants.FORKOP_CONFIG || "/etc/config/" + CONFIG_NAME;
const FORKOP_SERVICE_NAME = getenv("FORKOP_SERVICE_NAME") || constants.FORKOP_SERVICE_NAME || "forkop";
const FORKOP_RELEASE_REPO = getenv("FORKOP_RELEASE_REPO") || constants.FORKOP_RELEASE_REPO || "ushan0v/forkop";
const FORKOP_LUCI_VIEW_DIR = getenv("FORKOP_LUCI_VIEW_DIR") || constants.FORKOP_LUCI_VIEW_DIR || "/www/luci-static/resources/view/forkop";
const RUNTIME_STATE_DIR = getenv("FORKOP_RUNTIME_STATE_DIR") || "/var/run/forkop";
const CHECK_PROXY_LOCK_DIR = getenv("FORKOP_CHECK_PROXY_LOCK_DIR") || RUNTIME_STATE_DIR + "/check-proxy.lock";
const SYSTEM_INFO_CACHE_FILE = getenv("FORKOP_SYSTEM_INFO_CACHE_FILE") || RUNTIME_STATE_DIR + "/system-info.json";
const SYSTEM_INFO_CACHE_TTL = int(getenv("FORKOP_SYSTEM_INFO_CACHE_TTL") || "3600");
const TMP_SING_BOX_FOLDER = getenv("TMP_SING_BOX_FOLDER") || constants.TMP_SING_BOX_FOLDER || "/tmp/sing-box";
const CHECK_PROXY_IP_DOMAIN = getenv("CHECK_PROXY_IP_DOMAIN") || constants.CHECK_PROXY_IP_DOMAIN || "ip.podkop.fyi";
// The public endpoint reports the address that reached it under /check; both
// the proxy check and the nftables counter probe use that same path.
const CHECK_PROXY_IP_PATH = "/check";
const FAKEIP_TEST_DOMAIN = getenv("FAKEIP_TEST_DOMAIN") || constants.FAKEIP_TEST_DOMAIN || "fakeip.podkop.fyi";
const RT_TABLE_NAME = getenv("RT_TABLE_NAME") || constants.RT_TABLE_NAME || "forkop";
const NFT_TABLE_NAME = getenv("NFT_TABLE_NAME") || constants.NFT_TABLE_NAME || "ForkopTable";
const NFT_FAKEIP_MARK = getenv("NFT_FAKEIP_MARK") || constants.NFT_FAKEIP_MARK || "0x04000000";
const SB_DNS_INBOUND_ADDRESS = getenv("SB_DNS_INBOUND_ADDRESS") || constants.SB_DNS_INBOUND_ADDRESS || "127.0.0.42";
const SB_TPROXY_INBOUND6_ADDRESS = getenv("SB_TPROXY_INBOUND6_ADDRESS") || constants.SB_TPROXY_INBOUND6_ADDRESS || "::1";
const SB_TPROXY_INBOUND_PORT = getenv("SB_TPROXY_INBOUND_PORT") || constants.SB_TPROXY_INBOUND_PORT || "1602";
const SB_SERVICE_MIXED_INBOUND_ADDRESS = getenv("SB_SERVICE_MIXED_INBOUND_ADDRESS") || constants.SB_SERVICE_MIXED_INBOUND_ADDRESS || "127.0.0.1";
const SB_SERVICE_MIXED_INBOUND_PORT = getenv("SB_SERVICE_MIXED_INBOUND_PORT") || constants.SB_SERVICE_MIXED_INBOUND_PORT || "4534";
const SB_CLASH_API_CONTROLLER_PORT = getenv("SB_CLASH_API_CONTROLLER_PORT") || constants.SB_CLASH_API_CONTROLLER_PORT || "9090";
const CLOUDFLARE_OCTETS = getenv("CLOUDFLARE_OCTETS") || constants.CLOUDFLARE_OCTETS || "8.47 162.159 188.114";
const ZAPRET_LEGACY_DEFAULT_NFQWS_OPT = getenv("ZAPRET_LEGACY_DEFAULT_NFQWS_OPT") || constants.ZAPRET_LEGACY_DEFAULT_NFQWS_OPT || "";
const RUNTIME_STABLE_MIN_AGE = getenv("FORKOP_RUNTIME_STABLE_MIN_AGE") || "2";
const CLASH_HTTP_MAX_TIME = getenv("FORKOP_CLASH_HTTP_MAX_TIME") || "60";
const SING_BOX_FORKOP_VERSION_FILE = getenv("SING_BOX_FORKOP_VERSION_FILE") || "/usr/share/sing-box-forkop/version";

const STATUS_UC = LIB_DIR + "/diagnostics/status.uc";
const HELPERS_UC = LIB_DIR + "/core/helpers.uc";
const PACKAGES_UC = LIB_DIR + "/core/packages.uc";
const DNS_APPLY_UC = LIB_DIR + "/dns/apply.uc";
const SERVICE_STATE_UC = LIB_DIR + "/service/state.uc";
const PROVIDERS_STATUS_UC = LIB_DIR + "/providers/status.uc";
const SINGBOX_RUNTIME_UC = LIB_DIR + "/singbox/runtime.uc";
const ZAPRET_RUNTIME_UC = LIB_DIR + "/providers/zapret/runtime.uc";
const ZAPRET2_RUNTIME_UC = LIB_DIR + "/providers/zapret2/runtime.uc";
const BYEDPI_RUNTIME_UC = LIB_DIR + "/providers/byedpi/runtime.uc";
const ZAPRET_VALIDATOR_UC = LIB_DIR + "/providers/zapret/validator.uc";
const ZAPRET2_VALIDATOR_UC = LIB_DIR + "/providers/zapret2/validator.uc";
const BYEDPI_VALIDATOR_UC = LIB_DIR + "/providers/byedpi/validator.uc";

function as_string(value) {
    return value == null ? "" : "" + value;
}

function arg_number(value) {
    value = as_string(value);
    return value == "" || match(value, /[^0-9-]/) != null ? 0 : int(value, 10);
}

function arg_bool(value) {
    value = lc(as_string(value));
    return value == "1" || value == "true" || value == "yes" || value == "on";
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

function normalize_status(status) {
    status = int(status);
    return status > 255 ? int(status / 256) : status;
}

function command_status(command) {
    return normalize_status(system(command));
}

function command_capture(command) {
    let pipe = fs.popen(command, "r");
    if (!pipe)
        return { status: 1, output: "" };

    let data = pipe.read("all");
    let status = normalize_status(pipe.close());
    return { status, output: data == null ? "" : as_string(data) };
}

function command_output(command) {
    let result = command_capture(command);
    return result.status == 0 ? result.output : "";
}

function command_success(command) {
    return command_status(command + " >/dev/null 2>&1") == 0;
}

function command_output_from_args(args) {
    return command_output(command_from_args(args) + " 2>/dev/null");
}

function command_success_from_args(args) {
    return command_success(command_from_args(args));
}

function command_exists(name) {
    return command_success_from_args([ "command", "-v", as_string(name) ]);
}

function module_args(module_path, args) {
    let result = [ "ucode", "-L", LIB_DIR, module_path ];
    for (let arg in args)
        push(result, arg);
    return result;
}

function module_capture(module_path, args) {
    return command_capture(command_from_args(module_args(module_path, args)));
}

function module_capture_stdin(module_path, args, input) {
    let tmp = trim(command_output_from_args([ "mktemp" ]));
    if (tmp == "")
        return { status: 1, output: "" };

    if (!fs.writefile(tmp, as_string(input))) {
        fs.unlink(tmp);
        return { status: 1, output: "" };
    }

    let result = command_capture(command_from_args(module_args(module_path, args)) + " < " + shell_quote(tmp));
    fs.unlink(tmp);
    return result;
}

function module_output(module_path, args) {
    let result = module_capture(module_path, args);
    return result.status == 0 ? result.output : "";
}

function module_success(module_path, args) {
    return command_success(command_from_args(module_args(module_path, args)));
}

function module_passthrough(module_path, args) {
    let result = module_capture(module_path, args);
    if (result.output != "")
        print(result.output);
    return result.status;
}

function status_capture(args, input) {
    if (input != null)
        return module_capture_stdin(STATUS_UC, args, input);
    return command_capture(command_from_args(module_args(STATUS_UC, args)));
}

function status_output(args, input) {
    let result = status_capture(args, input);
    return result.status == 0 ? result.output : "";
}

function status_success(args, input) {
    return status_capture(args, input).status == 0;
}

function write_json(value) {
    print(sprintf("%J", value), "\n");
}

function read_stdin() {
    let input = fs.open("/dev/stdin", "r");
    if (!input)
        return "";
    let data = input.read("all");
    input.close();
    return data == null ? "" : as_string(data);
}

function read_json_file(path) {
    let data = fs.readfile(as_string(path));
    if (data == null)
        return null;
    try {
        return json(data);
    }
    catch (e) {
        return null;
    }
}

function parse_json_or_null(value) {
    try {
        return json(as_string(value));
    }
    catch (e) {
        return null;
    }
}

function object_or_empty(value) {
    return type(value) == "object" ? value : {};
}

function option(section, key, fallback) {
    if (fallback == null)
        fallback = "";
    let value = object_or_empty(section)[key];
    if (value == null)
        return as_string(fallback);
    if (type(value) == "array")
        return join(" ", value);
    return as_string(value);
}

function list_option(section, key) {
    let value = object_or_empty(section)[key];
    if (type(value) == "array")
        return value;
    if (as_string(value) != "")
        return [ as_string(value) ];
    return [];
}

function bool_option(section, key, fallback) {
    return arg_bool(option(section, key, fallback ? "1" : "0"));
}

function settings() {
    return object_or_empty(uci_core.get_all(CONFIG_NAME, "settings"));
}

function uci_sections(type_name) {
    return uci_core.section_objects(CONFIG_NAME, type_name);
}

function uci_get(path) {
    return uci_core.get(path);
}

function uci_show(path) {
    return uci_core.exists(path);
}

function append_unique(values, value) {
    value = as_string(value);
    if (value == "")
        return;
    for (let item in values)
        if (item == value)
            return;
    push(values, value);
}

function config_section_types(config_path) {
    let data = as_string(fs.readfile(config_path) || "");
    let result = [];

    for (let line in split(data, "\n")) {
        line = trim(as_string(line));
        if (substr(line, 0, 7) != "config ")
            continue;

        let fields = split(line, /[ \t\r\n]+/);
        if (length(fields) >= 2)
            append_unique(result, replace(as_string(fields[1]), /['"]/g, ""));
    }

    return result;
}

function uci_show_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function append_uci_show_option(lines, package_name, section_name, key, value) {
    if (key == ".name" || key == ".type")
        return;

    let path = as_string(package_name) + "." + as_string(section_name) + "." + as_string(key) + "=";
    if (type(value) == "array") {
        for (let item in value)
            push(lines, path + uci_show_quote(item));
    }
    else {
        push(lines, path + uci_show_quote(value));
    }
}

function uci_show_data(package_name, config_path) {
    let lines = [];
    package_name = as_string(package_name);
    for (let type_name in config_section_types(config_path)) {
        for (let section in uci_core.section_objects(package_name, type_name)) {
            let name = as_string(section[".name"] || "");
            if (name == "")
                continue;
            push(lines, package_name + "." + name + "=" + as_string(section[".type"] || type_name));
            for (let key, value in section)
                append_uci_show_option(lines, package_name, name, key, value);
        }
    }
    return join("\n", lines) + "\n";
}

function network_show_data() {
    return uci_show_data("network", "/etc/config/network");
}

function firewall_show_data() {
    return uci_show_data("firewall", "/etc/config/firewall");
}

function file_exists(path) {
    return fs.stat(as_string(path)) != null;
}

function file_executable(path) {
    return command_success_from_args([ "test", "-x", as_string(path) ]);
}

function ensure_dir(path) {
    return command_success_from_args([ "mkdir", "-p", as_string(path) ]);
}

function remove_file(path) {
    try {
        fs.unlink(as_string(path));
    }
    catch (e) {
    }
}

function first_line_value(path, fallback) {
    let data = fs.readfile(as_string(path));
    if (data == null)
        return as_string(fallback);
    let line = split(as_string(data), "\n")[0];
    line = replace(as_string(line), /\r$/, "");
    return line != "" ? line : as_string(fallback);
}

function stdout_is_tty() {
    return command_success_from_args([ "test", "-t", "1" ]);
}

function nolog(message) {
    if (!stdout_is_tty())
        return;
    let timestamp = replace(command_output_from_args([ "date", "+%Y-%m-%d %H:%M:%S" ]), /[\r\n]+$/g, "");
    print("\033[0;36m[", timestamp, "]\033[0m \033[0;32m", as_string(message), "\033[0m\n");
}

function log_message(message, level) {
    level = as_string(level || "info");
    command_success_from_args([ "logger", "-t", "forkop", "[" + level + "] " + as_string(message) ]);
}

function valid_ipv4(value) {
    return core_ip.valid_ipv4(value, true, false);
}

function valid_public_ipv4(value) {
    value = as_string(value);
    if (!valid_ipv4(value))
        return false;

    let parts = split(value, ".");
    let a = int(parts[0], 10);
    let b = int(parts[1], 10);

    if (a == 0 || a == 10 || a == 127 || a >= 224)
        return false;
    if (a == 169 && b == 254)
        return false;
    if (a == 192 && (b == 168 || b == 0 || b == 2))
        return false;
    if (a == 198 && (b == 18 || b == 19 || b == 51))
        return false;
    if (a == 203 && b == 0)
        return false;
    if (a == 100 && b >= 64 && b <= 127)
        return false;
    if (a == 172 && b >= 16 && b <= 31)
        return false;

    return true;
}

function valid_public_ipv6(value) {
    value = lc(as_string(value));
    if (!core_ip.valid_ipv6(value))
        return false;
    if (value == "::" || value == "::1")
        return false;
    if (substr(value, 0, 4) == "fe80" || substr(value, 0, 2) == "ff")
        return false;
    if (substr(value, 0, 2) == "fc" || substr(value, 0, 2) == "fd")
        return false;
    if (substr(value, 0, 4) == "2001" && index(value, "2001:db8") == 0)
        return false;
    return true;
}

function valid_public_ip(value) {
    return valid_public_ipv4(value) || valid_public_ipv6(value);
}

function words(value) {
    value = trim(as_string(value));
    return value == "" ? [] : split(value, /[ \t\r\n]+/);
}

function allowed_ips_default_routes(value) {
    let result = [];
    for (let allowed in words(value)) {
        if (allowed == "0.0.0.0/0" || allowed == "::/0")
            push(result, allowed);
    }
    return result;
}

function push_unique(result, seen, value) {
    value = as_string(value);
    if (value == "" || seen[value])
        return;
    seen[value] = true;
    push(result, value);
}

function network_status_ip_addresses(data, key) {
    let value = parse_json_or_null(data);
    let addresses = type(value) == "object" ? value[key] : null;
    let result = [];
    let seen = {};
    if (type(addresses) == "array") {
        for (let item in addresses) {
            if (type(item) == "object")
                push_unique(result, seen, item.address || "");
        }
    }
    return result;
}

function get_wan_ip_addresses() {
    let result = [];
    let seen = {};

    for (let interface in [ "wan", "wwan" ]) {
        let data = command_output_from_args([
            "ubus", "-S", "call", "network.interface." + interface, "status"
        ]);
        for (let ip in network_status_ip_addresses(data, "ipv4-address"))
            push_unique(result, seen, ip);
        for (let ip in network_status_ip_addresses(data, "ipv6-address"))
            push_unique(result, seen, ip);
    }

    let route = command_output_from_args([ "ip", "-4", "route", "show", "default" ]);
    let fields = words(route);
    let iface = "";
    for (let i = 0; i + 1 < length(fields); i++) {
        if (fields[i] == "dev") {
            iface = fields[i + 1];
            break;
        }
    }
    if (iface == "")
        return "";

    let addr = command_output_from_args([ "ip", "-4", "addr", "show", "dev", iface ]);
    for (let line in split(addr, "\n")) {
        line = trim(as_string(line));
        let matched = match(line, /^inet[ \t]+([0-9.]+)\//);
        if (matched != null)
            push_unique(result, seen, matched[1]);
    }

    route = command_output_from_args([ "ip", "-6", "route", "show", "default" ]);
    fields = words(route);
    iface = "";
    for (let i = 0; i + 1 < length(fields); i++) {
        if (fields[i] == "dev") {
            iface = fields[i + 1];
            break;
        }
    }
    if (iface != "") {
        addr = command_output_from_args([ "ip", "-6", "addr", "show", "dev", iface, "scope", "global" ]);
        for (let line in split(addr, "\n")) {
            line = trim(as_string(line));
            let matched = match(line, /^inet6[ \t]+([^\/ \t]+)\//);
            if (matched != null)
                push_unique(result, seen, matched[1]);
        }
    }

    return join(" ", result);
}

function helper_output(mode, args) {
    let full = [ mode ];
    for (let arg in args)
        push(full, arg);
    return replace(module_output(HELPERS_UC, full), /[\r\n]+$/g, "");
}

function server_inbound_tag(section) {
    return helper_output("server-inbound-tag", [ section ]);
}

function server_required_inbound_proto(protocol, transport) {
    protocol = as_string(protocol);
    transport = lc(as_string(transport));
    if (protocol == "json_inbound")
        return "";
    if (protocol == "hysteria2" || protocol == "tuic")
        return "udp";
    if (protocol == "naive" && transport == "tcp_udp")
        return "tcp udp";
    if ((protocol == "naive" || protocol == "mieru") && transport == "udp")
        return "udp";
    return "tcp";
}

function server_runtime_type_for_protocol(protocol) {
    protocol = as_string(protocol);
    if (protocol == "json_inbound")
        return "";
    if (protocol == "mtproto")
        return "mtproxy";
    return protocol;
}

function server_listen_requires_firewall(listen, wan_ip) {
    listen = as_string(listen);
    if (listen == "0.0.0.0" || listen == "::" || valid_public_ip(listen))
        return true;
    for (let ip in words(wan_ip))
        if (ip == listen)
            return true;
    return false;
}

function firewall_required_protocols_open(port, required_proto) {
    let firewall = firewall_show_data();
    return status_success([ "firewall-required-protocols-open", port, required_proto ], firewall);
}

function server_required_port_conflict_owners(listen, port, required_proto) {
    return replace(status_output(
        [ "server-required-port-conflict-owners", listen, port, required_proto ],
        command_output_from_args([ "netstat", "-lnp" ])
    ), /[\r\n]+$/g, "");
}

function server_required_ports_listening(listen, port, required_proto) {
    return status_success(
        [ "server-required-ports-listening", listen, port, required_proto ],
        command_output_from_args([ "netstat", "-ln" ])
    );
}

function resolve_public_host_ips(host) {
    host = as_string(host);
    if (substr(host, 0, 1) == "[" && substr(host, length(host) - 1, 1) == "]")
        host = substr(host, 1, length(host) - 2);
    if (host == "")
        return "";
    if (valid_ipv4(host))
        return host;
    if (core_ip.valid_ipv6(host))
        return host;

    let seen = {};
    for (let line in split(command_output_from_args([
        "dig", "+short", "A", host, "+timeout=2", "+tries=1"
    ]), "\n")) {
        line = trim(as_string(line));
        if (valid_ipv4(line))
            seen[line] = true;
    }
    for (let line in split(command_output_from_args([
        "dig", "+short", "AAAA", host, "+timeout=2", "+tries=1"
    ]), "\n")) {
        line = trim(as_string(line));
        if (core_ip.valid_ipv6(line))
            seen[line] = true;
    }

    return join(" ", sort(keys(seen)));
}

function public_host_flags(public_host, public_host_ips, wan_ip, wan_public) {
    return replace(status_output(
        [ "public-host-flags", public_host, public_host_ips, wan_ip, wan_public ],
        null
    ), /[\r\n]+$/g, "");
}

function check_inbounds_config() {
    let count = 0;
    for (let section in uci_sections("server"))
        if (bool_option(section, "enabled", false))
            count++;
    write_json({ enabled_count: count });
    return 0;
}

function check_inbounds() {
    let cfg = settings();
    let sing_box_config_path = option(cfg, "config_path", "");
    let wan_ip = get_wan_ip_addresses();
    let wan_public = 0;
    for (let ip in words(wan_ip)) {
        if (valid_public_ip(ip)) {
            wan_public = 1;
            break;
        }
    }
    let items = [];
    let enabled_count = 0;

    for (let section in uci_sections("server")) {
        if (!bool_option(section, "enabled", false))
            continue;
        enabled_count++;

        let section_name = as_string(section[".name"] || "");
        let label = option(section, "label", section_name);
        let protocol = option(section, "protocol", "vless");
        let listen = option(section, "listen", "0.0.0.0");
        let listen_port = option(section, "listen_port", "");
        let public_host = option(section, "public_host", "");
        let routing_mode = option(section, "routing_mode", "rules");
        let inbound_tag = server_inbound_tag(label);
        let expected_type = server_runtime_type_for_protocol(protocol);
        let inbound_transport = protocol == "naive"
            ? option(section, "naive_network", "tcp")
            : protocol == "mieru"
                ? option(section, "mieru_transport", "TCP")
                : "";
        let required_proto = server_required_inbound_proto(protocol, inbound_transport);
        let runtime_json = protocol == "tailscale"
            ? module_output(PROVIDERS_STATUS_UC, [ "endpoint-summary", sing_box_config_path, inbound_tag ])
            : module_output(PROVIDERS_STATUS_UC, [ "inbound-summary", sing_box_config_path, inbound_tag ]);

        let listening = -1;
        let firewall_required = 0;
        let firewall_open = -1;
        let port_conflict = 0;
        let port_conflict_owners = "";
        if (protocol != "tailscale" && protocol != "json_inbound") {
            port_conflict_owners = server_required_port_conflict_owners(listen, listen_port, required_proto);
            if (port_conflict_owners != "")
                port_conflict = 1;
            listening = server_required_ports_listening(listen, listen_port, required_proto) ? 1 : 0;
            if (server_listen_requires_firewall(listen, wan_ip)) {
                firewall_required = 1;
                firewall_open = firewall_required_protocols_open(listen_port, required_proto) ? 1 : 0;
            }
        }

        let routes_configured = module_success(PROVIDERS_STATUS_UC, [
            "has-route-rule-for-inbound", sing_box_config_path, inbound_tag
        ]) ? 1 : 0;

        let public_host_ips = protocol == "json_inbound" ? "" : resolve_public_host_ips(public_host);
        let flags = words(public_host_flags(public_host, public_host_ips, wan_ip, wan_public));
        while (length(flags) < 3)
            push(flags, "-1");

        let item_json = status_output([
            "inbound-item-json",
            runtime_json,
            section_name,
            label,
            protocol,
            routing_mode,
            inbound_tag,
            listen,
            listen_port,
            public_host,
            public_host_ips,
            expected_type,
            required_proto,
            listening,
            firewall_required,
            firewall_open,
            port_conflict,
            port_conflict_owners,
            routes_configured,
            flags[0],
            flags[1],
            flags[2]
        ], null);
        let item = parse_json_or_null(item_json);
        push(items, type(item) == "object" ? item : {});
    }

    write_json({
        enabled_count,
        config_path: sing_box_config_path,
        wan_ip,
        wan_public,
        items
    });
    return 0;
}

function cleanup_check_proxy_dir(dir) {
    dir = as_string(dir);
    let prefix = TMP_SING_BOX_FOLDER + "/check-proxy-";
    if (substr(dir, 0, length(prefix)) == prefix)
        command_success_from_args([ "rm", "-rf", dir ]);
}

function current_pid() {
    let stat = as_string(fs.readfile("/proc/self/stat"));
    let separator = index(stat, " ");
    return separator > 0 ? substr(stat, 0, separator) : "";
}

function pid_running(pid) {
    pid = as_string(pid);
    return match(pid, /^[0-9]+$/) != null && command_success_from_args([ "kill", "-0", pid ]);
}

function first_line(path) {
    let data = fs.readfile(as_string(path));
    if (data == null)
        return "";
    let newline = index(data, "\n");
    return trim(newline >= 0 ? substr(data, 0, newline) : data);
}

function sing_box_process_running_for_check() {
    return command_success_from_args([ "pgrep", "-x", "sing-box" ]) ||
        command_success_from_args([ "pgrep", "-f", "^/usr/bin/sing-box[[:space:]]" ]);
}

function acquire_check_proxy_lock() {
    if (!ensure_dir(RUNTIME_STATE_DIR))
        return false;

    let owner = current_pid();
    if (owner == "")
        return false;

    if (command_success_from_args([ "mkdir", CHECK_PROXY_LOCK_DIR ]))
        return fs.writefile(CHECK_PROXY_LOCK_DIR + "/pid", owner + "\n") != null;

    let current_owner = first_line(CHECK_PROXY_LOCK_DIR + "/pid");
    if (pid_running(current_owner))
        return false;

    let lock_stat = fs.stat(CHECK_PROXY_LOCK_DIR);
    let lock_age = lock_stat == null ? 0 : int(clock()[0]) - int(lock_stat.mtime || 0);
    if (current_owner == "" && lock_stat != null && lock_age >= 0 && lock_age < 5)
        return false;

    command_success_from_args([ "rm", "-f", CHECK_PROXY_LOCK_DIR + "/pid" ]);
    command_success_from_args([ "rmdir", CHECK_PROXY_LOCK_DIR ]);
    if (!command_success_from_args([ "mkdir", CHECK_PROXY_LOCK_DIR ]))
        return false;
    if (fs.writefile(CHECK_PROXY_LOCK_DIR + "/pid", owner + "\n") != null)
        return true;

    command_success_from_args([ "rmdir", CHECK_PROXY_LOCK_DIR ]);
    return false;
}

function release_check_proxy_lock() {
    let owner = current_pid();
    if (owner == "" || first_line(CHECK_PROXY_LOCK_DIR + "/pid") != owner)
        return;
    command_success_from_args([ "rm", "-f", CHECK_PROXY_LOCK_DIR + "/pid" ]);
    command_success_from_args([ "rmdir", CHECK_PROXY_LOCK_DIR ]);
}

function check_proxy_through_running_core() {
    let proxy = "socks5h://" + SB_SERVICE_MIXED_INBOUND_ADDRESS + ":" + SB_SERVICE_MIXED_INBOUND_PORT;
    let response = command_output_from_args([
        "curl",
        "--connect-timeout", "3",
        "--max-time", "10",
        "--fail",
        "--silent",
        "--show-error",
        "--proxy", proxy,
        "https://" + CHECK_PROXY_IP_DOMAIN + CHECK_PROXY_IP_PATH
    ]);
    let masked_response = replace(status_output([ "proxy-response-ip-mask" ], response), /[\r\n]+$/g, "");
    if (masked_response == "") {
        nolog("Failed to get a valid IP through the running sing-box service");
        return 1;
    }

    nolog(masked_response + " - should match proxy IP");
    return 0;
}

function check_proxy_locked() {
    let sing_box_config_path = option(settings(), "config_path", "");
    if (!command_exists("sing-box")) {
        nolog("sing-box is not installed");
        return 1;
    }
    if (!file_exists(sing_box_config_path)) {
        nolog("Configuration file not found");
        return 1;
    }

    // Starting another sing-box tools process beside the full router core can
    // exhaust RAM on low-memory OpenWrt devices. Reuse the already-running
    // mixed inbound instead; it exercises the same proxy route without a
    // second Go runtime.
    if (sing_box_process_running_for_check())
        return check_proxy_through_running_core();

    nolog("Checking sing-box configuration...");
    if (!command_success_from_args([ "sing-box", "-c", sing_box_config_path, "check" ])) {
        nolog("Invalid configuration");
        return 1;
    }

    print(status_output([ "mask-sing-box-config", sing_box_config_path ], null));
    nolog("Checking proxy connection...");

    let check_proxy_dir = TMP_SING_BOX_FOLDER + "/check-proxy-" + clock()[0] + "-" + clock()[1];
    let check_proxy_config = check_proxy_dir + "/config.json";
    let check_proxy_cache = check_proxy_dir + "/cache.db";

    cleanup_check_proxy_dir(check_proxy_dir);
    ensure_dir(check_proxy_dir);
    if (!status_success([ "prepare-check-proxy-config", sing_box_config_path, check_proxy_config, check_proxy_cache ], null)) {
        nolog("Failed to prepare temporary configuration");
        cleanup_check_proxy_dir(check_proxy_dir);
        return 1;
    }

    let outbound_tag = replace(status_output(
        [ "check-proxy-outbound-tag", check_proxy_config, CHECK_PROXY_IP_DOMAIN ],
        null
    ), /[\r\n]+$/g, "");

    let response = "";
    for (let attempt = 1; attempt <= 5; attempt++) {
        // A core may have started after the initial check. Never start a
        // standalone Go process beside it; use the mixed inbound instead.
        if (sing_box_process_running_for_check()) {
            cleanup_check_proxy_dir(check_proxy_dir);
            return check_proxy_through_running_core();
        }
        let args = [ "sing-box", "tools", "fetch", "ifconfig.me", "-c", check_proxy_config, "-D", check_proxy_dir, "--disable-color" ];
        if (outbound_tag != "") {
            push(args, "-o");
            push(args, outbound_tag);
        }
        response = command_output(command_from_args(args) + " 2>/dev/null");
        if (status_success([ "proxy-response-is-retryable-error" ], response))
            continue;

        let masked_response_ip = replace(status_output([ "proxy-response-ip-mask" ], response), /[\r\n]+$/g, "");
        if (masked_response_ip != "") {
            nolog(masked_response_ip + " - should match proxy IP");
            cleanup_check_proxy_dir(check_proxy_dir);
            return 0;
        }

        if (attempt == 5) {
            nolog("Failed to get valid IP address after 5 attempts");
            nolog(response == "" ? "Error: Empty response" : "Error response: " + response);
            cleanup_check_proxy_dir(check_proxy_dir);
            return 1;
        }
    }

    cleanup_check_proxy_dir(check_proxy_dir);
    return 1;
}

function check_proxy() {
    if (!acquire_check_proxy_lock()) {
        nolog("A proxy check is already running");
        return 1;
    }

    let result = check_proxy_locked();
    release_check_proxy_lock();
    return result;
}

function show_sing_box_config(visibility) {
    visibility = as_string(visibility || "masked");
    let sing_box_config_path = option(settings(), "config_path", "");
    nolog("Current sing-box configuration:");
    if (!file_exists(sing_box_config_path)) {
        nolog("Configuration file not found");
        return 1;
    }
    if (visibility == "raw")
        print(as_string(fs.readfile(sing_box_config_path)));
    else
        print(status_output([ "mask-sing-box-config", sing_box_config_path ], null));
    return 0;
}

function show_config(visibility) {
    visibility = as_string(visibility || "masked");
    if (!file_exists(FORKOP_CONFIG)) {
        nolog("Configuration file not found");
        return 1;
    }
    if (visibility == "raw")
        print(as_string(fs.readfile(FORKOP_CONFIG)));
    else
        print(status_output([ "forkop-config-masked", FORKOP_CONFIG ], null));
    return 0;
}

function show_version() {
    print(FORKOP_VERSION, "\n");
    return 0;
}

function get_luci_app_version() {
    let path = FORKOP_LUCI_VIEW_DIR + "/main.js";
    let data = fs.readfile(path);
    if (data == null)
        return "not installed";

    for (let line in split(as_string(data), "\n")) {
        let matched = match(line, /^[ \t]*var[ \t]+([^ \t=]+)[ \t]*=[ \t]*"([^"]*)"/);
        if (matched != null && matched[1] == "FORKOP_LUCI_APP_VERSION")
            return as_string(matched[2]);
    }
    return "";
}

function system_info_cache_is_valid() {
    let cache = read_json_file(SYSTEM_INFO_CACHE_FILE);
    if (type(cache) != "object")
        return false;
    let now = int(clock()[0]);
    let generated_at = arg_number(cache.generated_at || 0);
    if (now > 0 && generated_at > 0 && SYSTEM_INFO_CACHE_TTL > 0 && now - generated_at >= SYSTEM_INFO_CACHE_TTL)
        return false;
    let marker = fs.readfile(SING_BOX_FORKOP_VERSION_FILE);
    if (marker != null) {
        marker = replace(trim(as_string(marker)), /~/g, "-");
        if (marker != "" && (!command_exists("sing-box") || as_string(cache.sing_box_version) != marker))
            return false;
    }
    return cache.forkop_version == FORKOP_VERSION && cache.luci_app_version == get_luci_app_version();
}

function ensure_runtime_dirs() {
    ensure_dir(RUNTIME_STATE_DIR);
}

function write_system_info_cache(value) {
    ensure_runtime_dirs();
    let tmpfile = SYSTEM_INFO_CACHE_FILE + "." + clock()[0] + "." + clock()[1] + ".tmp";
    if (fs.writefile(tmpfile, as_string(value) + "\n") == null)
        return false;
    remove_file(SYSTEM_INFO_CACHE_FILE);
    if (!fs.rename(tmpfile, SYSTEM_INFO_CACHE_FILE)) {
        remove_file(tmpfile);
        return false;
    }
    return true;
}

function package_installed(package_name) {
    return module_success(PACKAGES_UC, [ "installed", package_name ]);
}

function sing_box_package() {
    if (package_installed("sing-box-forkop-compressed"))
        return "sing-box-forkop-compressed";
    if (package_installed("sing-box-forkop"))
        return "sing-box-forkop";
    // The package manager can be locked while postinst starts Forkop. The
    // package-owned marker still proves which Forkop core is present.
    if (command_exists("sing-box") && file_exists(SING_BOX_FORKOP_VERSION_FILE))
        return "sing-box-forkop";
    return "";
}

function provider_installed(runtime_uc) {
    return module_success(runtime_uc, [ "installed" ]);
}

function provider_version(runtime_uc) {
    let value = replace(module_output(runtime_uc, [ "package-version" ]), /[\r\n]+$/g, "");
    return value != "" ? value : "unknown";
}

function openwrt_release() {
    let data = fs.readfile("/etc/os-release");
    if (data == null)
        return "unknown";
    for (let line in split(as_string(data), "\n")) {
        if (substr(line, 0, length("OPENWRT_RELEASE=")) != "OPENWRT_RELEASE=")
            continue;
        let value = substr(line, length("OPENWRT_RELEASE="));
        if (length(value) >= 2) {
            let quote = substr(value, 0, 1);
            if ((quote == "\"" || quote == "'") && substr(value, length(value) - 1) == quote)
                value = substr(value, 1, length(value) - 2);
        }
        return value != "" ? value : "unknown";
    }
    return "unknown";
}

function build_system_info() {
    let forkop_latest_version = first_line_value("/tmp/forkop.latest-version.cache", "unknown");
    let luci_app_version = get_luci_app_version();
    let sing_box_version = "";
    let sing_box_package_name = sing_box_package();
    if (sing_box_package_name != "" && command_exists("sing-box"))
        sing_box_version = replace(module_output(SINGBOX_RUNTIME_UC, [ "version" ]), /[\r\n]+$/g, "");
    if (sing_box_version == "" && sing_box_package_name != "")
        sing_box_version = replace(module_output(PACKAGES_UC, [ "version", sing_box_package_name ]), /[\r\n]+$/g, "");
    if (sing_box_version == "")
        sing_box_version = sing_box_package_name == "" ? "not installed" : "unknown";

    let zapret_installed = provider_installed(ZAPRET_RUNTIME_UC) ? 1 : 0;
    let zapret_version = zapret_installed ? provider_version(ZAPRET_RUNTIME_UC) : "not installed";
    let zapret2_installed = provider_installed(ZAPRET2_RUNTIME_UC) ? 1 : 0;
    let zapret2_version = zapret2_installed ? provider_version(ZAPRET2_RUNTIME_UC) : "not installed";
    let byedpi_installed = provider_installed(BYEDPI_RUNTIME_UC) ? 1 : 0;
    let byedpi_version = byedpi_installed ? provider_version(BYEDPI_RUNTIME_UC) : "not installed";
    let device_model = first_line_value("/tmp/sysinfo/model", "unknown");

    return {
        forkop_version: FORKOP_VERSION,
        forkop_latest_version: forkop_latest_version || "unknown",
        luci_app_version,
        sing_box_version,
        sing_box_compressed: sing_box_package_name == "sing-box-forkop-compressed" ? 1 : 0,
        zapret_version,
        zapret_installed,
        zapret2_version,
        zapret2_installed,
        byedpi_version,
        byedpi_installed,
        openwrt_version: openwrt_release(),
        device_model,
        generated_at: int(clock()[0])
    };
}

function get_system_info() {
    if (system_info_cache_is_valid()) {
        print(as_string(fs.readfile(SYSTEM_INFO_CACHE_FILE)));
        return 0;
    }

    let system_info = sprintf("%J", build_system_info());
    write_system_info_cache(system_info);
    print(system_info, "\n");
    return 0;
}

function neutralize_zapret_defaults() {
    log_message("Standalone zapret is not neutralized automatically; Forkop uses /opt/zapret/nfq/nfqws as an external provider and manages only its own NFQUEUE range.", "info");
    return 0;
}

function sing_box_process_is_running() {
    return sing_box_process_running_for_check();
}

function service_status_label(running, enabled) {
    if (arg_number(running) == 1)
        return arg_number(enabled) == 1 ? "running & enabled" : "running but disabled";
    return arg_number(enabled) == 1 ? "stopped but enabled" : "stopped & disabled";
}

function write_service_status(running, enabled, dns_configured) {
    write_json({
        running,
        enabled,
        status: service_status_label(running, enabled),
        dns_configured
    });
}

function dnsmasq_ready_for_interface_dns() {
    return module_success(DNS_APPLY_UC, [ "default-config-complete" ]);
}

function get_sing_box_status() {
    let running = module_success(SERVICE_STATE_UC, [
        "sing-box-service-stable",
        RUNTIME_STABLE_MIN_AGE
    ]) ? 1 : 0;
    let enabled = file_executable("/etc/rc.d/S99sing-box") ? 1 : 0;
    let dns_configured = running && dnsmasq_ready_for_interface_dns() ? 1 : 0;
    write_service_status(running, enabled, dns_configured);
    return 0;
}

function get_status() {
    let running = module_success(SERVICE_STATE_UC, [
        "forkop-stably-running", RT_TABLE_NAME, NFT_TABLE_NAME, NFT_FAKEIP_MARK, RUNTIME_STABLE_MIN_AGE
    ]) ? 1 : 0;
    let enabled = file_executable("/etc/rc.d/S99" + FORKOP_SERVICE_NAME) ? 1 : 0;
    let dns_configured = running && dnsmasq_ready_for_interface_dns() ? 1 : 0;
    write_service_status(running, enabled, dns_configured);
    return 0;
}

// The three external DPI providers differ only in which module owns them, so
// the CLI exposes one command per operation and resolves the owner here.
function provider_runtime_module(provider) {
    let modules = {
        zapret: ZAPRET_RUNTIME_UC,
        zapret2: ZAPRET2_RUNTIME_UC,
        byedpi: BYEDPI_RUNTIME_UC
    };
    return modules[lc(as_string(provider))];
}

function provider_validator_args(provider, raw_opt) {
    raw_opt = as_string(raw_opt);
    let args = {
        zapret: [ ZAPRET_VALIDATOR_UC, "validate-json", "nfqws", raw_opt, ZAPRET_LEGACY_DEFAULT_NFQWS_OPT ],
        zapret2: [ ZAPRET2_VALIDATOR_UC, "validate-json", "nfqws2", raw_opt ],
        byedpi: [ BYEDPI_VALIDATOR_UC, "validate-json", raw_opt ]
    };
    return args[lc(as_string(provider))];
}

function unknown_provider(provider) {
    warn("Unknown DPI provider: " + as_string(provider) + "\n");
    return 1;
}

function check_provider_runtime(provider) {
    let module = provider_runtime_module(provider);
    if (module == null)
        return unknown_provider(provider);
    return module_passthrough(module, [ "check" ]);
}

function get_provider_status(provider) {
    let module = provider_runtime_module(provider);
    if (module == null)
        return unknown_provider(provider);
    return module_passthrough(module, [ "status" ]);
}

function validate_provider_strategy_json(provider, raw_opt) {
    let args = provider_validator_args(provider, raw_opt);
    if (args == null)
        return unknown_provider(provider);
    let result = module_capture(args[0], slice(args, 1));
    if (result.output != "")
        print(result.output);
    return 0;
}

function url_host(value) {
    return helper_output("url-get-host", [ value ]);
}

function dns_check_resolve_host(host, resolver, timeout_seconds) {
    host = as_string(host);
    resolver = as_string(resolver);
    if (host == "")
        return "";
    if (valid_ipv4(host))
        return host;
    if (resolver == "")
        return "";

    timeout_seconds = int(timeout_seconds || 2);
    let parsed = runtime_dns.parse_server_uri(resolver, true);
    if (parsed.unsupported || (parsed.type != "udp" && parsed.type != "tcp"))
        return "";

    let args = [ "dig", "@" + parsed.server, "-p", as_string(parsed.server_port) ];
    if (parsed.type == "tcp")
        push(args, "+tcp");
    for (let arg in [ host, "A", "+short", "+timeout=" + as_string(timeout_seconds), "+tries=1" ])
        push(args, arg);

    for (let line in split(command_output_from_args(args), "\n")) {
        line = trim(as_string(line));
        if (valid_ipv4(line))
            return line;
    }
    return "";
}

function device_ipv4_address(interface) {
    let value = replace(module_output(SINGBOX_RUNTIME_UC, [ "device-ipv4-address", interface ]), /[\r\n]+$/g, "");
    if (value != "")
        return value;

    let output = command_output_from_args([ "ip", "-4", "addr", "show", "dev", interface ]);
    for (let line in split(output, "\n")) {
        line = trim(as_string(line));
        let matched = match(line, /^inet[ \t]+([0-9.]+)\//);
        if (matched != null)
            return as_string(matched[1]);
    }
    return "";
}

function dns_check_router_resolver_available(domain) {
    for (let address in [ "127.0.0.1", SB_DNS_INBOUND_ADDRESS ]) {
        if (address != "" && command_success_from_args([ "dig", "@" + address, domain, "+timeout=2", "+tries=1" ]))
            return true;
    }

    let listen_address = replace(module_output(SINGBOX_RUNTIME_UC, [ "service-listen-address" ]), /[\r\n]+$/g, "");
    if (listen_address != "" && command_success_from_args([ "dig", "@" + listen_address, domain, "+timeout=2", "+tries=1" ]))
        return true;

    let source_interfaces = option(settings(), "source_network_interfaces", "br-lan");
    for (let interface in words(source_interfaces)) {
        let address = device_ipv4_address(interface);
        if (address != "" && command_success_from_args([ "dig", "@" + address, domain, "+timeout=2", "+tries=1" ]))
            return true;
    }

    return false;
}

function check_dns_available() {
    let cfg = settings();
    let dns_servers = runtime_dns.server_list(cfg, "dns_server", "77.88.8.8");
    let bootstrap_dns_servers = runtime_dns.server_list(cfg, "bootstrap_dns_server", "77.88.8.8");
    let dont_touch_dhcp = bool_option(cfg, "dont_touch_dhcp", false) ? 1 : 0;
    let domain = "example.com";
    let timeout_seconds = 2;
    let dns_status = 0;
    let dns_on_router = 0;
    let bootstrap_dns_status = 0;
    let encrypted_bootstrap = false;
    let dhcp_config_status = 1;

    let active_dns_args = [
        "dig", "@" + SB_DNS_INBOUND_ADDRESS, domain, "A", "+short",
        "+timeout=" + as_string(timeout_seconds), "+tries=1"
    ];
    for (let line in split(command_output_from_args(active_dns_args), "\n"))
        if (valid_ipv4(trim(as_string(line)))) {
            dns_status = 1;
            break;
        }

    if (dns_check_router_resolver_available(domain))
        dns_on_router = 1;

    let dns_server_host = url_host(dns_servers[0]);
    if (dns_server_host == "")
        dns_server_host = dns_servers[0];
    let bootstrap_check_domain = domain;
    if (dns_server_host != "" && !valid_ipv4(dns_server_host))
        bootstrap_check_domain = dns_server_host;
    for (let bootstrap_dns_server in bootstrap_dns_servers) {
        let parsed = runtime_dns.parse_server_uri(bootstrap_dns_server, true);
        if (!parsed.unsupported && parsed.type != "udp" && parsed.type != "tcp")
            encrypted_bootstrap = true;
        if (dns_check_resolve_host(bootstrap_check_domain, bootstrap_dns_server, timeout_seconds) != "") {
            bootstrap_dns_status = 1;
            break;
        }
    }
    if (!bootstrap_dns_status && encrypted_bootstrap && dns_status)
        bootstrap_dns_status = 1;

    if (!module_success(DNS_APPLY_UC, [ "default-config-complete" ]))
        dhcp_config_status = 0;

    let display_dns_servers = [];
    for (let dns_server in dns_servers)
        push(display_dns_servers, replace(status_output([ "mask-dns-server", dns_server ], null), /[\r\n]+$/g, ""));
    write_json({
        dns_server: join(", ", display_dns_servers),
        dns_status,
        dns_on_router,
        bootstrap_dns_server: join(", ", bootstrap_dns_servers),
        bootstrap_dns_status,
        dhcp_config_status,
        dont_touch_dhcp
    });
    return 0;
}

function nft_chain_counter_status(chain) {
    let output = command_output_from_args([ "nft", "list", "chain", "inet", NFT_TABLE_NAME, chain ]);
    let status = words(status_output([ "nft-chain-counter-status" ], output));
    while (length(status) < 2)
        push(status, "0");
    return [ arg_number(status[0]), arg_number(status[1]) ];
}

function nft_table_has_other_mark_rules(family, table_name) {
    let output = command_output_from_args([ "nft", "list", "table", family, table_name ]);
    return status_success([ "stdin-contains", "meta mark set" ], output);
}

function check_nft_rules() {
    command_status("sh -c " + shell_quote(
        "curl -m 3 -s " + shell_quote("https://" + CHECK_PROXY_IP_DOMAIN + CHECK_PROXY_IP_PATH) + " >/dev/null 2>&1 & pid1=$!; " +
        "curl -m 3 -s " + shell_quote("https://" + FAKEIP_TEST_DOMAIN + "/check") + " >/dev/null 2>&1 & pid2=$!; " +
        "wait $pid1 2>/dev/null; wait $pid2 2>/dev/null; sleep 1"
    ));

    let table_exist = 0;
    let rules_mangle_exist = 0;
    let rules_mangle_counters = 0;
    let rules_mangle_output_exist = 0;
    let rules_mangle_output_counters = 0;
    let rules_proxy_exist = 0;
    let rules_proxy_counters = 0;
    let rules_other_mark_exist = 0;

    if (command_success_from_args([ "nft", "list", "table", "inet", NFT_TABLE_NAME ])) {
        table_exist = 1;
        if (command_success_from_args([ "nft", "list", "chain", "inet", NFT_TABLE_NAME, "mangle" ])) {
            let status = nft_chain_counter_status("mangle");
            rules_mangle_exist = status[0];
            rules_mangle_counters = status[1];
        }
        if (command_success_from_args([ "nft", "list", "chain", "inet", NFT_TABLE_NAME, "priority_rules" ])) {
            let status = nft_chain_counter_status("priority_rules");
            rules_mangle_counters = rules_mangle_counters || status[1];
        }
        if (command_success_from_args([ "nft", "list", "chain", "inet", NFT_TABLE_NAME, "mangle_output" ])) {
            let status = nft_chain_counter_status("mangle_output");
            rules_mangle_output_exist = status[0];
            rules_mangle_output_counters = status[1];
        }
        if (command_success_from_args([ "nft", "list", "chain", "inet", NFT_TABLE_NAME, "proxy" ])) {
            let status = nft_chain_counter_status("proxy");
            rules_proxy_exist = status[0];
            rules_proxy_counters = status[1];
        }
    }

    for (let line in split(command_output_from_args([ "nft", "list", "tables" ]), "\n")) {
        let fields = words(line);
        if (length(fields) < 3)
            continue;
        let family = fields[1];
        let table_name = fields[2];
        if (table_name == NFT_TABLE_NAME)
            continue;
        if (nft_table_has_other_mark_rules(family, table_name)) {
            rules_other_mark_exist = 1;
            break;
        }
    }

    write_json({
        table_exist,
        rules_mangle_exist,
        rules_mangle_counters,
        rules_mangle_output_exist,
        rules_mangle_output_counters,
        rules_proxy_exist,
        rules_proxy_counters,
        rules_other_mark_exist
    });
    return 0;
}

function strip_leading_v(value) {
    value = as_string(value);
    return substr(value, 0, 1) == "v" ? substr(value, 1) : value;
}

function sing_box_standard_ports_listening(netstat_data) {
    return netstat.sing_box_standard_ports_listening(
        netstat_data,
        SB_DNS_INBOUND_ADDRESS,
        SB_TPROXY_INBOUND_PORT,
        SB_TPROXY_INBOUND6_ADDRESS
    );
}

function sing_box_standard_ports_listening_fixture() {
    exit(sing_box_standard_ports_listening(read_stdin()) ? 0 : 1);
}

function check_sing_box() {
    let sing_box_installed = 0;
    let sing_box_version_ok = 0;
    let sing_box_service_exist = 0;
    let sing_box_autostart_disabled = 0;
    let sing_box_process_running = 0;
    let sing_box_ports_listening = 0;

    if (sing_box_package() != "" && command_exists("sing-box")) {
        sing_box_installed = 1;
        let version = strip_leading_v(replace(module_output(SINGBOX_RUNTIME_UC, [ "version" ]), /[\r\n]+$/g, ""));
        if (version != "" && module_success(HELPERS_UC, [ "version-at-least", version, "1.12.4" ]))
            sing_box_version_ok = 1;
    }

    if (file_exists("/etc/init.d/sing-box")) {
        sing_box_service_exist = 1;
        if (!command_success_from_args([ "/etc/init.d/sing-box", "enabled" ]))
            sing_box_autostart_disabled = 1;
    }

    if (sing_box_process_is_running())
        sing_box_process_running = 1;

    if (sing_box_standard_ports_listening(command_output_from_args([ "netstat", "-ln" ])))
        sing_box_ports_listening = 1;

    write_json({
        sing_box_installed,
        sing_box_version_ok,
        sing_box_service_exist,
        sing_box_autostart_disabled,
        sing_box_process_running,
        sing_box_ports_listening
    });
    return 0;
}

function check_fakeip() {
    let fakeip_address = "";
    let fakeip6_address = "";
    for (let line in split(command_output_from_args([
        "dig", "+short", "@" + SB_DNS_INBOUND_ADDRESS, FAKEIP_TEST_DOMAIN, "A", "+timeout=2", "+tries=1"
    ]), "\n")) {
        line = trim(as_string(line));
        if (valid_ipv4(line)) {
            fakeip_address = line;
            break;
        }
    }
    for (let line in split(command_output_from_args([
        "dig", "+short", "@" + SB_DNS_INBOUND_ADDRESS, FAKEIP_TEST_DOMAIN, "AAAA", "+timeout=2", "+tries=1"
    ]), "\n")) {
        line = lc(trim(as_string(line)));
        if (core_ip.valid_ipv6(line)) {
            fakeip6_address = line;
            break;
        }
    }
    write_json({
        fakeip: match(fakeip_address, /^198\.(18|19)\./) != null || match(fakeip6_address, /^fc[0-3][0-9a-f]:/) != null,
        IP: fakeip_address != "" ? fakeip_address : fakeip6_address,
        IPv4: fakeip_address,
        IPv6: fakeip6_address
    });
    return 0;
}

function clash_api_url() {
    let address = replace(module_output(SINGBOX_RUNTIME_UC, [ "service-listen-address" ]), /[\r\n]+$/g, "");
    if (address == "")
        address = "127.0.0.1";
    return "http://" + address + ":" + SB_CLASH_API_CONTROLLER_PORT;
}

function clash_auth_args() {
    let cfg = settings();
    let secret = option(cfg, "yacd_secret_key", "");
    if (secret == "")
        return [];
    return [ "--header", "Authorization: Bearer " + secret ];
}

const CLASH_HTTP_STATUS_MARKER = "__FORKOP_CLASH_STATUS__";

function clash_http_safe_segment(value) {
    value = as_string(value);
    return value != "" && value != "." && value != ".." &&
        match(value, /^[^\/?#]+$/) != null;
}

function clash_http_path_segments(path, prefix) {
    path = as_string(path);
    prefix = as_string(prefix);
    if (substr(path, 0, length(prefix)) != prefix)
        return null;

    let rest = substr(path, length(prefix));
    let segments = rest == "" ? [] : split(rest, "/");
    for (let segment in segments)
        if (!clash_http_safe_segment(segment))
            return null;
    return segments;
}

// Only the endpoints the dashboard and monitoring pages actually drive are
// reachable through this transport, so a compromised page cannot turn it into
// an arbitrary HTTP client for the sing-box control plane.
function clash_http_allowed(method, path, body) {
    method = uc(as_string(method));
    path = as_string(path);
    body = as_string(body);

    if (path == "" || length(path) > 4096 ||
        index(path, "\r") >= 0 || index(path, "\n") >= 0 || index(path, " ") >= 0)
        return false;

    if (method == "GET") {
        if (body != "")
            return false;
        if (path == "/proxies" || path == "/providers/proxies" || path == "/connections")
            return true;

        let query = index(path, "?");
        if (query < 0) {
            let link = clash_http_path_segments(path, "/proxies/");
            return length(link) == 2 && link[1] == "link";
        }

        let delay = clash_http_path_segments(substr(path, 0, query), "/");
        if (length(delay) != 3 || delay[2] != "delay" ||
            (delay[0] != "proxies" && delay[0] != "group"))
            return false;
        return match(substr(path, query), /^\?url=[^&]+&timeout=[0-9]+$/) != null;
    }

    if (method == "DELETE") {
        if (body != "")
            return false;
        if (path == "/connections")
            return true;
        return length(clash_http_path_segments(path, "/connections/")) == 1;
    }

    if (method == "PUT") {
        if (path == "/providers/rules")
            return body == "";
        if (length(clash_http_path_segments(path, "/providers/proxies/")) == 1)
            return body == "";
        if (length(clash_http_path_segments(path, "/proxies/")) != 1)
            return false;
        let payload = parse_json_or_null(body);
        return type(payload) == "object" && length(keys(payload)) == 1 &&
            type(payload.name) == "string" && payload.name != "";
    }

    return false;
}

// Transparent Clash API transport for browsers that cannot reach the
// controller directly (HTTPS pages, a firewalled controller port, CORS).
// The original status and body are returned untouched so the caller sees the
// same result it would have seen from a direct request.
function clash_http(method, path, body) {
    method = uc(as_string(method));
    path = as_string(path);
    body = as_string(body);

    if (!clash_http_allowed(method, path, body)) {
        warn("Clash API request is not allowlisted: " + method + " " + path + "\n");
        return 1;
    }

    let args = [
        "curl", "-sS", "--path-as-is",
        "--connect-timeout", "3", "--max-time", as_string(CLASH_HTTP_MAX_TIME),
        "-X", method
    ];
    for (let item in clash_auth_args())
        push(args, item);
    if (body != "") {
        push(args, "--header");
        push(args, "Content-Type: application/json");
        push(args, "--data-raw");
        push(args, body);
    }
    push(args, "-w");
    push(args, CLASH_HTTP_STATUS_MARKER + "%{http_code}");
    push(args, clash_api_url() + path);

    let result = command_capture(command_from_args(args));
    // The status marker is appended after the body, so the last field is the
    // HTTP status and everything before it is the untouched response body.
    let parts = split(result.output, CLASH_HTTP_STATUS_MARKER);
    if (result.status != 0 || length(parts) < 2) {
        warn("Clash API request failed: " + method + " " + path + "\n");
        return result.status != 0 ? result.status : 1;
    }

    let status = int(parts[length(parts) - 1], 10) || 0;
    if (status < 100 || status > 599) {
        warn("Clash API returned no HTTP status: " + method + " " + path + "\n");
        return 1;
    }

    write_json({
        status: status,
        body: join(CLASH_HTTP_STATUS_MARKER, slice(parts, 0, length(parts) - 1))
    });
    return 0;
}

function print_global(message) {
    print(as_string(message), "\n");
}

function render_or_fail(mode_args, input, fail_message, ok_statuses) {
    let result = status_capture(mode_args, input);
    if (result.output != "")
        print(result.output);
    for (let status in ok_statuses)
        if (result.status == status)
            return result.status;
    print_global(fail_message);
    return result.status;
}

function global_check(arg1, arg2) {
    let visibility = as_string(arg2 || "masked");
    if (as_string(arg1) == "raw" || as_string(arg1) == "masked")
        visibility = as_string(arg1);

    print_global("📡 Global check run!");
    print_global("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    print_global("🛠️ System info");

    let system_info_json = sprintf("%J", build_system_info());
    render_or_fail([ "global-system-info" ], system_info_json, "❌ Failed to parse system info", [ 0 ]);

    print_global("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    print_global("➡️ DNS status");

    let dns_check_capture = command_capture(command_from_args(module_args(LIB_DIR + "/diagnostics/runtime.uc", [ "check-dns-available" ])));
    if (dns_check_capture.output != "") {
        let dns_render = render_or_fail(
            [ "global-dns-check", bool_option(settings(), "dont_touch_dhcp", false) ? "1" : "0" ],
            dns_check_capture.output,
            "❌ Failed to parse DNS info",
            [ 0, 10 ]
        );
        if (dns_render == 10)
            print(status_output([ "dhcp-dnsmasq-config", "/etc/config/dhcp" ], null));
    }
    else
        print_global("❌ Failed to get DNS info");

    print_global("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    print_global("📦 Sing-box status");
    let singbox_check_json = command_capture(command_from_args(module_args(LIB_DIR + "/diagnostics/runtime.uc", [ "check-sing-box" ]))).output;
    if (singbox_check_json != "")
        render_or_fail([ "global-sing-box-check" ], singbox_check_json, "❌ Failed to parse sing-box info", [ 0 ]);
    else
        print_global("❌ Failed to get sing-box info");

    print_global("---------------------------");
    print_global("Inbounds checks");
    let inbounds_check_json = command_capture(command_from_args(module_args(LIB_DIR + "/diagnostics/runtime.uc", [ "check-inbounds" ]))).output;
    if (inbounds_check_json != "")
        render_or_fail([ "global-inbounds-check" ], inbounds_check_json, "[FAIL] Failed to parse inbounds check details", [ 0 ]);
    else
        print_global("[FAIL] Failed to get inbounds info");

    print_global("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    print_global("🧱 NFT rules status");
    let nft_check_json = command_capture(command_from_args(module_args(LIB_DIR + "/diagnostics/runtime.uc", [ "check-nft-rules" ]))).output;
    if (nft_check_json != "") {
        let nft_render = render_or_fail([ "global-nft-check" ], nft_check_json, "❌ Failed to parse NFT rules info", [ 0 ]);
        if (nft_render == 0 && status_success([ "global-nft-other-mark-exists" ], nft_check_json))
            print(status_output([ "nft-ruleset-other-mark-lines", NFT_TABLE_NAME ], command_output_from_args([ "nft", "list", "ruleset" ])));
    }
    else
        print_global("❌ Failed to get NFT rules info");

    print_global("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    print_global("📄 Forkop config");
    show_config(visibility);

    print_global("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    print_global("📄 WAN config");
    if (uci_show("network.wan")) {
        if (visibility == "raw")
            print(as_string(fs.readfile("/etc/config/network")));
        else
            print(status_output([ "wan-config-masked", "/etc/config/network" ], null));
    }
    else
        print_global("❌ WAN configuration not found");

    let network_show = network_show_data();
    for (let line in split(status_output([ "network-endpoint-host-warnings", CLOUDFLARE_OCTETS ], network_show), "\n")) {
        if (line == "")
            continue;
        let fields = split(line, "\t");
        if (length(fields) < 2)
            continue;
        if (fields[0] == "engage")
            print_global("⚠️ WARP detected: " + fields[1]);
        else if (fields[0] == "prefix") {
            print_global("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            print_global("⚠️ WARP detected: " + fields[1]);
        }
    }

    for (let peer_section in split(status_output([ "network-wireguard-route-allowed-peers" ], network_show), "\n")) {
        peer_section = as_string(peer_section);
        if (peer_section == "")
            continue;
        let default_routes = allowed_ips_default_routes(uci_get(peer_section + ".allowed_ips"));
        if (length(default_routes) > 0) {
            print_global("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            print_global("⚠️ WG Route allowed IP enabled with " + join(", ", default_routes));
        }
    }

    if (file_executable("/etc/init.d/zapret") && command_success_from_args([ "/etc/init.d/zapret", "status" ])) {
        print_global("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        print_global("⚠️ Standalone zapret service is active. Forkop uses separate queues, but packet-level policy overlap is possible.");
    }
    else if (file_executable("/etc/init.d/zapret") && command_success_from_args([ "/etc/init.d/zapret", "enabled" ])) {
        print_global("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        print_global("⚠️ Standalone zapret autostart is enabled. Forkop will not modify /etc/config/zapret.");
    }

    if (file_executable("/etc/init.d/zapret2") && command_success_from_args([ "/etc/init.d/zapret2", "status" ])) {
        print_global("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        print_global("⚠️ Standalone zapret2 service is active. Forkop uses separate queues, but packet-level policy overlap is possible.");
    }
    else if (file_executable("/etc/init.d/zapret2") && command_success_from_args([ "/etc/init.d/zapret2", "enabled" ])) {
        print_global("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        print_global("⚠️ Standalone zapret2 autostart is enabled. Forkop will not modify /etc/config/zapret2.");
    }

    print_global("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    print_global("🥸 FakeIP status");
    let fakeip_check_json = command_capture(command_from_args(module_args(LIB_DIR + "/diagnostics/runtime.uc", [ "check-fakeip" ]))).output;
    if (fakeip_check_json != "")
        render_or_fail([ "global-fakeip-check" ], fakeip_check_json, "❌ Failed to parse FakeIP info", [ 0 ]);
    else
        print_global("❌ Failed to get FakeIP info");

    return 0;
}

let mode = ARGV[0] || "";

if (mode == "check-proxy")
    exit(check_proxy());
else if (mode == "check-nft-rules")
    exit(check_nft_rules());
else if (mode == "check-sing-box")
    exit(check_sing_box());
else if (mode == "sing-box-standard-ports-listening-fixture")
    sing_box_standard_ports_listening_fixture();
else if (mode == "dns-check-resolve-host-fixture") {
    let address = dns_check_resolve_host(ARGV[1], ARGV[2], ARGV[3]);
    if (address == "")
        exit(1);
    print(address, "\n");
}
else if (mode == "check-inbounds-config")
    exit(check_inbounds_config());
else if (mode == "check-inbounds")
    exit(check_inbounds());
else if (mode == "check-fakeip")
    exit(check_fakeip());
else if (mode == "check-provider-runtime")
    exit(check_provider_runtime(ARGV[1]));
else if (mode == "clash-http")
    exit(clash_http(ARGV[1], ARGV[2], ARGV[3]));
else if (mode == "show-config")
    exit(show_config(ARGV[1] || "masked"));
else if (mode == "show-version")
    exit(show_version());
else if (mode == "show-sing-box-config")
    exit(show_sing_box_config(ARGV[1] || "masked"));
else if (mode == "get-status")
    exit(get_status());
else if (mode == "get-sing-box-status")
    exit(get_sing_box_status());
else if (mode == "get-provider-status")
    exit(get_provider_status(ARGV[1]));
else if (mode == "get-system-info")
    exit(get_system_info());
else if (mode == "check-dns-available")
    exit(check_dns_available());
else if (mode == "global-check")
    exit(global_check(ARGV[1] || "", ARGV[2] || ""));
else if (mode == "validate-provider-strategy-json")
    exit(validate_provider_strategy_json(ARGV[1], ARGV[2] || ""));
else {
    warn("Usage: diagnostics/runtime.uc <operation> ...\n");
    exit(1);
}
