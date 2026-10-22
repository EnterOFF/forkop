let t = require("t");
let stub = require("stub");
let fs = require("fs");
let fixture = require("fixture");
let uci = require("uci");
let exec = require("core.exec");
let health = require("service.health");
let checks = require("diagnostics.checks");

let dir = stub.tmpdir();
let real_parallel = exec.capture_parallel;

// What each command a check runs at once answers, by its argv; a command the
// table does not know fails the test.
function parallel(answers) {
    let asked = [];
    exec.capture_parallel = function(commands) {
        return map(commands, (argv) => {
            let line = join(" ", argv);
            push(asked, line);
            for (let answer in answers)
                if (match(line, answer[0]) != null)
                    return { status: 0, stdout: answer[1] };
            die("unexpected command: " + line);
        });
    };
    return asked;
}

function dig_reply(status, ms) {
    return sprintf(";; ->>HEADER<<- opcode: QUERY, status: %s, id: 1\n;; Query time: %d msec\n", status, ms);
}

function write_config(config) {
    fs.writefile(dir + "/config.json", sprintf("%J", config));
}

t.test("the reason Forkop is down is the first error of the last action, not what its cleanup ran into", () => {
    let line = (level, message) => "Mon Oct 19 16:51:18 2026 user." + level + " forkop: [" + level + "] " + message;
    t.eq(checks.last_error(join("\n", [ line("info", "Starting Forkop"), line("error", "Another sing-box process is running outside Forkop"),
        line("error", "sing-box is still running after it was stopped"), line("warn", "Forkop did not start") ])),
        "Another sing-box process is running outside Forkop");
    t.eq(checks.last_error(join("\n", [ line("error", "An old failure"), line("info", "Forkop started"), line("info", "Stopping Forkop"),
        line("info", "Forkop stopped") ])), "", "a stop the user asked for left no error");
    t.eq(checks.last_error(join("\n", [ line("info", "Starting Forkop"), line("error", "first try"), line("info", "Starting Forkop"),
        line("error", "second try") ])), "second try", "the last attempt, not an earlier one");
    t.eq(checks.last_error("Mon Oct 19 16:51:18 2026 daemon.err sing-box[1]: FATAL[0000] start service"), "", "the core's own lines are not Forkop's");
    t.eq(checks.last_error(join("\n", [ line("info", "Starting Forkop"), line("error", "an earlier failure"), line("info", "Starting Forkop"),
        line("warn", "Forkop has nothing to run") ])), "Forkop has nothing to run", "an action that did not fail, by its last warning");
});

t.test("the service check finds running cores other than Forkop's, and nothing Forkop runs for a moment", () => {
    let proc = dir + "/proc";
    for (let process in [ [ "100", [ "/usr/bin/sing-box", "run", "-c", "/etc/sing-box/config.json" ] ],
        [ "200", [ "/usr/bin/sing-box", "run", "-c", "/tmp/probe.json" ] ], [ "300", [ "sing-box", "check", "-c", "x" ] ], [ "400", [ "/sbin/procd" ] ] ]) {
        fs.mkdir(proc);
        fs.mkdir(proc + "/" + process[0]);
        fs.writefile(proc + "/" + process[0] + "/cmdline", join("\u0000", process[1]) + "\u0000");
    }
    checks.paths.proc = proc;
    checks.paths.meminfo = dir + "/meminfo";
    checks.paths.uptime = dir + "/uptime";
    fs.writefile(checks.paths.meminfo, "MemTotal:         239540 kB\nMemFree:           26652 kB\nMemAvailable:      45536 kB\n");
    fs.writefile(checks.paths.uptime, "100700.12 300000.00\n");
    health.forkop_stably_running = () => false;
    health.sing_box_service_pid_runtime = () => 100;
    health.pid_is_sing_box = (pid) => index([ "100", "200", "300" ], "" + pid) >= 0;
    health.process_age_seconds = () => 42;
    stub.commands([
        [ /'logread'/, { stdout: "Mon Oct 19 16:51:18 2026 user.info forkop: [info] Starting Forkop\nMon Oct 19 16:51:18 2026 user.err forkop: [error] Clash API address 192.168.1.1:9090 is already in use by another process\n" } ],
        [ /'nft' '-t' 'list' 'ruleset'/, { stdout: "table inet other {\n\tchain c {\n\t\ttype filter hook prerouting priority mangle; policy accept;\n\t\tmeta l4proto tcp tproxy ip to :7893\n\t}\n}\n" } ]
    ]);
    let packages = require("core.packages");
    packages.paths.sing_box_version = dir + "/no-such-version";
    packages.paths.sing_box_variant = dir + "/no-such-variant";
    let value = checks.service();
    stub.restore();
    t.eq([ value.running, value.uptime, value.foreign_sing_box ], [ false, 42, [ 200 ] ]);
    t.eq(value.core, { version: "", variant: "", problem: "" }, "no sing-box-forkop package recorded a version");
    t.eq(value.last_error, "Clash API address 192.168.1.1:9090 is already in use by another process");
    t.eq(value.conflicts, [ { table: "inet other", kind: "tproxy" } ]);
    t.eq([ value.memory, value.router_uptime ], [ { total_kb: 239540, available_kb: 45536 }, 100700 ]);
});

