let t = require("t");
let v = require("validation");

t.test("accepts untagged-subscriptions", () => {
    v.accepts({
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
                "url": "https://two.example/sub"
            }
        ]
    });
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
                "domain_suffix": [
                    "example.org"
                ]
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
                "domain_suffix": [
                    "example.org"
                ]
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

t.test("a stored tag may take the name another subscription's position would get", () => {
    v.accepts({
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
                "tag": "sub1"
            }
        ]
    });
});

t.done();
