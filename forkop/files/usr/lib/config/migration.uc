#!/usr/bin/env ucode

// Brings /etc/config/forkop to the schema of this release. settings.config_version names the
// release whose schema a configuration follows; RELEASES lists every schema from the oldest one
// migrated, each with the steps that lead to it from the one before. A release that changes the
// schema appends its entry and a step module. Raising MIN_CONFIG_VERSION deletes the entries
// below it with their modules; the new first entry keeps only its section types.

let fs = require("fs");
let uci = require("uci");
let common = require("core.common");
let exec = require("core.exec");
let model_lib = require("config.migrations.model");

let as_string = common.as_string;

const CONFIG_NAME = "forkop";
const MIN_CONFIG_VERSION = "1.0.2";
const RELEASES = [
    {
        version: MIN_CONFIG_VERSION,
        types: [ "settings", "section", "server", "subscription_url", "section_interface", "urltest", "priority_group", "priority_level" ]
    },
    require("config.migrations.v1_0_5"),
    require("config.migrations.v2_0_0")
];
const TARGET_CONFIG_VERSION = RELEASES[length(RELEASES) - 1].version;

let paths = {
    config: "/etc/config/" + CONFIG_NAME,
    default_config: "/usr/share/forkop/default-config",
    // Read by the init script: a reload of the exact configuration committed here is skipped.
    internal_change: "/var/run/forkop.internal-config-change"
};

function version_parts(value) {
    let matched = match(as_string(value), /^([0-9]+)\.([0-9]+)\.([0-9]+)$/);
    return matched ? [ int(matched[1]), int(matched[2]), int(matched[3]) ] : null;
}

function compare_versions(left, right) {
    left = version_parts(left);
    right = version_parts(right);
    for (let i = 0; i < 3; i++)
        if (left[i] != right[i])
            return left[i] < right[i] ? -1 : 1;
    return 0;
}

function release_index(version) {
    for (let i = 0; i < length(RELEASES); i++)
        if (RELEASES[i].version == version)
            return i;
    return -1;
}

// { result: current|migrate|reset, from, reason }: a configuration this release cannot read as
// some released schema is kept aside rather than guessed at.
function decide(model) {
    let settings = model_lib.settings(model);
    let version = trim(model_lib.value(settings ?? {}, "config_version"));
    if (version == "")
        return { result: "reset", from: "unknown", reason: "missing" };
    if (version_parts(version) == null)
        return { result: "reset", from: "unknown", reason: "invalid" };
    if (version == TARGET_CONFIG_VERSION)
        return { result: "current", from: version };
    if (compare_versions(version, TARGET_CONFIG_VERSION) > 0)
        return { result: "reset", from: version, reason: "newer" };
    if (compare_versions(version, MIN_CONFIG_VERSION) < 0)
        return { result: "reset", from: version, reason: "below_min" };
    if (release_index(version) < 0)
        return { result: "reset", from: version, reason: "unknown" };
    return { result: "migrate", from: version };
}

const RESET_REASONS = {
    missing: "it names no version",
    invalid: "its version is not a release number",
    newer: "it was written by a newer Forkop",
    below_min: "Forkop migrates configurations from " + MIN_CONFIG_VERSION + " on",
    unknown: "no release wrote that version"
};

function deep_copy(value) {
    return json(sprintf("%J", value));
}

// Runs every step after the source release on a copy; the original stays as it was for the
// difference. A step stops the migration with die().
function migrate(model, from) {
    let migrated = deep_copy(model);
    let ctx = { warnings: [], after_commit: [] };
    let allowed = {};
    for (let type_name in RELEASES[release_index(from)].types)
        allowed[type_name] = true;
    for (let section in migrated.sections)
        if (!allowed[section[".type"]])
            return { error: "section '" + section[".name"] + "' has the type '" + section[".type"] + "', which the " + from + " schema has no" };

    try {
        for (let i = release_index(from) + 1; i < length(RELEASES); i++)
            for (let step in RELEASES[i].steps)
                step(migrated, ctx);
    }
    catch (e) {
        return { error: e.message };
    }

    model_lib.settings(migrated).config_version = TARGET_CONFIG_VERSION;
    return { model: migrated, warnings: ctx.warnings, after_commit: ctx.after_commit };
}

