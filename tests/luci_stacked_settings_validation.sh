#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

modal_source="$(sed -n '/^function renderStackedJsonSettingsModal(/,/^function showChildItemSettingsModal(/p' "$SECTION_JS")"

grep -Fq '.catch((error) => {' <<<"$modal_source" ||
  fail "stacked settings Save must keep the modal open after validation fails"
grep -Fq 'saveButton.disabled = false;' <<<"$modal_source" ||
  fail "stacked settings Save must be retryable after validation fails"
# LuCI saves a dialog silently, and a field nothing was typed into never
# validated, so a refused Save has to say why on its own.
grep -Fq 'main.showToast(message, "error");' <<<"$modal_source" ||
  fail "stacked settings Save must report the reason it refused"
grep -Fq 'Promise.resolve(' <<<"$modal_source" ||
  fail "stacked settings Save must support asynchronous import handlers"
if grep -Fq 'fkp-stacked-settings-validation-summary' <<<"$modal_source"; then
  fail "nested settings must name the reason instead of a generic warning"
fi

printf 'LuCI stacked settings validation checks passed\n'
