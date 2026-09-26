// What a server section needs before sing-box can serve it: the defaults and
// files the configuration refers to, the firewall rules that open its ports, and
// the key material the Servers tab asks for.

let fs = require("fs");
let common = require("core.common");
let exec = require("core.exec");
let uci = require("core.uci");
let servers = require("singbox.servers");
let singbox_constants = require("singbox.constants");

const CONFIG_NAME = "forkop";

let paths = {
    certificates: "/etc/forkop/server-certs",
    ssh_keys: "/etc/forkop/server-ssh",
    firewall_include: "/usr/share/nftables.d/chain-pre/input/forkop-servers.nft",
    firewall_init: "/etc/init.d/firewall"
};

// A self-signed certificate is pinned by its fingerprint or accepted without a
// name check, so it has no reason to expire while its server runs; it is issued
// again a month before it would.
const CERTIFICATE_MONTHS = 120;
const CERTIFICATE_RENEW_SECONDS = 30 * 24 * 3600;
const ORPHAN_MIN_AGE = 3600;
const FIREWALL_COMMENT = singbox_constants.SERVER_FIREWALL_COMMENT;

let changed = false;

function get(name, key, fallback) {
    let value = uci.get(CONFIG_NAME + "." + name + "." + key);
    return value == "" ? (fallback ?? "") : value;
}

function set_if_empty(name, key, value) {
    if (value != "" && get(name, key) == "" && uci.set(CONFIG_NAME + "." + name + "." + key, value))
        changed = true;
}

function set_value(name, key, value) {
    if (value != "" && get(name, key) != value && uci.set(CONFIG_NAME + "." + name + "." + key, value))
        changed = true;
}

function section_names(type_name) {
    return uci.sections(CONFIG_NAME, type_name);
}

function file_name(value) {
    return replace(common.as_string(value), /[^A-Za-z0-9_.-]/g, "_");
}

function valid_file_path(value) {
    return match(value, /^\/[A-Za-z0-9_.\/-]+$/) != null && substr(value, -1) != "/";
}

function nonempty_file(path) {
    return (fs.stat(path)?.size ?? 0) > 0;
}

function executable(path) {
    return ((fs.stat(path)?.mode ?? 0) & 0111) != 0;
}

function pem_block(data, label) {
    let begin = "-----BEGIN " + label + "-----";
    let end = "-----END " + label + "-----";
    let lines = null;
    for (let line in split(common.as_string(data), "\n")) {
        line = rtrim(line, "\r");
        if (lines == null && line != begin)
            continue;
        lines ??= [];
        push(lines, line);
        if (line == end)
            return join("\n", lines);
    }
    return "";
}

function expiry_path(certificate_path) {
    return certificate_path + ".expires";
}

function write_private_file(path, text) {
    let file = fs.open(path, "w", 0600);
    if (!file)
        return false;
    fs.chmod(path, 0600);
    let written = file.write(text) != null;
    file.close();
    return written;
}

function issue_certificate_files(subject, certificate_path, key_path) {
    let output = exec.output([ "sing-box", "generate", "tls-keypair", subject, "--months", "" + CERTIFICATE_MONTHS ]);
    let key = pem_block(output, "PRIVATE KEY");
    let certificate = pem_block(output, "CERTIFICATE");
    if (key == "" || certificate == "")
        return false;

    if (!common.ensure_dir(common.parent_dir(key_path)) || !common.ensure_dir(common.parent_dir(certificate_path)))
        return false;
    if (!write_private_file(key_path, key + "\n") || !common.write_file(certificate_path, certificate + "\n"))
        return false;

    common.write_file(expiry_path(certificate_path), sprintf("%d\n", time() + CERTIFICATE_MONTHS * 30 * 24 * 3600));
    return true;
}

// Forkop may replace what it issued into its own directory; a path the user chose
// is theirs.
function certificate_is_managed(certificate_path, key_path) {
    let prefix = paths.certificates + "/";
    return substr(certificate_path, 0, length(prefix)) == prefix && substr(key_path, 0, length(prefix)) == prefix;
}

// The expiry is stored next to the certificate because the router has no tool
// that reads it out of the certificate; a pair without the stamp is replaced.
function certificate_needs_replacement(certificate_path, key_path) {
    if (!nonempty_file(certificate_path) || !nonempty_file(key_path))
        return true;
    let stamp = trim(fs.readfile(expiry_path(certificate_path)) ?? "");
    return match(stamp, /^[0-9]+$/) == null || int(stamp) - time() < CERTIFICATE_RENEW_SECONDS;
}

