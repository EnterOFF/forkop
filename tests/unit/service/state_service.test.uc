let t = require("t");
let stub = require("stub");
let state_service = require("service.state_service");

function wait(cursor) {
    let deferred = false;
    let request = { args: { cursor }, defer: () => { deferred = true; } };
    stub.commands([ [ "logread", { stdout: "" } ] ]);
    let reply = state_service.object_methods().logs_wait.call(request);
    stub.restore();
    return { reply, deferred };
}

// A quiet router has no line yet, and a page that has seen everything waits
// for the next one instead of asking again at once, round after round.
t.test("a reader that has seen every line waits, however few lines there are", () => {
    t.eq(wait(0), { reply: null, deferred: true }, "no line yet and nothing seen");

    state_service.remember_log_line("forkop: first");
    t.eq(wait(1), { reply: null, deferred: true });
});

t.test("a reader behind is answered at once, and one ahead of a restarted service resumes from its cursor", () => {
    state_service.remember_log_line("forkop: second");
    t.eq(wait(1), { reply: { cursor: 2, lines: [ "forkop: second" ] }, deferred: false });
    t.eq(wait(40), { reply: { cursor: 2, lines: [] }, deferred: false }, "a cursor from before the restart");
});

t.done();
