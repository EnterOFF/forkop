let dir = getenv("FORKOP_LIB") || "/usr/lib/forkop";

function set_dir(path) {
    dir = path;
}

function get_dir() {
    return dir;
}

return { set_dir, dir: get_dir };
