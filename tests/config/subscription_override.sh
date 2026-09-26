#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

# The LuCI editor repeats the reserved list, so drift would let the dialog
# accept what the backend refuses.
node - "$ROOT_DIR/fe-app-forkop/src/forkop/tabs/sections/subscriptions/overrides.ts" \
  "$(ucode -L "$FORKOP_LIB" -e 'let c = require("singbox.constants"); print(join(" ", c.RESERVED_OVERRIDE_PATCH_PATHS));')" <<'NODE'
const fs = require('fs');
const source = fs.readFileSync(process.argv[2], 'utf8');
const start = source.indexOf('function reservedOverridePatchPaths()');
if (start < 0) throw new Error('reservedOverridePatchPaths is missing');
const body = source.slice(start, source.indexOf('\n}', start));
const paths = [...body.matchAll(/'([a-z_.]+)'/g)].map((match) => match[1]);
const expected = process.argv[3].split(' ');
if (JSON.stringify(paths) !== JSON.stringify(expected)) {
  console.error(`reserved patch paths drifted: ${paths} vs ${expected}`);
  process.exit(1);
}
NODE

printf 'subscription override checks passed\n'
