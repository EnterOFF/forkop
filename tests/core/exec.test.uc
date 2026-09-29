let t = require("t");
let stub = require("stub");
let exec = require("core.exec");

t.test("arguments reach the command exactly, whatever they contain", () => {
    stub.commands([ [ () => true, { status: 0 } ] ]);
    exec.run([ "logger", "it's", "a; rm -rf /", "$(id)" ]);
    t.eq(stub.calls()[0].argv, [ "logger", "it's", "a; rm -rf /", "$(id)" ]);
    stub.restore();
});

t.test("status discards output and reports the exit code", () => {
    stub.commands([ [ "false", { status: 1 } ] ]);
    t.eq(exec.status([ "false" ]), 1);
    t.ok(!exec.ok([ "false" ]));
    t.contains(stub.calls()[0].command, ">/dev/null 2>&1");
    stub.restore();
});

t.test("output is the stdout of a command that succeeded, null otherwise", () => {
    stub.commands([
        [ "ip -4 rule", { status: 0, stdout: "105:\tfrom all\n" } ],
        [ "nft list", { status: 1, stdout: "partial" } ]
    ]);
    t.eq(exec.output([ "ip", "-4", "rule" ]), "105:\tfrom all\n");
    t.eq(exec.output([ "nft", "list" ]), null);
    t.eq(exec.capture([ "nft", "list" ]), { status: 1, stdout: "partial" });
    stub.restore();
});

t.test("feed hands the text to the command's stdin", () => {
    stub.commands([ [ "nft -f -", { status: 0 } ] ]);
    t.eq(exec.feed([ "nft", "-f", "-" ], "add table inet t\n").status, 0);
    t.eq(stub.calls()[0].stdin, "add table inet t\n");
    stub.restore();
});

t.test("a background child is detached from the procd lock descriptor", () => {
    stub.commands([ [ () => true, { status: 0 } ] ]);
    exec.background([ "/etc/init.d/forkop", "reload", "pending" ]);
    t.contains(stub.calls()[0].command, "1000>&- &");
    stub.restore();
});

t.test("log tags the message with its level and gives syslog the matching priority", () => {
    stub.commands([ [ () => true, { status: 0 } ] ]);
    exec.log("warn", "sing-box is slow");
    exec.log("error", "sing-box is gone");
    exec.log("info", "sing-box is back");
    t.eq(stub.command_lines(), [
        "logger -t forkop -p user.warning [warn] sing-box is slow",
        "logger -t forkop -p user.err [error] sing-box is gone",
        "logger -t forkop -p user.info [info] sing-box is back"
    ]);
    stub.restore();
});

t.done();
