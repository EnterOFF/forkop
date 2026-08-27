#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
UI_UC="$ROOT_DIR/forkop/files/usr/lib/service/ui.uc"
FORKOP_INIT="$FORKOP_FILES/etc/init.d/forkop"

ui_ucode() {
  ucode -L "$FORKOP_FILES/usr/lib" "$UI_UC" "$@"
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
}

write_state() {
  local name="$1"
  local content="$2"

  printf '%s\n' "$content" >"$WORK_DIR/$name.json"
  printf '%s\n' "$WORK_DIR/$name.json"
}

if grep -R -n "ui_runtime.sh" "$FORKOP_FILES" >/dev/null 2>&1; then
  fail "runtime files must not reference ui_runtime.sh"
fi

ui_runtime_shell_symbols='ui_runtime_|forkop_fast_get_ui_state|FORKOP_UI_RUNTIME|load_ui_runtime'
if grep -R -n -E "$ui_runtime_shell_symbols" "$FORKOP_BIN" "$FORKOP_INIT" "$FORKOP_FILES/usr/lib" --include='*.sh' >/dev/null 2>&1; then
  fail "ui_runtime shell symbols must not remain in runtime shell"
fi

if grep -R -n '^get_ui_capabilities()' "$FORKOP_FILES/usr/lib" --include='*.sh' >/dev/null 2>&1; then
  fail "UI capabilities must be owned by service/ui.uc, not shell"
fi
grep -Fq 'require("core.uci")' "$UI_UC" ||
  fail "service/ui.uc must use core.uci for UI UCI-derived state"
if grep -n -E 'require\("uci"\)\.cursor|uci -q|uci", "-q"' "$UI_UC" >/dev/null 2>&1; then
  fail "service/ui.uc must not own direct UCI cursor or CLI reads"
fi
grep -Fq 'require("service.health")' "$UI_UC" ||
  fail "UI runtime status must use the lightweight health module"
grep -Fq 'health.forkop_stably_running(' "$UI_UC" ||
  fail "UI Forkop status must use stable runtime state to avoid crash-loop flicker"
grep -Fq 'health.sing_box_service_stable(' "$UI_UC" ||
  fail "UI sing-box status must use stable runtime state to avoid crash-loop flicker"
if sed -n '/^function ensure_dir(/,/^}/p' "$UI_UC" | grep -Fq 'mkdir", "-p'; then
  fail "UI state refresh must not spawn mkdir for existing directories"
fi
missing_state_dir="$WORK_DIR/missing-parent/ui-state"
FORKOP_UI_STATE_DIR="$missing_state_dir" \
  FORKOP_UI_SERVICE_ACTION_DIR="$missing_state_dir/service-actions" \
  FORKOP_UI_COMPONENT_ACTION_DIR="$missing_state_dir/component-actions" \
  ui_ucode active-service-action >/dev/null 2>&1 || true
[ -d "$missing_state_dir/service-actions" ] &&
  [ -d "$missing_state_dir/component-actions" ] ||
  fail "UI action state directories must bootstrap on a clean /var/run"
if sed -n '/^function cleanup_dir(/,/^}/p' "$UI_UC" | grep -Fq '"find"'; then
  fail "UI state refresh must clean action files without spawning find"
fi
grep -Fq 'run_pending_reload_after_service_action(action, success)' "$UI_UC" ||
  fail "UI service actions must run pending reload after the current action finishes"
grep -Fq 'let status = system(command);' "$UI_UC" ||
  fail "UI service action worker must run the init.d command and take its status"
grep -Fq 'finish_service_action_after_command(action, job_id_value, status);' "$UI_UC" ||
  fail "UI service action worker must finish from the command status, not from a second probe"
if grep -Fq 'service_action_wait_for_expected_state' "$UI_UC"; then
  fail "action completion must not be re-derived by polling after the command already waited"
fi
grep -Fq 'let args = [ SERVICE_INIT, action ];' "$UI_UC" ||
  fail "UI service action worker must use init.d so procd triggers stay registered"
grep -Fq 'start_service_action("reload", "initd", "pending")' "$UI_UC" ||
  fail "pending reload must enter the normal reload service action immediately"
grep -Fq 'if (lock.held(RELOAD_LOCK_DIR))' "$UI_UC" ||
  fail "pending reload must stay queued while another reload owns the reload lock"
