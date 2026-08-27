#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
CLI_UC="$FORKOP_BIN"
LIFECYCLE_UC="$FORKOP_LIB/service/lifecycle.uc"
PACKAGES_UC="$FORKOP_LIB/core/packages.uc"
SINGBOX_RUNTIME_UC="$FORKOP_LIB/singbox/runtime.uc"
COMPONENT_ACTION_UC="$FORKOP_LIB/components/action.uc"
DIAGNOSTICS_RUNTIME_UC="$FORKOP_LIB/diagnostics/runtime.uc"

if grep -R -n -F 'helpers.sh' "$FORKOP_BIN" "$FORKOP_LIB" --include='*.sh' >/dev/null 2>&1; then
  fail "runtime shell must not reference helpers.sh"
fi
if grep -R -n -E 'helpers_ucode\(|get_(inbound|server_inbound|tailscale_dns_server|outbound)_tag_by_section\(|get_domain_resolver_tag\(|provider_status_ucode\(|is_ipv4\(|is_min_package_version\(|url_get_(scheme|userinfo|host|port|path|query_param)\(' \
  "$FORKOP_BIN" "$FORKOP_LIB" --include='*.sh' >/dev/null 2>&1; then
  fail "helpers.sh wrapper symbols must not remain in runtime shell"
fi

grep -Fq 'core/packages.uc' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc must use core/packages.uc directly"
for shell_owner_pattern in \
  'config_load' \
  'config_get' \
  'uci_set'
do
  if grep -Fq "$shell_owner_pattern" "$FORKOP_BIN"; then
    fail "forkop shell entrypoint must not own $shell_owner_pattern logic"
  fi
done
if grep -E -n '(^|[;&|[:space:]])nft[[:space:]]+(list|add|delete|flush)' "$FORKOP_BIN" >/dev/null 2>&1; then
  fail "forkop shell entrypoint must not own nft command logic"
fi
if grep -E -n '(^|[;&|[:space:]])ip[[:space:]]+(rule|route)' "$FORKOP_BIN" >/dev/null 2>&1; then
  fail "forkop shell entrypoint must not own ip rule/route logic"
fi
grep -Fq 'diagnostics/runtime.uc' "$CLI_UC" ||
  fail "service/cli.uc must dispatch diagnostics through diagnostics/runtime.uc"
grep -Fq 'mode == "get-system-info"' "$DIAGNOSTICS_RUNTIME_UC" ||
  fail "diagnostics/runtime.uc must own system info"
grep -Fq 'core/packages.uc' "$COMPONENT_ACTION_UC" ||
  fail "component action owner must use core/packages.uc directly"
grep -Fq 'mode == "version"' "$SINGBOX_RUNTIME_UC" ||
  fail 'singbox/runtime.uc missing mode == "version"'
for mode in \
  'mode == "version-output"' \
  'mode == "version-from-output"' \
  'mode == "read-version-state"' \
  'mode == "write-version-state"' \
  'mode == "restore-version-state"' \
  'mode == "read-variant-marker"' \
  'mode == "write-variant-marker"' \
  'mode == "restore-variant-marker"' \
  'mode == "is-extended"' \
  'mode == "is-tiny"' \
  'mode == "supports-tailscale"' \
  'mode == "variant"'
do
  if grep -Fq "$mode" "$SINGBOX_RUNTIME_UC"; then
    fail "singbox/runtime.uc must not retain legacy $mode"
  fi
done
if grep -R -n -E 'get_sing_box_version\(|sing_box_version_from_output\(|sing_box_version_output\(|sing_box_output_has_build_tag\(|sing_box_has_build_tag\(|is_sing_box_extended\(|is_sing_box_tiny_package_installed\(|is_sing_box_full_package_installed\(|is_sing_box_compressed_marker_set\(|is_sing_box_extended_marker_set\(|read_sing_box_version_state\(|is_sing_box_tiny_marker_set\(|is_sing_box_tiny\(|sing_box_supports_tailscale\(|get_sing_box_variant\(|updates_(write|read|clear|restore)_sing_box_(variant_marker|version_state)\(' \
  "$FORKOP_BIN" "$FORKOP_LIB" --include='*.sh' >/dev/null 2>&1; then
  fail "sing-box helper/state shell symbols must not remain"
fi

if ucode -L "$FORKOP_LIB" "$PACKAGES_UC" installed forkop-definitely-missing >/dev/null 2>&1; then
  fail "missing package must not be reported installed"
fi

printf 'helpers ownership checks passed\n'
