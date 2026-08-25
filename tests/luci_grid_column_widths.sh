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
VIEW_DIR="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop"
SECTION_JS="$VIEW_DIR/section.js"
SERVER_JS="$VIEW_DIR/server.js"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

grep -Eq '^const GRID_SWITCH_COLUMN_WIDTH = "[0-9.]+rem";$' "$SECTION_JS" ||
  fail "the switch column width must be a named constant in section.js"
grep -Eq '^const GRID_KIND_COLUMN_WIDTH = "[0-9.]+rem";$' "$SECTION_JS" ||
  fail "the kind column width must be a named constant in section.js"

for name in GRID_SWITCH_COLUMN_WIDTH GRID_KIND_COLUMN_WIDTH; do
  grep -Fq "  $name," "$SECTION_JS" ||
    fail "section.js must export $name for the Servers tab to use"
  grep -Fq "o.width = sectionui.$name;" "$SERVER_JS" ||
    fail "the Servers table must take $name from the Sections tab"
  grep -Fq "o.width = $name;" "$SECTION_JS" ||
    fail "the Sections table must use $name rather than a literal"
done

# A literal anywhere in either table is the drift coming back: it agrees with
# the other tab until somebody edits one of them.
for file in "$SECTION_JS" "$SERVER_JS"; do
  literal="$(grep -En '\.width = "' "$file" || true)"
  [ -z "$literal" ] ||
    fail "column widths must come from the shared constants, found: $literal"
done

# The kind column carries protocol names on one tab and rule actions on the
# other, and a value wider than the column widens it past the declared width -
# which puts the tables back out of step. Shadowsocks is the longest of either.
kind_rem="$(sed -n 's/^const GRID_KIND_COLUMN_WIDTH = "\([0-9.]*\)rem";$/\1/p' "$SECTION_JS")"
awk -v rem="$kind_rem" 'BEGIN { exit !(rem >= 8) }' ||
  fail "the kind column needs at least 8rem to hold Shadowsocks without widening"

printf 'LuCI grid column width checks passed\n'
