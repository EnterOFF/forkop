#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for file in \
  "$(node "$ROOT_DIR/tests/helpers/tab_source.js" settings --double-quotes)" \
  "$ROOT_DIR/fe-app-forkop/src/forkop/tabs/sections/validators.ts"; do
  source="$(sed -n '/function isSingBoxDuration(/,/^}/p' "$file" |
    sed -e 's/^export //' -e 's/(value: string)/(value)/')"

  DURATION_SOURCE="$source" node <<'NODE'
const validate = Function(`${process.env.DURATION_SOURCE}; return isSingBoxDuration`)();

for (const value of ['1s', '0.5s', '2m30s']) {
  if (!validate(value)) throw new Error(`valid duration rejected: ${value}`);
}
for (const value of ['0s', '0h0m', '0.0s']) {
  if (validate(value)) throw new Error(`zero duration accepted: ${value}`);
}
NODE
done

printf 'LuCI duration validation checks passed\n'
