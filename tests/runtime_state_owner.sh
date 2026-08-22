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
grep -Fq 'refresh-cron-from-uci' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc start/reload must call the ucode cron refresh operation"
grep -Fq 'remove-cron-jobs' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc stop must call the ucode cron removal operation"
grep -Fq 'RULESET_SYNC_UC, [ "start-worker" ]' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc must start native rule-set nft synchronization"
grep -Fq 'RULESET_SYNC_UC, [ "stop-worker" ]' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc must stop native rule-set nft synchronization"
grep -Fq 'clash_http: [ "diagnostics/runtime.uc", "clash-http", 3 ]' "$CLI_UC" ||
  fail "service/cli.uc must expose exactly one allowlisted Clash API transport command"
if grep -Eq 'subscription_update:|clash_api:' "$CLI_UC"; then
  fail "service/cli.uc must not keep CLI commands that only duplicate Clash API endpoints"
fi
for merged in check_provider_runtime get_provider_status validate_provider_strategy_json; do
  grep -Fq "$merged: [" "$CLI_UC" ||
    fail "service/cli.uc must expose one $merged command for every DPI provider"
done
for retired in check_nft show_sing_box_version neutralize_zapret_defaults dnsmasq_restore \
  check_zapret_runtime check_zapret2_runtime check_byedpi_runtime \
  get_zapret_status get_zapret2_status get_byedpi_status \
  validate_nfqws_strategy_json validate_nfqws2_strategy_json validate_byedpi_strategy_json; do
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
grep -Fq 'mode == "wait-forkop-stable-start"' "$STATE_UC" ||
  fail "service/state.uc must own stable-start waiting"
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
grep -Fq '"wait-forkop-stable-start"' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc must verify stable runtime after sing-box start/reload"
grep -Fq 'SING_BOX_START_STABLE_MIN_AGE' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc must use a dedicated sing-box start stability window"
sing_box_start_line="$(grep -nF 'command_success_from_args([ SING_BOX_INIT, "start" ])' "$LIFECYCLE_UC" | head -n1 | cut -d: -f1)"
early_stable_line="$(awk -v start="$sing_box_start_line" 'NR > start && /"wait-forkop-stable-start"/ { print NR; exit }' "$LIFECYCLE_UC")"
start_stable_min_age_line="$(awk -v start="$sing_box_start_line" 'NR > start && /SING_BOX_START_STABLE_MIN_AGE/ { print NR; exit }' "$LIFECYCLE_UC")"
[ -n "$sing_box_start_line" ] ||
  fail "service/lifecycle.uc must start sing-box through init.d"
[ -n "$early_stable_line" ] ||
  fail "service/lifecycle.uc must verify stable runtime immediately after sing-box start"
[ -n "$start_stable_min_age_line" ] ||
  fail "service/lifecycle.uc must use the dedicated sing-box start stability window"
if grep -Fq 'run-deferred-bootstrap' "$LIFECYCLE_UC"; then
  fail "service/lifecycle.uc must leave subscription bootstrap to native providers"
fi
sing_box_reload_line="$(grep -nF '"reload-sing-box-runtime"' "$LIFECYCLE_UC" | head -n1 | cut -d: -f1)"
reload_stable_min_age_line="$(awk -v start="$sing_box_reload_line" 'NR > start && /SING_BOX_START_STABLE_MIN_AGE/ { print NR; exit }' "$LIFECYCLE_UC")"
[ -n "$sing_box_reload_line" ] ||
  fail "service/lifecycle.uc must reload sing-box through service/state.uc"
[ -n "$reload_stable_min_age_line" ] ||
  fail "service/lifecycle.uc must use the dedicated sing-box start stability window after sing-box reload"
grep -Fq 'Reload verification failed after sing-box was reloaded; stopping Forkop runtime' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc must fail reload when sing-box does not stay stable"
grep -Fq 'Reload runtime restart verification failed after Forkop was started; rolling back DNS changes' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc must fail full runtime restart when sing-box does not stay stable"
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