if grep -n -E 'pgrep.*sing-box|service-list-instance-running' "$UI_UC" >/dev/null 2>&1; then
  fail "service/ui.uc must not use transient sing-box process probes for visible status"
fi

for mode in \
  get-ui-capabilities \
  get-ui-state \
  service-action-begin-if-idle \
  service-action-update-pid \
  service-action-finish-after-command \
  service-action-async \
  service-action-status \
  action-ack; do
  grep -Fq "\"$mode\"" "$UI_UC" ||
    fail "service/ui.uc must expose $mode"
done

assert_eq "/tmp/ui/job-1.json" \
  "$(ui_ucode job-state-path /tmp/ui job-1)" \
  "valid UI job path"

if ui_ucode job-state-path /tmp/ui '../bad' >/dev/null 2>&1; then
  fail "invalid UI job id should be rejected"
fi

ui_ucode service-action-valid restart >/dev/null ||
  fail "restart service action should be valid"
if ui_ucode service-action-valid invalid >/dev/null 2>&1; then
  fail "invalid service action should be rejected"
fi
assert_eq "running & enabled" \
  "$(ui_ucode service-status-text 1 1)" \
  "running enabled status"
assert_eq "running but disabled" \
  "$(ui_ucode service-status-text 1 0)" \
  "running disabled status"
assert_eq "stopped but enabled" \
  "$(ui_ucode service-status-text 0 1)" \
  "stopped enabled status"
assert_eq "stopped & disabled" \
  "$(ui_ucode service-status-text 0 0)" \
  "stopped disabled status"

running="$(write_state running '{"running":true,"pid":"456","started_at":100}')"
assert_eq "$(printf 'pid\t456\t0')" \
  "$(ui_ucode job-refresh-plan "$running" 105 15)" \
  "running UI job within grace"
assert_eq "$(printf 'pid\t456\t1')" \
  "$(ui_ucode job-refresh-plan "$running" 120 15)" \
  "running UI job after grace"

invalid_pid="$(write_state invalid-pid '{"running":true,"pid":"","started_at":100}')"
assert_eq "skip" \
  "$(ui_ucode job-refresh-plan "$invalid_pid" 105 15)" \
  "invalid UI pid within grace"
assert_eq "stale" \
  "$(ui_ucode job-refresh-plan "$invalid_pid" 120 15)" \
  "invalid UI pid after grace"

finished="$(write_state finished '{"running":false,"pid":"456","started_at":100}')"
assert_eq "skip" \
  "$(ui_ucode job-refresh-plan "$finished" 120 15)" \
  "finished UI job refresh"

stale_json="$(ui_ucode stale-action-state "$invalid_pid" "worker exited" 200)"
JSON_VALUE="$stale_json" node - <<'NODE'
const value = JSON.parse(process.env.JSON_VALUE);
if (value.running !== false || value.success !== false || value.message !== "worker exited") {
  console.error("UI stale state shape mismatch");
  process.exit(1);
}
NODE

acked="$(write_state acked '{"running":false,"acked_at":100}')"
ui_ucode action-ack-expired "$acked" 200 90 >/dev/null ||
  fail "acked state should be expired"
if ui_ucode action-ack-expired "$acked" 150 90 >/dev/null 2>&1; then
  fail "acked state should not expire before TTL"
fi

bad_ack="$(write_state bad-ack '{"running":false,"acked_at":"invalid"}')"
if ui_ucode action-ack-expired "$bad_ack" 200 90 >/dev/null 2>&1; then
  fail "invalid ack timestamp should not expire"
fi

cleanup_dir="$WORK_DIR/cleanup-actions"
mkdir -p "$cleanup_dir"
printf '%s\n' '{"running":false,"acked_at":1}' >"$cleanup_dir/done.json"
printf 'stdout\n' >"$cleanup_dir/done.out"
printf '{}\n' >"$cleanup_dir/done.out.json"
ui_ucode cleanup-action-dir-fixture "$cleanup_dir"
[ ! -e "$cleanup_dir/done.json" ] ||
  fail "expired acknowledged action state should be cleaned"
[ ! -e "$cleanup_dir/done.out" ] ||
  fail "expired acknowledged action stdout sidecar should be cleaned"
