let t = require("t");
let servers = require("singbox.servers");

t.test("a server listens on the transports its protocol needs", () => {
    for (let pair in [ [ [ "hysteria2" ], "udp" ], [ [ "tuic" ], "udp" ], [ [ "mieru", "UDP" ], "udp" ], [ [ "mieru", "TCP" ], "tcp" ],
        [ [ "naive", "udp" ], "udp" ], [ [ "naive", "tcp_udp" ], "tcp udp" ], [ [ "naive", "tcp" ], "tcp" ], [ [ "shadowsocks" ], "tcp udp" ],
        [ [ "vless" ], "tcp" ] ])
        t.eq(join(" ", servers.transports(pair[0][0], pair[0][1] ?? "")), pair[1], join(" ", pair[0]));
});

t.done();
