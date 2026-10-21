let t = require("t");
let stub = require("stub");
let repo = require("repo");
let fs = require("fs");

const DEFAULT_CONFIG = repo.path("forkop/files/etc/config/forkop");

function migration_targeting(default_config) {
    stub.env({ FORKOP_DEFAULT_CONFIG_PATH: default_config });
    let migration = stub.fresh("config.migration");
    stub.restore();
    return migration;
}

let migration = migration_targeting(DEFAULT_CONFIG);

function run_mode(module, mode, data, source) {
    let path = stub.tmpdir() + "/fixture.json";
    fs.writefile(path, sprintf("%J", data));
    stub.commands([
        [ "logger", {} ],
        // The default X-HWID a subscription is fetched with is a hash of the router.
        [ /| md5sum$/, { stdout: "0123456789abcdef0123456789abcdef  -
" } ]
    ]);
    let run = stub.capture(() => module.main([ mode, path, source ?? "forkop" ]));
    stub.restore();
    return { status: run.result, out: run.stdout == "" ? null : json(run.stdout), error: run.stderr };
}

function migrate(data, source, module) {
    return run_mode(module ?? migration, "migrate-fixture", data, source);
}

function migrated(data, source) {
    let run = migrate(data, source);
    t.eq(run.status, 0, run.error);
    return run.out;
}

function settings(version, extra) {
    return { ".name": "settings", ".type": "settings", config_version: version, ...(extra ?? {}) };
}

function by_name(list) {
    let result = {};
    for (let item in list ?? [])
        result[item[".name"]] = item;
    return result;
}

function absent(item, keys, label) {
    for (let key in keys)
        t.ok(!exists(item, key), (label ?? item[".name"] ?? "settings") + " kept " + key);
}

/* ------------------------------------------------ a full 1.0.2 configuration */

const FULL_1_0_2 = {
    settings: settings("1.0.2", {
        applied_migrations: [ "interface_sections", "enable_component_checks" ],
        dns_type: "doh",
        dns_server: [ "dns.google/dns-query", "1.1.1.1:444/custom" ],
        bootstrap_dns_server: [ "1.1.1.1", "[2606:4700:4700::1111]:5353" ],
        dns_check_interval: "10s", dns_recovery_check_interval: "60s", dns_check_timeout: "2s",
        dont_touch_dhcp: "1", shutdown_correctly: "0",
        dns_detour_enabled: "1", dns_detour_section: "zap",
        download_lists_via_proxy: "1", download_lists_via_proxy_section: "zap"
    }),
    section: [
        {
            ".name": "main", ".type": "section", label: "Main/Primary", enabled: "1", action: "connection",
            domain_ip_lists: [ "existing" ], local_domain_lists: [ "local" ],
            remote_domain_lists: [ "remote-domain" ], remote_subnet_lists: [ "remote-subnet" ],
            dashboard_filter_mode: "include", dashboard_detect_server_country: "1",
            dashboard_include_countries: [ "DE" ], dashboard_include_outbounds: [ "Primary" ],
            dashboard_include_regex: [ "primary" ], dashboard_include_proxy_parameters: [ "grpc" ],
            dashboard_include_protocols: [ "vless" ], dashboard_include_transports: [ "ws" ],
            dashboard_include_securities: [ "tls" ], dashboard_include_groups: [ "Fastest" ],
            dashboard_exclude_countries: [ "US" ], dashboard_exclude_outbounds: [ "Backup" ],
            dashboard_exclude_regex: [ "backup" ], dashboard_exclude_proxy_parameters: [ "grpc" ],
            dashboard_exclude_protocols: [ "trojan" ], dashboard_exclude_transports: [ "grpc" ],
            dashboard_exclude_securities: [ "reality" ], dashboard_exclude_groups: [ "Backup" ],
            detect_server_country: "1",
            include_urltest_groups: "1", hide_urltest_group_outbounds: "1", hide_detour_outbounds: "1",
            include_proxy_parameters: [ "grpc" ], include_protocols: [ "vless" ],
            include_transports: [ "ws" ], include_securities: [ "tls" ],
            exclude_proxy_parameters: [ "udp" ], exclude_protocols: [ "trojan" ],
            exclude_transports: [ "grpc" ], exclude_securities: [ "reality" ],
            urltest_exclude_proxy_parameters: [ "ws" ], urltest_include_protocols: [ "vless" ],
            sort_by_latency: "1", resolve_real_ip_for_routing: "1",
            mixed_proxy_enabled: "1", mixed_proxy_port: "2080", mixed_proxy_auth_enabled: "1",
            mixed_proxy_username: "Ivan Petrov", mixed_proxy_password: "proxy-secret",
            outbound_detour_enabled: "1", outbound_detour_section: "zap",
            domain: "example.com # the site\nkeyword:video", ip_cidr: "192.0.2.0/24\n2001:db8::/32"
        },
        {
            ".name": "dns_rule", ".type": "section", label: "DNS", action: "dns",
            dns_type: "dot", dns_server: "9.9.9.9:5353",
            domain_ip_lists: [ "dns-existing" ], remote_domain_lists: [ "dns-remote" ],
            domain: "example.org", ip_cidr: "198.51.100.1"
        },
        {
            ".name": "zap", ".type": "section", label: "Zapret", enabled: "1", action: "zapret",
            nfqws_opt: "--filter-tcp=443", domain_list_enabled: "1", domain_list: [ "hetzner" ],
            user_domain_list_type: "text", user_domains: "example.org", user_domains_text: "example.net"
        },
        { ".name": "zap2", ".type": "section", label: "Zapret2", enabled: "1", action: "zapret2", nfqws2_opt: "--filter-tcp=443" },
        { ".name": "bye", ".type": "section", label: "ByeDPI", enabled: "1", action: "byedpi", byedpi_cmd_opts: "--auto=t,r,a,s" }
    ],
    subscription_url: [
        {
            ".name": "sub", ".type": "subscription_url", section: "main", url: "https://sub.example",
            auto_user_agent: "0", user_agent: "Custom Agent", auto_hwid: "0", hwid: "CUSTOM-HWID",
            filter_mode: "include", include_countries: [ "DE" ], include_proxy_parameters: [ "grpc" ],
            include_protocols: [ "vless" ], include_transports: [ "ws" ], include_securities: [ "tls" ],
            exclude_protocols: [ "trojan" ], exclude_transports: [ "grpc" ], exclude_securities: [ "reality" ],
            include_urltest_groups: "1", hide_urltest_group_outbounds: "1",
            node_prefix: "Premium", prefix_nodes: "1"
        },
        { ".name": "zap_sub", ".type": "subscription_url", section: "zap", url: "https://zap.example" }
    ],
    section_interface: [
        {
            ".name": "iface", ".type": "section_interface", section: "main", name: "awg0",
            domain_resolver_dns_type: "doh", domain_resolver_dns_server: "dns.example/dns-query",
            domain_resolver_dns_detour_enabled: "1", domain_resolver_dns_detour_section: "zap"
        }
    ],
    urltest: [
        {
            ".name": "fast", ".type": "urltest", section: "main", name: "Fast",
            filter_mode: "include", include_countries: [ "NL" ], detect_server_country: "1",
            exclude_countries: [ "US" ], include_proxy_parameters: [ "grpc" ],
            include_protocols: [ "vless" ], include_transports: [ "ws" ], include_securities: [ "tls" ],
            exclude_proxy_parameters: [ "udp" ], exclude_protocols: [ "trojan" ],
            exclude_transports: [ "grpc" ], exclude_securities: [ "reality" ],
            hide_added_outbounds: "1", pin_dashboard: "1", interrupt_exist_connections: "1"
        }
    ],
    priority_group: [
        {
            ".name": "group", ".type": "priority_group", section: "main", name: "Fallback",
            health_url: "https://example.com/ping", active_check_interval: "30s",
            check_timeout: "2s", recovery_check_interval: "60s", pick_fastest: "1",
            switch_to_faster_same_priority: "1", fastest_check_interval: "5s",
            hide_added_outbounds: "1", pin_dashboard: "1", interrupt_exist_connections: "1"
        }
    ],
    priority_level: [
        {
            ".name": "level", ".type": "priority_level", group: "group", name: "Direct", order: "0",
            direct: "1", country: "US", detect_server_country: "1", include_proxy_parameters: [ "grpc" ]
        }
    ],
    server: [
        {
            ".name": "vless", ".type": "server", label: "VLESS", protocol: "vless",
            server_uuid: "44444444-4444-4444-8444-444444444444", vless_flow: "xtls-rprx-vision",
            reality_handshake_server: "www.apple.com", reality_handshake_server_port: "8443",
            reality_max_time_difference: "1m"
        },
        {
            ".name": "socks", ".type": "server", label: "SOCKS", protocol: "socks",
            socks_auth_enabled: "0", server_username: "Ivan Petrov", server_password: "socks-secret"
        },
        {
            ".name": "ss2022", ".type": "server", label: "SS 2022", protocol: "shadowsocks",
            shadowsocks_method: "2022-blake3-aes-128-gcm", server_password: "ajXWye37k0IsLRrpEhB3pA=="
        },
        {
            ".name": "mtproto", ".type": "server", label: "MTProto", protocol: "mtproto",
            mtproto_secret: "eeaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa676f6f676c652e636f6d",
            mtproto_padding: "1", mtproto_concurrency: "1024", mtproto_idle_timeout: "5m",
            mtproto_domain_fronting_ip: "1.1.1.1", mtproto_domain_fronting_port: "443",
            mtproto_domain_fronting_proxy_protocol: "1", mtproto_prefer_ip: "prefer-ipv4",
            mtproto_auto_update: "1", mtproto_allow_fallback_on_unknown_dc: "1",
            mtproto_tolerate_time_skewness: "3s", mtproto_handshake_timeout: "10s"
        },
        {
            ".name": "legacy_user", ".type": "server", label: "Legacy", protocol: "vless",
            server_users: [ "phone|55555555-5555-4555-8555-555555555555|xtls-rprx-vision" ]
        },
        { ".name": "vmess", ".type": "server", label: "VMess", protocol: "vmess", server_uuid: "66666666-6666-4666-8666-666666666666", vmess_alter_id: "0" },
        { ".name": "trojan", ".type": "server", label: "Trojan", protocol: "trojan", server_password: "trojan-secret" },
        { ".name": "hysteria2", ".type": "server", label: "Hysteria2", protocol: "hysteria2", server_password: "hysteria-secret" },
        {
            ".name": "tailscale", ".type": "server", label: "Tailscale", protocol: "tailscale",
            tailscale_advertise_exit_node: "0", tailscale_accept_routes: "1"
        }
    ]
};

const RETIRED_SECTION_OPTIONS = [
    "dashboard_filter_mode", "dashboard_detect_server_country",
    "dashboard_include_countries", "dashboard_include_outbounds", "dashboard_include_regex",
    "dashboard_include_proxy_parameters", "dashboard_include_protocols", "dashboard_include_transports",
    "dashboard_include_securities", "dashboard_include_groups",
    "dashboard_exclude_countries", "dashboard_exclude_outbounds", "dashboard_exclude_regex",
    "dashboard_exclude_proxy_parameters", "dashboard_exclude_protocols", "dashboard_exclude_transports",
    "dashboard_exclude_securities", "dashboard_exclude_groups",
    "detect_server_country", "include_urltest_groups", "hide_urltest_group_outbounds", "hide_detour_outbounds",
    "include_proxy_parameters", "include_protocols", "include_transports", "include_securities",
    "exclude_proxy_parameters", "exclude_protocols", "exclude_transports", "exclude_securities",
    "urltest_exclude_proxy_parameters", "urltest_include_protocols", "sort_by_latency", "resolve_real_ip_for_routing",
    "mixed_proxy_enabled", "mixed_proxy_port", "mixed_proxy_auth_enabled", "mixed_proxy_username", "mixed_proxy_password"
];

const RETIRED_SERVER_OPTIONS = [
    "server_users", "server_uuid", "server_username", "server_password", "mtproto_secret",
    "vless_flow", "vmess_alter_id", "socks_auth_enabled", "mtproto_padding", "mtproto_concurrency",
    "mtproto_idle_timeout", "mtproto_domain_fronting_ip", "mtproto_domain_fronting_port",
    "mtproto_domain_fronting_proxy_protocol", "mtproto_prefer_ip", "mtproto_auto_update",
    "mtproto_allow_fallback_on_unknown_dc", "mtproto_tolerate_time_skewness", "mtproto_handshake_timeout",
    "reality_handshake_server", "reality_handshake_server_port", "reality_max_time_difference"
];

let full = migrated(FULL_1_0_2);
let config = full.config;
let section = by_name(config.section);
let server = by_name(config.server);

function only_client(server_name) {
    let clients = filter(config.server_client ?? [], (item) => item.server == server_name);
    t.eq(length(clients), 1, server_name + " owns one migrated client");
    return clients[0];
}

t.test("1.0.2 reaches the current schema and loses its retired settings", () => {
    t.ok(full.changed);
    t.eq(config.settings.config_version, "NEXT");
    absent(config.settings, [ "applied_migrations", "dns_type", "dns_check_interval", "dns_recovery_check_interval",
        "dns_check_timeout", "dont_touch_dhcp", "shutdown_correctly" ]);
    t.eq(config.settings.unified_delay, "1", "Unified Delay takes the current default");
});

t.test("DNS servers become URIs that keep their hosts, ports, paths and order", () => {
    t.eq(config.settings.dns_server, [ "https://dns.google/dns-query", "https://1.1.1.1:444/custom" ]);
    t.eq(config.settings.bootstrap_dns_server, [ "1.1.1.1", "[2606:4700:4700::1111]:5353" ], "bootstrap servers stay plain UDP");
    t.eq(section.dns_rule.dns_server, [ "tls://9.9.9.9:5353" ], "a rule's own transport");
    absent(section.dns_rule, [ "dns_type" ]);
});

t.test("a DPI section leaves with its children, and whatever pointed at it is switched off", () => {
    for (let name in [ "zap", "zap2", "bye" ])
        t.eq(section[name], null, name);
    t.eq(filter(config.subscription_url, (item) => item.section == "zap"), []);
    t.eq([ config.settings.dns_detour_enabled, config.settings.dns_detour_section ], [ "0", null ]);
    t.eq([ config.settings.download_lists_via_proxy, config.settings.download_lists_via_proxy_section ], [ "0", null ]);
    t.eq([ section.main.outbound_detour_enabled, section.main.outbound_detour_section ], [ null, null ]);
    t.eq(filter(config.subscription_url, (item) => item.detour_section != null), [], "a cascade through it is gone too");
    let iface = config.section_interface[0];
    t.eq([ iface.domain_resolver_dns_detour_enabled, iface.domain_resolver_dns_detour_section ], [ "0", null ]);
});

t.test("the rule set lists of a section merge in order without duplicates", () => {
    absent(section.main, RETIRED_SECTION_OPTIONS);
    t.eq(sort([ ...section.main.rule_set_with_subnets ]), [ "existing", "local", "remote-domain", "remote-subnet" ]);
    t.eq(length(section.main.rule_set_with_subnets), 4);
    t.eq(section.dns_rule.rule_set, [ "dns-existing", "dns-remote" ], "a DNS rule keeps only domain lists");
});

t.test("a section's domains and addresses become one list of destinations, and a DNS section's addresses go", () => {
    t.eq(section.main.destinations, "example.com # the site\nkeyword:video\n192.0.2.0/24\n2001:db8::/32");
    t.eq(section.dns_rule.destinations, "example.org", "a DNS section never matched an address");
    absent(section.main, [ "domain", "ip_cidr" ]);
    absent(section.dns_rule, [ "domain", "ip_cidr" ]);
});

t.test("a section with addresses only, or with no destinations, is carried over as it is", () => {
    let config = migrated({ settings: settings("1.0.5"), section: [
        { ".name": "addresses", ".type": "section", action: "bypass", ip_cidr: "10.0.0.0/8" },
        { ".name": "listed", ".type": "section", action: "connection", ip_cidr: [ "192.0.2.1", "192.0.2.2" ] },
        { ".name": "none", ".type": "section", action: "connection", community_lists: [ "youtube" ] },
        { ".name": "dns", ".type": "section", action: "dns", dns_server: [ "tls://1.1.1.1" ], ip_cidr: "192.0.2.53" }
    ] }).config;
    let sections = by_name(config.section);
    t.eq(sections.addresses.destinations, "10.0.0.0/8");
    t.eq(sections.listed.destinations, "192.0.2.1\n192.0.2.2");
    t.ok(!exists(sections.none, "destinations"));
    t.ok(!exists(sections.dns, "destinations") && !exists(sections.dns, "ip_cidr"));

    config.settings.config_version = "1.0.5";
    let again = migrated(config);
    t.eq(filter(again.operations, (op) => op.option in [ "destinations", "domain", "ip_cidr" ]), [], "a second pass leaves them alone");
    t.eq(by_name(again.config.section).addresses.destinations, "10.0.0.0/8");
});

t.test("a section's links become links of their own, under the names their servers ran under", () => {
    let vmess = "vmess://" + b64enc(sprintf("%J", { v: "2", ps: "VMess name", add: "example.com", port: "443", id: "00000000-0000-4000-8000-000000000001" }));
    let config = migrated({ settings: settings("1.0.5"), section: [
        { ".name": "main", ".type": "section", action: "connection", selector_proxy_links: [
            "vless://u@a.example:443#Node%20A", "trojan://p@b.example:443", "vless://u@c.example:443#Node%20A", vmess
        ] },
        { ".name": "plain", ".type": "section", action: "connection", selector_proxy_links: "socks5://127.0.0.1:1080#S socks5://127.0.0.1:1081" },
        { ".name": "none", ".type": "section", action: "connection" }
    ] }).config;
    let links = (owner) => map(filter(config.connection_link ?? [], (link) => link.section == owner), (link) => [ link.uri, link.name, link.order ]);
    t.eq(links("main"), [
        [ "vless://u@a.example:443#Node%20A", "Node A", "0" ],
        [ "trojan://p@b.example:443", "Node #2", "1" ],
        [ "vless://u@c.example:443#Node%20A", "Node A #2", "2" ],
        [ vmess, "VMess name", "3" ]
    ]);
    t.eq(links("plain"), [ [ "socks5://127.0.0.1:1080#S", "S", "0" ], [ "socks5://127.0.0.1:1081", "Node #2", "1" ] ],
        "a value stored as one option splits on spaces, as the generator read it");
    t.eq(links("none"), []);
    for (let item in config.section)
        t.ok(!exists(item, "selector_proxy_links"), item[".name"] + " kept selector_proxy_links");

    config.settings.config_version = "1.0.5";
    let again = migrated(config);
    t.eq(filter(again.operations, (op) => op.type == "connection_link" || op.option == "selector_proxy_links"), [],
        "a second pass leaves them alone");
    t.eq(length(again.config.connection_link), 6);
});

t.test("a link takes a name without a slash that no other server or group of its section holds, and filters follow it", () => {
    let config = migrated({ settings: settings("1.0.5"), section: [
        { ".name": "main", ".type": "section", action: "connection",
            outbound_jsons: [ "{\"type\":\"socks\",\"tag\":\"Hop\",\"server\":\"127.0.0.1\",\"server_port\":1080}" ],
            selector_proxy_links: [ "vless://u@a.example:443#US%2FLA", "vless://u@b.example:443#Fast", "socks5://127.0.0.1:1081#Hop" ] }
    ], urltest: [
        { ".name": "fast", ".type": "urltest", section: "main", name: "Fast", filter_mode: "include", include_outbounds: [ "US/LA", "Hop" ] }
    ] }).config;
    t.eq(map(config.connection_link, (link) => link.name), [ "US／LA", "Fast #2", "Hop #2" ]);
    t.eq(config.urltest[0].include_outbounds, [ "US/LA", "Hop", "US／LA", "Hop #2" ],
        "a released filter matched every server of the name, so it names both now");

    config.settings.config_version = "1.0.5";
    let again = migrated(config);
    t.eq(filter(again.operations, (op) => op.type == "connection_link" || op.option == "include_outbounds"), [],
        "a second pass leaves them alone");
});

t.test("a section's cascade goes to each of its links and subscriptions", () => {
    let config = migrated({ settings: settings("1.0.5"), section: [
        { ".name": "hop", ".type": "section", action: "connection", selector_proxy_links: [ "socks5://127.0.0.1:1080#Hop" ] },
        { ".name": "main", ".type": "section", action: "connection", outbound_detour_enabled: "1", outbound_detour_section: "hop",
            selector_proxy_links: [ "vless://u@a.example:443#A" ],
            outbound_jsons: [ "{\"type\":\"socks\",\"tag\":\"Local\",\"server\":\"127.0.0.1\",\"server_port\":1081}" ] },
        { ".name": "off", ".type": "section", action: "connection", outbound_detour_enabled: "0", outbound_detour_section: "hop",
            selector_proxy_links: [ "vless://u@b.example:443#B" ] }
    ], subscription_url: [
        { ".name": "main_sub", ".type": "subscription_url", section: "main", url: "https://main.example/sub", tag: "sub1" },
        { ".name": "off_sub", ".type": "subscription_url", section: "off", url: "https://off.example/sub", tag: "sub1" }
    ] }).config;
    let cascade = (type_name, owner) => map(filter(config[type_name] ?? [], (item) => item.section == owner), (item) => item.detour_section);
    t.eq(cascade("connection_link", "main"), [ "hop" ]);
    t.eq(cascade("subscription_url", "main"), [ "hop" ]);
    t.eq(cascade("connection_link", "off"), [ null ], "a cascade switched off stays off");
    t.eq(cascade("subscription_url", "off"), [ null ]);
    t.eq(cascade("connection_link", "hop"), [ null ]);
    t.eq(length(by_name(config.section).main.outbound_jsons), 1, "a JSON outbound kept its own way out");
    for (let item in config.section)
        absent(item, [ "outbound_detour_enabled", "outbound_detour_section" ]);

    config.settings.config_version = "1.0.5";
    let again = migrated(config);
    t.eq(filter(again.operations, (op) => op.option == "detour_section"), [], "a second pass leaves them alone");
});

t.test("a subscription's prefix, country filters, User-Agent and HWID become the current fields", () => {
    let sub = by_name(config.subscription_url).sub;
    t.eq([ sub.tag, sub.server_filter_mode ], [ "Premium", "include" ]);
    t.contains(sub.include_regex, "🇩🇪");
    t.contains(sub.header, "User-Agent: Custom Agent");
    t.contains(sub.header, "X-HWID: CUSTOM-HWID");
    absent(sub, [ "auto_user_agent", "user_agent", "auto_hwid", "hwid", "filter_mode", "include_countries",
        "include_proxy_parameters", "include_protocols", "include_transports", "include_securities",
        "exclude_protocols", "exclude_transports", "exclude_securities",
        "include_urltest_groups", "hide_urltest_group_outbounds", "node_prefix", "prefix_nodes",
        "show_subscription_name" ]);
});

t.test("an interface keeps its name as a display name and its resolver as a URI", () => {
    let iface = config.section_interface[0];
    t.eq(iface.display_name, "awg0");
    t.eq(iface.domain_resolver_dns_server, [ "https://dns.example/dns-query" ]);
});

t.test("a URLTest group takes the current defaults and turns countries into a regex", () => {
    let urltest = config.urltest[0];
    t.eq([ urltest.expected_status, urltest.server_filter_mode ], [ "*", "include" ]);
    t.contains(urltest.include_regex, "🇳🇱");
    absent(urltest, [ "detect_server_country", "filter_mode", "include_countries", "exclude_countries",
        "include_proxy_parameters", "include_protocols", "include_transports", "include_securities",
        "exclude_proxy_parameters", "exclude_protocols", "exclude_transports", "exclude_securities",
        "hide_added_outbounds", "pin_dashboard", "interrupt_exist_connections" ]);
});

t.test("a priority group and level become a fallback group and level", () => {
    t.eq([ config.priority_group, config.priority_level ], [ null, null ]);
    let group = config.fallback_group[0];
    t.eq([ group[".type"], group.health_check_url ], [ "fallback_group", "https://example.com/ping" ]);
    absent(group, [ "health_url", "active_check_interval", "check_timeout", "recovery_check_interval",
        "pick_fastest", "switch_to_faster_same_priority", "fastest_check_interval",
        "hide_added_outbounds", "pin_dashboard", "interrupt_exist_connections" ]);
    let level = config.fallback_level[0];
    t.eq([ level[".type"], level.server_filter_mode ], [ "fallback_level", "direct" ]);
    absent(level, [ "direct", "country", "detect_server_country", "include_proxy_parameters" ]);
});

t.test("a section's own mixed listener becomes a routed mixed server with a client", () => {
    let mixed = filter(config.server, (item) => item.routing_section == "main" && item.protocol == "mixed")[0];
    t.ok(mixed, "the mixed server");
    t.eq([ mixed.listen, mixed.listen_port, mixed.mixed_auth_enabled ], [ "::", "2080", "1" ]);
    let client = only_client(mixed[".name"]);
    t.eq([ client.name, client.password ], [ "ivan-petrov", "proxy-secret" ]);
});

t.test("released server credentials move into typed clients", () => {
    t.eq([ server.socks.protocol, server.socks.mixed_auth_enabled ], [ "mixed", "0" ], "SOCKS becomes mixed");
    t.eq([ only_client("socks").name, only_client("socks").password ], [ "ivan-petrov", "socks-secret" ]);
    t.eq([ only_client("vless").uuid, only_client("vless").flow ], [ "44444444-4444-4444-8444-444444444444", "xtls-rprx-vision" ]);
    t.eq(server.vless.tls_server_name, "www.apple.com", "the Reality target fills a missing SNI");
    t.eq([ server.ss2022.shadowsocks_psk, only_client("ss2022").password ], [ "ajXWye37k0IsLRrpEhB3pA==", "ajXWye37k0IsLRrpEhB3pA==" ]);
    let legacy = only_client("legacy_user");
    t.eq([ legacy.name, legacy.uuid, legacy.flow ], [ "phone", "55555555-5555-4555-8555-555555555555", "xtls-rprx-vision" ]);
    t.eq(only_client("vmess").uuid, "66666666-6666-4666-8666-666666666666");
    t.eq([ only_client("trojan").password, only_client("hysteria2").password ], [ "trojan-secret", "hysteria-secret" ]);
    absent(server.tailscale, [ "tailscale_advertise_exit_node", "tailscale_accept_routes" ]);
    for (let item in config.server)
        absent(item, RETIRED_SERVER_OPTIONS);
});

t.test("a released MTProto server leaves with its clients and says so", () => {
    t.eq(server.mtproto, null);
    t.eq(filter(config.server_client ?? [], (item) => item.server == "mtproto"), []);
    t.contains(full.warnings, "Removed MTProto server 'MTProto': Forkop no longer serves MTProto");
});

t.test("a released server whose links name an IPv6 address listens on both families", () => {
    let trojan = (name, public_host, listen) => ({ ".name": name, ".type": "server", label: name, protocol: "trojan",
        server_password: "secret", listen, listen_port: "443", public_host });
    let out = migrated({ settings: settings("1.0.5"), section: [], server: [
        trojan("v6", "2001:db8::1", "0.0.0.0"),
        trojan("bracketed", "[2001:db8::2]", "0.0.0.0"),
        trojan("v4", "203.0.113.9", "0.0.0.0"),
        trojan("hostname", "vpn.example.com", "0.0.0.0"),
        trojan("chosen", "2001:db8::3", "192.168.1.1")
    ] });
    let migrated_server = by_name(out.config.server);
    t.eq(map([ "v6", "bracketed", "v4", "hostname", "chosen" ], (name) => migrated_server[name].listen),
        [ "::", "::", "0.0.0.0", "0.0.0.0", "192.168.1.1" ]);
});

t.test("a released certificate path becomes the user's own certificate, and Forkop's own file its self-signed one", () => {
    let dir = stub.tmpdir() + "/server-certs/";
    fs.mkdir(dir);
    fs.writefile(dir + "hy2.crt", "-----BEGIN CERTIFICATE-----\nissued\n-----END CERTIFICATE-----\n");
    fs.writefile(dir + "hy2.key", "-----BEGIN PRIVATE KEY-----\nissued-key\n-----END PRIVATE KEY-----\n");
    stub.env({ FORKOP_DEFAULT_CONFIG_PATH: DEFAULT_CONFIG, FORKOP_RELEASED_CERTIFICATE_DIR: dir });
    let module = stub.fresh("config.migration");
    stub.restore();

    let paths = (name) => ({ tls_certificate_path: dir + name + ".crt", tls_key_path: dir + name + ".key" });
    let data = { settings: settings("1.0.5"), section: [], server: [
        { ".name": "hy2", ".type": "server", protocol: "hysteria2", ...paths("hy2") },
        { ".name": "lost", ".type": "server", protocol: "trojan", ...paths("lost") },
        { ".name": "acme", ".type": "server", protocol: "vless", security: "tls",
            tls_certificate_path: "/etc/ssl/acme/vpn.example.com.fullchain.crt", tls_key_path: "/etc/ssl/acme/vpn.example.com.key" },
        { ".name": "reality", ".type": "server", protocol: "vless", security: "reality", ...paths("reality") }
    ] };
    let run = migrate(data, null, module);
    t.eq(run.status, 0, run.error);
    let out = by_name(run.out.config.server);

    t.eq([ out.hy2.tls_certificate_source, out.hy2.tls_self_signed_certificate, out.hy2.tls_self_signed_key ],
        [ null, "-----BEGIN CERTIFICATE-----\nissued\n-----END CERTIFICATE-----",
            "-----BEGIN PRIVATE KEY-----\nissued-key\n-----END PRIVATE KEY-----" ], "the pinned certificate stays");
    t.eq([ out.lost.tls_certificate_source, out.lost.tls_self_signed_certificate ], [ null, null ],
        "a certificate that cannot be read is issued again");
    t.eq([ out.acme.tls_certificate_source, out.acme.tls_certificate, out.acme.tls_key ],
        [ "custom", "/etc/ssl/acme/vpn.example.com.fullchain.crt", "/etc/ssl/acme/vpn.example.com.key" ]);
    t.eq([ out.reality.tls_certificate_source, out.reality.tls_self_signed_key ], [ null, null ], "a Reality server gets none");
    for (let name, item in out)
        absent(item, [ "tls_certificate_path", "tls_key_path" ], name);

    let again = migrate({ ...run.out.config, settings: settings("1.0.5") }, null, module);
    t.eq(filter(again.out.operations, (op) => op.section != "settings"), [], "a second run changes no server");
});

t.test("a released Trojan server without TLS serves TLS and says its clients need the new link", () => {
    let data = { settings: settings("1.0.5"), section: [], server: [
        { ".name": "plain", ".type": "server", label: "Plain", protocol: "trojan", security: "none", server_password: "p" },
        { ".name": "tls", ".type": "server", label: "Wrapped", protocol: "trojan", security: "tls", server_password: "p" },
        { ".name": "vmess", ".type": "server", label: "VMess", protocol: "vmess", security: "none", server_uuid: "66666666-6666-4666-8666-666666666666" }
    ] };
    let out = migrated(data);
    let migrated_server = by_name(out.config.server);
    t.eq(map([ "plain", "tls", "vmess" ], (name) => migrated_server[name].security), [ "tls", "tls", "none" ]);
    t.contains(out.warnings, "Trojan server 'Plain' now serves TLS, which every Trojan client needs; hand its clients the new link");
    t.eq(length(out.warnings), 1);
});

t.test("the first released HTTP host becomes the host of the transport", () => {
    let data = { settings: settings("1.0.5"), section: [], server: [
        { ".name": "http", ".type": "server", protocol: "vless", security: "none", transport: "http",
            transport_hosts: [ "a.example.com", "b.example.com" ], server_uuid: "66666666-6666-4666-8666-666666666666" },
        { ".name": "ws", ".type": "server", protocol: "vless", security: "none", transport: "ws", transport_host: "ws.example.com",
            transport_hosts: [ "stale.example.com" ], server_uuid: "66666666-6666-4666-8666-666666666667" }
    ] };
    let out = by_name(migrated(data).config.server);
    t.eq([ out.http.transport_host, out.ws.transport_host ], [ "a.example.com", "ws.example.com" ]);
    for (let name in [ "http", "ws" ])
        absent(out[name], [ "transport_hosts" ]);
});

t.test("a released dont_touch_dhcp leaves what no rule claims with the router's resolver", () => {
    t.eq(config.settings.unmatched_dns_mode, "router");
    let untouched = migrated({ settings: settings("1.0.5", { dont_touch_dhcp: "0", shutdown_correctly: "1" }), section: [] });
    t.eq(untouched.config.settings.unmatched_dns_mode, null, "the default keeps the Forkop DNS");
    absent(untouched.config.settings, [ "dont_touch_dhcp", "shutdown_correctly" ]);
});

t.test("leaving the released schema restores dnsmasq once and retires the old workers", () => {
    t.eq(full.restore_dnsmasq, true);
    t.ok(length(filter(full.removed_caches, (path) => index(path, "server-country-cache.json") >= 0)) > 0);
    t.eq(full.removed_cron_markers, [ "# forkop-list-update", "# forkop-subscription-update", "# forkop-component-update-check" ]);
});

t.test("the component manager's settings and its crontab line leave a released configuration", () => {
    let out = migrated({
        settings: settings("1.0.5", {
            component_update_check_enabled: "1", component_update_check_interval: "1d",
            download_components_via_proxy: "1", download_components_via_proxy_section: "main"
        }),
        section: []
    });
    absent(out.config.settings, [ "component_update_check_enabled", "component_update_check_interval",
        "download_components_via_proxy", "download_components_via_proxy_section" ]);
    t.contains(out.removed_cron_markers, "# forkop-component-update-check");
    let again = migrated(out.config);
    t.eq(again.config, out.config);
    t.eq(again.operations, []);
});

t.test("the NTP exclusion leaves a released configuration", () => {
    let out = migrated({ settings: settings("1.0.5", { exclude_ntp: "1" }), section: [] });
    absent(out.config.settings, [ "exclude_ntp" ]);
    let again = migrated(out.config);
    t.eq(again.config, out.config);
    t.eq(again.operations, []);
});

/* --------------------------------------------------------- the version graph */

t.test("the 1.0.2 to 1.0.5 step turns a released HTTP link into an outbound before NEXT", () => {
    let out = migrated({
        settings: settings("1.0.2", { applied_migrations: [ "do-not-trust-this-marker" ] }),
        section: [ {
            ".name": "main", ".type": "section", label: "Main", action: "connection",
            selector_proxy_links: [
                "https://alice:secret@proxy.example.com:8443#Released HTTP",
                "vless://00000000-0000-4000-8000-000000000001@example.com:443#VLESS"
            ]
        } ]
    });
    let main = out.config.section[0];
    t.eq(map(out.config.connection_link, (link) => [ link.section, link.name ]), [ [ "main", "VLESS" ] ]);
    t.matches(out.config.connection_link[0].uri, /^vless:\/\//);
    let http = json(main.outbound_jsons[0]);
    t.eq([ http.type, http.tag, http.server, http.server_port, http.username, http.password, http.tls?.enabled ],
        [ "http", "Released HTTP", "proxy.example.com", 8443, "alice", "secret", true ]);
});

t.test("the current schema only loses a stray marker list, once", () => {
    let once = migrated({ settings: settings("NEXT", { applied_migrations: [ "obsolete-marker" ] }), section: [] });
    t.ok(once.changed);
    absent(once.config.settings, [ "applied_migrations" ]);
    t.eq(migrated(once.config).changed, false);
});

t.test("a released source takes the target's own version, and an unpublished NEXT is refused by a release", () => {
    let release_default = stub.tmpdir() + "/default-config";
    fs.writefile(release_default, "config settings 'settings'\n        option config_version '2.0.0'\n");
    let release = migration_targeting(release_default);

    let run = migrate({ settings: settings("1.0.5"), section: [] }, null, release);
    t.eq([ run.status, run.out.config.settings.config_version ], [ 0, "2.0.0" ]);

    run = migrate({ settings: settings("NEXT"), section: [] }, null, release);
    t.eq(run.status, 1);
    t.contains(run.error, "option 'config_version' has invalid value 'NEXT'");
});

t.test("a version that was never a released schema, an invalid one and a newer one are refused", () => {
    let run = migrate({ settings: settings("1.0.4"), section: [] });
    t.eq(run.status, 1);
    t.contains(run.error, "unknown released schema '1.0.4'; supported source schemas are 1.0.2 and 1.0.5");

    run = migrate({ settings: settings("broken") });
    t.eq(run.status, 1);
    t.contains(run.error, "section 'settings', option 'config_version'");

    run = migrate({ settings: settings("9.0.0") });
    t.eq(run.status, 1);
    t.contains(run.error, "newer than the newest migratable schema 1.0.5");
});

t.test("a schema older than 1.0.2, one without a version and a Podkop one are recreated from defaults", () => {
    let old = migrated({ settings: settings("1.0.1"), section: [ { ".name": "old", ".type": "section", label: "Old", action: "connection" } ] });
    t.eq([ old.reset, old.target_version, old.config ], [ true, "NEXT", null ]);
    t.ok(migrated({ settings: { ".name": "settings", ".type": "settings" }, section: [] }).reset, "no config_version");
    t.ok(migrated({ settings: settings("1.0.5"), section: [] }, "podkop").reset, "Podkop");
});

/* ------------------------------------------------------ native protocol JSON */

const OPENVPN = {
    type: "openvpn", tag: "Office", servers: [ { server: "vpn.example", server_port: 1194 } ], proto: "udp",
    username: "alice", password: " secret ", auth: "SHA256", cipher: "AES-256-CBC",
    tls: { ca: "CA", certificate: "CERT", key: "KEY", verify_x509_name: "server", verify_x509_name_mode: "name-prefix" },
    tls_auth: "CONTROL", key_direction: 1
};
const SNELL = { type: "snell", tag: "Snell", version: 4, server: "snell.example", server_port: 443, psk: "psk", obfs: { mode: "http", host: "cdn.example" } };

function released_outbounds(version) {
    return {
        settings: settings(version),
        section: [ { ".name": "main", ".type": "section", action: "connection",
            outbound_jsons: [ sprintf("%J", OPENVPN), sprintf("%J", SNELL) ] } ]
    };
}

t.test("a released OpenVPN outbound becomes a tunnel endpoint the current core reads", () => {
    let out = migrated(released_outbounds("1.0.5"));
    t.eq(length(out.config.tunnel), 1);
    let tunnel = out.config.tunnel[0];
    t.eq([ tunnel.kind, tunnel.section ], [ "openvpn-client", "main" ]);
    let endpoint = json(tunnel.endpoint_json);
    t.eq([ endpoint.password, endpoint.network, endpoint.cipher, endpoint.data_ciphers_fallback ],
        [ " secret ", "udp", null, "AES-256-CBC" ]);
    t.eq([ endpoint.tls.certificate, endpoint.tls.client_certificate, endpoint.tls.client_key, endpoint.tls.server_name_type ],
        [ "CA", "CERT", "KEY", "name-prefix" ]);
    t.eq(endpoint.tls.control_wrap, { type: "tls_auth", key: "CONTROL", direction: "client" });
});

t.test("a released Snell outbound flattens its obfuscation settings", () => {
    let snell = json(migrated(released_outbounds("1.0.5")).config.section[0].outbound_jsons[0]);
    t.eq([ snell.obfs, snell.obfs_mode, snell.obfs_host ], [ null, "http", "cdn.example" ]);
});

t.test("a singular outbound section becomes a connection with a tunnel", () => {
    let out = migrated({
        settings: settings("1.0.5"),
        section: [ { ".name": "main", ".type": "section", action: "outbound", outbound_json: sprintf("%J", OPENVPN) } ]
    });
    t.eq([ out.config.section[0].action, out.config.section[0].outbound_json ], [ "connection", null ]);
    t.eq(out.config.tunnel[0].kind, "openvpn-client");
});

t.test("an outbound option the endpoint cannot carry stops the migration and names it", () => {
    let run = migrate({
        settings: settings("1.0.5"),
        section: [ { ".name": "main", ".type": "section", action: "outbound", outbound_json: sprintf("%J", { ...OPENVPN, system: true }) } ]
    });
    t.eq(run.status, 1);
    t.matches(run.error, /section 'main'.*outbound_json.*system/);
});

t.test("the current schema's outbounds are left as they are", () => {
    let data = released_outbounds("NEXT");
    let out = migrated(data);
    t.eq([ out.changed, out.config.tunnel ], [ false, null ]);
    t.eq(out.config.section[0].outbound_jsons, data.section[0].outbound_jsons);
});

/* ---------------------------------------------------- the dnsmasq takeover */

function restore_plan(dnsmasq) {
    let run = run_mode(migration, "restore-dnsmasq-fixture", { dnsmasq });
    t.eq(run.status, 0, run.error);
    return run.out;
}

t.test("a takeover backup is restored exactly and its private keys removed", () => {
    let plan = restore_plan({
        server: [ "127.0.0.42" ], noresolv: "1", cachesize: "0", rebind_protection: "0",
        forkop_server: [ "1.1.1.1", "tls://8.8.8.8" ], forkop_noresolv: "1",
        forkop_cachesize: "321", forkop_rebind_protection: "__unset__"
    });
    t.ok(plan.changed);
    t.eq(plan.set_lists.server, [ "1.1.1.1", "tls://8.8.8.8" ]);
    t.eq([ plan.set.noresolv, plan.set.cachesize ], [ "1", "321" ]);
    for (let key in [ "forkop_server", "forkop_noresolv", "forkop_cachesize", "forkop_rebind_protection", "rebind_protection" ])
        t.contains(plan.delete_options, key);
});

t.test("an untouched dnsmasq is left untouched", () => {
    t.eq(restore_plan({ server: [ "192.168.1.1" ], noresolv: "0", cachesize: "150" }).changed, false);
});

t.done();
