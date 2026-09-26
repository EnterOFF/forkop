let t = require("t");
let v = require("validation");

function section(name, action, extra) {
    return { ".name": name, enabled: "1", action, ...(extra ?? {}) };
}

// A server of its own, which is what makes a section carry traffic at all.
const SERVED = { selector_proxy_links: [ "socks://127.0.0.1:1080#one" ] };

function cascade(from, to) {
    return { ...SERVED, outbound_detour_enabled: "1", outbound_detour_section: to };
}

t.test("a cascade points at another enabled Connection section with servers, without a cycle", () => {
    v.accepts({ section: [ section("source", "connection", cascade("source", "target")), section("target", "connection", SERVED) ] });
    v.refuses({ section: [ section("source", "zapret", cascade("source", "target")), section("target", "connection", SERVED) ] },
        "supported only for Connection rules");
    v.refuses({ section: [ section("source", "connection", cascade("source", "missing")) ] }, "references missing rule 'missing'");
    v.refuses({ section: [ section("source", "connection", cascade("source", "target")), section("target", "connection", { ...SERVED, enabled: "0" }) ] },
        "references disabled rule 'target'");
    v.refuses({ section: [ section("source", "connection", cascade("source", "target")), section("target", "zapret") ] },
        "references rule 'target' with unsupported action 'zapret'");
    v.refuses({ section: [ section("source", "connection", cascade("source", "target")), section("target", "connection") ] },
        "references rule 'target', which has no servers");
    v.refuses({ section: [ section("source", "connection", cascade("source", "source")) ] }, "cannot point to itself");
    v.refuses({ section: [ section("first", "connection", cascade("first", "second")), section("second", "connection", cascade("second", "first")) ] },
        "creates a cycle through 'second'");
});

// The runtime leaves out a Connection section without servers, so everything
// that can name one as the way out refuses it rather than start sing-box with
// an outbound that does not exist.
t.test("no reference may lead to a section without servers", () => {
    let empty = section("empty", "connection");
    let dns = section("dns", "dns", { dns_server: [ "8.8.8.8" ], domain_suffix: [ "example.org" ], dns_detour_enabled: "1", dns_detour_section: "empty" });
    for (let data in [
        { settings: { dns_detour_enabled: "1", dns_detour_section: "empty" }, section: [ empty ] },
        { section: [ empty, dns ] },
        { settings: { download_lists_via_proxy: "1", download_lists_via_proxy_section: "empty" }, section: [ empty ] },
        { section: [ empty ], server: [ { ".name": "srv", enabled: "1", protocol: "mixed", listen_port: "18080", mixed_auth_enabled: "0",
            routing_mode: "section", routing_section: "empty" } ] },
        { section: [ empty ], server: [ { ".name": "srv", enabled: "1", protocol: "mixed", listen_port: "18080", routing_mode: "direct" } ],
            server_client: [ { ".name": "srv_one", server: "srv", name: "one", password: "secret", routing_override: "1", routing_mode: "section", routing_section: "empty" } ] }
    ])
        v.refuses(data, "references rule 'empty', which has no servers");
    v.refuses({ section: [ empty ], server: [ { ".name": "srv", enabled: "1", protocol: "mixed", listen_port: "18080", routing_mode: "direct" } ],
        server_client: [ { ".name": "srv_one", server: "srv", name: "one", password: "secret", routing_override: "1", routing_mode: "section", routing_section: "gone" } ] },
        "Server 'srv' client 'one' references missing rule 'gone'");
});

function download_through(target, sections) {
    return {
        settings: { download_lists_via_proxy: "1", download_lists_via_proxy_section: target },
        section: sections
    };
}

t.test("downloads go through an enabled section with servers", () => {
    let served = { proxy: { selector_proxy_links: [ "socks://127.0.0.1:1080#one" ] }, outbound: { outbound_json: "{\"type\":\"direct\"}" }, vpn: { interface: "wg0" } };
    for (let action, sources in served)
        v.accepts(download_through(action, [ section(action, action, sources) ]));
    v.refuses(download_through("", [ section("proxy", "proxy") ]), "no download section is selected");
    v.refuses(download_through("missing", [ section("proxy", "proxy") ]), "references missing rule 'missing'");
    v.refuses(download_through("proxy", [ section("proxy", "proxy", { ...served.proxy, enabled: "0" }) ]), "references disabled rule 'proxy'");
    v.refuses(download_through("bypass", [ section("bypass", "bypass") ]), "with unsupported action 'bypass'");
});

function with_rule_sets(key, values) {
    return { section: [ section("proxy", "connection", { [key]: values }) ] };
}

t.test("community lists name a known service", () => {
    v.accepts(with_rule_sets("community_lists", [ "twitter", "telegram" ]));
    v.refuses(with_rule_sets("community_lists", [ "unknown" ]), "Invalid service in community lists: unknown");
});

t.test("rule sets are community names, http(s) URLs or absolute paths, never YAML", () => {
    for (let reference in [ "telegram", "https://example.com/rule.srs", "/tmp/rule.srs", "/tmp/rule.json", "/tmp/rule.lst", "/tmp/rule" ])
        v.accepts(with_rule_sets("rule_set", [ reference ]));
    for (let reference in [ "/tmp/rule.yaml", "https://example.com/rule.yml?token=secret", "relative/rule.srs", "ftp://example.com/rule.srs" ])
        v.refuses(with_rule_sets("rule_set", [ reference ]), "Unknown rule set reference");
});

t.done();