t.test("the core check names the package's version and variant and why Forkop cannot run on its tags", () => {
    let packages = require("core.packages");
    let features = require("singbox.features");
    packages.paths.sing_box_version = dir + "/version";
    packages.paths.sing_box_variant = dir + "/variant";
    features.paths.binary = dir + "/sing-box";
    fs.writefile(packages.paths.sing_box_version, "1.14.3-r1\n");
    fs.writefile(packages.paths.sing_box_variant, "tiny\n");
    fs.writefile(features.paths.binary, "#!/bin/sh\n");
    let version = (tags) => "sing-box version 1.14.3-r1\n\nTags: " + tags + "\nCGO: disabled\n";
    let core_with = (tags) => {
        fs.writefile(features.paths.binary, "#!/bin/sh\n# " + tags + "\n");
        stub.commands([ [ features.paths.binary + " version", { status: 0, stdout: version(tags) } ] ]);
        let value = checks.core();
        stub.restore();
        return value;
    };
    t.eq(core_with("with_clash_api,with_utls,with_quic"), { version: "1.14.3-r1", variant: "tiny", problem: "" });
    t.contains(core_with("with_utls,with_quic").problem, "sing-box was built without with_clash_api");
    t.contains(core_with("with_clash_api,with_wireguard,with_openvpn").problem,
        "sing-box was built with with_wireguard, with_openvpn but without with_gvisor");
});

t.test("a DNS reply counts when the server resolved the name, whatever the name turned out to be", () => {
    t.eq(checks.dig_result(dig_reply("NXDOMAIN", 23)), { answered: true, status: "NXDOMAIN", ms: 23 });
    t.eq(checks.dig_result(dig_reply("SERVFAIL", 4)), { answered: false, status: "SERVFAIL", ms: 4 });
    t.eq(checks.dig_result(";; communications error to 127.0.0.42#53: timed out\n"), { answered: false, status: "", ms: -1 });
});

t.test("the main DNS is asked through the core for a name no cache holds; bootstrap is skipped when nothing needs it", () => {
    fixture.seed({ settings: { dns_server: [ "77.88.8.8" ], bootstrap_dns_server: [ "77.88.8.8" ], config_path: dir + "/config.json" } });
    write_config({ outbounds: [ { type: "vless", tag: "a", server: "proxy.example" } ] });
    let asked = parallel([ [ /@127\.0\.0\.42/, dig_reply("NOERROR", 12) ], [ /localhost/, dig_reply("NOERROR", 0) ] ]);
    let value = checks.dns();
    t.eq(value.main, { servers: "77.88.8.8", answered: true, status: "NOERROR", ms: 12 });
    t.eq([ value.bootstrap, value.local.answered ], [ null, true ]);
    t.matches(asked[0], /^dig @127\.0\.0\.42 -p 53 forkop-[0-9a-f]+\.example\.com A /);
});

t.test("each run asks a name of its own", () => {
    fixture.seed({ settings: { config_path: dir + "/config.json" } });
    let asked = parallel([ [ /@127\.0\.0\.42/, dig_reply("NOERROR", 1) ], [ /localhost/, dig_reply("NOERROR", 0) ] ]);
    checks.dns();
    checks.dns();
    t.ok(asked[0] != asked[2], asked[0] + " and " + asked[2]);
});

t.test("bootstrap is asked directly for the main server it exists to find, over the transport it speaks", () => {
    fixture.seed({ settings: { dns_server: [ "https://dns.example/dns-query" ],
        bootstrap_dns_server: [ "1.1.1.1", "https://9.9.9.9/dns-query", "quic://8.8.8.8" ], config_path: dir + "/config.json" } });
    let asked = parallel([
        [ /@127\.0\.0\.42/, ";; communications error: timed out\n" ],
        [ /localhost/, dig_reply("NOERROR", 0) ],
        [ /@1\.1\.1\.1/, ";; communications error: timed out\n" ],
        [ /@9\.9\.9\.9/, dig_reply("NOERROR", 31) ]
    ]);
    let value = checks.dns();
    t.eq(value.bootstrap, { servers: "1.1.1.1, https://9.9.9.9/dns-query", host: "dns.example", answered: true, ms: 31 }, "dig speaks no QUIC");
    t.eq(value.main.answered, false);
    t.contains(join("\n", asked), "dig @9.9.9.9 -p 443 +https=/dns-query dns.example A");
});

