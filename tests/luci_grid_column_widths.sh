#!/usr/bin/env bash
set -eo pipefail

# The Sections and Servers tabs are the same table twice: a name, a switch, one
# column naming what the row is, and the row actions. A LuCI grid sizes its
# columns from the widths its options declare, and whatever those do not take
# goes to the undeclared name column beside them - so a width declared on one
# tab and not the other moves every column on the page the moment the user
# clicks across, which is how the two tables drifted 32px apart. The widths are
# shared constants for that reason, and this holds them shared.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRID_TS="$ROOT_DIR/fe-app-forkop/src/forkop/cbi/grid.ts"
SECTION_TS="$(node "$ROOT_DIR/tests/helpers/tab_source.js" sections)"
SERVER_TS="$(node "$ROOT_DIR/tests/helpers/tab_source.js" servers)"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

grep -Eq "^export const GRID_SWITCH_COLUMN_WIDTH = '[0-9.]+rem';$" "$GRID_TS" ||
  fail "the switch column width must be a named constant in the shared CBI layer"
grep -Eq "^export const GRID_KIND_COLUMN_WIDTH = '[0-9.]+rem';$" "$GRID_TS" ||
  fail "the kind column width must be a named constant in the shared CBI layer"

for name in GRID_SWITCH_COLUMN_WIDTH GRID_KIND_COLUMN_WIDTH; do
  grep -Fq "o.width = $name;" "$SERVER_TS" ||
    fail "the Servers table must use $name rather than a literal"
  grep -Fq "o.width = $name;" "$SECTION_TS" ||
    fail "the Sections table must use $name rather than a literal"
done

# A literal anywhere in either table is the drift coming back: it agrees with
# the other tab until somebody edits one of them.
for file in "$SECTION_TS" "$SERVER_TS"; do
  literal="$(grep -En "\.width = ['\"]" "$file" || true)"
  [ -z "$literal" ] ||
    fail "column widths must come from the shared constants, found: $literal"
done

# The kind column carries protocol names on one tab and rule actions on the
# other, and a value wider than the column widens it past the declared width -
# which puts the tables back out of step. Shadowsocks is the longest of either.
kind_rem="$(sed -n "s/^export const GRID_KIND_COLUMN_WIDTH = '\([0-9.]*\)rem';\$/\1/p" "$GRID_TS")"
awk -v rem="$kind_rem" 'BEGIN { exit !(rem >= 8) }' ||
  fail "the kind column needs at least 8rem to hold Shadowsocks without widening"

printf 'LuCI grid column width checks passed\n'
