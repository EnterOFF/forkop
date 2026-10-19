let t = require("t");
let stub = require("stub");
let fs = require("fs");
let fixture = require("fixture");
let report = require("diagnostics.report");

let dir = stub.tmpdir();
report.paths.forkop_config = dir + "/forkop";

function seed() {
    fixture.seed({ settings: { config_path: dir + "/config.json", dns_server: [ "77.88.8.8", "https://dns.google/dns-query" ], bootstrap_dns_server: [ "tls://1.1.1.1" ] }, server: [ { ".name": "s", public_host: "vpn.example", tls_server_name: "2a00:1450::1" } ] });
    fs.writefile(dir + "/config.json", sprintf("%J", { outbounds: [ { type: "vless", tag: "Main", server: "node.example", uuid: "uuid-secret" } ] }));
    fs.writefile(report.paths.forkop_config, "config section 'main'\n\toption label 'Main via node.example'\n\toption proxy_string 'vless://uuid-secret@node.example:443'\n");
    let log = "";
    for (let i = 1; i <= 205; i++)
        log += sprintf("Mon Oct 19 17:05:01 2026 user.info forkop: [info] line %d\n", i);
    log += "Mon Oct 19 17:05:02 2026 daemon.err sing-box[1]: ERROR dial tcp node.example:443 (185.199.108.9)\n";
    stub.commands([
        [ /'logread'/, { stdout: log } ],
        [ /'nft' '-t' 'list' 'table' 'inet' 'ForkopTable'/, { stdout: "table inet ForkopTable {\n}\n" } ],
        [ /'ip' '-4' 'rule'/, { stdout: "105:\tfrom all fwmark 0x4000000/0x4000000 lookup forkop\n" } ],
        [ /'ip' '-6' 'rule'/, { stdout: "" } ]
    ]);
}

t.test("a masked report hides the credentials, the configured servers and public addresses everywhere it repeats them", () => {
    seed();
    let value = report.report("masked", "Main: 443/tcp · vpn.example\nExit: 185.199.108.9, direct 192.168.1.1\nMain DNS: 77.88.8.8 · 12 ms\nBootstrap DNS: tls://1.1.1.1 · 30 ms\n");
    stub.restore();
    let text = join("\n", [ value.checks, value.log, value.forkop_config, value.sing_box_config ]);
    for (let secret in [ "uuid-secret", "node.example", "vpn.example", "185.199.108.9" ])
        t.excludes(text, secret);
    t.eq(value.checks, "Main: 443/tcp · MASKED\nExit: X.X.X.9, direct 192.168.1.1\nMain DNS: 77.88.8.8 · 12 ms\nBootstrap DNS: tls://1.1.1.1 · 30 ms\n",
        "the checks the page ran are masked by the same rules, and the resolvers asked stay readable");
    t.contains(value.forkop_config, "option label 'Main via MASKED'");
    t.contains(value.sing_box_config, "\"tag\": \"Main\"");
    t.contains(value.log, "X.X.X.9");
    t.eq([ value.nftables, value.ip_rules ], [ "table inet ForkopTable {\n}\n", "105:\tfrom all fwmark 0x4000000/0x4000000 lookup forkop\n" ]);
});

t.test("the log is its last lines, and a raw report is the router as it is", () => {
    seed();
    let value = report.report("raw", "Main: vpn.example");
    stub.restore();
    let lines = split(rtrim(value.log, "\n"), "\n");
    t.eq(length(lines), 200);
    t.matches(lines[0], /line 7$/);
    t.contains(value.log, "node.example:443 (185.199.108.9)");
    t.contains(value.forkop_config, "vless://uuid-secret@node.example:443");
    t.eq(value.checks, "Main: vpn.example");
});

t.done();
