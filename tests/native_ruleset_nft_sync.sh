#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
SYNC="$FORKOP_LIB/nft/ruleset_sync.uc"
LIFECYCLE="$FORKOP_LIB/service/lifecycle.uc"
WORK_DIR="$(mktemp -d)"
NFT_LOG="$WORK_DIR/nft.log"
NFT_INPUT="$WORK_DIR/nft.input"
FOREIGN_PID=""

cleanup() {
  [ -z "$FOREIGN_PID" ] || kill "$FOREIGN_PID" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  grep -Fq "$2" "$1" || fail "$3: expected '$2'"
}

assert_not_contains() {
  if grep -Fq "$2" "$1"; then
    fail "$3: unexpected '$2'"
  fi
}

sync_ucode() {
  ucode -L "$FORKOP_LIB" "$SYNC" "$@"
}

ucode -L "$FORKOP_LIB" -e 'let sync=require("nft.ruleset_sync"); exit(type(sync.build_plan)=="function" && type(sync.build_batch)=="function" ? 0 : 1);'

mkdir -p "$WORK_DIR/bin"
cat >"$WORK_DIR/bin/nft" <<'EOF_NFT'
#!/usr/bin/env bash
set -eo pipefail
printf '%s\n' "$*" >>"${NFT_LOG:?}"
cat >"${NFT_INPUT:?}"
EOF_NFT
chmod 0755 "$WORK_DIR/bin/nft"

cat >"$WORK_DIR/snapshot.json" <<'EOF_SNAPSHOT'
{
  "revision": 7,
  "providers": {
    "alpha": {
      "revision": 3,
      "ip_cidr": {
        "ipv4": ["198.51.100.0/24"],
        "ipv6": ["2001:db8:1::/48"],
        "scoped_ipv4": [
          {
            "prefixes": ["203.0.113.1"],
            "port_ranges": [
              {"start": 70, "end": 90},
              {"start": 1000, "end": 1100}
            ]
          }
        ],
        "scoped_ipv6": [
          {
            "prefixes": ["2001:db8:2::1"],
            "port_ranges": [{"start": 443, "end": 443}]
          }
        ],
        "skipped": [{"path": "rules[4]", "reason": "unsupported_constraints"}]
      }
    },
    "beta": {
      "revision": 4,
      "ip_cidr": {
        "ipv4": ["192.0.2.0/24"],
        "ipv6": [],
        "scoped_ipv4": [],
        "scoped_ipv6": []
      }
    }
  }
}
EOF_SNAPSHOT

cat >"$WORK_DIR/fixture.json" <<'EOF_FIXTURE'
{
  "sections": [
    {
      ".name": "mixed",
      "ip_cidr": ["10.0.0.0/8", "fd00::/8"],
      "ports": ["80", "443", "1000-1050"],
      "rule_set_tags": ["alpha", "beta"]
    },
    {
      ".name": "empty",
      "rule_set_tags": []
    },
    {
      ".name": "missing",
      "rule_set_tags": ["does-not-exist"]
    },
    {
      ".name": "bad_port",
      "ports": ["80; delete table inet ForkopTable"],
      "rule_set_tags": ["alpha"]
    },
    {
      ".name": "evil;delete_table",
      "rule_set_tags": []
    }
  ]
}
EOF_FIXTURE

sync_ucode render-fixture "$WORK_DIR/snapshot.json" "$WORK_DIR/fixture.json" mixed \
  >"$WORK_DIR/render.nft" 2>"$WORK_DIR/render.err" || {
    cat "$WORK_DIR/render.err" >&2
    fail "main fixture did not render"
  }

[ "$(wc -l <"$WORK_DIR/render.err")" -eq 1 ] || {
  cat "$WORK_DIR/render.err" >&2
  fail "render must produce one concise summary"
}
assert_contains "$WORK_DIR/render.err" "Added 5 IP addresses from rule sets to nft" "sync summary"
assert_not_contains "$WORK_DIR/render.err" "ignored" "sync summary must hide internal filtering details"
assert_not_contains "$WORK_DIR/render.err" "IP/port" "sync summary must describe generic nft values"
assert_not_contains "$WORK_DIR/render.err" "mixed" "sync summary must not expose section details"
for set_name in subnets subnets6 ip_ports ip6_ports; do
  assert_contains "$WORK_DIR/render.nft" "flush set inet ForkopTable forkop_rule_mixed_${set_name}" "atomic ${set_name} flush"
