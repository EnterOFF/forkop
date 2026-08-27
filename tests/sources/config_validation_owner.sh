#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
VALIDATOR="$FORKOP_LIB/config/validator.uc"
RULE_CONFIG="$FORKOP_LIB/config/rule.uc"
GENERATOR="$FORKOP_LIB/singbox/generator.uc"
LIFECYCLE="$FORKOP_LIB/service/lifecycle.uc"

if grep -R -n "config_validation.sh" "$FORKOP_FILES" >/dev/null 2>&1; then
  fail "runtime files must not reference config_validation.sh"
fi

legacy_symbols='(^|[^A-Za-z0-9_])(config_validate_runtime|check_requirements|commit_forkop_config|mwan3_is_active|get_inline_remote_ruleset_format|detect_inline_ruleset_reference_kind)([^A-Za-z0-9_]|$)'
if grep -R -n -E "$legacy_symbols" "$FORKOP_BIN" "$FORKOP_LIB" --include='*.sh' >/dev/null 2>&1; then
  fail "runtime shell must not keep config_validation.sh symbols"
fi

grep -Fq 'mode == "check-requirements"' "$VALIDATOR" ||
  fail "config validator must own requirement checks"
grep -Fq 'mode == "mwan3-is-active"' "$VALIDATOR" ||
  fail "config validator must own mwan3 runtime predicate"
grep -Fq 'require("core.uci")' "$VALIDATOR" ||
  fail "config validator must use core.uci for runtime UCI access"
if grep -Fq 'uci_core().' "$VALIDATOR"; then
  fail "config validator must store the lazy core.uci module before method calls"
fi
grep -Fq 'text_list_values,' "$RULE_CONFIG" ||
  fail "config.rule must export the shared comment-aware text parser"
grep -Fq 'rule_config.text_list_values(value, "comma-space")' "$VALIDATOR" ||
  fail "domain validation must use the shared comment-aware text parser"
grep -Fq 'rule_config.text_list_values(option(section, "domain", ""), "comma-space")' "$GENERATOR" ||
  fail "sing-box domain generation must use the shared comment-aware text parser"
if grep -n -E 'require\("uci"\)\.cursor|uci -q|uci", "-q"|command_output\("uci' "$VALIDATOR" >/dev/null 2>&1; then
  fail "config validator must not own direct UCI cursor or CLI access"
fi
if grep -n -E 'MIGRATION_UC|config[./]migration|"migrate"' "$LIFECYCLE" >/dev/null 2>&1; then
  fail "service/lifecycle.uc must not run configuration migration"
fi
# The lifecycle stopped writing the configuration when shutdown_correctly left
# with the dnsmasq takeover, so the internal config trigger guard has no writer
# here any more - and a new uci write would need one back.
if grep -n -E 'uci_core\.(set|commit)\(' "$LIFECYCLE" >/dev/null 2>&1; then
  fail "service/lifecycle.uc must not write UCI; a config write needs the internal config trigger guard"
fi
grep -Fq 'VALIDATOR_UC' "$LIFECYCLE" &&
grep -Fq '"validate-runtime"' "$LIFECYCLE" ||
  fail "service/lifecycle.uc must run runtime validation directly through ucode"

printf 'config validation ownership checks passed\n'
