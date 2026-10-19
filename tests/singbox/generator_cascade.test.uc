let t = require("t");
let fixture = require("fixture");
let q = require("sbconfig");
let generator = require("singbox.generator");

const WG_KEY = "zz5/p+jwYqPFlg9mWcOP5ad8xXa4XfOOlrzouVD6E1w=";
const WG_PUB = "AKR8dq2b9o7/cO8d5mAzxvuxRhhw4DXi1pfUC3IPGWo=";

function link(name, order, uri, extra) {
    return { ".name": name, section: "source", order, uri, name: split(uri, "#")[1], ...(extra ?? {}) };
}

function tunnel(name, order, kind, extra) {
    return { ".name": name, section: "source", order, kind, name, ...(extra ?? {}) };
}

function peer(owner, address) {
    return { ".name": "peer_" + owner, tunnel: owner, order: "0", address, port: "51820",
        public_key: WG_PUB, allowed_ips: [ "0.0.0.0/0" ] };
}

const THROUGH_HOP = { detour_section: "hop" };

function build() {
    fixture.seed({
        settings: { dns_server: "1.1.1.1", service_listen_address: "127.0.0.1" },
        section: [
            { ".name": "hop", label: "Hop", enabled: "1", action: "connection" },
            {
                ".name": "source", enabled: "1", action: "connection",
                outbound_jsons: [
                    "{\"type\":\"socks\",\"tag\":\"JSON plain\",\"server\":\"127.0.0.1\",\"server_port\":1082,\"version\":\"5\"}",
                    "{\"type\":\"socks\",\"tag\":\"JSON explicit\",\"server\":\"127.0.0.1\",\"server_port\":1083,\"version\":\"5\",\"detour\":\"direct-out\"}"
                ]
            }
        ],
        connection_link: [
            ...fixture.links("hop", [ "socks5://127.0.0.1:1080#Hop node" ]),
            link("link_through", "0", "socks5://127.0.0.1:1081#Through", THROUGH_HOP),
            link("link_direct", "1", "socks5://127.0.0.1:1084#Direct")
        ],
        subscription_url: [
            { ".name": "sub_through", section: "source", url: "https://subscription.example/through", tag: "sub1", ...THROUGH_HOP },
            { ".name": "sub_direct", section: "source", url: "https://subscription.example/direct", tag: "sub2" }
        ],
        section_interface: [ { ".name": "source_wg0", section: "source", name: "wg0" } ],
        tunnel: [
            tunnel("WireGuard", "0", "wireguard", { address: [ "10.0.0.2/32" ], private_key: WG_KEY, ...THROUGH_HOP }),
            tunnel("AmneziaWG", "1", "amneziawg", { address: [ "10.0.0.3/32" ], private_key: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=", amnezia_jc: "4", ...THROUGH_HOP }),
            tunnel("WARP", "2", "warp", { warp_profile_id: "id", warp_profile_auth_token: "token", warp_profile_private_key: WG_KEY, ...THROUGH_HOP }),
            tunnel("OpenVPN", "3", "openvpn-client", {
                endpoint_json: "{\"type\":\"openvpn-client\",\"server\":\"vpn.example\",\"server_port\":1194}", ...THROUGH_HOP
            }),
            tunnel("Plain", "4", "wireguard", { address: [ "10.0.0.4/32" ], private_key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=" }),
            tunnel("Tailnet", "5", "tailscale", { tailscale_auth_key: "tskey", ...THROUGH_HOP })
        ],
        tunnel_peer: [ peer("WireGuard", "203.0.113.1"), peer("AmneziaWG", "203.0.113.2"), peer("Plain", "203.0.113.3") ]
    });
    return generator.build({ service_address: "127.0.0.1" });
}

t.test("a cascade sends the link, subscription or tunnel that names it through the section", () => {
    let config = build();
    t.eq(q.outbound(config, "source/Through").detour, "Hop");
    t.eq(q.provider(config, "source/sub1").override.detour, "Hop");
    for (let name in [ "WireGuard", "AmneziaWG", "WARP", "OpenVPN" ])
        t.eq(q.endpoint(config, "source/" + name).detour, "Hop", name);
});

t.test("a server beside it connects on its own", () => {
    let config = build();
    t.eq(q.outbound(config, "source/Direct").detour, null, "a link without a cascade");
    t.eq(q.provider(config, "source/sub2").override, null, "a subscription without a cascade");
    t.eq(q.endpoint(config, "source/Plain").detour, null, "a tunnel without a cascade");
    t.eq(q.endpoint(config, "source/Tailnet").detour, null, "a Tailscale tunnel takes only its coordination server's section");
    t.eq(q.outbound(config, "source/wg0").detour, null, "an interface");
    t.eq(q.outbound(config, "source/JSON plain").detour, null, "a plain JSON outbound");
    t.eq(q.outbound(config, "source/JSON explicit").detour, "direct-out", "an explicit JSON detour is kept");
    t.eq(q.outbound(config, "source").detour, null, "the section selector gets no detour of its own");
});

t.done();
