#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
STATE_UC="$ROOT_DIR/forkop/files/usr/lib/service/state.uc"
HEALTH_UC="$ROOT_DIR/forkop/files/usr/lib/service/health.uc"
NFT_UC="$ROOT_DIR/forkop/files/usr/lib/nft/apply.uc"
WORK_DIR="$(mktemp -d)"
export ZAPRET_DEFAULT_NFQWS_OPT="--default-zapret"
export ZAPRET2_DEFAULT_NFQWS2_OPT="--default-zapret2"
export BYEDPI_DEFAULT_CMD_OPTS="--default-bye"
export FORKOP_FAKE_INIT_CAPTURE="$WORK_DIR/pending-reload-init.args"
# service/state.uc asks nft/apply.uc for the nft signature, and the library it
# reaches for is the one FORKOP_LIB names.
export FORKOP_LIB

cleanup() {
  if [ -n "${sing_box_pid:-}" ]; then
    kill "$sing_box_pid" >/dev/null 2>&1 || true
    wait "$sing_box_pid" 2>/dev/null || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
}

md5_file() {
  md5sum "$1" | awk '{print $1}'
}

state_ucode() {
  ucode -L "$FORKOP_LIB" "$STATE_UC" "$@"
}

nft_ucode() {
  ucode -L "$FORKOP_LIB" "$NFT_UC" "$@"
}

state_ucode time-sync-needed 2023 >/dev/null ||
  fail "time sync should be needed for invalid pre-2024 clock"
if state_ucode time-sync-needed 2024 >/dev/null 2>&1; then
  fail "time sync should not be needed for current clock"
fi

if state_ucode sing-box-runtime-reload-needed-fixture same same 0 >/dev/null 2>&1; then
  fail "unchanged sing-box config must skip an ordinary runtime reload"
fi
state_ucode sing-box-runtime-reload-needed-fixture old new 0 >/dev/null ||
  fail "changed sing-box config must reload the runtime"
state_ucode sing-box-runtime-reload-needed-fixture same same 1 >/dev/null ||
  fail "forced runtime reload must reload unchanged sing-box config"

cat >"$WORK_DIR/sing-box-init" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >"$FORKOP_FAKE_SING_BOX_INIT_CAPTURE"
SH
chmod 0755 "$WORK_DIR/sing-box-init"
capture="$WORK_DIR/sing-box-init.args"
FORKOP_SING_BOX_INIT="$WORK_DIR/sing-box-init" \
FORKOP_FAKE_SING_BOX_INIT_CAPTURE="$capture" \
  state_ucode reload-sing-box-runtime old new 0
assert_eq "reload" "$(cat "$capture")" "changed config sing-box init action"
rm -f "$capture"
FORKOP_SING_BOX_INIT="$WORK_DIR/sing-box-init" \
FORKOP_FAKE_SING_BOX_INIT_CAPTURE="$capture" \
  state_ucode reload-sing-box-runtime same same 0
[ ! -e "$capture" ] || fail "unchanged config must not call sing-box init"
FORKOP_SING_BOX_INIT="$WORK_DIR/sing-box-init" \
FORKOP_FAKE_SING_BOX_INIT_CAPTURE="$capture" \
  state_ucode reload-sing-box-runtime same same 1
assert_eq "reload" "$(cat "$capture")" "forced sing-box init action"

assert_eq "8" \
  "$(state_ucode process-age-seconds-fixture 786161359 786162159)" \
  "process age on a shared kernel tick scale"
if state_ucode process-age-seconds-fixture 786162159 786161359 >/dev/null 2>&1; then
  fail "process age must reject a current tick value older than the process"
fi
grep -Fq 'require("service.health")' "$STATE_UC" ||
  fail "service/state.uc must reuse the lightweight health predicates"
# The age is measured against the start time of a spawned child on purpose, and
# both shortcuts out of that spawn are guarded here because each one looks
# harmless on its own. /proc/uptime is virtualized inside a container while the
# start tick in /proc/<pid>/stat is not, and /proc/self/stat read inline now
# answers for the long-lived lifecycle process instead of the current moment.
# The body is captured first so that a changed signature fails here rather than
# leaving an empty haystack that matches nothing.
process_age_body="$(sed -n '/^function process_age_seconds(pid, expected_start_ticks) {$/,/^}$/p' "$HEALTH_UC")"
[ -n "$process_age_body" ] ||
  fail "process_age_seconds must stay a named function in service/health.uc"
case "$process_age_body" in
  */proc/uptime*)
    fail "process age must not mix process start ticks with virtualized /proc/uptime" ;;
esac
case "$process_age_body" in
  *'readfile("/proc/self/stat'*)
    fail "process age must take the current tick from a spawned child, not from lifecycle itself" ;;
esac

mkdir -p "$WORK_DIR/stable-start-bin"
cp "$(command -v sleep)" "$WORK_DIR/stable-start-bin/sing-box"
cat >"$WORK_DIR/stable-start-bin/ubus" <<'SH'
#!/usr/bin/env bash
set -eo pipefail

pid="$(cat "${SING_BOX_TEST_PID_FILE:?}")"
if [ -r "/proc/$pid/exe" ] && [ "$(basename "$(readlink "/proc/$pid/exe")")" = "sing-box" ]; then
  printf '{"sing-box":{"instances":{"instance1":{"running":true,"pid":%s}}}}\n' "$pid"
else
  printf '{"sing-box":{"instances":{}}}\n'
fi
SH
cat >"$WORK_DIR/stable-start-bin/nft" <<'SH'
#!/usr/bin/env bash
if [ -n "${FORKOP_TEST_NFT_ARGS_FILE:-}" ]; then
  printf '%s\n' "$*" >>"$FORKOP_TEST_NFT_ARGS_FILE"
fi
if [ "$1" = "list" ] && [ "$2" = "tables" ]; then
  printf '%s\n' 'table inet fw4'
  [ -n "${FORKOP_TEST_NFT_TABLE_MISSING:-}" ] || printf '%s\n' 'table inet ForkopTable'
fi
exit 0
SH
cat >"$WORK_DIR/stable-start-bin/ip-full" <<'SH'
#!/usr/bin/env bash
# The runtime check asks for both lists of one family in a single batch, so the
# fake answers both and lets the caller tell them apart by shape.
if [ "$2" = "-batch" ]; then
  cat >/dev/null
  case "$1" in
    -6) printf '%s\n' 'local default dev lo metric 1024 pref medium' ;;
    *) printf '%s\n' 'local default dev lo scope host' ;;
  esac
  printf '%s\n' '105:\tfrom all fwmark 0x100000/0x100000 lookup forkop'
  exit 0
fi
case "$1" in
  route) printf '%s\n' 'local default dev lo scope host' ;;
  -6)
    if [ "$2" = "route" ]; then
      printf '%s\n' 'local default dev lo metric 1024 pref medium'
    else
      printf '%s\n' '105: from all fwmark 0x100000/0x100000 lookup forkop'
    fi
    ;;
  -4) printf '%s\n' '105: from all fwmark 0x100000/0x100000 lookup forkop' ;;
