let t = require("t");
let stub = require("stub");
let repo = require("repo");
let fs = require("fs");
let uci = require("uci");
let migration = require("config.migration");
let v2 = require("config.migrations.v2_0_0");

const DEFAULT_CONFIG = repo.path("forkop/files/etc/config/forkop");
const RELEASED_CONFIG = "config settings 'settings'\n\toption config_version '1.0.5'\n";

let saved_leftovers = v2.paths.leftovers;

// A router whose /etc/config/forkop holds `file`, parsed into `sections`; `commands` adds
// handlers ahead of the ones every run needs.
function router(file, sections, commands) {
    let dir = stub.tmpdir();
    let config = dir + "/forkop";
    if (file != null)
        fs.writefile(config, file);
    uci.__reset();
    if (sections != null)
        uci.__seed("forkop", sections);
    migration.paths.config = config;
    migration.paths.default_config = DEFAULT_CONFIG;
    migration.paths.internal_change = dir + "/internal-change";
    v2.paths.leftovers = [];

    let logs = [];
    stub.commands([
        ...(commands ?? []),
        stub.logger(logs),
        [ /md5sum/, { stdout: "0123456789abcdef0123456789abcdef  -\n" } ],
        [ "sh -c crontab -l 2>/dev/null", { stdout: "" } ],
        [ "rm -rf", {} ]
    ]);
    return { dir, config, logs };
}

function migrate(setup, mode) {
    let run = stub.capture(() => migration.main(mode ?? [ "migrate" ]));
    let commands = stub.command_lines();
    stub.restore();
    v2.paths.leftovers = saved_leftovers;
    return { status: run.result, stdout: run.stdout, stderr: run.stderr, logs: setup.logs, commands };
}

function kept_aside(setup) {
    return filter(fs.lsdir(setup.dir), (name) => substr(name, 0, 7) == "forkop.");
}

function server_sections() {
    return [
        { ".name": "settings", ".type": "settings", config_version: "1.0.5", applied_migrations: [ "http_connection_urls" ] },
        { ".name": "main", ".type": "section", action: "connection", selector_proxy_links: [ "vless://u@a.example:443#A" ] },
        { ".name": "inbound", ".type": "server", label: "VLESS", protocol: "vless", server_uuid: "44444444-4444-4444-8444-444444444444" },
        { ".name": "mt", ".type": "server", label: "MT", protocol: "mtproto" }
    ];
}

t.test("a released configuration is migrated through UCI and the original is kept beside it", () => {
    let setup = router(RELEASED_CONFIG, server_sections());
    let run = migrate(setup);
    t.eq(run.status, 0, run.stderr);
    t.eq(uci.__commits(), [ "forkop" ]);

    let sections = uci.__sections("forkop");
    let settings = filter(sections, (section) => section[".type"] == "settings")[0];
    t.eq([ settings.config_version, settings.applied_migrations ], [ "2.0.0", null ]);
    let client = filter(sections, (section) => section[".type"] == "server_client")[0];
    t.eq([ client.server, client.uuid, client[".anonymous"] ], [ "inbound", "44444444-4444-4444-8444-444444444444", true ]);
    let link = filter(sections, (section) => section[".type"] == "connection_link")[0];
    t.eq([ link.section, link.name, link[".anonymous"] ], [ "main", "A", true ]);
    t.matches(link[".name"], /^cfg[0-9a-f]+$/, "a placeholder never reaches UCI");
    t.eq(filter(sections, (section) => section[".name"] == "mt"), []);

    let aside = kept_aside(setup);
    t.eq(length(aside), 1);
    t.matches(aside[0], /^forkop\.1\.0\.5-[0-9]{8}-[0-9]{6}$/);
    t.eq(fs.readfile(setup.dir + "/" + aside[0]), RELEASED_CONFIG);
    t.eq(run.logs, [
        "[info] Migrated the configuration from 1.0.5 to 2.0.0; the previous one is saved as " + setup.dir + "/" + aside[0],
        "[warn] Removed the MTProto server 'MT': Forkop no longer serves MTProto"
    ]);
    t.contains(run.stderr, "[warn] Removed the MTProto server 'MT'", "the installer's terminal sees the same lines");
    t.contains(run.commands, "rm -rf /etc/forkop/server-certs/", "issued certificates go once their configuration is committed");
    t.ok(fs.stat(setup.dir + "/internal-change") != null, "the reload its own commit triggers is skipped");
});

t.test("a second run finds the configuration current and changes nothing", () => {
    let setup = router(RELEASED_CONFIG, server_sections());
    migrate(setup);
    let migrated = uci.__sections("forkop");

    // Seeding by name turns the anonymous sections into named ones of the same name.
    let reseeded = map(migrated, (section) => ({ ...section, ".anonymous": false }));
    let again = router("migrated", migrated);
    let run = migrate(again);
    t.eq([ run.status, uci.__commits(), run.logs, kept_aside(again) ], [ 0, [], [], [] ]);
    t.eq(uci.__sections("forkop"), reseeded);
});

