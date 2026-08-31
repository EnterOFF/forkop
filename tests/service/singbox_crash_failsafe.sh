#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
WATCH="$FORKOP_LIB/service/singbox_watch.uc"
LIFECYCLE="$FORKOP_LIB/service/lifecycle.uc"
FOREIGN_PID=""
cleanup() {
  [ -z "$FOREIGN_PID" ] || kill "$FOREIGN_PID" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

cat >"$WORK_DIR/sing-box-fail.json" <<'EOF_FAIL'
{"type":"instance.fail","data":{"service":"sing-box","instance":"instance1","pid":15047,"exit_code":137,"respawn_count":6}}
EOF_FAIL
cat >"$WORK_DIR/sing-box-fail-next.json" <<'EOF_FAIL_NEXT'
{"type":"instance.fail","data":{"service":"sing-box","instance":"instance1","pid":16048,"exit_code":137,"respawn_count":6}}
EOF_FAIL_NEXT
cat >"$WORK_DIR/other-service-fail.json" <<'EOF_OTHER'
{"type":"instance.fail","data":{"service":"dnsmasq","instance":"instance1","exit_code":1}}
EOF_OTHER
cat >"$WORK_DIR/sing-box-respawn.json" <<'EOF_RESPAWN'
{"type":"instance.respawn","data":{"service":"sing-box","instance":"instance1","exit_code":137}}
EOF_RESPAWN

ucode -L "$FORKOP_LIB" "$WATCH" failure-event-fixture "$WORK_DIR/sing-box-fail.json" ||
  fail "sing-box instance.fail must trigger fail-safe cleanup"
if ucode -L "$FORKOP_LIB" "$WATCH" failure-event-fixture "$WORK_DIR/other-service-fail.json"; then
  fail "another service failure must not trigger Forkop cleanup"
fi
if ucode -L "$FORKOP_LIB" "$WATCH" failure-event-fixture "$WORK_DIR/sing-box-respawn.json"; then
  fail "ordinary sing-box respawn must not trigger cleanup"
fi
[ "$(ucode -L "$FORKOP_LIB" "$WATCH" event-key-fixture "$WORK_DIR/sing-box-fail.json")" != \
  "$(ucode -L "$FORKOP_LIB" "$WATCH" event-key-fixture "$WORK_DIR/sing-box-fail-next.json")" ] ||
  fail "separate sing-box crash loops must not be deduplicated"
if grep -Fq '1000>&- &' "$WATCH"; then
  fail "sing-box crash cleanup must not be an unsupervised background process"
fi
grep -Fq 'uloop.end();' "$WATCH" ||
  fail "failed sing-box crash cleanup must restart its procd-supervised watcher"
grep -Fq '!cleanup_runtime(pending_exit_code)' "$WATCH" ||
  fail "a respawned watcher must reconcile a crash cleanup missed by its previous process"
grep -Fq 'event_key == last_event_key' "$WATCH" ||
  fail "duplicate sing-box failure notifications must be deduplicated"
grep -Fq 'connection.subscriber(function(notification)' "$WATCH" ||
  fail "sing-box crash watcher must subscribe to procd service notifications"
grep -Fq 'subscriber.subscribe("service")' "$WATCH" ||
  fail "sing-box crash watcher must subscribe to the procd service object"
if grep -Fq 'connection.listener(' "$WATCH"; then
  fail "procd instance.fail is an object notification, not an event broadcast"
fi
grep -Fq 'log_message("sing-box stopped after repeated crashes" + suffix, "fatal")' \
  "$FORKOP_LIB/service/lifecycle.uc" ||
  fail "repeated sing-box crashes must be reported as a concise fatal error"

cat >"$WORK_DIR/cleanup-bin" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${FORKOP_TEST_CLEANUP_LOG:?}"
[ -z "${FORKOP_TEST_CLEANUP_FAIL:-}" ]
SH
chmod 0755 "$WORK_DIR/cleanup-bin"
: >"$WORK_DIR/cleanup.log"
if FORKOP_BIN="$WORK_DIR/cleanup-bin" \
  FORKOP_TEST_CLEANUP_LOG="$WORK_DIR/cleanup.log" \
  FORKOP_TEST_CLEANUP_FAIL=1 \
  ucode -L "$FORKOP_LIB" "$WATCH" cleanup-runtime-fixture 137; then
  fail "watcher cleanup command failure must be observable"
fi
FORKOP_BIN="$WORK_DIR/cleanup-bin" \
FORKOP_TEST_CLEANUP_LOG="$WORK_DIR/cleanup.log" \
  ucode -L "$FORKOP_LIB" "$WATCH" cleanup-runtime-fixture 137 ||
  fail "watcher cleanup command success must be observable"
grep -Fxq 'sing_box_crash_cleanup 137' "$WORK_DIR/cleanup.log" ||
  fail "watcher must invoke the complete Forkop crash cleanup"

mkdir -p "$WORK_DIR/watch-lib"
cat >"$WORK_DIR/watch-lib/ubus.uc" <<'EOF_UBUS'
let fs = require("fs");
let subscribed = false;
return { connect: function() {
  return {
    subscriber: function(callback, removed) {
      return { subscribe: function(name) { subscribed = name == "service"; return subscribed; } };
    },
    call: function(object, method, args) {
      assert(subscribed && object == "service" && method == "list" && args.name == "sing-box");
      return json(fs.readfile(getenv("FORKOP_TEST_SERVICE_STATE")));
    }
  };
} };
EOF_UBUS
cat >"$WORK_DIR/watch-lib/uloop.uc" <<'EOF_ULOOP'
return { init: function() {}, run: function() {}, end: function() {} };
EOF_ULOOP
for state in running respawning exhausted absent; do
  case "$state" in
    running) instance='{"running":true,"pid":123,"respawn":{"retry":5}}' ;;
    respawning) instance='{"running":false,"exit_code":137,"respawn":{"retry":5}}' ;;
    exhausted) instance='{"running":false,"exit_code":137}' ;;
    absent) instance='' ;;
  esac
  printf '{"sing-box":{"instances":{%s}}}\n' "${instance:+\"instance1\":$instance}" >"$WORK_DIR/service.json"
  : >"$WORK_DIR/cleanup.log"
  FORKOP_BIN="$WORK_DIR/cleanup-bin" \
  FORKOP_TEST_CLEANUP_LOG="$WORK_DIR/cleanup.log" \
  FORKOP_TEST_SERVICE_STATE="$WORK_DIR/service.json" \
  FORKOP_SING_BOX_WATCH_PID_FILE="$WORK_DIR/monitor.pid" \
  FORKOP_SING_BOX_PENDING_CLEANUP_FILE="$WORK_DIR/monitor.cleanup" \
    ucode -L "$FORKOP_LIB" -L "$WORK_DIR/watch-lib" "$WATCH" monitor ||
    fail "watcher startup must accept $state service state"
  if [ "$state" = exhausted ]; then
    grep -Fxq 'sing_box_crash_cleanup 137' "$WORK_DIR/cleanup.log" ||
      fail "a respawned watcher must clean a crash whose notification was lost"
  else
    [ ! -s "$WORK_DIR/cleanup.log" ] ||
      fail "watcher startup must preserve a $state service"
  fi
  rm -f "$WORK_DIR/monitor.cleanup"