done

assert_contains "$WORK_DIR/render.nft" "10.0.0.0/8 . 80" "inline IPv4 gets section port"
assert_contains "$WORK_DIR/render.nft" "fd00::/8 . 443" "inline IPv6 gets section port"
assert_contains "$WORK_DIR/render.nft" "198.51.100.0/24 . 1000-1050" "provider IPv4 gets section port"
assert_contains "$WORK_DIR/render.nft" "2001:db8:1::/48 . 80" "provider IPv6 gets section port"
assert_contains "$WORK_DIR/render.nft" "203.0.113.1 . 80" "scoped IPv4 ports are intersected"
assert_contains "$WORK_DIR/render.nft" "203.0.113.1 . 1000-1050" "scoped IPv4 range is intersected"
assert_contains "$WORK_DIR/render.nft" "2001:db8:2::1 . 443" "scoped IPv6 is retained"
assert_not_contains "$WORK_DIR/render.nft" "203.0.113.1 . 70-90" "scoped range must not be widened"
assert_not_contains "$WORK_DIR/render.nft" "203.0.113.1 . 1000-1100" "section port range must constrain scoped range"
assert_not_contains "$WORK_DIR/render.nft" "2001:db8:2::1 . 80" "unrelated section port must not be added"

rm -f "$NFT_LOG" "$NFT_INPUT"
PATH="$WORK_DIR/bin:$PATH" NFT_LOG="$NFT_LOG" NFT_INPUT="$NFT_INPUT" \
  sync_ucode apply-fixture "$WORK_DIR/snapshot.json" "$WORK_DIR/fixture.json" mixed \
  >"$WORK_DIR/apply.out" 2>"$WORK_DIR/apply.err"
[ "$(wc -l <"$NFT_LOG")" -eq 1 ] || fail "sync must invoke nft exactly once"
[ "$(cat "$NFT_LOG")" = "-f -" ] || fail "sync must send one nft batch on stdin"
cmp -s "$WORK_DIR/render.nft" "$NFT_INPUT" || fail "applied transaction differs from rendered transaction"

sync_ucode render-fixture "$WORK_DIR/snapshot.json" "$WORK_DIR/fixture.json" empty >"$WORK_DIR/empty.nft"
[ "$(grep -c '^flush set ' "$WORK_DIR/empty.nft")" -eq 4 ] || fail "empty result must flush all four sets"
if grep -q '^add element ' "$WORK_DIR/empty.nft"; then
  fail "empty result must not add elements"
fi

rm -f "$NFT_LOG" "$NFT_INPUT"
if PATH="$WORK_DIR/bin:$PATH" NFT_LOG="$NFT_LOG" NFT_INPUT="$NFT_INPUT" \
  sync_ucode apply-fixture "$WORK_DIR/snapshot.json" "$WORK_DIR/fixture.json" missing >/dev/null 2>&1; then
  fail "missing expected provider must fail"
fi
[ ! -e "$NFT_LOG" ] || fail "missing provider must fail before invoking nft"

if PATH="$WORK_DIR/bin:$PATH" NFT_LOG="$NFT_LOG" NFT_INPUT="$NFT_INPUT" \
  sync_ucode apply-fixture "$WORK_DIR/snapshot.json" "$WORK_DIR/fixture.json" bad_port >/dev/null 2>&1; then
  fail "invalid section port must fail"
fi
[ ! -e "$NFT_LOG" ] || fail "invalid section port must fail before invoking nft"

