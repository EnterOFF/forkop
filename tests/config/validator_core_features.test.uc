let t = require("t");
let v = require("validation");

const BASE = [ "badlinkname", "tfogo_checklinkname0", "with_clash_api", "with_gvisor", "with_masque", "with_mtproxy",
    "with_openvpn", "with_quic", "with_sudoku", "with_trusttunnel", "with_utls", "with_wireguard" ];
const FULL = [ ...BASE, "with_tailscale", "with_naive_outbound", "with_call", "with_openconnect", "with_api" ];

function without(tags, tag) {
    return filter(tags, (item) => item != tag);
}

function section(extra) {
    return { ".name": "proxy", enabled: "1", action: "connection", ...(extra ?? {}) };
}

function server(protocol, extra) {
    return { ".name": "srv", enabled: "1", protocol, ...(extra ?? {}) };
}

// The refusal names what the configuration asks for and the tags the build
// lacks; with the tags present, whatever else the fixture lacks is not about the core.
function needs(data, tags, message) {
    v.refuses(data, message, { core_tags: tags });
    let result = v.run(data, { core_tags: FULL });
    t.ok(result.error == null || index(result.error, "this sing-box build lacks") < 0,
        "a core with every tag refused it: " + result.error);
}

t.test("a server of a type the build lacks is refused by name", () => {
    needs({ server: [ server("hysteria2") ] }, without(BASE, "with_quic"),
        "Server 'srv' uses hysteria2, but this sing-box build lacks QUIC (built without with_quic)");
    needs({ server: [ server("tuic") ] }, without(BASE, "with_quic"), "Server 'srv' uses tuic");
    needs({ server: [ server("tailscale") ] }, BASE, "Server 'srv' uses tailscale, but this sing-box build lacks Tailscale (built without with_tailscale)");
    needs({ server: [ server("openvpn") ] }, without(BASE, "with_openvpn"),
        "Server 'srv' uses openvpn, but this sing-box build lacks OpenVPN (built without with_openvpn)");
    needs({ server: [ server("vless", { security: "reality" }) ] }, without(BASE, "with_utls"), "Server 'srv' uses Reality");
    needs({ server: [ server("naive", { naive_network: "udp" }) ] }, without(BASE, "with_quic"), "serves NaiveProxy over QUIC");
});

t.test("a disabled server asks nothing of the core", () => {
    let result = v.run({ server: [ server("hysteria2", { enabled: "0" }) ] }, { core_tags: [ "with_clash_api" ] });
    t.eq(result.error, null);
});

t.test("a tunnel of a type the build lacks is refused by name", () => {
    for (let kind in [ "wireguard", "amneziawg", "warp" ])
        needs({ section: [ section() ], tunnel: [ { ".name": "tun", section: "proxy", kind, name: "Home" } ] },
            without(BASE, "with_gvisor"), "Section 'proxy' has a " + kind + " tunnel 'Home', but this sing-box build lacks WireGuard, AmneziaWG and WARP (built without with_gvisor)");
    needs({ section: [ section() ], tunnel: [ { ".name": "tun", section: "proxy", kind: "tailscale", name: "Net" } ] },
        BASE, "has a tailscale tunnel 'Net'");
    needs({ section: [ section() ], tunnel: [ { ".name": "tun", section: "proxy", kind: "openvpn-client", name: "Office" } ] },
        without(BASE, "with_openvpn"), "has a openvpn-client tunnel 'Office'");
});

// The field is the user's own sing-box object, and its type is the core's to judge.
t.test("a JSON endpoint is not judged by its type", () => {
    let result = v.run({
        section: [ section() ],
        tunnel: [ { ".name": "tun", section: "proxy", kind: "json", endpoint_json: "{\"type\":\"wireguard\",\"tag\":\"raw\"}" } ]
    }, { core_tags: [ "with_clash_api" ] });
    t.ok(result.error == null || index(result.error, "this sing-box build lacks") < 0, "refused: " + result.error);
});

t.test("a link the build cannot dial is refused, without printing its secrets", () => {
    let hy2 = "hy2://secret-password@example.com:443?sni=example.com#Fast";
    needs({ section: [ section({ selector_proxy_links: [ hy2 ] }) ] }, without(BASE, "with_quic"),
        "Section 'proxy' has a hy2:// link 'Fast', but this sing-box build lacks QUIC (built without with_quic)");
    let result = v.run({ section: [ section({ selector_proxy_links: [ hy2 ] }) ] }, { core_tags: without(BASE, "with_quic") });
    t.ok(index(result.error, "secret-password") < 0, "the refusal carries the password");

    needs({ section: [ section({ selector_proxy_links: [ "naive+https://u:p@example.com:443#N" ] }) ] }, BASE,
        "has a naive+https:// link 'N', but this sing-box build lacks the NaiveProxy client (built without with_naive_outbound)");
    needs({ section: [ section({ selector_proxy_links: [ "vless://u@example.com:443?security=reality&pbk=key&sni=a.com#R" ] }) ] },
        without(BASE, "with_utls"), "has a vless:// link 'R' that uses Reality or a TLS fingerprint");
});

t.test("a subscription is left to the core, which skips what it cannot build", () => {
    let result = v.run({
        section: [ section() ],
        subscription_url: [ { ".name": "sub", section: "proxy", url: "https://example.com/sub" } ]
    }, { core_tags: [ "with_clash_api" ] });
    t.ok(result.error == null || index(result.error, "this sing-box build lacks") < 0, "refused: " + result.error);
});

t.test("DNS over QUIC and HTTP/3 need QUIC", () => {
    needs({ settings: { dns_server: [ "quic://dns.adguard-dns.com" ] } }, without(BASE, "with_quic"),
        "DNS server 'quic://dns.adguard-dns.com' uses DNS over QUIC, but this sing-box build lacks QUIC");
    needs({ settings: { bootstrap_dns_server: [ "h3://1.1.1.1/dns-query" ] } }, without(BASE, "with_quic"),
        "DNS server 'h3://1.1.1.1/dns-query' uses DNS over HTTP/3");
});

t.test("a DNS section's servers need QUIC for DNS over QUIC too", () => {
    needs({ section: [ { ".name": "dns", enabled: "1", action: "dns", dns_server: [ "quic://dns.example.com" ], destinations: "example.org" } ] },
        without(BASE, "with_quic"), "DNS server 'quic://dns.example.com' uses DNS over QUIC");
});

t.test("the sing-box dashboard needs the API service", () => {
    needs({ settings: { enable_native_api: "1", native_api_secret: "s" } }, BASE,
        "The sing-box Dashboard and API setting is on, but this sing-box build lacks the sing-box API (built without with_api)");
});

t.test("requesting WARP profiles through a section needs WARP", () => {
    needs({
        settings: { warp_profiles_via_proxy: "1", warp_profiles_via_proxy_section: "proxy" },
        section: [ section({ selector_proxy_links: [ "vless://u@a.example:443#A" ] }) ]
    }, without(BASE, "with_wireguard"),
        "Requesting WARP profiles through a section is on, but this sing-box build lacks WireGuard, AmneziaWG and WARP (built without with_wireguard)");
});

t.done();
