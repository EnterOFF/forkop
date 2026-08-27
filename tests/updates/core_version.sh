#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
VERSION_UC="$ROOT_DIR/forkop/files/usr/lib/core/version.uc"

assert_at_least() {
  ucode "$VERSION_UC" version-at-least "$1" "$2" ||
    fail "$1 should satisfy $2"
}

refute_at_least() {
  if ucode "$VERSION_UC" version-at-least "$1" "$2"; then
    fail "$1 should not satisfy $2"
  fi
}

assert_at_least 1.12.4 1.12.4
assert_at_least 1.12.10 1.12.4
assert_at_least 1.13.18-extended-2.6.5-f39 1.13.18-extended-2.6.5
refute_at_least 1.12.3 1.12.4
refute_at_least 1.9.0 1.12.4
refute_at_least 1.13.18 1.13.18-extended-2.6.5
# Leading zeroes are numeric noise, and "~" sorts before an empty segment.
assert_at_least 1.012.4 1.12.4
refute_at_least 1.12.4~rc1 1.12.4

if ucode "$VERSION_UC" unknown-mode >/dev/null 2>&1; then
  fail "unknown mode should fail"
fi

printf 'core version checks passed\n'
