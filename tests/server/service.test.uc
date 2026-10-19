let t = require("t");
let stub = require("stub");
let fixture = require("fixture");
let fs = require("fs");
let uci = require("uci");
let core_uci = require("core.uci");
let server = require("server.service");

let dir = null;

const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

// Every test starts from directories of its own.
function fresh_paths() {
    dir = stub.tmpdir();
    server.paths.firewall_include = dir + "/nftables.d/chain-pre/input/forkop-servers.nft";
    server.paths.firewall_init = dir + "/firewall-missing";
}

let issued = [];

function real_output(command) {
    let pipe = stub.real.popen(command, "r");
    let output = pipe.read("all");
    pipe.close();
    return output;
}

const TOOLS = [
    [ "logger", {} ],
    [ "sing-box generate tls-keypair", (argv) => {
        push(issued, join(" ", slice(argv, 1)));
        return { stdout: "-----BEGIN PRIVATE KEY-----\nkey-body\n-----END PRIVATE KEY-----\n" +
            "-----BEGIN CERTIFICATE-----\naGVsbG8=\n-----END CERTIFICATE-----\n" };
    } ],
    [ "sing-box generate reality-keypair", { stdout: "PrivateKey: private-key\nPublicKey: public-key\n" } ],
    [ "sha256sum", (argv) => ({ stdout: real_output("sha256sum '" + argv[1] + "'") }) ],
    [ "nft list chain inet fw4 input", { status: 1 } ]
];

function prepared(data, extra_tools) {
    fixture.seed(data);
    issued = [];
    stub.commands([ ...(extra_tools ?? []), ...TOOLS ]);
    server.prepare();
    server.remove_orphans();
    stub.restore();
    core_uci.reset();
}

function value(section, option) {
    return core_uci.get("forkop." + section + "." + option);
}

function clients_of(owner) {
    return filter(core_uci.sections("forkop", "server_client"), (name) => value(name, "server") == owner);
}

function client_value(owner, option) {
    let names = clients_of(owner);
    t.eq(length(names), 1, "clients of " + owner);
    return value(names[0], option);
}

function servers(dir) {
    return [
        { ".name": "vless", protocol: "vless" },
        { ".name": "mixed", protocol: "mixed", label: "Рабочий стол" },
        { ".name": "mixed_open", protocol: "mixed", label: "guest", mixed_auth_enabled: "0" },
        { ".name": "mixed_cased", protocol: "mixed", label: "Office" },
        { ".name": "shadowsocks", protocol: "shadowsocks", shadowsocks_method: "2022-blake3-aes-256-gcm" },
        { ".name": "tailscale", protocol: "tailscale" },
        { ".name": "json", protocol: "json_inbound" },
        { ".name": "naive", protocol: "naive", enabled: "0" },
        { ".name": "mieru", protocol: "mieru" },
        { ".name": "anytls", protocol: "anytls", enabled: "0" },
        { ".name": "tuic", protocol: "tuic", enabled: "0" },
        { ".name": "vless_no_client", protocol: "vless" },
        {
            ".name": "hy2", label: "Edge hy2", protocol: "hysteria2", enabled: "1", tls_server_name: "naive-sni.example"
        }
    ];
}

function clients() {
    return [
        { ".name": "cff0001", server: "vless", uuid: "22222222-2222-4222-8222-222222222222", flow: "xtls-rprx-vision" },
        { ".name": "cff0003", server: "mixed", name: "Рабочий стол", password: "desktop-password" },
        { ".name": "cff0004", server: "mixed_open", name: "guest" },
        { ".name": "cff0005", server: "mixed_cased", name: "Alice.Phone-2", password: "office-password" },
        { ".name": "orphan_client", server: "removed_server", name: "orphan" },
        { ".name": "cff0009", server: "hy2", password: "hy2-secret" }
    ];
}

function configuration() {
    return { settings: {}, server: servers(dir), server_client: clients() };
}

