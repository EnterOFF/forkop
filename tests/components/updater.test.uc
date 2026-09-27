// components/updater.uc, which the component manager runs as a program: one
// mode per question, the answer on stdout and a refusal as a quiet exit 1.

let t = require("t");
let fs = require("fs");
let stub = require("stub");
let program = require("program");

function updater(args, stdin) {
    return program.run("components/updater.uc", args, { stdin });
}

function answer(args, stdin) {
    let result = updater(args, stdin);
    t.eq(result.status, 0, join(" ", args) + ": " + result.stderr);
    return trim(result.stdout);
}

// A usage error exits 1 too; a refusal is the one that says nothing.
function refused(args, stdin) {
    let result = updater(args, stdin);
    t.eq([ result.status, result.stderr ], [ 1, "" ], join(" ", args));
}

t.test("a job's state file is named after its id, and an id that leaves the directory is refused", () => {
    t.eq(answer([ "updates-job-state-path", "/tmp/jobs", "abc-1_2" ]), "/tmp/jobs/abc-1_2.json");
    refused([ "updates-job-state-path", "/tmp/jobs", "../bad" ]);
});

t.test("a version comparison names the status of the installed component", () => {
    t.eq(answer([ "updates-status-from-compare", "-1" ]), "outdated");
    t.eq(answer([ "updates-status-from-compare", "0" ]), "latest");
    t.eq(answer([ "updates-status-from-compare", "1" ]), "dev");
    refused([ "updates-status-from-compare", "invalid" ]);
});

t.test("a check result says what the status means", () => {
    t.eq(answer([ "updates-check-result-row", "component", "1.0", "1.0", "latest" ]),
        "Latest version is installed\tcomponent is up to date (1.0)");
    t.eq(answer([ "updates-check-result-row", "component", "1.0", "2.0", "outdated" ]),
        "Update is available\tcomponent update is available: 1.0 -> 2.0");
    t.eq(answer([ "updates-check-result-row", "component", "2.0", "1.0", "dev" ]),
        "Installed version is newer than release\tcomponent installed version is newer than upstream release: 2.0 -> 1.0");
    refused([ "updates-check-result-row", "component", "1.0", "2.0", "invalid" ]);
});

const SING_BOX_RELEASE = sprintf("%J", { assets: [
    { name: "sing-box-1.13.14-extended-2.5.3-f1-openwrt-aarch64_cortex-a53.ipk", browser_download_url: "https://example.com/normal.ipk" },
    { name: "sing-box-1.13.14-extended-2.5.3-f1-openwrt-aarch64_cortex-a53-compressed.ipk", browser_download_url: "https://example.com/compressed.ipk" },
    { name: "sing-box-1.13.14-extended-2.5.3-f1-openwrt-x86_64.ipk", browser_download_url: "https://example.com/wrong-arch.ipk" }
] });

t.test("a core package is picked by flavour and architecture, and the legacy package name is refused", () => {
    t.eq(answer([ "sing-box-forkop-package-asset-url", "sing-box-forkop", "aarch64_cortex-a53", "ipk" ], SING_BOX_RELEASE),
        "https://example.com/normal.ipk");
    t.eq(answer([ "sing-box-forkop-package-asset-url", "sing-box-forkop-compressed", "aarch64_cortex-a53", "ipk" ], SING_BOX_RELEASE),
        "https://example.com/compressed.ipk");
    refused([ "sing-box-forkop-package-asset-url", "sing-box-extended", "aarch64_cortex-a53", "ipk" ], SING_BOX_RELEASE);
});

function forkop_release(assets) {
    return sprintf("%J", { tag_name: "1.2.3", html_url: "https://example.com/release", assets: map(assets,
        (name) => ({ name: name + "_1.2.3.ipk", browser_download_url: "https://example.com/" + name + ".ipk" })) });
}

t.test("a Forkop release plan lists the packages to install, the translation only when asked for", () => {
    let release = forkop_release([ "forkop", "luci-app-forkop", "luci-i18n-forkop-ru" ]);
    t.eq(answer([ "forkop-release-plan", "1.2.3", "ipk", "1" ], release), join("\t", [
        "https://example.com/release",
        "forkop_1.2.3.ipk", "https://example.com/forkop.ipk",
        "luci-app-forkop_1.2.3.ipk", "https://example.com/luci-app-forkop.ipk",
        "luci-i18n-forkop-ru_1.2.3.ipk", "https://example.com/luci-i18n-forkop-ru.ipk"
    ]));
    t.eq(updater([ "forkop-release-plan", "1.2.3", "ipk", "0" ], release).stdout, join("\t", [
        "https://example.com/release",
        "forkop_1.2.3.ipk", "https://example.com/forkop.ipk",
        "luci-app-forkop_1.2.3.ipk", "https://example.com/luci-app-forkop.ipk", "", ""
    ]) + "\n");
    refused([ "forkop-release-plan", "9.9.9", "ipk", "0" ], release);
    refused([ "forkop-release-plan", "1.2.3", "ipk", "1" ], forkop_release([ "forkop", "luci-app-forkop" ]));
});

t.test("a Forkop release version has three numeric parts and compares by them", () => {
    t.eq(updater([ "forkop-release-version-valid", "1.2.3" ]).status, 0);
    for (let version in [ "v1.2.3", "1.2", "1.2.3.4", "1.2.3-1", "1.2.3-r1" ])
        refused([ "forkop-release-version-valid", version ]);
    t.eq(answer([ "forkop-release-version-compare", "1.2.3", "1.2.4" ]), "-1");
});

t.test("a core version is read from the binary's banner and from the package manager's spelling", () => {
    t.eq(answer([ "stdin-first-line-last-field" ], "sing-box version 1.13.14-extended-2.5.0\n\nEnvironment: go1.26.4 linux/amd64\n"),
        "1.13.14-extended-2.5.0");
    t.eq(answer([ "updates-normalize-sing-box-version", "1.13.14~extended~2.5.3~f1" ]), "1.13.14-extended-2.5.3-f1");
});

function job_state(state) {
    let path = stub.tmpdir() + "/job.json";
    fs.writefile(path, sprintf("%J\n", state));
    return path;
}

// A job whose worker died without finishing is found by its pid, after a grace
// that covers the worker still starting up.
t.test("a running job is looked up by its pid, and one without a pid goes stale after the grace", () => {
    let running = job_state({ running: true, pid: "123", started_at: 100 });
    t.eq(answer([ "updates-job-refresh-plan", running, "105", "15" ]), "pid\t123\t0");
    t.eq(answer([ "updates-job-refresh-plan", running, "120", "15" ]), "pid\t123\t1");

    let no_pid = job_state({ running: true, pid: "", started_at: 100 });
    t.eq(answer([ "updates-job-refresh-plan", no_pid, "105", "15" ]), "skip");
    t.eq(answer([ "updates-job-refresh-plan", no_pid, "120", "15" ]), "stale");

    t.eq(answer([ "updates-job-refresh-plan", job_state({ running: false, pid: "123", started_at: 100 }), "120", "15" ]), "skip");

    let stale = json(answer([ "updates-mark-stale-job-state", no_pid ]));
    t.eq([ stale.running, stale.success, stale.exit_code ], [ false, false, null ]);
});

t.done();