cat >"$WORK_DIR/malformed.json" <<'EOF_MALFORMED'
{
  "revision": 1,
  "providers": {
    "bad": {
      "revision": 1,
      "ip_cidr": {
        "ipv4": ["198.51.100.0/24; delete table inet ForkopTable"],
        "ipv6": [],
        "scoped_ipv4": [],
        "scoped_ipv6": []
      }
    }
  }
}
EOF_MALFORMED
cat >"$WORK_DIR/bad-fixture.json" <<'EOF_BAD_FIXTURE'
{"sections":[{".name":"safe","rule_set_tags":["bad"]}]}
EOF_BAD_FIXTURE

rm -f "$NFT_LOG" "$NFT_INPUT"
if PATH="$WORK_DIR/bin:$PATH" NFT_LOG="$NFT_LOG" NFT_INPUT="$NFT_INPUT" \
  sync_ucode apply-fixture "$WORK_DIR/malformed.json" "$WORK_DIR/bad-fixture.json" safe >/dev/null 2>&1; then
  fail "injected prefix must fail"
fi
[ ! -e "$NFT_LOG" ] || fail "malformed snapshot must fail before invoking nft"

cat >"$WORK_DIR/malformed-port.json" <<'EOF_MALFORMED_PORT'
{
  "revision": 1,
  "providers": {
    "bad": {
      "revision": 1,
      "ip_cidr": {
        "ipv4": [],
        "ipv6": [],
        "scoped_ipv4": [{"prefixes":["198.51.100.1"],"port_ranges":[{"start":80,"end":70000}]}],
        "scoped_ipv6": []
      }
    }
  }
}
EOF_MALFORMED_PORT
if PATH="$WORK_DIR/bin:$PATH" NFT_LOG="$NFT_LOG" NFT_INPUT="$NFT_INPUT" \
  sync_ucode apply-fixture "$WORK_DIR/malformed-port.json" "$WORK_DIR/bad-fixture.json" safe >/dev/null 2>&1; then
  fail "invalid snapshot port must fail"
fi
[ ! -e "$NFT_LOG" ] || fail "invalid snapshot port must fail before invoking nft"

if sync_ucode render-fixture "$WORK_DIR/snapshot.json" "$WORK_DIR/fixture.json" 'evil;delete_table' >/dev/null 2>&1; then
  fail "unsafe section name must fail"
fi
if sync_ucode render-fixture "$WORK_DIR/snapshot.json" "$WORK_DIR/fixture.json" empty 'ForkopTable;delete' >/dev/null 2>&1; then
  fail "unsafe table name must fail"
fi

community_tag="$(FORKOP_TEST_SECTION=batch_one FORKOP_TEST_REFERENCE=discord \
  ucode -L "$FORKOP_LIB" -e 'let r=require("singbox.rulesets"); print(r.community_tag(getenv("FORKOP_TEST_SECTION"),getenv("FORKOP_TEST_REFERENCE")));')"
subnet_tag="$(FORKOP_TEST_REFERENCE=https://example.com/with-subnets.srs \
  ucode -L "$FORKOP_LIB" -e 'let r=require("singbox.rulesets"); print(r.custom_reference_tag(getenv("FORKOP_TEST_REFERENCE")));')"
mixed_tag="$(FORKOP_TEST_REFERENCE=https://example.com/mixed.txt \
  ucode -L "$FORKOP_LIB" -e 'let r=require("singbox.rulesets"); print(r.custom_reference_tag(getenv("FORKOP_TEST_REFERENCE")));')"

cat >"$WORK_DIR/batch-snapshot.json" <<EOF_BATCH_SNAPSHOT
{
  "revision": 9,
  "providers": {
    "$community_tag": {
      "revision": 2,
      "ip_cidr": {
        "ipv4": ["198.51.100.0/24"], "ipv6": [], "scoped_ipv4": [], "scoped_ipv6": [],
        "skipped": [{"path":"rules[1]","reason":"unsupported_constraints"}]
      }
    },
    "$subnet_tag": {
      "revision": 3,
      "ip_cidr": {
        "ipv4": [], "ipv6": ["2001:db8:10::/48"], "scoped_ipv4": [], "scoped_ipv6": []
      }
    },
    "$mixed_tag": {
      "revision": 4,
      "ip_cidr": {
        "ipv4": [], "ipv6": [],
        "scoped_ipv4": [{"prefixes":["203.0.113.10"],"port_ranges":[{"start":70,"end":90}]}],
        "scoped_ipv6": []
      }
    }
  }
}
EOF_BATCH_SNAPSHOT

