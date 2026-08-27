#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
VALIDATOR="$ROOT_DIR/forkop/files/usr/lib/config/validator.uc"
COMMUNITY_SERVICES="youtube twitter telegram"

assert_accepts() {
  local label="$1"
  shift

  ucode -L "$FORKOP_LIB" "$VALIDATOR" "$@" >/dev/null ||
    fail "$label should be accepted"
}

assert_rejects() {
  local label="$1"
  shift

  if ucode -L "$FORKOP_LIB" "$VALIDATOR" "$@" >/dev/null 2>&1; then
    fail "$label should be rejected"
  fi
}

assert_accepts "known community service" community-service-valid twitter "$COMMUNITY_SERVICES"
assert_rejects "unknown community service" community-service-valid unknown "$COMMUNITY_SERVICES"

assert_accepts "empty ruleset reference" ruleset-reference-valid "" "$COMMUNITY_SERVICES"
assert_accepts "community ruleset reference" ruleset-reference-valid telegram "$COMMUNITY_SERVICES"
assert_accepts "https ruleset reference" ruleset-reference-valid https://example.com/rule.srs "$COMMUNITY_SERVICES"
assert_accepts "absolute srs ruleset reference" ruleset-reference-valid /tmp/rule.srs "$COMMUNITY_SERVICES"
assert_accepts "absolute json ruleset reference" ruleset-reference-valid /tmp/rule.json "$COMMUNITY_SERVICES"
assert_accepts "absolute text ruleset reference" ruleset-reference-valid /tmp/rule.lst "$COMMUNITY_SERVICES"
assert_accepts "extensionless ruleset reference" ruleset-reference-valid /tmp/rule "$COMMUNITY_SERVICES"
assert_rejects "absolute yaml ruleset reference" ruleset-reference-valid /tmp/rule.yaml "$COMMUNITY_SERVICES"
assert_rejects "remote yml ruleset reference" ruleset-reference-valid 'https://example.com/rule.yml?token=secret' "$COMMUNITY_SERVICES"
assert_rejects "relative ruleset reference" ruleset-reference-valid relative/rule.srs "$COMMUNITY_SERVICES"
assert_rejects "unsupported ruleset URL" ruleset-reference-valid ftp://example.com/rule.srs "$COMMUNITY_SERVICES"

printf 'config validator reference checks passed\n'
