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

    fixture.seed(openvpn_fixture({ enable_native_api: "1", native_api_secret: "test-secret",
        download_components_via_proxy: "1", download_lists_via_proxy_section: "vpn" }));
    config = generator.build({ service_address: "127.0.0.1" });
    t.eq(config.services[0].dashboard.http_client, { detour: "vpn" },
        "the dashboard is a component and takes the lists section when components name none");
});

function openvpn_server(server, clients) {
    return {
        settings: { dns_server: [ "1.1.1.1" ], bootstrap_dns_server: [ "1.1.1.1" ], service_listen_address: "127.0.0.1" },
        section: [ { ".name": "vpn", enabled: "1", action: "connection", user_domains: "example.test",
            connection_url: "socks5://127.0.0.1:1080" } ],
        server: [ {
            ".name": "office", enabled: "1", label: "Office", protocol: "openvpn", listen: "::", listen_port: "1194",
            openvpn_network: "udp", openvpn_address: [ "10.8.0.1/24" ], routing_mode: "rules",
            openvpn_certificate: "-----BEGIN CERTIFICATE-----\nSERVER\n-----END CERTIFICATE-----\n",
            openvpn_key: "-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----",
            openvpn_tls_crypt_key: "-----BEGIN OpenVPN Static key V1-----\n00ff\n-----END OpenVPN Static key V1-----",
            ...(server ?? {})
        } ],
        server_client: clients ?? [
            { ".name": "laptop", server: "office", name: "Laptop", openvpn_certificate: "C", openvpn_key: "K",
                openvpn_certificate_sha256: "aa" },
            { ".name": "phone", server: "office", name: "Phone", openvpn_certificate: "C", openvpn_key: "K",
                openvpn_certificate_sha256: "bb" }
        ]
    };
}

t.test("an OpenVPN server trusts the certificates of its clients and hands them the router's DNS and route", () => {
    fixture.seed(openvpn_server());
    let endpoint = q.endpoint(generator.build({ service_address: "127.0.0.1" }), "Office");
    t.eq(endpoint, {
        type: "openvpn-server", tag: "Office", listen: "::", listen_port: 1194, network: "udp", address: [ "10.8.0.1/24" ],
        tls: {
            certificate: [ "-----BEGIN CERTIFICATE-----", "SERVER", "-----END CERTIFICATE-----" ],
            key: [ "-----BEGIN PRIVATE KEY-----", "KEY", "-----END PRIVATE KEY-----" ],
            peer_fingerprint: [ "aa", "bb" ],
            remote_certificate_tls: "none",
            control_wrap: { type: "tls_crypt", key: [ "-----BEGIN OpenVPN Static key V1-----", "00ff", "-----END OpenVPN Static key V1-----" ] }
        },
        push: { dns: [ "10.8.0.1" ], ping_interval: "10s", ping_restart: "120s", redirect_gateway: true,
            redirect_gateway_flags: [ "def1" ], block_outside_dns: true },
        ping_interval: "10s", ping_restart: "240s"
    });
});

t.test("an OpenVPN server with an IPv6 subnet routes IPv6 too, and one told otherwise pushes only its routes", () => {
    fixture.seed(openvpn_server({ openvpn_address: [ "10.8.0.1/24", "fd00:8::1/64" ] }));
    let push = q.endpoint(generator.build({ service_address: "127.0.0.1" }), "Office").push;
    t.eq(push.dns, [ "10.8.0.1", "fd00:8::1" ]);
    t.eq(push.redirect_gateway_flags, [ "def1", "ipv6" ]);

    fixture.seed(openvpn_server({ openvpn_redirect_gateway: "0", openvpn_routes: [ "192.168.1.0/24" ] }));
    push = q.endpoint(generator.build({ service_address: "127.0.0.1" }), "Office").push;
    t.eq(push, { dns: [ "10.8.0.1" ], ping_interval: "10s", ping_restart: "120s", routes: [ "192.168.1.0/24" ] });
});

// The core reports no user for an OpenVPN client, so a rule on one would match
// nothing and its traffic would take the route of the server anyway.
t.test("the clients of an OpenVPN server take the route of their server", () => {
    fixture.seed(openvpn_server({ routing_mode: "direct" }, [
        { ".name": "laptop", server: "office", name: "Laptop", openvpn_certificate: "C", openvpn_key: "K",
            openvpn_certificate_sha256: "aa", routing_override: "1", routing_mode: "direct" }
    ]));
    let config = generator.build({ service_address: "127.0.0.1" });
    t.eq(filter(config.route.rules, (rule) => rule.auth_user != null), []);
    t.ok(q.find(config.route.rules, (rule) => rule.inbound == "Office" && rule.outbound == "direct-out") != null);
});

t.done();