esac
SH
chmod 0755 "$WORK_DIR/stable-start-bin/ubus" "$WORK_DIR/stable-start-bin/nft" "$WORK_DIR/stable-start-bin/ip-full"
export FORKOP_IP_BIN="$WORK_DIR/stable-start-bin/ip-full"
mkdir -p "$WORK_DIR/fast-wait-bin"
cat >"$WORK_DIR/fast-wait-bin/sleep" <<'SH'
#!/usr/bin/env bash
# Readiness is read from a /proc fixture rather than run as a command, so the
# wait loop's own sleep is what counts the polls and what flips the fixture to
# ready. The loop sleeps once per failed poll, so becoming ready on poll N takes
# N-1 sleeps.
if [ -n "${SING_BOX_TEST_POLL_COUNT_FILE:-}" ]; then
  count=0
  [ ! -s "$SING_BOX_TEST_POLL_COUNT_FILE" ] || count="$(cat "$SING_BOX_TEST_POLL_COUNT_FILE")"
  count=$((count + 1))
  printf '%s\n' "$count" >"$SING_BOX_TEST_POLL_COUNT_FILE"
  if [ -n "${SING_BOX_TEST_READY_AFTER_SLEEPS:-}" ] &&
     [ "$count" -ge "$SING_BOX_TEST_READY_AFTER_SLEEPS" ]; then
    cp "${SING_BOX_TEST_READY_PROC_TCP:?}" "${FORKOP_PROC_NET_TCP:?}"
  fi
fi
if [ -n "${SING_BOX_TEST_KILL_PID_FILE:-}" ]; then
  printf 'sleep\n' >>"${SING_BOX_TEST_SLEEP_COUNT_FILE:?}"
  kill "$(cat "$SING_BOX_TEST_KILL_PID_FILE")" >/dev/null 2>&1 || true
fi
SH
chmod 0755 "$WORK_DIR/fast-wait-bin/sleep"
cat >"$WORK_DIR/proc-net-tcp.ready" <<'EOF_PROC'
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 2A00007F:0035 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 4643 1 fcf08d00 100 0 0 10 5
   1: 00000000:0642 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 989469 2 b4a02044 100 0 0 10 4096
EOF_PROC
sed '/2A00007F:0035/d' "$WORK_DIR/proc-net-tcp.ready" >"$WORK_DIR/proc-net-tcp.no-dns"
cat >"$WORK_DIR/proc-net-tcp6.ready" <<'EOF_PROC6'
  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000001000000:0642 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 989472 2 0f713155 100 0 0 10 4096
EOF_PROC6
export FORKOP_PROC_NET_TCP6="$WORK_DIR/proc-net-tcp6.ready"

"$WORK_DIR/stable-start-bin/sing-box" 30 &
sing_box_pid=$!
printf '%s\n' "$sing_box_pid" >"$WORK_DIR/sing-box.pid"
if ! PATH="$WORK_DIR/stable-start-bin:$PATH" \
  SING_BOX_TEST_PID_FILE="$WORK_DIR/sing-box.pid" \
  FORKOP_PROC_NET_TCP="$WORK_DIR/proc-net-tcp.ready" \
  state_ucode sing-box-service-running; then
  kill "$sing_box_pid" >/dev/null 2>&1 || true
  wait "$sing_box_pid" 2>/dev/null || true
  fail "stable-start fixture must expose a running sing-box process"
fi
if ! PATH="$WORK_DIR/stable-start-bin:$PATH" \
  SING_BOX_TEST_PID_FILE="$WORK_DIR/sing-box.pid" \
  FORKOP_PROC_NET_TCP="$WORK_DIR/proc-net-tcp.ready" \
  FORKOP_TEST_NFT_ARGS_FILE="$WORK_DIR/nft.args" \
  state_ucode forkop-running forkop ForkopTable 0x00100000; then
  kill "$sing_box_pid" >/dev/null 2>&1 || true
  wait "$sing_box_pid" 2>/dev/null || true
  fail "stable-start fixture must expose configured Forkop networking"
fi
# Whether the table exists is the whole question, and this check runs on every
# reload, in every readiness poll and behind every UI status refresh. Naming the
# table makes nft walk and filter the whole rule set to prove something the table
# index already knows, and listing set contents along the way makes it cost
# seconds once a rule set holds real lists.
if ! grep -Fq -- 'list tables inet' "$WORK_DIR/nft.args"; then
  kill "$sing_box_pid" >/dev/null 2>&1 || true
  wait "$sing_box_pid" 2>/dev/null || true
  fail "the runtime table check must read the table index, not a named table"
fi
if PATH="$WORK_DIR/stable-start-bin:$PATH" \
  SING_BOX_TEST_PID_FILE="$WORK_DIR/sing-box.pid" \
  FORKOP_PROC_NET_TCP="$WORK_DIR/proc-net-tcp.no-dns" \
  state_ucode forkop-running forkop ForkopTable 0x00100000 >/dev/null 2>&1; then
  kill "$sing_box_pid" >/dev/null 2>&1 || true
  wait "$sing_box_pid" 2>/dev/null || true
  fail "runtime state must reject sing-box without the DNS inbound"
fi
# One readiness wait serves both a start and a live reload, dated from the
# moment it is called. A start's window watches a fresh process for an early
# crash; a reload leaves the process in place, so its window only has to
# outlast the gap between the HUP signal and the ports dropping - and the hold
# means no snapshot taken before the rebind can satisfy it.
cp "$WORK_DIR/proc-net-tcp.ready" "$WORK_DIR/ready-hold-proc-net-tcp"
if ! PATH="$WORK_DIR/fast-wait-bin:$WORK_DIR/stable-start-bin:$PATH" \
  FORKOP_SING_BOX_START_MAX_WAIT_SECONDS=30 \
  SING_BOX_TEST_PID_FILE="$WORK_DIR/sing-box.pid" \
  FORKOP_PROC_NET_TCP="$WORK_DIR/ready-hold-proc-net-tcp" \
  SING_BOX_TEST_POLL_COUNT_FILE="$WORK_DIR/ready-hold-poll.count" \
  state_ucode wait-forkop-ready forkop ForkopTable 0x00100000 2 2; then
  fail "ready wait must accept a runtime whose readiness holds"
fi
assert_eq "2" "$(cat "$WORK_DIR/ready-hold-poll.count")" \
  "ready wait must watch readiness hold rather than accept the first look"

# Readiness that only appears once the rebind is over still has to hold
# afterwards: three polls before it comes back, then the two-second hold.
cp "$WORK_DIR/proc-net-tcp.no-dns" "$WORK_DIR/late-ready-proc-net-tcp"
if ! PATH="$WORK_DIR/fast-wait-bin:$WORK_DIR/stable-start-bin:$PATH" \
  FORKOP_SING_BOX_START_MAX_WAIT_SECONDS=30 \
  SING_BOX_TEST_PID_FILE="$WORK_DIR/sing-box.pid" \
  FORKOP_PROC_NET_TCP="$WORK_DIR/late-ready-proc-net-tcp" \
  SING_BOX_TEST_READY_PROC_TCP="$WORK_DIR/proc-net-tcp.ready" \
  SING_BOX_TEST_READY_AFTER_SLEEPS=3 \
  SING_BOX_TEST_POLL_COUNT_FILE="$WORK_DIR/late-ready-poll.count" \
  state_ucode wait-forkop-ready forkop ForkopTable 0x00100000 2 2; then
  fail "ready wait must keep polling until the rebind finishes"
fi
assert_eq "5" "$(cat "$WORK_DIR/late-ready-poll.count")" \
  "ready wait polls: three for the rebind, two for the hold"

