let t = require("t");
let netstat = require("core.netstat");

// Whether the Clash API controller address is already taken on the router, read
// from netstat's listening sockets.
const EXPLICIT = "tcp 0 0 192.168.1.1:9090 0.0.0.0:* LISTEN";
const IPV4_WILDCARD = "tcp 0 0 0.0.0.0:9090 0.0.0.0:* LISTEN";
const IPV6_WILDCARD = "tcp 0 0 :::9090 :::* LISTEN";

t.test("a listener on the same address and port is in the way", () => {
    t.eq(netstat.tcp_endpoint_in_use(EXPLICIT, "192.168.1.1:9090"), true);
});

t.test("a wildcard listener and an explicit address are in each other's way", () => {
    t.eq(netstat.tcp_endpoint_in_use(IPV4_WILDCARD, "192.168.1.1:9090"), true);
    t.eq(netstat.tcp_endpoint_in_use(EXPLICIT, "0.0.0.0:9090"), true);
    t.eq(netstat.tcp_endpoint_in_use(IPV6_WILDCARD, "192.168.1.1:9090"), true, "a dual-stack wildcard");
});

t.test("another address or another port is not", () => {
    t.eq(netstat.tcp_endpoint_in_use(EXPLICIT, "192.168.1.2:9090"), false);
    t.eq(netstat.tcp_endpoint_in_use(EXPLICIT, "192.168.1.1:9091"), false);
});

t.done();