t.test("the defaults a server runs with are filled in, and nothing the user leaves empty is invented", () => {
    fresh_paths();
    prepared(configuration());

    for (let name in [ "vless", "mixed", "tailscale", "json", "mieru" ])
        t.eq(value(name, "security"), "", "the security mode is derived where it is read, not written back: " + name);
    t.eq(value("vless", "listen"), "::");
    for (let name in [ "naive", "anytls", "tuic" ])
        t.eq([ value(name, "listen"), value(name, "label") ], [ "", "" ], "a disabled server is left as it is: " + name);
    t.eq(value("tailscale", "tailscale_control_url"), "https://controlplane.tailscale.com");

    for (let path in [ "vless.listen_port", "vless.public_host", "vless.reality_short_id", "vless.reality_private_key",
        "vless.reality_public_key", "vless.tls_server_name", "shadowsocks.shadowsocks_psk", "tailscale.tailscale_hostname",
        "naive.naive_network", "mieru.mieru_transport", "tuic.tuic_congestion_control",
        "naive.tls_self_signed_certificate" ])
        t.eq(core_uci.get("forkop." + path), "", path);

    for (let owner in [ "vless_no_client", "shadowsocks", "anytls", "tuic" ])
        t.eq(clients_of(owner), [], "a server without clients gets none: " + owner);
    t.ok(length(uci.__commits()) > 0, "the defaults are committed");
});

t.test("clients keep their credentials, and a login name is kept to what the protocol carries", () => {
    fresh_paths();
    prepared(configuration());
    t.eq([ client_value("vless", "uuid"), client_value("vless", "flow"), client_value("vless", "password") ],
        [ "22222222-2222-4222-8222-222222222222", "xtls-rprx-vision", "" ]);
    t.eq(client_value("mixed", "name"), "mixed", "a name outside the safe set falls back to the section id");
    t.eq(client_value("mixed_open", "name"), "guest");
    t.eq(client_value("mixed_cased", "name"), "Alice.Phone-2", "a name the protocol carries stays as typed");
    t.eq(client_value("mixed", "password"), "desktop-password");
    t.eq(value("mixed_open", "mixed_auth_enabled"), "0");
    t.eq(value("orphan_client", "server"), "", "a client of a removed server is removed");
});

t.test("a TLS server is issued a self-signed certificate for its SNI into its own options, with the fingerprint", () => {
    fresh_paths();
    prepared(configuration());
    t.eq(issued, [ "generate tls-keypair naive-sni.example --months 1200" ]);
    t.eq([ value("hy2", "tls_self_signed_certificate"), value("hy2", "tls_self_signed_key"), value("hy2", "tls_self_signed_sha256") ],
        [ "-----BEGIN CERTIFICATE-----\naGVsbG8=\n-----END CERTIFICATE-----",
            "-----BEGIN PRIVATE KEY-----\nkey-body\n-----END PRIVATE KEY-----", HELLO_SHA256 ]);
    t.eq(value("hy2", "tls_certificate_source"), "", "the source is derived where it is read, not written back");
});

t.test("a second prepare over prepared servers changes and generates nothing", () => {
    fresh_paths();
    prepared(configuration());
    let data = { settings: {}, server: uci.__sections("forkop") };
    uci.__seed("forkop", data.server);
    core_uci.reset();
    let before = length(uci.__commits());
    issued = [];
    stub.commands(TOOLS);
    server.prepare();
    stub.restore();
    t.eq(length(uci.__commits()), before, "nothing is committed");
    t.eq(issued, []);
});

t.test("only a TLS server without a certificate of the user's is issued one, and the one it has is kept", () => {
    fresh_paths();
    prepared({ server: [
        { ".name": "own", protocol: "trojan", security: "tls", tls_certificate_source: "custom",
            tls_certificate: "/etc/ssl/acme/own.crt", tls_key: "/etc/ssl/acme/own.key" },
        { ".name": "naive", protocol: "naive" },
        { ".name": "reality", protocol: "vless", security: "reality" },
        { ".name": "plain", protocol: "vmess", security: "none" },
        { ".name": "kept", protocol: "anytls", public_host: "vpn.example.com",
            tls_self_signed_certificate: "-----BEGIN CERTIFICATE-----\naGVsbG8=\n-----END CERTIFICATE-----",
            tls_self_signed_key: "-----BEGIN PRIVATE KEY-----\nkept\n-----END PRIVATE KEY-----" }
    ] });
    t.eq(issued, []);
    for (let name in [ "own", "naive", "reality", "plain" ])
        t.eq(value(name, "tls_self_signed_certificate"), "", name);
    t.eq([ value("kept", "tls_self_signed_key"), value("kept", "tls_self_signed_sha256") ],
        [ "-----BEGIN PRIVATE KEY-----\nkept\n-----END PRIVATE KEY-----", HELLO_SHA256 ],
        "a certificate issued before is kept and gets its fingerprint");
});

