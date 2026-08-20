#!/usr/bin/env ucode

let fs = require("fs");
let uci = require("core.uci");

const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || "forkop";

function as_string(value) {
    return value == null ? "" : "" + value;
}

function write_json(value) {
    print(sprintf("%J", value), "\n");
}

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function run(command) {
    return system(command) == 0;
}

function output(command) {
    let pipe = fs.popen(command, "r");
    if (!pipe)
        return "";

    let data = pipe.read("all");
    let status = pipe.close();
    if (status != 0 || data == null)
        return "";

    return replace(as_string(data), /[\r\n]+$/g, "");
}

function log(message, level) {
    level = as_string(level || "info");
    run("logger -t " + shell_quote("forkop") + " " + shell_quote("[" + level + "] " + as_string(message)));
}

function fatal(message) {
    log(message, "error");
    exit(1);
}

function uci_get(path) {
    return uci.get(path);
}

function uci_set(path, value) {
    return uci.set(path, value);
}

function uci_commit(package_name) {
    return uci.commit(package_name);
}

function words(value) {
    value = trim(as_string(value));
    return value == "" ? [] : split(value, /[ \t\r\n]+/);
}

function uci_sections(type_name) {
    return uci.sections(CONFIG_NAME, type_name);
}

function config_path(section, option) {
    return CONFIG_NAME + "." + as_string(section) + "." + as_string(option);
}

function config_get(section, option, fallback) {
    let value = uci_get(config_path(section, option));
    return value == "" ? as_string(fallback || "") : value;
}

let SERVER_DEFAULTS_CHANGED = false;

function server_default_set_option(section, option, value) {
    value = as_string(value);
    if (value == "")
        return;
    if (uci_get(config_path(section, option)) != "")
        return;
    if (uci_set(config_path(section, option), value))
        SERVER_DEFAULTS_CHANGED = true;
}

function server_set_option(section, option, value) {
    value = as_string(value);
    if (value == "")
        return;
    if (uci_get(config_path(section, option)) == value)
        return;
    if (uci_set(config_path(section, option), value))
        SERVER_DEFAULTS_CHANGED = true;
}

function regex_matches(value, pattern) {
    pattern = as_string(pattern);
    if (pattern == "")
        return false;

    try {
        return match(as_string(value), regexp(pattern)) != null;
    }
    catch (e) {
        return false;
    }
}

function valid_file_path(value) {
    value = as_string(value);
    return value != "" &&
        value != "/" &&
        substr(value, length(value) - 1) != "/" &&
        regex_matches(value, "^/[A-Za-z0-9_./-]+$");
}

function str_endswith(value, suffix) {
    value = as_string(value);
    suffix = as_string(suffix);
    return length(value) >= length(suffix) && substr(value, length(value) - length(suffix)) == suffix;
}

function str_remove_suffix(value, suffix) {
    value = as_string(value);
    suffix = as_string(suffix);
    return str_endswith(value, suffix) ? substr(value, 0, length(value) - length(suffix)) : value;
}

function mtproto_base_secret_value(value) {
    value = lc(as_string(value));
    if (regex_matches(value, "^[0-9a-f]{32}$"))
        return value;
    if (regex_matches(value, "^ee[0-9a-f]{32}([0-9a-f]{2})+$"))
        return substr(value, 2, 32);
    return "";
}

function hex_digit_value(value) {
    value = ord(lc(as_string(value)));
    if (value >= 48 && value <= 57)
        return value - 48;
    if (value >= 97 && value <= 102)
        return value - 87;
    return -1;
}

function hex_to_string_value(value) {
    value = as_string(value);
    if (length(value) == 0 || length(value) % 2 != 0 || !regex_matches(value, "^([0-9a-fA-F]{2})+$"))
        return null;

    let result = "";
    for (let i = 0; i < length(value); i += 2) {
        let high = hex_digit_value(substr(value, i, 1));
        let low = hex_digit_value(substr(value, i + 1, 1));
        if (high < 0 || low < 0)
            return null;
        result += chr(high * 16 + low);
    }
    return result;
}

