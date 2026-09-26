#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

# The LuCI dropdown repeats the backend lists, so drift between them would
# silently offer a filter that matches nothing.
node - "$ROOT_DIR/fe-app-forkop/src/forkop/tabs/sections/providers.ts" \
  "$(ucode -L "$FORKOP_LIB" -e 'let c = require("singbox.constants"); print(join(" ", c.FILTERABLE_PROVIDER_TYPES));')" \
  "$(ucode -L "$FORKOP_LIB" -e 'let c = require("singbox.constants"); print(join(" ", c.FILTERABLE_GROUP_TYPES));')" <<'NODE'
const fs = require('fs');
const source = fs.readFileSync(process.argv[2], 'utf8');

function listValues(functionName) {
  const start = source.indexOf(`function ${functionName}()`);
  if (start < 0) throw new Error(`${functionName} is missing`);
  const body = source.slice(start, source.indexOf('\n}', start));
  return [...body.matchAll(/\['([a-z0-9-]+)',/g)].map((match) => match[1]);
}

const provider = listValues('providerTypeChoices');
const group = [...provider, ...listValues('groupTypeChoices')];
const expectedProvider = process.argv[3].split(' ');
const expectedGroup = process.argv[4].split(' ');

if (JSON.stringify(provider) !== JSON.stringify(expectedProvider)) {
  console.error(`provider type choices drifted: ${provider} vs ${expectedProvider}`);
  process.exit(1);
}
if (JSON.stringify(group) !== JSON.stringify(expectedGroup)) {
  console.error(`group type choices drifted: ${group} vs ${expectedGroup}`);
  process.exit(1);
}
NODE

printf 'server type and group filter checks passed\n'