[ ! -e "$cleanup_dir/done.out.json" ] ||
  fail "expired acknowledged action JSON sidecar should be cleaned"

old_state="$cleanup_dir/old.json"
printf '%s\n' '{"running":false}' >"$old_state"
touch -d '2 hours ago' "$old_state"
FORKOP_UI_ACTION_FINISHED_TTL_MINUTES=60 ui_ucode cleanup-action-dir-fixture "$cleanup_dir"
[ ! -e "$old_state" ] ||
  fail "old finished action state should be cleaned without find"

export FORKOP_UI_STATE_DIR="$WORK_DIR/ui-state"
export FORKOP_UI_SERVICE_ACTION_DIR="$FORKOP_UI_STATE_DIR/service-actions"
export FORKOP_UI_SERVICE_ACTION_LOCK_DIR="$FORKOP_UI_STATE_DIR/service-actions.lock"
export FORKOP_UI_COMPONENT_ACTION_DIR="$FORKOP_UI_STATE_DIR/component-actions"

job_id="$(ui_ucode service-action-begin-if-idle reload test)"
[ -n "$job_id" ] || fail "service-action-begin-if-idle should create a job"
service_state="$FORKOP_UI_SERVICE_ACTION_DIR/$job_id.json"
[ -f "$service_state" ] || fail "service action state file should be created"
grep -Fq '"pid": null' "$service_state" ||
  fail "a job started without an owner pid should record none"
assert_eq "reload" \
  "$(ui_ucode active-service-action)" \
  "active-service-action should use the default service action dir"

if ui_ucode service-action-begin-if-idle restart test >/dev/null 2>&1; then
  fail "second service action should be rejected while first is running"
fi

ui_ucode service-action-update-pid "$job_id" "$$" >/dev/null ||
  fail "service-action-update-pid should update running job"
grep -Fq "\"pid\": \"$$\"" "$service_state" ||
  fail "service-action-update-pid should store the pid it was given"

# Finishing is immediate and needs no second process: the command that just
# returned is what waited for the service to get there.
FORKOP_SERVICE_INIT=/bin/true \
FORKOP_BIN=/bin/true \
FORKOP_LIB="$FORKOP_FILES/usr/lib" \
  ui_ucode service-action-finish-after-command reload "$job_id" 0 >/dev/null ||
  fail "service-action-finish-after-command should finish the action"

if grep -q '"running"[[:space:]]*:[[:space:]]*true' "$service_state"; then
  fail "service-action-finish-after-command should finish the running service action at once"
fi
grep -q '"success"[[:space:]]*:[[:space:]]*true' "$service_state" ||
  fail "a command that exited zero must finish the action as a success"

# And a non-zero exit is reported as the failure it is.
failed_job="$(ui_ucode service-action-begin-if-idle restart uitest "$$")"
[ -n "$failed_job" ] || fail "a second action should begin once the first has finished"
failed_state="$FORKOP_UI_SERVICE_ACTION_DIR/$failed_job.json"
FORKOP_SERVICE_INIT=/bin/false \
FORKOP_BIN=/bin/false \
FORKOP_LIB="$FORKOP_FILES/usr/lib" \
  ui_ucode service-action-finish-after-command restart "$failed_job" 1 >/dev/null ||
  fail "service-action-finish-after-command should record a failed action"
grep -q '"success"[[:space:]]*:[[:space:]]*false' "$failed_state" ||
  fail "a command that exited non-zero must finish the action as a failure"

ui_ucode service-action-finish "$job_id" true done 0 >/dev/null ||
  fail "service-action-finish should finish running job"

JOB_STATE="$service_state" node - <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.env.JOB_STATE, "utf8"));
if (value.running !== false || value.success !== true || value.message !== "done" || value.exit_code !== 0) {
  console.error("finished service action state mismatch");
  process.exit(1);
}
NODE

ui_ucode action-ack service "$job_id" >/dev/null ||
  fail "action-ack should acknowledge finished service action"

# The lifecycle passes its own pid when it opens the job, so a reload does not
# spend a second ucode process on setting it, and a running job is never
# without the pid its liveness check needs.
owned_job_id="$(ui_ucode service-action-begin-if-idle reload test 4242)"
[ -n "$owned_job_id" ] || fail "service-action-begin-if-idle should create a job with a pid"
grep -Fq '"pid": "4242"' "$FORKOP_UI_SERVICE_ACTION_DIR/$owned_job_id.json" ||
  fail "service-action-begin-if-idle should record the owner pid it was given"