# The window is the other half. A runtime that was ready the whole time still has
# to sit it out, because ready the whole time is exactly what the pre-rebind
# runtime looked like.
cp "$WORK_DIR/proc-net-tcp.ready" "$WORK_DIR/window-proc-net-tcp"
if ! PATH="$WORK_DIR/fast-wait-bin:$WORK_DIR/stable-start-bin:$PATH" \
  FORKOP_SING_BOX_START_MAX_WAIT_SECONDS=30 \
  SING_BOX_TEST_PID_FILE="$WORK_DIR/sing-box.pid" \
  FORKOP_PROC_NET_TCP="$WORK_DIR/window-proc-net-tcp" \
  SING_BOX_TEST_POLL_COUNT_FILE="$WORK_DIR/window-poll.count" \
  state_ucode wait-forkop-ready forkop ForkopTable 0x00100000 6 2; then
  fail "ready wait must sit out the stability window it was given"
fi
assert_eq "6" "$(cat "$WORK_DIR/window-poll.count")" \
  "ready wait must sit out the stability window it was given"

if PATH="$WORK_DIR/fast-wait-bin:$WORK_DIR/stable-start-bin:$PATH" \
  FORKOP_SING_BOX_START_MAX_WAIT_SECONDS=1 \
  SING_BOX_TEST_PID_FILE="$WORK_DIR/sing-box.pid" \
  FORKOP_PROC_NET_TCP="$WORK_DIR/proc-net-tcp.no-dns" \
  state_ucode wait-forkop-ready forkop ForkopTable 0x00100000 2 2 >/dev/null 2>&1; then
  fail "ready wait must stop waiting for a permanently unready live process"
fi
kill -0 "$sing_box_pid" >/dev/null 2>&1 ||
  fail "ready wait timeout must not be confused with process exit"

# The wait is pinned to the process it started watching: whatever exits or gets
# respawned mid-wait is not the runtime the caller built, so it fails at once
# instead of waiting out FORKOP_SING_BOX_START_MAX_WAIT_SECONDS.
if PATH="$WORK_DIR/fast-wait-bin:$WORK_DIR/stable-start-bin:$PATH" \
  SING_BOX_TEST_PID_FILE="$WORK_DIR/sing-box.pid" \
  FORKOP_PROC_NET_TCP="$WORK_DIR/proc-net-tcp.no-dns" \
  SING_BOX_TEST_KILL_PID_FILE="$WORK_DIR/sing-box.pid" \
  SING_BOX_TEST_SLEEP_COUNT_FILE="$WORK_DIR/sleep.count" \
  state_ucode wait-forkop-ready forkop ForkopTable 0x00100000 2 2 >/dev/null 2>&1; then
  fail "ready wait must fail when the tracked sing-box process exits"
fi
# The killed process stays a zombie until the test shell reaps it, and a zombie
# still has a /proc entry, so the wait can need one more poll before the exit
# becomes visible.
exit_detection_polls="$(wc -l <"$WORK_DIR/sleep.count" | tr -d ' ')"
[ "$exit_detection_polls" -ge 1 ] && [ "$exit_detection_polls" -le 2 ] ||
  fail "ready wait exit detection polls: expected 1 or 2, got '$exit_detection_polls'"
wait "$sing_box_pid" 2>/dev/null || true

# With the process already gone there is nothing to pin the wait to.
if PATH="$WORK_DIR/fast-wait-bin:$WORK_DIR/stable-start-bin:$PATH" \
  SING_BOX_TEST_PID_FILE="$WORK_DIR/sing-box.pid" \
  FORKOP_PROC_NET_TCP="$WORK_DIR/proc-net-tcp.ready" \
  state_ucode wait-forkop-ready forkop ForkopTable 0x00100000 2 2 >/dev/null 2>&1; then
  fail "ready wait must fail at once without a running sing-box process"
fi
sing_box_pid=""

PENDING_RELOAD_FILE="$WORK_DIR/reload.pending"
state_ucode mark-pending-reload "$PENDING_RELOAD_FILE" "reload_busy"
grep -Fxq "reason=reload_busy" "$PENDING_RELOAD_FILE" ||
  fail "pending reload reason should be written by ucode"
updated_at="$(sed -n 's/^updated_at=//p' "$PENDING_RELOAD_FILE")"
case "$updated_at" in
  ''|*[!0-9]*) fail "pending reload updated_at should be numeric, got '$updated_at'" ;;
esac
state_ucode consume-pending-reload "$PENDING_RELOAD_FILE" >/dev/null ||
  fail "pending reload should be consumed"
[ ! -e "$PENDING_RELOAD_FILE" ] ||
  fail "pending reload file should be removed after consume"
if state_ucode consume-pending-reload "$PENDING_RELOAD_FILE" >/dev/null 2>&1; then
  fail "missing pending reload should not be consumed"
fi

cat >"$WORK_DIR/fake-init" <<'SH'
#!/bin/sh
printf '%s\n' "$1" >"$FORKOP_FAKE_INIT_CAPTURE"
SH
chmod +x "$WORK_DIR/fake-init"
state_ucode mark-pending-reload "$PENDING_RELOAD_FILE" "reload_busy"
state_ucode run-pending-reload-if-requested "$PENDING_RELOAD_FILE" "$WORK_DIR/fake-init"
for _ in $(seq 1 20); do
  [ -s "$FORKOP_FAKE_INIT_CAPTURE" ] && break
  sleep 0.1
done
assert_eq "reload" \
  "$(cat "$FORKOP_FAKE_INIT_CAPTURE")" \
  "pending reload should invoke init.d reload"
[ ! -e "$PENDING_RELOAD_FILE" ] ||
  fail "pending reload should be consumed when worker is started"

LOCK_DIR="$WORK_DIR/runtime.lock"
state_ucode acquire-runtime-dir-lock "$LOCK_DIR" "$$" ||
  fail "ucode should acquire runtime dir lock"
assert_eq "$$" "$(cat "$LOCK_DIR/pid")" "runtime lock owner pid"
if ! state_ucode runtime-dir-lock-held "$LOCK_DIR"; then
  fail "a lock owned by a live pid must report as held"
fi
if state_ucode acquire-runtime-dir-lock "$LOCK_DIR" "$$" >/dev/null 2>&1; then
  fail "ucode should reject a lock held by a live pid"
fi
if state_ucode acquire-runtime-dir-lock-wait "$LOCK_DIR" "$$" 0 >/dev/null 2>&1; then
  fail "ucode wait lock should time out for a live holder"
fi
state_ucode release-runtime-dir-lock "$LOCK_DIR" 999999
[ -e "$LOCK_DIR" ] ||
  fail "ucode must not release a runtime lock owned by another pid"
state_ucode release-runtime-dir-lock "$LOCK_DIR" "$$"
[ ! -e "$LOCK_DIR" ] ||
  fail "ucode should remove runtime dir lock"
if state_ucode runtime-dir-lock-held "$LOCK_DIR"; then
  fail "a released lock must not report as held"
fi
mkdir -p "$LOCK_DIR"
printf '%s\n' 999999 >"$LOCK_DIR/pid"
if state_ucode runtime-dir-lock-held "$LOCK_DIR"; then
  fail "a lock left by a dead owner must not report as held"
fi
rm -rf "$LOCK_DIR"

NESTED_LOCK_DIR="$WORK_DIR/missing-runtime-dir/start.lock"
state_ucode acquire-runtime-dir-lock "$NESTED_LOCK_DIR" "$$" ||
  fail "ucode should create the parent of a cold-start runtime lock"
