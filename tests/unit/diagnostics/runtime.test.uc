let t = require("t");
let stub = require("stub");
let fs = require("fs");
let fixture = require("fixture");
let uci = require("uci");
let packages = require("core.packages");
let health = require("service.health");
let singbox_runtime = require("singbox.runtime");
let diagnostics = require("diagnostics.runtime");

let dir = stub.tmpdir();
diagnostics.paths.rc_dir = dir + "/rc.d";
diagnostics.paths.luci_view = dir + "/luci";
diagnostics.paths.forkop_config = dir + "/forkop";
diagnostics.paths.check_proxy_lock = dir + "/check-proxy.lock";
diagnostics.paths.sing_box_init = dir + "/sing-box-init";
packages.paths.opkg_status = dir + "/missing-status";
packages.paths.sing_box_version = dir + "/sing-box-version";

t.test("the status is the stable runtime the page reads, in the same words", () => {
    health.forkop_stably_running = () => true;
    t.eq(diagnostics.status(), { running: 1, enabled: 0, status: "running but disabled" });
    health.forkop_stably_running = () => false;
    t.eq(diagnostics.status().status, "stopped & disabled");
});

t.test("the core version comes from what the core records while the package manager is locked", () => {
    fs.writefile(packages.paths.sing_box_version, "1.13.14-extended-2.5.3-f1\n");
    fs.mkdir(diagnostics.paths.luci_view);
    fs.writefile(diagnostics.paths.luci_view + "/main.js", "var FORKOP_LUCI_APP_VERSION = \"runtime-test\";\n");
    stub.commands([ [ "sh -c command -v apk", { status: 1 } ], [ /command -v/, {} ], [ "opkg", { status: 1 } ] ]);
    let info = diagnostics.system_info();
    stub.restore();
    t.eq([ info.sing_box_version, info.luci_app_version ], [ "1.13.14-extended-2.5.3-f1", "runtime-test" ]);
});

t.test("the core check asks what the start asks: the required version and the listeners the wait needs", () => {
    fs.writefile(diagnostics.paths.sing_box_init, "#!/bin/sh\n");
    health.sing_box_service_running = () => true;
    health.sing_box_runtime_ports_ready = () => true;
    stub.commands([ [ "sh -c command -v apk", { status: 1 } ], [ /command -v/, {} ], [ "opkg", { status: 1 } ], [ dir + "/sing-box-init enabled", { status: 1 } ] ]);
    fs.writefile(packages.paths.sing_box_version, "1.13.14-extended-2.5.3-f1\n");
    t.eq(diagnostics.sing_box().sing_box_version_ok, 0, "a core the start would refuse is not compatible");
    fs.writefile(packages.paths.sing_box_version, "1.14.1-extended-2.7.2-f123\n");
    let value = diagnostics.sing_box();
    stub.restore();
    t.eq(value, { sing_box_installed: 1, sing_box_version_ok: 1, sing_box_service_exist: 1, sing_box_autostart_disabled: 1,
        sing_box_process_running: 1, sing_box_ports_listening: 1 });
});

