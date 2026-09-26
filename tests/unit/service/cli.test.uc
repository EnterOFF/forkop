let t = require("t");
let stub = require("stub");
let cli = require("service.cli");

function run(argv, status) {
    stub.commands([ [ () => true, { status: status ?? 0 } ] ]);
    let result = stub.capture(() => cli.main(argv, "/lib"));
    result.commands = stub.command_lines();
    stub.restore();
    return result;
}

t.test("start, stop, restart and reload go to the init script and return its status", () => {
    for (let verb in [ "start", "stop", "restart" ]) {
        let result = run([ verb ], 3);
        t.eq(result.commands, [ "/etc/init.d/forkop " + verb ]);
        t.eq(result.result, 3);
    }
    let reload = run([ "reload", "manual" ], 0);
    t.eq(reload.commands, [ "/etc/init.d/forkop reload manual" ]);
});

t.test("a command that is still a program runs from the library with its arguments", () => {
    t.eq(run([ "component_action", "sing_box", "update", "extra" ]).commands,
        [ "env FORKOP_LIB=/lib ucode -L /lib /lib/components/action.uc component-action sing_box update" ],
        "a command takes only the arguments it declares");
});

t.test("a key material command answers the page with success and its fields, or with the reason", () => {
    stub.commands([ [ "sing-box generate reality-keypair", { stdout: "PrivateKey: a\nPublicKey: b\n" } ] ]);
    let good = stub.capture(() => cli.main([ "generate_reality_keypair" ], "/lib"));
    stub.commands([ [ "sing-box generate reality-keypair", { status: 1 } ] ]);
    let bad = stub.capture(() => cli.main([ "generate_reality_keypair" ], "/lib"));
    stub.restore();
    t.eq([ good.result, json(good.stdout) ], [ 0, { success: true, private_key: "a", public_key: "b" } ]);
    t.eq([ bad.result, json(bad.stdout) ], [ 1, { success: false, message: "Failed to generate Reality key pair" } ]);
});

t.test("the component commands reach the component manager programs", () => {
    t.eq(run([ "component_action_async", "forkop", "update" ]).commands,
        [ "env FORKOP_LIB=/lib ucode -L /lib /lib/components/updates.uc component-action-async forkop update" ]);
    t.eq(run([ "component_action_status", "42-1" ]).commands,
        [ "env FORKOP_LIB=/lib ucode -L /lib /lib/components/updates.uc component-action-status 42-1" ]);
    t.eq(run([ "component_updates_if_due" ]).commands,
        [ "env FORKOP_LIB=/lib ucode -L /lib /lib/components/updates.uc component-updates-if-due" ]);
    t.eq(run([ "component_update_check_cache" ]).commands,
        [ "env FORKOP_LIB=/lib ucode -L /lib /lib/components/updates.uc component-update-check-cache" ]);
});

t.test("an unknown or retired command prints the help and fails without running anything", () => {
    for (let name in [ "", "main", "get_sing_box_status", "service_action_status", "check_sing_box_logs", "check_nft" ]) {
        let result = run([ name ]);
        t.eq(result.result, 1, name);
        t.eq(result.commands, [], name);
        t.contains(result.stdout, "Available commands:");
    }
});

t.test("the help lists the public commands and hides the package hooks", () => {
    let help = run([ "help" ]).stdout;
    t.contains(help, "    get_ui_state");
    t.contains(help, "    generate_server_certificate <subject> <name>");
    t.excludes(help, "package_postinst");
    t.excludes(help, "sing_box_crash_cleanup");
});

t.done();
