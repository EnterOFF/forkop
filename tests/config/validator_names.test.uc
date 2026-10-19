let t = require("t");
let v = require("validation");
let fixture = require("fixture");

t.test("untagged-subscription", () => {
    v.refuses({
        "settings": {
            "dns_server": [
                "77.88.8.8"
            ],
            "bootstrap_dns_server": [
                "77.88.8.8"
            ]
        },
        "section": [
            {
                ".name": "proxy",
                "label": "Main",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "subscription_url": [
            {
                ".name": "one",
                "section": "proxy",
                "url": "https://one.example/sub"
            },
            {
                ".name": "two",
                "section": "proxy",
                "url": "https://two.example/sub",
                "tag": "sub2"
            }
        ]
    }, "A subscription in section 'Main' has no tag");
});

t.test("every link of a section has a link and a name of its own", () => {
    let main = [ { ".name": "proxy", label: "Main", enabled: "1", action: "connection" } ];
    let links = fixture.links("proxy", [ "socks5://127.0.0.1:1080#A", "socks5://127.0.0.1:1081#B" ]);
    v.accepts({ section: main, connection_link: links });
    v.refuses({ section: main, connection_link: [ links[0], { ...links[1], name: "A" } ] }, "Section 'Main' has more than one link named 'A'");
    v.refuses({ section: main, connection_link: [ links[0], { ...links[1], name: " " } ] }, "A link in section 'Main' has no name");
    v.refuses({ section: main, connection_link: [ links[0], { ...links[1], uri: "" } ] }, "A link in section 'Main' is empty");
    v.accepts({ section: [ ...main, { ".name": "other", enabled: "1", action: "connection" } ],
        connection_link: [ ...links, { ...links[1], ".name": "other_link1", name: "A", section: "other" } ] });
});

t.test("a refusal names sections and servers by the labels the page shows, not by their ids", () => {
    v.refuses({
        section: [ { ".name": "section_70536a", label: "Streaming", enabled: "1", action: "connection",
             ports: [ "99999" ] } ],
        connection_link: fixture.links("section_70536a", [ "socks5://127.0.0.1:1080" ])
    }, "Invalid port condition '99999' in section 'Streaming'");
    v.refuses({
        section: [ { ".name": "section_70536a", label: "Streaming", enabled: "1", action: "connection" } ],
        connection_link: fixture.links("section_70536a", [ "socks5://127.0.0.1:1080" ]),
        server: [ { ".name": "server_75e023", label: "Server #1", enabled: "1", protocol: "mixed", listen_port: "18080", routing_mode: "section", routing_section: "section_1f2e3d" } ]
    }, "Server 'Server #1' points to section 'section_1f2e3d', which does not exist");
});

t.test("duplicate-json-tags", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "connection",
                "outbound_jsons": [
                    "{\"type\":\"direct\",\"tag\":\"same\"}",
                    "{\"type\":\"direct\",\"tag\":\"same\"}"
                ],
                "destinations": "example.org"
            }
        ]
    }, "duplicate JSON outbound tag 'same'");
});

t.test("tagless-json", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "connection",
                "outbound_jsons": [
                    "{\"type\":\"direct\"}"
                ],
                "destinations": "example.org"
            }
        ]
    }, "JSON outbound without a non-empty tag");
});

t.test("duplicate-section-names", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "one",
                "label": "Office",
                "enabled": "0"
            },
            {
                ".name": "two",
                "label": "Office",
                "enabled": "0"
            }
        ]
    }, "Duplicate section display name 'Office'");
});

t.test("slash-server-name", () => {
    v.refuses({
        "settings": {},
        "server": [
            {
                ".name": "server",
                "label": "Home/Server",
                "enabled": "0"
            }
        ]
    }, "Server display name 'Home/Server' contains '/'");
});

t.test("duplicate-subscription-tags", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "label": "Office",
                "enabled": "0"
            }
        ],
        "subscription_url": [
            {
                ".name": "one",
                "section": "proxy",
                "url": "https://one.example/sub",
                "tag": "premium"
            },
            {
                ".name": "two",
                "section": "proxy",
                "url": "https://two.example/sub",
                "tag": "premium"
            }
        ]
    }, "Duplicate subscription tag 'premium'");
});

t.test("cross-namespace-display-name", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "label": "Shared",
                "enabled": "0"
            }
        ],
        "server": [
            {
                ".name": "server",
                "label": "Shared",
                "enabled": "0"
            }
        ]
    }, "Duplicate server display name 'Shared'");
});

t.done();
