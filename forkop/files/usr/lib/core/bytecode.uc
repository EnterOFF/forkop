#!/usr/bin/env ucode

// Every Forkop command runs as a short-lived `ucode` process, and each one
// parses the modules it imports from source before it does any work. On an
// MT7621 router that parse dominates: `require("config.validator")` alone costs
// about 470 ms of a 640 ms process, and a single reload starts more than twenty
// such processes. ucode also executes precompiled bytecode, so the installed
// library is compiled once into a tmpfs cache and every later process loads
// that instead.
//
// The manifest records the size and mtime of every source file the cache was
// built from, plus the ucode binary that produced it, so a package upgrade, a
// hand-copied module during development or a new interpreter all invalidate the
// cache instead of silently running stale code. Living in tmpfs is the second
// half of that guarantee: bytecode carries a format version the interpreter
// refuses to load when it changes, and a cache that cannot outlive a reboot
// cannot outlive the ucode upgrade that would break it.

let fs = require("fs");

function as_string(value) {
    return value == null ? "" : "" + value;
}

// The interpreter that writes the cache has to be the one that later loads it.
// Bytecode carries a format version, and while a newer interpreter rejects an
// older file with a clear error, an older one can accept a newer header and
// then misread the body. /proc/self/exe names the binary actually running.
function ucode_binary() {
    let configured = getenv("FORKOP_UCODE_BIN");
    if (configured != null && configured != "")
        return configured;

    let executable = fs.readlink("/proc/self/exe");
    return executable == null ? "/usr/bin/ucode" : executable;
}

const SOURCE_DIR = getenv("FORKOP_SOURCE_LIB") || "/usr/lib/forkop";
const CACHE_DIR = getenv("FORKOP_BYTECODE_CACHE_DIR") || "/var/run/forkop/bytecode";
const UCODE_BIN = ucode_binary();
const MANIFEST_VERSION = "1";
// Loaded through the freshly built cache to prove the interpreter accepts what
// it just produced. A leaf module with no imports and no side effects.
const SELF_CHECK_MODULE = "config.domain";
const BUILD_LOCK_MAX_AGE = 120;

function enabled() {
    return as_string(getenv("FORKOP_BYTECODE_CACHE") || "1") != "0";
}

function source_dir() {
    return SOURCE_DIR;
}

function manifest_path() {
    return CACHE_DIR + "/manifest";
}

function build_lock_path() {
    return CACHE_DIR + "/build.lock";
}

function unique_suffix() {
    let now = clock();
    return as_string(now[0]) + "." + as_string(now[1]);
}

function parent_dir(path) {
    path = as_string(path);
    let slash = rindex(path, "/");
    return slash <= 0 ? "" : substr(path, 0, slash);
}

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function command_success(args) {
    let parts = [];
    for (let arg in args)
        push(parts, shell_quote(arg));
    return system(join(" ", parts) + " >/dev/null 2>&1") == 0;
}

function file_signature(path) {
    let stat = fs.stat(as_string(path));
    if (stat == null || stat.type != "file")
        return null;
    return as_string(stat.size) + " " + as_string(stat.mtime);
}

function is_directory(path) {
    let stat = fs.stat(as_string(path));
    return stat != null && stat.type == "directory";
}

function ensure_dir(path) {
    path = as_string(path);
    if (path == "" || path == "/")
        return true;
    if (fs.stat(path) != null)
        return is_directory(path);
    if (!ensure_dir(parent_dir(path)))
        return false;
    return fs.mkdir(path) || is_directory(path);
}

function remove_tree(path) {
    path = as_string(path);
    if (path != "")
        command_success([ "rm", "-rf", path ]);
}

// The interpreter decides which bytecode version the cache has to carry, so its
// own identity is part of what the manifest validates.
function runtime_dependencies() {
    let result = [ UCODE_BIN ];
    for (let path in fs.glob("/usr/lib/libucode.so*"))
        push(result, path);
    sort(result);
    return result;
}

function is_module_file(relative_path) {
    relative_path = as_string(relative_path);
    return length(relative_path) > 3 && substr(relative_path, length(relative_path) - 3) == ".uc";
}

function collect_files(dir, prefix, result) {
    let names = fs.lsdir(dir);
    if (type(names) != "array")
        return result;

    for (let name in names) {
        if (name == "." || name == "..")
            continue;

        let path = dir + "/" + name;
        let relative_path = prefix == "" ? name : prefix + "/" + name;
        let stat = fs.stat(path);
        if (stat == null)
            continue;
        if (stat.type == "directory")
            collect_files(path, relative_path, result);
        else if (stat.type == "file")
            push(result, relative_path);
    }

    return result;
}

function source_files() {
    let result = collect_files(SOURCE_DIR, "", []);
    sort(result);
    return result;
}

function manifest_text(library, files, dependencies) {
    let text = "version=" + MANIFEST_VERSION + "\n";
    text += "lib=" + as_string(library) + "\n";
    text += "src=" + SOURCE_DIR + "\n";
    text += "bin=" + UCODE_BIN + "\n";

    for (let path in dependencies) {
        let signature = file_signature(path);
        if (signature != null)
            text += "dep=" + path + "\t" + signature + "\n";
    }

    for (let relative_path in files) {
        let signature = file_signature(SOURCE_DIR + "/" + relative_path);
        if (signature == null)
            return null;
        text += "file=" + relative_path + "\t" + signature + "\n";
    }

    return text;
}