t.test("the counters come from one listing of the table, and a priority rule counts for the capture", () => {
    let listing = "table inet ForkopTable {\n\tchain mangle {\n\t\ttype filter hook prerouting priority mangle; policy accept;\n" +
        "\t\tjump priority_rules\n\t\tip daddr 198.18.0.0/15 counter packets 0 bytes 0\n\t}\n" +
        "\tchain priority_rules {\n\t\tip daddr @x counter packets 4 bytes 256 accept\n\t}\n" +
        "\tchain mangle_output {\n\t\tmeta mark 0x08000000 counter packets 1 bytes 64 return\n\t}\n" +
        "\tchain proxy {\n\t\tmeta l4proto tcp tproxy ip to :1602 counter packets 0 bytes 0\n\t}\n}\n";
    let calls = [];
    stub.commands([
        [ /^'sh' '-c' 'curl/, {} ],
        [ "nft -t list table inet ForkopTable", () => { push(calls, "table"); return { stdout: listing }; } ],
        [ "nft -t list ruleset", { stdout: listing + "table inet fw4 {\n\tchain input {\n\t\tmeta mark & 0x04000000 == 0x04000000 accept\n\t}\n}\n" } ]
    ]);
    let value = diagnostics.nft_rules();
    stub.restore();
    t.eq(value, { table_exist: 1, rules_mangle_exist: 1, rules_mangle_counters: 1, rules_mangle_output_exist: 1, rules_mangle_output_counters: 1,
        rules_proxy_exist: 1, rules_proxy_counters: 0, rules_other_mark_exist: 0 });
    t.eq(calls, [ "table" ], "the table is listed once");
    t.ok(diagnostics.foreign_mark_rules("table inet other {\n\tchain c {\n\t\tmeta mark set 0x1\n\t}\n}\n"), "a table that sets marks");
});

t.test("FakeIP is judged by the configured ranges", () => {
    t.ok(diagnostics.in_prefix("198.19.0.7", "198.18.0.0/15"));
    t.ok(!diagnostics.in_prefix("198.20.0.7", "198.18.0.0/15"));
    t.ok(diagnostics.in_prefix("fc00:0:3fff::1", "fc00::/18"));
    t.ok(!diagnostics.in_prefix("fc01::1", "fc00::/18"), "outside the /18");
    stub.commands([ [ "dig +short @127.0.0.42 fakeip.podkop.fyi A", { stdout: "198.18.0.9\n" } ],
        [ "dig +short @127.0.0.42 fakeip.podkop.fyi AAAA", { stdout: "fc01::1\n" } ] ]);
    let value = diagnostics.fakeip();
    stub.restore();
    t.eq(value, { fakeip: true, IP: "198.18.0.9", IPv4: "198.18.0.9", IPv6: "fc01::1" });
});

t.test("a bootstrap resolver on a custom port is asked on that port", () => {
    fixture.seed({ settings: { dns_server: [ "https://dns.example/dns-query" ], bootstrap_dns_server: [ "127.0.0.1:5335" ] } });
    health.sing_box_service_running = () => false;
    singbox_runtime.listen_address = () => "";
    stub.commands([
        [ "dig @127.0.0.1 -p 5335 dns.example A +short +timeout=2 +tries=1", { stdout: "203.0.113.7\n" } ],
        [ /'dig'/, { status: 1 } ],
        [ "ip -4 addr show dev", { stdout: "" } ],
        [ "nft list chain inet ForkopTable dns_redirect", {} ]
    ]);
    let value = diagnostics.dns();
    stub.restore();
    t.eq([ value.bootstrap_dns_status, value.dns_capture_status, value.dns_server ], [ 1, 1, "https://dns.example/dns-query" ]);
});

t.test("the proxy check asks a running core through its mixed inbound and never starts a second one", () => {
    fixture.seed({ settings: { config_path: dir + "/config.json" } });
    fs.writefile(dir + "/config.json", "{}");
    singbox_runtime.process_running = () => true;
    stub.commands([ [ /command -v/, {} ], [ /^'curl'/, { stdout: "198.51.100.9\n" } ] ]);
    let result = stub.capture(() => diagnostics.check_proxy());
    let lines = stub.command_lines();
    stub.restore();
    t.eq([ result.result, result.stdout ], [ 0, "X.X.X.9 - should match proxy IP\n" ]);
    t.contains(join("\n", lines), "--proxy socks5h://127.0.0.1:4534 https://ip.podkop.fyi/check");
    t.excludes(join("\n", lines), "tools fetch");
    t.ok(fs.stat(diagnostics.paths.check_proxy_lock) == null, "the check releases its lock");
});

t.test("the WAN addresses of the interfaces are kept when there is no IPv4 default route", () => {
    fixture.seed({ settings: {}, server: [ { ".name": "s", enabled: "1", protocol: "vless", listen: "0.0.0.0", listen_port: "443" } ] });
    uci.__seed("firewall", [ { ".type": "rule", enabled: "1", target: "ACCEPT", src: "wan", proto: [ "tcp", "udp" ], dest_port: "443" } ]);
    stub.commands([
        [ "ubus -S call network.interface.wan status", { stdout: "{\"ipv6-address\":[{\"address\":\"2001:db8::7\"}]}" } ],
        [ "ubus -S call network.interface.wwan status", { status: 4 } ],
        [ "ip -4 route show default", { stdout: "" } ],
        [ "ip -6 route show default", { stdout: "default via fe80::1 dev wan6 proto static\n" } ],
        [ "ip -6 addr show dev wan6 scope global", { stdout: "    inet6 2001:db8::8/64 scope global\n" } ],
        [ "netstat", { stdout: "tcp        0      0 0.0.0.0:443             0.0.0.0:*               LISTEN\n" } ],
        [ "nft list chain inet fw4 input", { stdout: "" } ],
        [ "dig", { stdout: "" } ]
    ]);
    let value = diagnostics.inbounds();
    stub.restore();
    t.eq(value.wan_ip, "2001:db8::7 2001:db8::8");
    t.eq([ value.items[0].firewall_required, value.items[0].firewall_open ], [ 1, 1 ], "a rule that lists its protocols opens the port");
});

t.done();
