let t = require("t");
let v = require("validation");
let fixture = require("fixture");

function tunnels() {
    return {
        settings: { dns_server: [ "1.1.1.1" ], bootstrap_dns_server: [ "1.1.1.1" ] },
        section: [ { ".name": "tunnels", enabled: "1", action: "connection" } ],
        tunnel: [
            {
                ".name": "tun_warp", section: "tunnels", order: "0",
                kind: "warp", name: "Generated WARP", warp_profile_id: "profile-id",
                warp_profile_auth_token: "auth-token", warp_profile_private_key: "private-key",
                warp_profile_license_key: "license-key", amnezia_jc: "7", amnezia_h1: "100-200"
            },
            {
                ".name": "tun_amnezia", section: "tunnels", order: "1",
                kind: "amneziawg", name: "Imported AmneziaWG", address: [ "10.0.0.2/32" ],
                private_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", amnezia_jc: "5", amnezia_h1: "100-200"
            },
            {
                ".name": "tun_tailnet", section: "tunnels", order: "2",
                kind: "tailscale", name: "Tailnet", tailscale_auth_key: "tskey-auth-test",
                tailscale_hostname: "forkop-router", tailscale_exit_node: "100.64.0.1"
            },
            {
                ".name": "tun_json", section: "tunnels", order: "3",
                kind: "json", endpoint_json: "{\"type\":\"vpn-client\",\"tag\":\"custom-endpoint\"}"
            }
        ],
        tunnel_peer: [ {
            ".name": "peer_amnezia", tunnel: "tun_amnezia", address: "vpn.example.com", port: "51820",
            public_key: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=", allowed_ips: [ "0.0.0.0/0" ]
        } ]
    };
}

function changed(mutate) {
    let data = tunnels();
    mutate(data);
    return data;
}

t.test("WARP, AmneziaWG, Tailscale and JSON tunnels pass as the dialog writes them", () => {
    v.accepts(tunnels());
});

t.test("each broken tunnel field is refused by name", () => {
    v.refuses(changed((d) => delete d.tunnel_peer[0].allowed_ips), "without AllowedIPs");
    v.refuses(changed((d) => d.tunnel_peer[0].public_key = "invalid"), "invalid WireGuard peer public key");
    v.refuses(changed((d) => d.tunnel[1].amnezia_h1 = "200-100"), "invalid AmneziaWG h1 range");
    v.refuses(changed((d) => d.tunnel[1].amnezia_h1 = "4294967296"), "invalid AmneziaWG h1 range");
    v.refuses(changed((d) => {
        delete d.tunnel[0].warp_profile_id;
        delete d.tunnel[0].warp_profile_auth_token;
        delete d.tunnel[0].warp_profile_private_key;
    }), "incomplete WARP profile");
    v.refuses(changed((d) => delete d.tunnel[0].warp_profile_private_key), "incomplete WARP profile");
    v.refuses(changed((d) => delete d.tunnel[2].tailscale_auth_key), "incomplete Tailscale endpoint");
    v.accepts(changed((d) => d.tunnel[3].endpoint_json = "{\"tag\":\"custom-endpoint\"}"));
    v.refuses(changed((d) => d.tunnel[3].endpoint_json = "{\"type\":\"vpn-client\"}"), "JSON endpoint without a tag");
});

// The dialog refuses these before it saves; a configuration written through uci
// reaches the core with them, which reads a port or an MTU it cannot parse as
// none and an AmneziaWG tunnel without a parameter as plain WireGuard.
t.test("a tunnel is refused on the values the dialog refuses", () => {
    for (let value in [ "65536", "abc" ]) {
        v.refuses(changed((d) => d.tunnel[1].listen_port = value), "invalid WireGuard listen port");
        v.refuses(changed((d) => d.tunnel[1].mtu = value), "invalid WireGuard MTU");
    }
    v.refuses(changed((d) => d.tunnel[1].mtu = "0"), "invalid WireGuard MTU");
    v.accepts(changed((d) => { d.tunnel[1].listen_port = "0"; d.tunnel[1].mtu = "1280"; }));
    v.refuses(changed((d) => { delete d.tunnel[1].amnezia_jc; delete d.tunnel[1].amnezia_h1; }), "has no AmneziaWG parameter");
    v.refuses(changed((d) => d.tunnel[0].warp_address = "not a host"), "invalid WARP server address");
    v.accepts(changed((d) => d.tunnel[0].warp_address = "engage.cloudflareclient.com"));
    v.accepts(changed((d) => d.tunnel[0].warp_address = "2606:4700:d0::a29f:c001"));
    v.refuses(changed((d) => d.tunnel[0].warp_port = "70000"), "invalid WARP server port");
    v.refuses(changed((d) => d.tunnel[0].warp_keepalive = "25-5"), "invalid WARP persistent keepalive");
});

// A WARP tunnel waits for its profile before it carries anything, so a profile
// requested through the section that holds it would wait for itself.
t.test("WARP profiles go through a section of their own choosing, never the one holding the tunnel", () => {
    let through = (target) => changed((d) => {
        push(d.section, { ".name": "proxy", enabled: "1", action: "connection" });
        d.connection_link = fixture.links("proxy", [ "vless://u@a.example:443#A" ]);
        d.settings.warp_profiles_via_proxy = "1";
        if (target != null)
            d.settings.warp_profiles_via_proxy_section = target;
    });
    v.accepts(through("proxy"));
    v.refuses(through(null), "no download section is selected");
    v.refuses(through("tunnels"), "Section 'tunnels' holds WARP tunnel 'Generated WARP', so it cannot carry the requests for its profile");
});

t.done();