assert_eq "$$" "$(cat "$NESTED_LOCK_DIR/pid")" "cold-start runtime lock owner pid"
state_ucode release-runtime-dir-lock "$NESTED_LOCK_DIR" "$$"
[ ! -e "$NESTED_LOCK_DIR" ] ||
  fail "ucode should remove cold-start runtime dir lock"

mkdir -p "$LOCK_DIR"
printf '%s\n' 999999 >"$LOCK_DIR/pid"
state_ucode acquire-runtime-dir-lock "$LOCK_DIR" "$$" ||
  fail "ucode should replace a stale runtime dir lock"
assert_eq "$$" "$(cat "$LOCK_DIR/pid")" "stale runtime lock owner pid"
state_ucode release-runtime-dir-lock "$LOCK_DIR" "$$"

SNAPSHOT_FILE="$WORK_DIR/reload-state.snapshot"
TARGET_RELOAD_STATE="$WORK_DIR/reload-state.target"
printf 'format=1\nservice_trigger_signature=abc\n' >"$SNAPSHOT_FILE"
state_ucode write-captured-reload-state "$TARGET_RELOAD_STATE" "$SNAPSHOT_FILE" 1 1 1
assert_eq "format=1
service_trigger_signature=abc" "$(cat "$TARGET_RELOAD_STATE")" "captured reload state copy"
[ ! -e "$SNAPSHOT_FILE" ] ||
  fail "ucode should clear captured reload snapshot after final write"

printf 'format=1\n' >"$SNAPSHOT_FILE"
printf 'old=1\n' >"$TARGET_RELOAD_STATE"
printf 'stale=1\n' >"$TARGET_RELOAD_STATE.snapshot.100.200"
printf 'stale=1\n' >"$TARGET_RELOAD_STATE.snapshot.interrupted"
printf 'keep=1\n' >"$WORK_DIR/unrelated.snapshot.100.200"
state_ucode clear-reload-state "$TARGET_RELOAD_STATE" "$SNAPSHOT_FILE"
[ ! -e "$TARGET_RELOAD_STATE" ] ||
  fail "ucode should clear reload state file"
[ ! -e "$SNAPSHOT_FILE" ] ||
  fail "ucode should clear reload state snapshot file"
[ ! -e "$TARGET_RELOAD_STATE.snapshot.100.200" ] &&
  [ ! -e "$TARGET_RELOAD_STATE.snapshot.interrupted" ] ||
  fail "ucode should clear stale snapshots owned by the reload state file"
[ -e "$WORK_DIR/unrelated.snapshot.100.200" ] ||
  fail "ucode should preserve unrelated snapshot files"

cat >"$WORK_DIR/service-dns-state.json" <<'JSON'
{
  "settings": {
    "enable_badwan_interface_monitoring": "1",
    "badwan_monitored_interfaces": [ "wan", "wwan" ],
    "badwan_reload_delay": "3500"
  },
  "dhcp_dnsmasq": {
    "port": "5353",
    "domain": "home"
  }
}
JSON

cat >"$WORK_DIR/service-trigger.expected" <<'EOF_SERVICE_TRIGGER'
[settings.enable_badwan_interface_monitoring]
1
[settings.badwan_monitored_interfaces]
wan wwan
[settings.badwan_reload_delay]
3500
EOF_SERVICE_TRIGGER

assert_eq "$(md5_file "$WORK_DIR/service-trigger.expected")" \
  "$(state_ucode service-trigger-signature-fixture "$WORK_DIR/service-dns-state.json")" \
  "service trigger signature hash"

# The DHCP domain stays on the local resolver in the generated config, so the
# sing-box signature must move when it is renamed.
sing_box_body="$(state_ucode sing-box-signature-body-fixture "$WORK_DIR/service-dns-state.json")"
for expected_field in \
  '[dhcp.@dnsmasq[0].domain]
home' \
  '[settings.unmatched_dns_mode]'; do
  case "$sing_box_body" in
    *"$expected_field"* ) ;;
    *) fail "sing-box signature must carry $expected_field" ;;
  esac
done

cat >"$WORK_DIR/service-trigger-disabled.json" <<'JSON'
{
  "settings": {
    "enable_badwan_interface_monitoring": "0",
    "badwan_monitored_interfaces": [ "wan" ],
    "badwan_reload_delay": "3500"
  }
}
JSON

cat >"$WORK_DIR/service-trigger-disabled.expected" <<'EOF_SERVICE_TRIGGER_DISABLED'
[settings.enable_badwan_interface_monitoring]
0
EOF_SERVICE_TRIGGER_DISABLED

assert_eq "$(md5_file "$WORK_DIR/service-trigger-disabled.expected")" \
  "$(state_ucode service-trigger-signature-fixture "$WORK_DIR/service-trigger-disabled.json")" \
  "disabled service trigger signature hash"

cat >"$WORK_DIR/service-trigger-default-delay.json" <<'JSON'
{
  "settings": {
    "enable_badwan_interface_monitoring": "1",
    "badwan_monitored_interfaces": [ "wan" ]
  }
}
JSON

cat >"$WORK_DIR/service-trigger-default-delay.expected" <<'EOF_SERVICE_TRIGGER_DEFAULT_DELAY'
[settings.enable_badwan_interface_monitoring]
1
[settings.badwan_monitored_interfaces]
wan
[settings.badwan_reload_delay]
2000
EOF_SERVICE_TRIGGER_DEFAULT_DELAY

assert_eq "$(md5_file "$WORK_DIR/service-trigger-default-delay.expected")" \
  "$(state_ucode service-trigger-signature-fixture "$WORK_DIR/service-trigger-default-delay.json")" \
  "default badwan reload delay signature hash"