ui_ucode service-action-finish "$owned_job_id" true done 0 >/dev/null ||
  fail "service-action-finish should finish the job opened with a pid"

not_a_pid_job_id="$(ui_ucode service-action-begin-if-idle reload test 'nonsense')"
[ -n "$not_a_pid_job_id" ] || fail "an unusable pid must not stop the job from opening"
grep -Fq '"pid": null' "$FORKOP_UI_SERVICE_ACTION_DIR/$not_a_pid_job_id.json" ||
  fail "an unusable pid must be recorded as none"

# The log feed hands out lines by cursor, so the only thing that can go wrong
# quietly is deciding which lines in a freshly read tail are new. Matching the
# last line we already hold is what survives unrelated entries arriving between
# two reads; counting would drift the moment the router was busy.
update_store_probe() {
  UPDATE_PROBE_DB="$1" \
  UPDATE_PROBE_TOUCH="$2" \
    ucode -L "$FORKOP_FILES/usr/lib" -e '
      let fs = require("fs");
      let db = getenv("UPDATE_PROBE_DB");
      fs.writefile(db, "one");

      let service = require("service.state_service");
      service.store_update_check("zapret", { component: "zapret", status: "outdated" });

      if (getenv("UPDATE_PROBE_TOUCH") == "1") {
        // A package was installed or removed: the database is rewritten, and
        // its size moves. Same-length content inside one second would be
        // indistinguishable, which a real install never is.
        fs.writefile(db, "two, and a good deal more of it");
      }

      print(length(service.update_check_results()), "\n");
    '
}

probe_db="$(mktemp)"
FORKOP_OPKG_STATUS_FILE="$probe_db" FORKOP_APK_DB_FILE="$probe_db.absent" \
  assert_eq "1" "$(FORKOP_OPKG_STATUS_FILE="$probe_db" FORKOP_APK_DB_FILE="$probe_db.absent" update_store_probe "$probe_db" 0)" \
  "a reported check is served back while the installed packages are unchanged"
assert_eq "0" "$(FORKOP_OPKG_STATUS_FILE="$probe_db" FORKOP_APK_DB_FILE="$probe_db.absent" update_store_probe "$probe_db" 1)" \
  "a check is dropped once the installed packages have changed under it"
rm -f "$probe_db"

settle_probe() {
  FORKOP_LIB="$FORKOP_FILES/usr/lib" \
  SETTLE_ARGS="$1" \
    ucode -L "$FORKOP_FILES/usr/lib" -e '
      let service = require("service.state_service");
      let a = split(getenv("SETTLE_ARGS"), " ");
      if (a[0] == "deadline")
        print(service.settle_deadline(int(a[1]), a[2] == "1", int(a[3])), "\n");
      else
        print(service.needs_close_refresh(int(a[1]), a[2] == "1", int(a[3]), int(a[4])) ? "yes" : "no", "\n");
    '
}

# A change restarts the window; no change leaves it where it was.
assert_eq "10000" "$(settle_probe "deadline 0 1 0")" "a change opens the settle window"
assert_eq "15000" "$(settle_probe "deadline 5000 1 10000")" "a later change moves the window out"
assert_eq "10000" "$(settle_probe "deadline 5000 0 10000")" "no change leaves the window alone"

# While an action runs, the close cadence applies regardless of the window.
assert_eq "yes" "$(settle_probe "close 5000 1 0 0")" "a running action is watched closely"
assert_eq "no" "$(settle_probe "close 500 1 0 0")" "and no faster than the cadence"

# The regression itself: the action has finished, so busy is false, but the
# window is still open and the runtime must keep being read.
assert_eq "yes" "$(settle_probe "close 5000 0 10000 0")" "a settling runtime is watched after the action ends"
assert_eq "no" "$(settle_probe "close 5000 0 10000 4500")" "but still no faster than the cadence"

# Once it has settled, the service goes quiet and leaves it to the sweep.
assert_eq "no" "$(settle_probe "close 20000 0 10000 0")" "a settled runtime falls back to the sweep"