function mtproto_faketls_value(value) {
    value = lc(as_string(value));
    if (!regex_matches(value, "^ee[0-9a-f]{32}([0-9a-f]{2})+$"))
        return "";
    let result = hex_to_string_value(substr(value, 34));
    return result == null ? "" : result;
}

function error_response(message) {
    write_json({
        success: false,
        message: as_string(message)
    });
}

function reality_keypair_response(private_key, public_key) {
    write_json({
        success: true,
        private_key: as_string(private_key),
        public_key: as_string(public_key)
    });
}

function tls_fingerprint_response(fingerprint) {
    write_json({
        success: true,
        sha256: as_string(fingerprint)
    });
}

function first_key_value_line_value(data, prefix) {
    prefix = as_string(prefix);
    for (let line in split(as_string(data), "\n")) {
        line = as_string(line);
        if (!regex_matches(line, "^" + prefix + ":"))
            continue;

        let value = substr(line, length(prefix) + 1);
        return replace(value, /^[ \t\r]*/, "");
    }

    return null;
}

function pem_block(data, begin_marker, end_marker) {
    let lines = [];
    let in_block = false;

    for (let line in split(as_string(data), "\n")) {
        line = str_remove_suffix(as_string(line), "\r");
        if (!in_block && line != begin_marker)
            continue;

        in_block = true;
        push(lines, line);

        if (line == end_marker)
            return join("\n", lines);
    }

    return "";
}

function valid_sha256_hex(value) {
    return regex_matches(value, "^[0-9a-f]{64}$");
}

function default_security_value(protocol) {
    protocol = as_string(protocol);
    if (protocol == "vless")
        return "reality";
    if (protocol == "trojan" || protocol == "hysteria2" || protocol == "naive" ||
        protocol == "anytls" || protocol == "tuic")
        return "tls";
    return "none";
}

function server_effective_security_value(section, protocol) {
    protocol = as_string(protocol);
    let security = config_get(section, "security", "");
    if (security == "")
        security = default_security_value(protocol);

    if (protocol == "shadowsocks" || protocol == "socks" || protocol == "ssh" || protocol == "mieru" ||
        protocol == "mtproto" || protocol == "tailscale" || protocol == "json_inbound")
        security = "none";
    else if (protocol == "hysteria2" || protocol == "naive" || protocol == "anytls" || protocol == "tuic")
        security = "tls";
    else if ((protocol == "vmess" || protocol == "trojan") && security == "reality")
        security = default_security_value(protocol);

    return security;
}

function generate_reality_keypair_values() {
    let data = output("sing-box generate reality-keypair 2>/dev/null");
    let private_key = first_key_value_line_value(data, "PrivateKey");
    let public_key = first_key_value_line_value(data, "PublicKey");

    if (private_key == null || public_key == null || private_key == "" || public_key == "")
        return null;

    return {
        private_key: private_key,
        public_key: public_key
    };
}

function generate_reality_keypair_cli() {
    let pair = generate_reality_keypair_values();
    if (pair == null) {
        error_response("Failed to generate Reality key pair");
        exit(1);
    }

    reality_keypair_response(pair.private_key, pair.public_key);
}

function write_tls_keypair_data(data, key_path, certificate_path) {
    let key = pem_block(data, "-----BEGIN PRIVATE KEY-----", "-----END PRIVATE KEY-----");
    let cert = pem_block(data, "-----BEGIN CERTIFICATE-----", "-----END CERTIFICATE-----");

    if (key == "" || cert == "")
        return false;

    return fs.writefile(key_path, key + "\n") && fs.writefile(certificate_path, cert + "\n");
}

function server_generate_tls_keypair_files(server_name, certificate_path, key_path) {
    let data = output("sing-box generate tls-keypair " + shell_quote(server_name) + " 2>/dev/null");
    if (data == "")
        return false;

    let key_dir = replace(as_string(key_path), /\/[^\/]*$/, "");
    let cert_dir = replace(as_string(certificate_path), /\/[^\/]*$/, "");
    if (!run("mkdir -p " + shell_quote(key_dir) + " " + shell_quote(cert_dir)))
        return false;

    if (!write_tls_keypair_data(data, key_path, certificate_path))
        return false;

    run("chmod 600 " + shell_quote(key_path) + " >/dev/null 2>&1");
    return true;
}