cat >"$WORK_DIR/batch-fixture.json" <<'EOF_BATCH_FIXTURE'
{
  "sections": [
    {
      ".name": "batch_one", "enabled": "1", "action": "proxy",
      "ip_cidr": ["10.0.0.0/8"], "ports": ["80"],
      "community_lists": ["discord", "youtube"],
      "rule_set": ["https://example.com/domain-only.srs"],
      "rule_set_with_subnets": ["https://example.com/with-subnets.srs", "https://example.com/mixed.txt"]
    },
    {
      ".name": "batch_two", "enabled": "1", "action": "bypass",
      "ip_cidr": ["2001:db8:20::/48"]
    },
    {
      ".name": "dns_skip", "enabled": "1", "action": "dns",
      "rule_set": ["https://example.com/dns.txt"]
    },
    {
      ".name": "disabled_skip", "enabled": "0", "action": "proxy",
      "rule_set_with_subnets": ["https://example.com/disabled.txt"]
    },
    {
      ".name": "domain_only_skip", "enabled": "1", "action": "proxy",
      "domain_suffix": ["example.org"], "ports": ["443"],
      "rule_set": ["https://example.com/domain-only.srs"]
    }
  ]
}
EOF_BATCH_FIXTURE

rm -f "$NFT_LOG" "$NFT_INPUT"
PATH="$WORK_DIR/bin:$PATH" NFT_LOG="$NFT_LOG" NFT_INPUT="$NFT_INPUT" \
  sync_ucode apply-all-fixture "$WORK_DIR/batch-snapshot.json" "$WORK_DIR/batch-fixture.json" \
  >"$WORK_DIR/batch.out" 2>"$WORK_DIR/batch.err"
[ "$(wc -l <"$NFT_LOG")" -eq 1 ] || fail "full sync must invoke nft exactly once"
[ "$(grep -c '^flush set ' "$NFT_INPUT")" -eq 8 ] || fail "full sync must rebuild both eligible sections together"
assert_contains "$NFT_INPUT" "forkop_rule_batch_one_ip_ports" "first eligible section"
assert_contains "$NFT_INPUT" "forkop_rule_batch_two_subnets6" "second eligible section"
assert_contains "$NFT_INPUT" "198.51.100.0/24 . 80" "subnet community provider"
assert_contains "$NFT_INPUT" "2001:db8:10::/48 . 80" "rule_set_with_subnets provider"
assert_contains "$NFT_INPUT" "203.0.113.10 . 80" "text provider scoped port intersection"
assert_not_contains "$NFT_INPUT" "dns_skip" "DNS action must not own nft priority sets"
assert_not_contains "$NFT_INPUT" "disabled_skip" "disabled section must not own nft priority sets"
assert_not_contains "$NFT_INPUT" "domain_only_skip" "domain-only section must not own nft priority sets"
[ "$(wc -l <"$WORK_DIR/batch.err")" -eq 1 ] || fail "full sync must emit one concise summary"
assert_contains "$WORK_DIR/batch.err" "Added 3 IP addresses from rule sets to nft" "batch sync summary"
assert_not_contains "$WORK_DIR/batch.err" "ignored" "batch summary must hide internal filtering details"
assert_not_contains "$WORK_DIR/batch.err" "IP/port" "batch summary must describe generic nft values"
assert_not_contains "$WORK_DIR/batch.err" "section" "batch summary must not expose section counts"

sed 's/"discord", //' "$WORK_DIR/batch-fixture.json" >"$WORK_DIR/batch-without-discord.json"
PATH="$WORK_DIR/bin:$PATH" NFT_LOG="$NFT_LOG" NFT_INPUT="$NFT_INPUT" \
  sync_ucode apply-all-fixture "$WORK_DIR/batch-snapshot.json" "$WORK_DIR/batch-without-discord.json" \
  >/dev/null 2>"$WORK_DIR/batch-without-discord.err"
