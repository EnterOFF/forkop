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
const MANIFEST_VERSION = "3";
// Loaded through the freshly built cache to prove the interpreter accepts what
// it just produced. A leaf module with no imports and no side effects.
const SELF_CHECK_MODULE = "config.domain";
const BUILD_LOCK_MAX_AGE = 120;
// Revalidating the manifest means one stat per installed module, and it is the
// single largest fixed cost of a Forkop command: about 45 ms of the 85 ms that
// `forkop <anything>` spends before it starts working, paid again by each of the
// twenty-odd processes one reload starts. Within a short window the answer
// cannot have changed for any reason that matters - an upgrade clears the stamp
// from postinst - so it is taken once and reused.
//
// The window is deliberately short. A module copied over an installed one during
// development is the case full validation exists to catch, and it still is
// caught, just up to this many seconds later.
const VALIDATION_TTL_SECONDS = int(getenv("FORKOP_BYTECODE_VALIDATION_TTL") || "3");

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

// Only the mtime: a directory's reported size is filesystem specific, while
// its mtime moves exactly when an entry is added or removed.
function directory_signature(path) {
    let stat = fs.stat(as_string(path));
    if (stat == null || stat.type != "directory")
        return null;
    return as_string(stat.mtime);
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

function collect_files(dir, prefix, result, directories) {
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
        if (stat.type == "directory") {
            push(directories, relative_path);
            collect_files(path, relative_path, result, directories);
        }
        else if (stat.type == "file")
            push(result, relative_path);
    }

    return result;
}

// Validating the recorded files proves none of them changed, but says nothing
// about a file that appeared beside them - and a module added by an upgrade
// whose siblings kept their size and mtime would then be missing from the
// cache, so every command reaching for it fails outright. A directory mtime
// moves when an entry is added or removed, so recording the dozen directories
// closes that gap for the cost of a few more stat calls.
function source_directories() {
    let directories = [ "" ];
    collect_files(SOURCE_DIR, "", [], directories);
    sort(directories);
    return directories;
}

// The directories and their mtimes as one snapshot. A build takes this first,
// enumerates the files second and checks the snapshot again at the end: an
// install writing into the tree while the build walks it would otherwise
// produce a cache missing whatever had not landed yet, and a manifest whose
// directory signatures were read afterwards would then vouch for it forever.
function directory_signatures() {
    let result = [];
    for (let relative_path in source_directories()) {
        let path = relative_path == "" ? SOURCE_DIR : SOURCE_DIR + "/" + relative_path;
        let signature = directory_signature(path);
        if (signature == null)
            return null;
        push(result, [ relative_path, signature ]);
    }
    return result;
}

function directory_signatures_match(snapshot) {
    if (snapshot == null)
        return false;

    let current = directory_signatures();
    if (current == null || length(current) != length(snapshot))
        return false;

    for (let i = 0; i < length(snapshot); i++)
        if (current[i][0] != snapshot[i][0] || current[i][1] != snapshot[i][1])
            return false;

    return true;
}

function source_files() {
    let result = collect_files(SOURCE_DIR, "", [], []);
    sort(result);
    return result;
}

function manifest_text(library, files, dependencies, directories) {
    let text = "version=" + MANIFEST_VERSION + "\n";
    text += "lib=" + as_string(library) + "\n";
    text += "src=" + SOURCE_DIR + "\n";
    text += "bin=" + UCODE_BIN + "\n";

    for (let path in dependencies) {
        let signature = file_signature(path);
        if (signature != null)
            text += "dep=" + path + "\t" + signature + "\n";
    }

    // The snapshot the file list is consistent with, not a fresh reading:
    // recording what the tree looks like after the walk would certify a cache
    // built from what it looked like before.
    for (let entry in directories)
        text += "dir=" + entry[0] + "\t" + entry[1] + "\n";

    for (let relative_path in files) {
        let signature = file_signature(SOURCE_DIR + "/" + relative_path);
        if (signature == null)
            return null;
        text += "file=" + relative_path + "\t" + signature + "\n";
    }

    return text;
}