t.test("a broken server refuses the whole prepare and commits nothing, unless it is disabled", () => {
    fresh_paths();
    fixture.seed({ server: [ { ".name": "a", protocol: "vless" }, { ".name": "b", protocol: "gopher" } ] });
    stub.commands(TOOLS);
    let e = t.throws(() => server.prepare());
    stub.restore();
    t.eq(e.message, "Server 'b' uses unsupported protocol 'gopher'");
    t.eq(uci.__commits(), []);

    fixture.seed({ server: [ { ".name": "a", protocol: "vless" }, { ".name": "b", protocol: "gopher", enabled: "0" } ] });
    stub.commands(TOOLS);
    server.prepare();
    stub.restore();
    t.ok(length(uci.__commits()) > 0, "a disabled server does not stop the others from being prepared");
});

// Removal waits for a configuration the validator accepted, so the prepare that
// runs before it only adds.
t.test("prepare removes nothing: what removed servers left goes afterwards", () => {
    fresh_paths();
    fixture.seed({ server: [ { ".name": "a", protocol: "mixed" } ],
        server_client: [ { ".name": "stray", server: "vanished", name: "phone", password: "secret" } ] });
    stub.commands(TOOLS);
    server.prepare();
    t.eq(core_uci.get("forkop.stray.server"), "vanished");
    server.remove_orphans();
    stub.restore();
    core_uci.reset();
    t.eq(value("stray", "server"), "");
});

t.test("the key pair command reads what the tool prints", () => {
    stub.commands(TOOLS);
    t.eq(server.reality_keypair(), { private_key: "private-key", public_key: "public-key" });
    stub.restore();
});

function firewall_servers() {
    return [
        { ".name": "fw_tcp", protocol: "vless", listen_port: "31001" },
        { ".name": "fw_udp", protocol: "hysteria2", listen_port: "31002" },
        { ".name": "fw_both", protocol: "naive", naive_network: "tcp_udp", listen_port: "31003" },
        { ".name": "fw_closed", protocol: "vless", listen_port: "31004", open_firewall: "0" },
        { ".name": "fw_off", protocol: "vless", listen_port: "31005", enabled: "0" },
        { ".name": "fw_tailscale", protocol: "tailscale", listen_port: "31006" },
        { ".name": "fw_ss", protocol: "shadowsocks", listen_port: "31007" },
        { ".name": "fw_openvpn", protocol: "openvpn", listen_port: "31008" },
        { ".name": "fw_openvpn_tcp", protocol: "openvpn", openvpn_network: "tcp", listen_port: "31009" },
        { ".name": "fw_wireguard", protocol: "wireguard", listen_port: "31010" },
        { ".name": "fw_amneziawg", protocol: "amneziawg", listen_port: "31011" }
    ];
}

t.test("the firewall include opens the ports of enabled servers for the protocols they carry", () => {
    fresh_paths();
    fixture.seed({ server: firewall_servers() });
    stub.commands(TOOLS);
    server.sync_firewall(false);
    let include = fs.readfile(server.paths.firewall_include);
    t.contains(include, "meta l4proto tcp th dport { 31001, 31003, 31007, 31009 } counter accept comment \"forkop: server ports\"");
    t.contains(include, "meta l4proto udp th dport { 31002, 31003, 31007, 31008, 31010, 31011 } counter accept comment \"forkop: server ports\"");
    t.excludes(include, "31004");
    t.excludes(include, "31005");
    t.excludes(include, "31006");

    let stat = fs.stat(server.paths.firewall_include);
    server.sync_firewall(false);
    t.eq(fs.stat(server.paths.firewall_include).inode, stat.inode, "an unchanged include is not rewritten");

    server.sync_firewall(true);
    t.ok(fs.stat(server.paths.firewall_include) == null, "a stopped runtime leaves no port open");
    stub.restore();
});

t.test("a loaded firewall is reloaded when its chain disagrees with the include", () => {
    fresh_paths();
    fs.writefile(dir + "/firewall", "#!/bin/sh\n");
    fs.chmod(dir + "/firewall", 0755);
    server.paths.firewall_init = dir + "/firewall";
    fixture.seed({ server: firewall_servers() });

    let reloads = 0;
    let loaded = "chain input {\n}\n";
    stub.commands([
        [ "nft list chain inet fw4 input", () => ({ stdout: loaded }) ],
        [ dir + "/firewall reload", () => { reloads++; return {}; } ],
        ...TOOLS
    ]);
    server.sync_firewall(false);
    t.eq(reloads, 1, "a new include is loaded");
    loaded = "chain input {\n\tcomment \"forkop: server ports\"\n}\n";
    server.sync_firewall(false);
    t.eq(reloads, 1, "a chain that already carries the rules is left alone");
    loaded = "chain input {\n}\n";
    server.sync_firewall(false);
    t.eq(reloads, 2, "a chain that lost the rules is reloaded although the file did not change");
    stub.restore();
    server.paths.firewall_init = dir + "/firewall-missing";
});

