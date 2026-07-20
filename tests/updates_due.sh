#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
UPDATES_UC="$FORKOP_LIB/components/updates.uc"

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

assert_status 0 "never-run update should be due" update-is-due 100 0 60
assert_status 0 "expired update should be due" update-is-due 100 30 60
assert_status 1 "fresh update should not be due" update-is-due 100 50 60
assert_status 1 "future timestamp should not be due" update-is-due 100 130 60
assert_status 2 "invalid interval should fail" update-is-due 100 0 invalid

assert_eq 180 "$(updates_ucode duration-to-seconds 3m)" "minutes duration"
assert_eq 5400 "$(updates_ucode duration-to-seconds 1.5h)" "decimal duration"
assert_status 1 "invalid duration should fail" duration-to-seconds invalid
assert_eq "0 */2 * * *" "$(updates_ucode due-check-cron-schedule 7200)" "two-hour cron schedule"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

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
