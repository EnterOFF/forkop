let t = require("t");
let rulesets = require("singbox.rulesets");

t.test("a list is named for its section and a reference for itself, stably", () => {
    t.ok(rulesets.is_community("youtube"));
    t.ok(!rulesets.is_community("unknown_service"));
    t.eq(rulesets.community_tag("proxy", "discord"), "proxy-discord-community-ruleset");
    t.eq(rulesets.custom_reference_tag("https://example.com/rules.srs"), "inline-custom-ea6fa9f2951d-ruleset");
    t.eq(rulesets.custom_reference_tag("https://example.com/mixed.txt"), "inline-custom-11ae9de91dfd-ruleset");
    t.eq(rulesets.custom_reference_tag("youtube"), "builtin-youtube-ruleset");
});

t.done();
