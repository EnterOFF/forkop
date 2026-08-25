#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_BIN="$ROOT_DIR/forkop/files/usr/bin/forkop"
FORKOP_INIT="$ROOT_DIR/forkop/files/etc/init.d/forkop"
CLI_UC="$FORKOP_BIN"
RUNTIME_STATE="$ROOT_DIR/forkop/files/usr/lib/runtime_state.sh"
UPDATES_RUNTIME="$ROOT_DIR/forkop/files/usr/lib/updates_runtime.sh"
LIFECYCLE_UC="$ROOT_DIR/forkop/files/usr/lib/service/lifecycle.uc"
UPDATES_UC="$ROOT_DIR/forkop/files/usr/lib/components/updates.uc"
STATE_UC="$ROOT_DIR/forkop/files/usr/lib/service/state.uc"
HEALTH_UC="$ROOT_DIR/forkop/files/usr/lib/service/health.uc"
NFT_UC="$ROOT_DIR/forkop/files/usr/lib/nft/apply.uc"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

[ ! -e "$RUNTIME_STATE" ] ||
  fail "runtime_state.sh shell owner must be removed"
[ ! -e "$UPDATES_RUNTIME" ] ||
  fail "updates_runtime.sh shell owner must be removed"

grep -Fq 'runtime_state.sh' "$FORKOP_BIN" &&
  fail "forkop must not source runtime_state.sh"

service_predicates='process_age_seconds|sing_box_service_pid|pid_is_sing_box|sing_box_service_is_running|sing_box_service_is_stable|forkop_runtime_network_is_configured|forkop_is_running|forkop_is_stably_running|wait_for_forkop_stable_start'
if grep -R -n -E "$service_predicates" "$FORKOP_BIN" "$ROOT_DIR/forkop/files/usr/lib" --include='*.sh' >/dev/null 2>&1; then
  fail "service running/stability predicates must not remain in shell"
fi

pending_state='mark_pending_reload|consume_pending_reload|run_pending_reload_if_requested|sync_time_if_needed'
if grep -R -n -E "$pending_state" "$FORKOP_BIN" "$FORKOP_INIT" "$ROOT_DIR/forkop/files/usr/lib" --include='*.sh' >/dev/null 2>&1; then
  fail "pending reload/time-sync ownership must not remain in shell"
fi

runtime_state_shell_symbols='runtime_state_ucode|acquire_runtime_dir_lock|release_runtime_dir_lock|capture_reload_state|write_reload_state_file|write_reload_state|clear_reload_state|populate_nft_runtime_sets|rebuild_nft_runtime|reload_sing_box_runtime|apply_pending_urltest_selector_switches|close_inherited_service_lock_fd|FORKOP_URLTEST_SELECTOR_SWITCHES'
if grep -R -n -E "$runtime_state_shell_symbols" "$FORKOP_BIN" "$FORKOP_INIT" "$ROOT_DIR/forkop/files/usr/lib" --include='*.sh' >/dev/null 2>&1; then
  fail "runtime_state.sh symbols must not remain in shell"
fi

if grep -Fq 'acquire_reload_lock' "$FORKOP_INIT" || grep -Fq 'release_reload_lock' "$FORKOP_INIT"; then
  fail "init.d must not own reload lock decisions"
fi

grep -Fq '#!/usr/bin/ucode' "$FORKOP_BIN" ||
  fail "forkop entrypoint must be a direct ucode executable"
grep -Fq 'service/lifecycle.uc' "$CLI_UC" ||
  fail "service/cli.uc must dispatch lifecycle orchestration through service/lifecycle.uc"
# Validation fills in the defaults a new server or section left out and commits
# them, so a fingerprint taken before it describes a configuration the reload
# itself then changed: the check at the end read its own writing as somebody
# else's and queued a second reload with nothing left to do. Both paths take it
# after validation.
node - "$LIFECYCLE_UC" <<'NODE'
const fs = require('fs');
const source = fs.readFileSync(process.argv[2], 'utf8');

for (const [path, fingerprint] of [
  ['start_main', 'startup_config_fingerprint = external_config_fingerprint()'],
  ['reload_impl', 'reload_config_fingerprint = external_config_fingerprint()'],
]) {
  const body = source.slice(source.indexOf(`function ${path}(`));
  const validate = body.indexOf('validate_start_config()');
  const snapshot = body.indexOf(fingerprint);

  if (validate < 0 || snapshot < 0) {
    console.error(`FAIL: ${path} must validate the configuration and fingerprint it`);
    process.exit(1);
  }
  if (snapshot < validate) {
    console.error(`FAIL: ${path} must fingerprint the configuration after validation fills its defaults`);
    process.exit(1);
  }
}
NODE

