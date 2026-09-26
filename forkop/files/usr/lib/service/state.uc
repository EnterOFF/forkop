// The runtime question and the lifecycle lock the component manager asks as a
// program.

let lock = require("service.lock");
let health = require("service.health");

let mode = ARGV[0] ?? "";
let ok;

if (mode == "sing-box-service-running")
    ok = health.sing_box_service_running();
else if (mode == "acquire-runtime-dir-lock")
    ok = lock.acquire(ARGV[1] ?? "", ARGV[2] ?? "");
else if (mode == "acquire-runtime-dir-lock-wait")
    ok = lock.acquire_wait(ARGV[1] ?? "", ARGV[2] ?? "", int(ARGV[3] ?? "300"));
else if (mode == "release-runtime-dir-lock") {
    lock.release(ARGV[1] ?? "", ARGV[2] ?? "");
    ok = true;
}
else {
    warn("Usage: service/state.uc <sing-box-service-running|acquire-runtime-dir-lock|acquire-runtime-dir-lock-wait|release-runtime-dir-lock> ...\n");
    ok = false;
}

exit(ok ? 0 : 1);
