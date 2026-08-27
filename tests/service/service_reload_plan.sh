#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
RELOAD_UC="$ROOT_DIR/forkop/files/usr/lib/service/reload.uc"

PREVIOUS="$WORK_DIR/previous.state"
CURRENT="$WORK_DIR/current.state"

# format, service trigger key, then one value per signature the plan compares.
BASE_STATE=(3 service_trigger_signature svc sb nft cron)

write_state() {
  local file="$1"
  shift

  {
    printf 'format=%s\n' "$1"
    printf '%s=%s\n' "$2" "$3"
    printf 'sing_box_signature=%s\n' "$4"
    printf 'nft_signature=%s\n' "$5"
    printf 'cron_signature=%s\n' "$6"
  } >"$file"
}

# Writes the baseline to both files, then overrides one BASE_STATE field of the
# current one; the index is the position in BASE_STATE.
setup_case() {
  local index="$1"
  local value="$2"
  local current=("${BASE_STATE[@]}")

  [ -n "$index" ] && current[$index]="$value"
  write_state "$PREVIOUS" "${BASE_STATE[@]}"
  write_state "$CURRENT" "${current[@]}"
}

plan_value() {
  local file="$1"
  local key="$2"

  awk -F '\t' -v key="$key" '
    $1 == key { print $2; found = 1; exit }
    END { if (!found) exit 1 }
  ' "$file"
}

assert_plan_value() {
  local file="$1"
  local key="$2"
  local expected="$3"
  local actual

  actual="$(plan_value "$file" "$key")" ||
    fail "missing plan key $key"
  [ "$actual" = "$expected" ] ||
    fail "$key: expected '$expected', got '$actual'"
}

run_plan() {
  local name="$1"
  local output="$WORK_DIR/$name.plan"
  shift

  ucode "$RELOAD_UC" plan-state-files "$PREVIOUS" "$CURRENT" "$@" >"$output"
  printf '%s\n' "$output"
}

assert_plan_exit() {
  local expected="$1"
  local actual
  shift

  set +e
  ucode "$RELOAD_UC" plan-state-files "$PREVIOUS" "$CURRENT" "$@" >/dev/null 2>&1
  actual="$?"
  set -e
  [ "$actual" -eq "$expected" ] ||
    fail "plan-state-files: expected exit $expected, got $actual"
}

setup_case "" ""
plan="$(run_plan unchanged 0 0)"
assert_plan_value "$plan" has_work 0
assert_plan_value "$plan" changed_sing_box 0

setup_case 3 sb2
plan="$(run_plan sing_box_changed 0 0)"
assert_plan_value "$plan" changed_sing_box 1
assert_plan_value "$plan" needs_sing_box_reload 1
assert_plan_value "$plan" has_work 1

setup_case 4 nft2
plan="$(run_plan nft_changed 0 0)"
assert_plan_value "$plan" needs_nft_rebuild 1

setup_case "" ""
plan="$(run_plan cache_rebuild 0 1)"
assert_plan_value "$plan" changed_sing_box 1
assert_plan_value "$plan" needs_sing_box_reload 1

plan="$(run_plan forced_reload 1 0)"
assert_plan_value "$plan" changed_sing_box 0
assert_plan_value "$plan" needs_sing_box_reload 1

# A state file written before the trigger signature was renamed still compares
setup_case 3 sb2
legacy=("${BASE_STATE[@]}")
legacy[1]=restart_signature
write_state "$PREVIOUS" "${legacy[@]}"
plan="$(run_plan legacy_restart_signature 0 0)"
assert_plan_value "$plan" changed_service_triggers 0
assert_plan_value "$plan" changed_sing_box 1
assert_plan_value "$plan" needs_sing_box_reload 1

setup_case "" ""
older=("${BASE_STATE[@]}")
older[0]=2
write_state "$PREVIOUS" "${older[@]}"
assert_plan_exit 2 0 0

rm -f "$PREVIOUS"
assert_plan_exit 2 0 0

printf 'service reload plan checks passed\n'
