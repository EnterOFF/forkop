#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

assert_duration() {
  local value="$1" expected="$2" actual
  actual="$(ucode -L "$FORKOP_LIB" -e '
    let common = require("core.common");
    let seconds = common.duration_to_seconds(ARGV[0]);
    print(seconds == null ? "null" : seconds, "\n");
  ' -- "$value")"
  [ "$actual" = "$expected" ] ||
    fail "duration '$value': expected $expected, got $actual"
}

# sing-box takes Go duration syntax, so a compound value is one duration and
# not a parse error. The config validator accepts these, and everything that
# compares them afterwards has to read them the same way.
assert_duration 3m 180
assert_duration 30m 1800
assert_duration 1h30m 5400
assert_duration 1d 86400
assert_duration 1.5s 2
assert_duration 90 null
assert_duration bogus null
assert_duration "" null

# One owner: a second copy is how the generator ended up rejecting the compound
# durations the validator had already accepted. components/ and migration.uc
# still carry their own and are covered by their own planned refactor.
duplicates="$(
  grep -rl 'function duration_to_seconds' "$FORKOP_LIB" |
    grep -v '/core/common\.uc$' |
    grep -v '/components/' |
    grep -v '/config/migration\.uc$' || true
)"
[ -z "$duplicates" ] ||
  fail "duration parsing must live only in core/common.uc, also found in: $duplicates"

printf 'core common checks passed\n'
