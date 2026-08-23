#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

modal_source="$(sed -n '/^function renderStackedJsonSettingsModal(/,/^function showChildItemSettingsModal(/p' "$SECTION_JS")"

grep -Fq '.catch(() => {' <<<"$modal_source" ||
  fail "stacked settings Save must keep the modal open after validation fails"
grep -Fq 'saveButton.disabled = false;' <<<"$modal_source" ||
  fail "stacked settings Save must be retryable after validation fails"
grep -Fq 'Promise.resolve(' <<<"$modal_source" ||
  fail "stacked settings Save must support asynchronous import handlers"
# A refused check marks its own field; the dialog itself adds nothing on top of
# that, neither a summary of its own nor a message repeated somewhere else.
if grep -Fq 'fkp-stacked-settings-validation-summary' <<<"$modal_source"; then
  fail "nested settings must rely on field validation instead of a global warning"
fi
if grep -Fq 'showToast' <<<"$modal_source"; then
  fail "nested settings must rely on field validation instead of a toast"
fi

printf 'LuCI stacked settings validation checks passed\n'
