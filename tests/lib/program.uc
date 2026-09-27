// Runs a library module the way the component manager and the package scripts
// run one: as a program with a mode, in an interpreter of its own.
//
//     let result = program.run("core/version.uc", [ "version-at-least", "1.2", "1.1" ]);
//     result.status, result.stdout, result.stderr
//
// Options: env (variables to set), lib (directories searched before the
// library, for a fake module), path (directories put in front of PATH, for a
// fake command), stdin (text the program reads).

let fs = require("fs");
let repo = require("repo");
let stub = require("stub");

const LIBRARY = repo.path("forkop/files/usr/lib");

function quote(value) {
    return "'" + replace("" + value, /'/g, "'\\''") + "'";
}

function run(module, args, options) {
    options = options ?? {};
    let dir = stub.tmpdir();

    let env = { ...(options.env ?? {}) };
    if (options.path != null)
        env.PATH = join(":", options.path) + ":" + stub.real.getenv("PATH");

    let command = "env";
    for (let name, value in env)
        command += " " + name + "=" + quote(value);
    command += " ucode";
    for (let lib in [ ...(options.lib ?? []), LIBRARY ])
        command += " -L " + quote(lib);
    command += " -- " + quote(LIBRARY + "/" + module);
    for (let arg in args ?? [])
        command += " " + quote(arg);

    fs.writefile(dir + "/stdin", options.stdin ?? "");
    let pipe = fs.popen(command + " <" + quote(dir + "/stdin") + " 2>" + quote(dir + "/stderr"), "r");
    let stdout = pipe.read("all");
    let status = pipe.close();
    return { status, stdout, stderr: fs.readfile(dir + "/stderr") };
}

return { run, LIBRARY };
