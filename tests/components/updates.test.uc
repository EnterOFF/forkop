// components/updates.uc, which owns the update check schedule, reports check
// results to the state service and runs a component action as a background
// job. It runs as a program; the fakes below stand in for the modules and
// commands it reaches.

let t = require("t");
let fs = require("fs");
let stub = require("stub");
let program = require("program");

function updates(args, options) {
    return program.run("components/updates.uc", args, options);
}

function answer(args) {
    let result = updates(args);
    t.eq(result.status, 0, join(" ", args) + ": " + result.stderr);
    return trim(result.stdout);
}

function write(path, text) {
    stub.real.system("mkdir -p '" + replace(path, /\/[^\/]*$/, "") + "'");
    fs.writefile(path, text);
}

function write_json(path, value) {
    write(path, sprintf("%J\n", value));
    return path;
}

/* ------------------------------------------------------------- the schedule */

t.test("a check interval is read as a duration", () => {
    t.eq(answer([ "duration-to-seconds", "3m" ]), "180");
    t.eq(answer([ "duration-to-seconds", "1.5h" ]), "5400");
    t.eq([ updates([ "duration-to-seconds", "invalid" ]).status, updates([ "duration-to-seconds", "invalid" ]).stderr ], [ 1, "" ]);
});

// Cron is the schedule and nothing else remembers when a check last ran, so an
// interval cron cannot say exactly gets no line at all.
t.test("an interval becomes the cron line that means exactly it, or none", () => {
    for (let entry in [
        [ "60", "* * * * *" ], [ "300", "*/5 * * * *" ], [ "3600", "0 * * * *" ],
        [ "7200", "0 */2 * * *" ], [ "86400", "0 0 * * *" ],
        [ "172800", "" ], [ "90", "" ], [ "5400", "" ]
    ])
        t.eq(answer([ "due-check-cron-schedule", entry[0] ]), entry[1], entry[0] + " seconds");
});

function settings_fixture(interval) {
    return write_json(stub.tmpdir() + "/settings.json", {
        settings: { component_update_check_enabled: "1", component_update_check_interval: interval }
    });
}

t.test("the cron plan names the component job at the configured interval", () => {
    t.eq(answer([ "cron-refresh-plan-fixture", settings_fixture("2h"), "/usr/bin/forkop", "# component" ]),
        "component\t0 */2 * * * /usr/bin/forkop component_updates_if_due # component");
});

t.test("refreshing the crontab replaces Forkop's job and keeps everything else", () => {
    let crontab = stub.tmpdir() + "/crontab";
    write(crontab, "0 1 * * * /bin/true # keep\n* * * * * /usr/bin/forkop component_updates_if_due # component\n");

    let applied = json(answer([ "refresh-cron-fixture", settings_fixture("2h"), crontab, "/usr/bin/forkop", "# component" ]));
    t.eq(applied.crontab, "0 1 * * * /bin/true # keep\n0 */2 * * * /usr/bin/forkop component_updates_if_due # component\n");
    t.ok(length(filter(applied.logs, (entry) => index(entry.message, "component update check cron job has been created") >= 0)) > 0);

    let invalid = updates([ "refresh-cron-fixture", settings_fixture("bad"), crontab, "/usr/bin/forkop", "# component" ]);
    t.eq(invalid.status, 1);
    let result = json(invalid.stdout);
    t.eq(result.crontab, "0 1 * * * /bin/true # keep\n", "only Forkop's job is removed");
    t.ok(length(filter(result.logs, (entry) => entry.level == "error" &&
        entry.message == "Invalid component_update_check_interval value: bad")) > 0);
});

/* ------------------------------------------------------------ check results */

