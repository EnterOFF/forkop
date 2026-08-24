#!/usr/bin/env ucode

let fs = require("fs");

const SING_BOX_FORKOP_VERSION_FILE = getenv("SING_BOX_FORKOP_VERSION_FILE") || "/usr/share/sing-box-forkop/version";

function as_string(value) {
    return value == null ? "" : "" + value;
}

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function command_from_args(args) {
    let parts = [];
    for (let arg in args)
        push(parts, shell_quote(arg));
    return join(" ", parts);
}

function command_success(args) {
    return system(command_from_args(args) + " >/dev/null 2>&1") == 0;
}

function command_output(args) {
    let pipe = fs.popen(command_from_args(args), "r");
    if (!pipe)
        return "";

    let data = pipe.read("all");
    let status = pipe.close();
    if (status != 0 || data == null)
        return "";
    return as_string(data);
}

function command_exists(name) {
    return command_success([ "command", "-v", name ]);
}

function apk_installed(package_name) {
    return command_exists("apk") && command_success([ "apk", "info", "-e", as_string(package_name) ]);
}

const OPKG_STATUS_FILE = getenv("FORKOP_OPKG_STATUS_FILE") || "/usr/lib/opkg/status";

// `opkg list-installed` takes opkg's own lock, and every reader of a version
// here then competes with any install in progress - which is how a background
// version read came to make an unrelated `opkg` call fail with "Could not lock
// /var/lock/opkg.lock". The status file is what that command reads anyway, and
// reading it takes no lock, so no version lookup can collide with anything.
//
// The status of a stanza has to be honoured: the file also carries packages
// that are known but not installed, and this router has four of them. The test
// is the last word of the status line, because "not-installed" ends in
// "installed" and a substring check would call every one of them present.
function opkg_status_installed(status) {
    let words = split(trim(as_string(status)), /[ \t]+/);
    return length(words) > 0 && words[length(words) - 1] == "installed";
}

function opkg_status_version(text, package_name) {
    package_name = as_string(package_name);

    let name = "";
    let version = "";
    let status = "";

    for (let line in split(as_string(text), "\n")) {
        line = trim(as_string(line));

        if (line == "") {
            if (name == package_name && opkg_status_installed(status))
                return version;
            name = "";
            version = "";
            status = "";
            continue;
        }

        if (substr(line, 0, 9) == "Package: ")
            name = trim(substr(line, 9));
        else if (substr(line, 0, 9) == "Version: ")
            version = trim(substr(line, 9));
        else if (substr(line, 0, 8) == "Status: ")
            status = trim(substr(line, 8));
    }

    // A file that does not end with a blank line still has a stanza to answer.
    return name == package_name && opkg_status_installed(status) ? version : "";
}

function opkg_version(package_name) {
    let text = fs.readfile(OPKG_STATUS_FILE);
    if (text != null)
        return opkg_status_version(text, package_name);

    // Only for a layout that keeps the status somewhere else. This is the path
    // that can contend for the lock, and it is not the one anybody takes.
    package_name = as_string(package_name);
    if (!command_exists("opkg"))
        return "";

    let prefix = package_name + " - ";
    for (let line in split(command_output([ "opkg", "list-installed" ]), "\n")) {
        line = trim(as_string(line));
        if (substr(line, 0, length(prefix)) == prefix)
            return substr(line, length(prefix));
    }
    return "";
}

function opkg_installed(package_name) {
    return opkg_version(package_name) != "";
}

function installed(package_name) {
    return apk_installed(package_name) || opkg_installed(package_name);
}

function apk_manifest_version(package_name, output) {
    package_name = as_string(package_name);
    let found = false;

    for (let line in split(as_string(output), "\n")) {
        line = trim(as_string(line));
        if (substr(line, 0, 2) == "P:")
            found = substr(line, 2) == package_name;
        else if (found && substr(line, 0, 2) == "V:")
            return substr(line, 2);
    }
    return "";
}

