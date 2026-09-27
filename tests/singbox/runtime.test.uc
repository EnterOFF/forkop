let t = require("t");
let stub = require("stub");
let fixture = require("fixture");
let fs = require("fs");
let uci = require("uci");
let core_uci = require("core.uci");
let packages = require("core.packages");
let runtime = require("singbox.runtime");
let cli = require("service.cli");

function configuration(dir, extra) {
    return {
        settings: fixture.settings({
            config_path: dir + "/etc/sing-box/config.json",
            cache_path: dir + "/tmp/sing-box/cache.db",
            service_listen_address: "127.0.0.1",
            ...(extra ?? {})
        }),
        section: [ { ".name": "main", action: "connection", selector_proxy_links: [ "vless://u@a.example:443#A" ] } ]
    };
}

let logs = [];

function tools(extra) {
    logs = [];
    stub.commands([
        [ "logger", (argv) => { push(logs, argv[3]); return {}; } ],
        ...(extra ?? [])
    ]);
}

// pgrep over a process table: -x by the process name, -f by the whole command line.
function processes(command_lines) {
    return [ "pgrep", (argv) => {
        let hit = argv[1] == "-x"
            ? filter(command_lines, (line) => replace(split(line, " ")[0], /.*\//, "") == argv[2])
            : filter(command_lines, (line) => match(line, regexp(argv[2])) != null);
        return { status: length(hit) > 0 ? 0 : 1 };
    } ];
}

t.test("the running core is the service's sing-box run, not a one-shot command", () => {
    tools([ processes([ "/usr/bin/sing-box version", "/usr/bin/sing-box generate warp-profile --json" ]) ]);
    t.eq(runtime.process_running(), false, "the state service asking the version during an install");
    tools([ processes([ "/usr/bin/sing-box run -c /etc/sing-box/config.json -D /usr/share/sing-box" ]) ]);
    t.eq(runtime.process_running(), true);
    stub.restore();
});

t.test("the configuration is written where the service reads it, and only when it changed", () => {
    let dir = stub.tmpdir();
    fixture.seed(configuration(dir));
    tools();
    t.eq(runtime.write_config(false), true);
    let written = fs.readfile(dir + "/etc/sing-box/config.json");
    t.eq(json(written).outbounds != null, true);
    t.ok(fs.stat(dir + "/tmp/sing-box")?.type == "directory", "the cache directory exists for the core to open");
    t.contains(logs, "[info] sing-box configuration changed; updating " + dir + "/etc/sing-box/config.json");

    let inode = fs.stat(dir + "/etc/sing-box/config.json").inode;
    t.eq(runtime.write_config(false), false);
    t.eq(fs.stat(dir + "/etc/sing-box/config.json").inode, inode, "an unchanged configuration is not rewritten");
    t.contains(logs, "[info] sing-box configuration is unchanged");
    stub.restore();
});

t.test("a configuration the core refuses is reported by its first line and never written", () => {
    let dir = stub.tmpdir();
    fixture.seed(configuration(dir));
    tools([ [ /'sing-box' '--disable-color' '-c' .* 'check'/, { status: 42, stdout: "\nFATAL[0000] route: missing outbound tag\nmore\n" } ] ]);
    let e = t.throws(() => runtime.write_config(true));
    stub.restore();
    t.eq(e.message, "Generated sing-box configuration is invalid: FATAL[0000] route: missing outbound tag. Aborted.");
    t.ok(fs.stat(dir + "/etc/sing-box/config.json") == null);
    t.eq(filter(fs.lsdir("/tmp"), (name) => substr(name, 0, 22) == "forkop-sing-box-check." && index(name, ".json") > 0), [],
        "the file checked is removed");
});

t.test("a checked configuration is checked even when it did not change", () => {
    let dir = stub.tmpdir();
    fixture.seed(configuration(dir));
    tools([ [ /'sing-box' '--disable-color' '-c' .* 'check'/, {} ] ]);
    runtime.write_config(true);
    runtime.write_config(true);
    t.eq(length(filter(stub.command_lines(), (line) => match(line, / check$/))), 2);
    stub.restore();
});

t.test("the service runs the generated file as root, committed only when something changed", () => {
    let dir = stub.tmpdir();
    fixture.seed(configuration(dir));
    uci.__seed("sing-box", [ { ".name": "main", ".type": "sing-box", enabled: "0", user: "sing-box", conffile: "/etc/sing-box/config.json" } ]);
    core_uci.reset();
    tools();
    runtime.configure_service();
    core_uci.reset();
    t.eq([ core_uci.get("sing-box.main.enabled"), core_uci.get("sing-box.main.user"), core_uci.get("sing-box.main.conffile") ],
        [ "1", "root", dir + "/etc/sing-box/config.json" ]);
    let commits = length(uci.__commits());
    runtime.configure_service();
    t.eq(length(uci.__commits()), commits, "a configured service is not committed again");
    stub.restore();
});

t.test("the component manager downloads through the mixed inbound only when a section is chosen for components", () => {
    fixture.seed({ settings: { download_lists_via_proxy: "1", download_lists_via_proxy_section: "main" } });
    t.eq(runtime.components_proxy_address(), "", "components have a switch of their own");
    fixture.seed({ settings: { download_components_via_proxy: "1", download_lists_via_proxy_section: "main" } });
    t.eq(runtime.components_proxy_address(), "127.0.0.1:4535");
    fixture.seed({ settings: {} });
    t.eq(runtime.components_proxy_address(), "");
});

t.test("the core version is the compressed package's first, with the release spelling", () => {
    let dir = stub.tmpdir();
    packages.paths.opkg_status = dir + "/status";
    fs.writefile(packages.paths.opkg_status, "Package: sing-box-forkop-compressed\nVersion: 1.13.14~extended~2.5.3~f1\nStatus: install ok installed\n");
    packages.paths.sing_box_version = dir + "/missing";
    stub.commands([ [ "sh -c command -v apk", { status: 1 } ] ]);
    t.eq(runtime.version(), "1.13.14-extended-2.5.3-f1");
    stub.restore();
});

const WARP_COMMAND = "sing-box --disable-color generate warp-profile --json";
const PROXIED_WARP_COMMAND = "env HTTPS_PROXY=http://127.0.0.1:4536 " + WARP_COMMAND;
const WARP_PROXY_LISTENING = [ "netstat -lnt", { stdout: "tcp 0 0 127.0.0.1:4536 0.0.0.0:* LISTEN\n" } ];
const NOTHING_LISTENING = [ "netstat -lnt", { stdout: "tcp 0 0 127.0.0.1:53 0.0.0.0:* LISTEN\n" } ];
const PROFILE = "{\"id\":\"profile-id\",\"auth_token\":\"auth-token\",\"private_key\":\"private-key\"}";

function warp_settings(through_section) {
    fixture.seed({
        settings: through_section ? { warp_profiles_via_proxy: "1", warp_profiles_via_proxy_section: "proxy" } : {},
        section: [ { ".name": "proxy", label: "Proxy", enabled: "1", action: "connection", selector_proxy_links: [ "vless://u@a.example:443#A" ] } ]
    });
    require("config.connections").load();
}

function generate() {
    return stub.capture(() => cli.main([ "generate_warp_profile" ], "/lib"));
}

t.test("a WARP profile is the three fields the core returned, and a failure says nothing of its output", () => {
    warp_settings(false);
    tools([ [ WARP_COMMAND, { stdout: "{\"id\":\"profile-id\",\"auth_token\":\"auth-token\",\"private_key\":\"private-key\",\"extra\":1}" } ] ]);
    let good = generate();
    tools([ [ WARP_COMMAND, { stdout: "{\"id\":\"secret-leak\"}" } ] ]);
    let bad = generate();
    stub.restore();

    t.eq([ good.result, json(good.stdout) ], [ 0, { id: "profile-id", auth_token: "auth-token", private_key: "private-key" } ]);
    t.eq([ bad.result, bad.stdout, bad.stderr ], [ 1, "", "Failed to generate WARP profile: the core returned an incomplete profile\n" ]);
    t.eq(logs, [ "[error] Failed to generate WARP profile: the core returned an incomplete profile" ]);
});

t.test("a WARP profile is registered through the chosen section's service proxy", () => {
    warp_settings(true);
    tools([ WARP_PROXY_LISTENING, [ PROXIED_WARP_COMMAND, { stdout: PROFILE } ] ]);
    let result = generate();
    stub.restore();
    t.eq([ result.result, json(result.stdout).id ], [ 0, "profile-id" ]);
});

t.test("a WARP registration that cannot reach its section says so, and never goes out directly instead", () => {
    warp_settings(true);
    tools([ NOTHING_LISTENING ]);
    let result = generate();
    stub.restore();
    let message = "Failed to generate WARP profile: profiles are requested through section 'Proxy', " +
        "and its service proxy is not running. Apply the settings or start Forkop";
    t.eq([ result.result, result.stderr ], [ 1, message + "\n" ]);
    t.eq(logs, [ "[error] " + message ]);
});

t.test("a WARP registration the core gave up on is logged with the core's reason and the way it went", () => {
    let reason = "FATAL[0010] Post \"https://api.cloudflareclient.com/v0a4471/reg\": net/http: TLS handshake timeout";
    warp_settings(false);
    tools([ [ WARP_COMMAND, { status: 1, stdout: reason + "\n" } ] ]);
    let direct = generate();
    let direct_logs = logs;
    warp_settings(true);
    tools([ WARP_PROXY_LISTENING, [ PROXIED_WARP_COMMAND, { status: 1, stdout: reason + "\n" } ] ]);
    let proxied = generate();
    stub.restore();

    let hint = ". If the Cloudflare API is blocked on this network, choose a section in Settings to request WARP profiles through";
    t.eq([ direct.result, direct.stderr ], [ 1, "Failed to generate WARP profile: " + reason + hint + "\n" ]);
    t.eq(direct_logs, [ "[error] Failed to generate WARP profile: " + reason + hint ]);
    t.eq(proxied.result, 1);
    t.eq(logs, [ "[error] Failed to generate WARP profile through section 'Proxy': " + reason ]);
});

t.done();
