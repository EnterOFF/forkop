let t = require("t");
let fixture = require("fixture");
let q = require("sbconfig");
let generator = require("singbox.generator");

const OPENVPN = {
    type: "openvpn-client", mode: "static_key", server: "127.0.0.1", server_port: 1194,
    network: "udp", address: [ "10.44.0.2/30" ], peer_address: "10.44.0.1",
    cipher: "AES-256-CBC", auth: "SHA256",
    static_key: [ "-----BEGIN OpenVPN Static key V1-----", "0123456789abcdef0123456789abcdef", "-----END OpenVPN Static key V1-----" ],
    ping_interval: "10s", ping_restart: "60s"
};

function openvpn_fixture(settings) {
    return {
        settings: { dns_server: [ "1.1.1.1" ], bootstrap_dns_server: [ "1.1.1.1" ], service_listen_address: "127.0.0.1", ...(settings ?? {}) },
        section: [ { ".name": "vpn", enabled: "1", action: "connection", user_domains: "example.test" } ],
        tunnel: [ { ".name": "openvpn", section: "vpn", kind: "openvpn-client", name: "OpenVPN", endpoint_json: sprintf("%J", OPENVPN) } ]
    };
}

t.test("an OpenVPN tunnel reaches the core as the endpoint it was written as", () => {
    fixture.seed(openvpn_fixture());
    let config = generator.build({ service_address: "127.0.0.1" });
    t.eq(config.endpoints[0], { ...OPENVPN, tag: "vpn/OpenVPN" });
    t.contains(q.outbound(config, "vpn").outbounds, "vpn/OpenVPN");
});

t.test("the native API service is generated with its secret and dashboard", () => {
    fixture.seed(openvpn_fixture({ enable_native_api: "1", native_api_secret: "test-secret" }));
    let config = generator.build({ service_address: "127.0.0.1" });
    t.eq(config.services, [ {
        type: "api", tag: "forkop-api", listen: "127.0.0.1", listen_port: 9091, secret: "test-secret",
        dashboard: { enabled: true, path: "/tmp/sing-box/dashboard", http_client: { detour: "direct-out" } }
    } ]);
});

t.done();
