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
            openvpn_network: "udp", tunnel_address: [ "10.8.0.1/24" ], routing_mode: "rules",
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
    fixture.seed(openvpn_server({ tunnel_address: [ "10.8.0.1/24", "fd00:8::1/64" ] }));
    let push = q.endpoint(generator.build({ service_address: "127.0.0.1" }), "Office").push;
    t.eq(push.dns, [ "10.8.0.1", "fd00:8::1" ]);
    t.eq(push.redirect_gateway_flags, [ "def1", "ipv6" ]);

    fixture.seed(openvpn_server({ tunnel_all_traffic: "0", tunnel_routes: [ "192.168.1.0/24" ] }));
    push = q.endpoint(generator.build({ service_address: "127.0.0.1" }), "Office").push;
    t.eq(push, { dns: [ "10.8.0.1" ], ping_interval: "10s", ping_restart: "120s", routes: [ "192.168.1.0/24" ] });
});

// The core knows an OpenVPN client by the common name of the certificate issued
// to it, its section, so the rule of a client names the section, not the name it
// is shown under.
t.test("a client of an OpenVPN server takes its own route by the name on its certificate", () => {
    let data = openvpn_server({ routing_mode: "direct" }, [
        { ".name": "laptop", server: "office", name: "Laptop", openvpn_certificate: "C", openvpn_key: "K",
            openvpn_certificate_sha256: "aa", routing_override: "1", routing_mode: "section", routing_section: "exit" },
        { ".name": "phone", server: "office", name: "Phone", openvpn_certificate: "C", openvpn_key: "K",
            openvpn_certificate_sha256: "bb", routing_override: "1", routing_mode: "rules" }
    ]);
    push(data.section, { ".name": "exit", enabled: "1", action: "connection", outbound_jsons: [ "{\"type\":\"direct\"}" ],
        domain_suffix: [ "exit.example" ] });
    fixture.seed(data);
    let config = generator.build({ service_address: "127.0.0.1" });
    let identity = (rule) => rule.type == "logical" ? rule.rules[0] : rule;
    let laptop_at = q.route_rule_index(config, (rule) => rule.inbound == "Office" && rule.auth_user == "laptop");
    let server_at = q.route_rule_index(config, (rule) => rule.inbound == "Office" && rule.auth_user == null && rule.outbound == "direct-out");
    t.ok(laptop_at >= 0 && server_at > laptop_at, "the client's rule comes before the rule of its server");
    t.eq(config.route.rules[laptop_at].outbound, "exit");
    t.ok(q.route_rule(config, (rule) => identity(rule).inbound == "Office" && identity(rule).auth_user == "phone" &&
        rule.outbound == "exit") != null, "a client that follows the rules gets the rules under its section");
    t.eq(filter(config.route.rules, (rule) => identity(rule).auth_user == "Laptop" || identity(rule).auth_user == "Phone"), []);
});

t.done();