function certificate_base64_text(path) {
    let data = fs.readfile(path);
    let cert = pem_block(data, "-----BEGIN CERTIFICATE-----", "-----END CERTIFICATE-----");
    let lines = [];

    if (cert == "")
        return "";

    for (let line in split(cert, "\n")) {
        line = replace(as_string(line), /\r/g, "");
        if (line == "-----BEGIN CERTIFICATE-----" || line == "-----END CERTIFICATE-----" || line == "")
            continue;
        push(lines, line);
    }

    return length(lines) == 0 ? "" : join("\n", lines) + "\n";
}

function server_tls_certificate_sha256_from_file(certificate_path) {
    if (!valid_file_path(certificate_path))
        return "";
    let base64_text = certificate_base64_text(certificate_path);
    if (base64_text == "")
        return "";

    let tmp_path = output("mktemp 2>/dev/null");
    if (tmp_path == "")
        return "";

    if (!fs.writefile(tmp_path, base64_text)) {
        fs.unlink(tmp_path);
        return "";
    }

    let fingerprint = output("base64 -d " + shell_quote(tmp_path) + " 2>/dev/null | sha256sum 2>/dev/null");
    fs.unlink(tmp_path);
    fingerprint = substr(fingerprint, 0, index(fingerprint, " ") >= 0 ? index(fingerprint, " ") : length(fingerprint));
    return valid_sha256_hex(fingerprint) ? fingerprint : "";
}

function get_tls_certificate_sha256_cli(section) {
    if (as_string(section) == "") {
        error_response("Missing server section");
        exit(1);
    }

    let protocol = config_get(section, "protocol", "vless");
    let security = server_effective_security_value(section, protocol);
    if (security != "tls") {
        error_response("Server does not use TLS");
        exit(1);
    }

    let certificate_path = config_get(section, "tls_certificate_path", "");
    if (certificate_path == "") {
        error_response("TLS certificate path is empty");
        exit(1);
    }

    let fingerprint = server_tls_certificate_sha256_from_file(certificate_path);
    if (fingerprint == "") {
        error_response("Failed to read TLS certificate fingerprint");
        exit(1);
    }

    tls_fingerprint_response(fingerprint);
}

function safe_filename_string(value) {
    value = as_string(value);
    let result = [];
    for (let i = 0; i < length(value); i++) {
        let chr = substr(value, i, 1);
        push(result, regex_matches(chr, "^[A-Za-z0-9_.-]$") ? chr : "_");
    }
    return join("", result);
}

function server_prepare_tls_defaults(section, protocol, security) {
    if (security != "tls")
        return;
    if (config_get(section, "enabled", "1") == "0")
        return;

    // Only the subject of the generated certificate; nothing is stored, because an
    // empty SNI is a valid TLS server and the form asks for one when Reality needs it.
    let tls_server_name = config_get(section, "tls_server_name", "");
    if (tls_server_name == "")
        tls_server_name = config_get(section, "public_host", "");
    if (tls_server_name == "")
        tls_server_name = as_string(section);

    let certificate_path = config_get(section, "tls_certificate_path", "");
    let key_path = config_get(section, "tls_key_path", "");
    if (certificate_path == "" || key_path == "") {
        let safe_name = safe_filename_string(section);
        let default_dir = "/etc/forkop/server-certs";
        if (certificate_path == "")
            certificate_path = default_dir + "/" + safe_name + ".crt";
        if (key_path == "")
            key_path = default_dir + "/" + safe_name + ".key";
        server_set_option(section, "tls_certificate_path", certificate_path);
        server_set_option(section, "tls_key_path", key_path);
    }

    if (!valid_file_path(certificate_path))
        fatal("Server '" + section + "' has invalid TLS certificate path. Specify a file path. Aborted.");
    if (!valid_file_path(key_path))
        fatal("Server '" + section + "' has invalid TLS key path. Specify a file path. Aborted.");
    if (certificate_path == key_path)
        fatal("Server '" + section + "' has the same TLS certificate and key path. Specify different files. Aborted.");

    if (!run("[ -s " + shell_quote(certificate_path) + " ] && [ -s " + shell_quote(key_path) + " ]")) {
        log("Generating self-signed TLS certificate for server '" + section + "'", "info");
        if (!server_generate_tls_keypair_files(tls_server_name, certificate_path, key_path))
            fatal("Failed to generate TLS certificate for server '" + section + "'. Aborted.");
    }
}

