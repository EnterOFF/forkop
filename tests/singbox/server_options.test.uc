// The Servers tab writes a sing-box inbound directly, so a key the core does
// not have is a start-up failure. The generator runs over one server per
// protocol, filled in the way the dialog fills it, and every key it emits is
// looked up in tests/fixtures/singbox_inbound_options.json, a snapshot of the
// core's inbound option structs; tests/fixtures/singbox_inbound_options.js
// rebuilds it from a core checkout.

let t = require("t");
let fs = require("fs");
let repo = require("repo");
let fixture = require("fixture");
let generator = require("singbox.generator");

let schema = json(fs.readfile(repo.path("tests/fixtures/singbox_inbound_options.json")));

const SERVERS = {
    settings: { dns_server: "77.88.8.8", bootstrap_dns_server: "77.88.8.8", service_listen_address: "127.0.0.1" },
    section: [
        {
            ".name": "proxy", ".type": "section", label: "proxy", enabled: "1", action: "connection",
            connection_url: "socks5://127.0.0.1:1080", user_domains: "example.com"
        }
    ],
    server: [
        {
            ".name": "mixed_srv", ".type": "server", enabled: "1", label: "mixed", protocol: "mixed",
            listen: "0.0.0.0", listen_port: "20001", mixed_auth_enabled: "1", tcp_fast_open: "1",
            routing_mode: "direct"
        },
        {
            ".name": "vless_srv", ".type": "server", enabled: "1", label: "vless", protocol: "vless",
            listen: "0.0.0.0", listen_port: "20002", security: "reality", tls_server_name: "www.microsoft.com",
            reality_private_key: "kP1C4vzQnlzyKRo3DORq6f_v3n9u7nGY8dl0AKbx11A",
            reality_public_key: "kP1C4vzQnlzyKRo3DORq6f_v3n9u7nGY8dl0AKbx11A", reality_short_id: "4aee2254",
            transport: "tcp", multiplex_enabled: "1", multiplex_padding: "1", routing_mode: "direct"
        },
        {
            ".name": "vmess_srv", ".type": "server", enabled: "1", label: "vmess", protocol: "vmess",
            listen: "0.0.0.0", listen_port: "20003", security: "tls", tls_server_name: "example.com",
            tls_alpn: [ "h2", "http/1.1" ], tls_certificate_path: "/etc/forkop/server-certs/vmess.crt",
            tls_key_path: "/etc/forkop/server-certs/vmess.key", transport: "ws", transport_path: "/ws",
            transport_host: "example.com", routing_mode: "direct"
        },
        {
            ".name": "trojan_srv", ".type": "server", enabled: "1", label: "trojan", protocol: "trojan",
            listen: "0.0.0.0", listen_port: "20004", security: "tls",
            tls_certificate_path: "/etc/forkop/server-certs/trojan.crt",
            tls_key_path: "/etc/forkop/server-certs/trojan.key", transport: "xhttp", transport_path: "/x",
            transport_xhttp_mode: "auto", routing_mode: "direct"
        },
        {
            ".name": "trojan_grpc", ".type": "server", enabled: "1", label: "trojan grpc", protocol: "trojan",
            listen: "0.0.0.0", listen_port: "20014", security: "tls",
            tls_certificate_path: "/etc/forkop/server-certs/grpc.crt",
            tls_key_path: "/etc/forkop/server-certs/grpc.key", transport: "grpc",
            transport_service_name: "grpc", routing_mode: "direct"
        },
        {
            ".name": "vless_http", ".type": "server", enabled: "1", label: "vless http", protocol: "vless",
            listen: "0.0.0.0", listen_port: "20015", security: "none", transport: "http", transport_path: "/h",
            transport_hosts: [ "a.example.com", "b.example.com" ], routing_mode: "direct"
        },
        {
            ".name": "vmess_upgrade", ".type": "server", enabled: "1", label: "vmess upgrade",
            protocol: "vmess", listen: "0.0.0.0", listen_port: "20016", security: "none",
            transport: "httpupgrade", transport_path: "/u", transport_host: "example.com",
            routing_mode: "direct"
        },
        {
            ".name": "ss_srv", ".type": "server", enabled: "1", label: "shadowsocks", protocol: "shadowsocks",
            listen: "0.0.0.0", listen_port: "20005", shadowsocks_method: "2022-blake3-aes-256-gcm",
            shadowsocks_psk: "ZGVmYXVsdC1rZXktZm9yLXRlc3RzLTMyLWJ5dGVzIQ==", multiplex_enabled: "1",
            routing_mode: "direct"
        },
        {
            ".name": "hy2_srv", ".type": "server", enabled: "1", label: "hysteria2", protocol: "hysteria2",
            listen: "0.0.0.0", listen_port: "20006", security: "tls",
            tls_certificate_path: "/etc/forkop/server-certs/hy2.crt",
            tls_key_path: "/etc/forkop/server-certs/hy2.key", hysteria2_up_mbps: "100",
            hysteria2_down_mbps: "200", hysteria2_obfs_type: "salamander",
            hysteria2_obfs_password: "obfs-password", hysteria2_ignore_client_bandwidth: "1",
            hysteria2_masquerade: "https://example.com", routing_mode: "direct"
        },
        {
            ".name": "tuic_srv", ".type": "server", enabled: "1", label: "tuic", protocol: "tuic",
            listen: "0.0.0.0", listen_port: "20007", security: "tls",
            tls_certificate_path: "/etc/forkop/server-certs/tuic.crt",
            tls_key_path: "/etc/forkop/server-certs/tuic.key", tuic_congestion_control: "bbr",
            tuic_heartbeat: "12s", tuic_zero_rtt_handshake: "1", routing_mode: "direct"
        },
        {
            ".name": "anytls_srv", ".type": "server", enabled: "1", label: "anytls", protocol: "anytls",
            listen: "0.0.0.0", listen_port: "20008", security: "tls",
            tls_certificate_path: "/etc/forkop/server-certs/anytls.crt",
            tls_key_path: "/etc/forkop/server-certs/anytls.key", routing_mode: "direct"
        },
        {
            ".name": "naive_srv", ".type": "server", enabled: "1", label: "naive", protocol: "naive",
            listen: "0.0.0.0", listen_port: "20009", security: "tls",
            tls_certificate_path: "/etc/forkop/server-certs/naive.crt",
            tls_key_path: "/etc/forkop/server-certs/naive.key", naive_network: "tcp_udp",
            routing_mode: "direct"
        },
        {
            ".name": "ssh_srv", ".type": "server", enabled: "1", label: "ssh", protocol: "ssh",
            listen: "0.0.0.0", listen_port: "20010", ssh_host_key_path: "/etc/forkop/server-ssh/ssh.key",
            routing_mode: "direct"
        },
        {
            ".name": "mieru_srv", ".type": "server", enabled: "1", label: "mieru", protocol: "mieru",
            listen: "0.0.0.0", listen_port: "20011", mieru_transport: "UDP", routing_mode: "direct"
        },
        {
            ".name": "mtproto_srv", ".type": "server", enabled: "1", label: "mtproto", protocol: "mtproto",
            listen: "0.0.0.0", listen_port: "20012", mtproto_faketls: "google.com", routing_mode: "direct"
        },
        {
            ".name": "tailscale_srv", ".type": "server", enabled: "1", label: "tailscale",
            protocol: "tailscale", tailscale_auth_key: "tskey-auth-contract", tailscale_hostname: "forkop",
            tailscale_control_url: "https://controlplane.tailscale.com", tailscale_accept_routes: "1",
            tailscale_ephemeral: "1", tailscale_advertise_routes: [ "192.168.1.0/24" ], routing_mode: "direct"
        }
    ],
    server_client: [
        { ".name": "c_mixed", ".type": "server_client", server: "mixed_srv", name: "user", password: "pass" },
        {
            ".name": "c_vless", ".type": "server_client", server: "vless_srv", name: "phone",
            uuid: "11111111-1111-4111-8111-111111111111"
        },
        {
            ".name": "c_vless_http", ".type": "server_client", server: "vless_http", name: "phone",
            uuid: "11111111-1111-4111-8111-111111111112", flow: "xtls-rprx-vision"
        },
        {
            ".name": "c_vmess", ".type": "server_client", server: "vmess_srv", name: "phone",
            uuid: "22222222-2222-4222-8222-222222222222"
        },
        {
            ".name": "c_vmess_up", ".type": "server_client", server: "vmess_upgrade", name: "phone",
            uuid: "22222222-2222-4222-8222-222222222223"
        },
        {
            ".name": "c_trojan", ".type": "server_client", server: "trojan_srv", name: "phone",
            password: "trojan-pass"
        },
        {
            ".name": "c_trojan_g", ".type": "server_client", server: "trojan_grpc", name: "phone",
            password: "trojan-pass"
        },
        {
            ".name": "c_ss", ".type": "server_client", server: "ss_srv", name: "phone",
            password: "ZGVmYXVsdC1rZXktZm9yLXRlc3RzLTMyLWJ5dGVzIQ=="
        },
        { ".name": "c_hy2", ".type": "server_client", server: "hy2_srv", name: "phone", password: "hy2-pass" },
        {
            ".name": "c_tuic", ".type": "server_client", server: "tuic_srv", name: "phone",
            uuid: "33333333-3333-4333-8333-333333333333", password: "tuic-pass"
        },
        {
            ".name": "c_anytls", ".type": "server_client", server: "anytls_srv", name: "phone",
            password: "anytls-pass"
        },
        {
            ".name": "c_naive", ".type": "server_client", server: "naive_srv", name: "phone",
            password: "naive-pass"
        },
        {
            ".name": "c_ssh", ".type": "server_client", server: "ssh_srv", name: "phone", password: "ssh-pass",
            authorized_keys: [ "ssh-ed25519 AAAAC3Nz" ]
        },
        {
            ".name": "c_mieru", ".type": "server_client", server: "mieru_srv", name: "phone",
            password: "mieru-pass"
        },
        {
            ".name": "c_mtproto", ".type": "server_client", server: "mtproto_srv", name: "phone",
            secret: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }
    ]
};