function parse_manifest(text) {
    let result = { version: "", lib: "", src: "", bin: "", deps: [], files: [] };

    for (let line in split(as_string(text), "\n")) {
        let separator = index(line, "=");
        if (separator <= 0)
            continue;

        let key = substr(line, 0, separator);
        let value = substr(line, separator + 1);

        if (key == "version")
            result.version = value;
        else if (key == "lib")
            result.lib = value;
        else if (key == "src")
            result.src = value;
        else if (key == "bin")
            result.bin = value;
        else if (key == "dep" || key == "file") {
            let tab = index(value, "\t");
            if (tab <= 0)
                continue;
            push(key == "dep" ? result.deps : result.files,
                [ substr(value, 0, tab), substr(value, tab + 1) ]);
        }
    }

    return result;
}

function manifest_matches(manifest) {
    if (manifest.version != MANIFEST_VERSION || manifest.src != SOURCE_DIR)
        return false;
    if (manifest.bin != UCODE_BIN)
        return false;
    if (manifest.lib == "" || length(manifest.files) == 0)
        return false;
    if (!is_directory(manifest.lib))
        return false;

    for (let entry in manifest.deps)
        if (file_signature(entry[0]) != entry[1])
            return false;

    for (let entry in manifest.files)
        if (file_signature(SOURCE_DIR + "/" + entry[0]) != entry[1])
            return false;

    return true;
}

// Where a Forkop process should load its modules from: the compiled cache while
// it still matches the installed sources, and the sources themselves otherwise.
function library_dir() {
    if (!enabled())
        return SOURCE_DIR;

    let text = fs.readfile(manifest_path());
    if (text == null)
        return SOURCE_DIR;

    let manifest = parse_manifest(text);
    return manifest_matches(manifest) ? manifest.lib : SOURCE_DIR;
}

function compile_file(source, target) {
    // -s drops debug information, which makes the cache smaller than the
    // sources it stands in for and halves what is left of the load time. The
    // sources stay installed next to it, so a traceback can still be read
    // against them.
    return command_success([ UCODE_BIN, "-c", "-s", "-o", target, source ]) &&
        fs.stat(target) != null;
}

function copy_file(source, target) {
    let data = fs.readfile(source);
    return data != null && fs.writefile(target, data) != null;
}

function self_check(library) {
    return command_success([ UCODE_BIN, "-L", library, "-e",
        "require(\"" + SELF_CHECK_MODULE + "\");" ]);
}

function publish_manifest(text) {
    let temporary = manifest_path() + ".new." + unique_suffix();
    if (fs.writefile(temporary, text) == null)
        return false;
    if (fs.rename(temporary, manifest_path()))
        return true;

    fs.unlink(temporary);
    return false;
}

// One build at a time. A second process that arrives while the cache is being
// compiled runs from source rather than waiting or duplicating the work; the
// next command it starts finds the finished cache.
function acquire_build_lock() {
    let path = build_lock_path();
    if (fs.mkdir(path))
        return true;

    let stat = fs.stat(path);
    if (stat == null)
        return fs.mkdir(path);
    if (clock()[0] - int(stat.mtime || 0) < BUILD_LOCK_MAX_AGE)
        return false;

    fs.rmdir(path);
    return fs.mkdir(path);
}

function release_build_lock() {
    fs.rmdir(build_lock_path());
}

function compile_library(files) {
    let library = CACHE_DIR + "/lib." + unique_suffix();
    if (!ensure_dir(library))
        return null;

    for (let relative_path in files) {
        let source = SOURCE_DIR + "/" + relative_path;
        let target = library + "/" + relative_path;

        if (!ensure_dir(parent_dir(target))) {
            remove_tree(library);
            return null;
        }

        // A module that refuses to compile still has to be present under the
        // cache, or the `require` that reaches for it would resolve past the
        // cache directory and find nothing.
        if (is_module_file(relative_path) && compile_file(source, target))
            continue;

        if (!copy_file(source, target)) {
            remove_tree(library);
            return null;
        }
    }

    if (!self_check(library)) {
        remove_tree(library);
        return null;
    }

    return library;
}

// Compiles the installed library into a new cache directory and publishes it by
// pointing the manifest at it. Directories left behind by earlier builds are
// not removed: a procd worker may still be executing from one, and tmpfs
// discards all of them on reboot anyway.
function build() {
    if (!enabled())
        return SOURCE_DIR;

    let files = source_files();
    if (length(files) == 0)
        return SOURCE_DIR;

    if (!ensure_dir(CACHE_DIR) || !acquire_build_lock())
        return SOURCE_DIR;

    let library = compile_library(files);
    let text = library == null ? null : manifest_text(library, files, runtime_dependencies());

    if (text == null || !publish_manifest(text)) {
        remove_tree(library);
        release_build_lock();
        return SOURCE_DIR;
    }

    release_build_lock();
    return library;
}

function refresh() {
    let current = library_dir();
    return current == SOURCE_DIR ? build() : current;
}

return {
    enabled,
    source_dir,
    library_dir,
    manifest_path,
    refresh,
    build
};
