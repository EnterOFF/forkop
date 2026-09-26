// The Clash API transport the LuCI pages fall back to when the browser cannot
// reach the controller itself - an HTTPS page, a firewalled port, a host that
// only serves LuCI. A page on it asks for something every couple of seconds, so
// it loads nothing beyond core and the constants.

let fs = require("fs");
let common = require("core.common");
let exec = require("core.exec");
let singbox_constants = require("singbox.constants");
let uci = require("core.uci");

const CONFIG_NAME = "forkop";
const DEFAULT_PORT = singbox_constants.CLASH_API_CONTROLLER_PORT;
const MAX_TIME = "60";
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

// The address the running configuration told sing-box to bind, which is the
// socket it listens on - a wildcard bind is reached over the loopback - and the
// secret it expects.
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

// Only what the dashboard and monitoring pages drive is reachable, so a page
// cannot turn the transport into an arbitrary client of the sing-box control
// plane.
function allowed(method, path, body) {
    if (path == "" || length(path) > 4096 || match(path, /[\r\n ]/))
        return false;

    if (method == "GET") {
        if (body != "")
            return false;
        if (path == "/proxies" || path == "/providers/proxies" || path == "/connections")
            return true;
        let query = index(path, "?");
        if (query < 0) {
            let link = segments(path, "/proxies/");
            return length(link) == 2 && link[1] == "link";
        }
        let delay = segments(substr(path, 0, query), "/");
        return length(delay) == 3 && delay[2] == "delay" && (delay[0] == "proxies" || delay[0] == "group") &&
            match(substr(path, query), /^\?url=[^&]+&timeout=[0-9]+$/) != null;
    }

    if (method == "DELETE")
        return body == "" && (path == "/connections" || length(segments(path, "/connections/")) == 1);

    if (method == "PUT") {
        // A refresh of every rule provider or of one, and of one proxy provider.
        if (path == "/providers/rules" || length(segments(path, "/providers/rules/")) == 1 ||
            length(segments(path, "/providers/proxies/")) == 1)
            return body == "";
        // A selector or fallback pin; an empty name unpins.
        if (length(segments(path, "/proxies/")) != 1)
            return false;
        let payload = common.parse_json(body);
        return type(payload) == "object" && length(keys(payload)) == 1 && type(payload.name) == "string";
    }

    return false;
}

// Runs `run` on curl's arguments for a request to `path`, with the secret in
// a 0600 file rather than on the command line, where any process on the router
// can read it. The file is gone once `run` returns.
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
    let result = run([ "curl", ...(header == null ? [] : [ "--header", "@" + header ]), ...options, "http://" + api.endpoint + path ]);
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

    let options = [ "-sS", "--path-as-is", "--connect-timeout", "3", "--max-time", MAX_TIME, "-X", method ];
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

// The four numbers the Dashboard reads out of a snapshot that carries every open
// connection, which through rpcd would be refused past about 256 KB. An answer
// the controller gave as an error is passed on as it is.
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
            memory: payload.memory || 0,
            connections: type(payload.connections) == "array" ? length(payload.connections) : 0
        })
    };
}

return { controller, curl, request, summary };
