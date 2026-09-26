let t = require("t");
let stub = require("stub");
let fixture = require("fixture");
let fs = require("fs");
let uci = require("uci");
let core_uci = require("core.uci");
let server = require("server.service");

let dir = null;

// Every test starts from directories of its own.
function fresh_paths() {
    dir = stub.tmpdir();
    server.paths.certificates = dir + "/server-certs";
    server.paths.ssh_keys = dir + "/server-ssh";
    server.paths.firewall_include = dir + "/nftables.d/chain-pre/input/forkop-servers.nft";
    server.paths.firewall_init = dir + "/firewall-missing";
    fs.mkdir(dir + "/elsewhere");
}

let issued = [];
let keygen = [];

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
    [ "dropbearkey", (argv) => {
        fs.writefile(argv[4], "dropbear-key\n");
        push(keygen, "dropbearkey");
        return {};
    } ],
    [ "dropbearconvert", (argv) => {
        fs.writefile(argv[4], "-----BEGIN OPENSSH PRIVATE KEY-----\ntest-key\n-----END OPENSSH PRIVATE KEY-----\n");
        push(keygen, "dropbearconvert");
        return {};
    } ],
    [ "nft list chain inet fw4 input", { status: 1 } ]
];

function prepared(data, extra_tools) {
    fixture.seed(data);
    issued = [];
    keygen = [];
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
        { ".name": "mtproto", protocol: "mtproto" },
        { ".name": "naive", protocol: "naive", enabled: "0" },
        { ".name": "ssh", protocol: "ssh", ssh_host_key_path: dir + "/ssh/host_key " + dir + "/ssh/host_key_secondary" },
        { ".name": "ssh_disabled", protocol: "ssh", enabled: "0" },
        { ".name": "mieru", protocol: "mieru" },
        { ".name": "anytls", protocol: "anytls", enabled: "0" },
        { ".name": "tuic", protocol: "tuic", enabled: "0" },
        { ".name": "vless_no_client", protocol: "vless" },
        {
            ".name": "hy2", label: "Edge hy2", protocol: "hysteria2", enabled: "1", tls_server_name: "naive-sni.example",
            tls_certificate_path: server.paths.certificates + "/hy2.crt", tls_key_path: server.paths.certificates + "/hy2.key"
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
        { ".name": "cff0002", server: "mtproto", secret: "eeaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6578616d706c652e6f7267" },
        { ".name": "cff0009", server: "hy2", password: "hy2-secret" }
    ];
}

function configuration() {
    return { settings: {}, server: servers(dir), server_client: clients() };
}

t.test("the defaults a server runs with are filled in, and nothing the user leaves empty is invented", () => {
    fresh_paths();
    prepared(configuration());

    for (let name in [ "vless", "mixed", "tailscale", "json", "ssh", "mieru" ])
        t.eq(value(name, "security"), "", "the security mode is derived where it is read, not written back: " + name);
    t.eq(value("vless", "listen"), "0.0.0.0");
    for (let name in [ "naive", "anytls", "tuic" ])
        t.eq([ value(name, "listen"), value(name, "label") ], [ "", "" ], "a disabled server is left as it is: " + name);
    t.eq(value("tailscale", "tailscale_control_url"), "https://controlplane.tailscale.com");

    for (let path in [ "vless.listen_port", "vless.public_host", "vless.reality_short_id", "vless.reality_private_key",
        "vless.reality_public_key", "vless.tls_server_name", "shadowsocks.shadowsocks_psk", "tailscale.tailscale_hostname",
        "naive.naive_network", "mieru.mieru_transport", "tuic.tuic_congestion_control", "tuic.tuic_heartbeat",
        "naive.tls_certificate_path", "ssh_disabled.ssh_host_key_path" ])
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
    t.eq(client_value("mtproto", "secret"), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "a pasted MTProto secret is split");
    t.eq(value("mtproto", "mtproto_faketls"), "example.org");
    t.eq(value("orphan_client", "server"), "", "a client of a removed server is removed");
});

