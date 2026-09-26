let t = require("t");
let mask = require("diagnostics.mask");
let firewall = require("diagnostics.firewall");
let inbounds = require("diagnostics.inbounds");
let proxy_check = require("diagnostics.check_proxy");
let netstat = require("core.netstat");
let singbox_constants = require("singbox.constants");

t.test("the masked Forkop configuration keeps its shape and loses every secret", () => {
    let masked = mask.forkop_config(
        "config settings 'main'\n        option hwid 'device-secret'\n        option proxy_string 'vless://secret@example.com:443'\n" +
        "config subscription_url 'sub1'\n        option url 'https://user:password@example.com/subscription?token=secret'\n" +
        "        list header 'Authorization: Bearer header-secret'\nconfig section 'tunnels'\nconfig tunnel 'tun_tailnet'\n" +
        "        option section 'tunnels'\n        option kind 'tailscale'\n        option tailscale_auth_key 'tskey-secret'\n" +
        "        option warp_profile_auth_token 'warp-token-secret'\n        option warp_profile_private_key 'warp-private-secret'\n" +
        "        option warp_profile_license_key 'warp-license-secret'\nconfig tunnel_peer 'peer_tailnet'\n" +
        "        option tunnel 'tun_tailnet'\n        option pre_shared_key 'peer-secret'\n");
    for (let secret in [ "device-secret", "vless://secret", "token=secret", "user:password", "header-secret", "tskey-secret",
        "warp-token-secret", "warp-private-secret", "warp-license-secret", "peer-secret" ])
        t.excludes(masked, secret);
    for (let kept in [ "list header 'MASKED'", "option hwid 'MASKED'", "option url 'MASKED'", "option tailscale_auth_key 'MASKED'",
        "option warp_profile_auth_token 'MASKED'", "option pre_shared_key 'MASKED'" ])
        t.contains(masked, kept);
});

t.test("the masked WAN configuration hides the WireGuard key of the WAN", () => {
    let masked = mask.wan_config("config interface 'wan'\n        option proto 'wireguard'\n        option private_key 'wireguard-private-secret'\n" +
        "        option addresses '192.0.2.2/32'\nconfig interface 'lan'\n        option private_key 'not-in-wan'\n");
    t.excludes(masked, "wireguard-private-secret");
    t.contains(masked, "option private_key '******'");
});

t.test("a proxy check answer is reduced to the masked address", () => {
    t.eq(mask.proxy_response_ip("{\"fakeip\": false, \"IP\": \"194.76.146.236\"}\n"), "X.X.X.236");
    t.eq(mask.proxy_response_ip("198.51.100.9\n"), "X.X.X.9");
    t.eq(mask.proxy_response_ip("2001:db8::1\n"), "2001:db8:0:XXXX:XXXX:XXXX:XXXX:XXXX", "a compressed IPv6 address");
    t.eq(mask.proxy_response_ip("{\"IP\": \"2a02:6b8:c0e:500:1:2:3:4\"}"), "2a02:6b8:c0e:XXXX:XXXX:XXXX:XXXX:XXXX", "an IPv6 exit in JSON");
    t.eq(mask.proxy_response_ip("<html>blocked</html>"), null);
});

t.test("hand-written outbounds are masked, however many lines they take", () => {
    let masked = mask.forkop_config("config section 'main'\n        list outbound_jsons '{\"type\":\"vless\",\"server\":\"secret.example\"}'\n" +
        "        list outbound_jsons '{\n            \"type\": \"trojan\",\n            \"password\": \"trojan-secret\"\n        }'\n        option label 'Main'\n");
    t.excludes(masked, "secret.example");
    t.excludes(masked, "trojan-secret");
    t.contains(masked, "list outbound_jsons 'MASKED'");
    t.contains(masked, "option label 'Main'", "the line after a masked JSON value is kept");
});

t.test("the sing-box dump hides the subscription behind a provider and a private resolver's account", () => {
    let masked = mask.sing_box_config({
        providers: [ { tag: "Main/sub1", type: "remote", url: "https://panel.example/sub?token=sub-secret", headers: { "X-HWID": "hwid-secret" } } ],
        route: { rule_set: [ { tag: "list", type: "remote", url: "https://lists.example/russia.srs" } ] },
        dns: { servers: [ { tag: "a", type: "https", server: "d.adguard-dns.com", path: "/dns-query/adguard-secret" },
            { tag: "b", type: "https", server: "1.1.1.1", path: "/dns-query" } ] }
    });
    let text = sprintf("%J", masked);
    for (let secret in [ "sub-secret", "hwid-secret", "adguard-secret" ])
        t.excludes(text, secret);
    t.eq(masked.route.rule_set[0].url, "https://lists.example/russia.srs", "a public list keeps its URL");
    t.eq([ masked.dns.servers[0].path, masked.dns.servers[1].path ], [ "/dns-query/MASKED", "/dns-query" ]);
});

t.test("a private resolver's account is masked in its host or its path, a public one stays readable", () => {
    for (let pair in [
        [ "https://dns.nextdns.io/abc123", "https://dns.nextdns.io/******" ],
        [ "tls://abc123.dns.nextdns.io", "tls://******.dns.nextdns.io" ],
        [ "https://d.adguard-dns.com/dns-query/abcd1234", "https://d.adguard-dns.com/dns-query/MASKED" ],
        [ "quic://abcd1234.d.adguard-dns.com", "quic://********.d.adguard-dns.com" ],
        [ "https://dns.controld.com/abcd1234", "https://dns.controld.com/MASKED" ],
        [ "tls://abcd1234.dns.controld.com", "tls://********.dns.controld.com" ],
        [ "https://1.1.1.1/dns-query", "https://1.1.1.1/dns-query" ],
        [ "8.8.8.8", "8.8.8.8" ]
    ])
        t.eq(mask.dns_server(pair[0]), pair[1], pair[0]);
});

