#!/usr/bin/env bash
# The update check is scheduled by a cron line and nothing else remembers when it
# last ran, so an interval cron cannot express exactly is refused by the backend:
# no line is written and the checks silently never run. The settings form has to
# refuse exactly the same values, or the field accepts something that quietly
# turns the feature off.
#
# Two implementations of one rule cannot be avoided - a static LuCI view cannot
# call ucode while validating - so this pins them to each other value by value.
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
UPDATES_UC="$FORKOP_LIB/components/updates.uc"
SETTINGS_JS="$(node "$ROOT_DIR/tests/helpers/tab_source.js" settings --double-quotes)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

# Accepted by cron, refused by cron. The refused ones are all well-formed
# sing-box durations, which is exactly why the old validator let them through.
ACCEPTED="1m 2m 30m 45m 59m 60m 1h 2h 7h 12h 23h 24h 1d 1440m"
REFUSED="90m 61m 2d 36h 25h 1h30m 30s 500ms 0m 1w"

backend_accepts() {
  local seconds schedule
  seconds="$(ucode -L "$FORKOP_LIB" "$UPDATES_UC" duration-to-seconds "$1" 2>/dev/null | tr -d '\r\n')"
  [ -n "$seconds" ] || return 1
  schedule="$(ucode -L "$FORKOP_LIB" "$UPDATES_UC" due-check-cron-schedule "$seconds" 2>/dev/null | tr -d '\r\n')"
  [ -n "$schedule" ]
}

# The form's own helper, exercised as the browser would run it.
cat >"$WORK_DIR/probe.js" <<'PROBE'
const fs = require("fs");
const source = fs.readFileSync(process.argv[2], "utf8");
// The tab is several modules now, so each helper is taken by name rather than
// by what happens to follow it.
const { readFunction } = require(process.argv[4]);
const helpers = ["singBoxDurationSeconds", "isCronExpressibleInterval"]
  .map((name) => readFunction(source, name))
  .join("\n");
// eslint-disable-next-line no-eval
// A different binding name: the evaluated source declares the function itself.
const validate = eval(`${helpers}; isCronExpressibleInterval`);
process.stdout.write(validate(process.argv[3]) ? "yes" : "no");
PROBE

form_accepts() {
  local verdict
  verdict="$(node "$WORK_DIR/probe.js" "$SETTINGS_JS" "$1" \
    "$ROOT_DIR/tests/helpers/source_literal.js")"
  [ "$verdict" = "yes" ]
}

for value in $ACCEPTED; do
  backend_accepts "$value" || fail "the backend must build a cron line for '$value'"
  form_accepts "$value" || fail "the settings form must accept '$value'"
done

for value in $REFUSED; do
  if backend_accepts "$value"; then
    fail "the backend must refuse '$value', which cron cannot express exactly"
  fi
  if form_accepts "$value"; then
    fail "the settings form must refuse '$value' instead of writing a value that disables the check"
  fi
done

# The generic sing-box duration check stays generic: the subscription update
# interval is handed to sing-box, never to cron, and must keep accepting the
# values cron cannot express. So the cron rule is a check of its own beside it,
# never folded into the shared duration validator every duration field runs.
DURATION_TS="$ROOT_DIR/fe-app-forkop/src/validators/validateSingBoxDuration.ts"
grep -q 'function isSingBoxDuration' "$DURATION_TS" ||
  fail "the shared duration check must stay generic for the subscription interval"
if grep -q 'isCronExpressibleInterval' "$DURATION_TS"; then
  fail "the cron rule must not reach the shared duration check"
fi

# Knowing the rule is half of it: the field has to apply it. Without this the
# helper could be perfect while the validator never calls it.
field_block="$(awk '/"component_update_check_interval",/{f=1} f&&/^  o = section.option\(/&&!/component_update_check_interval/{exit} f' "$SETTINGS_JS")"
printf '%s' "$field_block" | grep -q 'isCronExpressibleInterval' ||
  fail "the component_update_check_interval field must run isCronExpressibleInterval in its validator"

printf 'component update interval checks passed (%s accepted, %s refused)\n' \
  "$(printf '%s\n' $ACCEPTED | wc -l | tr -d ' ')" \
  "$(printf '%s\n' $REFUSED | wc -l | tr -d ' ')"
