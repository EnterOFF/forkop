#!/usr/bin/env ucode
// The Clash API transport the LuCI pages fall back to when the browser cannot
// reach the controller itself - an HTTPS page, a firewalled port, a host that
// only serves LuCI.
//
// It lives here rather than in diagnostics/runtime.uc because a page on this
// transport asks for something every couple of seconds, and the diagnostics
// module pulls in the whole runtime graph - DNS, inbounds, reports, firewall,
// health - to do it. Loading that graph and asking the sing-box runtime for the
// listen address cost about 240ms per request on a mipsel router, against the
// 50ms the request itself takes.
let fs = require("fs");
let common = require("core.common");
let constants = require("core.constants");
let uci_core = require("core.uci");

let as_string = common.as_string;
let object_or_empty = common.object_or_empty;
let option = common.option;

const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || constants.FORKOP_CONFIG_NAME || "forkop";
const CLASH_API_CONTROLLER_PORT = getenv("SB_CLASH_API_CONTROLLER_PORT") ||
    constants.SB_CLASH_API_CONTROLLER_PORT || "9090";
const CLASH_HTTP_MAX_TIME = getenv("FORKOP_CLASH_HTTP_MAX_TIME") || "60";
const CLASH_HTTP_STATUS_MARKER = "__FORKOP_CLASH_STATUS__";

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function command_from_args(args) {
    let parts = [];
    for (let arg in args)
        push(parts, shell_quote(arg));
    return join(" ", parts);
}

function command_capture(command) {
    let pipe = fs.popen(command, "r");
    if (!pipe)
        return { status: 1, output: "" };

    let data = pipe.read("all");
    let status = pipe.close();
    return { status, output: data == null ? "" : as_string(data) };
}

function settings() {
    return object_or_empty(uci_core.get_all(CONFIG_NAME, "settings"));
}

// sing-box listens on what the generated configuration told it to listen on, so
// that file is the address rather than a description of it: recomputing the
// interface address here would also answer differently from the running core
// after a LAN address change that has not been applied yet.
function controller_endpoint(cfg) {
    let config = common.read_json_file(option(cfg, "config_path", ""));
    let experimental = object_or_empty(object_or_empty(config).experimental);
    let controller = as_string(object_or_empty(experimental.clash_api).external_controller);

    if (controller == "")
        return "127.0.0.1:" + CLASH_API_CONTROLLER_PORT;

    let separator = -1;
    for (let i = 0; i < length(controller); i++)
        if (substr(controller, i, 1) == ":")
            separator = i;
    if (separator < 0)
        return controller + ":" + CLASH_API_CONTROLLER_PORT;

    let host = substr(controller, 0, separator);
    let port = substr(controller, separator + 1);

    // A wildcard is what the controller binds, not somewhere to connect to. The
    // loopback reaches it whichever address it accepted the socket on.
    if (host == "" || host == "0.0.0.0" || host == "::" || host == "[::]")
        host = "127.0.0.1";

    return host + ":" + (port == "" ? CLASH_API_CONTROLLER_PORT : port);
}

function clash_auth_args(cfg) {
    let secret = option(cfg, "yacd_secret_key", "");
    if (secret == "")
        return [];
    return [ "--header", "Authorization: Bearer " + secret ];
}

