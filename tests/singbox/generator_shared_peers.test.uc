let t = require("t");
let fixture = require("fixture");
let q = require("sbconfig");
let generator = require("singbox.generator");

function build(data) {
    fixture.seed(data);
    return generator.build({ service_address: "127.0.0.1" });
}

function refused(data) {
    return t.throws(() => build(data)).message;
}

function section(name, label, extra) {
    return { ".name": name, label, enabled: "1", action: "connection", destinations: name + ".example", ...(extra ?? {}) };
}

function awg(name, owner, extra) {
    return {
        ".name": name, section: owner, order: "0", kind: "amneziawg", name: "awg",
        address: [ "10.8.1.5/32" ], private_key: "client-key", mtu: "1280",
        amnezia_jc: "5", amnezia_s4: "12", amnezia_random_trailers: "1",
        ...(extra ?? {})
    };
}

function peer(name, tunnel, extra) {
    return {
        ".name": name, tunnel, order: "0", address: "203.0.113.1", port: "42726",
        public_key: "server-key", allowed_ips: [ "0.0.0.0/0" ], persistent_keepalive_interval: "25-35",
        ...(extra ?? {})
    };
}

function one_server_in_two_sections(changes) {
    let data = {
        settings: fixture.settings(),
        section: [ section("proxy", "Proxy"), section("test", "Test"), section("hop", "Hop") ],
        connection_link: fixture.links("hop", [ "socks://127.0.0.1:1080#hop" ]),
        tunnel: [ awg("tun_proxy", "proxy"), awg("tun_test", "test") ],
        tunnel_peer: [ peer("peer_proxy", "tun_proxy"), peer("peer_test", "tun_test") ]
    };
    if (changes)
        changes(data);
    return data;
}

t.test("one AmneziaWG server in two sections stays an endpoint of each", () => {
    let config = build(one_server_in_two_sections());
    for (let tag in [ "Proxy/awg", "Test/awg" ]) {
        let endpoint = q.endpoint(config, tag);
        t.eq(endpoint.type, "amneziawg", tag);
        t.eq(endpoint.private_key, "client-key", tag);
    }
});

t.test("one key for one server with another detour is refused, naming both endpoints", () => {
    let message = refused(one_server_in_two_sections((data) => {
        data.tunnel[1].detour_section = "hop";
    }));
    t.contains(message, "'Proxy/awg'");
    t.contains(message, "'Test/awg'");
    t.contains(message, "different detour");
});

t.test("one key for one server with another MTU or obfuscation is refused", () => {
    t.contains(refused(one_server_in_two_sections((data) => { data.tunnel[1].mtu = "1420"; })), "different mtu");
    t.contains(refused(one_server_in_two_sections((data) => { data.tunnel[1].amnezia_s4 = "16"; })), "different amnezia");
    t.contains(refused(one_server_in_two_sections((data) => { data.tunnel_peer[1].port = "51820"; })), "different peers");
});

t.test("one client key for two servers is two peers and allowed", () => {
    let config = build(one_server_in_two_sections((data) => {
        data.tunnel[1].mtu = "1420";
        data.tunnel_peer[1].public_key = "other-server-key";
    }));
    t.eq(q.endpoint(config, "Test/awg").mtu, 1420);
});

t.test("a JSON endpoint equal to a tunnel apart from key order is the same device", () => {
    let config = build(one_server_in_two_sections((data) => {
        data.tunnel[1] = {
            ".name": "tun_test", section: "test", order: "0", kind: "json",
            endpoint_json: sprintf("%J", {
                tag: "awg", peers: [ { persistent_keepalive_interval: "25-35", allowed_ips: [ "0.0.0.0/0" ], public_key: "server-key", port: 42726, address: "203.0.113.1" } ],
                amnezia: { random_trailers: true, s4: 12, jc: 5 },
                mtu: 1280, private_key: "client-key", address: [ "10.8.1.5/32" ], type: "amneziawg"
            })
        };
        data.tunnel_peer = [ data.tunnel_peer[0] ];
    }));
    t.eq(q.endpoint(config, "Test/awg").type, "amneziawg");
});

t.test("one WARP profile key with other settings is refused, registered profiles are not", () => {
    function warp(name, owner, extra) {
        return { ".name": name, section: owner, order: "0", kind: "warp", name: "warp", ...(extra ?? {}) };
    }
    let profile = { warp_profile_id: "id", warp_profile_auth_token: "token", warp_profile_private_key: "warp-key" };
    t.contains(refused({
        settings: fixture.settings(),
        section: [ section("proxy", "Proxy"), section("test", "Test") ],
        tunnel: [ warp("warp_proxy", "proxy", profile), warp("warp_test", "test", { ...profile, warp_port: "2408" }) ]
    }), "different port");
    let config = build({
        settings: fixture.settings(),
        section: [ section("proxy", "Proxy"), section("test", "Test") ],
        tunnel: [ warp("warp_proxy", "proxy"), warp("warp_test", "test", { warp_port: "2408" }) ]
    });
    t.eq(q.endpoint(config, "Test/warp").port, 2408);
});

t.done();