done

mkdir -p "$WORK_DIR/network-bin"
cat >"$WORK_DIR/network-bin/nft" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${FORKOP_TEST_NFT_LOG:?}"
case "$*" in
  "-t list table inet CrashTable") [ -e "${FORKOP_TEST_NFT_TABLE_STATE:?}" ] ;;
  "delete table inet CrashTable")
    [ -z "${FORKOP_TEST_NFT_DELETE_FAIL:-}" ] || exit 1
    rm -f "${FORKOP_TEST_NFT_TABLE_STATE:?}"
    ;;
  *) exit 1 ;;
esac
SH
cat >"$WORK_DIR/network-bin/ip-full" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod 0755 "$WORK_DIR/network-bin/nft" "$WORK_DIR/network-bin/ip-full"
: >"$WORK_DIR/nft.log"
network_cleanup() {
  PATH="$WORK_DIR/network-bin:$PATH" \
  FORKOP_IP_BIN="$WORK_DIR/network-bin/ip-full" \
  FORKOP_TEST_NFT_LOG="$WORK_DIR/nft.log" \
  FORKOP_TEST_NFT_TABLE_STATE="$WORK_DIR/nft-table" \
  NFT_TABLE_NAME=CrashTable \
  RT_TABLE_NAME=crash_route \
  NFT_FAKEIP_MARK=0x00100000 \
    ucode -L "$FORKOP_LIB" "$LIFECYCLE" network-cleanup-fixture
}
touch "$WORK_DIR/nft-table"
if FORKOP_TEST_NFT_DELETE_FAIL=1 network_cleanup >/dev/null 2>&1; then
  fail "runtime cleanup must fail when the DNS redirect table cannot be deleted"
fi
[ -e "$WORK_DIR/nft-table" ] ||
  fail "the failed nft delete fixture must leave the runtime table present"
network_cleanup || fail "runtime cleanup must succeed when the nft table is deleted"
[ ! -e "$WORK_DIR/nft-table" ] ||
  fail "successful runtime cleanup must remove the DNS redirect table"

printf 'ucode\0-L\0%s\0%s\0monitor\0' "$FORKOP_LIB" "$WATCH" >"$WORK_DIR/worker.cmdline"
FORKOP_LIB="$FORKOP_LIB" FORKOP_SING_BOX_WATCH_UC="$WATCH" \
  ucode -L "$FORKOP_LIB" "$WATCH" worker-cmdline-fixture "$WORK_DIR/worker.cmdline" ||
  fail "sing-box watcher must recognize its own process identity"