// A component manager with a fake check, a fake state service behind `ubus`
// that keeps what it is told in a file, and settings read from the environment.
function component_manager() {
    let dir = stub.tmpdir();
    let lib = dir + "/lib";
    write(lib + "/core/uci.uc", "return {\n" +
        "    get_all: (config, section) => section == \"settings\" ? {\n" +
        "        component_update_check_enabled: getenv(\"TEST_CHECKS_ENABLED\"),\n" +
        "        component_update_check_interval: \"1d\"\n" +
        "    } : {},\n" +
        "    section_objects: () => []\n" +
        "};\n");
    write(lib + "/components/action.uc", "print(sprintf(\"%J\\n\", {\n" +
        "    success: true, component: ARGV[1], action: ARGV[2], message: \"Update is available\",\n" +
        "    current_version: \"1.0.0\", latest_version: \"1.1.0\", release_url: \"https://example.com/release\",\n" +
        "    changed: 0, status: \"outdated\"\n" +
        "}));\n");
    write(lib + "/service/state.uc", "exit(0);\n");
    for (let module in [ "core/common.uc", "core/url.uc", "components/updates.uc" ])
        stub.real.system("ln -s '" + program.LIBRARY + "/" + module + "' '" + lib + "/" + module + "'");

    write(dir + "/bin/ubus", "#!/usr/bin/env ucode\n" +
        "let fs = require(\"fs\");\n" +
        "let path = getenv(\"FAKE_UBUS_STORE\");\n" +
        "let entries = json(fs.readfile(path) ?? \"{}\");\n" +
        "let method = ARGV[2];\n" +
        "if (method == \"report_update_check\") {\n" +
        "    let args = json(ARGV[3]);\n" +
        "    entries[args.component] = json(args.result);\n" +
        "    fs.writefile(path, sprintf(\"%J\", entries));\n" +
        "    print(\"{ \\\"stored\\\": true }\\n\");\n" +
        "}\n" +
        "else if (method == \"update_checks\")\n" +
        "    print(sprintf(\"%J\\n\", { results: values(entries) }));\n" +
        "else if (method == \"forget_update_checks\") {\n" +
        "    fs.writefile(path, \"{}\");\n" +
        "    print(\"{ \\\"forgotten\\\": true }\\n\");\n" +
        "}\n" +
        "else\n" +
        "    exit(1);\n");
    stub.real.system("chmod +x '" + dir + "/bin/ubus'");

    let store = dir + "/store.json";
    let run = (args, enabled) => updates(args, {
        lib: [ lib ],
        path: [ dir + "/bin" ],
        env: {
            FORKOP_LIB: lib,
            FORKOP_RUNTIME_STATE_DIR: dir + "/run",
            UPDATES_JOB_DIR: dir + "/jobs",
            FAKE_UBUS_STORE: store,
            TEST_CHECKS_ENABLED: enabled === false ? "0" : "1"
        }
    });
    return {
        dir,
        run,
        stored: () => json(fs.readfile(store) ?? "{}"),
        forget: () => fs.writefile(store, "{}")
    };
}

t.test("a manual check is reported to the state service only while automatic checks are on", () => {
    let manager = component_manager();
    let job = manager.dir + "/jobs/manual";
    stub.real.system("mkdir -p '" + manager.dir + "/jobs'");

    t.eq(manager.run([ "component-action-worker", job + ".json", job + ".out", "sing_box", "check_update" ]).status, 0);
    t.eq(manager.stored().sing_box?.latest_version, "1.1.0");

    let cache = json(manager.run([ "component-update-check-cache" ]).stdout);
    t.eq([ cache.enabled, length(cache.results), cache.results[0].component, cache.results[0].status ],
        [ true, 1, "sing_box", "outdated" ]);

    manager.forget();
    manager.run([ "component-action-worker", job + ".json", job + ".out", "sing_box", "check_update" ], false);
    t.eq(manager.stored(), {});
});

t.test("the scheduled check reports the Forkop result", () => {
    let manager = component_manager();
    t.eq(manager.run([ "component-updates-if-due" ]).status, 0);
    t.eq(manager.stored().forkop?.status, "outdated");
});

/* -------------------------------------------------------- background jobs */

function job_status(manager, job_id) {
    for (let attempt = 0; attempt < 50; attempt++) {
        let status = json(manager.run([ "component-action-status", job_id ]).stdout);
        if (status.running === false)
            return status;
        sleep(100);
    }
    t.fail("the job did not finish");
}

t.test("a component action runs as a job whose status reads back what the action answered", () => {
    let manager = component_manager();
    write(manager.dir + "/lib/components/action.uc",
        "printf('{\"success\":true,\"kind\":\"component\",\"component\":\"%s\",\"action\":\"%s\",\"message\":\"done\",\"current_version\":\"1.0\",\"latest_version\":\"1.0\",\"changed\":0,\"status\":\"latest\"}\\n', ARGV[1], ARGV[2]);\n");

    for (let component in [ "sing_box", "sing-box" ]) {
        let started = json(manager.run([ "component-action-async", component, "check_update" ]).stdout);
        t.ok(started.success && started.job_id, component + " started");
        let status = job_status(manager, started.job_id);
        t.eq([ status.success, status.component, status.action, status.message, status.exit_code ],
            [ true, "sing_box", "check_update", "done", 0 ], component);
    }
});

t.done();
