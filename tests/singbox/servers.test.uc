let t = require("t");
let servers = require("singbox.servers");

t.test("a server listens on the transports its protocol needs", () => {
    for (let pair in [ [ [ "hysteria2" ], "udp" ], [ [ "tuic" ], "udp" ], [ [ "mieru", "UDP" ], "udp" ], [ [ "mieru", "TCP" ], "tcp" ],
        [ [ "naive", "udp" ], "udp" ], [ [ "naive", "tcp_udp" ], "tcp udp" ], [ [ "naive", "tcp" ], "tcp" ], [ [ "shadowsocks" ], "tcp udp" ],
        [ [ "trusttunnel", "udp" ], "udp" ], [ [ "trusttunnel", "tcp_udp" ], "tcp udp" ], [ [ "trusttunnel" ], "tcp" ],
        [ [ "vless" ], "tcp" ] ])
        t.eq(join(" ", servers.transports(pair[0][0], pair[0][1] ?? "")), pair[1], join(" ", pair[0]));
});

t.test("a server without a stored network listens on its protocol's default", () => {
    for (let pair in [ [ "naive", "tcp" ], [ "trusttunnel", "tcp" ], [ "mieru", "tcp" ], [ "openvpn", "udp" ] ])
        t.eq(join(" ", servers.listen_transports({ protocol: pair[0] })), pair[1], pair[0]);
});

t.test("an XHTTP server listens on UDP when TLS offers h3 alone, as sing-box then serves HTTP/3", () => {
    let xhttp = { protocol: "vless", security: "tls", transport: "xhttp", tls_alpn: [ "h3" ] };
    t.ok(servers.serves_xhttp_http3(xhttp), "serves HTTP/3");
    t.eq(join(" ", servers.listen_transports(xhttp)), "udp", "h3 alone");
    t.eq(join(" ", servers.listen_transports({ ...xhttp, protocol: "trojan" })), "udp", "trojan");
    t.eq(join(" ", servers.listen_transports({ ...xhttp, tls_alpn: [ "h3", "h2" ] })), "tcp", "h3 among others");
    t.eq(join(" ", servers.listen_transports({ ...xhttp, security: "none" })), "tcp", "without TLS");
    t.eq(join(" ", servers.listen_transports({ ...xhttp, transport: "ws" })), "tcp", "another transport");
});

t.test("a server runs with a security mode its protocol accepts, whatever is stored", () => {
    for (let entry in [
        [ "trojan", "none", "tls" ], [ "trojan", "reality", "tls" ], [ "trojan", "", "tls" ],
        [ "vless", "", "reality" ], [ "vless", "none", "none" ], [ "vmess", "reality", "none" ], [ "vmess", "tls", "tls" ],
        [ "hysteria2", "none", "tls" ], [ "trusttunnel", "", "tls" ], [ "shadowsocks", "tls", "none" ]
    ])
        t.eq(servers.effective_security({ security: entry[1] }, entry[0]), entry[2], entry[0] + " stored as '" + entry[1] + "'");
});

t.done();
