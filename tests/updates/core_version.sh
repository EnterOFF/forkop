#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
VERSION_UC="$ROOT_DIR/forkop/files/usr/lib/core/version.uc"

# The component updater spawns the module as a command and reads the answer from
# its exit status; the comparison itself is tested in tests/unit/core. A usage
# error exits 1 too, so a "no" is told apart from one by what it printed.
answer() {
  local stderr status=0
  stderr="$(ucode "$VERSION_UC" "$@" 2>&1 >/dev/null)" || status=$?
  printf '%s %s\n' "$status" "${stderr:+usage}"
}

[ "$(answer version-at-least 1.12.10 1.12.4)" = "0 " ] ||
  fail "a newer version should answer yes"
[ "$(answer version-at-least 1.12.3 1.12.4)" = "1 " ] ||
  fail "an older version should answer no, and quietly"
[ "$(answer unknown-mode)" = "1 usage" ] ||
  fail "an unknown mode should fail with its usage"

printf 'core version checks passed\n'
