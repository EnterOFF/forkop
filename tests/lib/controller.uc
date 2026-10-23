// A stand-in Clash API controller on a loopback port, in a process of its own that leaves with
// the test: the backend talks to it over a real socket, and a test sets the reply and reads the
// requests it received.

let fs = require("fs");
let stub = require("stub");
let repo = require("repo");
let common = require("core.common");

function start() {
    let dir = stub.tmpdir();
    stub.real.system(sprintf("ucode '%s' '%s' '%s' >/dev/null 2>&1 &", repo.path("tests/lib/controller_server.uc"), dir, common.own_pid()));
    for (let i = 0; i < 250 && !fs.access(dir + "/port"); i++)
        sleep(20);
    let port = trim(fs.readfile(dir + "/port") ?? "");
    if (port == "")
        die("the stand-in controller did not start");

    return {
        endpoint: "127.0.0.1:" + port,
        // { status, body, delay_ms } or { raw } for every request until the next call.
        reply: function(value) {
            fs.writefile(dir + "/reply", sprintf("%J", value));
        },
        requests: function() {
            return map(sort(fs.glob(dir + "/request.*")), (path) => fs.readfile(path));
        }
    };
}

return { start };
