// config/migration.uc against a live configuration: the parser preflight, the
// backup, the edits committed through core.uci, and the reset that replaces a
// file too old to migrate.

let t = require("t");
let stub = require("stub");
let repo = require("repo");
let fs = require("fs");
let uci = require("uci");
let core_uci = require("core.uci");

const DEFAULT_CONFIG = repo.path("forkop/files/etc/config/forkop");

// `uci show` for the given sections, which is what the preflight parses.
function uci_show(sections) {
    let lines = map(sections, (section) => "forkop." + section[".name"] + "=" + section[".type"]);
    return { stdout: join("\n", lines) + "\n" };
}

// Migrates a router whose /etc/config/forkop holds `file` and whose UCI holds
// `sections`; `preflight` stands in for what `uci show` answers.
function migrate_router(file, sections, preflight) {
    let dir = stub.tmpdir();
    let config_path = dir + "/forkop";
    fs.writefile(config_path, file);

    uci.__reset();
    core_uci.reset();
    uci.__seed("forkop", sections);

    stub.env({
        FORKOP_CONFIG_PATH: config_path,
        FORKOP_DEFAULT_CONFIG_PATH: DEFAULT_CONFIG,
        FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD: dir + "/guard"
    });
    let migration = stub.fresh("config.migration");
    let real_command = (argv, command) => ({ status: stub.real.system(command) });
    stub.commands([
        [ /^uci -q show /, preflight ?? uci_show(sections) ],
        [ "cp", real_command ],
        [ "logger", {} ],
        [ "rm", {} ],
        [ /crontab.* -l/, { stdout: "" } ],
        [ /dnsmasq/, {} ]
    ]);
    let run = stub.capture(() => migration.main([ "migrate" ]));
    let commands = stub.command_lines();
    stub.restore();
    return { status: run.result, error: run.stderr, config_path, commands };
}

t.test("a schema too old to migrate is replaced by the defaults, and the original kept", () => {
    let original = "config settings 'settings'\n        option config_version '1.0.1'\nconfig section 'old'\n        option action 'connection'\n";
    let run = migrate_router(original, [
        { ".name": "settings", ".type": "settings", config_version: "1.0.1" },
        { ".name": "old", ".type": "section", action: "connection" }
    ]);
    t.eq(run.status, 0, run.error);
    t.eq(fs.readfile(run.config_path), fs.readfile(DEFAULT_CONFIG));
    t.eq(fs.readfile(run.config_path + ".migration-backup.1.0.1"), original);
    t.excludes(uci.__commits(), "forkop", "a reset stages no UCI edits");
});

t.test("a released server's credentials become a client committed through core.uci", () => {
    let run = migrate_router("config settings 'settings'\n        option config_version '1.0.5'\n", [
        { ".name": "settings", ".type": "settings", config_version: "1.0.5",
            applied_migrations: [ "interface_sections", "enable_component_checks", "http_connection_urls" ] },
        { ".name": "inbound", ".type": "server", label: "VLESS", protocol: "vless",
            server_uuid: "44444444-4444-4444-8444-444444444444" }
    ]);
    t.eq(run.status, 0, run.error);
    t.contains(uci.__commits(), "forkop");

    let sections = uci.__sections("forkop");
    let settings = filter(sections, (section) => section[".type"] == "settings")[0];
    t.eq([ settings.config_version, settings.applied_migrations ], [ "NEXT", null ]);
    let clients = filter(sections, (section) => section[".type"] == "server_client");
    t.eq(length(clients), 1);
    t.eq([ clients[0].server, clients[0].uuid ], [ "inbound", "44444444-4444-4444-8444-444444444444" ]);
    t.contains(fs.readfile(run.config_path + ".migration-backup.1.0.5"), "config_version");
});

t.test("a file the UCI parser refuses stops the migration with the parser's own position", () => {
    let run = migrate_router("", [], { status: 1, stdout: "uci: Parse error (invalid command) at line 7, byte 3" });
    t.eq(run.status, 1);
    t.contains(run.error, "line 7, byte 3");
    t.contains(run.error, run.config_path);
});

t.test("a section type the released schema never had stops a released migration", () => {
    let run = migrate_router("", [ { ".name": "settings", ".type": "settings", config_version: "1.0.5" } ],
        { stdout: "forkop.settings=settings\nforkop.settings.config_version='1.0.5'\nforkop.@client[0]=server_client\n" });
    t.eq(run.status, 1);
    t.contains(run.error, "UCI section '@client[0]' has unsupported type 'server_client'");
});

t.test("a file without a version is reset whatever section types it holds", () => {
    let original = "config settings 'settings'\nconfig mystery\n";
    let run = migrate_router(original, [ { ".name": "settings", ".type": "settings" } ],
        { stdout: "forkop.settings=settings\nforkop.@mystery[0]=mystery\n" });
    t.eq(run.status, 0, run.error);
    t.eq(fs.readfile(run.config_path), fs.readfile(DEFAULT_CONFIG));
    t.eq(fs.readfile(run.config_path + ".migration-backup.missing"), original);
});

t.done();
