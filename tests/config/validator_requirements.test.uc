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
        stub.logger(logs),
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


// A core is installed and new enough; what it was built with is the question.
function built_with(tags_line) {
    let features = require("singbox.features");
    features.paths.binary = stub.tmpdir() + "/sing-box";
    fs.writefile(features.paths.binary, "#!/bin/sh\n");
    let answer = tags_line == null ? { status: 1, stdout: "" }
        : { status: 0, stdout: "sing-box version 1.14.1-extended-2.7.2-f125\n\n" + tags_line + "\nCGO: disabled\n" };
    return requirements(require("core.constants").SB_REQUIRED_VERSION + "\n", [
        [ /command -v/, { status: 0 } ],
        [ features.paths.binary + " version", answer ]
    ]);
}

t.test("a core without the Clash API is refused with the tag it lacks", () => {
    let result = built_with("Tags: with_quic,with_utls");
    t.contains(result.error, "sing-box was built without with_clash_api");
    t.eq(result.logs, [], "the start that asked logs the refusal, once");
});

t.test("a core whose tags cannot be read is refused", () => {
    t.contains(built_with(null).error, "Failed to read the tags sing-box was built with");
});

t.test("a core with the Clash API passes the tag check", () => {
    let error = built_with("Tags: with_clash_api").error ?? "";
    t.ok(index(error, "with_clash_api") < 0 && index(error, "tags") < 0, "refused: " + error);
});

t.done();