assert_contains "$WORK_DIR/batch-without-discord.err" "Added 2 IP addresses from rule sets to nft" \
  "removing a subnet rule set must change the logged IP count"

cat >"$WORK_DIR/incomplete-batch-snapshot.json" <<EOF_INCOMPLETE_BATCH
{
  "revision": 5,
  "providers": {
    "$community_tag": {"revision":2,"ip_cidr":{"ipv4":[],"ipv6":[],"scoped_ipv4":[],"scoped_ipv6":[]}},
    "$subnet_tag": {"revision":3,"ip_cidr":{"ipv4":[],"ipv6":[],"scoped_ipv4":[],"scoped_ipv6":[]}}
  }
}
EOF_INCOMPLETE_BATCH
rm -f "$NFT_LOG" "$NFT_INPUT"
if PATH="$WORK_DIR/bin:$PATH" NFT_LOG="$NFT_LOG" NFT_INPUT="$NFT_INPUT" \
  sync_ucode apply-all-fixture "$WORK_DIR/incomplete-batch-snapshot.json" "$WORK_DIR/batch-fixture.json" >/dev/null 2>&1; then
  fail "full sync with a missing provider must fail"
fi
[ ! -e "$NFT_LOG" ] || fail "full sync must validate every section before invoking nft"

cat >"$WORK_DIR/invalid-late-fixture.json" <<'EOF_INVALID_LATE'
{
  "sections": [
    {".name":"valid_first","enabled":"1","action":"proxy","ip_cidr":["192.0.2.1"]},
    {".name":"invalid_second","enabled":"1","action":"proxy","ip_cidr":["203.0.113.0/24; delete table inet ForkopTable"]}
  ]
}
EOF_INVALID_LATE
rm -f "$NFT_LOG" "$NFT_INPUT"
if PATH="$WORK_DIR/bin:$PATH" NFT_LOG="$NFT_LOG" NFT_INPUT="$NFT_INPUT" \
  sync_ucode apply-all-fixture "$WORK_DIR/batch-snapshot.json" "$WORK_DIR/invalid-late-fixture.json" >/dev/null 2>&1; then
  fail "full sync with a malformed later section must fail"
fi
[ ! -e "$NFT_LOG" ] || fail "later validation failure must preserve every old set"

{
  printf '{"revision":1,"providers":{"large":{"revision":1,"ip_cidr":{"ipv4":['
  for i in $(seq 0 299); do
    [ "$i" -eq 0 ] || printf ','
    printf '"10.%d.%d.1/32"' "$((i / 256))" "$((i % 256))"
  done
  printf '],"ipv6":[],"scoped_ipv4":[],"scoped_ipv6":[]}}}}\n'
} >"$WORK_DIR/large.json"
printf '{"sections":[{".name":"large","rule_set_tags":["large"]}]}\n' >"$WORK_DIR/large-fixture.json"
sync_ucode render-fixture "$WORK_DIR/large.json" "$WORK_DIR/large-fixture.json" large >"$WORK_DIR/large.nft"
[ "$(grep -c '^add element .*forkop_rule_large_subnets ' "$WORK_DIR/large.nft")" -gt 1 ] || fail "large sets must be chunked"
awk 'length($0) > 8192 { exit 1 }' "$WORK_DIR/large.nft" || fail "nft batch line exceeds limit"

cat >"$WORK_DIR/sing-box.json" <<'EOF_SING_BOX'
{"experimental":{"clash_api":{"external_controller":"0.0.0.0:9090","secret":"test-secret"}}}
EOF_SING_BOX
api_config="$(FORKOP_SING_BOX_CONFIG="$WORK_DIR/sing-box.json" ucode -L "$FORKOP_LIB" -e '
  let sync=require("nft.ruleset_sync");
  let api=sync.native_api_config();
  print(api.url,"\t",api.secret);
')"
[ "$api_config" = $'http://127.0.0.1:9090\ttest-secret' ] || fail "native API config was not normalized"