function certificate_sha256_of(path) {
    if (!valid_file_path(path))
        return "";
    let pem = pem_block(fs.readfile(path), "CERTIFICATE");
    let der = pem == "" ? null : b64dec(replace(replace(pem, /-----[A-Z ]+-----/g, ""), /[\r\n\t ]/g, ""));
    if (der == null || der == "")
        return "";

    let now = clock();
    let temporary = sprintf("/tmp/forkop-certificate.%d.%d.der", now[0], now[1]);
    if (!common.write_file(temporary, der))
        return "";
    let output = exec.output([ "sha256sum", temporary ]);
    fs.unlink(temporary);
    let fingerprint = split(trim(output ?? ""), " ")[0];
    return match(fingerprint, /^[0-9a-f]{64}$/) ? fingerprint : "";
}

// What a client checks the certificate against: the SNI, else the address the
// links carry, else the name the server is shown under.
function certificate_subject(name) {
    return trim(get(name, "tls_server_name")) || trim(get(name, "public_host")) || trim(get(name, "label")) || name;
}

function prepare_certificate(name, security) {
    if (security != "tls")
        return;

    let certificate_path = get(name, "tls_certificate_path");
    let key_path = get(name, "tls_key_path");
    // The dialog asks for both paths and its button fills them in; a server with
    // neither was never configured, and the runtime check names the field.
    if (certificate_path == "" && key_path == "")
        return;

    if (!valid_file_path(certificate_path))
        die("Server '" + name + "' has invalid TLS certificate path. Specify a file path. Aborted.");
    if (!valid_file_path(key_path))
        die("Server '" + name + "' has invalid TLS key path. Specify a file path. Aborted.");
    if (certificate_path == key_path)
        die("Server '" + name + "' has the same TLS certificate and key path. Specify different files. Aborted.");

    if (!certificate_is_managed(certificate_path, key_path) || !certificate_needs_replacement(certificate_path, key_path))
        return;

    exec.log("info", "Generating self-signed TLS certificate for server '" + name + "'");
    if (!issue_certificate_files(certificate_subject(name), certificate_path, key_path))
        die("Failed to generate TLS certificate for server '" + name + "'. Aborted.");
}

// sing-box invents a host key when it is given none, a new one on every start,
// so every client would meet a changed fingerprint after every reload.
function write_ssh_host_key(key_path) {
    let directory = common.parent_dir(key_path) || "/";
    if (!common.ensure_dir(directory))
        return false;
    let now = clock();
    let temporary = sprintf("%s/.forkop-ssh.%d.%d", directory, now[0], now[1]);
    if (!fs.mkdir(temporary, 0700))
        return false;

    let dropbear_key = temporary + "/dropbear";
    let openssh_key = temporary + "/openssh";
    let generated = exec.ok([ "dropbearkey", "-t", "ed25519", "-f", dropbear_key ]) &&
        exec.ok([ "dropbearconvert", "dropbear", "openssh", dropbear_key, openssh_key ]) &&
        fs.chmod(openssh_key, 0600) &&
        fs.rename(openssh_key, key_path);

    common.remove_tree(temporary);
    return !!generated;
}

function prepare_ssh_host_keys(name) {
    for (let key_path in common.words(get(name, "ssh_host_key_path"))) {
        if (!valid_file_path(key_path))
            die("Server '" + name + "' has invalid SSH host key path. Specify a file path. Aborted.");
        if (nonempty_file(key_path))
            continue;
        if (!write_ssh_host_key(key_path))
            die("Failed to generate persistent SSH host key for server '" + name + "'. Aborted.");
    }
}

function clients_of(name) {
    return filter(section_names("server_client"), (client) => get(client, "server") == name);
}

// An account name goes on the wire, so it is kept to the characters the login
// protocols carry; a name that already fits is compared byte for byte by them
// and stays exactly as it was typed.
function login_safe_name(value, fallback) {
    if (match(value, /^[A-Za-z0-9._-]+$/))
        return value;
    let result = replace(replace(value, /[^A-Za-z0-9._-]/g, "-"), /^-+|-+$/g, "");
    return result == "" ? fallback : result;
}

function mtproto_secret_parts(value) {
    value = lc(value);
    if (match(value, /^[0-9a-f]{32}$/))
        return { secret: value, faketls: "" };
    if (match(value, /^ee[0-9a-f]{32}([0-9a-f]{2})+$/))
        return { secret: substr(value, 2, 32), faketls: hexdec(substr(value, 34)) ?? "" };
    return { secret: "", faketls: "" };
}