function parse_manifest(text) {
    let result = { version: "", lib: "", src: "", bin: "", deps: [], files: [], dirs: [] };

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
        else if (key == "dep" || key == "file" || key == "dir") {
            let tab = index(value, "\t");
            if (tab < 0)
                continue;
            let entry = [ substr(value, 0, tab), substr(value, tab + 1) ];
            if (key == "dep")
                push(result.deps, entry);
            else if (key == "file")
                push(result.files, entry);
            else
                push(result.dirs, entry);
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

    for (let entry in manifest.dirs) {
        let path = entry[0] == "" ? SOURCE_DIR : SOURCE_DIR + "/" + entry[0];
        if (directory_signature(path) != entry[1])
            return false;
    }

    for (let entry in manifest.files)
        if (file_signature(SOURCE_DIR + "/" + entry[0]) != entry[1])
            return false;

    return true;
}

function validation_stamp_path() {
    return CACHE_DIR + "/validated";
}

function now_seconds() {
    return int(clock()[0]);
}

// The stamp records when the manifest was last proven and which library it was
// proven for. Naming the library is what lets a fresh stamp answer on its own:
// reading and parsing the manifest to learn the same path costs 20 ms of the
// 45 ms this exists to avoid, so the fast path must not touch it at all.
function validation_stamp_library() {
    if (VALIDATION_TTL_SECONDS <= 0)
        return "";

    let text = fs.readfile(validation_stamp_path());
    if (text == null)
        return "";

    let parts = split(trim(as_string(text)), " ");
    if (length(parts) < 2 || parts[1] == "")
        return "";
    if (match(parts[0], /^[0-9]+$/) == null)
        return "";

    let age = now_seconds() - int(parts[0]);
    if (age < 0 || age >= VALIDATION_TTL_SECONDS)
        return "";

    return is_directory(parts[1]) ? parts[1] : "";
}

function write_validation_stamp(library) {
    if (VALIDATION_TTL_SECONDS <= 0)
        return;
    fs.writefile(validation_stamp_path(), now_seconds() + " " + as_string(library) + "\n");
}

// Dropped when the installed library changes under us, so the next command
// revalidates in full rather than trusting a window that spans the change.
function invalidate_validation_stamp() {
    try {
        fs.unlink(validation_stamp_path());
    }
    catch (e) {
    }
    return true;
}

// Where a Forkop process should load its modules from: the compiled cache while
// it still matches the installed sources, and the sources themselves otherwise.
function library_dir() {
    if (!enabled())
        return SOURCE_DIR;

    let stamped = validation_stamp_library();
    if (stamped != "")
        return stamped;

    let text = fs.readfile(manifest_path());
    if (text == null)
        return SOURCE_DIR;

    let manifest = parse_manifest(text);
    if (!manifest_matches(manifest))
        return SOURCE_DIR;

    write_validation_stamp(manifest.lib);
    return manifest.lib;
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

    let directories = directory_signatures();
    let files = source_files();
    if (length(files) == 0)
        return SOURCE_DIR;

    if (!ensure_dir(CACHE_DIR))
        return SOURCE_DIR;

    // Another process is already compiling. If it published while we were
    // looking, use that; otherwise this one run stays on the sources.
    if (!acquire_build_lock())
        return library_dir();

    let library = compile_library(files);

    // The tree moved while we walked it, so the file list is not what is
    // installed. Publishing this would cache a library missing whatever landed
    // late, and nothing afterwards would notice.
    if (library != null && !directory_signatures_match(directories)) {
        remove_tree(library);
        release_build_lock();
        return SOURCE_DIR;
    }

    let text = library == null ? null : manifest_text(library, files, runtime_dependencies(), directories);

    if (text == null || !publish_manifest(text)) {
        remove_tree(library);
        release_build_lock();
        return SOURCE_DIR;
    }

    release_build_lock();
    write_validation_stamp(library);
    return library;
}

function refresh() {
    let current = library_dir();
    return current == SOURCE_DIR ? build() : current;
}

return {
    enabled,
    invalidate_validation_stamp,
    source_dir,
    library_dir,
    manifest_path,
    refresh,
    build
};