t.test("with DNS sent through a section, bootstrap finds the proxy servers", () => {
    fixture.seed({ settings: { dns_server: [ "8.8.8.8" ], bootstrap_dns_server: [ "77.88.8.8" ], dns_detour_enabled: "1",
        dns_detour_section: "s1", config_path: dir + "/config.json" }, section: [ { ".name": "s1", label: "Proxy" } ] });
    write_config({ outbounds: [ { type: "direct", tag: "direct-out" }, { type: "vless", tag: "a", server: "proxy.example" } ] });
    parallel([ [ /@127\.0\.0\.42/, dig_reply("NOERROR", 1) ], [ /localhost/, dig_reply("NOERROR", 0) ], [ /@77\.88\.8\.8/, dig_reply("NOERROR", 5) ] ]);
    let value = checks.dns();
    t.eq(value.bootstrap?.host, "proxy.example");
});

t.test("the router's own traffic is checked the way a client's goes, and the exit through the first section", () => {
    fixture.seed({ settings: { config_path: dir + "/config.json" } });
    write_config({ route: { rules: [ { action: "sniff" }, { action: "route", inbound: [ "tproxy-in" ], outbound: "Main", domain: "ip.podkop.fyi" } ] } });
    parallel([
        [ /^dig \+short/, "198.18.0.7\n" ],
        [ /fakeip\.podkop\.fyi\/check/, "{\"fakeip\": true, \"IP\": \"203.0.113.5\"}" ],
        [ /ip\.podkop\.fyi\/check/, "{\"fakeip\": false, \"IP\": \"198.51.100.9\"}" ]
    ]);
    t.eq(checks.traffic(), {
        router: { excluded: false, dns_fakeip: true, answered: true, fakeip: true, ip: "203.0.113.5" },
        exit: { section: "Main", answered: true, ip: "198.51.100.9" }
    });

    write_config({ route: { rules: [] } });
    let asked = parallel([ [ /^dig \+short/, "93.184.215.14\n" ], [ /fakeip\.podkop\.fyi\/check/, "<html>blocked</html>" ] ]);
    t.eq(checks.traffic(), { router: { excluded: false, dns_fakeip: false, answered: false, fakeip: false, ip: "" }, exit: null });
    t.eq(length(asked), 2, "no section, no exit to check");
});

t.test("a router excluded from routing is not checked, nor is the exit it would take", () => {
    fixture.seed({ settings: { config_path: dir + "/config.json", routing_excluded_ips: [ "192.168.1.50", "@system" ] } });
    write_config({ route: { rules: [ { action: "route", inbound: [ "tproxy-in" ], outbound: "Main", domain: "ip.podkop.fyi" } ] } });
    let asked = parallel([]);
    t.eq(checks.traffic(), { router: { excluded: true, dns_fakeip: false, answered: false, fakeip: false, ip: "" }, exit: null });
    t.eq(asked, []);
});