t.test("a configuration without a migratable version is kept aside and replaced by the defaults, with one warning", () => {
    let cases = [
        [ [ { ".name": "settings", ".type": "settings", config_version: "1.0.1" } ], "1.0.1",
            "The configuration of version 1.0.1 was not migrated because Forkop migrates configurations from 1.0.2 on" ],
        [ [ { ".name": "settings", ".type": "settings" } ], "unknown", "The configuration was not migrated because it names no version" ],
        [ [ { ".name": "settings", ".type": "settings", config_version: "NEXT" } ], "unknown",
            "The configuration was not migrated because its version is not a release number" ],
        [ [ { ".name": "settings", ".type": "settings", config_version: "9.0.0" } ], "9.0.0",
            "The configuration of version 9.0.0 was not migrated because it was written by a newer Forkop" ]
    ];
    for (let entry in cases) {
        let original = "config settings 'settings'\n\toption marker '" + entry[1] + "'\n";
        let setup = router(original, entry[0]);
        let run = migrate(setup);
        t.eq(run.status, 0, run.stderr);
        t.eq(fs.readfile(setup.config), fs.readfile(DEFAULT_CONFIG), entry[1]);
        let aside = kept_aside(setup);
        t.eq(length(aside), 1);
        t.matches(aside[0], regexp("^forkop\\." + replace(entry[1], /\./g, "\\.") + "-[0-9]{8}-[0-9]{6}$"));
        t.eq(fs.readfile(setup.dir + "/" + aside[0]), original);
        t.eq(run.logs, [ "[warn] " + entry[2] + "; it is saved as " + setup.dir + "/" + aside[0] + " and Forkop starts from its defaults" ]);
        t.eq(uci.__commits(), [], "a reset stages no UCI edits");
    }
});

t.test("steps that change nothing in a configuration move only its label and keep no copy", () => {
    let setup = router(RELEASED_CONFIG, [ { ".name": "settings", ".type": "settings", config_version: "1.0.5" } ]);
    let run = migrate(setup);
    t.eq(run.status, 0, run.stderr);
    t.eq(uci.__sections("forkop")[0].config_version, "2.0.0");
    t.eq(kept_aside(setup), []);
    t.eq(run.logs, [ "[info] Migrated the configuration from 1.0.5 to 2.0.0; nothing but its version changed" ]);
});

t.test("a router without the file gets the defaults and says so", () => {
    let setup = router(null, null);
    let run = migrate(setup);
    t.eq(run.status, 0, run.stderr);
    t.eq(fs.readfile(setup.config), fs.readfile(DEFAULT_CONFIG));
    t.eq(kept_aside(setup), []);
    t.eq(length(run.logs), 1);
});

t.test("a migration that fails leaves the configuration as it was and fails the install with the reason", () => {
    let openvpn = "{\"type\":\"openvpn\",\"tag\":\"Office\",\"system\":true}";
    let setup = router(RELEASED_CONFIG, [
        { ".name": "settings", ".type": "settings", config_version: "1.0.5" },
        { ".name": "main", ".type": "section", label: "Main", action: "connection", outbound_jsons: [ openvpn ] }
    ]);
    let run = migrate(setup);
    t.eq(run.status, 1);
    t.eq([ uci.__commits(), kept_aside(setup), fs.readfile(setup.config) ], [ [], [], RELEASED_CONFIG ]);
    t.eq(length(run.logs), 1);
    t.matches(run.logs[0], /^\[error\] Failed to migrate the configuration from 1\.0\.5 to 2\.0\.0: JSON outbound 'Office' of section 'Main' uses OpenVPN system routes or reconnect_delay.*; it was left as it was$/);
});

t.test("a released configuration with a section of a later schema is a half-migrated one and is refused", () => {
    let setup = router(RELEASED_CONFIG, [
        { ".name": "settings", ".type": "settings", config_version: "1.0.5" },
        { ".type": "connection_link", section: "main", uri: "vless://u@a.example:443" }
    ]);
    let run = migrate(setup);
    t.eq([ run.status, uci.__commits(), kept_aside(setup) ], [ 1, [], [] ]);
    t.contains(run.logs[0], "has the type 'connection_link', which the 1.0.5 schema has no");
});

t.test("a file UCI cannot read is left for its owner to fix", () => {
    let setup = router("config settings 'settings\n", null);
    let run = migrate(setup);
    t.eq([ run.status, kept_aside(setup), fs.readfile(setup.config) ], [ 1, [], "config settings 'settings\n" ]);
    t.matches(run.logs[0], /^\[error\] Failed to migrate the configuration: UCI cannot read .*forkop: Entry not found; it was left as it was$/);
});

