#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
UPDATES_UC="$FORKOP_LIB/components/updates.uc"

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
}

updates_ucode() {
  ucode -L "$FORKOP_LIB" "$UPDATES_UC" "$@"
}

assert_status() {
  local expected="$1"
  local label="$2"
  shift 2
  local status=0
  updates_ucode "$@" >/dev/null 2>&1 || status="$?"
  [ "$status" = "$expected" ] || fail "$label: expected exit $expected, got $status"
}

if grep -n -E 'require\("uci"\)\.cursor|uci -q' "$UPDATES_UC" >/dev/null 2>&1; then
  fail "components/updates.uc must use core.uci instead of owning direct UCI cursor or CLI calls"
fi

assert_eq 180 "$(updates_ucode duration-to-seconds 3m)" "minutes duration"
assert_eq 5400 "$(updates_ucode duration-to-seconds 1.5h)" "decimal duration"
assert_status 1 "invalid duration should fail" duration-to-seconds invalid

# Cron is the schedule, so the line it generates has to mean exactly what the
# interval says. Anything it cannot express exactly is refused - it used to be
# rounded to the nearest thing cron could say and then corrected by a file
# recording the last run, which is a schedule kept in two places.
assert_eq "* * * * *" "$(updates_ucode due-check-cron-schedule 60)" "one-minute cron schedule"
assert_eq "*/5 * * * *" "$(updates_ucode due-check-cron-schedule 300)" "five-minute cron schedule"
assert_eq "0 * * * *" "$(updates_ucode due-check-cron-schedule 3600)" "hourly cron schedule"
assert_eq "0 */2 * * *" "$(updates_ucode due-check-cron-schedule 7200)" "two-hour cron schedule"
assert_eq "0 0 * * *" "$(updates_ucode due-check-cron-schedule 86400)" "daily cron schedule"

# Two days is the case that used to become a daily line plus a suppressing file.
assert_eq "" "$(updates_ucode due-check-cron-schedule 172800)" "two days has no exact cron schedule"
assert_eq "" "$(updates_ucode due-check-cron-schedule 90)" "ninety seconds has no exact cron schedule"
assert_eq "" "$(updates_ucode due-check-cron-schedule 5400)" "ninety minutes has no exact cron schedule"

# And the file itself is gone.
if grep -Fq 'COMPONENT_UPDATE_CHECK_STATE_FILE' "$UPDATES_UC"; then
  fail "the schedule belongs to cron; no file should record the last run"
fi

cat >"$WORK_DIR/enabled.json" <<'JSON'
{
  "settings": {
    "component_update_check_enabled": "1",
    "component_update_check_interval": "2h"
  }
}
JSON

assert_eq $'component\t0 */2 * * * /usr/bin/forkop component_updates_if_due # component' \
  "$(updates_ucode cron-refresh-plan-fixture "$WORK_DIR/enabled.json" /usr/bin/forkop '# component')" \
  "component-only cron plan"

cat >"$WORK_DIR/existing.cron" <<'CRON'
0 1 * * * /bin/true # keep
* * * * * /usr/bin/forkop component_updates_if_due # component
CRON

updates_ucode refresh-cron-fixture "$WORK_DIR/enabled.json" "$WORK_DIR/existing.cron" /usr/bin/forkop '# component' >"$WORK_DIR/result.json"
node - "$WORK_DIR/result.json" <<'JS'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const expected = [
  "0 1 * * * /bin/true # keep",
  "0 */2 * * * /usr/bin/forkop component_updates_if_due # component",
  ""
].join("\n");
if (value.crontab !== expected) {
  console.error("unexpected applied crontab", JSON.stringify(value.crontab));
  process.exit(1);
}
if (!value.logs.some(item => item.message.includes("component update check cron job has been created"))) {
  console.error("component cron log missing", JSON.stringify(value.logs));
  process.exit(1);
}
JS

cat >"$WORK_DIR/invalid.json" <<'JSON'
{
  "settings": {
    "component_update_check_enabled": "1",
    "component_update_check_interval": "bad"
  }
}
JSON

status=0
updates_ucode refresh-cron-fixture "$WORK_DIR/invalid.json" "$WORK_DIR/existing.cron" /usr/bin/forkop '# component' >"$WORK_DIR/invalid-result.json" || status="$?"
assert_eq 1 "$status" "invalid component interval status"
node - "$WORK_DIR/invalid-result.json" <<'JS'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (value.crontab !== "0 1 * * * /bin/true # keep\n") {
  console.error("invalid plan must remove only Forkop jobs", JSON.stringify(value.crontab));
  process.exit(1);
}
if (!value.logs.some(item => item.level === "error" && item.message === "Invalid component_update_check_interval value: bad")) {
  console.error("invalid component interval log missing", JSON.stringify(value.logs));
  process.exit(1);
}
JS

grep -Fq 'fs.writefile(tmp, as_string(text)) == null' "$UPDATES_UC" ||
  fail "empty crontab writes must not be treated as failures"
if grep -Eq 'list_update_if_due|subscription_update_if_due|forkop-list-update|forkop-subscription-update' "$UPDATES_UC"; then
  fail "runtime cron owner must contain only component update jobs"
fi

printf 'updates due checks passed\n'
