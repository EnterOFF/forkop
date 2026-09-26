let t = require("t");
let stub = require("stub");
let fixture = require("fixture");
let connections = require("config.connections");
let fs = require("fs");

function present(action, enabled) {
    fixture.seed({
        settings: {},
        section: [ { ".name": "sec", action, enabled, label: "sec" } ],
        subscription_url: [ { ".name": "sub", section: "sec", url: "https://example.com/sub" } ]
    });
    connections.load();
    return require("config.validator").has_outbound_section();
}

t.test("only an enabled Connection section counts as a proxy outbound", () => {
    t.ok(present("connection", "1"));
    t.ok(!present("bypass", "1"), "a Bypass section that kept a subscription");
    t.ok(!present("dns", "1"), "a DNS section that kept a subscription");
    t.ok(!present("connection", "0"), "a disabled Connection section");
    t.ok(!present("zapret", "1"), "a section with a retired action");
});

function requirements(version_text, handlers) {
    let dir = stub.tmpdir();
    fs.writefile(dir + "/version", version_text);
    require("core.packages").paths.sing_box_version = dir + "/version";
    let validator = require("config.validator");
    fixture.seed({ settings: {}, section: [ { ".name": "p", action: "connection", enabled: "1", selector_proxy_links: [ "socks5://127.0.0.1:1080" ] } ] });
    let logs = [];
    stub.commands([
        [ "logger", (argv) => { push(logs, argv[3]); return { status: 0 }; } ],
        ...(handlers ?? [])
    ]);
    let error = null;
    try {
        validator.check_requirements();
    }
    catch (e) {
        error = e.message;
    }
    stub.restore();
    return { error, logs };
}

t.test("the core version comes from the file the core package installs, never from the package manager", () => {
    let result = requirements("1.14.1-extended-2.7.2-f122\n", [
        [ /command -v/, { status: 1 } ]
    ]);
    t.contains(result.error, "Binary 'sing-box' is not available");
    for (let entry in stub.calls())
        t.ok(!match(entry.command, /opkg|apk /), "ran the package manager: " + entry.command);
});

t.done();
