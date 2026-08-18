#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_BIN="$ROOT_DIR/forkop/files/usr/bin/forkop"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[ ! -e "$FORKOP_LIB/service/cli.uc" ] ||
  fail "service/cli.uc must be removed after /usr/bin ucode entrypoint takeover"
grep -Fq '#!/usr/bin/ucode' "$FORKOP_BIN" ||
  fail "forkop entrypoint must be a direct ucode executable"
if grep -Fq '#!/bin/sh' "$FORKOP_BIN" ||
  grep -Fq '#!/bin/ash' "$FORKOP_BIN" ||
  grep -Fq 'exec ucode' "$FORKOP_BIN"; then
  fail "forkop entrypoint must not keep a shell loader"
fi
if grep -Fq 'FORKOP_COMMAND' "$FORKOP_BIN" ||
  grep -Fq 'run_module()' "$FORKOP_BIN"; then
  fail "forkop entrypoint must not keep legacy shell routing symbols"
fi
grep -Fq 'function command_spec(command)' "$FORKOP_BIN" ||
  fail "forkop ucode entrypoint must own command routing"
grep -Fq 'function show_help()' "$FORKOP_BIN" ||
  fail "forkop ucode entrypoint must own help text"

fake_lib="$WORK_DIR/lib"
mkdir -p "$fake_lib/service" "$fake_lib/diagnostics" "$fake_lib/components" "$fake_lib/dns"

cat >"$fake_lib/diagnostics/runtime.uc" <<'UCODE'
#!/usr/bin/env ucode
print("diagnostics\t", ARGV[0], "\t", ARGV[1] || "", "\t", ARGV[2] || "", "\t", ARGV[3] || "", "\n");
UCODE

cat >"$fake_lib/components/updates.uc" <<'UCODE'
#!/usr/bin/env ucode
print("updates\t", ARGV[0], "\t", ARGV[1] || "", "\t", ARGV[2] || "", "\n");
UCODE

cat >"$fake_lib/components/action.uc" <<'UCODE'
#!/usr/bin/env ucode
print("action\t", ARGV[0], "\t", ARGV[1] || "", "\t", ARGV[2] || "", "\n");
UCODE

cat >"$fake_lib/dns/apply.uc" <<'UCODE'
#!/usr/bin/env ucode
let fs = require("fs");
let marker = getenv("FORKOP_TEST_DNS_RESTORE_MARKER");
if (marker != null && marker != "")
    fs.writefile(marker, ARGV[0] || "");
UCODE

show_version_out="$(FORKOP_LIB="$fake_lib" ucode "$FORKOP_BIN" show_version)"
[ "$show_version_out" = $'diagnostics\tshow-version\t\t\t' ] ||
  fail "show_version must dispatch through diagnostics/runtime.uc"

clash_http_out="$(FORKOP_LIB="$fake_lib" ucode "$FORKOP_BIN" clash_http PUT /proxies/main-out '{"name":"main-1-out"}')"
[ "$clash_http_out" = $'diagnostics\tclash-http\tPUT\t/proxies/main-out\t{"name":"main-1-out"}' ] ||
  fail "clash_http must dispatch through diagnostics/runtime.uc with method, path and body"

provider_runtime_out="$(FORKOP_LIB="$fake_lib" ucode "$FORKOP_BIN" check_provider_runtime zapret2)"
[ "$provider_runtime_out" = $'diagnostics\tcheck-provider-runtime\tzapret2\t\t' ] ||
  fail "check_provider_runtime must forward the DPI provider name"

provider_status_out="$(FORKOP_LIB="$fake_lib" ucode "$FORKOP_BIN" get_provider_status byedpi)"
[ "$provider_status_out" = $'diagnostics\tget-provider-status\tbyedpi\t\t' ] ||
  fail "get_provider_status must forward the DPI provider name"

# The strategy is passed without a leading dash on purpose: the ucode build
# used by this harness keeps parsing options past the script path, while the
# OpenWrt build stops there.
provider_validate_out="$(FORKOP_LIB="$fake_lib" ucode "$FORKOP_BIN" validate_provider_strategy_json zapret 'dpi-desync=fake')"
[ "$provider_validate_out" = $'diagnostics\tvalidate-provider-strategy-json\tzapret\tdpi-desync=fake\t' ] ||
  fail "validate_provider_strategy_json must forward the provider and the strategy"

for removed in check_nft show_sing_box_version neutralize_zapret_defaults dnsmasq_restore \
  check_zapret_runtime get_byedpi_status validate_nfqws_strategy_json subscription_update clash_api; do
  if FORKOP_LIB="$fake_lib" ucode "$FORKOP_BIN" "$removed" 2>/dev/null | grep -Fq $'diagnostics\t'; then
    fail "removed command $removed must not dispatch to a module"
  fi
done

component_out="$(FORKOP_LIB="$fake_lib" ucode "$FORKOP_BIN" component_action sing_box update)"
[ "$component_out" = $'action\tcomponent-action\tsing_box\tupdate' ] ||
  fail "component_action must dispatch through components/action.uc with arguments"

component_check_cache_out="$(FORKOP_LIB="$fake_lib" ucode "$FORKOP_BIN" component_update_check_cache)"
[ "$component_check_cache_out" = $'updates\tcomponent-update-check-cache\t\t' ] ||
  fail "component_update_check_cache must dispatch through components/updates.uc"

component_updates_out="$(FORKOP_LIB="$fake_lib" ucode "$FORKOP_BIN" component_updates_if_due)"
[ "$component_updates_out" = $'updates\tcomponent-updates-if-due\t\t' ] ||
  fail "component_updates_if_due must dispatch through components/updates.uc"

rm -f "$fake_lib/service/lifecycle.uc"
set +e
FORKOP_TEST_DNS_RESTORE_MARKER="$WORK_DIR/dns-restore.marker" FORKOP_LIB="$fake_lib" \
  ucode "$FORKOP_BIN" start >/dev/null 2>"$WORK_DIR/missing.err"
status="$?"
set -e
[ "$status" -ne 0 ] ||
  fail "missing lifecycle module must fail"
[ "$(cat "$WORK_DIR/dns-restore.marker")" = "failsafe-restore" ] ||
  fail "missing lifecycle module must trigger dnsmasq failsafe restore"

printf 'CLI entrypoint checks passed\n'