cat >"$WORK_DIR/sing-box-signature.json" <<'JSON'
{
  "settings": {
    "dns_strategy": "prefer_ipv6",
    "dns_server": "tcp://9.9.9.9",
    "bootstrap_dns_server": "1.0.0.1",
    "dns_main_fallback_strategy": "sequential",
    "dns_bootstrap_fallback_strategy": "parallel",
    "dns_rewrite_ttl": "120",
    "output_network_interface": "wan",
    "disable_quic": "on",
    "bittorrent_direct": "1",
    "unified_delay": "yes",
    "static_hosts_text": "10.0.0.9 pinned.example",
    "list_update_enabled": "1",
    "update_interval": "2h",
    "cache_path": "/tmp/cache.db",
    "config_path": "/etc/sing-box/custom.json",
    "log_level": "debug",
    "service_listen_address": "127.0.0.1",
    "enable_yacd": "yes",
    "enable_yacd_wan_access": "1",
    "yacd_secret_key": "secret",
    "download_lists_via_proxy": "0",
    "download_subscriptions_via_proxy": "on",
    "download_components_via_proxy": "0",
    "download_lists_via_proxy_section": "proxy1"
  },
  "runtime": {
    "mwan3_active": "1"
  },
  "section": [
    {
      ".name": "disabled_proxy",
      ".type": "section",
      "enabled": "0",
      "action": "proxy",
      "selector_proxy_links": [ "ignored" ]
    },
    {
      ".name": "proxy1",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "selector_proxy_links": [ "vless://one", "vless://two" ],
      "subscription_urls": [ "https://example.com/sub.txt" ],
      "subscription_url_settings": "{\"https://example.com/sub.txt\":{\"show_subscription_name\":\"1\",\"tag\":\"Example\"}}",
      "urltest_enabled": "1",
      "urltest_tolerance": "75",
      "urltest_server_filter_mode": "include",
      "urltest_exclude_regex": "🇷🇺",
      "urltest_include_outbounds": [ "node-a" ],
      "subscription_update_enabled": "1",
      "outbound_detour_enabled": "1",
      "outbound_detour_section": "out1",
      "domain": [ "legacy.example" ],
      "domain_suffix": [ "full:full.example", "suffix.example" ],
      "domain_keyword": [ "ads" ],
      "domain_regex": [ "^foo" ],
      "ip_cidr": [ "203.0.113.1", "bad" ],
      "source_ip_cidr": [ "198.51.100.0/24" ],
      "ports": [ "443" ],
      "ports_text": "80,443-444",
      "fully_routed_ips": [ "198.51.100.2" ],
      "community_lists": [ "telegram" ],
      "rule_set": [ "https://example.com/remote.srs" ],
      "rule_set_with_subnets": [ "local.srs", "local.lst" ]
    },
    {
      ".name": "out1",
      ".type": "section",
      "enabled": "1",
      "action": "outbound",
      "outbound_json": "{\"type\":\"direct\"}",
      "outbound_detour_enabled": "0"
    },
    {
      ".name": "bye1",
      ".type": "section",
      "enabled": "1",
      "action": "byedpi"
    },
    {
      ".name": "vpn1",
      ".type": "section",
      "enabled": "1",
      "action": "vpn",
      "interface": "wg0"
    }
  ],
  "section_interface": [
    {
      ".name": "vpn-interface",
      ".type": "section_interface",
      "section": "vpn1",
      "name": "wg0",
      "domain_resolver_enabled": "1",
      "domain_resolver_dns_server": [ "https://dns.example/dns-query", "tls://1.1.1.1" ],
      "domain_resolver_dns_fallback_strategy": "sequential",
      "domain_resolver_dns_detour_enabled": "1",
      "domain_resolver_dns_detour_section": "proxy1"
    }
  ],
  "server": [
    {
      ".name": "srv_disabled",
      ".type": "server",
      "enabled": "0",
      "label": "ignored"
    },
    {
      ".name": "srv1",
      ".type": "server",
      "enabled": "1",
      "listen_port": "8443",
      "tls_server_name": "example.com",
      "transport": "ws",
      "transport_path": "/ws",
      "tailscale_accept_routes": "1"
    }
  ],
  "server_client": [
    {
      ".name": "srv1_phone",
      ".type": "server_client",
      "server": "srv1",
      "enabled": "1",
      "name": "phone",
      "uuid": "11111111-1111-4111-8111-111111111111",
      "flow": "xtls-rprx-vision"
    },
    {
      ".name": "srv1_laptop",
      ".type": "server_client",
      "server": "srv1",
      "enabled": "0",
      "name": "laptop",
      "uuid": "22222222-2222-4222-8222-222222222222"
    }
  ]
}
JSON

cat >"$WORK_DIR/sing-box-signature.expected" <<'EOF_SING_BOX_SIG'
[settings.dns_strategy]
prefer_ipv6
[settings.unmatched_dns_mode]
router
[dhcp.@dnsmasq[0].domain]

[settings.dns_server]
tcp://9.9.9.9
[settings.bootstrap_dns_server]
1.0.0.1
[settings.dns_main_fallback_strategy]
sequential
[settings.dns_bootstrap_fallback_strategy]
parallel
[settings.dns_detour_enabled]
0
[settings.dns_rewrite_ttl]
120
[settings.output_network_interface]
wan
[settings.disable_quic]
1
[settings.bittorrent_direct]
1
[settings.unified_delay]
1
[settings.static_hosts_text]
10.0.0.9 pinned.example
[settings.update_interval]
2h
[settings.cache_path]
/tmp/cache.db
[settings.config_path]
/etc/sing-box/custom.json
[settings.log_level]
debug
[settings.service_listen_address]
127.0.0.1
[runtime.mwan3_active]
1
[settings.enable_yacd]
1
[settings.enable_yacd_wan_access]
1
[settings.yacd_secret_key]
secret
[settings.download_lists_via_proxy]
0
[settings.download_components_via_proxy]
0
[rule.proxy1.action]
proxy
[rule.proxy1.label]
proxy1
[rule.proxy1.connection_urls]
[ "vless://one", "vless://two" ]
[rule.proxy1.subscription_urls]
[ { "url": "https://example.com/sub.txt", "subscription_update_enabled": "1", "subscription_update_interval": "1h", "download_via_proxy_section": "", "header": [ ], "show_dashboard_metadata": "1", "show_subscription_name": "1", "tag": "Example", "server_filter_mode": "all", "include_outbounds": [ ], "include_regex": "", "exclude_outbounds": [ ], "exclude_regex": "", "exclude_types": [ ], "override": { "prefix": "", "suffix": "", "rename": [ ], "patch": "" } } ]
[rule.proxy1.interfaces]
[ ]
[rule.proxy1.outbound_jsons]

[rule.proxy1.tunnels]
[ ]
[rule.proxy1.legacy_interface]

[rule.proxy1.legacy_outbound_json]

[rule.proxy1.urltests]
[ { "id": "urltest", "display_name": "Fastest", "check_interval": "3m", "tolerance": "75", "testing_url": "https://www.gstatic.com/generate_204", "expected_status": "*", "idle_timeout": "", "interrupt_exist_connections": "0", "hide_dashboard_members": "0", "server_filter_mode": "include", "include_outbounds": [ "node-a" ], "include_regex": "", "exclude_outbounds": [ ], "exclude_regex": "🇷🇺", "exclude_types": [ ] } ]
[rule.proxy1.fallback_groups]
[ ]
[rule.proxy1.urltest_enabled]
1
[rule.proxy1.urltest_check_interval]
3m
[rule.proxy1.urltest_tolerance]
75
[rule.proxy1.urltest_testing_url]
https://www.gstatic.com/generate_204
[rule.proxy1.urltest_expected_status]
*
[rule.proxy1.urltest_filter_mode]
disabled
[rule.proxy1.urltest_exclude_outbounds]

[rule.proxy1.urltest_exclude_regex]
🇷🇺
[rule.proxy1.urltest_include_outbounds]
node-a
[rule.proxy1.urltest_include_regex]

[rule.proxy1.subscription_update_interval]
1h
[rule.proxy1.outbound_detour_enabled]
1
[rule.proxy1.outbound_detour_section]
out1
[rule.proxy1.domain]
full.example,legacy.example
[rule.proxy1.domain_suffix]
suffix.example
[rule.proxy1.domain_keyword]
ads
[rule.proxy1.domain_regex]
^foo
[rule.proxy1.ip_cidr]
203.0.113.1
[rule.proxy1.source_ip_cidr]
198.51.100.0/24
[rule.proxy1.ports]
443,80,443-444
[rule.proxy1.fully_routed_ips]
198.51.100.2
[rule.proxy1.community_lists]
telegram
[rule.proxy1.rule_set]
https://example.com/remote.srs
[rule.proxy1.rule_set_with_subnets]
local.srs local.lst
[rule.out1.action]
outbound
[rule.out1.label]
out1
[rule.out1.connection_urls]
[ ]
[rule.out1.subscription_urls]
[ ]
[rule.out1.interfaces]
[ ]
[rule.out1.outbound_jsons]

[rule.out1.tunnels]
[ ]
[rule.out1.legacy_interface]

