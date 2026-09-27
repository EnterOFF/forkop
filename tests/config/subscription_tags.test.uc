let t = require("t");
let fixture = require("fixture");
let connections = require("config.connections");

// The provider a subscription becomes is named by this tag, and the Dashboard
// (fe-app-forkop/src/helpers/subscriptionTags.ts) finds it by the same rule.
function tags(stored) {
    let sources = [];
    for (let i = 0; i < length(stored); i++) {
        let source = { ".name": "source" + i, "section": "proxy", "url": "https://example.com/" + i };
        if (stored[i] != null)
            source.tag = stored[i];
        push(sources, source);
    }
    fixture.seed({
        section: [ { ".name": "proxy", "enabled": "1", "action": "connection" } ],
        subscription_url: sources
    });
    connections.load();
    return connections.subscription_tags({ ".name": "proxy", ".type": "section" });
}

t.test("a stored tag names the subscription", () => {
    t.eq(tags([ "main", " spare " ]), [ "main", "spare" ]);
});

t.test("an untagged subscription is named by its position", () => {
    t.eq(tags([ null, null, null ]), [ "sub1", "sub2", "sub3" ]);
});

t.test("a position another subscription is tagged with is skipped", () => {
    t.eq(tags([ null, "sub1" ]), [ "sub2", "sub1" ]);
    t.eq(tags([ "sub2", null, null ]), [ "sub2", "sub3", "sub4" ]);
});

t.done();