function option_keys(section) {
    return filter(keys(section), (key) => substr(key, 0, 1) != ".");
}

function same_value(left, right) {
    return sprintf("%J", left) == sprintf("%J", right);
}

// The UCI writes that turn one model into the other, in file order: sections added first, so
// that options naming them can be resolved, then edits, then removals.
function changes(before, after) {
    let ops = [];
    let old = {};
    for (let section in before.sections)
        old[section[".name"]] = section;

    for (let section in after.sections)
        if (old[section[".name"]] == null)
            push(ops, section[".anonymous"]
                ? { op: "add", section: section[".name"], type: section[".type"] }
                : { op: "create", section: section[".name"], type: section[".type"] });

    let kept = {};
    for (let section in after.sections) {
        let name = section[".name"];
        let previous = old[name] ?? {};
        kept[name] = true;
        if (previous[".type"] != null && previous[".type"] != section[".type"])
            push(ops, { op: "retype", section: name, type: section[".type"] });
        for (let key in option_keys(section))
            if (!same_value(previous[key], section[key]))
                push(ops, { op: "set", section: name, option: key, value: section[key] });
        for (let key in option_keys(previous))
            if (section[key] == null)
                push(ops, { op: "unset", section: name, option: key });
    }

    for (let section in before.sections)
        if (!kept[section[".name"]])
            push(ops, { op: "remove", section: section[".name"] });
    return ops;
}

function model_from_cursor(cursor) {
    let sections = [];
    cursor.foreach(CONFIG_NAME, null, (section) => {
        let copy = {};
        for (let key, value in section)
            if (key != ".index")
                copy[key] = value;
        push(sections, copy);
    });
    return { sections };
}

function apply(cursor, ops) {
    let created = {};
    let resolve = (value) => type(value) == "array"
        ? map(value, (item) => created[item] ?? item)
        : created[value] ?? value;

    for (let op in ops) {
        let section = created[op.section] ?? op.section;
        let done;
        if (op.op == "add") {
            done = cursor.add(CONFIG_NAME, op.type);
            created[op.section] = done;
        }
        else if (op.op == "create" || op.op == "retype")
            done = cursor.set(CONFIG_NAME, section, op.type);
        else if (op.op == "set")
            done = cursor.set(CONFIG_NAME, section, op.option, resolve(op.value));
        else if (op.op == "unset")
            done = cursor.delete(CONFIG_NAME, section, op.option);
        else if (op.op == "remove")
            done = cursor.delete(CONFIG_NAME, section);
        if (!done)
            return "could not " + op.op + " " + (op.option != null ? "option '" + op.option + "' of " : "") +
                "section '" + section + "'";
    }
    return null;
}

function stamp() {
    let now = localtime();
    return sprintf("%04d%02d%02d-%02d%02d%02d", now.year, now.mon, now.mday, now.hour, now.min, now.sec);
}

// Beside the configuration, under a name UCI does not read as a package: a dot ends it.
function aside_path(version) {
    let base = paths.config + "." + replace(as_string(version), /[^A-Za-z0-9._-]/g, "_") + "-" + stamp();
    let path = base;
    for (let n = 2; fs.stat(path) != null; n++)
        path = base + "-" + n;
    return path;
}

function copy_file(from, to, mode) {
    let text = fs.readfile(from);
    if (text == null)
        return false;
    let temporary = to + ".new";
    if (fs.writefile(temporary, text) == null || !fs.chmod(temporary, mode) || !fs.rename(temporary, to)) {
        fs.unlink(temporary);
        return false;
    }
    return true;
}

function mark_internal_change() {
    let hash = split(trim(exec.output([ "md5sum", paths.config ]) ?? ""), " ")[0];
    if (hash == "")
        return;
    common.write_file_atomic(paths.internal_change, common.now_seconds() + "\n" + hash + "\n");
}

// One line each to the log and to the terminal of whoever installed the package.
function report(level, message) {
    exec.log(level, message);
    warn("[" + level + "] " + message + "\n");
}

