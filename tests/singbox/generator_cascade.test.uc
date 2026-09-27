let t = require("t");
let fixture = require("fixture");
let q = require("sbconfig");
let generator = require("singbox.generator");

t.test("a section cascade reaches its links and subscriptions, not its interfaces or plain JSON outbounds", () => {
    fixture.seed({
        settings: { dns_server: "1.1.1.1", service_listen_address: "127.0.0.1" },
        section: [
            { ".name": "hop", enabled: "1", action: "connection", selector_proxy_links: [ "socks5://127.0.0.1:1080#Hop" ] },
            {
                ".name": "source", enabled: "1", action: "connection",
                selector_proxy_links: [ "socks5://127.0.0.1:1081#Manual" ],
                outbound_jsons: [
                    "{\"type\":\"socks\",\"tag\":\"JSON plain\",\"server\":\"127.0.0.1\",\"server_port\":1082,\"version\":\"5\"}",
                    "{\"type\":\"socks\",\"tag\":\"JSON explicit\",\"server\":\"127.0.0.1\",\"server_port\":1083,\"version\":\"5\",\"detour\":\"direct-out\"}"
                ],
                outbound_detour_enabled: "1", outbound_detour_section: "hop"
            }
        ],
        subscription_url: [ { ".name": "source_subscription", section: "source", url: "https://subscription.example/source", tag: "sub1" } ],
        section_interface: [ { ".name": "source_wg0", section: "source", name: "wg0" } ]
    });
    let config = generator.build({ service_address: "127.0.0.1" });
    t.eq(q.outbound(config, "source/Manual").type, "parser");
    t.eq(q.outbound(config, "source/Manual").detour, "hop");
    t.eq(q.provider(config, "source/sub1").override.detour, "hop");
    t.eq(q.outbound(config, "source/wg0").bind_interface, "wg0");
    t.eq(q.outbound(config, "source/wg0").detour, null, "an interface is left out of the cascade");
    t.eq(q.outbound(config, "source/JSON plain").detour, null, "a plain JSON outbound is left out of the cascade");
    t.eq(q.outbound(config, "source/JSON explicit").detour, "direct-out", "an explicit JSON detour is kept");
    t.eq(q.outbound(config, "source").detour, null, "the section selector gets no detour of its own");
});

t.done();
