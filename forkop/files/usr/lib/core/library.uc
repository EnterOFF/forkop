// The directory the running library was loaded from, and how to run one of its
// modules that is a program of its own from the same directory.

let dir = getenv("FORKOP_LIB") || "/usr/lib/forkop";

function set_dir(path) {
    dir = path;
}

function get_dir() {
    return dir;
}

function program(module, args) {
    return [ "env", "FORKOP_LIB=" + dir, "ucode", "-L", dir, dir + "/" + module, ...(args ?? []) ];
}

return { set_dir, dir: get_dir, program };
