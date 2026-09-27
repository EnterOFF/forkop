// The checks of the Diagnostics tab and the global report built from them. Every
// check answers from the router as it is; nothing is kept between two calls.

let fs = require("fs");
let common = require("core.common");
let exec = require("core.exec");
let constants = require("core.constants");
let core_ip = require("core.ip");
let core_url = require("core.url");
let core_version = require("core.version");
let uci = require("core.uci");
let netstat = require("core.netstat");
let packages = require("core.packages");
let runtime_dns = require("singbox.dns");
let singbox_constants = require("singbox.constants");
let singbox_runtime = require("singbox.runtime");
let config_status = require("singbox.config_status");
let runtime_servers = require("singbox.servers");
let features = require("singbox.features");
let health = require("service.health");
let lock = require("service.lock");
let mask = require("diagnostics.mask");
let inbounds_check = require("diagnostics.inbounds");
let report = require("diagnostics.report");
let firewall = require("diagnostics.firewall");
let proxy_check = require("diagnostics.check_proxy");

const CONFIG_NAME = "forkop";
const NFT_TABLE = constants.NFT_TABLE_NAME;
const DNS_INBOUND = singbox_constants.DNS_INBOUND_ADDRESS;
// The public endpoint reports the address that reached it under /check; the
// proxy check and the counter probe both use it.
const CHECK_PROXY_DOMAIN = singbox_constants.CHECK_PROXY_IP_DOMAIN;
const CHECK_PROXY_URL = "https://" + CHECK_PROXY_DOMAIN + "/check";
const FAKEIP_TEST_DOMAIN = singbox_constants.FAKEIP_TEST_DOMAIN;
// The first two octets of the ranges Cloudflare answers from, which is how a
// WARP exit is told apart from any other.
const CLOUDFLARE_OCTETS = [ "8.47", "162.159", "188.114" ];
const STABLE_MIN_AGE = 2;
const SEPARATOR = "━━━━━━━━━━━━━━━━━━━━━━━━━━━";

let paths = {
    forkop_config: "/etc/config/forkop",
    luci_view: constants.FORKOP_LUCI_VIEW_DIR,
    // A check that died leaves its lock; the next one may take it over at once,
    // because a check runs from a click and is cheap to repeat.
    check_proxy_lock: "/var/run/forkop/check-proxy.lock",
    check_proxy_dir: singbox_constants.TMP_SING_BOX_FOLDER,
    rc_dir: "/etc/rc.d",
    sing_box_init: "/etc/init.d/sing-box"
};

function settings() {
    return uci.get_all(CONFIG_NAME, "settings") ?? {};
}

function sing_box_config() {
    return common.read_json_file(common.option(settings(), "config_path", ""));
}

function executable(path) {
    return ((fs.stat(path)?.mode ?? 0) & 0111) != 0;
}

function has_command(name) {
    return exec.ok([ "sh", "-c", "command -v \"$1\"", "sh", name ]);
}

function output(argv) {
    return exec.output(argv) ?? "";
}

function first_ipv4(text) {
    for (let line in split(text, "\n"))
        if (core_ip.valid_ipv4(trim(line)))
            return trim(line);
    return "";
}

function status() {
    let running = health.forkop_stably_running(constants.RT_TABLE_NAME, NFT_TABLE, constants.NFT_FAKEIP_MARK, STABLE_MIN_AGE) ? 1 : 0;
    let enabled = executable(paths.rc_dir + "/S99forkop") ? 1 : 0;
    return { running, enabled, status: health.service_status_text(running, enabled) };
}

// The package holding the core, or "" without one. While postinst starts Forkop
// the package manager can be locked, and the version the core package records
// still proves which core is installed.
function sing_box_package() {
    for (let name in [ "sing-box-forkop-compressed", "sing-box-forkop" ])
        if (packages.installed(name))
            return name;
    return packages.sing_box_version() != "" && has_command("sing-box") ? "sing-box-forkop" : "";
}

function luci_app_version() {
    let data = fs.readfile(paths.luci_view + "/main.js");
    if (data == null)
        return "not installed";
    let matched = match(data, /(^|\n)[ \t]*var[ \t]+FORKOP_LUCI_APP_VERSION[ \t]*=[ \t]*"([^"]*)"/);
    return matched ? matched[2] : "";
}