function clash_http_safe_segment(value) {
    value = as_string(value);
    return value != "" && value != "." && value != ".." &&
        match(value, /^[^\/?#]+$/) != null;
}

function clash_http_path_segments(path, prefix) {
    path = as_string(path);
    prefix = as_string(prefix);
    if (substr(path, 0, length(prefix)) != prefix)
        return null;

    let rest = substr(path, length(prefix));
    let segments = rest == "" ? [] : split(rest, "/");
    for (let segment in segments)
        if (!clash_http_safe_segment(segment))
            return null;
    return segments;
}

function parse_json_or_null(value) {
    try {
        return json(as_string(value));
    }
    catch (e) {
        return null;
    }
}

// Only the endpoints the dashboard and monitoring pages actually drive are
// reachable through this transport, so a compromised page cannot turn it into
// an arbitrary HTTP client for the sing-box control plane.
function clash_http_allowed(method, path, body) {
    method = uc(as_string(method));
    path = as_string(path);
    body = as_string(body);

    if (path == "" || length(path) > 4096 ||
        index(path, "\r") >= 0 || index(path, "\n") >= 0 || index(path, " ") >= 0)
        return false;

    if (method == "GET") {
        if (body != "")
            return false;
        if (path == "/proxies" || path == "/providers/proxies" || path == "/connections")
            return true;

        let query = index(path, "?");
        if (query < 0) {
            let link = clash_http_path_segments(path, "/proxies/");
            return length(link) == 2 && link[1] == "link";
        }

        let delay = clash_http_path_segments(substr(path, 0, query), "/");
        if (length(delay) != 3 || delay[2] != "delay" ||
            (delay[0] != "proxies" && delay[0] != "group"))
            return false;
        return match(substr(path, query), /^\?url=[^&]+&timeout=[0-9]+$/) != null;
    }

    if (method == "DELETE") {
        if (body != "")
            return false;
        if (path == "/connections")
            return true;
        return length(clash_http_path_segments(path, "/connections/")) == 1;
    }

    if (method == "PUT") {
        if (path == "/providers/rules")
            return body == "";
        if (length(clash_http_path_segments(path, "/providers/proxies/")) == 1)
            return body == "";
        if (length(clash_http_path_segments(path, "/proxies/")) != 1)
            return false;
        let payload = parse_json_or_null(body);
        return type(payload) == "object" && length(keys(payload)) == 1 &&
            type(payload.name) == "string" && payload.name != "";
    }

    return false;
}

// The original status and body are returned untouched so the caller sees the
// same result it would have seen from a direct request. A failure comes back as
// { ok: false, code }, with the reason already warned about.
function clash_request(method, path, body) {
    if (!clash_http_allowed(method, path, body)) {
        warn("Clash API request is not allowlisted: " + method + " " + path + "\n");
        return { ok: false, code: 1 };
    }

    let cfg = settings();
    let args = [
        "curl", "-sS", "--path-as-is",
        "--connect-timeout", "3", "--max-time", as_string(CLASH_HTTP_MAX_TIME),
        "-X", method
    ];
    for (let item in clash_auth_args(cfg))
        push(args, item);
    if (body != "") {
        push(args, "--header");
        push(args, "Content-Type: application/json");
        push(args, "--data-raw");
        push(args, body);
    }
    push(args, "-w");
    push(args, CLASH_HTTP_STATUS_MARKER + "%{http_code}");
    push(args, "http://" + controller_endpoint(cfg) + path);

    let result = command_capture(command_from_args(args));
    // The status marker is appended after the body, so the last field is the
    // HTTP status and everything before it is the untouched response body.
    let parts = split(result.output, CLASH_HTTP_STATUS_MARKER);
    if (result.status != 0 || length(parts) < 2) {
        warn("Clash API request failed: " + method + " " + path + "\n");
        return { ok: false, code: result.status != 0 ? result.status : 1 };
    }

    let status = int(parts[length(parts) - 1], 10) || 0;
    if (status < 100 || status > 599) {
        warn("Clash API returned no HTTP status: " + method + " " + path + "\n");
        return { ok: false, code: 1 };
    }

    return {
        ok: true,
        status: status,
        body: join(CLASH_HTTP_STATUS_MARKER, slice(parts, 0, length(parts) - 1))
    };
}

function clash_http(method, path, body) {
    let response = clash_request(uc(as_string(method)), as_string(path), as_string(body));
    if (!response.ok)
        return response.code;

    common.write_json({ status: response.status, body: response.body });
    return 0;
}

// The Dashboard widgets read four numbers out of a snapshot that carries every
// open connection. Through this transport that snapshot would cross ubus, which
// refuses a reply past about 256KB - a few hundred connections - so the numbers
// are taken here, out of a payload the page would have discarded anyway.
// Parsing it costs 88ms for 300 connections on an MT7621 and nothing at all for
// the handful a quiet router has.
//
// The reply keeps the transport's envelope, so a controller that answered with
// an error is read by the page exactly as it reads one from clash_http.
function clash_summary() {
    let response = clash_request("GET", "/connections", "");
    if (!response.ok)
        return response.code;

    let payload = response.status >= 200 && response.status < 300 ?
        parse_json_or_null(response.body) : null;

    if (type(payload) != "object") {
        common.write_json({ status: response.status, body: response.body });
        return 0;
    }

    common.write_json({
        status: response.status,
        body: sprintf("%J", {
            downloadTotal: payload.downloadTotal || 0,
            uploadTotal: payload.uploadTotal || 0,
            memory: payload.memory || 0,
            connections: type(payload.connections) == "array" ? length(payload.connections) : 0
        })
    });
    return 0;
}

let mode = ARGV[0];

if (mode == "request")
    exit(clash_http(ARGV[1], ARGV[2], ARGV[3]));
else if (mode == "summary")
    exit(clash_summary());
else if (mode == "controller-endpoint-fixture")
    print(controller_endpoint(settings()), "\n");
else if (mode == "allowed-fixture")
    exit(clash_http_allowed(ARGV[1], ARGV[2], ARGV[3]) ? 0 : 1);
else {
    warn("Usage: singbox/clash_http.uc <request|summary|controller-endpoint-fixture|allowed-fixture> ...\n");
    exit(1);
}