[rule.out1.legacy_outbound_json]
{"type":"direct"}
[rule.out1.urltests]
[ ]
[rule.out1.fallback_groups]
[ ]
[rule.out1.urltest_enabled]
0
[rule.out1.urltest_check_interval]

[rule.out1.urltest_tolerance]
50
[rule.out1.urltest_testing_url]
https://www.gstatic.com/generate_204
[rule.out1.urltest_expected_status]
*
[rule.out1.urltest_filter_mode]
disabled
[rule.out1.urltest_exclude_outbounds]

[rule.out1.urltest_exclude_regex]

[rule.out1.urltest_include_outbounds]

[rule.out1.urltest_include_regex]

[rule.out1.subscription_update_interval]

[rule.out1.outbound_detour_enabled]
0
[rule.out1.domain]

[rule.out1.domain_suffix]

[rule.out1.domain_keyword]

[rule.out1.domain_regex]

[rule.out1.ip_cidr]

[rule.out1.source_ip_cidr]

[rule.out1.ports]

[rule.out1.fully_routed_ips]

[rule.out1.community_lists]

[rule.out1.rule_set]

[rule.out1.rule_set_with_subnets]

[rule.bye1.action]
byedpi
[rule.bye1.label]
bye1
[rule.bye1.byedpi_index]
1
[rule.bye1.domain]

[rule.bye1.domain_suffix]

[rule.bye1.domain_keyword]

[rule.bye1.domain_regex]

[rule.bye1.ip_cidr]

[rule.bye1.source_ip_cidr]

[rule.bye1.ports]

[rule.bye1.fully_routed_ips]

[rule.bye1.community_lists]

[rule.bye1.rule_set]

[rule.bye1.rule_set_with_subnets]

[rule.vpn1.action]
vpn
[rule.vpn1.label]
vpn1
[rule.vpn1.connection_urls]
[ ]
[rule.vpn1.subscription_urls]
[ ]
[rule.vpn1.interfaces]
[ { "name": "wg0", "domain_resolver_enabled": "1", "domain_resolver_dns_server": [ "https://dns.example/dns-query", "tls://1.1.1.1" ], "domain_resolver_dns_fallback_strategy": "sequential", "domain_resolver_dns_detour_enabled": "1", "domain_resolver_dns_detour_section": "proxy1" } ]
[rule.vpn1.outbound_jsons]

[rule.vpn1.tunnels]
[ ]
[rule.vpn1.legacy_interface]
wg0
[rule.vpn1.legacy_outbound_json]

[rule.vpn1.urltests]
[ ]
[rule.vpn1.fallback_groups]
[ ]
[rule.vpn1.urltest_enabled]
0
[rule.vpn1.urltest_check_interval]

[rule.vpn1.urltest_tolerance]
50
[rule.vpn1.urltest_testing_url]
https://www.gstatic.com/generate_204
[rule.vpn1.urltest_expected_status]
*
[rule.vpn1.urltest_filter_mode]
disabled
[rule.vpn1.urltest_exclude_outbounds]

[rule.vpn1.urltest_exclude_regex]

[rule.vpn1.urltest_include_outbounds]

[rule.vpn1.urltest_include_regex]

[rule.vpn1.subscription_update_interval]

[rule.vpn1.outbound_detour_enabled]
0
[rule.vpn1.domain]

[rule.vpn1.domain_suffix]

[rule.vpn1.domain_keyword]

[rule.vpn1.domain_regex]

[rule.vpn1.ip_cidr]

[rule.vpn1.source_ip_cidr]

[rule.vpn1.ports]

[rule.vpn1.fully_routed_ips]

[rule.vpn1.community_lists]

[rule.vpn1.rule_set]

[rule.vpn1.rule_set_with_subnets]

[server.srv_disabled.enabled]
0
[server.srv1.enabled]
1
[server.srv1.label]
srv1
[server.srv1.protocol]
vless
[server.srv1.listen]
0.0.0.0
[server.srv1.listen_port]
8443
[server.srv1.inbound_json]

[server.srv1.routing_mode]
rules
[server.srv1.routing_section]

[server.srv1.security]
reality
[server.srv1.tls_server_name]
example.com
[server.srv1.tls_alpn]

[server.srv1.tls_certificate_path]

[server.srv1.tls_key_path]

[server.srv1.reality_private_key]

[server.srv1.reality_short_id]

[server.srv1.transport]
ws
[server.srv1.transport_path]
/ws
[server.srv1.transport_host]

[server.srv1.transport_service_name]

[server.srv1.transport_hosts]

[server.srv1.transport_xhttp_mode]

[server.srv1.tcp_fast_open]

[server.srv1.shadowsocks_method]

[server.srv1.shadowsocks_psk]

[server.srv1.multiplex_enabled]

[server.srv1.multiplex_padding]

[server.srv1.hysteria2_up_mbps]

[server.srv1.hysteria2_down_mbps]

[server.srv1.hysteria2_obfs_type]

[server.srv1.hysteria2_obfs_password]

[server.srv1.hysteria2_ignore_client_bandwidth]

[server.srv1.hysteria2_masquerade]

[server.srv1.naive_network]
tcp
[server.srv1.ssh_host_key_path]

[server.srv1.mieru_transport]
TCP
[server.srv1.tuic_congestion_control]
cubic
[server.srv1.tuic_heartbeat]
10s
[server.srv1.tuic_zero_rtt_handshake]
0
[server.srv1.mtproto_faketls]

[server.srv1.tailscale_auth_key]

[server.srv1.tailscale_detour_enabled]

[server.srv1.tailscale_detour_section]

[server.srv1.tailscale_control_url]

[server.srv1.tailscale_hostname]

[server.srv1.tailscale_accept_routes]
1
[server.srv1.tailscale_advertise_routes]

[server.srv1.tailscale_ephemeral]

[server.srv1.client.srv1_phone.name]
phone
[server.srv1.client.srv1_phone.uuid]
11111111-1111-4111-8111-111111111111
[server.srv1.client.srv1_phone.password]

[server.srv1.client.srv1_phone.secret]

[server.srv1.client.srv1_phone.flow]
xtls-rprx-vision
[server.srv1.client.srv1_phone.routing_override]

[server.srv1.client.srv1_phone.routing_mode]

[server.srv1.client.srv1_phone.routing_section]

[server.srv1.client.srv1_laptop.name]
laptop
[server.srv1.client.srv1_laptop.uuid]
22222222-2222-4222-8222-222222222222
[server.srv1.client.srv1_laptop.password]

[server.srv1.client.srv1_laptop.secret]

[server.srv1.client.srv1_laptop.flow]

[server.srv1.client.srv1_laptop.routing_override]

[server.srv1.client.srv1_laptop.routing_mode]

[server.srv1.client.srv1_laptop.routing_section]

EOF_SING_BOX_SIG

assert_eq "$(md5_file "$WORK_DIR/sing-box-signature.expected")" \
  "$(state_ucode sing-box-signature-fixture "$WORK_DIR/sing-box-signature.json")" \
  "sing-box signature hash"

# The display name prefixes every tag a section generates, so renaming one has
# to be seen as a runtime change instead of being skipped as "unchanged".
node -e 'const fs = require("fs");
const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
config.section = config.section.map((item) =>
  item[".name"] === "proxy1" ? { ...item, label: "proxy 1" } : item);
fs.writeFileSync(process.argv[2], JSON.stringify(config));' \
  "$WORK_DIR/sing-box-signature.json" "$WORK_DIR/sing-box-signature-renamed.json"