printf 'ucode\0-L\0%s\0%s\0worker\0' "$FORKOP_LIB" "$SYNC" >"$WORK_DIR/worker.cmdline"
FORKOP_LIB="$FORKOP_LIB" FORKOP_RULESET_SYNC_UC="$SYNC" \
  sync_ucode worker-cmdline-fixture "$WORK_DIR/worker.cmdline" ||
  fail "native rule-set worker must recognize its own process identity"
printf 'sleep\0%s\0' '30' >"$WORK_DIR/foreign.cmdline"
if FORKOP_LIB="$FORKOP_LIB" FORKOP_RULESET_SYNC_UC="$SYNC" \
  sync_ucode worker-cmdline-fixture "$WORK_DIR/foreign.cmdline"; then
  fail "native rule-set worker must reject a foreign process identity"
fi

sleep 30 &
FOREIGN_PID="$!"
printf '%s\n' "$FOREIGN_PID" >"$WORK_DIR/ruleset-sync.pid"
FORKOP_LIB="$FORKOP_LIB" \
FORKOP_RULESET_SYNC_UC="$SYNC" \
FORKOP_RULESET_SYNC_PID_FILE="$WORK_DIR/ruleset-sync.pid" \
FORKOP_UBUS_BIN=/bin/false \
  sync_ucode stop-worker && fail "native rule-set worker stop must fail when procd service deletion fails"
kill -0 "$FOREIGN_PID" >/dev/null 2>&1 ||
  fail "native rule-set worker must not signal a foreign PID"
[ "$(cat "$WORK_DIR/ruleset-sync.pid")" = "$FOREIGN_PID" ] ||
  fail "failed procd deletion must preserve worker identity for the next cleanup attempt"
cat >"$WORK_DIR/bin/ubus-absent" <<'EOF_UBUS_ABSENT'
#!/usr/bin/env bash
if [ "${3:-}" = delete ]; then
  exit 4
fi
printf '{}\n'
EOF_UBUS_ABSENT
chmod 0755 "$WORK_DIR/bin/ubus-absent"
FORKOP_LIB="$FORKOP_LIB" \
FORKOP_RULESET_SYNC_UC="$SYNC" \
FORKOP_RULESET_SYNC_PID_FILE="$WORK_DIR/ruleset-sync.pid" \
FORKOP_UBUS_BIN="$WORK_DIR/bin/ubus-absent" \
  sync_ucode stop-worker || fail "native rule-set worker stop must tolerate an already absent procd service"
[ ! -e "$WORK_DIR/ruleset-sync.pid" ] || fail "successful worker cleanup must remove a stale PID file"
kill -0 "$FOREIGN_PID" >/dev/null 2>&1 ||
  fail "native rule-set worker cleanup must not signal a foreign PID"
kill "$FOREIGN_PID" >/dev/null 2>&1 || true
wait "$FOREIGN_PID" 2>/dev/null || true
FOREIGN_PID=""

payload="$(FORKOP_LIB="$FORKOP_LIB" FORKOP_RULESET_SYNC_UC="$SYNC" \
  sync_ucode procd-service-payload-fixture)"
case "$payload" in
  *'"name": "forkop-ruleset-sync"'*'"respawn": [ "3600", "5", "0" ]'*) ;;
  *) fail "native rule-set worker must be registered as a respawning procd service" ;;
esac
case "$payload" in
  *'"env": {'*'"FORKOP_SING_BOX_CONFIG"'*'"FORKOP_RULESET_SYNC_UC"'*) ;;
  *) fail "procd rule-set worker must retain the runtime paths it needs after respawn" ;;
esac

cat >"$WORK_DIR/runtime.state" <<EOF_RUNTIME_STATE
forkop.batch=section
forkop.batch.enabled=1
forkop.batch.action=proxy
forkop.batch.ports=80
forkop.batch.rule_set_with_subnets=https://example.com/mixed.txt
EOF_RUNTIME_STATE
cat >"$WORK_DIR/runtime-snapshot.json" <<EOF_RUNTIME_SNAPSHOT
{"revision":4,"providers":{"$mixed_tag":{"revision":4,"ip_cidr":{"ipv4":["198.51.100.0/24"],"ipv6":[],"scoped_ipv4":[],"scoped_ipv6":[]}}}}
EOF_RUNTIME_SNAPSHOT
cat >"$WORK_DIR/bin/curl" <<'EOF_CURL'
#!/usr/bin/env bash
set -eo pipefail
case "${*: -1}" in
  */providers/rules) cat "${RULESET_SNAPSHOT:?}" ;;
  *) exit 22 ;;
