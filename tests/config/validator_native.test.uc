let t = require("t");
let v = require("validation");

function openvpn(settings, endpoint) {
    endpoint ??= {
        type: "openvpn-client", mode: "static_key", server: "127.0.0.1", server_port: 1194,
        network: "udp", address: [ "10.44.0.2/30" ], peer_address: "10.44.0.1",
        cipher: "AES-256-CBC", auth: "SHA256",
        static_key: [ "-----BEGIN OpenVPN Static key V1-----", "0123456789abcdef0123456789abcdef", "-----END OpenVPN Static key V1-----" ],
        ping_interval: "10s", ping_restart: "60s"
    };
    return {
        settings: { dns_timeout: "4s", dns_optimistic: "1", dns_optimistic_timeout: "2h", service_listen_address: "127.0.0.1", ...(settings ?? {}) },
        section: [ { ".name": "vpn", enabled: "1", action: "connection", user_domains: "example.test" } ],
        tunnel: [ { ".name": "openvpn", section: "vpn", kind: "openvpn-client", name: "OpenVPN", endpoint_json: sprintf("%J", endpoint) } ]
    };
}

t.test("a 1.14 OpenVPN endpoint and optimistic DNS pass", () => {
    v.accepts(openvpn());
});

t.test("an OpenVPN tunnel over TLS names how the server is checked and pairs its certificate and key", () => {
    let tls_endpoint = (tls, extra) => ({
        type: "openvpn-client", network: "udp", server: "vpn.example.com", server_port: 1194, tls, ...(extra ?? {})
    });
    v.accepts(openvpn(null, tls_endpoint({ certificate: [ "CA" ] })));
    v.accepts(openvpn(null, tls_endpoint({ peer_fingerprint: [ "ab" ] })));
    v.accepts(openvpn(null, tls_endpoint({ certificate_path: "/etc/openvpn/ca.crt", client_certificate: [ "C" ], client_key_path: "/etc/k" })));
    v.refuses(openvpn(null, tls_endpoint({})), "has no CA certificate to check the OpenVPN server by");
    v.refuses(openvpn(null, tls_endpoint({ certificate: [ "CA" ], client_certificate: [ "C" ] })),
        "needs both the OpenVPN client certificate and its key, or neither");
    v.refuses(openvpn(null, { type: "openvpn-client", network: "udp", tls: { certificate: [ "CA" ] },
        servers: [ { server: "a.example.com", server_port: 1194 }, { server: "b.example.com" } ] }),
        "has an OpenVPN server without an address or a valid port");
});

t.test("the native API needs its secret", () => {
    v.accepts(openvpn({ enable_native_api: "1", native_api_secret: "test-secret" }));
    v.refuses(openvpn({ enable_native_api: "1" }), "'API secret' in Settings is empty");
});

t.done();