// The keys of a user are checked against the user struct of its protocol.
const USER_KEYS = {
    mixed: [ "username", "password" ],
    naive: [ "username", "password" ],
    vless: [ "name", "uuid", "flow" ],
    vmess: [ "name", "uuid", "alterId" ],
    trojan: [ "name", "password" ],
    shadowsocks: [ "name", "password" ],
    hysteria2: [ "name", "password" ],
    tuic: [ "name", "uuid", "password" ],
    anytls: [ "name", "password" ],
    ssh: [ "name", "password", "authorized_keys" ],
    mieru: [ "name", "password" ],
    mtproxy: [ "name", "secret" ]
};

fixture.seed(SERVERS);
let config = generator.build({ service_address: "127.0.0.1" });
let listeners = filter([ ...(config.inbounds ?? []), ...(config.endpoints ?? []) ], (item) => schema[item.type] != null);

// Every key below `node` that the core has no option for, as a dotted path.
function unknown_keys(node, allowed, trail) {
    let unknown = [];
    for (let key, value in node) {
        if (length(trail) == 0 && (key == "type" || key == "tag"))
            continue;
        let path = [ ...trail, key ];
        let permitted = type(allowed) == "object" ? allowed[key] : null;
        if (permitted == null) {
            push(unknown, join(".", path));
            continue;
        }
        if (permitted === true)
            continue;
        for (let item in (type(value) == "array" ? value : [ value ]))
            if (type(item) == "object")
                push(unknown, ...unknown_keys(item, permitted, path));
    }
    return unknown;
}

t.test("every protocol the tab serves produces a listener", () => {
    let types = uniq(map(listeners, (item) => item.type));
    for (let expected in [ "mixed", "vless", "vmess", "trojan", "shadowsocks", "hysteria2",
        "tuic", "anytls", "naive", "ssh", "mieru", "mtproxy", "tailscale" ])
        t.contains(types, expected);
});

t.test("a listener carries only options the core has", () => {
    let unknown = [];
    for (let listener in listeners)
        for (let path in unknown_keys(listener, schema[listener.type], []))
            push(unknown, listener.type + ": " + path);
    t.eq(unknown, []);
});

t.test("a user carries only the fields of its protocol's user struct", () => {
    for (let listener in listeners) {
        let allowed = USER_KEYS[listener.type];
        if (allowed == null)
            continue;
        for (let user in listener.users ?? [])
            for (let key in keys(user))
                t.contains(allowed, key, listener.type + " user");
    }
});

t.done();