t.test("a certificate is issued for the SNI into the path the server names, and host keys for every path", () => {
    fresh_paths();
    prepared(configuration());
    t.eq(issued, [ "generate tls-keypair naive-sni.example --months 120" ]);
    t.ok(fs.stat(server.paths.certificates + "/hy2.crt")?.size > 0);
    t.eq(fs.stat(server.paths.certificates + "/hy2.key")?.perm?.other_read, false);
    t.ok(fs.stat(dir + "/ssh/host_key")?.size > 0);
    t.ok(fs.stat(dir + "/ssh/host_key_secondary")?.size > 0);
    t.eq(length(keygen), 4, "each configured host key is generated and converted once");
    t.eq(filter(fs.lsdir(dir + "/ssh"), (name) => substr(name, 0, 12) == ".forkop-ssh."), [], "no temporary directory is left behind");
});

t.test("a second prepare over prepared servers changes and generates nothing", () => {
    fresh_paths();
    prepared(configuration());
    let data = { settings: {}, server: uci.__sections("forkop") };
    uci.__seed("forkop", data.server);
    core_uci.reset();
    let before = length(uci.__commits());
    issued = [];
    keygen = [];
    stub.commands(TOOLS);
    server.prepare();
    stub.restore();
    t.eq(length(uci.__commits()), before, "nothing is committed");
    t.eq([ issued, keygen ], [ [], [] ]);
});

t.test("Forkop reissues its own certificate once the stamp is gone, and never touches one the user chose", () => {
    fresh_paths();
    let own = server.paths.certificates + "/own";
    let theirs = dir + "/elsewhere/theirs";
    for (let base in [ own, theirs ]) {
        fs.writefile(base + ".crt", "certificate\n");
        fs.writefile(base + ".key", "key\n");
    }
    fs.mkdir(server.paths.certificates);
    fs.writefile(own + ".crt.expires", sprintf("%d\n", time() + 3600));
    prepared({ server: [
        { ".name": "own", protocol: "trojan", security: "tls", tls_server_name: "own.example", tls_certificate_path: own + ".crt", tls_key_path: own + ".key" },
        { ".name": "theirs", protocol: "trojan", security: "tls", tls_certificate_path: theirs + ".crt", tls_key_path: theirs + ".key" }
    ] });
    t.eq(issued, [ "generate tls-keypair own.example --months 120" ], "a certificate a day from expiry is replaced");
    t.eq(fs.readfile(theirs + ".crt"), "certificate\n");

    fs.writefile(own + ".crt.expires", sprintf("%d\n", time() + 90 * 24 * 3600));
    prepared({ server: [ { ".name": "own", protocol: "trojan", security: "tls", tls_certificate_path: own + ".crt", tls_key_path: own + ".key" } ] });
    t.eq(issued, [], "a certificate far from expiry is kept");
});

t.test("a broken server refuses the whole prepare and commits nothing, unless it is disabled", () => {
    fresh_paths();
    fixture.seed({ server: [ { ".name": "a", protocol: "vless" }, { ".name": "b", protocol: "gopher" } ] });
    stub.commands(TOOLS);
    let e = t.throws(() => server.prepare());
    stub.restore();
    t.eq(e.message, "Server 'b' has unsupported protocol 'gopher'. Aborted.");
    t.eq(uci.__commits(), []);

    fixture.seed({ server: [ { ".name": "a", protocol: "vless" }, { ".name": "b", protocol: "gopher", enabled: "0" },
        { ".name": "c", protocol: "ssh", enabled: "0", ssh_host_key_path: "relative/key" } ] });
    stub.commands(TOOLS);
    server.prepare();
    stub.restore();
    t.ok(length(uci.__commits()) > 0, "a disabled server does not stop the others from being prepared");
});

// Removal waits for a configuration the validator accepted, so the prepare that
// runs before it only adds.
t.test("prepare removes nothing: what removed servers left goes afterwards", () => {
    fresh_paths();
    fs.mkdir(server.paths.certificates);
    fs.writefile(server.paths.certificates + "/gone.crt", "file\n");
    stub.real.system("touch -d '2 hours ago' '" + server.paths.certificates + "/gone.crt'");
    fixture.seed({ server: [ { ".name": "a", protocol: "mixed" } ],
        server_client: [ { ".name": "stray", server: "vanished", name: "phone", password: "secret" } ] });
    stub.commands(TOOLS);
    server.prepare();
    t.ok(fs.stat(server.paths.certificates + "/gone.crt") != null);
    t.eq(core_uci.get("forkop.stray.server"), "vanished");
    server.remove_orphans();
    stub.restore();
    core_uci.reset();
    t.eq([ fs.stat(server.paths.certificates + "/gone.crt"), value("stray", "server") ], [ null, "" ]);
});