function keep_aside(decision) {
    let aside = aside_path(decision.from);
    if (fs.stat(paths.config) != null && !copy_file(paths.config, aside, 0600)) {
        report("error", "Failed to save the configuration to " + aside + "; it was left as it was");
        return false;
    }
    if (!copy_file(paths.default_config, paths.config, 0600)) {
        report("error", "Failed to replace the configuration with the defaults of Forkop " + TARGET_CONFIG_VERSION);
        return false;
    }
    mark_internal_change();
    let what = decision.from == "unknown" ? "The configuration" : "The configuration of version " + decision.from;
    report("warn", what + " was not migrated because " + RESET_REASONS[decision.reason] + "; it is saved as " +
        aside + " and Forkop starts from its defaults");
    return true;
}

function migrate_runtime(model, decision) {
    let result = migrate(model, decision.from);
    if (result.error != null) {
        report("error", "Failed to migrate the configuration from " + decision.from + " to " + TARGET_CONFIG_VERSION +
            ": " + result.error + "; it was left as it was");
        return false;
    }

    // Steps that changed nothing here move only the label, which leaves no copy worth keeping.
    let ops = changes(model, result.model);
    let label_only = length(filter(ops, (op) => op.op != "set" || op.option != "config_version")) == 0;
    let aside = label_only ? null : aside_path(decision.from);
    if (aside != null && !copy_file(paths.config, aside, 0600)) {
        report("error", "Failed to save the configuration to " + aside + " before migrating it; it was left as it was");
        return false;
    }
    let cursor = uci.cursor();
    let failure = cursor.load(CONFIG_NAME) ? apply(cursor, ops) : "could not load it";
    if (failure == null && !cursor.commit(CONFIG_NAME))
        failure = "could not commit it";
    if (failure != null) {
        report("error", "Failed to migrate the configuration from " + decision.from + " to " + TARGET_CONFIG_VERSION +
            ": " + failure + "; it was left as it was");
        return false;
    }
    mark_internal_change();

    report("info", "Migrated the configuration from " + decision.from + " to " + TARGET_CONFIG_VERSION +
        (aside != null ? "; the previous one is saved as " + aside : "; nothing but its version changed"));
    for (let line in result.warnings)
        report("warn", line);
    for (let path in result.after_commit)
        if (!exec.ok([ "rm", "-rf", path ]))
            report("warn", "Failed to remove " + path + ", which the migrated configuration no longer uses");
    return true;
}

// The configuration on the router. A file UCI cannot parse is left for its owner to fix.
function load_runtime() {
    if (fs.stat(paths.config) == null)
        return { model: { sections: [] } };
    let cursor = uci.cursor();
    if (!cursor.load(CONFIG_NAME))
        return { error: "UCI cannot read " + paths.config + ": " + (cursor.error() ?? "unknown error") };
    return { model: model_from_cursor(cursor) };
}

function run() {
    let loaded = load_runtime();
    if (loaded.error != null) {
        report("error", "Failed to migrate the configuration: " + loaded.error + "; it was left as it was");
        return false;
    }
    let decision = decide(loaded.model);
    if (decision.result == "current")
        return true;
    if (decision.result == "reset")
        return keep_aside(decision);
    return migrate_runtime(loaded.model, decision);
}

function remove_leftovers() {
    let cleaned = true;
    for (let release in RELEASES)
        if (release.leftovers != null && !release.leftovers())
            cleaned = false;
    return cleaned;
}

// A start meets a configuration no install saw: a restored backup, or one a sysupgrade kept.
// One of a supported release is migrated; any other stays as it is, since only an install
// replaces a configuration.
function start() {
    let loaded = load_runtime();
    if (loaded.error != null) {
        report("error", "Failed to read the configuration: " + loaded.error);
        return false;
    }
    let decision = decide(loaded.model);
    if (decision.result == "current")
        return true;
    if (decision.result == "reset") {
        let what = decision.from == "unknown" ? "The configuration" : "The configuration of version " + decision.from;
        report("error", what + " cannot be migrated because " + RESET_REASONS[decision.reason] + ", so Forkop does not " +
            "start. Restore a configuration of Forkop " + MIN_CONFIG_VERSION + " or later, or reinstall Forkop to start from its defaults");
        return false;
    }
    if (!migrate_runtime(loaded.model, decision))
        return false;
    remove_leftovers();
    return true;
}