if [ "$(state_ucode sing-box-signature-fixture "$WORK_DIR/sing-box-signature-renamed.json")" = \
     "$(state_ucode sing-box-signature-fixture "$WORK_DIR/sing-box-signature.json")" ]; then
  fail "renaming a section must change the sing-box signature"
fi
renamed_body="$(state_ucode sing-box-signature-body-fixture "$WORK_DIR/sing-box-signature-renamed.json")"
grep -Fq 'proxy 1' <<<"$renamed_body" ||
  fail "the section display name is missing from the sing-box signature"

cat >"$WORK_DIR/dpi-signatures.json" <<'JSON'
{
  "section": [
    {
      ".name": "disabled_zap",
      ".type": "section",
      "enabled": "0",
      "action": "zapret",
      "nfqws_opt": "--disabled"
    },
    {
      ".name": "zap1",
      ".type": "section",
      "enabled": "1",
      "action": "zapret",
      "domain": [ "legacy.example" ],
      "domain_suffix": [ "full:full.example", "suffix.example", "keyword:ads" ],
      "domain_suffix_text": "full:textfull.example text-suffix.example",
      "community_lists": [ "telegram", "youtube" ],
      "rule_set": [ "https://example.com/zap.srs" ],
      "rule_set_with_subnets": [ "https://example.com/zap-sub.srs", "local.lst", "https://example.com/ip.lst" ],
      "user_domain_list_type": "dynamic",
      "user_domains": [ "dyn.example" ],
      "user_domains_text": "ignored.example"
    },
    {
      ".name": "zap2",
      ".type": "section",
      "enabled": "1",
      "action": "zapret2",
      "nfqws2_opt": "--z2\n opt",
      "domain": [ "z2.example" ],
      "domain_suffix": [ "z2-suffix.example" ],
      "community_lists": [ "discord" ],
      "rule_set": [ "https://example.com/zap2.srs" ],
      "rule_set_with_subnets": [ "https://example.com/zap2-sub.srs", "https://example.com/zap2-ip.lst" ],
      "user_domain_list_type": "text",
      "user_domains": [ "ignored-dyn.example" ],
      "user_domains_text": "text.example text2.example"
    },
    {
      ".name": "bye_disabled",
      ".type": "section",
      "enabled": "0",
      "action": "byedpi",
      "byedpi_cmd_opts": "--disabled"
    },
    {
      ".name": "bye1",
      ".type": "section",
      "enabled": "1",
      "action": "byedpi"
    },
    {
      ".name": "bye2",
      ".type": "section",
      "enabled": "1",
      "action": "byedpi",
      "byedpi_cmd_opts": "--disorder   3\n--fake-sni example.org"
    }
  ]
}
JSON

cat >"$WORK_DIR/zapret-queue.expected" <<'EOF_ZAPRET_QUEUE'
[zapret_queue.section]
zap1
EOF_ZAPRET_QUEUE

cat >"$WORK_DIR/zapret2-queue.expected" <<'EOF_ZAPRET2_QUEUE'
[zapret2_queue.section]
zap2
EOF_ZAPRET2_QUEUE

cat >"$WORK_DIR/zapret-runtime.expected" <<'EOF_ZAPRET_RUNTIME'
[zapret.zap1.nfqws_opt]
--default-zapret
[zapret.zap1.domain]
textfull.example,full.example,legacy.example
[zapret.zap1.domain_suffix]
text-suffix.example,suffix.example
[zapret.zap1.community_lists]
telegram youtube
[zapret.zap1.rule_set]
https://example.com/zap.srs
[zapret.zap1.rule_set_with_subnets]
https://example.com/zap-sub.srs local.lst https://example.com/ip.lst
[zapret.zap1.user_domain_list_type]
dynamic
[zapret.zap1.user_domains]
dyn.example
EOF_ZAPRET_RUNTIME

cat >"$WORK_DIR/zapret2-runtime.expected" <<'EOF_ZAPRET2_RUNTIME'
[zapret2.zap2.nfqws2_opt]
--z2 opt
[zapret2.zap2.domain]
z2.example
[zapret2.zap2.domain_suffix]
z2-suffix.example
[zapret2.zap2.community_lists]
discord
[zapret2.zap2.rule_set]
https://example.com/zap2.srs
[zapret2.zap2.rule_set_with_subnets]
https://example.com/zap2-sub.srs https://example.com/zap2-ip.lst
[zapret2.zap2.user_domain_list_type]
text
[zapret2.zap2.user_domains]
text.example text2.example
EOF_ZAPRET2_RUNTIME

cat >"$WORK_DIR/byedpi-runtime.expected" <<'EOF_BYEDPI_RUNTIME'
[byedpi.bye1.index]
1
[byedpi.bye1.byedpi_cmd_opts]
--default-bye
[byedpi.bye2.index]
2
[byedpi.bye2.byedpi_cmd_opts]
--disorder 3 --fake-sni example.org
EOF_BYEDPI_RUNTIME

assert_eq "$(md5_file "$WORK_DIR/zapret-queue.expected")" \
  "$(state_ucode zapret-queue-signature-fixture "$WORK_DIR/dpi-signatures.json")" \
  "zapret queue signature hash"
assert_eq "$(md5_file "$WORK_DIR/zapret2-queue.expected")" \
  "$(state_ucode zapret2-queue-signature-fixture "$WORK_DIR/dpi-signatures.json")" \
  "zapret2 queue signature hash"
assert_eq "$(md5_file "$WORK_DIR/zapret-runtime.expected")" \
  "$(state_ucode zapret-runtime-signature-fixture "$WORK_DIR/dpi-signatures.json")" \
  "zapret runtime signature hash"
assert_eq "$(md5_file "$WORK_DIR/zapret2-runtime.expected")" \
  "$(state_ucode zapret2-runtime-signature-fixture "$WORK_DIR/dpi-signatures.json")" \
  "zapret2 runtime signature hash"
assert_eq "$(md5_file "$WORK_DIR/byedpi-runtime.expected")" \
  "$(state_ucode byedpi-runtime-signature-fixture "$WORK_DIR/dpi-signatures.json")" \
  "byedpi runtime signature hash"

cat >"$WORK_DIR/reload-state-signatures.json" <<'JSON'
{
  "settings": {
    "list_update_enabled": "1",
    "update_interval": "6h",
    "component_update_check_enabled": "1",
    "component_update_check_interval": "2h"
  },
  "section": [
    {
      ".name": "disabled",
      ".type": "section",
      "enabled": "0",
      "action": "proxy",
      "ports": [ "1" ],
      "community_lists": [ "telegram" ],
      "rule_set_with_subnets": [ "https://example.com/disabled-subnets.srs", "https://example.com/disabled-mixed.lst" ],
      "subscription_urls": [ "https://example.com/disabled-sub.txt" ],
      "urltest_enabled": "1"
    },
    {
      ".name": "list_proxy",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "ports": [ "443", "bad" ],
      "ports_text": "80,443-444 # comment\nbad-port",
      "community_lists": [ "geoblock", "meta", "telegram", "youtube", "discord" ],
      "rule_set_with_subnets": [ "https://example.com/subnets.srs", "local.lst", "https://example.com/mixed.lst" ],
      "subscription_urls": [ "https://example.com/sub1.txt", "https://example.com/sub2.txt" ],
      "urltest_enabled": "1"
    },
    {
      ".name": "sub_paused",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "subscription_urls": [ "https://example.com/off.txt" ],
      "subscription_update_enabled": "0"
    },
    {
      ".name": "implicit_action",
      ".type": "section",
      "enabled": "1",
      "subscription_urls": [ "https://example.com/implicit.txt" ],
      "urltest_enabled": "1"
    },
    {
      ".name": "urltest_custom",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "urltest_enabled": "1",
      "urltest_check_interval": "7m"
    },
    {
      ".name": "dns_only",
      ".type": "section",
      "enabled": "1",
      "action": "dns",
      "ports": [ "5353" ],
      "community_lists": [ "telegram" ],
      "rule_set": [ "https://example.com/dns-domains.lst" ],
      "rule_set_with_subnets": [ "https://example.com/ignored-subnets.srs" ]
    }
  ]
}
JSON