// Client names and MTProto secrets are normalised, never invented: a client with
// no credentials is reported by the validator instead.
function prepare_clients(name, protocol) {
    if (length(servers.CLIENT_FIELDS[protocol] ?? []) == 0)
        return;

    for (let client in clients_of(name)) {
        let client_name = trim(get(client, "name"));
        if (servers.LOGIN_NAME_PROTOCOLS[protocol])
            client_name = login_safe_name(client_name, login_safe_name(get(name, "label", name), file_name(name)));
        else if (client_name == "")
            client_name = get(name, "label", name);
        set_value(client, "name", client_name);

        if (protocol == "mtproto") {
            let raw = get(client, "secret");
            let parts = mtproto_secret_parts(raw);
            if (parts.secret != "" && parts.secret != raw)
                set_value(client, "secret", parts.secret);
            set_value(name, "mtproto_faketls", parts.faketls);
        }
    }
}

// A disabled server is left as it is: nothing runs it, and the validator does not
// look at it either. The security mode is derived wherever it is read.
function prepare_server(name) {
    if (get(name, "enabled", "1") == "0")
        return;
    let protocol = get(name, "protocol", "vless");
    if (servers.CLIENT_FIELDS[protocol] == null)
        die("Server '" + name + "' has unsupported protocol '" + protocol + "'. Aborted.");

    set_if_empty(name, "protocol", protocol);
    set_if_empty(name, "label", name);
    set_if_empty(name, "enabled", "1");
    set_if_empty(name, "routing_mode", "rules");

    if (protocol == "json_inbound")
        return;
    if (protocol == "tailscale") {
        set_if_empty(name, "tailscale_control_url", "https://controlplane.tailscale.com");
        return;
    }

    set_if_empty(name, "listen", "0.0.0.0");
    if (protocol == "shadowsocks")
        set_if_empty(name, "shadowsocks_method", "2022-blake3-aes-256-gcm");
    if (protocol == "ssh")
        prepare_ssh_host_keys(name);

    prepare_clients(name, protocol);
    prepare_certificate(name, servers.effective_security(uci.get_all(CONFIG_NAME, name) ?? {}, protocol));
}

// Nothing is removed while there are no servers at all: an empty list cannot be
// told from a list that could not be read.
function remove_orphaned_clients(names) {
    for (let client in section_names("server_client")) {
        let owner = get(client, "server");
        if (owner != "" && index(names, owner) >= 0)
            continue;
        exec.log("info", "Removing client '" + client + "' of a server that no longer exists");
        if (uci.delete(CONFIG_NAME + "." + client))
            changed = true;
    }
}

// A file in Forkop's own directories belongs to a server when a path of any
// server points at it or when it carries the name Forkop gives a server's files.
function owned_files(names) {
    let owned = {};
    for (let name in names) {
        let base = file_name(name);
        for (let file in [ base + ".crt", base + ".key", base + ".crt.expires" ])
            owned[paths.certificates + "/" + file] = true;
        owned[paths.ssh_keys + "/" + base + ".key"] = true;

        for (let key in [ "tls_certificate_path", "tls_key_path", "ssh_host_key_path" ])
            for (let path in common.words(get(name, key))) {
                owned[path] = true;
                owned[expiry_path(path)] = true;
            }
    }
    return owned;
}

// A file issued in the last hour can belong to a server whose dialog is still
// open, and whose section is not saved yet.
function remove_orphaned_files(names) {
    let owned = owned_files(names);
    for (let directory in [ paths.certificates, paths.ssh_keys ])
        for (let file in fs.lsdir(directory) ?? []) {
            let path = directory + "/" + file;
            let stat = fs.stat(path);
            if (owned[path] || stat?.type != "file" || time() - stat.mtime < ORPHAN_MIN_AGE)
                continue;
            exec.log("info", "Removing '" + path + "' of a server that no longer exists");
            fs.unlink(path);
        }
}

// The defaults, names, keys and certificates the servers need before the
// configuration is validated. Only additions: what removed servers left behind
// goes once the configuration is known good, so a refused one loses nothing.
function prepare() {
    changed = false;
    for (let name in section_names("server"))
        prepare_server(name);
    if (changed)
        uci.commit(CONFIG_NAME);
}

function remove_orphans() {
    changed = false;
    let names = section_names("server");
    if (length(names) == 0)
        return;
    remove_orphaned_clients(names);
    remove_orphaned_files(names);
    if (changed)
        uci.commit(CONFIG_NAME);
}

function firewall_ports() {
    let ports = { tcp: [], udp: [] };
    for (let name in section_names("server")) {
        let protocol = get(name, "protocol", "vless");
        if (servers.CLIENT_FIELDS[protocol] == null || protocol == "tailscale" || protocol == "json_inbound")
            continue;
        if (get(name, "enabled", "1") == "0" || get(name, "open_firewall", "1") == "0")
            continue;

        let port = get(name, "listen_port");
        if (!match(port, /^[0-9]+$/) || int(port) < 1 || int(port) > 65535)
            continue;

        let network = protocol == "naive" ? get(name, "naive_network", "tcp")
            : protocol == "mieru" ? get(name, "mieru_transport", "TCP") : "";
        for (let proto in servers.transports(protocol, network))
            if (ports[proto] != null && index(ports[proto], port) < 0)
                push(ports[proto], port);
    }
    return ports;
}