t.test("the certificate command names the files after the section and the subject after the name", () => {
    fresh_paths();
    stub.commands(TOOLS);
    issued = [];
    let home = server.issue_certificate("Дом", "newaaaa");
    let garden = server.issue_certificate("Сад", "newbbbb");
    stub.restore();
    t.eq(home.certificate_path, server.paths.certificates + "/newaaaa.crt");
    t.eq(garden.key_path, server.paths.certificates + "/newbbbb.key");
    t.eq(home.sha256, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    t.eq(issued, [ "generate tls-keypair Дом --months 120", "generate tls-keypair Сад --months 120" ]);
    t.eq(fs.stat(server.paths.certificates + "/newbbbb.key").perm.group_read, false);
    t.ok(fs.stat(server.paths.certificates + "/______.crt") == null);
    t.eq(t.throws(() => server.issue_certificate(" ", "x")).message, "Missing certificate subject or name");
});

t.test("the fingerprint and key pair commands read what the tools print", () => {
    fresh_paths();
    fs.writefile(dir + "/elsewhere/server.crt", "-----BEGIN CERTIFICATE-----\naGVs\nbG8=\n-----END CERTIFICATE-----\n");
    fixture.seed({ server: [
        { ".name": "tls", protocol: "trojan", security: "tls", tls_certificate_path: dir + "/elsewhere/server.crt" },
        { ".name": "plain", protocol: "vless" }
    ] });
    stub.commands(TOOLS);
    t.eq(server.certificate_sha256("tls"), { sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" });
    t.eq(t.throws(() => server.certificate_sha256("plain")).message, "Server does not use TLS");
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
        { ".name": "fw_ss", protocol: "shadowsocks", listen_port: "31007" }
    ];
}

t.test("the firewall include opens the ports of enabled servers for the protocols they carry", () => {
    fresh_paths();
    fixture.seed({ server: firewall_servers() });
    stub.commands(TOOLS);
    server.sync_firewall(false);
    let include = fs.readfile(server.paths.firewall_include);
    t.contains(include, "meta l4proto tcp th dport { 31001, 31003, 31007 } counter accept comment \"forkop: server ports\"");
    t.contains(include, "meta l4proto udp th dport { 31002, 31003, 31007 } counter accept comment \"forkop: server ports\"");
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

t.test("files of removed servers go, files a server points at or is named for stay, nothing outside is touched", () => {
    fresh_paths();
    let certs = server.paths.certificates;
    let keys = server.paths.ssh_keys;
    fs.mkdir(certs);
    fs.mkdir(keys);
    for (let path in [ certs + "/gone.crt", certs + "/gone.key", certs + "/gone.crt.expires", keys + "/gone.key",
        certs + "/handmade.crt", certs + "/handmade.key", keys + "/handmade.key", dir + "/elsewhere/private.crt",
        certs + "/fw_certs.crt", keys + "/fw_ssh.key" ]) {
        fs.writefile(path, "file\n");
        stub.real.system("touch -d '2 hours ago' '" + path + "'");
    }
    fs.writefile(certs + "/unsaved.crt", "file\n");

    prepared({ server: [
        { ".name": "fw_certs", protocol: "trojan", enabled: "0", security: "tls",
            tls_certificate_path: certs + "/handmade.crt", tls_key_path: certs + "/handmade.key" },
        { ".name": "fw_ssh", protocol: "ssh", enabled: "0", ssh_host_key_path: keys + "/handmade.key" }
    ] });

    for (let path in [ certs + "/gone.crt", certs + "/gone.key", certs + "/gone.crt.expires", keys + "/gone.key" ])
        t.ok(fs.stat(path) == null, "removed: " + path);
    for (let path in [ certs + "/handmade.crt", certs + "/handmade.key", keys + "/handmade.key",
        dir + "/elsewhere/private.crt", certs + "/fw_certs.crt", keys + "/fw_ssh.key", certs + "/unsaved.crt" ])
        t.ok(fs.stat(path) != null, "kept: " + path);
});

t.test("a configuration without servers loses no file and no account", () => {
    fresh_paths();
    fs.mkdir(server.paths.certificates);
    fs.writefile(server.paths.certificates + "/whatever.crt", "file\n");
    prepared({ settings: {}, server_client: [ { ".name": "stray", server: "vanished", name: "phone", password: "secret" } ] });
    t.ok(fs.stat(server.paths.certificates + "/whatever.crt") != null);
    t.eq(value("stray", "password"), "secret");
});

t.done();