# A port rebind is not an outage: a running service observed down while the
# sing-box process is still alive stays reported running until the flip has
# persisted for the grace. A dead process, or a service that was already down,
# is reported as it is at once.
settled_probe() {
  FORKOP_LIB="$FORKOP_FILES/usr/lib" \
  SETTLED_ARGS="$1" \
    ucode -L "$FORKOP_FILES/usr/lib" -e '
      let service = require("service.state_service");
      let a = split(getenv("SETTLED_ARGS"), " ");
      let result = service.settled_running(a[0] == "1", a[1] == "1", a[2] == "1", int(a[3]), int(a[4]), int(a[5]));
      print(result.running ? "1" : "0", " ", result.down_since_ms, "\n");
    '
}

# observed alive prev down_since now grace
assert_eq "1 0" "$(settled_probe "1 1 1 0 1000 15000")" "an observed running service is served as it is"
assert_eq "1 0" "$(settled_probe "1 1 0 500 1000 15000")" "coming back up clears the pending flip"
assert_eq "1 1000" "$(settled_probe "0 1 1 0 1000 15000")" "a fresh down look with a live process opens the grace"
assert_eq "1 1000" "$(settled_probe "0 1 1 1000 9000 15000")" "the held value is served while the grace lasts"
assert_eq "0 1000" "$(settled_probe "0 1 1 1000 16000 15000")" "a flip that persists past the grace is believed"
assert_eq "0 0" "$(settled_probe "0 0 1 0 1000 15000")" "a dead process is reported down at once"
assert_eq "0 0" "$(settled_probe "0 1 0 0 1000 15000")" "a service that was already down stays down"

log_delta() {
  FORKOP_LIB="$FORKOP_FILES/usr/lib" \
  LOG_DELTA_HELD="$1" \
  LOG_DELTA_TAIL="$2" \
    ucode -L "$FORKOP_FILES/usr/lib" -e '
      let service = require("service.state_service");
      let held = getenv("LOG_DELTA_HELD") || "";
      let tail = getenv("LOG_DELTA_TAIL") || "";
      for (let line in (held == "" ? [] : split(held, "|")))
        service.remember_log_line(line);
      print(join("|", service.new_log_lines(tail == "" ? [] : split(tail, "|"))), "\n");
    '
}

assert_eq "c" "$(log_delta "a|b" "a|b|c")" "only the lines after the last held one are new"
assert_eq "" "$(log_delta "a|b" "a|b")" "an unchanged tail produces nothing"
assert_eq "x|y" "$(log_delta "" "x|y")" "a first read takes the whole tail"
# The buffer scrolled past everything we held, so there is no anchor to match
# and reporting the whole tail is the honest answer.
assert_eq "p|q" "$(log_delta "a|b" "p|q")" "a tail with no overlap is taken whole"
# The same message can repeat; the last occurrence is the anchor.
assert_eq "z" "$(log_delta "a|b" "b|a|b|z")" "the last occurrence anchors a repeated line"

# The page parks a request on the state service and waits for it to be answered.
# The daemon releases every waiter at its own ceiling, so the browser has to be
# willing to wait longer than that: a reply arriving exactly at the ceiling must
# not be raced by the client giving up on it. The two numbers live on opposite
# sides of ubus, and drift apart the moment either is tuned alone.
STATE_SERVICE_UC="$FORKOP_FILES/usr/lib/service/state_service.uc"
WAIT_TRANSPORT_TS="$ROOT_DIR/fe-app-forkop/src/forkop/services/forkopWaitTransport.ts"
daemon_ceiling="$(sed -n 's/^const MAX_WAIT_MS = int(getenv("FORKOP_STATE_MAX_WAIT_MS") || "\([0-9]*\)").*$/\1/p' "$STATE_SERVICE_UC")"
client_ceiling="$(sed -n 's/^export const FORKOP_WAIT_TIMEOUT_MS = \([0-9]*\);$/\1/p' "$WAIT_TRANSPORT_TS")"
[ -n "$daemon_ceiling" ] ||
  fail "the state service must declare how long it parks a request"
[ -n "$client_ceiling" ] ||
  fail "the page must declare how long it waits for a parked request"
[ "$client_ceiling" -gt "$daemon_ceiling" ] ||
  fail "the page waits ${client_ceiling}ms for a request the daemon holds ${daemon_ceiling}ms"

printf 'UI runtime job checks passed\n'
