#!/usr/bin/env bash
# A sing-box duration has to hold a non-zero amount: "0s" parses as a duration
# and means "no timeout", which turns a health check off instead of setting one.
# Both tabs ask for durations and both run this one check, so it is exercised
# here as the browser runs it.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DURATION_TS="$ROOT_DIR/fe-app-forkop/src/validators/validateSingBoxDuration.ts"

source="$(sed -n '/function isSingBoxDuration(/,/^}/p' "$DURATION_TS" |
  sed -e 's/^export //' -e 's/(value: string)/(value)/')"
if [ -z "$source" ]; then
  printf 'FAIL: the shared validator must declare isSingBoxDuration\n' >&2
  exit 1
fi

DURATION_SOURCE="$source" node <<'NODE'
const validate = Function(`${process.env.DURATION_SOURCE}; return isSingBoxDuration`)();

for (const value of ['1s', '0.5s', '2m30s']) {
  if (!validate(value)) throw new Error(`valid duration rejected: ${value}`);
}
for (const value of ['0s', '0h0m', '0.0s']) {
  if (validate(value)) throw new Error(`zero duration accepted: ${value}`);
}
NODE

# One copy, in the shared validators: both tabs import it, and they are modules
# of one bundle, which the browser loads whole or not at all.
if grep -rn 'function isSingBoxDuration' "$ROOT_DIR/fe-app-forkop/src/forkop" >/dev/null 2>&1; then
  printf 'FAIL: the duration check belongs in the shared validators, not in a tab\n' >&2
  exit 1
fi

printf 'LuCI duration validation checks passed\n'