printf 'sleep\0%s\0' '30' >"$WORK_DIR/foreign.cmdline"
if FORKOP_LIB="$FORKOP_LIB" FORKOP_SING_BOX_WATCH_UC="$WATCH" \
  ucode -L "$FORKOP_LIB" "$WATCH" worker-cmdline-fixture "$WORK_DIR/foreign.cmdline"; then
  fail "sing-box watcher must reject a foreign process identity"
fi

sleep 30 &
FOREIGN_PID="$!"
printf '%s\n' "$FOREIGN_PID" >"$WORK_DIR/watch.pid"
FORKOP_LIB="$FORKOP_LIB" \
FORKOP_SING_BOX_WATCH_UC="$WATCH" \
FORKOP_SING_BOX_WATCH_PID_FILE="$WORK_DIR/watch.pid" \
FORKOP_UBUS_BIN=/bin/false \
  ucode -L "$FORKOP_LIB" "$WATCH" stop-worker &&
  fail "sing-box watcher stop must fail when procd service deletion fails"
kill -0 "$FOREIGN_PID" >/dev/null 2>&1 ||
  fail "sing-box watcher must not signal a foreign PID"
[ "$(cat "$WORK_DIR/watch.pid")" = "$FOREIGN_PID" ] ||
  fail "failed procd deletion must preserve watcher identity for the next cleanup attempt"
cat >"$WORK_DIR/ubus-absent" <<'EOF_UBUS_ABSENT'
#!/usr/bin/env bash
if [ "${3:-}" = delete ]; then
  exit 4
fi
printf '{}\n'
EOF_UBUS_ABSENT
chmod 0755 "$WORK_DIR/ubus-absent"
FORKOP_LIB="$FORKOP_LIB" \
FORKOP_SING_BOX_WATCH_UC="$WATCH" \
FORKOP_SING_BOX_WATCH_PID_FILE="$WORK_DIR/watch.pid" \
FORKOP_UBUS_BIN="$WORK_DIR/ubus-absent" \
  ucode -L "$FORKOP_LIB" "$WATCH" stop-worker ||
  fail "sing-box watcher stop must tolerate an already absent procd service"
[ ! -e "$WORK_DIR/watch.pid" ] || fail "successful watcher cleanup must remove a stale PID file"
kill -0 "$FOREIGN_PID" >/dev/null 2>&1 ||
  fail "sing-box watcher cleanup must not signal a foreign PID"
kill "$FOREIGN_PID" >/dev/null 2>&1 || true
wait "$FOREIGN_PID" 2>/dev/null || true
FOREIGN_PID=""

payload="$(FORKOP_LIB="$FORKOP_LIB" FORKOP_SING_BOX_WATCH_UC="$WATCH" \
  ucode -L "$FORKOP_LIB" "$WATCH" procd-service-payload-fixture)"
case "$payload" in
  *'"name": "forkop-singbox-watch"'*'"respawn": [ "3600", "5", "0" ]'*) ;;
  *) fail "sing-box watcher must be registered as a respawning procd service" ;;
esac
case "$payload" in
  *'"env": {'*'"FORKOP_SING_BOX_WATCH_UC"'*'"FORKOP_SING_BOX_PENDING_CLEANUP_FILE"'*) ;;
  *) fail "procd watcher must retain the lifecycle paths it needs after respawn" ;;
esac

guard="$WORK_DIR/planned-stop"
guard_fixture() {
  FORKOP_LIB="$FORKOP_LIB" \
  FORKOP_RUNTIME_STATE_DIR="$WORK_DIR" \
  FORKOP_SING_BOX_PLANNED_STOP_FILE="$guard" \
    ucode -L "$FORKOP_LIB" "$LIFECYCLE" sing-box-planned-stop-guard-fixture "$1"
}
guard_fixture mark || fail "planned sing-box stop guard must be writable"
guard_fixture check || fail "planned sing-box stop guard must persist for an already queued callback"
guard_fixture clear || fail "planned sing-box stop guard must be cleared after a successful start"
if guard_fixture check; then
  fail "cleared planned sing-box stop guard must not suppress a later real crash"
fi
awk '
  /function cleanup_crashed_sing_box\(/ { in_cleanup = 1 }
  in_cleanup && /sing_box_planned_stop\(\)/ { guarded = 1 }
  in_cleanup && /forkop-running/ { exit guarded ? 0 : 1 }
  in_cleanup && /^}/ { exit 1 }
  END { if (!guarded) exit 1 }
' "$LIFECYCLE" || fail "queued crash cleanup must check planned-stop intent after taking the lifecycle lock"

printf 'sing-box crash fail-safe tests passed\n'
