// The Servers tab writes a sing-box inbound directly, so the rule is symmetric: what
// the core refuses, the runtime check refuses by name, and what the core accepts the
// runtime check must not refuse. Every verdict below was measured against
// `sing-box check` and a real start on a listener carrying exactly that value; with
// FORKOP_SING_BOX_BIN set the accepted cases are measured again.

let t = require("t");
let v = require("validation");
let stub = require("stub");
let fixture = require("fixture");
let generator = require("singbox.generator");
let fs = require("fs");

let core = stub.real.getenv("FORKOP_SING_BOX_BIN");
let dir = stub.tmpdir();
let cert = dir + "/server.crt";
let key = dir + "/server.key";

if (core) {
    stub.real.system(sprintf("'%s' generate tls-keypair boundaries.example --months 1 >'%s/pair.pem' 2>/dev/null", core, dir));
    stub.real.system(sprintf("awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/' '%s/pair.pem' >'%s'", dir, cert));
    stub.real.system(sprintf("awk '/BEGIN PRIVATE KEY/,/END PRIVATE KEY/' '%s/pair.pem' >'%s'", dir, key));
}
for (let pair in [ [ cert, "CERTIFICATE" ], [ key, "PRIVATE KEY" ] ])
    if (!fs.stat(pair[0])?.size)
        fs.writefile(pair[0], sprintf("-----BEGIN %s-----\ncGxhY2Vob2xkZXI=\n-----END %s-----\n", pair[1], pair[1]));

function client(name, extra) {
    return { ".name": name, server: "srv", name: "phone", ...(extra ?? {}) };
}

function server(extra) {
    return { ".name": "srv", enabled: "1", label: "srv", listen: "0.0.0.0", listen_port: "20001", public_host: "203.0.113.9", ...extra };
}

const tls = { tls_self_signed_certificate: fs.readfile(cert), tls_self_signed_key: fs.readfile(key) };
const mine = { tls_certificate: cert, tls_key: key };
const own = (extra) => ({ protocol: "trojan", security: "tls", tls_certificate_source: "custom", ...extra });
const encrypted_key = "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIE\n-----END ENCRYPTED PRIVATE KEY-----";
const reality = {
    security: "reality",
    tls_server_name: "example.com",
    reality_private_key: "kP1C4vzQnlzyKRo3DORq6f_v3n9u7nGY8dl0AKbx11A",
    reality_public_key: "kP1C4vzQnlzyKRo3DORq6f_v3n9u7nGY8dl0AKbx11A",
    reality_short_id: "4aee2254"
};
const uuid = "11111111-1111-4111-8111-111111111111";
function without(object, name) {
    let result = { ...object };
    delete result[name];
    return result;
}

function static_key() {
    let lines = [ "-----BEGIN OpenVPN Static key V1-----" ];
    for (let i = 0; i < 16; i++)
        push(lines, "0123456789abcdef0123456789abcdef");
    push(lines, "-----END OpenVPN Static key V1-----");
    return join("\n", lines);
}

// What prepare leaves on an OpenVPN server and its clients: the certificate and
// key sing-box issued, a tls-crypt key and the fingerprint of the client.
const openvpn = {
    protocol: "openvpn", listen: "::", openvpn_network: "udp", openvpn_address: [ "10.8.0.1/24" ],
    openvpn_certificate: fs.readfile(cert), openvpn_key: fs.readfile(key),
    openvpn_tls_crypt_key: static_key()
};
const openvpn_client = { openvpn_certificate: fs.readfile(cert), openvpn_key: fs.readfile(key), openvpn_certificate_sha256: "abababababababababababababababababababababababababababababababab" };
const key32 = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

