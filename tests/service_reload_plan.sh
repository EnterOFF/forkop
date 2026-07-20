#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELOAD_UC="$ROOT_DIR/forkop/files/usr/lib/service/reload.uc"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

base_args=(
  svc dns sb nft zq zr z2q z2r br cron
  svc dns sb nft zq zr z2q z2r br cron 0
  0 0 0
)

write_plan() {
  local output="$1"
  shift
  ucode "$RELOAD_UC" plan "$@" >"$output"
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

run_case() {
  local name="$1"
  local output="$WORK_DIR/$name.plan"
  shift
  write_plan "$output" "$@"
  printf '%s\n' "$output"
}

write_state() {
  local file="$1"
  local service_key="$2"
  local service_value="$3"
  local dnsmasq="$4"
  local sing_box="$5"
  local nft="$6"
  local zapret_queue="$7"
  local zapret_runtime="$8"
  local zapret2_queue="$9"
  local zapret2_runtime="${10}"
  local byedpi_runtime="${11}"
  local cron="${12}"
  local dont_touch_dhcp="${13:-0}"
  local format="${14:-1}"

  {
    printf 'format=%s\n' "$format"
    printf '%s=%s\n' "$service_key" "$service_value"
    printf 'dnsmasq_signature=%s\n' "$dnsmasq"
    printf 'sing_box_signature=%s\n' "$sing_box"
    printf 'nft_signature=%s\n' "$nft"
    printf 'zapret_queue_signature=%s\n' "$zapret_queue"
    printf 'zapret_runtime_signature=%s\n' "$zapret_runtime"
    printf 'zapret2_queue_signature=%s\n' "$zapret2_queue"
    printf 'zapret2_runtime_signature=%s\n' "$zapret2_runtime"
    printf 'byedpi_runtime_signature=%s\n' "$byedpi_runtime"
    printf 'cron_signature=%s\n' "$cron"
    printf 'dont_touch_dhcp=%s\n' "$dont_touch_dhcp"
  } >"$file"
}

run_state_case() {
  local name="$1"
  local output="$WORK_DIR/$name.plan"
  local previous="$2"
  local current="$3"
  shift 3

  ucode "$RELOAD_UC" plan-state-files "$previous" "$current" "$@" >"$output"
  printf '%s\n' "$output"
}

assert_state_plan_exit() {
  local expected="$1"
  local previous="$2"
  local current="$3"
  local actual
  shift 3

  set +e
  ucode "$RELOAD_UC" plan-state-files "$previous" "$current" "$@" >/dev/null 2>&1
  actual="$?"
  set -e
  [ "$actual" -eq "$expected" ] ||
    fail "plan-state-files: expected exit $expected, got $actual"
}

args=("${base_args[@]}")
plan="$(run_case unchanged "${args[@]}")"
assert_plan_value "$plan" has_work 0
assert_plan_value "$plan" changed_sing_box 0

args=("${base_args[@]}")
args[12]=sb2
plan="$(run_case sing_box_changed "${args[@]}")"
assert_plan_value "$plan" changed_sing_box 1
assert_plan_value "$plan" needs_sing_box_reload 1
assert_plan_value "$plan" has_work 1

args=("${base_args[@]}")
args[14]=zq2
plan="$(run_case zapret_queue_changed "${args[@]}")"
assert_plan_value "$plan" changed_zapret_queue 1
assert_plan_value "$plan" needs_zapret_restart 1
assert_plan_value "$plan" needs_nft_rebuild 1
assert_plan_value "$plan" needs_sing_box_reload 1

args=("${base_args[@]}")
args[11]=dns2
plan="$(run_case dnsmasq_configure "${args[@]}")"
assert_plan_value "$plan" changed_dnsmasq 1
assert_plan_value "$plan" needs_dnsmasq_configure 1
assert_plan_value "$plan" needs_dnsmasq_restore 0

args=("${base_args[@]}")
args[11]=dns2
args[20]=1
args[22]=1
plan="$(run_case dnsmasq_restore "${args[@]}")"
assert_plan_value "$plan" needs_dnsmasq_configure 0
assert_plan_value "$plan" needs_dnsmasq_restore 1

args=("${base_args[@]}")
args[13]=nft2
plan="$(run_case nft_changed "${args[@]}")"
assert_plan_value "$plan" needs_nft_rebuild 1

args=("${base_args[@]}")
args[23]=1
plan="$(run_case cache_rebuild "${args[@]}")"
assert_plan_value "$plan" changed_sing_box 1
assert_plan_value "$plan" needs_sing_box_reload 1

args=("${base_args[@]}")
args[21]=1
plan="$(run_case forced_reload "${args[@]}")"
assert_plan_value "$plan" changed_sing_box 0
assert_plan_value "$plan" needs_sing_box_reload 1

previous_state="$WORK_DIR/previous.state"
current_state="$WORK_DIR/current.state"
write_state "$previous_state" service_trigger_signature svc dns sb nft zq zr z2q z2r br cron 0
write_state "$current_state" service_trigger_signature svc dns sb nft zq zr z2q z2r br cron 0
plan="$(run_state_case state_unchanged "$previous_state" "$current_state" 0 0 0)"
assert_plan_value "$plan" has_work 0
assert_plan_value "$plan" changed_sing_box 0

write_state "$previous_state" restart_signature svc dns sb nft zq zr z2q z2r br cron 0
write_state "$current_state" service_trigger_signature svc dns sb2 nft zq zr z2q z2r br cron 0
plan="$(run_state_case state_legacy_restart_signature "$previous_state" "$current_state" 0 0 0)"
assert_plan_value "$plan" changed_service_triggers 0
assert_plan_value "$plan" changed_sing_box 1
assert_plan_value "$plan" needs_sing_box_reload 1

write_state "$previous_state" service_trigger_signature svc dns sb nft zq zr z2q z2r br cron 0 0
write_state "$current_state" service_trigger_signature svc dns sb nft zq zr z2q z2r br cron 0 1
assert_state_plan_exit 2 "$previous_state" "$current_state" 0 0 0

rm -f "$previous_state"
assert_state_plan_exit 2 "$previous_state" "$current_state" 0 0 0

printf 'service reload plan checks passed\n'