// The installer's question before it changes anything: what this release would do to the
// configuration at path. Reads only the file, and writes nothing anywhere.
function check(path) {
    path = as_string(path);
    let slash = rindex(path, "/");
    let dir = slash > 0 ? substr(path, 0, slash) : ".";
    let package_name = substr(path, slash + 1);
    if (fs.stat(path) == null)
        return { result: "reset", from: "unknown", reason: "missing" };

    let cursor = uci.cursor(dir, "/var/run/forkop-migration-check.nonexistent");
    if (!cursor.load(package_name))
        return { result: "fail", from: "unknown", reason: "UCI cannot read " + path + ": " + (cursor.error() ?? "unknown error") };
    let sections = [];
    cursor.foreach(package_name, null, (section) => {
        let copy = {};
        for (let key, value in section)
            if (key != ".index")
                copy[key] = value;
        push(sections, copy);
    });
    let model = { sections };
    let decision = decide(model);
    if (decision.result == "current")
        return { result: "current", to: TARGET_CONFIG_VERSION };
    if (decision.result == "reset")
        return { result: "reset", from: decision.from, reason: decision.reason };
    let migrated = migrate(model, decision.from);
    if (migrated.error != null)
        return { result: "fail", from: decision.from, reason: migrated.error };
    return { result: "migrate", from: decision.from, to: TARGET_CONFIG_VERSION, warnings: migrated.warnings };
}

const FIXTURE_TYPES = [
    "settings", "section", "server", "server_client", "subscription_url", "section_interface",
    "connection_link", "urltest", "priority_group", "priority_level", "fallback_group", "fallback_level",
    "tunnel", "tunnel_peer"
];

// Tests describe a configuration by type, { settings: {...}, section: [...], ... }.
function model_from_fixture(data) {
    let sections = [];
    for (let type_name in FIXTURE_TYPES) {
        let listed = data[type_name];
        if (type(listed) == "object")
            listed = [ listed ];
        for (let section in listed ?? []) {
            let copy = { ...section, ".type": type_name };
            if (copy[".name"] == null)
                copy[".name"] = type_name == "settings" ? "settings" : type_name + "_" + length(sections);
            if (copy[".anonymous"] == null)
                copy[".anonymous"] = false;
            push(sections, copy);
        }
    }
    return { sections };
}

function fixture_from_model(model) {
    let data = {};
    for (let section in model.sections) {
        let type_name = section[".type"];
        let copy = {};
        for (let key, value in section)
            if (key != ".type" && key != ".anonymous")
                copy[key] = value;
        if (type_name == "settings")
            data.settings = copy;
        else
            data[type_name] = [ ...(data[type_name] ?? []), copy ];
    }
    return data;
}

function migrate_fixture(path) {
    let model = model_from_fixture(common.read_json_file(path) ?? {});
    let decision = decide(model);
    let result = { decision, target: TARGET_CONFIG_VERSION };
    if (decision.result == "migrate") {
        let migrated = migrate(model, decision.from);
        if (migrated.error != null) {
            result.error = migrated.error;
            common.write_json(result);
            return false;
        }
        result.config = fixture_from_model(migrated.model);
        result.operations = changes(model, migrated.model);
        result.warnings = migrated.warnings;
        result.after_commit = migrated.after_commit;
    }
    common.write_json(result);
    return true;
}

function main(argv) {
    let mode = argv[0] ?? "";
    if (mode == "migrate")
        return run() && remove_leftovers() ? 0 : 1;
    if (mode == "check" && argv[1] != null) {
        let verdict = check(argv[1]);
        common.write_json(verdict);
        return verdict.result == "fail" ? 1 : 0;
    }
    if (mode == "migrate-fixture" && argv[1] != null)
        return migrate_fixture(argv[1]) ? 0 : 1;

    warn("Usage: config/migration.uc migrate\n");
    warn("       config/migration.uc check <path of a copy of /etc/config/forkop>\n");
    warn("       config/migration.uc migrate-fixture <fixture.json>\n");
    return 2;
}

if (sourcepath(1) != null && sourcepath(1) != "")
    return { paths, MIN_CONFIG_VERSION, TARGET_CONFIG_VERSION, decide, migrate, changes, run, start, check, main };

exit(main(ARGV));
