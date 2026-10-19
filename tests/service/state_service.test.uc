let t = require("t");
let stub = require("stub");
let fs = require("fs");
let ubus = require("ubus");
let uloop = require("uloop");
let ui = require("service.ui");
let health = require("service.health");
let features = require("singbox.features");

function fresh_service() {
    return stub.fresh("service.state_service");
}

// The runtime a running service reads, how many times it read it, and how
// many times it read the log.
let runtime = { running: 1, reads: 0, on_read: null, log_reads: 0 };

function runtime_state() {
    runtime.reads++;
    if (runtime.on_read != null)
        runtime.on_read();
    let running = runtime.running;
    return {
        service: {
            forkop: { running, enabled: 1, status: health.service_status_text(running, 1), busy: null },
            sing_box: { running, enabled: 1, status: health.service_status_text(running, 1) }
        },
        capabilities: {},
        actions: { service: [] }
    };
}

// Runs the service's loop over that runtime; `during` is what happens while
// the loop runs, handed the service.
function started(during) {
    let real = { state: ui.current_ui_state, running: health.sing_box_service_running, report: features.report };
    ui.current_ui_state = runtime_state;
    health.sing_box_service_running = () => runtime.running == 1;
    features.report = () => ({ known: true });
    ubus.__reset();
    uloop.__reset();
    runtime.reads = 0;
    runtime.log_reads = 0;
    let service = fresh_service();
    stub.commands([
        [ "/usr/bin/forkop get_system_info", { stdout: "{}" } ],
        [ "logread", () => ({ stdout: "forkop: line " + ++runtime.log_reads + "\n" }) ]
    ]);
    let looped = false;
    uloop.__on_run(() => {
        looped = true;
        if (during != null)
            during(service);
    });
    let status = service.run();
    stub.restore();
    ui.current_ui_state = real.state;
    health.sing_box_service_running = real.running;
    features.report = real.report;
    return { status, looped };
}

// procd stops the service with a SIGTERM and kills it five seconds later if it
// is still there. The two package scripts restart it a moment apart, so on an
// install that stop lands while the service is still reading its first state.
t.test("a stop that arrives while the service starts up ends it as soon as its loop runs", () => {
    runtime.on_read = () => uloop.__raise("SIGTERM");
    let result = started(null);
    runtime.on_read = null;
    t.eq(result, { status: 0, looped: false });
});

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

// A page's first log answer only places its feed: the lines held before it
// opened are history it never shows, and they were up to 400 lines a load.
t.test("the first log answer says where the log stands and carries none of it", () => {
    let service = fresh_service();
    service.remember_log_line("forkop: first");
    service.remember_log_line("forkop: second");
    stub.commands([ [ "logread", { stdout: "" } ] ]);
    let reply = service.object_methods().logs.call({ args: {} });
    stub.restore();
    t.eq(reply, { cursor: 2 });
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

// procd reports on every service of the router, and each report is a full read
// of the runtime: nft, iproute2 and a process spawn.
t.test("only procd's reports on sing-box make the service read the runtime again", () => {
    let reads = {};
    started((service) => {
        let before = runtime.reads;
        ubus.__notify("service", "instance.stop", { service: "dnsmasq", instance: "instance1" });
        ubus.__notify("service", "event.trigger", { type: "config.change", data: { package: "dhcp" } });
        reads.others = runtime.reads - before;
        ubus.__notify("service", "instance.stop", { service: "sing-box", instance: "instance1" });
        reads.sing_box = runtime.reads - before - reads.others;
    });
    t.eq(reads, { others: 0, sing_box: 1 });
});

t.test("the watch notices the autostart link the state reads", () => {
    let rc_dir = ui.paths.rc_dir;
    ui.paths.rc_dir = stub.tmpdir();
    let reads = null;
    started((service) => {
        let tick = filter(uloop.__timers(), (entry) => entry.kind == "interval")[0];
        tick.callback();
        let before = runtime.reads;
        fs.writefile(ui.paths.rc_dir + "/S99forkop", "");
        tick.callback();
        reads = runtime.reads - before;
    });
    ui.paths.rc_dir = rc_dir;
    t.eq(reads, 1);
});

// A request reads the log too, and a tick that took the read it had just made
// for its own was skipped, which left a new line waiting two intervals.
t.test("the log is read on every tick while it is watched, however recently a request read it", () => {
    let reads = null;
    started((service) => {
        ubus.__invoke("forkop", "logs", {});
        let before = runtime.log_reads;
        for (let entry in uloop.__timers())
            if (entry.kind == "interval" && entry.ms == service.LOG_POLL_MS)
                entry.callback();
        reads = runtime.log_reads - before;
    });
    t.eq(reads, 1);
});

// A page that has just saved asks for `refresh` rather than wait for the
// watch, and has to be answered from what it saved.
t.test("a refresh after the configuration changed reads the committed configuration", () => {
    let fixture = require("fixture");
    let uci = require("uci");
    let dir = stub.tmpdir();
    ui.paths.service_actions = dir + "/service-actions";
    ui.paths.reload_lock = dir + "/reload.lock";
    ui.paths.rc_dir = dir + "/rc.d";
    let real = {
        stable: health.forkop_stably_running,
        sing_box_stable: health.sing_box_service_stable,
        running: health.sing_box_service_running,
        report: features.report
    };
    health.forkop_stably_running = () => false;
    health.sing_box_service_stable = () => false;
    health.sing_box_service_running = () => false;
    features.report = () => ({ known: true });

    fixture.seed({ server: [ { ".name": "one", enabled: "1" } ] });
    let service = fresh_service();
    service.paths.config = dir + "/forkop";
    fs.writefile(service.paths.config, "one server");
    stub.commands([ [ "/usr/bin/forkop get_system_info", { stdout: "{}" } ] ]);
    let enabled = () => service.object_methods().refresh.call({ args: {} }).capabilities.server_inbounds_enabled_count;
    let counts = [ enabled() ];

    uci.__seed("forkop", [
        { ".type": "server", ".name": "one", enabled: "1" },
        { ".type": "server", ".name": "two", enabled: "1" }
    ]);
    fs.writefile(service.paths.config, "two servers, committed by another process");
    push(counts, enabled());

    stub.restore();
    health.forkop_stably_running = real.stable;
    health.sing_box_service_stable = real.sing_box_stable;
    health.sing_box_service_running = real.running;
    features.report = real.report;
    t.eq(counts, [ 1, 2 ]);
});

// An answer held until the package database had been quiet for a while was the
// version from before an install that had just ended.
t.test("the installed versions are read again as soon as the package database changes", () => {
    let db = stub.tmpdir() + "/installed";
    fs.writefile(db, "one");
    let service = fresh_service();
    service.paths.package_databases = [ db + ".absent", db ];
    let version = "1.0.0";
    stub.commands([ [ "/usr/bin/forkop get_system_info", () => ({ stdout: sprintf("%J", { sing_box_version: version }) }) ] ]);
    let asked = () => service.object_methods().system_info.call({ args: {} }).system_info.sing_box_version;
    t.eq(asked(), "1.0.0");
    version = "1.1.0";
    fs.writefile(db, "two, and a good deal more of it");
    t.eq(asked(), "1.1.0");
    stub.restore();
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
