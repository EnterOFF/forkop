let t = require("t");
let stub = require("stub");
let fixture = require("fixture");
let cli = require("service.cli");
let rulesets = require("singbox.rulesets");
let generator = require("singbox.generator");

t.test("a list is named for its section and a reference for itself, stably", () => {
    t.ok(rulesets.is_community("youtube"));
    t.ok(!rulesets.is_community("unknown_service"));
    t.eq(rulesets.community_tag("proxy", "discord"), "proxy-discord-community-ruleset");
    t.eq(rulesets.custom_reference_tag("https://example.com/rules.srs"), "inline-custom-ea6fa9f2951d-ruleset");
    t.eq(rulesets.custom_reference_tag("https://example.com/mixed.txt"), "inline-custom-11ae9de91dfd-ruleset");
    t.eq(rulesets.custom_reference_tag("youtube"), "builtin-youtube-ruleset");
});

function seed() {
    fixture.seed({
        settings: fixture.settings(),
        section: [
            { ".name": "proxy", enabled: "1", action: "connection", selector_proxy_links: [ "vless://u@a.example:443#A" ], community_lists: [ "telegram", "twitter" ], rule_set: [ "https://example.com/rules.srs" ] },
            { ".name": "direct", enabled: "1", action: "connection", selector_proxy_links: [ "vless://u@a.example:443#A" ], rule_set_with_subnets: [ "https://example.com/mixed.txt" ], rule_set: [ "https://example.com/rules.srs" ] },
            { ".name": "plain", enabled: "1", action: "connection", selector_proxy_links: [ "vless://u@a.example:443#A" ], domain_suffix: [ "example.org" ] }
        ]
    });
}

t.test("the dashboard is told each section's rule sets by the names the runtime registers", () => {
    seed();
    let result = stub.capture(() => cli.main([ "get_section_rule_sets" ], "/lib"));
    let map = json(result.stdout);
    t.eq(result.result, 0);
    t.eq(map, {
        proxy: [ "proxy-telegram-community-ruleset", "proxy-twitter-community-ruleset", "inline-custom-ea6fa9f2951d-ruleset" ],
        direct: [ "inline-custom-ea6fa9f2951d-ruleset", "inline-custom-11ae9de91dfd-ruleset" ]
    }, "a section without a rule set is left out, a shared reference is listed for each section naming it");

    let registered = {};
    for (let rule_set in generator.build({ service_address: "127.0.0.1" }).route.rule_set)
        registered[rule_set.tag] = true;
    for (let name, tags in map)
        for (let tag in tags)
            t.ok(registered[tag], name + ": " + tag + " is a rule set of the generated configuration");
});

t.done();