function openvpn_configuration() {
    return {
        settings: {},
        server: [ { ".name": "office", label: "Office", protocol: "openvpn", tunnel_address: [ "10.8.0.1/24" ] } ],
        server_client: [
            { ".name": "laptop", server: "office", name: "Ноутбук" },
            { ".name": "phone", server: "office", name: "Phone", openvpn_certificate: "-----BEGIN CERTIFICATE-----\naGVsbG8=\n-----END CERTIFICATE-----",
                openvpn_key: "-----BEGIN PRIVATE KEY-----\nown\n-----END PRIVATE KEY-----" }
        ]
    };
}

t.test("an OpenVPN server gets its certificate, its tls-crypt key and one certificate per client, each named after its section", () => {
    fresh_paths();
    prepared(openvpn_configuration());
    t.eq(issued, [ "generate tls-keypair office --months 1200", "generate tls-keypair laptop --months 1200" ]);
    t.eq(value("office", "openvpn_certificate"), "-----BEGIN CERTIFICATE-----\naGVsbG8=\n-----END CERTIFICATE-----");
    t.eq(value("office", "openvpn_key"), "-----BEGIN PRIVATE KEY-----\nkey-body\n-----END PRIVATE KEY-----");
    t.eq(value("office", "openvpn_network"), "udp");
    let key = split(value("office", "openvpn_tls_crypt_key"), "\n");
    t.eq([ key[0], key[17], length(key) ], [ "-----BEGIN OpenVPN Static key V1-----", "-----END OpenVPN Static key V1-----", 18 ]);
    t.eq(filter(slice(key, 1, 17), (line) => match(line, /^[0-9a-f]{32}$/) == null), [], "16 lines of 32 hex digits");

    t.eq(value("laptop", "name"), "Ноутбук", "a client is shown under any name");
    t.eq([ value("laptop", "openvpn_key"), value("laptop", "openvpn_certificate_sha256") ],
        [ "-----BEGIN PRIVATE KEY-----\nkey-body\n-----END PRIVATE KEY-----", HELLO_SHA256 ]);
    t.eq([ value("phone", "openvpn_key"), value("phone", "openvpn_certificate_sha256") ],
        [ "-----BEGIN PRIVATE KEY-----\nown\n-----END PRIVATE KEY-----", HELLO_SHA256 ],
        "a client that has a certificate keeps it and gets its fingerprint");
});

t.test("an OpenVPN server prepared once keeps every certificate and key it was given", () => {
    fresh_paths();
    prepared(openvpn_configuration());
    let before = map([ "office.openvpn_certificate", "office.openvpn_tls_crypt_key", "laptop.openvpn_certificate" ],
        (path) => core_uci.get("forkop." + path));
    uci.__seed("forkop", uci.__sections("forkop"));
    core_uci.reset();
    let commits = length(uci.__commits());
    issued = [];
    stub.commands(TOOLS);
    server.prepare();
    stub.restore();
    t.eq(issued, []);
    t.eq(length(uci.__commits()), commits, "nothing is committed");
    t.eq(map([ "office.openvpn_certificate", "office.openvpn_tls_crypt_key", "laptop.openvpn_certificate" ],
        (path) => core_uci.get("forkop." + path)), before);
});

let wireguard_keys = 0;

// Each key pair the tool prints is a new one, so a test can tell who got which.
const WIREGUARD_TOOLS = [
    [ "sing-box generate wg-keypair", () => {
        wireguard_keys++;
        return { stdout: sprintf("PrivateKey: %043d=\nPublicKey: %042dP=\n", wireguard_keys, wireguard_keys) };
    } ]
];

function wireguard_configuration(protocol) {
    return {
        settings: {},
        server: [ {
            ".name": "home", label: "Home", protocol, listen_port: "51820",
            tunnel_address: [ "10.8.0.1/24", "fd00:8::1/64" ], amnezia_jc: "5", amnezia_i1: "<r 2>"
        } ],
        server_client: [
            { ".name": "phone", server: "home", name: "Phone" },
            { ".name": "laptop", server: "home", name: "Laptop" },
            { ".name": "tablet", server: "home", name: "Tablet", wireguard_private_key: "own-private",
                wireguard_public_key: "own-public", wireguard_pre_shared_key: "own-psk",
                wireguard_address: [ "10.8.0.5/32" ] }
        ]
    };
}

