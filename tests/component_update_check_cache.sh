#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
UPDATES_UC="$FORKOP_LIB/components/updates.uc"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

fake_lib="$WORK_DIR/lib"
cache_dir="$WORK_DIR/cache"
job_dir="$WORK_DIR/jobs"
state_file="$job_dir/manual.json"
output_file="$job_dir/manual.out"
timestamp_file="$WORK_DIR/component-update-check.timestamp"
mkdir -p \
  "$fake_lib/core" \
  "$fake_lib/config" \
  "$fake_lib/components" \
  "$fake_lib/service" \
  "$job_dir"

fake_bin="$WORK_DIR/bin"
store_file="$WORK_DIR/update-checks.json"
mkdir -p "$fake_bin"
printf '{}\n' >"$store_file"

cat >"$fake_bin/ubus" <<'SH'
#!/usr/bin/env bash
# Stands in for the state service: `ubus call forkop <method> [json]`.
[ "$1" = "call" ] || exit 1
method="$3"
payload="$4"
STORE="${FAKE_UBUS_STORE:?}" METHOD="$method" PAYLOAD="$payload" ucode -e '
  let fs = require("fs");
  let path = getenv("STORE");
  let method = getenv("METHOD");
  let entries = {};
  try { entries = json(fs.readfile(path)) || {}; } catch (e) { entries = {}; }

  if (method == "report_update_check") {
    let args = {};
    try { args = json(getenv("PAYLOAD")) || {}; } catch (e) { args = {}; }
    let result = null;
    try { result = json(args.result); } catch (e) { result = null; }
    if (result == null) {
      print("{ \"stored\": false }\n");
      exit(0);
    }
    entries[args.component] = result;
    fs.writefile(path, sprintf("%J", entries));
    print("{ \"stored\": true }\n");
  }
  else if (method == "update_checks") {
    let results = [];
    for (let _, entry in entries)
      push(results, entry);
    print(sprintf("%J", { results }), "\n");
  }
  else if (method == "forget_update_checks") {
    fs.writefile(path, "{}");
    print("{ \"forgotten\": true }\n");
  }
  else {
    exit(1);
  }
'
SH
chmod 0755 "$fake_bin/ubus"
export PATH="$fake_bin:$PATH"
export FAKE_UBUS_STORE="$store_file"

stored_component() {
  STORE="$store_file" COMPONENT="$1" ucode -e '
    let fs = require("fs");
    let entries = {};
    try { entries = json(fs.readfile(getenv("STORE"))) || {}; } catch (e) { entries = {}; }
    let entry = entries[getenv("COMPONENT")];
    print(entry == null ? "" : sprintf("%J", entry), "\n");
  '
}

cat >"$fake_lib/core/uci.uc" <<'UCODE'
function get_all(_config, section) {
    if (section == "settings") {
        return {
            component_update_check_enabled: getenv("TEST_COMPONENT_UPDATE_CHECK_ENABLED") || "0",
            component_update_check_interval: getenv("TEST_COMPONENT_UPDATE_CHECK_INTERVAL") || "1d"
        };
    }
    return {};
}

function section_objects(_config, _type) {
    return [];
}

return {
    get_all,
    section_objects
};
UCODE

cat >"$fake_lib/config/connections.uc" <<'UCODE'
return {};
UCODE

cat >"$fake_lib/components/action.uc" <<'UCODE'
#!/usr/bin/env ucode
let component = ARGV[1] || "forkop";
let action = ARGV[2] || "check_update";
print(sprintf("%J\n", {
    success: true,
    component,
    action,
    message: "Update is available",
    current_version: "1.0.0",
    latest_version: "1.1.0",
    release_url: "https://example.com/release",
    changed: 0,
    status: "outdated"
}));
UCODE

cat >"$fake_lib/service/state.uc" <<'UCODE'
#!/usr/bin/env ucode
exit(0);
UCODE

updates_ucode() {
  TEST_COMPONENT_UPDATE_CHECK_ENABLED="${TEST_COMPONENT_UPDATE_CHECK_ENABLED:-1}" \
    TEST_COMPONENT_UPDATE_CHECK_INTERVAL="${TEST_COMPONENT_UPDATE_CHECK_INTERVAL:-1d}" \
    FORKOP_LIB="$fake_lib" \
    UPDATES_JOB_DIR="$job_dir" \
    ucode -L "$fake_lib" -L "$FORKOP_LIB" "$UPDATES_UC" "$@"
}

updates_ucode component-action-worker "$state_file" "$output_file" sing_box check_update
[ -n "$(stored_component sing_box)" ] ||
  fail "manual checks must be reported while automatic checks are enabled"

manual_cache="$(updates_ucode component-update-check-cache)"
node -e '
const value = JSON.parse(process.argv[1]);
if (!value.enabled || value.results.length !== 1 ||
    value.results[0].component !== "sing_box" ||
    value.results[0].status !== "outdated" ||
    value.results[0].latest_version !== "1.1.0") process.exit(1);
' "$manual_cache" || fail "the reported manual check reads back wrong"

printf '{}\n' >"$store_file"
TEST_COMPONENT_UPDATE_CHECK_ENABLED=0 updates_ucode \
  component-action-worker "$state_file" "$output_file" sing_box check_update
[ -z "$(stored_component sing_box)" ] ||
  fail "manual checks must not be reported while automatic checks are disabled"

rm -f "$state_file"
updates_ucode component-updates-if-due
[ -n "$(stored_component forkop)" ] ||
  fail "automatic checks must report the Forkop result"

# Nothing on disk records any of this. The schedule is the cron line, and the
# answers live in the state service, which drops them when the installed
# packages change.
[ ! -e "$timestamp_file" ] ||
  fail "automatic checks must not keep a schedule of their own"
[ ! -d "$cache_dir" ] ||
  fail "check results must not be written to disk"
if grep -Fq 'COMPONENT_UPDATE_CHECK_CACHE_DIR' "$UPDATES_UC"; then
  fail "components/updates.uc must not own a check-result directory"
fi

printf 'component update check cache checks passed\n'
