let t = require("t");
let proxy_check = require("diagnostics.check_proxy");

t.test("the throwaway proxy check core drops what would need downloading or fight the running one", () => {
    let prepared = proxy_check.prepare_config({
        dns: { rules: [ { rule_set: [ "remote-lists" ], server: "fakeip-server" }, { domain: [ "example.org" ], server: "fakeip-server" } ] },
        inbounds: [ { type: "tproxy", tag: "tproxy-in" } ],
        route: {
            rule_set: [ { type: "remote", tag: "remote-lists", url: "https://example.com/lists.srs" }, { type: "local", tag: "local-lists", path: "/tmp/lists.srs" } ],
            rules: [
                { rule_set: [ "remote-lists" ], outbound: "proxy" },
                { type: "logical", mode: "and", rules: [ { rule_set: "remote-lists" }, { port: 443 } ], outbound: "proxy" },
                { rule_set: [ "local-lists" ], outbound: "proxy" },
                { domain: "ip.podkop.fyi", outbound: "proxy 1" }
            ]
        },
        experimental: { cache_file: { enabled: true, path: "/tmp/sing-box/cache.db" }, clash_api: { external_controller: "127.0.0.1:9090" } }
    }, "/tmp/check/cache.db");
    t.eq(map(prepared.route.rule_set, (s) => s.tag), [ "local-lists" ]);
    t.excludes(sprintf("%J", prepared.route.rules), "remote-lists");
    t.excludes(sprintf("%J", prepared.dns.rules), "remote-lists");
    t.contains(sprintf("%J", prepared.dns.rules), "example.org");
    t.eq([ prepared.experimental.clash_api, prepared.inbounds, prepared.experimental.cache_file.path ], [ null, [], "/tmp/check/cache.db" ]);
    t.eq(proxy_check.outbound_tag(prepared, "ip.podkop.fyi"), "proxy 1");
});

t.done();
