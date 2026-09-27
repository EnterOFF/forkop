let t = require("t");
let program = require("program");
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

// The component manager runs the module and reads the answer from its exit
// status. A usage error exits 1 as well, so a quiet 1 is what tells "no" apart.
t.test("run as a program, it answers with its status, and with its usage only for an unknown mode", () => {
    let answer = (args) => {
        let result = program.run("core/version.uc", args);
        return [ result.status, result.stderr ];
    };
    t.eq(answer([ "version-at-least", "1.12.10", "1.12.4" ]), [ 0, "" ]);
    t.eq(answer([ "version-at-least", "1.12.3", "1.12.4" ]), [ 1, "" ]);
    let unknown = answer([ "unknown-mode" ]);
    t.eq(unknown[0], 1);
    t.contains(unknown[1], "Usage");
});

t.done();
