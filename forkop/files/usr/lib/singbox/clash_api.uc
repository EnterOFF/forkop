// The Clash API transport the pages fall back to when the browser cannot reach the controller.
// It is called every couple of seconds, so it loads nothing beyond core and the constants.

let fs = require("fs");
let common = require("core.common");
let exec = require("core.exec");
let singbox_constants = require("singbox.constants");
let uci = require("core.uci");

const CONFIG_NAME = "forkop";
const DEFAULT_PORT = singbox_constants.CLASH_API_CONTROLLER_PORT;
const STATUS_MARKER = "__FORKOP_CLASH_STATUS__";

function endpoint(address) {
    if (address == "")
        return "127.0.0.1:" + DEFAULT_PORT;

    let separator = rindex(address, ":");
    if (separator < 0)
        return address + ":" + DEFAULT_PORT;
    let host = substr(address, 0, separator);
    let port = substr(address, separator + 1);
    if (host == "" || host == "0.0.0.0" || host == "::" || host == "[::]")
        host = "127.0.0.1";
    return host + ":" + (port == "" ? DEFAULT_PORT : port);
}

// A wildcard bind is reached over loopback.
function controller() {
    let settings = uci.get_all(CONFIG_NAME, "settings") ?? {};
    let clash_api = common.read_json_file(common.option(settings, "config_path", ""))?.experimental?.clash_api;
    return { endpoint: endpoint(common.as_string(clash_api?.external_controller)), secret: common.as_string(clash_api?.secret) };
}

function segments(path, prefix) {
    if (substr(path, 0, length(prefix)) != prefix)
        return null;
    let rest = substr(path, length(prefix));
    let result = rest == "" ? [] : split(rest, "/");
    for (let segment in result)
        if (segment == "" || segment == "." || segment == ".." || match(segment, /[\/?#]/))
            return null;
    return result;
}

// Only what the dashboard and monitoring drive, so the transport is no general control-plane client.
function allowed(method, path, body) {
    if (path == "" || length(path) > 4096 || match(path, /[\r\n ]/))
        return false;

    if (method == "GET") {
        if (body != "")
            return false;
        if (path == "/proxies" || path == "/providers/proxies" || path == "/connections" || path == "/tailscale")
            return true;
        let query = index(path, "?");
        if (query < 0) {
            let link = segments(path, "/proxies/");
            return length(link) == 2 && link[1] == "link";
        }
        let target = segments(substr(path, 0, query), "/");
        if (length(target) != 3)
            return false;
        if (target[0] == "proxies" && target[2] == "exit")
            return match(substr(path, query), /^\?timeout=[0-9]+$/) != null;
        return target[2] == "delay" && (target[0] == "proxies" || target[0] == "group") &&
            match(substr(path, query), /^\?url=[^&]+&timeout=[0-9]+$/) != null;
    }

    if (method == "DELETE")
        return body == "" && (path == "/connections" || length(segments(path, "/connections/")) == 1);

    if (method == "PUT") {
        // A refresh of every rule provider, and of one proxy provider.
        if (path == "/providers/rules" || length(segments(path, "/providers/proxies/")) == 1)
            return body == "";
        // A selector or fallback pin; an empty name unpins.
        if (length(segments(path, "/proxies/")) != 1)
            return false;
        let payload = common.parse_json(body);
        return type(payload) == "object" && length(keys(payload)) == 1 && type(payload.name) == "string";
    }

    return false;
}

// The secret goes in a 0600 file, not on the command line every process can read; the file is
// gone once run returns.
function curl(api, options, path, run) {
    let header = null;
    if (api.secret != "") {
        let now = clock();
        header = sprintf("/tmp/forkop-clash-header.%d.%d", now[0], now[1]);
        let file = fs.open(header, "w", 0600);
        if (!file)
            die("Cannot hand curl the Clash API secret");
        file.write("Authorization: Bearer " + api.secret + "\n");
        file.close();
    }
    let result;
    try {
        result = run([ "curl", "--noproxy", "*", ...(header == null ? [] : [ "--header", "@" + header ]), ...options, "http://" + api.endpoint + path ]);
    }
    catch (e) {
        if (header != null)
            fs.unlink(header);
        die(e.message);
    }
    if (header != null)
        fs.unlink(header);
    return result;
}

// { status, body } exactly as the controller answered, or dies with the reason.
function request(method, path, body) {
    method = uc(method ?? "");
    path = path ?? "";
    body = body ?? "";
    if (!allowed(method, path, body))
        die("Clash API request is not allowlisted: " + method + " " + path);

    let probe = match(path, /\/(delay\?url=[^&]+&|exit\?)timeout=([0-9]+)$/);
    let max_time = method != "GET" ? 60 : probe ? min(60, int((int(probe[2]) + 999) / 1000) + 10) : 5;
    let options = [ "-sS", "--path-as-is", "--connect-timeout", "3", "--max-time", "" + max_time, "-X", method ];
    if (body != "")
        push(options, "--header", "Content-Type: application/json", "--data-raw", body);
    push(options, "-w", STATUS_MARKER + "%{http_code}");

    let result = curl(controller(), options, path, exec.capture);
    // The marker follows the body, so the last field is the status and
    // everything before it the untouched body.
    let parts = split(result.stdout, STATUS_MARKER);
    let status = length(parts) >= 2 ? int(parts[length(parts) - 1]) : 0;
    if (result.status != 0 || length(parts) < 2)
        die("Clash API request failed: " + method + " " + path);
    if (status < 100 || status > 599)
        die("Clash API returned no HTTP status: " + method + " " + path);
    return { status, body: join(STATUS_MARKER, slice(parts, 0, length(parts) - 1)) };
}

// The three numbers the Dashboard reads; the full snapshot would exceed rpcd's limit of about 256 KB.
function summary() {
    let response = request("GET", "/connections", "");
    let payload = response.status >= 200 && response.status < 300 ? common.parse_json(response.body) : null;
    if (type(payload) != "object")
        return response;
    return {
        status: response.status,
        body: sprintf("%J", {
            downloadTotal: payload.downloadTotal || 0,
            uploadTotal: payload.uploadTotal || 0,
            connections: type(payload.connections) == "array" ? length(payload.connections) : 0
        })
    };
}

return { controller, curl, request, summary };