// fw4 prepends this file to its input chain. nftables takes only a double quoted
// comment; fw4 drops an include with a single quoted one without saying so.
function firewall_include_text() {
    let ports = firewall_ports();
    let rules = [];
    for (let proto in [ "tcp", "udp" ])
        if (length(ports[proto]) > 0)
            push(rules, "meta l4proto " + proto + " th dport { " + join(", ", ports[proto]) +
                " } counter accept comment \"" + FIREWALL_COMMENT + "\"");
    if (length(rules) == 0)
        return "";
    return "# Written by Forkop from the Servers tab. Do not edit: it is rewritten on\n" +
        "# every apply. fw4 prepends this file to its own input chain.\n" + join("\n", rules) + "\n";
}

// fw4 reads the include only while it builds its ruleset, so the file being right
// says nothing about the chain that is loaded.
function firewall_rules_loaded() {
    let chain = exec.output([ "nft", "list", "chain", "inet", "fw4", "input" ]);
    return chain != null && index(chain, FIREWALL_COMMENT) >= 0;
}

function reload_firewall() {
    // A firewall that is not loaded reads the file the next time it starts.
    if (!executable(paths.firewall_init) || !exec.ok([ "nft", "list", "chain", "inet", "fw4", "input" ]))
        return;
    if (!exec.ok([ paths.firewall_init, "reload" ]))
        exec.log("warn", "Failed to reload the firewall; server ports stay closed until it is reloaded");
}

// The firewall is reloaded whenever the loaded chain disagrees with the file, not
// only when the file changed: a failed reload or one by somebody else would
// otherwise leave the ports wrong until the next change.
function sync_firewall(clear) {
    let wanted = clear ? "" : firewall_include_text();
    let current = fs.readfile(paths.firewall_include) ?? "";
    let file_changed = current != wanted;

    if (file_changed) {
        if (wanted == "")
            fs.unlink(paths.firewall_include);
        else if (!common.write_file_atomic(paths.firewall_include, wanted)) {
            exec.log("warn", "Failed to write " + paths.firewall_include);
            return;
        }
    }

    if (file_changed || (wanted == "") == firewall_rules_loaded())
        reload_firewall();
}

function reality_keypair() {
    let output = exec.output([ "sing-box", "generate", "reality-keypair" ]) ?? "";
    let private_key = match(output, /(^|\n)PrivateKey:[ \t]*([^\r\n]+)/);
    let public_key = match(output, /(^|\n)PublicKey:[ \t]*([^\r\n]+)/);
    if (private_key == null || public_key == null)
        die("Failed to generate Reality key pair");
    return { private_key: private_key[2], public_key: public_key[2] };
}

function issue_certificate(subject, name) {
    subject = trim(subject);
    name = file_name(trim(name));
    if (subject == "" || name == "")
        die("Missing certificate subject or name");

    let certificate_path = paths.certificates + "/" + name + ".crt";
    let key_path = paths.certificates + "/" + name + ".key";
    if (!valid_file_path(certificate_path) || !valid_file_path(key_path))
        die("Invalid certificate name");
    if (!issue_certificate_files(subject, certificate_path, key_path))
        die("Failed to generate the TLS certificate");

    return { certificate_path, key_path, sha256: certificate_sha256_of(certificate_path) };
}

function issue_ssh_host_key(name) {
    name = file_name(trim(name));
    if (name == "")
        die("Missing host key name");

    let key_path = paths.ssh_keys + "/" + name + ".key";
    if (!valid_file_path(key_path))
        die("Invalid host key name");
    if (!write_ssh_host_key(key_path))
        die("Failed to generate the SSH host key");
    return { key_path };
}

function certificate_sha256(name) {
    if (name == "")
        die("Missing server section");
    if (servers.effective_security(uci.get_all(CONFIG_NAME, name) ?? {}, get(name, "protocol", "vless")) != "tls")
        die("Server does not use TLS");

    let certificate_path = get(name, "tls_certificate_path");
    if (certificate_path == "")
        die("TLS certificate path is empty");
    let sha256 = certificate_sha256_of(certificate_path);
    if (sha256 == "")
        die("Failed to read TLS certificate fingerprint");
    return { sha256 };
}

return { paths, prepare, remove_orphans, sync_firewall, reality_keypair, issue_certificate, issue_ssh_host_key, certificate_sha256 };
