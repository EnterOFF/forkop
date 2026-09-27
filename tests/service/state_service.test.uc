let t = require("t");
let stub = require("stub");
let fs = require("fs");

function fresh_service() {
    return stub.fresh("service.state_service");
}

function wait(service, cursor) {
    let deferred = false;
    let request = { args: { cursor }, defer: () => { deferred = true; } };
    stub.commands([ [ "logread", { stdout: "" } ] ]);
    let reply = service.object_methods().logs_wait.call(request);
    stub.restore();
    return { reply, deferred };
}

// A quiet router has no line yet, and a page that has seen everything waits
// for the next one instead of asking again at once, round after round.
t.test("a reader that has seen every line waits, however few lines there are", () => {
    let service = fresh_service();
    t.eq(wait(service, 0), { reply: null, deferred: true }, "no line yet and nothing seen");

    service.remember_log_line("forkop: first");
    t.eq(wait(service, 1), { reply: null, deferred: true });
});

t.test("a reader behind is answered at once, and one ahead of a restarted service resumes from its cursor", () => {
    let service = fresh_service();
    service.remember_log_line("forkop: first");
    service.remember_log_line("forkop: second");
    t.eq(wait(service, 1), { reply: { cursor: 2, lines: [ "forkop: second" ] }, deferred: false });
    t.eq(wait(service, 40), { reply: { cursor: 2, lines: [] }, deferred: false }, "a cursor from before the restart");
});

// Matching the last line already held is what survives unrelated entries
// arriving between two reads; counting would drift on a busy router.
t.test("the new lines of a tail are the ones after the last line already held", () => {
    let cases = [
        [ [ "a", "b" ], [ "a", "b", "c" ], [ "c" ], "only the lines after the held ones" ],
        [ [ "a", "b" ], [ "a", "b" ], [], "an unchanged tail" ],
        [ [], [ "x", "y" ], [ "x", "y" ], "a first read" ],
        [ [ "a", "b" ], [ "p", "q" ], [ "p", "q" ], "a tail that scrolled past everything held" ],
        [ [ "a", "b" ], [ "b", "a", "b", "z" ], [ "z" ], "a repeated line anchors at its last occurrence" ]
    ];
    for (let entry in cases) {
        let service = fresh_service();
        for (let line in entry[0])
            service.remember_log_line(line);
        t.eq(service.new_log_lines(entry[1]), entry[2], entry[3]);
    }
});

t.test("a change opens or moves the settle window and no change leaves it", () => {
    let service = fresh_service();
    t.eq(service.settle_deadline(0, true, 0), 10000);
    t.eq(service.settle_deadline(5000, true, 10000), 15000);
    t.eq(service.settle_deadline(5000, false, 10000), 10000);
});

t.test("the runtime is read closely while an action runs and while it settles, and no faster than the cadence", () => {
    let service = fresh_service();
    t.ok(service.needs_close_refresh(5000, true, 0, 0), "a running action");
    t.ok(!service.needs_close_refresh(500, true, 0, 0), "a running action read too soon");
    t.ok(service.needs_close_refresh(5000, false, 10000, 0), "a settling runtime after the action ended");
    t.ok(!service.needs_close_refresh(5000, false, 10000, 4500), "a settling runtime read too soon");
    t.ok(!service.needs_close_refresh(20000, false, 10000, 0), "a settled runtime is left to the sweep");
});

// A port rebind is not an outage: a running service seen down while its
// sing-box process lives stays reported running until the flip outlasts the
// grace.
t.test("a service seen down while its process lives is believed only after the grace", () => {
    let service = fresh_service();
    let settled = (observed, alive, previous, down_since, now) => {
        let result = service.settled_running(observed, alive, previous, down_since, now, 15000);
        return [ result.running, result.down_since_ms ];
    };
    t.eq(settled(true, true, true, 0, 1000), [ true, 0 ], "seen running");
    t.eq(settled(true, true, false, 500, 1000), [ true, 0 ], "back up clears the pending flip");
    t.eq(settled(false, true, true, 0, 1000), [ true, 1000 ], "a first down look opens the grace");
    t.eq(settled(false, true, true, 1000, 9000), [ true, 1000 ], "held while the grace lasts");
    t.eq(settled(false, true, true, 1000, 16000), [ false, 1000 ], "believed once it outlasts the grace");
    t.eq(settled(false, false, true, 0, 1000), [ false, 0 ], "a dead process is down at once");
    t.eq(settled(false, true, false, 0, 1000), [ false, 0 ], "a service already down stays down");
});

t.test("an update check is served back until the installed packages change", () => {
    let db = stub.tmpdir() + "/status";
    fs.writefile(db, "one");
    stub.env({ FORKOP_OPKG_STATUS_FILE: db, FORKOP_APK_DB_FILE: db + ".absent" });
    let service = fresh_service();
    stub.restore();

    service.store_update_check("zapret", { component: "zapret", status: "outdated" });
    t.eq(service.update_check_results(), [ { component: "zapret", status: "outdated" } ]);

    fs.writefile(db, "two, and a good deal more of it");
    t.eq(service.update_check_results(), []);
});

// The page builds its forms from what the core can do before it renders, so the
// state it asks for first has to carry it.
t.test("the state carries what the installed core was built with", () => {
    let features = require("singbox.features");
    features.paths.binary = stub.tmpdir() + "/sing-box";
    fs.writefile(features.paths.binary, "#!/bin/sh\n");
    let service = fresh_service();
    stub.commands([ [ features.paths.binary + " version",
        { status: 0, stdout: "sing-box version 1.14.1-extended-2.7.2-f125\n\nTags: with_clash_api,with_quic\n" } ],
        [ () => true, { status: 1, stdout: "" } ] ]);
    let reply = service.object_methods().refresh.call({ args: {} });
    stub.restore();

    t.eq(reply.capabilities.core.known, true);
    t.eq(reply.capabilities.core.tags, [ "with_clash_api", "with_quic" ]);
    t.eq(reply.capabilities.core.features.quic.available, true);
    t.eq(reply.capabilities.core.features.wireguard.available, false);
});

t.done();
