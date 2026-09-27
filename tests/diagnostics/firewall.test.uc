let t = require("t");
let firewall = require("diagnostics.firewall");
let singbox_constants = require("singbox.constants");

function rule(extra) {
    return { ".type": "rule", enabled: "1", target: "ACCEPT", src: "wan", dest_port: "443", ...extra };
}

t.test("a firewall rule opens a port for the protocols it lists, however they are written", () => {
    t.ok(firewall.required_protocols_open([ rule({ proto: "tcp udp" }) ], "443", "tcp udp"));
    t.ok(firewall.required_protocols_open([ rule({ proto: [ "tcp", "udp" ] }) ], "443", "tcp udp"), "a list option");
    t.ok(firewall.required_protocols_open([ rule({ proto: [ "tcp", "udp" ], dest_port: [ "80", "440-450" ] }) ], "443", "udp"));
    t.ok(!firewall.required_protocols_open([ rule({ proto: "tcp udp" }) ], "8443", "tcp"), "another port");
    t.ok(!firewall.required_protocols_open([ rule({ proto: "tcp", src_port: "12345" }) ], "443", "tcp"), "a source port cannot match a client");
    t.ok(!firewall.required_protocols_open([ rule({ proto: "tcp" }) ], "443", "tcp udp"), "a missing protocol");
});

t.test("Forkop's own accept rules count only for the ports and protocols they list", () => {
    let chain = "        type filter hook input priority filter; policy drop;\n" +
        "        tcp dport { 22387, 24441, 34472 } counter packets 553 bytes 85115 accept comment \"forkop: server ports\"\n" +
        "        udp dport { 24441, 38536 } counter packets 0 bytes 0 accept comment \"forkop: server ports\"\n" +
        "        tcp dport 51820 counter packets 0 bytes 0 accept comment \"other: single port\"\n" +
        "        tcp dport { 9999 } counter packets 0 bytes 0 drop comment \"forkop: server ports\"\n";
    let accepts = (port, proto) => firewall.forkop_accepts_port(chain, singbox_constants.SERVER_FIREWALL_COMMENT, port, proto);
    t.ok(accepts("34472", "tcp"));
    t.ok(accepts("24441", "tcp udp"));
    t.ok(!accepts("38536", "tcp udp"));
    t.ok(!accepts("51820", "tcp"), "a rule that is not Forkop's");
    t.ok(!accepts("9999", "tcp"), "a rule that is not an accept");
    t.ok(!accepts("12345", "tcp"));
    t.ok(!firewall.forkop_accepts_port("", singbox_constants.SERVER_FIREWALL_COMMENT, "34472", "tcp"));
});

t.done();
