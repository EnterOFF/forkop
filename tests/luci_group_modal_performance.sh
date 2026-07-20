#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

grep -Fq 'const regionDisplayNamesFormatters = new Map();' "$SECTION_JS" ||
  fail "country labels must reuse one Intl.DisplayNames formatter"
grep -Fq 'const countryChoicesCache = new Map();' "$SECTION_JS" ||
  fail "country choices must not be rebuilt for every group modal"

if grep -Fq 'return loadOutboundNameChoices(sectionId).then(() =>' "$SECTION_JS"; then
  fail "group modals must not wait for live provider choices before opening"
fi
grep -Fq 'refreshDashboardFilterChoiceWidgets(section_id);' "$SECTION_JS" ||
  fail "provider choices must refresh after the background load"

printf 'LuCI group modal performance checks passed\n'