function server_prepare_ssh_host_key(section) {
    let key_paths = words(config_get(section, "ssh_host_key_path", ""));
    if (length(key_paths) == 0) {
        key_paths = [ "/etc/forkop/server-ssh/" + safe_filename_string(section) + ".key" ];
        server_set_option(section, "ssh_host_key_path", key_paths[0]);
    }

    for (let key_path in key_paths) {
        if (!valid_file_path(key_path))
            fatal("Server '" + section + "' has invalid SSH host key path. Specify a file path. Aborted.");
        if (config_get(section, "enabled", "1") == "0" || run("[ -s " + shell_quote(key_path) + " ]"))
            continue;

        let key_dir = replace(key_path, /\/[^\/]*$/, "");
        if (key_dir == "")
            key_dir = "/";
        if (!run("mkdir -p " + shell_quote(key_dir)))
            fatal("Failed to create SSH host key directory for server '" + section + "'. Aborted.");

        let temp_dir = output("mktemp -d " + shell_quote(key_dir + "/.forkop-ssh.XXXXXX") + " 2>/dev/null");
        if (temp_dir == "")
            fatal("Failed to create temporary SSH host key directory for server '" + section + "'. Aborted.");

        let dropbear_key = temp_dir + "/dropbear";
        let openssh_key = temp_dir + "/openssh";
        let generated =
            run("dropbearkey -t ed25519 -f " + shell_quote(dropbear_key) + " >/dev/null 2>&1") &&
            run("dropbearconvert dropbear openssh " + shell_quote(dropbear_key) + " " + shell_quote(openssh_key) + " >/dev/null 2>&1") &&
            run("chmod 600 " + shell_quote(openssh_key) + " >/dev/null 2>&1") &&
            run("mv -f " + shell_quote(openssh_key) + " " + shell_quote(key_path));

        fs.unlink(dropbear_key);
        fs.unlink(openssh_key);
        run("rmdir " + shell_quote(temp_dir) + " >/dev/null 2>&1");
        if (!generated)
            fatal("Failed to generate persistent SSH host key for server '" + section + "'. Aborted.");
    }
}

const SERVER_PROTOCOLS = {
    vless: [ "uuid" ],
    vmess: [ "uuid" ],
    trojan: [ "password" ],
    shadowsocks: [ "password" ],
    hysteria2: [ "password" ],
    tuic: [ "uuid", "password" ],
    anytls: [ "password" ],
    mixed: [ "password" ],
    naive: [ "password" ],
    ssh: [ "password" ],
    mieru: [ "password" ],
    mtproto: [ "secret" ],
    tailscale: [],
    json_inbound: []
};
const SHADOWSOCKS_2022_KEY_BYTES = {
    "2022-blake3-aes-128-gcm": 16,
    "2022-blake3-aes-256-gcm": 32,
    "2022-blake3-chacha20-poly1305": 32
};
const LOGIN_NAME_PROTOCOLS = { mixed: true, naive: true, ssh: true, mieru: true };

function server_client_sections(section) {
    let result = [];
    for (let client in uci_sections("server_client"))
        if (uci_get(config_path(client, "server")) == as_string(section))
            push(result, client);
    return result;
}

function login_safe_name(value, fallback) {
    value = lc(as_string(value));
    let result = "";
    for (let i = 0; i < length(value); i++) {
        let chr = substr(value, i, 1);
        result += regex_matches(chr, "^[a-z0-9._-]$") ? chr : "-";
    }
    result = replace(result, /^-+/, "");
    result = replace(result, /-+$/, "");
    return result == "" ? as_string(fallback) : result;
}

