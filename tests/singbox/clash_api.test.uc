let t = require("t");
let stub = require("stub");
let fs = require("fs");
let fixture = require("fixture");
let repo = require("repo");
let cli = require("service.cli");
let clash = require("singbox.clash_api");

let dir = stub.tmpdir();

function config(controller, secret) {
    let path = dir + "/config.json";
    let clash_api = controller == null ? null : { external_controller: controller, secret: secret ?? "local-secret" };
    fs.writefile(path, sprintf("%J", { experimental: clash_api == null ? {} : { clash_api } }));
    fixture.seed({ settings: { config_path: path, yacd_secret_key: "stale-secret" } });
}

let requests = [];

function controller(status, bodies) {
    requests = [];
    stub.commands([ [ "curl", (argv) => {
        let header = null;
        for (let i = 0; i < length(argv); i++)
            if (argv[i] == "--header" && substr(argv[i + 1], 0, 1) == "@")
                header = fs.readfile(substr(argv[i + 1], 1));
        push(requests, { argv, header });
        let url = argv[length(argv) - 1];
        let body = "";
        for (let suffix, value in bodies ?? {})
            if (substr(url, -length(suffix)) == suffix)
                body = value;
        return { stdout: body + "__FORKOP_CLASH_STATUS__" + (status ?? 204) };
    } ] ]);
}

function call(argv) {
    let result = stub.capture(() => cli.main(argv, "/lib"));
    return { status: result.result, reply: result.stdout == "" ? null : json(result.stdout), stderr: result.stderr };
}

t.test("an allowlisted request reaches the controller as asked, authenticated without the secret on the command line", () => {
    config("192.168.1.1:9090");
    controller(204, { "/link": "{\"url\":\"vless://id@example.com:443\"}" });
    let result = call([ "clash_api", "GET", "/proxies/provider%2Fnode/link" ]);
    stub.restore();
    t.eq([ result.status, result.reply.status, json(result.reply.body).url ], [ 0, 204, "vless://id@example.com:443" ]);
    let argv = join(" ", requests[0].argv);
    t.contains(argv, "--path-as-is");
    t.contains(argv, "-X GET");
    t.contains(argv, "http://192.168.1.1:9090/proxies/provider%2Fnode/link");
    t.excludes(argv, "local-secret");
    t.eq(requests[0].header, "Authorization: Bearer local-secret\n", "the secret is the one sing-box runs with");
    t.eq(fs.glob("/tmp/forkop-clash-header.*"), [], "the header file is removed");

    config("192.168.1.1:9090", "");
    controller(204, {});
    call([ "clash_api", "GET", "/proxies" ]);
    stub.restore();
    t.eq(requests[0].header, null, "a controller without a secret gets no header");
});

t.test("the pages' own requests pass, with their methods and bodies", () => {
    config("0.0.0.0:9090");
    controller(204, {});
    for (let request in [
        [ "GET", "/providers/proxies", "" ],
        [ "GET", "/proxies/proxy-out/delay?url=https%3A%2F%2Flatency.example%2Fgenerate_204&timeout=5000", "" ],
        [ "PUT", "/proxies/main-out", "{\"name\":\"main-1-out\"}" ],
        [ "PUT", "/proxies/fallback-out", "{\"name\":\"\"}" ],
        [ "PUT", "/providers/rules", "" ],
        [ "PUT", "/providers/proxies/main%2Fsub1", "" ],
        [ "DELETE", "/connections/abc-123", "" ]
    ]) {
        let result = call([ "clash_api", ...request ]);
        t.eq(result.status, 0, join(" ", request));
    }
    stub.restore();
    let put = join(" ", requests[2].argv);
    t.contains(put, "-X PUT");
    t.contains(put, "Content-Type: application/json");
    t.contains(join(" ", requests[0].argv), "http://127.0.0.1:9090/providers/proxies", "a wildcard bind is reached over the loopback");
});

