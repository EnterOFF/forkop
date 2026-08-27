#!/usr/bin/env bash
# The update check is scheduled by a cron line and nothing else remembers when it
# last ran, so an interval cron cannot express exactly is refused by the backend:
# no line is written and the checks silently never run.
#
# The settings form has to refuse exactly the same values, or the field accepts
# something that quietly turns the feature off. Two implementations of one rule
# cannot be avoided - a static LuCI view cannot call ucode while validating - so
# both are driven over one list: tests/fixtures/cron_intervals.json. The form's
# half is fe-app-forkop/src/forkop/tabs/settings/tests/isCronExpressibleInterval.test.ts.
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
UPDATES_UC="$FORKOP_LIB/components/updates.uc"
INTERVALS="$TESTS_DIR/fixtures/cron_intervals.json"

values() {
  node -e '
    const fs = require("fs");
    const intervals = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(intervals[process.argv[2]].join(" "));
  ' "$INTERVALS" "$1"
}

ACCEPTED="$(values accepted)"
REFUSED="$(values refused)"
[ -n "$ACCEPTED" ] && [ -n "$REFUSED" ] ||
  fail "$INTERVALS holds no intervals to check"

backend_accepts() {
  local seconds schedule
  seconds="$(ucode -L "$FORKOP_LIB" "$UPDATES_UC" duration-to-seconds "$1" 2>/dev/null | tr -d '\r\n')"
  [ -n "$seconds" ] || return 1
  schedule="$(ucode -L "$FORKOP_LIB" "$UPDATES_UC" due-check-cron-schedule "$seconds" 2>/dev/null | tr -d '\r\n')"
  [ -n "$schedule" ]
}

for value in $ACCEPTED; do
  backend_accepts "$value" ||
    fail "the backend must build a cron line for '$value'"
done

for value in $REFUSED; do
  if backend_accepts "$value"; then
    fail "the backend must refuse '$value', which cron cannot express exactly"
  fi
done

printf 'component update interval checks passed (%s accepted, %s refused)\n' \
  "$(printf '%s\n' $ACCEPTED | wc -l | tr -d ' ')" \
  "$(printf '%s\n' $REFUSED | wc -l | tr -d ' ')"
