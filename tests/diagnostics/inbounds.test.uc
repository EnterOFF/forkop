let t = require("t");
let inbounds = require("diagnostics.inbounds");

t.test("a listener needs the firewall when WAN traffic can reach it", () => {
    for (let pair in [ [ "0.0.0.0", "" ], [ "::", "" ], [ "198.51.100.2", "198.51.100.2" ], [ "2001:db8::2", "198.51.100.2 2001:db8::2" ],
        [ "1.1.1.1", "" ], [ "2606:4700:4700::1111", "" ] ])
        t.ok(inbounds.listen_requires_firewall(pair[0], pair[1]), pair[0]);
    t.ok(!inbounds.listen_requires_firewall("192.168.1.2", "198.51.100.2"), "a private address that is not the WAN");
    t.ok(!inbounds.listen_requires_firewall("203.0.113.2", ""), "a documentation address");
});

t.test("an OpenVPN server is an endpoint of its own type, found where Tailscale is", () => {
    t.eq([ inbounds.runtime_type("openvpn"), inbounds.runtime_kind("openvpn") ], [ "openvpn-server", "endpoints" ]);
    t.eq([ inbounds.runtime_type("vless"), inbounds.runtime_kind("vless") ], [ "vless", "inbounds" ]);
    t.eq(inbounds.runtime_kind("tailscale"), "endpoints");
    t.eq(inbounds.runtime_ok("openvpn", "1", "openvpn-server", "::", "1194", "openvpn-server", "::", "1194"), 1,
        "its listener is compared like any other");
    t.eq(inbounds.runtime_ok("openvpn", "1", "openvpn-server", "::", "1195", "openvpn-server", "::", "1194"), 0);
});

t.test("the public host of a server is judged against the WAN", () => {
    let flags = (host, ips, wan, wan_public) => {
        let f = inbounds.public_host_flags(host, ips, wan, wan_public);
        return [ f.resolved, f.public_ip, f.matches_wan ];
    };
    t.eq(flags("", "", "8.8.8.8", 1), [ -1, -1, -1 ]);
    t.eq(flags("example.com", "", "8.8.8.8", 1), [ 0, -1, -1 ]);
    t.eq(flags("example.com", "1.1.1.1 8.8.8.8", "8.8.8.8", 1), [ 1, 1, 1 ]);
    t.eq(flags("example.com", "192.168.1.10", "8.8.8.8", 1), [ 1, 0, 0 ]);
    t.eq(flags("example.com", "8.8.8.8", "8.8.8.8", 0), [ 1, 1, -1 ]);
    t.eq(flags("example.com", "2606:4700:4700::1111", "198.51.100.2 2606:4700:4700::1111", 1), [ 1, 1, 1 ]);
});

t.done();
