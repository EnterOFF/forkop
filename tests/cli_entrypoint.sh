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
mkdir -p "$fake_lib/service" "$fake_lib/diagnostics" "$fake_lib/components" \
  "$fake_lib/singbox"

cat >"$fake_lib/diagnostics/runtime.uc" <<'UCODE'
#!/usr/bin/env ucode
print("diagnostics\t", ARGV[0], "\t", ARGV[1] || "", "\t", ARGV[2] || "", "\t", ARGV[3] || "", "\n");
UCODE

cat >"$fake_lib/singbox/clash_http.uc" <<'UCODE'
#!/usr/bin/env ucode
print("singbox_clash_http\t", ARGV[0], "\t", ARGV[1] || "", "\t", ARGV[2] || "", "\t", ARGV[3] || "", "\n");
UCODE

cat >"$fake_lib/components/updates.uc" <<'UCODE'
#!/usr/bin/env ucode
print("updates\t", ARGV[0], "\t", ARGV[1] || "", "\t", ARGV[2] || "", "\n");
UCODE

cat >"$fake_lib/components/action.uc" <<'UCODE'
#!/usr/bin/env ucode
print("action\t", ARGV[0], "\t", ARGV[1] || "", "\t", ARGV[2] || "", "\n");
UCODE

show_version_out="$(FORKOP_LIB="$fake_lib" ucode "$FORKOP_BIN" show_version)"
[ "$show_version_out" = $'diagnostics\tshow-version\t\t\t' ] ||
  fail "show_version must dispatch through diagnostics/runtime.uc"

clash_http_out="$(FORKOP_LIB="$fake_lib" ucode "$FORKOP_BIN" clash_http PUT /proxies/main-out '{"name":"main-1-out"}')"
[ "$clash_http_out" = $'singbox_clash_http\trequest\tPUT\t/proxies/main-out\t{"name":"main-1-out"}' ] ||
  fail "clash_http must dispatch through singbox/clash_http.uc with method, path and body"

clash_summary_out="$(FORKOP_LIB="$fake_lib" ucode "$FORKOP_BIN" clash_summary)"
[ "$clash_summary_out" = $'singbox_clash_http\tsummary\t\t\t' ] ||
  fail "clash_summary must dispatch through singbox/clash_http.uc without arguments"

for removed in check_nft show_sing_box_version neutralize_zapret_defaults dnsmasq_restore \
  check_provider_runtime get_provider_status validate_provider_strategy_json \
  subscription_update clash_api; do
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

# A lifecycle command that failed has to reach its caller as a failure: the LuCI
# backend, the init script and anybody at a shell all branch on the exit code.
cat >"$fake_lib/service/lifecycle.uc" <<'UCODE'
#!/usr/bin/env ucode
exit(3);
UCODE
set +e
FORKOP_LIB="$fake_lib" ucode "$FORKOP_BIN" reload >/dev/null 2>&1
status="$?"
set -e
[ "$status" = "3" ] ||
  fail "forkop reload must return the lifecycle exit code, got $status"

# And the reason has to travel with it. It used to go to the system log alone,
# so a failed command printed nothing at all and left the caller to go looking.
lifecycle_error="$(ucode -L "$FORKOP_LIB" "$FORKOP_LIB/service/lifecycle.uc" \
  log-message-fixture error 'Runtime config validation failed. Aborted.' 2>&1 >/dev/null)"
[ "$lifecycle_error" = "Runtime config validation failed. Aborted." ] ||
  fail "a lifecycle error must reach stderr, got '$lifecycle_error'"

# On stderr and nowhere else: the init script reads the stdout of a reload to
# learn whether the service triggers need syncing.
lifecycle_stdout="$(ucode -L "$FORKOP_LIB" "$FORKOP_LIB/service/lifecycle.uc" \
  log-message-fixture error 'refused' 2>/dev/null)"
[ -z "$lifecycle_stdout" ] ||
  fail "a lifecycle error must not reach stdout, got '$lifecycle_stdout'"

lifecycle_info="$(ucode -L "$FORKOP_LIB" "$FORKOP_LIB/service/lifecycle.uc" \
  log-message-fixture info 'Applying configuration' 2>&1 >/dev/null)"
[ -z "$lifecycle_info" ] ||
  fail "only a lifecycle error belongs on stderr, got '$lifecycle_info'"

rm -f "$fake_lib/service/lifecycle.uc"
set +e
FORKOP_LIB="$fake_lib" \
  ucode "$FORKOP_BIN" start >/dev/null 2>"$WORK_DIR/missing.err"
status="$?"
set -e
[ "$status" -ne 0 ] ||
  fail "missing lifecycle module must fail"

printf 'CLI entrypoint checks passed\n'
