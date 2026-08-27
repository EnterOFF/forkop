#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
RULESETS_UC="$ROOT_DIR/forkop/files/usr/lib/singbox/rulesets.uc"

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

# The dashboard refreshes the lists of one section, so it has to be told which
# rule sets that section owns. It cannot work them out for itself: a built-in
# list is named per section and a custom reference from a hash of itself, so the
# mapping is produced by the same module that names them for the runtime.

cat >"$WORK_DIR/uci.state" <<'UCI'
forkop.proxy=section
forkop.proxy.enabled=1
forkop.proxy.community_lists=telegram twitter
forkop.proxy.rule_set=https://example.com/rules.srs
forkop.direct=section
forkop.direct.enabled=1
forkop.direct.rule_set_with_subnets=https://example.com/mixed.txt
forkop.plain=section
forkop.plain.enabled=1
UCI

mapping="$(FORKOP_UCI_STATE_FILE="$WORK_DIR/uci.state" \
  ucode -L "$FORKOP_LIB" "$FORKOP_LIB/singbox/section_rulesets.uc" get-section-rule-sets)" ||
  fail "section rule-set mapping must be produced"

# Every tag has to be the one the runtime registers, not a lookalike.
for expected in \
  proxy-telegram-community-ruleset \
  proxy-twitter-community-ruleset \
  inline-custom-ea6fa9f2951d-ruleset \
  inline-custom-11ae9de91dfd-ruleset
do
  case "$mapping" in
    *"$expected"*) ;;
    *) fail "section rule-set mapping must contain $expected, got: $mapping" ;;
  esac
done

# A custom reference is one shared rule set, so the section that owns it is the
# one that lists it and no other.
case "$mapping" in
  *'"direct"'*) ;;
  *) fail "a section whose only list is a subnet reference must still appear" ;;
esac

# A section with no list at all is left out entirely, which is what hides the
# refresh control for it.
case "$mapping" in
  *'"plain"'*) fail "a section without rule sets must not appear in the mapping" ;;
esac

printf 'singbox rulesets checks passed\n'
