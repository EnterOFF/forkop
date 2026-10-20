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

const OPENCONNECT = {
    type: "openconnect", server: "vpn.example.com:8443/staff", flavor: "anyconnect",
    username: "alice", password: "secret", external_auth_disabled: true,
    tls: { peer_fingerprint: [ "pin-sha256:svnty/laZqBAdkrdaiQxUb+x8kHPG7QJjSPRjA20WhU=" ] }
};

function openconnect_fixture(endpoint, tunnel) {
    return {
        settings: { dns_server: [ "1.1.1.1" ], bootstrap_dns_server: [ "1.1.1.1" ], service_listen_address: "127.0.0.1" },
        section: [
            { ".name": "vpn", enabled: "1", action: "connection", user_domains: "example.test" },
            { ".name": "proxy", enabled: "1", action: "connection", user_domains: "proxy.test" }
        ],
        connection_link: fixture.links("proxy", [ "vless://u@a.example:443#A" ]),
        tunnel: [ { ".name": "work", section: "vpn", kind: "openconnect", name: "Work",
            endpoint_json: sprintf("%J", endpoint ?? OPENCONNECT), ...(tunnel ?? {}) } ]
    };
}

t.test("an OpenConnect tunnel reaches the core as written and keeps reconnecting", () => {
    fixture.seed(openconnect_fixture());
    let config = generator.build({ service_address: "127.0.0.1" });
    let endpoint = filter(config.endpoints, (item) => item.type == "openconnect")[0];
    t.eq(endpoint, { ...OPENCONNECT, tag: "vpn/Work", reconnect_timeout: "876000h" });
    t.contains(q.outbound(config, "vpn").outbounds, "vpn/Work");

    fixture.seed(openconnect_fixture({ ...OPENCONNECT, reconnect_timeout: "10m" }));
    config = generator.build({ service_address: "127.0.0.1" });
    t.eq(filter(config.endpoints, (item) => item.type == "openconnect")[0].reconnect_timeout, "10m",
        "a timeout the endpoint names is its own");
});

t.test("an OpenConnect tunnel reaches its server through the section it cascades through", () => {
    fixture.seed(openconnect_fixture(null, { detour_section: "proxy" }));
    let config = generator.build({ service_address: "127.0.0.1" });
    t.eq(filter(config.endpoints, (item) => item.type == "openconnect")[0].detour, "proxy");
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

t.test("a client of an OpenVPN server takes its own route by the name on its certificate", () => {
    let data = openvpn_server({ routing_mode: "direct" }, [
        { ".name": "laptop", server: "office", name: "Laptop", openvpn_certificate: "C", openvpn_key: "K",
            openvpn_certificate_sha256: "aa", routing_override: "1", routing_mode: "section", routing_section: "exit" },
        { ".name": "phone", server: "office", name: "Phone", openvpn_certificate: "C", openvpn_key: "K",
            openvpn_certificate_sha256: "bb", routing_override: "1", routing_mode: "rules" }
    ]);
    push(data.section, { ".name": "exit", enabled: "1", action: "connection", outbound_jsons: [ "{\"type\":\"direct\"}" ],
        destinations: "exit.example" });
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

const SERVER_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

function wireguard_server(server, clients) {
    let data = openvpn_server();
    data.server = [ {
        ".name": "home", enabled: "1", label: "Home", protocol: "wireguard", listen_port: "51820",
        tunnel_address: [ "10.8.0.1/24", "fd00:8::1/64" ], routing_mode: "rules",
        wireguard_private_key: SERVER_KEY, wireguard_public_key: "server-public", ...(server ?? {})
    } ];
    data.server_client = clients ?? [
        { ".name": "phone", server: "home", name: "Phone", wireguard_private_key: "phone-private",
            wireguard_public_key: "phone-public", wireguard_pre_shared_key: "phone-psk",
            wireguard_address: [ "10.8.0.2/32", "fd00:8::2/128" ] },
        { ".name": "laptop", server: "home", name: "Laptop", wireguard_private_key: "laptop-private",
            wireguard_public_key: "laptop-public", wireguard_pre_shared_key: "laptop-psk",
            wireguard_address: [ "10.8.0.3/32", "fd00:8::3/128" ] }
    ];
    return data;
}

t.test("a WireGuard server knows each client by its key and the addresses it may send from", () => {
    fixture.seed(wireguard_server());
    let config = generator.build({ service_address: "127.0.0.1" });
    t.eq(q.endpoint(config, "Home"), {
        type: "wireguard", tag: "Home", address: [ "10.8.0.1/24", "fd00:8::1/64" ], private_key: SERVER_KEY,
        listen_port: 51820, inet4_bind_address: "0.0.0.0", inet6_bind_address: "::",
        peers: [
            { public_key: "phone-public", pre_shared_key: "phone-psk", allowed_ips: [ "10.8.0.2/32", "fd00:8::2/128" ] },
            { public_key: "laptop-public", pre_shared_key: "laptop-psk", allowed_ips: [ "10.8.0.3/32", "fd00:8::3/128" ] }
        ]
    });
    t.ok(q.route_rule(config, (rule) => rule.action == "sniff" && rule.inbound == "Home") != null,
        "its DNS on the server's address is sniffed and hijacked like the router's");
});

t.test("an AmneziaWG server runs with every parameter but the signature packets", () => {
    fixture.seed(wireguard_server({ protocol: "amneziawg", amnezia_jc: "5", amnezia_jmin: "10", amnezia_jmax: "50",
        amnezia_i1: "<r 2>", amnezia_s1: "12", amnezia_h1: "1", amnezia_header_protection_key: SERVER_KEY,
        amnezia_random_trailers: "1", amnezia_rekey_after_time: "100-120" }));
    let endpoint = q.endpoint(generator.build({ service_address: "127.0.0.1" }), "Home");
    t.eq(endpoint.type, "amneziawg");
    t.eq(endpoint.amnezia, { jc: 5, jmin: 10, jmax: 50, s1: 12, h1: 1, header_protection_key: SERVER_KEY,
        random_trailers: true, rekey_after_time: "100-120" });
});

t.test("a client of a WireGuard server takes its own route by its tunnel addresses", () => {
    let data = wireguard_server({ routing_mode: "direct" });
    data.server_client[0].routing_override = "1";
    data.server_client[0].routing_mode = "section";
    data.server_client[0].routing_section = "exit";
    data.server_client[1].routing_override = "1";
    data.server_client[1].routing_mode = "rules";
    push(data.section, { ".name": "exit", enabled: "1", action: "connection", outbound_jsons: [ "{\"type\":\"direct\"}" ],
        destinations: "exit.example" });
    fixture.seed(data);
    let config = generator.build({ service_address: "127.0.0.1" });
    let identity = (rule) => rule.type == "logical" ? rule.rules[0] : rule;
    let phone = q.route_rule(config, (rule) => rule.inbound == "Home" && rule.outbound == "exit" && rule.auth_user == null);
    t.eq(phone?.source_ip_cidr, [ "10.8.0.2/32", "fd00:8::2/128" ]);
    t.ok(q.route_rule(config, (rule) => identity(rule).inbound == "Home" &&
        join(",", identity(rule).source_ip_cidr ?? []) == "10.8.0.3/32,fd00:8::3/128" && rule.outbound == "exit") != null,
        "a client that follows the rules gets the rules under its addresses");
});

t.done();