function apk_info_version(package_name, output) {
    package_name = as_string(package_name);
    let prefix = package_name + "-";

    for (let line in split(as_string(output), "\n")) {
        line = trim(as_string(line));
        if (line == "")
            continue;
        if (substr(line, 0, length(prefix)) == prefix)
            return substr(line, length(prefix));
    }
    return "";
}

function apk_list_version(package_name, output) {
    package_name = as_string(package_name);
    let prefix = package_name + "-";

    for (let line in split(as_string(output), "\n")) {
        for (let field in split(trim(as_string(line)), /[ \t]+/)) {
            field = as_string(field);
            if (substr(field, 0, length(prefix)) != prefix)
                continue;

            let version = substr(field, length(prefix));
            if (version != "")
                return version;
        }
    }
    return "";
}

function apk_query_version(package_name, output) {
    package_name = as_string(package_name);
    let packages;

    try {
        packages = json(as_string(output));
    }
    catch (e) {
        return "";
    }

    if (type(packages) != "array")
        return "";

    for (let package in packages) {
        if (type(package) != "object" || as_string(package.name) != package_name)
            continue;

        let version = as_string(package.version);
        if (version != "")
            return version;
    }
    return "";
}

function apk_version(package_name) {
    package_name = as_string(package_name);
    if (!apk_installed(package_name))
        return "";

    let version = apk_list_version(package_name, command_output([ "apk", "list", "--installed", package_name ]));
    if (version != "")
        return version;

    version = apk_manifest_version(package_name, command_output([ "apk", "list", "--installed", "--manifest", package_name ]));
    if (version != "")
        return version;

    version = apk_manifest_version(package_name, command_output([ "apk", "list", "--installed", "--manifest" ]));
    if (version != "")
        return version;

    return apk_info_version(package_name, command_output([ "apk", "info", "-v", package_name ]));
}

function apk_available_version(package_name) {
    package_name = as_string(package_name);
    if (!command_exists("apk"))
        return "";
    return apk_query_version(
        package_name,
        command_output([ "apk", "query", "--from", "repositories", "--available", "--format", "json", "--fields", "name,version", package_name ])
    );
}

function sing_box_forkop_version(package_name) {
    package_name = as_string(package_name);
    if (package_name != "sing-box-forkop" && package_name != "sing-box-forkop-compressed")
        return null;
    if (!installed(package_name))
        return null;

    let data = fs.readfile(SING_BOX_FORKOP_VERSION_FILE);
    if (data == null)
        return null;

    let value = trim(as_string(data));
    return match(value, /^[0-9][0-9A-Za-z._+~-]*-extended-[0-9][0-9A-Za-z._+~-]*-f[0-9]+$/) != null ||
        match(value, /^[0-9][0-9A-Za-z._+~-]*-forkop[.][0-9]+$/) != null ? value : "";
}

function version(package_name) {
    let canonical = sing_box_forkop_version(package_name);
    if (canonical != null)
        return canonical;

    let value = apk_version(package_name);
    return value != "" ? value : opkg_version(package_name);
}

let mode = ARGV[0] || "";

if (mode == "installed")
    exit(installed(ARGV[1]) ? 0 : 1);
else if (mode == "apk-installed")
    exit(apk_installed(ARGV[1]) ? 0 : 1);
else if (mode == "opkg-installed")
    exit(opkg_installed(ARGV[1]) ? 0 : 1);
else if (mode == "version")
    print(version(ARGV[1]), "\n");
else if (mode == "apk-version")
    print(apk_version(ARGV[1]), "\n");
else if (mode == "apk-available-version")
    print(apk_available_version(ARGV[1]), "\n");
else if (mode == "opkg-version")
    print(opkg_version(ARGV[1]), "\n");
else if (mode == "opkg-status-version")
    print(opkg_status_version(fs.readfile(ARGV[1]), ARGV[2]), "\n");
else {
    warn("Usage: core/packages.uc <installed|apk-installed|opkg-installed|version|apk-version|apk-available-version|opkg-version> <package> | opkg-status-version <file> <package>\n");
    exit(1);
}