cat >"$WORK_DIR/cron-signature.expected" <<'EOF_CRON_SIG'
[settings.component_update_check_interval]
2h
EOF_CRON_SIG

assert_eq "$(md5_file "$WORK_DIR/cron-signature.expected")" \
  "$(state_ucode cron-signature-fixture "$WORK_DIR/reload-state-signatures.json")" \
  "component cron signature hash"
# One owner: the nft signature is a hash of the ruleset nft/apply.uc would build,
# and the reload state carries that value rather than a second opinion about which
# fields the table depends on. The two lists used to be kept in step by hand, and
# both were wrong in the same way.
nft_signature="$(nft_ucode nft-runtime-signature-fixture "$WORK_DIR/reload-state-signatures.json")"
[ -n "$nft_signature" ] || fail "nft/apply.uc must produce a signature for the fixture"
if grep -q 'nft_runtime_signature_body' "$STATE_UC"; then
  fail "service/state.uc must not keep its own list of nft-relevant fields"
fi
assert_eq "6h" \
  "$(state_ucode settings-update-interval-fixture "$WORK_DIR/reload-state-signatures.json")" \
  "settings update interval"
assert_eq "1h" \
  "$(state_ucode subscription-update-interval-fixture "$WORK_DIR/reload-state-signatures.json" list_proxy)" \
  "default subscription update interval"
assert_eq "" \
  "$(state_ucode subscription-update-interval-fixture "$WORK_DIR/reload-state-signatures.json" sub_paused)" \
  "disabled subscription update interval"
assert_eq "3m" \
  "$(state_ucode urltest-check-interval-fixture "$WORK_DIR/reload-state-signatures.json" list_proxy)" \
  "default urltest check interval"
assert_eq "7m" \
  "$(state_ucode urltest-check-interval-fixture "$WORK_DIR/reload-state-signatures.json" urltest_custom)" \
  "custom urltest check interval"
cat >"$WORK_DIR/dns-action-signature-udp.json" <<'JSON'
{
  "section": [
    { ".name": "dns", ".type": "section", "enabled": "1", "action": "dns", "dns_server": [ "9.9.9.9" ], "domain_suffix": [ "example.org" ] }
  ]
}
JSON
cat >"$WORK_DIR/dns-action-signature-dot.json" <<'JSON'
{
  "section": [
    { ".name": "dns", ".type": "section", "enabled": "1", "action": "dns", "dns_server": [ "tls://9.9.9.9" ], "domain_suffix": [ "example.org" ] }
  ]
}
JSON
cat >"$WORK_DIR/dns-action-signature-device.json" <<'JSON'
{
  "section": [
    { ".name": "dns", ".type": "section", "enabled": "1", "action": "dns", "dns_server": [ "9.9.9.9" ], "domain_suffix": [ "example.org" ], "source_ip_cidr": [ "@system" ] }
  ]
}
JSON
cat >"$WORK_DIR/dns-action-signature-sequential.json" <<'JSON'
{
  "section": [
    { ".name": "dns", ".type": "section", "enabled": "1", "action": "dns", "dns_server": [ "9.9.9.9", "1.1.1.1" ], "dns_fallback_strategy": "sequential", "domain_suffix": [ "example.org" ] }
  ]
}
JSON
if [ "$(state_ucode sing-box-signature-fixture "$WORK_DIR/dns-action-signature-udp.json")" = \
  "$(state_ucode sing-box-signature-fixture "$WORK_DIR/dns-action-signature-dot.json")" ]; then
  fail "DNS action server URI should change the sing-box signature"
fi
if [ "$(state_ucode sing-box-signature-fixture "$WORK_DIR/dns-action-signature-udp.json")" = \
  "$(state_ucode sing-box-signature-fixture "$WORK_DIR/dns-action-signature-device.json")" ]; then
  fail "DNS action devices should change the sing-box signature"
fi
if [ "$(state_ucode sing-box-signature-fixture "$WORK_DIR/dns-action-signature-udp.json")" = \
  "$(state_ucode sing-box-signature-fixture "$WORK_DIR/dns-action-signature-sequential.json")" ]; then
  fail "DNS action query mode should change the sing-box signature"
fi
if [ "$(nft_ucode nft-runtime-signature-fixture "$WORK_DIR/dns-action-signature-udp.json")" = \
  "$(nft_ucode nft-runtime-signature-fixture "$WORK_DIR/dns-action-signature-device.json")" ]; then
  fail "DNS action devices should change the nft signature"
fi

cat >"$WORK_DIR/reload-state.expected" <<EOF_RELOAD_STATE
format=2
service_trigger_signature=$(state_ucode service-trigger-signature-fixture "$WORK_DIR/reload-state-signatures.json")
sing_box_signature=$(state_ucode sing-box-signature-fixture "$WORK_DIR/reload-state-signatures.json")
nft_signature=$nft_signature
zapret_queue_signature=$(state_ucode zapret-queue-signature-fixture "$WORK_DIR/reload-state-signatures.json")
zapret_runtime_signature=$(state_ucode zapret-runtime-signature-fixture "$WORK_DIR/reload-state-signatures.json")
zapret2_queue_signature=$(state_ucode zapret2-queue-signature-fixture "$WORK_DIR/reload-state-signatures.json")
zapret2_runtime_signature=$(state_ucode zapret2-runtime-signature-fixture "$WORK_DIR/reload-state-signatures.json")
byedpi_runtime_signature=$(state_ucode byedpi-runtime-signature-fixture "$WORK_DIR/reload-state-signatures.json")
cron_signature=$(state_ucode cron-signature-fixture "$WORK_DIR/reload-state-signatures.json")
EOF_RELOAD_STATE

assert_eq "$(cat "$WORK_DIR/reload-state.expected")" \
  "$(state_ucode reload-state-text-fixture "$WORK_DIR/reload-state-signatures.json" 2)" \
  "reload state aggregate text"

cat >"$WORK_DIR/disabled-update-interval.json" <<'JSON'
{
  "settings": {
    "list_update_enabled": "0",
    "update_interval": "6h"
  }
}
JSON

assert_eq "" \
  "$(state_ucode settings-update-interval-fixture "$WORK_DIR/disabled-update-interval.json")" \
  "disabled settings update interval"

cat >"$WORK_DIR/empty-update-interval.json" <<'JSON'
{
  "settings": {
    "list_update_enabled": "1",
    "update_interval": ""
  }
}
JSON

assert_eq "1d" \
  "$(state_ucode settings-update-interval-fixture "$WORK_DIR/empty-update-interval.json")" \
  "empty settings update interval default"

printf 'runtime state predicate checks passed\n'
