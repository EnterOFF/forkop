#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RULESETS_UC="$ROOT_DIR/forkop/files/usr/lib/singbox/rulesets.uc"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
}

ucode -L "$FORKOP_LIB" "$RULESETS_UC" is-community youtube >/dev/null ||
  fail "youtube should be a community ruleset"
if ucode -L "$FORKOP_LIB" "$RULESETS_UC" is-community unknown_service >/dev/null 2>&1; then
  fail "unknown service should not be a community ruleset"
fi
assert_eq proxy-discord-community-ruleset \
  "$(ucode -L "$FORKOP_LIB" -e 'let r=require("singbox.rulesets"); print(r.community_tag("proxy","discord"));')" \
  "stable community tag"
assert_eq inline-custom-ea6fa9f2951d-ruleset \
  "$(ucode -L "$FORKOP_LIB" -e 'let r=require("singbox.rulesets"); print(r.custom_reference_tag("https://example.com/rules.srs"));')" \
  "stable custom reference tag"
assert_eq inline-custom-11ae9de91dfd-ruleset \
  "$(ucode -L "$FORKOP_LIB" -e 'let r=require("singbox.rulesets"); print(r.custom_reference_tag("https://example.com/mixed.txt"));')" \
  "stable universal reference tag"

printf 'singbox rulesets checks passed\n'