// Client names and MTProto secrets are normalised, never invented: a client with
// no credentials is reported by the validator instead of being given one here.
function prepare_server_clients(section, protocol) {
    let fields = SERVER_PROTOCOLS[protocol];
    if (fields == null || length(fields) == 0)
        return;

    for (let client in server_client_sections(section)) {
        let name = trim(config_get(client, "name", ""));
        if (LOGIN_NAME_PROTOCOLS[protocol]) {
            // The LuCI form transliterates a display name into an account name. A
            // configuration written straight through uci has no such name, so the
            // section name is used: it is always inside the safe character set.
            name = login_safe_name(name, login_safe_name(config_get(section, "label", section), safe_filename_string(section)));
        }
        else if (name == "")
            name = config_get(section, "label", section);
        server_set_option(client, "name", name);

        if (protocol == "mtproto") {
            // A secret pasted in its full ee<hex><host> form carries the FakeTLS host,
            // so it is split back into the stored secret and the server option.
            let raw_secret = config_get(client, "secret", "");
            let base_secret = mtproto_base_secret_value(raw_secret);
            let faketls = mtproto_faketls_value(raw_secret);
            if (base_secret != "" && base_secret != raw_secret)
                server_set_option(client, "secret", base_secret);
            if (faketls != "")
                server_set_option(section, "mtproto_faketls", faketls);
        }
    }
}

function prepare_server_defaults(section) {
    let protocol = config_get(section, "protocol", "vless");
    if (SERVER_PROTOCOLS[protocol] == null)
        fatal("Server '" + section + "' has unsupported protocol '" + protocol + "'. Aborted.");

    server_default_set_option(section, "protocol", protocol);
    server_default_set_option(section, "label", section);
    server_default_set_option(section, "enabled", "1");
    server_default_set_option(section, "routing_mode", "rules");

    if (protocol == "json_inbound") {
        server_set_option(section, "security", "none");
        return;
    }

    let security = server_effective_security_value(section, protocol);
    server_set_option(section, "security", security);

    if (protocol == "tailscale") {
        server_default_set_option(section, "tailscale_control_url", "https://controlplane.tailscale.com");
        return;
    }

    server_default_set_option(section, "listen", "0.0.0.0");

    if (protocol == "shadowsocks")
        server_default_set_option(section, "shadowsocks_method", "2022-blake3-aes-128-gcm");

    if (protocol == "ssh")
        server_prepare_ssh_host_key(section);

    prepare_server_clients(section, protocol);
    server_prepare_tls_defaults(section, protocol, security);
}

// A client whose server is gone would keep its credentials in the configuration and
// show up in diagnostics forever, so it is removed with the server it belonged to.
function remove_orphaned_server_clients() {
    let servers = {};
    for (let section in uci_sections("server"))
        servers[as_string(section)] = true;

    for (let client in uci_sections("server_client")) {
        let owner = uci_get(config_path(client, "server"));
        if (owner != "" && servers[owner])
            continue;
        log("Removing client '" + client + "' of a server that no longer exists", "info");
        if (uci.delete(CONFIG_NAME + "." + as_string(client)))
            SERVER_DEFAULTS_CHANGED = true;
    }
}

function prepare_all_server_defaults() {
    SERVER_DEFAULTS_CHANGED = false;
    for (let section in uci_sections("server"))
        prepare_server_defaults(section);
    remove_orphaned_server_clients();
    if (SERVER_DEFAULTS_CHANGED)
        uci_commit(CONFIG_NAME);
}

let mode = ARGV[0] || "";

if (mode == "prepare-all-defaults")
    prepare_all_server_defaults();
else if (mode == "generate-reality-keypair")
    generate_reality_keypair_cli();
else if (mode == "tls-certificate-sha256")
    get_tls_certificate_sha256_cli(ARGV[1]);
else {
    warn("Usage: server/service.uc <operation> ...\n");
    exit(1);
}