function openwrt_release() {
    let matched = match(fs.readfile("/etc/os-release") ?? "", /(^|\n)OPENWRT_RELEASE=["']?([^"'\n]*)/);
    return matched && matched[2] != "" ? matched[2] : "unknown";
}

function system_info() {
    let package_name = sing_box_package();
    let version = package_name == "" ? "not installed" : (singbox_runtime.version() || "unknown");
    return {
        forkop_version: constants.FORKOP_VERSION,
        forkop_latest_version: common.read_first_line("/tmp/forkop.latest-version.cache") || "unknown",
        luci_app_version: luci_app_version(),
        sing_box_version: version,
        sing_box_compressed: package_name == "sing-box-forkop-compressed" ? 1 : 0,
        openwrt_version: openwrt_release(),
        device_model: common.read_first_line("/tmp/sysinfo/model") || "unknown",
        generated_at: common.now_seconds()
    };
}

// The same questions the start asks: the version it would refuse, and the
// listeners the readiness wait looks for.
function sing_box() {
    let installed = sing_box_package() != "" && has_command("sing-box");
    let version = packages.sing_box_version();
    let service = fs.stat(paths.sing_box_init) != null;
    return {
        sing_box_installed: installed ? 1 : 0,
        sing_box_version_ok: installed && version != "" && core_version.version_at_least(version, constants.SB_REQUIRED_VERSION) ? 1 : 0,
        sing_box_clash_api: installed && features.available(features.REQUIRED) ? 1 : 0,
        sing_box_service_exist: service ? 1 : 0,
        sing_box_autostart_disabled: service && !exec.ok([ paths.sing_box_init, "enabled" ]) ? 1 : 0,
        sing_box_process_running: health.sing_box_service_running() ? 1 : 0,
        sing_box_ports_listening: health.sing_box_runtime_ports_ready() ? 1 : 0
    };
}

function wan_addresses() {
    let result = [];
    let add = (address) => { if (address != "" && index(result, address) < 0) push(result, address); };

    for (let name in [ "wan", "wwan" ]) {
        let interface_status = common.parse_json(exec.output([ "ubus", "-S", "call", "network.interface." + name, "status" ]));
        for (let key in [ "ipv4-address", "ipv6-address" ])
            for (let item in interface_status?.[key] ?? [])
                add(common.as_string(item?.address));
    }

    // The addresses of whatever device the default routes leave through, which
    // is how a WAN that is not called wan is found.
    for (let family in [ [ "-4", /(^|\n)[ \t]*inet[ \t]+([0-9.]+)\//g ], [ "-6", /(^|\n)[ \t]*inet6[ \t]+([^\/ \t]+)\//g ] ]) {
        let device = match(output([ "ip", family[0], "route", "show", "default" ]), /[ \t]dev[ \t]+([^ \t\n]+)/);
        if (device == null)
            continue;
        let argv = [ "ip", family[0], "addr", "show", "dev", device[1] ];
        if (family[0] == "-6")
            push(argv, "scope", "global");
        for (let found in match(output(argv), family[1]) ?? [])
            add(found[2]);
    }
    return join(" ", result);
}

// A port that a firewall rule or one of Forkop's own server accepts opens.
function firewall_open(port, required_proto, input_chain) {
    return firewall.required_protocols_open(uci.section_objects("firewall", "rule"), port, required_proto) ||
        firewall.forkop_accepts_port(input_chain, singbox_constants.SERVER_FIREWALL_COMMENT, port, required_proto);
}

function resolve_host(host) {
    host = replace(host, /^\[(.*)\]$/, "$1");
    if (host == "" || core_ip.valid_ipv4(host) || core_ip.valid_ipv6(host))
        return host;
    let found = {};
    for (let line in split(output([ "dig", "+short", "A", host, "+timeout=2", "+tries=1" ]) +
        output([ "dig", "+short", "AAAA", host, "+timeout=2", "+tries=1" ]), "\n")) {
        line = trim(line);
        if (core_ip.valid_ipv4(line) || core_ip.valid_ipv6(line))
            found[line] = true;
    }
    return join(" ", sort(keys(found)));
}

function inbounds_config() {
    return { enabled_count: length(filter(uci.section_objects(CONFIG_NAME, "server"), (s) => common.bool_option(s, "enabled", false))) };
}

// Every enabled server: what UCI asks for, what the generated configuration
// holds, whether it listens, and whether it can be reached. The router state is
// read once for all of them.
function inbounds() {
    let config_path = common.option(settings(), "config_path", "");
    let config = common.read_json_file(config_path);
    let wan_ip = wan_addresses();
    let wan_public = length(filter(common.words(wan_ip), (ip) => core_ip.valid_public_ip(ip))) > 0 ? 1 : 0;
    let listeners = output([ "netstat", "-ln" ]);
    let owners = output([ "netstat", "-lnp" ]);
    let input_chain = null;
    let items = [];

    for (let section in uci.section_objects(CONFIG_NAME, "server")) {
        if (!common.bool_option(section, "enabled", false))
            continue;

        let name = section[".name"];
        let label = common.option(section, "label", name);
        let protocol = common.option(section, "protocol", "vless");
        let listen = common.option(section, "listen", "0.0.0.0");
        let port = common.option(section, "listen_port", "");
        let public_host = common.option(section, "public_host", "");
        let required_proto = protocol == "json_inbound" ? "" : join(" ", runtime_servers.listen_transports(section));
        let expected_type = inbounds_check.runtime_type(protocol);
        let runtime = config_status.summary(config, protocol == "tailscale" ? "endpoints" : "inbounds", label);

        let listening = -1, firewall_required = 0, firewall_is_open = -1, conflict_owners = "";
        if (protocol != "tailscale" && protocol != "json_inbound") {
            let found = [];
            for (let proto in common.words(required_proto))
                push(found, ...netstat.port_conflict_owners(owners, listen, port, proto));
            conflict_owners = join(" ", netstat.sorted_unique(found));
            listening = length(filter(common.words(required_proto), (proto) => !netstat.port_listening(listeners, listen, port, proto))) == 0 ? 1 : 0;
            if (inbounds_check.listen_requires_firewall(listen, wan_ip)) {
                input_chain ??= output([ "nft", "list", "chain", "inet", "fw4", "input" ]);
                firewall_required = 1;
                firewall_is_open = firewall_open(port, required_proto, input_chain) ? 1 : 0;
            }
        }

        let host_ips = protocol == "json_inbound" ? "" : resolve_host(public_host);
        let flags = inbounds_check.public_host_flags(public_host, host_ips, wan_ip, wan_public);
        push(items, {
            section: name,
            label,
            protocol,
            routing_mode: common.option(section, "routing_mode", "rules"),
            tag: label,
            listen,
            listen_port: int(port || 0),
            public_host,
            public_host_ips: host_ips,
            expected_type,
            required_proto,
            runtime_exists: runtime.exists,
            runtime_type: runtime.type ?? "",
            runtime_listen: runtime.listen ?? "",
            runtime_port: runtime.listen_port ?? 0,
            runtime_ok: inbounds_check.runtime_ok(protocol, "" + runtime.exists, runtime.type ?? "", runtime.listen ?? "",
                "" + (runtime.listen_port ?? 0), expected_type, listen, port),
            listening,
            firewall_required,
            firewall_open: firewall_is_open,
            port_conflict: conflict_owners != "" ? 1 : 0,
            port_conflict_owners: conflict_owners,
            routes_configured: config_status.routes_inbound(config, label) ? 1 : 0,
            public_host_resolved: flags.resolved,
            public_host_public: flags.public_ip,
            public_host_matches_wan: flags.matches_wan
        });
    }
    return { enabled_count: length(items), config_path, wan_ip, wan_public, items };
}

function dig_answers(server, domain) {
    return exec.ok([ "dig", "@" + server, domain, "+timeout=2", "+tries=1" ]);
}

// The first IPv4 address a plain resolver gives for the host, or "" when it gives
// none or is an encrypted one dig cannot ask.
function resolve_through(host, resolver) {
    if (host == "" || core_ip.valid_ipv4(host))
        return host;
    let parsed = runtime_dns.parse_server_uri(resolver, true);
    if (resolver == "" || parsed.unsupported || (parsed.type != "udp" && parsed.type != "tcp"))
        return "";
    let argv = [ "dig", "@" + parsed.server, "-p", "" + parsed.server_port ];
    if (parsed.type == "tcp")
        push(argv, "+tcp");
    push(argv, host, "A", "+short", "+timeout=2", "+tries=1");
    return first_ipv4(output(argv));
}

// Whether the router itself resolves, through its own resolver, the sing-box DNS
// inbound, or the address clients are handed.
function router_resolves(domain) {
    if (dig_answers("127.0.0.1", domain) || dig_answers(DNS_INBOUND, domain))
        return true;
    let values = settings();
    let listen = singbox_runtime.listen_address(values);
    if (listen != "" && dig_answers(listen, domain))
        return true;
    for (let name in common.words(common.option(values, "source_network_interfaces", "br-lan"))) {
        let address = singbox_runtime.device_ipv4_address(name);
        if (address != "" && dig_answers(address, domain))
            return true;
    }
    return false;
}

function dns() {
    let values = settings();
    let servers = runtime_dns.server_list(values, "dns_server", "77.88.8.8");
    let bootstraps = runtime_dns.server_list(values, "bootstrap_dns_server", "77.88.8.8");
    let domain = "example.com";
    let dns_status = first_ipv4(output([ "dig", "@" + DNS_INBOUND, domain, "A", "+short", "+timeout=2", "+tries=1" ])) != "" ? 1 : 0;

    // A bootstrap resolver exists to find the main one, so that is what it is
    // asked; an encrypted one dig cannot ask counts as working while DNS does.
    let main_host = core_url.host(servers[0]) || servers[0];
    let bootstrap_domain = main_host != "" && !core_ip.valid_ipv4(main_host) ? main_host : domain;
    let bootstrap_status = 0, encrypted = false;
    for (let server in bootstraps) {
        let parsed = runtime_dns.parse_server_uri(server, true);
        if (!parsed.unsupported && parsed.type != "udp" && parsed.type != "tcp")
            encrypted = true;
        if (resolve_through(bootstrap_domain, server) != "") {
            bootstrap_status = 1;
            break;
        }
    }
    if (!bootstrap_status && encrypted && dns_status)
        bootstrap_status = 1;

    // Unmatched client queries go back to the local resolver, which answers
    // "localhost" from its own data - proof of the resolver, not of its upstream.
    let local_status = first_ipv4(output([ "dig", "@127.0.0.1", "-p", "53", "localhost", "A", "+short", "+timeout=2", "+tries=1" ])) != "" ? 1 : 0;

    return {
        dns_server: join(", ", map(servers, (server) => mask.dns_server(server))),
        dns_status,
        dns_on_router: router_resolves(domain) ? 1 : 0,
        bootstrap_dns_server: join(", ", bootstraps),
        bootstrap_dns_status: bootstrap_status,
        local_dns_server: "127.0.0.1:53",
        local_dns_status: local_status,
        dns_capture_status: exec.ok([ "nft", "list", "chain", "inet", NFT_TABLE, "dns_redirect" ]) ? 1 : 0
    };
}

// The rules of each chain, read from one terse listing of the table: whether
// Forkop put counted rules there and whether any of them ever matched.
function chain_counters(listing) {
    let result = {};
    let chain = null;
    for (let line in split(listing, "\n")) {
        let opened = match(line, /^[ \t]*chain[ \t]+([^ \t{]+)/);
        if (opened) {
            chain = opened[1];
            result[chain] = { exist: 0, counted: 0 };
            continue;
        }
        if (chain != null && index(line, "counter") >= 0) {
            result[chain].exist = 1;
            if (index(line, "packets 0 bytes 0") < 0)
                result[chain].counted = 1;
        }
    }
    return result;
}

// Whether a table other than Forkop's sets marks, which would take packets
// before the capture sees them.
function foreign_mark_rules(ruleset) {
    let table = "";
    for (let line in split(ruleset, "\n")) {
        let opened = match(line, /^table[ \t]+([^ \t]+)[ \t]+([^ \t{]+)/);
        if (opened) {
            table = opened[1] + " " + opened[2];
            continue;
        }
        if (table != "inet " + NFT_TABLE && index(line, "mark set") >= 0)
            return true;
    }
    return false;
}

function nft_rules() {
    // Traffic to both probe endpoints first, so the counters have something to count.
    exec.status([ "sh", "-c", "curl -m 3 -s \"$1\" >/dev/null 2>&1 & curl -m 3 -s \"$2\" >/dev/null 2>&1 & wait; sleep 1",
        "sh", CHECK_PROXY_URL, "https://" + FAKEIP_TEST_DOMAIN + "/check" ]);

    let listing = exec.capture([ "nft", "-t", "list", "table", "inet", NFT_TABLE ]);
    let chains = listing.status == 0 ? chain_counters(listing.stdout) : {};
    let flag = (chain, key) => chains[chain]?.[key] ?? 0;
    return {
        table_exist: listing.status == 0 ? 1 : 0,
        rules_mangle_exist: flag("mangle", "exist"),
        rules_mangle_counters: flag("mangle", "counted") || flag("priority_rules", "counted"),
        rules_mangle_output_exist: flag("mangle_output", "exist"),
        rules_mangle_output_counters: flag("mangle_output", "counted"),
        rules_proxy_exist: flag("proxy", "exist"),
        rules_proxy_counters: flag("proxy", "counted"),
        rules_other_mark_exist: foreign_mark_rules(output([ "nft", "-t", "list", "ruleset" ])) ? 1 : 0
    };
}

function in_prefix(address, cidr) {
    let parts = split(cidr, "/");
    let a = iptoarr(address), b = iptoarr(parts[0]);
    if (a == null || b == null || length(a) != length(b))
        return false;
    let bits = int(parts[1]);
    for (let i = 0; bits > 0; i++, bits -= 8) {
        let mask_byte = bits >= 8 ? 255 : (255 << (8 - bits)) & 255;
        if ((a[i] & mask_byte) != (b[i] & mask_byte))
            return false;
    }
    return true;
}

function fakeip() {
    let ipv4 = first_ipv4(output([ "dig", "+short", "@" + DNS_INBOUND, FAKEIP_TEST_DOMAIN, "A", "+timeout=2", "+tries=1" ]));
    let ipv6 = "";
    for (let line in split(output([ "dig", "+short", "@" + DNS_INBOUND, FAKEIP_TEST_DOMAIN, "AAAA", "+timeout=2", "+tries=1" ]), "\n"))
        if (ipv6 == "" && core_ip.valid_ipv6(lc(trim(line))))
            ipv6 = lc(trim(line));
    return {
        fakeip: (ipv4 != "" && in_prefix(ipv4, singbox_constants.FAKEIP_INET4_RANGE)) || (ipv6 != "" && in_prefix(ipv6, singbox_constants.FAKEIP_INET6_RANGE)),
        IP: ipv4 || ipv6,
        IPv4: ipv4,
        IPv6: ipv6
    };
}

function show_config(visibility) {
    let data = fs.readfile(paths.forkop_config);
    if (data == null)
        return null;
    return visibility == "raw" ? data : mask.forkop_config(data);
}

function show_sing_box_config(visibility) {
    let path = common.option(settings(), "config_path", "");
    let data = fs.readfile(path);
    if (data == null)
        return null;
    return visibility == "raw" ? data : sprintf("%J\n", mask.sing_box_config(common.parse_json(data)));
}

function proxy_ip_through_running_core() {
    let response = output([ "curl", "--connect-timeout", "3", "--max-time", "10", "--fail", "--silent", "--show-error",
        "--proxy", "socks5h://" + singbox_constants.SERVICE_MIXED_INBOUND_ADDRESS + ":" + singbox_constants.SERVICE_MIXED_INBOUND_PORT, CHECK_PROXY_URL ]);
    let ip = mask.proxy_response_ip(response);
    return ip == null || ip == "" ? [ false, "Failed to get a valid IP through the running sing-box service" ] : [ true, ip + " - should match proxy IP" ];
}

// A second sing-box beside the running one can exhaust the memory of a small
// router, so a running core is asked through its mixed inbound; only without
// one does a throwaway core fetch the check address.
function proxy_ip(config_path) {
    if (singbox_runtime.process_running())
        return proxy_ip_through_running_core();
    if (!exec.ok([ "sing-box", "-c", config_path, "check" ]))
        return [ false, "Invalid configuration" ];

    let now = clock();
    let dir = sprintf("%s/check-proxy-%d-%d", paths.check_proxy_dir, now[0], now[1]);
    let prepared = proxy_check.prepare_config(common.read_json_file(config_path), dir + "/cache.db");
    if (!common.ensure_dir(dir) || !common.write_file(dir + "/config.json", sprintf("%J\n", prepared)))
        return [ false, "Failed to prepare temporary configuration" ];

    let argv = [ "sing-box", "tools", "fetch", CHECK_PROXY_URL, "-c", dir + "/config.json", "-D", dir, "--disable-color" ];
    let tag = proxy_check.outbound_tag(prepared, CHECK_PROXY_DOMAIN);
    if (tag != "")
        push(argv, "-o", tag);
    // The fetch has no timeout of its own.
    if (has_command("timeout"))
        argv = [ "timeout", "15", ...argv ];

    let result = [ false, "Failed to get valid IP address after 5 attempts" ];
    for (let attempt = 1; attempt <= 5; attempt++) {
        if (singbox_runtime.process_running()) {
            result = proxy_ip_through_running_core();
            break;
        }
        let response = output(argv);
        if (mask.proxy_response_is_retryable_error(response))
            continue;
        let ip = mask.proxy_response_ip(response);
        if (ip != null && ip != "") {
            result = [ true, ip + " - should match proxy IP" ];
            break;
        }
        if (attempt == 5)
            result = [ false, "Failed to get valid IP address after 5 attempts. " + (response == "" ? "Error: Empty response" : "Error response: " + response) ];
    }
    common.remove_tree(dir);
    return result;
}

// Prints what it found, for a person at a shell.
function check_proxy() {
    let owner = common.own_pid();
    if (!lock.acquire(paths.check_proxy_lock, owner, 5)) {
        print("A proxy check is already running\n");
        return 1;
    }
    let config_path = common.option(settings(), "config_path", "");
    let result = !has_command("sing-box") ? [ false, "sing-box is not installed" ]
        : fs.stat(config_path) == null ? [ false, "Configuration file not found" ]
        : proxy_ip(config_path);
    lock.release(paths.check_proxy_lock, owner);
    print(result[1], "\n");
    return result[0] ? 0 : 1;
}

// The WARP client hides behind a plain WireGuard peer, recognised by the
// Cloudflare enrolment host or an endpoint inside a Cloudflare prefix; and a
// peer that routes its allowed IPs by default sends everything past Forkop.
function network_warnings() {
    let result = [];
    let prefixes = CLOUDFLARE_OCTETS;
    for (let section in uci.section_objects("network", null)) {
        if (substr(section[".type"] ?? "", 0, 10) != "wireguard_")
            continue;
        let host = common.option(section, "endpoint_host", "");
        if (host == "engage.cloudflareclient.com" || index(prefixes, join(".", slice(split(host, "."), 0, 2))) >= 0)
            push(result, "⚠️ WARP detected: " + host);
        let defaults = filter(common.list_option(section, "allowed_ips"), (ip) => ip == "0.0.0.0/0" || ip == "::/0");
        if (common.option(section, "route_allowed_ips", "0") == "1" && length(defaults) > 0)
            push(result, "⚠️ WG Route allowed IP enabled with " + join(", ", defaults));
    }
    return result;
}

function global_check(first, second) {
    let visibility = first == "raw" || first == "masked" ? first : (second || "masked");
    let lines = [ "📡 Global check run!", SEPARATOR, "🛠️ System info", ...report.system_info(system_info()), SEPARATOR, "➡️ DNS status" ];

    let dns_render = report.dns_check(dns());
    push(lines, ...dns_render.lines);
    if (dns_render.dump_dhcp_config)
        push(lines, ...report.dnsmasq_config(mask.config_lines(fs.readfile("/etc/config/dhcp"))));

    push(lines, SEPARATOR, "📦 Sing-box status", ...report.sing_box_check(sing_box()),
        "---------------------------", "Inbounds checks", ...report.inbounds_check(inbounds()),
        SEPARATOR, "🧱 NFT rules status");
    let nft_value = nft_rules();
    push(lines, ...report.nft_check(nft_value));
    if (nft_value.rules_other_mark_exist == 1)
        push(lines, ...report.nft_other_mark_lines(output([ "nft", "-t", "list", "ruleset" ]), NFT_TABLE));

    push(lines, SEPARATOR, "📄 Forkop config");
    print(join("\n", lines), "\n");
    print(show_config(visibility) ?? "Configuration file not found\n");

    lines = [ SEPARATOR, "📄 WAN config" ];
    let network = fs.readfile("/etc/config/network");
    if (uci.get_all("network", "wan") != null)
        print(join("\n", lines), "\n", visibility == "raw" ? network : mask.wan_config(network));
    else
        print(join("\n", [ ...lines, "❌ WAN configuration not found" ]), "\n");

    lines = [];
    for (let warning in network_warnings())
        push(lines, SEPARATOR, warning);
    push(lines, SEPARATOR, "🥸 FakeIP status", ...report.fakeip_check(fakeip()));
    print(join("\n", lines), "\n");
    return 0;
}

function logs(kind) {
    return exec.output([ "logread", "-e", kind == "sing-box" ? "sing-box" : "forkop\\|sing-box" ]) ?? "";
}

return {
    paths, status, system_info, sing_box, inbounds_config, inbounds, dns, nft_rules, fakeip,
    show_config, show_sing_box_config, check_proxy, global_check, logs, foreign_mark_rules, in_prefix
};