grep -Fq 'refresh-cron-from-uci' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc start/reload must call the ucode cron refresh operation"
grep -Fq 'remove-cron-jobs' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc stop must call the ucode cron removal operation"
grep -Fq 'RULESET_SYNC_UC, [ "start-worker" ]' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc must start native rule-set nft synchronization"
grep -Fq 'RULESET_SYNC_UC, [ "stop-worker" ]' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc must stop native rule-set nft synchronization"
# One transparent transport, plus the one narrowing command that exists because
# rpcd cannot carry a full connections snapshot. Neither is a per-endpoint CLI
# command, which is what the check below still refuses.
grep -Fq 'clash_http: [ "singbox/clash_http.uc", "request", 3 ]' "$CLI_UC" ||
  fail "service/cli.uc must expose exactly one allowlisted Clash API transport command"
grep -Fq 'clash_summary: [ "singbox/clash_http.uc", "summary", 0 ]' "$CLI_UC" ||
  fail "service/cli.uc must expose the narrowed connections summary from the same module"
# The transport is what a page on the fallback drives every couple of seconds, so
# it must not be reached through a module that loads the diagnostics graph first.
CLASH_HTTP_UC="$ROOT_DIR/forkop/files/usr/lib/singbox/clash_http.uc"
if grep -Eq 'require\("(diagnostics|service|config|nft|dns|components|providers|server)\.' "$CLASH_HTTP_UC"; then
  fail "the Clash API transport must not require a module outside core"
fi
if grep -Eq 'subscription_update:|clash_api:' "$CLI_UC"; then
  fail "service/cli.uc must not keep CLI commands that only duplicate Clash API endpoints"
fi
for retired in check_nft show_sing_box_version neutralize_zapret_defaults dnsmasq_restore \
  check_provider_runtime get_provider_status validate_provider_strategy_json; do
  if grep -Fq "$retired: [" "$CLI_UC"; then
    fail "service/cli.uc must not reintroduce the retired $retired command"
  fi
done
if grep -R -n -F 'updates_runtime.sh' "$FORKOP_BIN" "$ROOT_DIR/forkop/files/usr/lib" --include='*.sh' >/dev/null 2>&1; then
  fail "runtime shell must not reference updates_runtime.sh"
fi
grep -Fq 'mode == "refresh-cron-from-uci"' "$UPDATES_UC" ||
  fail "components/updates.uc must own cron refresh"
grep -Fq 'mode == "remove-cron-jobs"' "$UPDATES_UC" ||
  fail "components/updates.uc must own cron removal"
if grep -Fq 'mode == "list-update"' "$UPDATES_UC"; then
  fail "components/updates.uc must not retain native rule-set update orchestration"
fi
if grep -Fq 'mode == "subscription-update"' "$UPDATES_UC"; then
  fail "components/updates.uc must not retain native subscription update orchestration"
fi
grep -Fq 'HEALTH_MODE == "forkop-running"' "$STATE_UC" ||
  fail "service/state.uc must dispatch Forkop running checks before heavy imports"
grep -Fq 'function forkop_running(' "$HEALTH_UC" ||
  fail "service/health.uc must own the lightweight Forkop running predicate"
grep -Fq 'HEALTH_MODE == "sing-box-service-stable"' "$STATE_UC" ||
  fail "service/state.uc must dispatch stable sing-box checks before heavy imports"
grep -Fq 'mode == "wait-forkop-ready"' "$STATE_UC" ||
  fail "service/state.uc must own the lifecycle readiness wait"
grep -Fq 'getenv("FORKOP_SING_BOX_START_MAX_WAIT_SECONDS") || "300"' "$STATE_UC" ||
  fail "service/state.uc must cap a live but permanently unready sing-box start"
grep -Fq 'mode == "mark-pending-reload"' "$STATE_UC" ||
  fail "service/state.uc must own pending reload writes"
grep -Fq 'mode == "sync-time-if-needed"' "$STATE_UC" ||
  fail "service/state.uc must own time-sync decisions"
grep -Fq 'mode == "acquire-runtime-dir-lock"' "$STATE_UC" ||
  fail "service/state.uc must own runtime lock acquisition"
grep -Fq 'mode == "write-captured-reload-state"' "$STATE_UC" ||
  fail "service/state.uc must own captured reload state writes"
grep -Fq 'mode == "reload-sing-box-runtime"' "$STATE_UC" ||
  fail "service/state.uc must own sing-box runtime reload"
grep -Fq 'command_success_from_args([ SING_BOX_INIT, "reload" ])' "$STATE_UC" ||
  fail "sing-box runtime reload must use the init.d SIGHUP reload path"
