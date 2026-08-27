#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
VALIDATOR="$ROOT_DIR/forkop/files/usr/lib/config/validator.uc"

rows() {
  printf '%s\t%s\t%s\n' "$@"
}

assert_accepts() {
  local target="$1"
  shift

  rows "$@" | ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-download-section "$target"
}

assert_rejects() {
  local label="$1"
  local expected="$2"
  local target="$3"
  shift 3
  local output

  if output="$(rows "$@" | ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-download-section "$target" 2>/dev/null)"; then
    fail "$label should be rejected"
  fi

  printf '%s\n' "$output" | grep -Fq "$expected" ||
    fail "$label: expected message containing '$expected', got '$output'"
}

assert_accepts proxy proxy 1 proxy
assert_accepts outbound outbound 1 outbound
assert_accepts vpn vpn 1 vpn

assert_rejects "empty target" "no download section is selected" "" proxy 1 proxy
assert_rejects "missing target" "references missing rule 'missing'" missing proxy 1 proxy
assert_rejects "disabled target" "references disabled rule 'proxy'" proxy proxy 0 proxy
assert_rejects "unsupported action" "cannot provide an outbound" bypass bypass 1 bypass
assert_rejects "retired action" "cannot provide an outbound" zap zap 1 zapret

printf 'config validator download section checks passed\n'
