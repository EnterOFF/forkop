// A router on the public 1.0.5 release upgrades to a configuration the current
// code accepts. tests/fixtures/forkop-1.0.5.conf is the default configuration
// 1.0.5 shipped with its commented examples filled in: every section type and
// every server protocol it knew.

let t = require("t");
let fs = require("fs");
let stub = require("stub");
let repo = require("repo");
let fixture = require("fixture");
let validation = require("validation");
let generator = require("singbox.generator");

// The sections of a UCI file in the shape the migration fixture mode reads.
function parse_uci(text) {
    let data = {};
    let current = null;
    let anonymous = 0;
    for (let line in split(text, "\n")) {
        let section = match(line, /^config ([a-z_]+)( '([^']*)')?$/);
        if (section) {
            current = { ".type": section[1], ".name": section[3] ?? sprintf("cfg%06x", ++anonymous) };
            data[section[1]] = [ ...(data[section[1]] ?? []), current ];
            continue;
        }
        let value = match(line, /^\s+(option|list) ([a-z0-9_]+) '([^']*)'$/);
        if (value == null)
            continue;
        if (value[1] == "list")
            current[value[2]] = [ ...(current[value[2]] ?? []), value[3] ];
        else
            current[value[2]] = value[3];
    }
    data.settings = data.settings[0];
    return data;
}

function migrate(data) {
    let path = stub.tmpdir() + "/fixture.json";
    fs.writefile(path, sprintf("%J", data));
    stub.env({ FORKOP_DEFAULT_CONFIG_PATH: repo.path("forkop/files/etc/config/forkop") });
    let migration = stub.fresh("config.migration");
    stub.commands([
        [ "logger", {} ],
        [ /\| md5sum$/, { stdout: "0123456789abcdef0123456789abcdef  -\n" } ]
    ]);
    let run = stub.capture(() => migration.main([ "migrate-fixture", path ]));
    stub.restore();
    t.eq(run.result, 0, run.stderr);
    return json(run.stdout);
}

let released = parse_uci(fs.readfile(repo.path("tests/fixtures/forkop-1.0.5.conf")));
let upgraded = migrate(released);

t.test("the release's configuration is found whole", () => {
    t.eq(released.settings.config_version, "1.0.5");
    t.eq(map(released.server, (server) => server.protocol), [ "json_inbound", "vless", "mtproto", "tailscale" ]);
});

t.test("it migrates to the current schema", () => {
    t.ok(upgraded.changed);
    t.eq(upgraded.config.settings.config_version, "NEXT");
});

t.test("the current validator accepts what it migrated to", () => {
    validation.accepts(upgraded.config);
});

t.test("the generator builds it with every section and server", () => {
    fixture.seed(upgraded.config);
    let config = generator.build({ service_address: "127.0.0.1" });
    let tags = map([ ...(config.inbounds ?? []), ...(config.endpoints ?? []) ], (item) => item.tag);
    for (let label in [ "JSON inbound", "VLESS Reality server", "MTProto proxy", "Tailscale endpoint" ])
        t.contains(tags, label);
    let outbounds = map(config.outbounds, (item) => item.tag);
    t.contains(outbounds, "Subscription");
    t.contains(outbounds, "JSON outbound");
});

t.done();