function list_value(section, option) {
    return core_uci.get_all("forkop", section)[option];
}

t.test("a WireGuard server gets its key, and every client a key pair, a pre-shared key and a free address in each subnet", () => {
    fresh_paths();
    wireguard_keys = 0;
    prepared(wireguard_configuration("wireguard"), WIREGUARD_TOOLS);
    t.eq([ value("home", "wireguard_private_key"), value("home", "wireguard_public_key") ],
        [ sprintf("%043d=", 1), sprintf("%042dP=", 1) ]);
    t.eq(value("home", "listen"), "", "the endpoint takes no listen address");
    t.eq(value("phone", "wireguard_private_key"), sprintf("%043d=", 2));
    t.eq(value("laptop", "wireguard_public_key"), sprintf("%042dP=", 3));
    t.eq([ value("tablet", "wireguard_private_key"), value("tablet", "wireguard_pre_shared_key") ],
        [ "own-private", "own-psk" ], "a client that has its keys keeps them");
    for (let client in [ "phone", "laptop" ])
        t.eq(length(b64dec(value(client, "wireguard_pre_shared_key"))), 32, client + " pre-shared key");
    t.ok(value("phone", "wireguard_pre_shared_key") != value("laptop", "wireguard_pre_shared_key"));
    t.eq(list_value("phone", "wireguard_address"), [ "10.8.0.2/32", "fd00:8::2/128" ]);
    t.eq(list_value("laptop", "wireguard_address"), [ "10.8.0.3/32", "fd00:8::3/128" ]);
    t.eq(list_value("tablet", "wireguard_address"), [ "10.8.0.5/32", "fd00:8::4/128" ], "a held address is kept");
    t.eq(value("home", "amnezia_header_protection_key"), "", "a WireGuard server has nothing of AmneziaWG");
});

t.test("an AmneziaWG server keeps the parameters the dialog gave it and is issued none", () => {
    fresh_paths();
    prepared(wireguard_configuration("amneziawg"), WIREGUARD_TOOLS);
    t.eq(map([ "jc", "i1", "jmin", "s1", "h1", "header_protection_key", "random_trailers" ],
        (key) => value("home", "amnezia_" + key)), [ "5", "<r 2>", "", "", "", "", "" ],
        "an empty parameter stays off, header protection included");
});

t.test("a WireGuard server prepared once keeps every key and address it was given", () => {
    fresh_paths();
    prepared(wireguard_configuration("amneziawg"), WIREGUARD_TOOLS);
    let paths = [ "home.wireguard_private_key", "phone.wireguard_private_key",
        "phone.wireguard_pre_shared_key", "laptop.wireguard_address" ];
    let before = map(paths, (path) => core_uci.get("forkop." + path));
    uci.__seed("forkop", uci.__sections("forkop"));
    core_uci.reset();
    let commits = length(uci.__commits());
    let keys = wireguard_keys;
    stub.commands([ ...WIREGUARD_TOOLS, ...TOOLS ]);
    server.prepare();
    stub.restore();
    t.eq(wireguard_keys, keys, "no key pair is asked for");
    t.eq(length(uci.__commits()), commits, "nothing is committed");
    t.eq(map(paths, (path) => core_uci.get("forkop." + path)), before);
});

t.test("a client whose address left the subnet, or that another client holds, gets a free one", () => {
    fresh_paths();
    let data = wireguard_configuration("wireguard");
    data.server[0].tunnel_address = [ "10.9.0.1/24" ];
    data.server_client[0].wireguard_address = [ "10.9.0.7/32" ];
    data.server_client[1].wireguard_address = [ "10.9.0.7/32", "fd00:8::2/128" ];
    prepared(data, WIREGUARD_TOOLS);
    t.eq(list_value("phone", "wireguard_address"), [ "10.9.0.7/32" ]);
    t.eq(list_value("laptop", "wireguard_address"), [ "10.9.0.2/32" ], "the second holder moves and the IPv6 address goes");
    t.eq(list_value("tablet", "wireguard_address"), [ "10.9.0.3/32" ], "an address outside the subnet is replaced");
});

t.test("a configuration without servers loses no account", () => {
    fresh_paths();
    prepared({ settings: {}, server_client: [ { ".name": "stray", server: "vanished", name: "phone", password: "secret" } ] });
    t.eq(value("stray", "password"), "secret");
});

t.done();
