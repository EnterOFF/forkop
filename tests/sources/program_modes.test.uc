// A few modules still run as programs, with a mode as their first argument:
// the component manager runs them, and the package scripts and the init
// scripts run the migration and the state service. A mode the module does not
// dispatch prints its usage and exits 1, which the caller reads as an answer -
// "not installed", "not newer" - rather than as an error. So every mode asked
// for anywhere is checked against the literals the target compares its mode to.

let t = require("t");
let fs = require("fs");
let repo = require("repo");

const LIBRARY = repo.path("forkop/files/usr/lib");

function library_files() {
    let pipe = fs.popen("cd '" + LIBRARY + "' && find . -name '*.uc' -type f | sort", "r");
    let found = trim(pipe.read("all"));
    pipe.close();
    return map(split(found, "\n"), (path) => substr(path, 2));
}

// Every literal a module compares a mode against.
function dispatched_modes(source) {
    let modes = [];
    for (let found in match(source, /[A-Za-z_]*(mode|MODE)[ \t]*[!=]=[ \t]*"([^"]+)"/g) ?? [])
        push(modes, found[2]);
    return modes;
}

// The modes a source runs a module with, as [ module, mode ] pairs:
//   module_output([ LIB_DIR + "/core/packages.uc", "version", ... ])
//   module_success(NFT_UC, [ "mode", ... ]) with const NFT_UC = LIB_DIR + "/nft/apply.uc"
//   program("components/action.uc", "component-action")
//   ucode -L /usr/lib/forkop /usr/lib/forkop/config/migration.uc migrate
function requested_modes(source) {
    let constants = {};
    for (let found in match(source, /const ([A-Z0-9_]+) = LIB_DIR \+ "\/([^"]+\.uc)"/g) ?? [])
        constants[found[1]] = found[2];

    let requests = [];
    for (let found in match(source, /module_(success|status|output|passthrough)\([ \t]*([A-Z0-9_]+)[ \t]*,[ \t]*\[[ \t]*"([^"]+)"/g) ?? [])
        if (constants[found[2]] != null)
            push(requests, [ constants[found[2]], found[3] ]);
    for (let found in match(source, /\[[ \t]*LIB_DIR \+ "\/([^"]+\.uc)"[ \t]*,[ \t]*"([^"]+)"/g) ?? [])
        push(requests, [ found[1], found[2] ]);
    for (let found in match(source, /program\([ \t]*"([^"]+\.uc)"[ \t]*,[ \t]*\[?[ \t]*"([^"]+)"/g) ?? [])
        push(requests, [ found[1], found[2] ]);
    for (let found in match(source, /(\/usr\/lib\/forkop|\$library)\/([a-z_]+\/[a-z_]+\.uc)"? ([a-z][a-z-]*)/g) ?? [])
        push(requests, [ found[2], found[3] ]);
    return requests;
}

t.test("every mode a module is run with is one it dispatches", () => {
    let modules = {};
    for (let path in library_files())
        modules[path] = dispatched_modes(fs.readfile(LIBRARY + "/" + path));

    let callers = [
        ...map(library_files(), (path) => [ path, LIBRARY + "/" + path ]),
        [ "forkop/Makefile", repo.path("forkop/Makefile") ],
        [ "build.sh", repo.path("build.sh") ],
        [ "init.d/forkop", repo.path("forkop/files/etc/init.d/forkop") ],
        [ "init.d/forkop-state", repo.path("forkop/files/etc/init.d/forkop-state") ]
    ];

    let checked = 0;
    let problems = [];
    for (let caller in callers)
        for (let request in requested_modes(fs.readfile(caller[1]))) {
            let known = modules[request[0]];
            if (known == null) {
                push(problems, caller[0] + " runs " + request[0] + ", which does not exist");
                continue;
            }
            checked++;
            if (index(known, request[1]) < 0)
                push(problems, caller[0] + " runs " + request[0] + " " + request[1] + ", which it does not dispatch");
        }

    t.ok(checked >= 10, "found the callers");
    t.eq(problems, []);
});

t.done();
