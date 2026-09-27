let t = require("t");
let version = require("core.version");

// The validator and the Status tab compare the installed core with
// SB_REQUIRED_VERSION through this, and a core of the Extended line carries its
// own suffix after the upstream version.
t.test("a version is at least the one it is compared with", () => {
    for (let pair in [
        [ "1.12.4", "1.12.4" ],
        [ "1.12.10", "1.12.4" ],
        [ "1.13.18-extended-2.6.5-f39", "1.13.18-extended-2.6.5" ],
        // Leading zeroes are numeric noise.
        [ "1.012.4", "1.12.4" ]
    ])
        t.eq(version.version_at_least(pair[0], pair[1]), true, pair[0] + " >= " + pair[1]);
});

t.test("an older version is not", () => {
    for (let pair in [
        [ "1.12.3", "1.12.4" ],
        [ "1.9.0", "1.12.4" ],
        [ "1.13.18", "1.13.18-extended-2.6.5" ],
        // "~" sorts before an empty segment.
        [ "1.12.4~rc1", "1.12.4" ]
    ])
        t.eq(version.version_at_least(pair[0], pair[1]), false, pair[0] + " < " + pair[1]);
});

t.done();
