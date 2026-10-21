let t = require("t");
let stub = require("stub");
let fixture = require("fixture");
let fs = require("fs");
let core_uci = require("core.uci");
let tailscale = require("singbox.tailscale");

function states(names) {
    let root = stub.tmpdir() + "/tailscale";
    fs.mkdir(root);
    for (let name in names)
        fs.mkdir(root + "/" + name);
    fs.writefile(root + "/stray-file", "");
    tailscale.paths.state_root = root;
    return root;
}

function removed_by(data) {
    let removed = [];
    fixture.seed(data);
    stub.commands([
        [ "rm -rf", (argv) => { push(removed, replace(argv[2], tailscale.paths.state_root + "/", "")); return {}; } ],
        [ "logger", {} ]
    ]);
    tailscale.remove_orphaned_states();
    stub.restore();
    core_uci.reset();
    return sort(removed);
}

t.test("a server and a tunnel keep their state under names the generator gives them", () => {
    let root = states([]);
    t.eq(tailscale.server_state_directory("server_1"), root + "/server_1");
    t.eq(tailscale.server_state_directory("odd name"), root + "/odd_name");
    t.eq(tailscale.tunnel_state_directory("vpn", "tunnel_2"), root + "/vpn-tunnel_2");
});

t.test("the identity of a removed server or tunnel goes, a disabled one keeps its own", () => {
    states([ "kept_server", "off_server", "gone_server", "vpn-tun_1", "vpn-gone", "custom" ]);
    t.eq(removed_by({
        settings: {},
        server: [
            { ".name": "kept_server", protocol: "tailscale" },
            { ".name": "off_server", protocol: "tailscale", enabled: "0" },
            { ".name": "vless", protocol: "vless" }
        ],
        tunnel: [
            { ".name": "tun_1", section: "vpn", kind: "tailscale" },
            { ".name": "tun_json", section: "vpn", kind: "json",
                endpoint_json: sprintf("{\"type\":\"tailscale\",\"state_directory\":\"%s/custom/\"}", tailscale.paths.state_root) }
        ]
    }), [ "gone_server", "vpn-gone" ]);
});

t.test("a configuration without its settings section is not read as one without Tailscale", () => {
    states([ "kept_server" ]);
    t.eq(removed_by({ server: [] }), []);
});

t.done();
