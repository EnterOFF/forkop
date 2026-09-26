#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
}

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

printf 'state service checks passed\n'