if sed -n '/^function reload_sing_box_runtime(/,/^}$/p' "$STATE_UC" | grep -Eq '"(stop|start)"'; then
  fail "sing-box runtime reload must not stop or restart the process"
fi
grep -Fq 'mode == "wait-sing-box-stopped"' "$STATE_UC" ||
  fail "service/state.uc must expose a complete sing-box stop wait"
FORKOP_SING_BOX_INIT="$WORK_DIR/missing-sing-box-init" \
  ucode -L "$ROOT_DIR/forkop/files/usr/lib" "$LIFECYCLE_UC" sing-box-stop-service-fixture ||
  fail "missing sing-box init script must already count as stopped"
touch "$WORK_DIR/non-executable-sing-box-init"
FORKOP_SING_BOX_INIT="$WORK_DIR/non-executable-sing-box-init" \
  ucode -L "$ROOT_DIR/forkop/files/usr/lib" "$LIFECYCLE_UC" sing-box-stop-service-fixture ||
  fail "non-executable sing-box init script must already count as stopped"
printf '%s\n' '#!/bin/sh' 'exit 23' >"$WORK_DIR/failing-sing-box-init"
chmod 0755 "$WORK_DIR/failing-sing-box-init"
set +e
FORKOP_SING_BOX_INIT="$WORK_DIR/failing-sing-box-init" \
  ucode -L "$ROOT_DIR/forkop/files/usr/lib" "$LIFECYCLE_UC" sing-box-stop-service-fixture
failing_status="$?"
set -e
[ "$failing_status" -eq 23 ] ||
  fail "sing-box init failure status must be preserved"
grep -Fq '"wait-forkop-ready"' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc must verify a ready runtime after sing-box start/reload"
sing_box_start_line="$(grep -nF 'command_success_from_args([ SING_BOX_INIT, "start" ])' "$LIFECYCLE_UC" | head -n1 | cut -d: -f1)"
early_ready_line="$(awk -v start="$sing_box_start_line" 'NR > start && /"wait-forkop-ready"/ { print NR; exit }' "$LIFECYCLE_UC")"
start_window_line="$(awk -v start="$sing_box_start_line" 'NR > start && /START_READY_WINDOW/ { print NR; exit }' "$LIFECYCLE_UC")"
[ -n "$sing_box_start_line" ] ||
  fail "service/lifecycle.uc must start sing-box through init.d"
[ -n "$early_ready_line" ] ||
  fail "service/lifecycle.uc must verify a ready runtime immediately after sing-box start"
[ -n "$start_window_line" ] ||
  fail "service/lifecycle.uc must watch a fresh sing-box through the start window"
if grep -Fq 'run-deferred-bootstrap' "$LIFECYCLE_UC"; then
  fail "service/lifecycle.uc must leave subscription bootstrap to native providers"
fi
sing_box_reload_line="$(grep -nF '"reload-sing-box-runtime"' "$LIFECYCLE_UC" | head -n1 | cut -d: -f1)"
reload_window_line="$(awk -v start="$sing_box_reload_line" 'NR > start && /RELOAD_READY_WINDOW/ { print NR; exit }' "$LIFECYCLE_UC")"
[ -n "$sing_box_reload_line" ] ||
  fail "service/lifecycle.uc must reload sing-box through service/state.uc"
[ -n "$reload_window_line" ] ||
  fail "service/lifecycle.uc must verify readiness through the reload window after sing-box reload"
grep -Fq 'Reload verification failed after sing-box was reloaded; stopping Forkop runtime' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc must fail reload when sing-box does not stay stable"
if grep -n -E 'require\("uci"\)\.cursor|uci -q|uci", "-q"|uci_get_cli|uci_exists_cli|mwan3_has_enabled_interface_from_uci_show' "$STATE_UC" >/dev/null 2>&1; then
  fail "service/state.uc must not own direct UCI CLI/cursor access"
fi
# The rebuild carries no arguments: nft/apply.uc reads the runtime table, its sets
# and the marks from core/constants.uc, which is also the only table the caller could
# have read them from - restating them here is how a name ends up in the wrong slot.
grep -Fq 'module_status(NFT_UC, [ "nft-rebuild-runtime-from-uci" ])' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc reload must call nft rebuild through ucode without forwarding constants"
if grep -Fq 'nft-create-full-runtime-from-uci' "$LIFECYCLE_UC" "$NFT_UC"; then
  fail "forkop start/reload must rebuild nft runtime instead of appending to stale state"
fi
grep -Fq 'nft-populate-runtime-sets-from-uci' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc reload must call nft populate through ucode"
grep -Fq 'mode == "nft-rebuild-runtime-from-uci"' "$NFT_UC" ||
  fail "nft/apply.uc must own nft runtime rebuild"

printf 'runtime state ownership checks passed\n'
