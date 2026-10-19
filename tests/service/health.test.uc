let t = require("t");
let stub = require("stub");
let fs = require("fs");
let health = require("service.health");
let nft_state = require("nft.state");

// sing-box listening on the DNS inbound 127.0.0.42:53, the TProxy inbound :1602
// and [::1]:1602, and the source DNS inbound [::]:1603 over TCP and UDP.
const TCP = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n" +
    "   0: 2A00007F:0035 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 4643 1 fcf08d00 100 0 0 10 5\n" +
    "   1: 00000000:0642 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 989469 2 b4a02044 100 0 0 10 4096\n";
const TCP6 = "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n" +
    "   0: 00000000000000000000000001000000:0642 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 989472 2 0f713155 100 0 0 10 4096\n" +
    "   1: 00000000000000000000000000000000:0643 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 989473 2 0f713155 100 0 0 10 4096\n";
const UDP6 = "   1: 00000000000000000000000000000000:0643 00000000000000000000000000000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 989473 2 0f713155 100 0 0 10 4096\n";

function listening(tcp, tcp6, udp6) {
    let dir = stub.tmpdir();
    health.paths.tcp = dir + "/tcp";
    health.paths.tcp6 = dir + "/tcp6";
    health.paths.udp6 = dir + "/udp6";
    fs.writefile(health.paths.tcp, tcp);
    fs.writefile(health.paths.tcp6, tcp6);
    fs.writefile(health.paths.udp6, udp6);
    return health.sing_box_runtime_ports_ready();
}

t.test("sing-box is ready once every inbound Forkop routes to listens", () => {
    t.ok(listening(TCP, TCP6, UDP6));
    t.ok(!listening(replace(TCP, /.*2A00007F:0035.*\n/, ""), TCP6, UDP6), "without the DNS inbound");
    t.ok(!listening(TCP, replace(TCP6, /.*:0643 .*\n/, ""), UDP6), "without the source DNS inbound over TCP");
    t.ok(!listening(TCP, TCP6, ""), "without the source DNS inbound over UDP");
});

t.test("a process age is measured on the kernel tick scale and never runs backwards", () => {
    t.eq(health.process_age_seconds_from_ticks(786161359, 786162159), 8);
    t.eq(health.process_age_seconds_from_ticks(786162159, 786161359), null);
});

// A command name may hold spaces and parentheses, so the fields are counted from
// where it ends.
const STAT = "4242 (sing) box) S 1 4242 4242 0 -1 4194560 15734 0 6 0 239 42 0 0 20 0 9 0 190694980 812421120 16851 4294967295\n";
const STATUS = "Name:\tsing-box\nVmRSS:\t   67404 kB\nRssAnon:\t   25152 kB\nRssFile:\t   39436 kB\n";

t.test("a process costs its processor time and the memory only it holds", () => {
    health.paths.proc = stub.tmpdir();
    fs.mkdir(health.paths.proc + "/4242");
    fs.writefile(health.paths.proc + "/4242/stat", STAT);
    fs.writefile(health.paths.proc + "/4242/status", STATUS);
    t.eq(health.process_usage(4242), { started: 190694980, cpu_ticks: 281, memory_kb: 25152 });

    fs.writefile(health.paths.proc + "/4242/status", "Name:\tsing-box\nVmRSS:\t   67404 kB\n");
    t.eq(health.process_usage(4242), null, "a kernel that reports no anonymous pages");
    t.eq(health.process_usage(4343), null, "a process that is gone");
});

const RULE4 ="105:\tfrom all fwmark 0x4000000/0x4000000 lookup forkop\n";

function snapshot(tables, route4, route6, rule4, rule6) {
    return nft_state.runtime_network_configured_snapshot({ tables, inet4: route4 + rule4, inet6: route6 + rule6 }, "ForkopTable", "0x04000000");
}

const META = "{\"metainfo\":{\"version\":\"1.1.6\",\"json_schema_version\":1}}";
const PAUSE_CHAIN = "{\"chain\":{\"family\":\"inet\",\"table\":\"ForkopTable\",\"name\":\"capture_pause\",\"handle\":3}}";
const PAUSE_RULE = "{\"rule\":{\"family\":\"inet\",\"table\":\"ForkopTable\",\"chain\":\"capture_pause\",\"handle\":6,\"expr\":[{\"accept\":null}]}}";

t.test("the runtime network is up when the table captures and both routes and rules exist", () => {
    let json_tables = "{\"nftables\":[" + META + "," + PAUSE_CHAIN + "]}";
    let route4 = "local default dev lo scope host\n";
    let route6 = "local default dev lo metric 1024 pref medium\n";
    t.ok(snapshot(json_tables, route4, route6, RULE4, RULE4));
    t.ok(snapshot("table inet ForkopTable {\n\tchain capture_pause {\n\t}\n}\n", route4, route6, RULE4, RULE4), "an nft built without JSON output");
    t.ok(!snapshot("{\"nftables\":[" + META + "," + PAUSE_CHAIN + "," + PAUSE_RULE + "]}", route4, route6, RULE4, RULE4),
        "a capture paused for a reload captures nothing");
    t.ok(!snapshot("table inet ForkopTable {\n\tchain capture_pause {\n\t\tcounter packets 0 bytes 0 accept\n\t}\n}\n", route4, route6, RULE4, RULE4));
    t.ok(!snapshot("{\"nftables\":[" + META + "]}", route4, route6, RULE4, RULE4), "no table");
    t.ok(!snapshot("table inet ForkopTable {\n}\n", route4, route6, RULE4, RULE4), "a table without the pause chain");
    t.ok(!snapshot("{\"nftables\":[" + META + "," + replace(PAUSE_CHAIN, "ForkopTable", "OtherTable") + "]}", route4, route6, RULE4, RULE4),
        "the chain of another table");
    t.ok(!snapshot(json_tables, "", route6, RULE4, RULE4), "without the IPv4 route");
    t.ok(!snapshot(json_tables, route4, route6, "105:\tfrom all fwmark 0x2000000/0x2000000 lookup forkop\n", RULE4), "a rule for another mark");
    t.ok(snapshot(json_tables, route4, route6, RULE4, "105:\tfrom all fwmark 0x4000000/0x4000000 lookup podkop\n"),
        "another package may own the printed name of table 105");
});

t.test("the routing table registry entry is matched by id and name", () => {
    t.ok(nft_state.rt_table_has_entry("255\tlocal\n105 forkop\n", "105", "forkop"));
    t.ok(!nft_state.rt_table_has_entry("105 podkop\n", "105", "forkop"));
});

t.test("the network check asks nft for the pause chain, not for the table", () => {
    stub.commands([ [ () => true, { stdout: "" } ] ]);
    nft_state.runtime_network_configured("ForkopTable", "forkop", "0x04000000");
    let command = stub.calls()[0].command;
    stub.restore();
    t.contains(command, "'nft' '-j' 'list' 'chain' 'inet' 'ForkopTable' 'capture_pause'");
});

t.done();