t.test("the WAN keeps its protocol and loses what identifies the line, whatever the protocol", () => {
    let masked = mask.wan_config("config interface 'wan'\n        option proto 'l2tp'\n        option server 'lns.isp.example'\n" +
        "        option username 'l2tp-user'\n        option password 'l2tp-secret'\n        option macaddr '02:00:00:12:34:56'\n" +
        "        option ip6addr '2001:db8::2/64'\n        option pincode '1234'\n        list ipaddr '192.0.2.2/24'\n");
    for (let secret in [ "lns.isp.example", "l2tp-user", "l2tp-secret", "02:00:00:12:34:56", "2001:db8::2", "1234", "192.0.2.2" ])
        t.excludes(masked, secret);
    t.contains(masked, "option proto 'l2tp'");
});

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

t.test("a server listens on the transports its protocol needs", () => {
    let servers = require("singbox.servers");
    for (let pair in [ [ [ "hysteria2" ], "udp" ], [ [ "tuic" ], "udp" ], [ [ "mieru", "UDP" ], "udp" ], [ [ "mieru", "TCP" ], "tcp" ],
        [ [ "naive", "udp" ], "udp" ], [ [ "naive", "tcp_udp" ], "tcp udp" ], [ [ "naive", "tcp" ], "tcp" ], [ [ "shadowsocks" ], "tcp udp" ],
        [ [ "vless" ], "tcp" ] ])
        t.eq(join(" ", servers.transports(pair[0][0], pair[0][1] ?? "")), pair[1], join(" ", pair[0]));
});

t.test("a listener needs the firewall when WAN traffic can reach it", () => {
    for (let pair in [ [ "0.0.0.0", "" ], [ "::", "" ], [ "198.51.100.2", "198.51.100.2" ], [ "2001:db8::2", "198.51.100.2 2001:db8::2" ],
        [ "1.1.1.1", "" ], [ "2606:4700:4700::1111", "" ] ])
        t.ok(inbounds.listen_requires_firewall(pair[0], pair[1]), pair[0]);
    t.ok(!inbounds.listen_requires_firewall("192.168.1.2", "198.51.100.2"), "a private address that is not the WAN");
    t.ok(!inbounds.listen_requires_firewall("203.0.113.2", ""), "a documentation address");
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

t.test("netstat tells a listener apart and names who else holds its port", () => {
    let listening = "Active Internet connections (only servers)\nProto Recv-Q Send-Q Local Address           Foreign Address         State\n" +
        "tcp        0      0 0.0.0.0:443             0.0.0.0:*               LISTEN\nudp        0      0 0.0.0.0:443             0.0.0.0:*\n";
    t.ok(netstat.port_listening(listening, "0.0.0.0", "443", "tcp") && netstat.port_listening(listening, "0.0.0.0", "443", "udp"));
    t.ok(!netstat.port_listening(listening, "0.0.0.0", "8443", "tcp"));
    t.ok(netstat.port_listening("tcp        0      0 ::1:8443                :::*                    LISTEN\n", "::1", "8443", "tcp"));
    let owners = "Active Internet connections (only servers)\n" +
        "Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name\n" +
        "tcp        0      0 0.0.0.0:443             0.0.0.0:*               LISTEN      111/nginx\n" +
        "udp        0      0 0.0.0.0:443             0.0.0.0:*                           222/dnsmasq\n" +
        "tcp        0      0 0.0.0.0:443             0.0.0.0:*               LISTEN      333/sing-box\n";
    let found = [];
    for (let proto in [ "tcp", "udp" ])
        push(found, ...netstat.port_conflict_owners(owners, "0.0.0.0", "443", proto));
    t.eq(netstat.sorted_unique(found), [ "111/nginx", "222/dnsmasq" ]);
});

t.test("the throwaway proxy check core drops what would need downloading or fight the running one", () => {
    let prepared = proxy_check.prepare_config({
        dns: { rules: [ { rule_set: [ "remote-lists" ], server: "fakeip-server" }, { domain: [ "example.org" ], server: "fakeip-server" } ] },
        inbounds: [ { type: "tproxy", tag: "tproxy-in" } ],
        route: {
            rule_set: [ { type: "remote", tag: "remote-lists", url: "https://example.com/lists.srs" }, { type: "local", tag: "local-lists", path: "/tmp/lists.srs" } ],
            rules: [
                { rule_set: [ "remote-lists" ], outbound: "proxy" },
                { type: "logical", mode: "and", rules: [ { rule_set: "remote-lists" }, { port: 443 } ], outbound: "proxy" },
                { rule_set: [ "local-lists" ], outbound: "proxy" },
                { domain: "ip.podkop.fyi", outbound: "proxy 1" }
            ]
        },
        experimental: { cache_file: { enabled: true, path: "/tmp/sing-box/cache.db" }, clash_api: { external_controller: "127.0.0.1:9090" } }
    }, "/tmp/check/cache.db");
    t.eq(map(prepared.route.rule_set, (s) => s.tag), [ "local-lists" ]);
    t.excludes(sprintf("%J", prepared.route.rules), "remote-lists");
    t.excludes(sprintf("%J", prepared.dns.rules), "remote-lists");
    t.contains(sprintf("%J", prepared.dns.rules), "example.org");
    t.eq([ prepared.experimental.clash_api, prepared.inbounds, prepared.experimental.cache_file.path ], [ null, [], "/tmp/check/cache.db" ]);
    t.eq(proxy_check.outbound_tag(prepared, "ip.podkop.fyi"), "proxy 1");
});

t.done();