t.test("a server is checked for its listener, its firewall port and its public address", () => {
    fixture.seed({ settings: { config_path: dir + "/config.json" }, server: [
        { ".name": "a", label: "Main", enabled: "1", protocol: "vless", listen: "::", listen_port: "443", public_host: "vpn.example" },
        { ".name": "b", label: "Busy", enabled: "1", protocol: "hysteria2", listen: "0.0.0.0", listen_port: "8443", public_host: "192.168.1.1", open_firewall: "0" },
        { ".name": "c", label: "Own", enabled: "1", protocol: "json_inbound" },
        { ".name": "f", label: "Held", enabled: "1", protocol: "vless", listen: "0.0.0.0", listen_port: "22", public_host: "192.168.1.1" },
        { ".name": "d", label: "Tail", enabled: "1", protocol: "tailscale" },
        { ".name": "e", label: "Off", enabled: "0", protocol: "vless", listen_port: "1" }
    ] });
    uci.__seed("firewall", []);
    write_config({ inbounds: [ { type: "vless", tag: "Main", listen: "::", listen_port: 443 }, { type: "socks", tag: "Own", listen: "127.0.0.1", listen_port: 1080 } ] });
    parallel([ [ /AAAA vpn\.example/, "2a00:1450::7\n" ], [ /A vpn\.example/, "" ] ]);
    stub.commands([
        [ "ubus -S call network.interface.wan status", { stdout: "{\"ipv4-address\":[{\"address\":\"100.64.1.2\"}],\"ipv6-address\":[{\"address\":\"2a00:1450::7\"}]}" } ],
        [ "ubus -S call network.interface.wwan status", { status: 4 } ],
        [ /'ip' '-[46]' 'route'/, { stdout: "" } ],
        [ "netstat -ln", { stdout: "Proto Recv-Q Send-Q Local Address Foreign Address State\ntcp 0 0 :::443 :::* LISTEN\ntcp 0 0 127.0.0.1:1080 0.0.0.0:* LISTEN\ntcp 0 0 0.0.0.0:22 0.0.0.0:* LISTEN\n" } ],
        [ "netstat -lnp", { stdout: "Active Internet connections\nProto Recv-Q Send-Q Local Address Foreign Address State PID/Program name\nudp 0 0 0.0.0.0:8443 0.0.0.0:* 812/nginx\ntcp 0 0 0.0.0.0:22 0.0.0.0:* LISTEN 1203/dropbear\n" } ],
        [ "nft list chain inet fw4 input", { stdout: "\t\ttcp dport 443 counter accept comment \"forkop: server ports\"\n" } ],
        [ /\/tailscale' /, { stdout: sprintf("%J", { endpoints: [ {
            tag: "Tail", state: "Running", connected: true, name: "router-2", advertisesExitNode: true, exitNodeApproved: false,
            routes: [ { prefix: "192.168.1.0/24", approved: true }, { prefix: "10.0.0.0/8", approved: false } ], keyExpiry: 1000
        } ] }) + "__FORKOP_CLASH_STATUS__200" } ]
    ]);
    let value = checks.servers();
    stub.restore();
    let main = value.items[0], busy = value.items[1], own = value.items[2], held = value.items[3], tail = value.items[4];
    t.eq(length(value.items), 5, "a disabled server is not checked");
    t.eq([ tail.protocol, tail.runtime, tail.state, tail.connected, tail.name, tail.exit_node_pending, tail.pending_routes, tail.key_expired ],
        [ "tailscale", true, "Running", true, "router-2", true, "10.0.0.0/8", true ],
        "a Tailscale server listens on nothing; the core reports its state in the tailnet");
    t.eq([ held.listening, held.owners ], [ true, "1203/dropbear" ], "a port another program holds reads as listening, and says who holds it");
    t.eq([ value.wan, value.behind_cgnat ], [ "100.64.1.2 2a00:1450::7", false ], "a public IPv6 address reaches past the provider's NAT");
    t.eq([ main.listening, main.exposed, main.open_firewall, main.firewall_open, main.resolved, main.public, main.matches_wan ], [ true, true, true, true, 1, 1, 1 ]);
    t.eq([ busy.listening, busy.owners, busy.open_firewall, busy.firewall_open, busy.public, busy.matches_wan ], [ false, "812/nginx", false, false, 0, 0 ]);
    t.eq([ own.listening, own.port, own.transports, own.exposed, own.public_host ], [ true, 1080, "tcp", false, "" ], "a JSON server listens where its own settings say");
});

t.test("a Tailscale server the core does not report is not running", () => {
    fixture.seed({ settings: { config_path: dir + "/config.json" }, server: [ { ".name": "d", label: "Tail", enabled: "1", protocol: "tailscale" } ] });
    write_config({});
    stub.commands([
        [ "ubus -S call network.interface.wan status", { stdout: "{}" } ],
        [ "ubus -S call network.interface.wwan status", { status: 4 } ],
        [ /'ip' '-[46]' 'route'/, { stdout: "" } ],
        [ /netstat/, { stdout: "" } ],
        [ /\/tailscale' /, { status: 7 } ]
    ]);
    let item = checks.servers().items[0];
    stub.restore();
    t.eq([ item.label, item.runtime, item.state ], [ "Tail", false, "" ]);
});

t.test("a router whose only WAN address is the provider's shared one is behind its NAT, one behind another router is not", () => {
    fixture.seed({ settings: { config_path: dir + "/config.json" }, server: [] });
    write_config({});
    let behind = (address) => {
        stub.commands([
            [ "ubus -S call network.interface.wan status", { stdout: sprintf("{\"ipv4-address\":[{\"address\":\"%s\"}]}", address) } ],
            [ "ubus -S call network.interface.wwan status", { status: 4 } ],
            [ /'ip' '-[46]' 'route'/, { stdout: "" } ],
            [ /netstat/, { stdout: "" } ]
        ]);
        let value = checks.servers();
        stub.restore();
        return value.behind_cgnat;
    };
    t.eq(map([ "100.116.152.154", "192.168.0.5", "46.138.78.196" ], behind), [ true, false, false ]);
});

exec.capture_parallel = real_parallel;
t.done();
