// Prints the sing-box configuration the generator builds for a fixture file, for
// the shell tests that hand it to a real sing-box core.
//
//   ucode -L tests/unit/fakes -L tests/unit/lib -L forkop/files/usr/lib \
//       tests/lib/generate_config.uc fixture.json [service_address] [mwan3_active]

let fixture = require("fixture");
let generator = require("singbox.generator");

fixture.seed(json(require("fs").readfile(ARGV[0])));
print(sprintf("%J\n", generator.build({
    service_address: ARGV[1] || "127.0.0.1",
    mwan3_active: ARGV[2] == "1"
})));