esac
EOF_CURL
chmod 0755 "$WORK_DIR/bin/curl"

rm -f "$NFT_LOG" "$NFT_INPUT"
PATH="$WORK_DIR/bin:$PATH" NFT_LOG="$NFT_LOG" NFT_INPUT="$NFT_INPUT" \
RULESET_SNAPSHOT="$WORK_DIR/runtime-snapshot.json" \
FORKOP_UCI_STATE_FILE="$WORK_DIR/runtime.state" \
FORKOP_SING_BOX_CONFIG="$WORK_DIR/sing-box.json" \
sync_ucode sync >"$WORK_DIR/runtime.out" 2>"$WORK_DIR/runtime.err" || {
  cat "$WORK_DIR/runtime.err" >&2
  fail "native runtime sync failed"
}
[ "$(wc -l <"$NFT_LOG")" -eq 1 ] || fail "native runtime sync must invoke nft once"
assert_contains "$NFT_INPUT" "198.51.100.0/24 . 80" "native runtime snapshot"

sed 's/198\.51\.100\.0\/24/203.0.113.0\/24/' "$WORK_DIR/runtime-snapshot.json" >"$WORK_DIR/runtime-changed.json"
rm -f "$NFT_LOG" "$NFT_INPUT"
PATH="$WORK_DIR/bin:$PATH" NFT_LOG="$NFT_LOG" NFT_INPUT="$NFT_INPUT" \
FORKOP_TEST_INITIAL_SNAPSHOT="$WORK_DIR/runtime-snapshot.json" \
FORKOP_TEST_CHANGED_SNAPSHOT="$WORK_DIR/runtime-changed.json" \
ucode -L "$FORKOP_LIB" -e '
let fs = require("fs");
let sync = require("nft.ruleset_sync");
let sections = [{
  ".name": "batch", "enabled": "1", "action": "proxy", "ports": ["80"],
  "rule_set_with_subnets": ["https://example.com/mixed.txt"]
}];
let initial = json(fs.readfile(getenv("FORKOP_TEST_INITIAL_SNAPSHOT")));
let changed = json(fs.readfile(getenv("FORKOP_TEST_CHANGED_SNAPSHOT")));
exit(sync.apply_runtime_snapshot(initial, sections) &&
  sync.apply_runtime_snapshot(initial, sections) &&
  sync.apply_runtime_snapshot(changed, sections) ? 0 : 1);
' ||
  fail "in-process native runtime sync failed"
[ "$(wc -l <"$NFT_LOG")" -eq 2 ] ||
  fail "unchanged native runtime snapshot must not invoke nft again"
assert_contains "$NFT_INPUT" "203.0.113.0/24 . 80" "changed native runtime snapshot"

grep -Fq 'let restart_ruleset_sync = plan.needs_nft_rebuild == 1;' "$LIFECYCLE" ||
  fail "sing-box-only reloads must keep native rule-set sync state in memory"

printf 'forkop.empty=section\nforkop.empty.enabled=1\nforkop.empty.action=proxy\n' >"$WORK_DIR/empty.state"
FORKOP_UCI_STATE_FILE="$WORK_DIR/empty.state" \
FORKOP_SING_BOX_CONFIG="$WORK_DIR/sing-box.json" \
FORKOP_RULESET_SYNC_PID_FILE="$WORK_DIR/no-source.pid" \
FORKOP_UBUS_BIN=/bin/true \
sync_ucode start-worker
[ ! -e "$WORK_DIR/no-source.pid" ] || fail "worker must not start without native nft sources"

printf 'native rule-set nft sync tests passed\n'
