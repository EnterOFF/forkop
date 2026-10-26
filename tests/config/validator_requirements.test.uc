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

// check_requirements over a core that reports version and tags; a null version is a core that
// does not answer.
function requirements(version, tags_line, handlers) {
    let features = require("singbox.features");
    features.paths.binary = stub.tmpdir() + "/sing-box";
    fs.writefile(features.paths.binary, "#!/bin/sh
# " + version + " " + tags_line + "
");
    let validator = require("config.validator");
    fixture.seed({ settings: {}, section: [ { ".name": "p", action: "connection", enabled: "1" } ], connection_link: fixture.links("p", [ "socks5://127.0.0.1:1080" ]) });
    let answer = version == null ? { status: 1, stdout: "" }
        : { status: 0, stdout: "sing-box version " + version + "

" + (tags_line ?? "Tags: with_clash_api,with_utls") + "
CGO: disabled
" };
    let logs = [];
    stub.commands([
        stub.logger(logs),
        [ features.paths.binary + " version", answer ],
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

const REQUIRED = require("core.constants").SB_REQUIRED_VERSION;
const PRESENT = [ [ /command -v/, { status: 0 } ] ];

// Past the core the next requirement is its init script, which this machine has not.
function core_accepted(result) {
    return result.error == null || result.error == "Service 'sing-box' is missing. Reinstall sing-box-forkop";
}

t.test("a kernel without IPv6 is refused before sing-box fails to open its IPv6 inbound", () => {
    fixture.kernel_ipv6(null);
    let error = requirements(REQUIRED, null, [ [ /command -v/, { status: 1 } ] ]).error;
    t.eq(error, "The kernel runs without IPv6 (ipv6.disable=1 on its command line, or built without it), and sing-box needs it even with IPv6 off. " +
        "Boot without ipv6.disable=1 and turn IPv6 off with sysctl net.ipv6.conf.all.disable_ipv6=1 instead");
    fixture.kernel_ipv6({ lo: "1", "br-lan": "1" });
    t.contains(requirements(REQUIRED, null, [ [ /command -v/, { status: 1 } ] ]).error, "Binary 'sing-box' is not available",
        "IPv6 turned off by sysctl is no reason to refuse");
});

t.test("the core version comes from the binary itself, never from the package manager", () => {
    let result = requirements(REQUIRED, null, PRESENT);
    t.ok(core_accepted(result), "refused: " + result.error);
    for (let entry in stub.calls())
        t.ok(!match(entry.command, /opkg|apk /), "ran the package manager: " + entry.command);
    t.contains(requirements(null, null, PRESENT).error, "Failed to read the version sing-box reports");
});

t.test("a core that is not sing-box-forkop is refused, whatever package files stand beside it", () => {
    for (let version in [ "1.12.22", "1.13.18-extended-2.6.5", "1.14.3" ])
        t.eq(requirements(version, null, PRESENT).error,
            "sing-box " + version + " is not sing-box-forkop, the core Forkop runs on. Install sing-box-forkop", version);
});

t.test("a core of the sing-box-extended line or a build before the first release is older than the minimum", () => {
    for (let version in [ "1.13.18-extended-2.6.5-f165", "1.14.0-forkop.3", "1.14.4-r0+12" ])
        t.eq(requirements(version, null, PRESENT).error,
            "sing-box-forkop " + version + " is older than the required minimum (" + REQUIRED + "). Update sing-box-forkop", version);
    for (let version in [ "1.14.4-r1", "1.14.4-r1+3", "1.14.5-r1" ])
        t.ok(core_accepted(requirements(version, null, PRESENT)), version);
});

function built_with(tags_line) {
    return requirements(REQUIRED, tags_line, PRESENT);
}

t.test("a core without the Clash API is refused with the tag it lacks", () => {
    let result = built_with("Tags: with_quic,with_utls");
    t.contains(result.error, "sing-box was built without with_clash_api");
    t.eq(result.logs, [], "the start that asked logs the refusal, once");
});

t.test("a core whose tags cannot be read is refused", () => {
    t.contains(built_with("Tagless: x").error, "sing-box was built without with_clash_api");
});

t.test("a core with a tunnel but without the gVisor stack it runs on is refused", () => {
    t.contains(built_with("Tags: with_clash_api,with_utls,with_wireguard,with_tailscale").error,
        "sing-box was built with with_wireguard, with_tailscale but without with_gvisor");
    let error = built_with("Tags: with_clash_api,with_utls,with_wireguard,with_gvisor").error ?? "";
    t.ok(index(error, "with_gvisor") < 0, "refused: " + error);
});

t.test("a core with the Clash API passes the tag check", () => {
    let error = built_with("Tags: with_clash_api").error ?? "";
    t.ok(index(error, "with_clash_api") < 0 && index(error, "tags") < 0, "refused: " + error);
});

t.done();