// [ name, refusal fragment or null when the core accepts, server, clients ]
const cases = [
    [ "listen address", "which is not an IP address", server({ protocol: "vless", ...reality, listen: "nonsense" }), [ client("v", { uuid }) ] ],
    [ "listen wildcard v6", null, server({ protocol: "vless", ...reality, listen: "::" }), [ client("v", { uuid }) ] ],

    [ "transport name", "unsupported transport", server({ protocol: "vless", ...reality, transport: "quic" }), [ client("v", { uuid }) ] ],
    [ "transport raw", null, server({ protocol: "vless", ...reality, transport: "raw" }), [ client("v", { uuid }) ] ],
    [ "xhttp mode", "unsupported transport_xhttp_mode",
        server({ protocol: "vless", ...reality, transport: "xhttp", transport_xhttp_mode: "burst" }), [ client("v", { uuid }) ] ],

    [ "shadowsocks method", "unsupported shadowsocks_method",
        server({ protocol: "shadowsocks", shadowsocks_method: "rc4-md5" }), [ client("s", { password: "x" }) ] ],
    [ "shadowsocks legacy method", null,
        server({ protocol: "shadowsocks", shadowsocks_method: "aes-256-gcm" }), [ client("s", { password: "anything" }) ] ],
    [ "shadowsocks listener key length", "server pre-shared key",
        server({ protocol: "shadowsocks", shadowsocks_method: "2022-blake3-aes-256-gcm", shadowsocks_psk: "YWJj" }), [ client("s", { password: key32 }) ] ],
    [ "shadowsocks account key length", "pre-shared key",
        server({ protocol: "shadowsocks", shadowsocks_method: "2022-blake3-aes-256-gcm", shadowsocks_psk: key32 }), [ client("s", { password: "YWJjZA==" }) ] ],

    [ "mieru transport", "unsupported mieru_transport", server({ protocol: "mieru", mieru_transport: "tcp" }), [ client("m", { password: "p" }) ] ],
    [ "mieru transport missing", "unsupported mieru_transport", server({ protocol: "mieru" }), [ client("m", { password: "p" }) ] ],

    [ "naive network", "unsupported naive_network", server({ protocol: "naive", ...mine, naive_network: "quic" }), [ client("n", { password: "p" }) ] ],
    [ "naive network pair", null, server({ protocol: "naive", ...mine, naive_network: "tcp_udp" }), [ client("n", { password: "p" }) ] ],

    [ "tuic congestion", "unsupported tuic_congestion_control",
        server({ protocol: "tuic", ...tls, tuic_congestion_control: "brutal" }), [ client("t", { uuid, password: "p" }) ] ],

    [ "hysteria2 obfs type", "unsupported hysteria2_obfs_type",
        server({ protocol: "hysteria2", ...tls, hysteria2_obfs_type: "scramble", hysteria2_obfs_password: "p" }), [ client("h", { password: "p" }) ] ],
    [ "hysteria2 masquerade scheme", "must start with https://",
        server({ protocol: "hysteria2", ...tls, hysteria2_masquerade: "ftp://example.com" }), [ client("h", { password: "p" }) ] ],
    [ "hysteria2 masquerade file", null, server({ protocol: "hysteria2", ...tls, hysteria2_masquerade: "file:///tmp" }), [ client("h", { password: "p" }) ] ],
    [ "hysteria2 bandwidth", "whole number of megabits", server({ protocol: "hysteria2", ...tls, hysteria2_up_mbps: "fast" }), [ client("h", { password: "p" }) ] ],
    [ "hysteria2 gecko", null,
        server({
            protocol: "hysteria2", ...tls, hysteria2_obfs_type: "gecko", hysteria2_obfs_password: "secret",
            hysteria2_bbr_profile: "conservative"
        }), [ client("h", { password: "p" }) ] ],

    [ "reality short id odd", "even number of hex digits", server({ protocol: "vless", ...reality, reality_short_id: "abc" }), [ client("v", { uuid }) ] ],
    [ "reality short id long", "longer than 16 hex digits",
        server({ protocol: "vless", ...reality, reality_short_id: "0123456789abcdef01" }), [ client("v", { uuid }) ] ],
    [ "reality short id 8 bytes", null, server({ protocol: "vless", ...reality, reality_short_id: "0123456789abcdef" }), [ client("v", { uuid }) ] ],
    [ "reality private key", "invalid reality_private_key", server({ protocol: "vless", ...reality, reality_private_key: "short" }), [ client("v", { uuid }) ] ],

    [ "a self-signed certificate not issued yet", "has no self-signed certificate yet",
        server({ protocol: "hysteria2" }), [ client("h", { password: "p" }) ] ],
    [ "an own certificate by path", null, server(own({ tls_certificate: cert, tls_key: key })), [ client("t", { password: "p" }) ] ],
    [ "an own certificate pasted", null,
        server(own({ tls_certificate: fs.readfile(cert), tls_key: fs.readfile(key) })), [ client("t", { password: "p" }) ] ],
    [ "an own certificate file that is not there", "certificate file '/tmp/forkop-absent.crt' does not exist",
        server(own({ tls_certificate: "/tmp/forkop-absent.crt", tls_key: key })), [ client("t", { password: "p" }) ] ],
    [ "an own certificate that is not one", "not a PEM certificate",
        server(own({ tls_certificate: "hello", tls_key: key })), [ client("t", { password: "p" }) ] ],
    [ "an own key behind a passphrase", "not one unencrypted PEM private key",
        server(own({ tls_certificate: cert, tls_key: encrypted_key })), [ client("t", { password: "p" }) ] ],
    [ "an own certificate without its key", "needs the private key", server(own({ tls_certificate: cert })), [ client("t", { password: "p" }) ] ],
    [ "an own certificate and key in one file", "same file", server(own({ tls_certificate: cert, tls_key: cert })), [ client("t", { password: "p" }) ] ],
    [ "a NaiveProxy server without a certificate", "a browser trusts", server({ protocol: "naive", ...tls }), [ client("n", { password: "p" }) ] ],


    [ "openvpn", null, server(openvpn), [ client("o", openvpn_client) ] ],
    [ "openvpn over tcp with an ipv6 subnet", null,
        server({ ...openvpn, openvpn_network: "tcp", openvpn_address: [ "10.8.0.1/24", "fd00:8::1/64" ] }), [ client("o", openvpn_client) ] ],
    [ "openvpn routes", null,
        server({ ...openvpn, openvpn_redirect_gateway: "0", openvpn_routes: [ "192.168.1.0/24", "fd00::/8" ] }), [ client("o", openvpn_client) ] ],
    [ "openvpn network", "unsupported openvpn_network", server({ ...openvpn, openvpn_network: "sctp" }), [ client("o", openvpn_client) ] ],
    [ "openvpn without a subnet", "needs an IPv4 tunnel subnet", server(without(openvpn, "openvpn_address")), [ client("o", openvpn_client) ] ],
    [ "openvpn ipv6 only", "needs an IPv4 tunnel subnet", server({ ...openvpn, openvpn_address: [ "fd00:8::1/64" ] }), [ client("o", openvpn_client) ] ],
    [ "openvpn subnet address", "has to name the address of the server",
        server({ ...openvpn, openvpn_address: [ "10.8.0.0/24" ] }), [ client("o", openvpn_client) ] ],
    [ "openvpn subnet broadcast", "has to name the address of the server",
        server({ ...openvpn, openvpn_address: [ "10.8.0.255/24" ] }), [ client("o", openvpn_client) ] ],
    [ "openvpn ipv6 subnet address", "has to name the address of the server",
        server({ ...openvpn, openvpn_address: [ "10.8.0.1/24", "fd00:8::/64" ] }), [ client("o", openvpn_client) ] ],
    [ "openvpn subnet prefix", "needs a prefix length from 8 to 30",
        server({ ...openvpn, openvpn_address: [ "10.8.0.1/31" ] }), [ client("o", openvpn_client) ] ],
    [ "openvpn two ipv4 subnets", "more than one IPv4 tunnel subnet",
        server({ ...openvpn, openvpn_address: [ "10.8.0.1/24", "10.9.0.1/24" ] }), [ client("o", openvpn_client) ] ],
    [ "openvpn subnet text", "not an address with a prefix length",
        server({ ...openvpn, openvpn_address: [ "10.8.0.1" ] }), [ client("o", openvpn_client) ] ],
    [ "openvpn route", "which is not a subnet",
        server({ ...openvpn, openvpn_redirect_gateway: "0", openvpn_routes: [ "lan" ] }), [ client("o", openvpn_client) ] ],
    [ "openvpn client without a certificate", "has no openvpn_certificate",
        server(openvpn), [ client("o", without(openvpn_client, "openvpn_certificate")) ] ],
    [ "openvpn server without a key", "has no openvpn_tls_crypt_key",
        server(without(openvpn, "openvpn_tls_crypt_key")), [ client("o", openvpn_client) ] ]
];

function configuration(srv, clients) {
    return {
        settings: { service_listen_address: "127.0.0.1" },
        section: [ {
            ".name": "proxy", label: "proxy", enabled: "1", action: "connection",
            connection_url: "socks5://127.0.0.1:1080", user_domains: "example.com"
        } ],
        server: [ srv ],
        server_client: clients
    };
}

function core_check(name, data) {
    fixture.seed(v.with_dns(data));
    let path = dir + "/config.json";
    fs.writefile(path, sprintf("%J\n", generator.build({ service_address: "127.0.0.1", mwan3_active: false })));
    let status = stub.real.system(sprintf("'%s' check -c '%s' >'%s/check.log' 2>&1", core, path, dir));
    if (status != 0)
        t.fail(name + ": recorded as accepted, but the core refuses it: " + trim(fs.readfile(dir + "/check.log") ?? ""));
}

for (let entry in cases) {
    let name = entry[0], refusal = entry[1], srv = entry[2], clients = entry[3];
    t.test(name + (refusal ? " is refused" : " passes"), () => {
        let data = configuration(srv, clients);
        if (refusal)
            v.refuses(data, refusal);
        else {
            v.accepts(data);
            if (core)
                core_check(name, data);
        }
    });
}

t.done();
