let t = require("t");
let fixture = require("fixture");
let q = require("sbconfig");
let generator = require("singbox.generator");
let constants = require("singbox.constants");

const TUNNELS = {
    openconnect: {
        kind: "openconnect", dns_type: "openconnect",
        endpoint_json: sprintf("%J", { type: "openconnect", server: "vpn.example.com", username: "alice", password: "secret" })
    },
    "openvpn-client": {
        kind: "openvpn-client", dns_type: "openvpn",
        endpoint_json: sprintf("%J", { type: "openvpn-client", server: "vpn.example.com", server_port: 1194, username: "alice", password: "secret" })
    },
    tailscale: { kind: "tailscale", dns_type: "tailscale", tailscale_auth_key: "tskey-auth-test" }
};

function tunnel_fixture(kind, tunnel) {
    let options = { ...TUNNELS[kind] };
    delete options.dns_type;
    return {
        settings: { dns_server: [ "1.1.1.1" ], bootstrap_dns_server: [ "1.1.1.1" ], service_listen_address: "127.0.0.1" },
        section: [ { ".name": "vpn", enabled: "1", action: "connection", destinations: "corp.example" } ],
        tunnel: [ { ".name": "work", section: "vpn", name: "Work", ...options, ...(tunnel ?? {}) } ]
    };
}

function build(kind, tunnel) {
    fixture.seed(tunnel_fixture(kind, tunnel));
    return generator.build({ service_address: "127.0.0.1" });
}

function is_client_catch_all(rule) {
    return rule.domain == null && rule.domain_suffix == null && rule.domain_regex == null &&
        rule.query_type == null && q.has(rule.inbound, constants.SOURCE_DNS_INBOUND_TAG);
}

for (let kind in keys(TUNNELS)) {
    let current = kind;
    t.test(current + " tunnel resolves the names its server declares through that server's DNS", () => {
        let config = build(current);
        t.eq(q.dns_server_tag(config, "vpn/Work"), { type: TUNNELS[current].dns_type, tag: "vpn/Work", endpoint: "vpn/Work" });
        let rule_index = q.dns_rule_index(config, (rule) => rule.preferred_by == "vpn/Work");
        t.eq(config.dns.rules[rule_index], { preferred_by: "vpn/Work", action: "route", server: "vpn/Work" });
        t.ok(rule_index > q.dns_rule_index(config, is_client_catch_all), "after the rule every captured query stops at");
    });
}

t.test("the switch adds only the tunnel's rule and leaves every client answer as it was", () => {
    let accepted = build("openconnect");
    let ignored = build("openconnect", { accept_server_dns: "0" });
    t.eq(q.dns_server_tag(ignored, "vpn/Work"), null);
    t.eq(q.dns_rule(ignored, (rule) => rule.preferred_by != null), null);
    t.eq(slice(accepted.dns.rules, 0, -1), ignored.dns.rules);
    t.eq(accepted.dns.final, ignored.dns.final);
});

t.test("tunnels whose server declares no names get no DNS server", () => {
    for (let tunnel in [
        { kind: "wireguard", address: "10.0.0.2/32", private_key: "kEgQZbXtIpYjXtaVjhy8WfR2B3HMQxTMoKx8nTXfjnM=" },
        { kind: "warp" },
        { kind: "json", endpoint_json: sprintf("%J", { type: "openconnect", tag: "Mine", server: "vpn.example.com" }) }
    ]) {
        fixture.seed({
            settings: { dns_server: [ "1.1.1.1" ], bootstrap_dns_server: [ "1.1.1.1" ], service_listen_address: "127.0.0.1" },
            section: [ { ".name": "vpn", enabled: "1", action: "connection", destinations: "corp.example" } ],
            tunnel: [ { ".name": "work", section: "vpn", name: "Work", ...tunnel } ]
        });
        let config = generator.build({ service_address: "127.0.0.1" });
        t.eq(q.dns_rule(config, (rule) => rule.preferred_by != null), null, tunnel.kind);
        t.eq(length(filter(config.dns.servers, (server) => server.endpoint != null)), 0, tunnel.kind);
    }
});

t.done();