t.test("anything else is refused before it reaches the controller", () => {
    config("127.0.0.1:9090");
    controller(204, {});
    for (let request in [ [ "GET", "/configs", "" ], [ "PUT", "/configs", "{\"mode\":\"global\"}" ], [ "POST", "/proxies", "{\"name\":\"x\"}" ],
        [ "GET", "/proxies/../configs", "" ], [ "PUT", "/proxies/main-out", "{\"name\":\"x\",\"extra\":1}" ], [ "PUT", "/proxies/main-out", "not-json" ],
        [ "GET", "/proxies/main-out/delay?url=x&timeout=abc", "" ], [ "DELETE", "/connections", "{\"all\":true}" ],
        [ "PUT", "/providers/rules", "{\"name\":\"geosite\"}" ], [ "PUT", "/providers/rules/geosite", "" ] ]) {
        let result = call([ "clash_api", ...request ]);
        t.eq([ result.status, result.reply ], [ 1, null ], join(" ", request));
        t.contains(result.stderr, "not allowlisted");
    }
    stub.restore();
    t.eq(requests, []);
});

t.test("the controller is the address the configuration bound", () => {
    for (let pair in [ [ "192.168.1.1:9090", "192.168.1.1:9090" ], [ "0.0.0.0:9090", "127.0.0.1:9090" ], [ "[::]:9090", "127.0.0.1:9090" ],
        [ "[fd00::1]:9090", "[fd00::1]:9090" ], [ null, "127.0.0.1:9090" ] ]) {
        config(pair[0]);
        t.eq(clash.controller().endpoint, pair[1], "" + pair[0]);
    }
});

t.test("the summary carries the totals and the count, never the connection list", () => {
    config("127.0.0.1:9090");
    controller(200, { "/connections": "{\"downloadTotal\":10,\"uploadTotal\":20,\"memory\":30,\"connections\":[{\"id\":\"a\",\"metadata\":{}},{\"id\":\"b\"}]}" });
    let result = call([ "clash_summary" ]);
    stub.restore();
    t.eq(json(result.reply.body), { downloadTotal: 10, uploadTotal: 20, connections: 2 });
    t.contains(join(" ", requests[0].argv), "-X GET");

});

t.test("read deadlines are short while delay sweeps and updates retain their budget", () => {
    config("127.0.0.1:9090");
    controller(200, {});
    for (let pair in [
        [ "GET", "/proxies", "5" ],
        [ "GET", "/connections", "5" ],
        [ "GET", "/group/main/delay?url=https%3A%2F%2Fexample.com&timeout=40000", "50" ],
        [ "PUT", "/providers/rules", "60" ]
    ]) {
        clash.request(pair[0], pair[1], "");
        let argv = requests[length(requests) - 1].argv;
        t.eq(argv[index(argv, "--max-time") + 1], pair[2]);
    }
    stub.restore();
});

t.test("the authentication file is removed even when the request runner throws", () => {
    let failed = false;
    try {
        clash.curl({ endpoint: "127.0.0.1:9090", secret: "local-secret" }, [], "/proxies", () => die("runner failed"));
    }
    catch (e) {
        failed = true;
    }
    t.eq(failed, true);
    t.eq(fs.glob("/tmp/forkop-clash-header.*"), []);
});

// The page reaches the Clash API through this on every poll, so loading it has
// to stay cheap: the modules a fresh interpreter ends up with are counted, not
// the require lines, so what they load in turn counts too.
t.test("the transport loads nothing beyond core and the constants", () => {
    let probe = stub.tmpdir() + "/probe.uc";
    fs.writefile(probe, "require(\"singbox.clash_api\");\nprint(join(\" \", keys(global.modules)), \"\\n\");\n");
    let pipe = fs.popen("ucode -L '" + repo.path("forkop/files/usr/lib") + "' '" + probe + "'", "r");
    let loaded = split(trim(pipe.read("all")), " ");
    pipe.close();
    t.contains(loaded, "singbox.clash_api");
    t.eq(filter(loaded, (name) => substr(name, 0, 5) != "core." &&
        index([ "fs", "singbox.constants", "singbox.clash_api" ], name) < 0), []);
});

t.done();