t.test("the check answers what this release would do and writes nothing", () => {
    let check = (sections) => {
        let setup = router(null, null);
        let path = setup.dir + "/forkop-check";
        fs.writefile(path, "copy");
        if (sections != null)
            uci.__seed("forkop-check", sections);
        let run = migrate(setup, [ "check", path ]);
        t.eq([ uci.__commits(), run.logs, run.stderr, kept_aside(setup) ], [ [], [], "", [] ], "the check wrote nothing");
        return { status: run.status, verdict: json(run.stdout) };
    };

    t.eq(check([ { ".name": "settings", ".type": "settings", config_version: "2.0.0" } ]),
        { status: 0, verdict: { result: "current", to: "2.0.0" } });
    t.eq(check(server_sections()), { status: 0, verdict: { result: "migrate", from: "1.0.5", to: "2.0.0",
        warnings: [ "Removed the MTProto server 'MT': Forkop no longer serves MTProto" ] } });
    t.eq(check([ { ".name": "settings", ".type": "settings", config_version: "1.0.0" } ]),
        { status: 0, verdict: { result: "reset", from: "1.0.0", reason: "below_min" } });
    t.eq(check([ { ".name": "settings", ".type": "settings", config_version: "garbage" } ]),
        { status: 0, verdict: { result: "reset", from: "unknown", reason: "invalid" } });
    let failed = check([ { ".name": "settings", ".type": "settings", config_version: "1.0.5" },
        { ".name": "s", ".type": "section", action: "connection", outbound_jsons: [ "{\"type\":\"snell\",\"tag\":\"S\",\"version\":2}" ] } ]);
    t.eq([ failed.status, failed.verdict.result, failed.verdict.from ], [ 1, "fail", "1.0.5" ]);
    t.contains(failed.verdict.reason, "is Snell 2, which sing-box no longer speaks");
    let unreadable = check(null);
    t.eq([ unreadable.status, unreadable.verdict.result ], [ 1, "fail" ]);
    t.contains(unreadable.verdict.reason, "UCI cannot read");
});

t.test("the configuration this release installs is already at its own version", () => {
    let sections = [];
    for (let line in split(fs.readfile(DEFAULT_CONFIG), "\n")) {
        let section = match(line, /^config ([a-z_]+)( '([^']*)')?$/);
        if (section)
            push(sections, { ".name": section[3], ".type": section[1] });
        let value = match(line, /^\s+option ([a-z0-9_]+) '([^']*)'$/);
        if (value)
            sections[length(sections) - 1][value[1]] = value[2];
    }
    t.eq(migration.decide({ sections }), { result: "current", from: migration.TARGET_CONFIG_VERSION });
});

t.test("an install removes what the 1.0.x runtime left: crontab lines, caches and the dnsmasq takeover", () => {
    let crontab_file = null;
    let setup = router(null, null, [
        [ "sh -c crontab -l 2>/dev/null", { stdout: "0 4 * * * /usr/bin/forkop list_update # forkop-list-update\n15 * * * * /bin/true\n" +
            "0 * * * * /usr/bin/forkop subscription_update # forkop-subscription-update\n" } ],
        [ (argv) => argv[0] == "crontab", (argv) => { crontab_file = fs.readfile(argv[1]); return {}; } ],
        [ (argv) => argv[1] == "restart", {} ]
    ]);
    let cache = setup.dir + "/cache";
    fs.mkdir(cache);
    fs.mkdir(cache + "/byedpi");
    fs.writefile(cache + "/byedpi/bye1.pid", "1");
    fs.writefile(cache + "/state.json", "{}");
    let file = setup.dir + "/system-info.json";
    fs.writefile(file, "{}");
    uci.__seed("dhcp", [
        { ".name": "dnsmasq0", ".type": "dnsmasq", server: [ "127.0.0.42" ], noresolv: "1", forkop_server: [ "1.1.1.1" ], forkop_noresolv: "0" }
    ]);
    uci.__seed("forkop", [ { ".name": "settings", ".type": "settings", config_version: "2.0.0" } ]);
    fs.writefile(setup.config, "current");
    let saved_init = v2.paths.dnsmasq_init;
    v2.paths.dnsmasq_init = setup.dir + "/dnsmasq";
    fs.writefile(v2.paths.dnsmasq_init, "");
    let run = stub.capture(() => {
        v2.paths.leftovers = [ cache, file, setup.dir + "/never-existed" ];
        return migration.main([ "migrate" ]);
    });
    let commands = stub.command_lines();
    stub.restore();
    v2.paths.leftovers = saved_leftovers;
    v2.paths.dnsmasq_init = saved_init;

    t.eq(run.result, 0, run.stderr);
    t.eq(crontab_file, "15 * * * * /bin/true\n");
    t.eq([ fs.stat(cache), fs.stat(file) ], [ null, null ], "a directory goes with what it holds");
    let dnsmasq = uci.__sections("dhcp")[0];
    t.eq([ dnsmasq.server, dnsmasq.noresolv, dnsmasq.cachesize, dnsmasq.forkop_server, dnsmasq.forkop_noresolv ],
        [ [ "1.1.1.1" ], "0", "150", null, null ], "a cache size with no backup returns to the stock one");
    t.contains(commands, setup.dir + "/dnsmasq restart");
    t.eq(setup.logs, [ "[info] Restored the dnsmasq configuration Forkop 1.0.x had taken over: server='1.1.1.1'; noresolv='0'; " +
        "cachesize='150'; removed forkop_server, forkop_noresolv" ]);
});

t.done();
