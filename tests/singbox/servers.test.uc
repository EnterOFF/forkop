let t = require("t");
let servers = require("singbox.servers");

t.test("a server listens on the transports its protocol needs", () => {
    for (let pair in [ [ [ "hysteria2" ], "udp" ], [ [ "tuic" ], "udp" ], [ [ "mieru", "UDP" ], "udp" ], [ [ "mieru", "TCP" ], "tcp" ],
        [ [ "naive", "udp" ], "udp" ], [ [ "naive", "tcp_udp" ], "tcp udp" ], [ [ "naive", "tcp" ], "tcp" ], [ [ "shadowsocks" ], "tcp udp" ],
        [ [ "vless" ], "tcp" ] ])
        t.eq(join(" ", servers.transports(pair[0][0], pair[0][1] ?? "")), pair[1], join(" ", pair[0]));
});

t.test("a server runs with a security mode its protocol accepts, whatever is stored", () => {
    for (let entry in [
        [ "trojan", "none", "tls" ], [ "trojan", "reality", "tls" ], [ "trojan", "", "tls" ],
        [ "vless", "", "reality" ], [ "vless", "none", "none" ], [ "vmess", "reality", "none" ], [ "vmess", "tls", "tls" ],
        [ "hysteria2", "none", "tls" ], [ "shadowsocks", "tls", "none" ]
    ])
        t.eq(servers.effective_security({ security: entry[1] }, entry[0]), entry[2], entry[0] + " stored as '" + entry[1] + "'");
});

t.done();
