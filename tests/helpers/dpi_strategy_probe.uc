#!/usr/bin/env ucode

// Answers what the provider validators make of a strategy, one verdict per probe.
//
// The DPI strategy editor in the browser carries its own copy of what each engine
// accepts, because it annotates a strategy while it is typed and cannot wait for the
// backend. tests/dpi_option_tables.sh asks both sides the same questions and compares
// the answers, so this exists to ask the backend in one process instead of one spawn
// per token.
//
// Reads a JSON array of { kind, value } from the file named by the first argument and
// prints a JSON array of { valid, message } in the same order. The message is there
// so that the test can tell an option refused on purpose from one nobody recognises,
// without knowing what either refusal says.

let fs = require("fs");
let nfqueue = require("providers.nfqueue.validator");
let byedpi = require("providers.byedpi.validator");

let path = ARGV[0];
if (path == null) {
    warn("Usage: dpi_strategy_probe.uc <probes.json>\n");
    exit(2);
}

let source = fs.readfile(path);
if (source == null) {
    warn("dpi_strategy_probe.uc: cannot read " + path + "\n");
    exit(2);
}

let verdicts = [];
for (let probe in json(source)) {
    let result = probe.kind == "byedpi"
        ? byedpi.validate_byedpi_strategy(probe.value)
        : nfqueue.validate_strategy(probe.kind, probe.value, "");
    push(verdicts, { valid: result.valid === true, message: result.message });
}

print(sprintf("%J", verdicts), "\n");
