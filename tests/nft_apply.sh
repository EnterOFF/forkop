#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
NFT_RUNTIME="$ROOT_DIR/forkop/files/usr/lib/nft/apply.uc"
WORK_DIR="$(mktemp -d)"
NFT_LOG="$WORK_DIR/nft.log"
NFT_BATCH_LOG="$WORK_DIR/nft-batch.log"
LOGGER_LOG="$WORK_DIR/logger.log"
IP_LOG="$WORK_DIR/ip.log"
SYSCTL_LOG="$WORK_DIR/sysctl.log"

nft_ucode() {
  ucode -L "$FORKOP_LIB" "$NFT_RUNTIME" "$@"
}

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  printf 'nft log:\n' >&2
  cat "$NFT_LOG" >&2 2>/dev/null || true
  printf 'logger log:\n' >&2
  cat "$LOGGER_LOG" >&2 2>/dev/null || true
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  local label="$3"

  grep -Fq "$expected" "$file" || fail "$label: expected '$expected'"
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
}

assert_line_before() {
  local file="$1"
  local first="$2"
  local second="$3"
  local label="$4"
  local first_line
  local second_line

  first_line="$(grep -Fn "$first" "$file" | head -n 1 | cut -d: -f1 || true)"
  second_line="$(grep -Fn "$second" "$file" | head -n 1 | cut -d: -f1 || true)"
  [ -n "$first_line" ] || fail "$label: missing first line '$first'"
  [ -n "$second_line" ] || fail "$label: missing second line '$second'"
  [ "$first_line" -lt "$second_line" ] || fail "$label: expected first line before second"
}

if grep -n 'require("uci").cursor' "$NFT_RUNTIME" >/dev/null 2>&1 ||
  grep -n 'uci -q' "$NFT_RUNTIME" >/dev/null 2>&1 ||
  grep -n '"uci", "-q"' "$NFT_RUNTIME" >/dev/null 2>&1 ||
  grep -n 'command_from_args(\[ "uci"' "$NFT_RUNTIME" >/dev/null 2>&1; then
  fail "nft/apply.uc must use core.uci instead of direct UCI cursor or CLI access"
fi
grep -Fq 'require("core.uci")' "$NFT_RUNTIME" ||
  fail "nft/apply.uc must import core.uci"

mkdir -p "$WORK_DIR/bin"
cat >"$WORK_DIR/bin/nft" <<'NFT'
#!/usr/bin/env bash
set -eo pipefail

# A batched operation hands nft one transaction on stdin instead of running a
# command per line. The commands are logged in the same tab separated form
# either way, so the expectations below describe what nft is told and not how
# many processes it took: a `{ ... }` group is one argument, everything else is
# separated by spaces.
log_batch_line() {
  local line="$1" token="" depth=0 char
  printf 'nft'
  while [ -n "$line" ]; do
    char="${line:0:1}"
    line="${line:1}"
    case "$char" in
    '{') depth=$((depth + 1)); token="$token$char" ;;
    '}') depth=$((depth - 1)); token="$token$char" ;;
    ' ')
      if [ "$depth" -gt 0 ]; then
        token="$token$char"
      elif [ -n "$token" ]; then
        printf '\t%s' "$token"
        token=""
      fi
      ;;
    *) token="$token$char" ;;
    esac
  done
  [ -z "$token" ] || printf '\t%s' "$token"
  printf '\n'
}

if [ "$#" -eq 2 ] && [ "$1" = "-f" ] && [ "$2" = "-" ]; then
  echo transaction >> "${NFT_BATCH_LOG:?}"
  while IFS= read -r batch_line; do
    [ -n "$batch_line" ] || continue
    log_batch_line "$batch_line" >> "${NFT_LOG:?}"
  done
  if [ "${NFT_TRANSACTION_FAIL:-0}" = "1" ]; then
    printf 'Error: syntax error, unexpected junk\nadd element inet ForkopTable localv4 { junk }\n' >&2
    exit 1
  fi
  exit 0
fi

{
  printf 'nft'
  for arg in "$@"; do
    printf '\t%s' "$arg"
  done
  printf '\n'
} >> "${NFT_LOG:?}"

if [ "$#" -eq 5 ] && [ "$1" = "list" ] && [ "$2" = "chain" ] &&
  [ "$3" = "inet" ] && [ "$5" = "mangle" ] && [ -n "${NFT_MANGLE_CHAIN_OUTPUT:-}" ]; then
  printf '%s\n' "$NFT_MANGLE_CHAIN_OUTPUT"
fi

if [ "$#" -eq 5 ] && [ "$1" = "-t" ] && [ "$2" = "list" ] && [ "$3" = "table" ] &&
  [ "$4" = "inet" ]; then
  if [ "${NFT_LIST_TABLE_FAIL:-0}" = "1" ]; then
    printf 'table %s is missing\n' "$5" >&2
    exit 1
  fi
fi
NFT
chmod 0755 "$WORK_DIR/bin/nft"

cat >"$WORK_DIR/bin/ip" <<'IP'
#!/usr/bin/env bash
set -eo pipefail
{
  printf 'ip'
  for arg in "$@"; do
    printf '\t%s' "$arg"
  done
  printf '\n'
} >> "${IP_LOG:?}"

if [ "$#" -eq 4 ] && [ "$1" = "route" ] && [ "$2" = "list" ] && [ "$3" = "table" ]; then
  if [ "${IP_ROUTE_LIST_FAIL:-0}" = "1" ]; then
    printf 'Error: ipv4: FIB table does not exist\nDump terminated\n' >&2
    exit 2
  fi
  printf '%s\n' "${IP_ROUTE_OUTPUT:-}"
  exit 0
fi

if [ "$#" -eq 5 ] && [ "$1" = "-6" ] && [ "$2" = "route" ] && [ "$3" = "list" ] && [ "$4" = "table" ]; then
  if [ "${IP_ROUTE6_LIST_FAIL:-0}" = "1" ]; then
    printf 'Error: ipv6: FIB table does not exist\nDump terminated\n' >&2
    exit 2
  fi
  printf '%s\n' "${IP_ROUTE6_OUTPUT:-}"
  exit 0
fi

if [ "$#" -eq 5 ] && [ "$1" = "-4" ] && [ "$2" = "rule" ] && [ "$3" = "list" ] && [ "$4" = "table" ]; then
  printf '%s\n' "${IP_RULE_OUTPUT:-}"
  exit 0
fi

if [ "$#" -eq 5 ] && [ "$1" = "-6" ] && [ "$2" = "rule" ] && [ "$3" = "list" ] && [ "$4" = "table" ]; then
  printf '%s\n' "${IP_RULE6_OUTPUT:-}"
  exit 0
fi

[ "${IP_FAIL_ADD:-0}" = "1" ] && exit 1
exit 0
IP
chmod 0755 "$WORK_DIR/bin/ip"

cat >"$WORK_DIR/bin/lsmod" <<'LSMOD'
#!/usr/bin/env bash
set -eo pipefail
printf '%s\n' "${LSMOD_OUTPUT:-}"
LSMOD
chmod 0755 "$WORK_DIR/bin/lsmod"

cat >"$WORK_DIR/bin/sysctl" <<'SYSCTL'
#!/usr/bin/env bash
set -eo pipefail
{
  printf 'sysctl'
  for arg in "$@"; do
    printf '\t%s' "$arg"
  done
  printf '\n'
} >> "${SYSCTL_LOG:?}"

if [ "$#" -eq 2 ] && [ "$1" = "-n" ] && [ "$2" = "net.bridge.bridge-nf-call-iptables" ]; then
  printf '%s\n' "${SYSCTL_BRIDGE_NF_CALL_IPTABLES:-0}"
  exit 0
fi

exit 0
SYSCTL
chmod 0755 "$WORK_DIR/bin/sysctl"

cat >"$WORK_DIR/bin/logger" <<'LOGGER'
#!/usr/bin/env bash
set -eo pipefail
printf '%s\n' "$*" >> "${LOGGER_LOG:?}"
LOGGER
chmod 0755 "$WORK_DIR/bin/logger"

export PATH="$WORK_DIR/bin:$PATH"
export NFT_LOG
export NFT_BATCH_LOG
export LOGGER_LOG
export IP_LOG
export SYSCTL_LOG
export FORKOP_IP_BIN="$WORK_DIR/bin/ip"

nft_ucode nft-create-runtime-base ForkopTable localv4 forkop_interfaces "br-lan tun0" 0x00100000 0x00200000 198.18.0.0/15 1602 1
assert_contains "$NFT_LOG" $'nft\tadd\ttable\tinet\tForkopTable' "runtime table"
assert_contains "$NFT_LOG" $'nft\tadd\tset\tinet\tForkopTable\tlocalv4\t{ type ipv4_addr; flags interval; auto-merge; }' "runtime localv4 set"
assert_contains "$NFT_LOG" $'nft\tadd\tset\tinet\tForkopTable\tlocalv6\t{ type ipv6_addr; flags interval; auto-merge; }' "runtime localv6 set"
assert_contains "$NFT_LOG" '0.0.0.0/8,10.0.0.0/8,127.0.0.0/8' "runtime localv4 elements"
assert_contains "$NFT_LOG" '::/128,::1/128,64:ff9b::/96' "runtime localv6 elements"
assert_contains "$NFT_LOG" $'nft\tadd\tset\tinet\tForkopTable\tforkop_interfaces\t{ type ifname; flags interval; }' "runtime interface set"
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_interfaces\t{ br-lan }' "runtime br-lan interface"
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_interfaces\t{ tun0 }' "runtime tun0 interface"
assert_contains "$NFT_LOG" $'nft\tadd\tchain\tinet\tForkopTable\tmangle\t{ type filter hook prerouting priority -149; policy accept; }' "runtime mangle chain runs after Tailscale connmark restore"
assert_contains "$NFT_LOG" $'nft\tadd\tchain\tinet\tForkopTable\tpriority_rules\t{ }' "runtime priority chain"
assert_contains "$NFT_LOG" $'nft\tadd\tchain\tinet\tForkopTable\tpriority_output_rules\t{ }' "runtime priority output chain"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tpriority_output_rules\tmeta\tmark\t!=\t0\treturn' "runtime priority output preserves provider marks"
assert_contains "$NFT_LOG" $'nft\tadd\tchain\tinet\tForkopTable\tdns_redirect\t{ type nat hook prerouting priority -101; policy accept; }' "runtime source-aware DNS redirect chain"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tdns_redirect\tiifname\t@forkop_interfaces\tudp\tdport\t53\tcounter\tredirect\tto\t:1603' "selected interfaces redirect UDP DNS"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tdns_redirect\tiifname\t@forkop_interfaces\ttcp\tdport\t53\tcounter\tredirect\tto\t:1603' "selected interfaces redirect TCP DNS"
if grep -Fq 'forkop_dns_sources' "$NFT_LOG"; then
  fail "interface-scoped DNS must not depend on device source sets"
fi
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle\tiifname\t@forkop_interfaces\tip6\tdaddr\t@localv6\tip6\tdaddr\t!=\tfc00::/18\treturn' "runtime local6 return preserves FakeIP6 capture"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle\tjump\tpriority_rules' "runtime priority jump"
# Only the sets something fills. There used to be a second, table-wide pair of
# address and port sets here with twenty-two rules reading them, and nothing had
# put an element in any of them since the sets became per section.
for absent in forkop_subnets forkop_subnets6 forkop_ports forkop_ip_ports forkop_ip6_ports; do
  if grep -Fq $'\t'"$absent"$'\t' "$NFT_LOG"; then
    fail "nothing fills $absent, so no rule may read it"
  fi
done
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tproxy\tmeta\tmark\t&\t0x00100000\t==\t0x00100000\tmeta\tl4proto\ttcp\ttproxy\tip\tto\t:1602\tcounter' "runtime proxy tcp rule"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tproxy\tmeta\tmark\t&\t0x00100000\t==\t0x00100000\tmeta\tl4proto\ttcp\ttproxy\tip6\tto\t[::1]:1602\tcounter' "runtime proxy6 tcp rule"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tproxy\tiifname\tlo\tmeta\tmark\t&\t0x00100000\t==\t0x00100000\tmeta\tl4proto\ttcp\ttproxy\tip\tto\t:1604\tcounter\taccept' "runtime System proxy tcp rule"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tproxy\tiifname\tlo\tmeta\tmark\t&\t0x00100000\t==\t0x00100000\tmeta\tl4proto\ttcp\ttproxy\tip6\tto\t[::1]:1604\tcounter\taccept' "runtime System proxy6 tcp rule"
assert_line_before "$NFT_LOG" \
  $'nft\tadd\trule\tinet\tForkopTable\tproxy\tiifname\tlo\tmeta\tmark\t&\t0x00100000\t==\t0x00100000\tmeta\tl4proto\ttcp\ttproxy\tip\tto\t:1604\tcounter\taccept' \
  $'nft\tadd\trule\tinet\tForkopTable\tproxy\tmeta\tmark\t&\t0x00100000\t==\t0x00100000\tmeta\tl4proto\ttcp\ttproxy\tip\tto\t:1602\tcounter' \
  "System TProxy classification precedes the generic inbound"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle_output\tmeta\tmark\t0x00200000\tcounter\treturn' "runtime outbound return"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle_output\tip6\tdaddr\t@localv6\tip6\tdaddr\t!=\tfc00::/18\treturn' "runtime output local6 return preserves FakeIP6 capture"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle_output\tjump\tpriority_output_rules' "runtime priority output jump"
assert_contains "$NFT_LOG" $'nft\tinsert\trule\tinet\tForkopTable\tmangle\tudp\tdport\t123\treturn' "runtime ntp exclusion"

cat >"$WORK_DIR/runtime-base-uci.state" <<'EOF_UCI'
forkop.settings=settings
forkop.settings.source_network_interfaces=br-lan tun0
forkop.settings.exclude_ntp=1
EOF_UCI
# A full replace reaches nft as one transaction. Issued command by command it was
# about a hundred processes, and for as long as they ran the old table had already
# been deleted and the rules meant to replace it were not there yet.
: > "$NFT_LOG"
: > "$NFT_BATCH_LOG"
FORKOP_UCI_STATE_FILE="$WORK_DIR/runtime-base-uci.state" \
FORKOP_RT_TABLES="$WORK_DIR/rt_tables" \
IP_ROUTE_OUTPUT='local default dev lo scope host' \
IP_ROUTE6_OUTPUT='local default dev lo metric 1024 pref medium' \
IP_RULE_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup forkop' \
IP_RULE6_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup forkop' \
  nft_ucode nft-rebuild-runtime-from-uci ||
  fail "a rebuild from UCI state should succeed"
assert_eq "1" "$(grep -c transaction "$NFT_BATCH_LOG")" "a full replace must reach nft as one transaction"
# The same run proves the base still reads its settings from UCI.
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_interfaces\t{ br-lan }' "replace takes br-lan from UCI"
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_interfaces\t{ tun0 }' "replace takes tun0 from UCI"
assert_contains "$NFT_LOG" $'nft\tinsert\trule\tinet\tForkopTable\tmangle\tudp\tdport\t123\treturn' "replace takes the ntp exclusion from UCI"
# Creating the table before deleting it is what makes the replace unconditional:
# `delete table` on a table that is not there aborts the whole transaction.
assert_line_before "$NFT_LOG" $'nft\ttable\tinet\tForkopTable' $'nft\tdelete\ttable\tinet\tForkopTable' \
  "the replace creates the table before deleting it"
assert_line_before "$NFT_LOG" $'nft\tdelete\ttable\tinet\tForkopTable' $'nft\tadd\ttable\tinet\tForkopTable' \
  "the replace adds the table back after deleting it"
if grep -Fq $'nft\t-t\tlist\ttable\tinet\tForkopTable' "$NFT_LOG"; then
  fail "the replace must not probe for the table it replaces unconditionally"
fi

# What nft refused is the only thing that explains a failed rebuild. It used to
# go to whatever the caller's stderr happened to be, which for a service module
# is nowhere, so the reload reported a failure with no reason at all.
: > "$LOGGER_LOG"
if NFT_TRANSACTION_FAIL=1 \
  FORKOP_UCI_STATE_FILE="$WORK_DIR/runtime-base-uci.state" \
  FORKOP_RT_TABLES="$WORK_DIR/rt_tables" \
  IP_ROUTE_OUTPUT='local default dev lo scope host' \
  IP_ROUTE6_OUTPUT='local default dev lo metric 1024 pref medium' \
  IP_RULE_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup forkop' \
  IP_RULE6_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup forkop' \
  nft_ucode nft-rebuild-runtime-from-uci 2>/dev/null; then
  fail "a refused transaction must fail the rebuild"
fi
assert_contains "$LOGGER_LOG" "[fatal] nft refused the ruleset: Error: syntax error, unexpected junk" \
  "a refused transaction must be logged with the reason nft gave"

: > "$NFT_LOG"
nft_ucode nft-create-fakeip-output-rules ForkopTable 0x00100000 198.18.0.0/15 fc00::/18
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle_output\tip\tdaddr\t198.18.0.0/15\tmeta\tl4proto\ttcp\tmeta\tmark\tset\t0x00100000\tcounter' "runtime output fakeip tcp"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle_output\tip\tdaddr\t198.18.0.0/15\tmeta\tl4proto\tudp\tmeta\tmark\tset\t0x00100000\tcounter' "runtime output fakeip udp"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle_output\tip6\tdaddr\tfc00::/18\tmeta\tl4proto\ttcp\tmeta\tmark\tset\t0x00100000\tcounter' "runtime output fakeip6 tcp"
assert_eq "4" "$(grep -c mangle_output "$NFT_LOG")" "the router's own FakeIP traffic is the whole of it"

: > "$NFT_LOG"
# nft/state.uc owns the question, because the reload path, the readiness poll and
# the UI status refresh all ask it. Terse: whether the table exists is the whole
# question, and printing every element of every set to answer it costs seconds on
# a real rule set.
table_present() {
  ucode -L "$FORKOP_LIB" -e '
    print(require("nft.state").table_present(ARGV[0]) ? "yes" : "no", "\n");
  ' -- "$1"
}
assert_eq "no" \
  "$(NFT_LIST_TABLE_FAIL=1 table_present ForkopTable 2>"$WORK_DIR/nft-table-present.err")" \
  "missing nft table"
[ ! -s "$WORK_DIR/nft-table-present.err" ] ||
  fail "missing nft table predicate must suppress nft stderr"
assert_contains "$NFT_LOG" $'nft\t-t\tlist\ttable\tinet\tForkopTable' "nft table presence check"

cat >"$WORK_DIR/provider-rules.json" <<'JSON'
{
  "section": [
    { ".name": "direct", "enabled": "1", "action": "bypass" },
    { ".name": "zapret_one", "enabled": "1", "action": "zapret" },
    { ".name": "zapret_disabled", "enabled": "0", "action": "zapret" },
    { ".name": "zapret_two", "enabled": "1", "action": "zapret" },
    { ".name": "zapret2_one", "enabled": "1", "action": "zapret2" }
  ]
}
JSON
provider_bin="$WORK_DIR/bin/provider"
printf '#!/usr/bin/env sh\nexit 0\n' >"$provider_bin"
chmod 0755 "$provider_bin"

: > "$NFT_LOG"
nft_ucode nft-create-provider-output-rules-fixture "$WORK_DIR/provider-rules.json" ForkopTable zapret "$provider_bin" 0x01000000 4000 0x40000000 0x20000000
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle_output\tmeta\tmark\t&\t0x40000000\t==\t0x40000000\treturn' "zapret desync return"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle_output\tmeta\tmark\t0x01000001\tmeta\tl4proto\ttcp\tcounter\tqueue\tnum\t4000\tbypass' "zapret first tcp queue rule"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle_output\tmeta\tmark\t0x01000002\tmeta\tl4proto\tudp\tcounter\tqueue\tnum\t4001\tbypass' "zapret second udp queue rule"
if grep -Fq 'zapret_disabled' "$NFT_LOG"; then
  fail "disabled provider section should not create nft rule"
fi

: > "$NFT_LOG"
nft_ucode nft-create-provider-output-rules-fixture "$WORK_DIR/provider-rules.json" ForkopTable zapret "$WORK_DIR/bin/missing-provider" 0x01000000 4000 0x40000000 0x20000000
if [ -s "$NFT_LOG" ]; then
  fail "missing provider binary should skip provider nft output rules"
fi

cat >"$WORK_DIR/priority-rules.json" <<'JSON'
{
  "section": [
    {
      ".name": "bypass_first",
      ".type": "section",
      "enabled": "1",
      "action": "bypass",
      "ip_cidr": [ "198.51.100.0/24" ],
      "fully_routed_ips": [ "192.168.1.10/32", "2001:db8::10/128", "@system" ]
    },
    {
      ".name": "wide_proxy",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "ip_cidr": [ "0.0.0.0/0" ],
      "fully_routed_ips": [ "192.168.1.20/32", "2001:db8::20/128", "@system" ]
    },
    {
      ".name": "port_bypass",
      ".type": "section",
      "enabled": "1",
      "action": "bypass",
      "ports": [ "8443" ]
    },
    {
      ".name": "system_filter",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "ip_cidr": [ "203.0.113.0/24" ],
      "source_ip_cidr": [ "@system" ]
    },
    {
      ".name": "client_filter",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "ip_cidr": [ "192.0.2.0/24" ],
      "source_ip_cidr": [ "192.168.1.50/32" ]
    },
    {
      ".name": "builtin_subnets",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "community_lists": [ "discord" ]
    },
    {
      ".name": "ip_and_ports",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "ip_cidr": [ "203.0.113.0/24" ],
      "ports": [ "8080" ]
    }
  ]
}
JSON

: > "$NFT_LOG"
nft_ucode nft-add-section-priority-rules-fixture "$WORK_DIR/priority-rules.json" ForkopTable forkop_interfaces localv4 localv6 0x00100000
assert_contains "$NFT_LOG" $'nft\tadd\tset\tinet\tForkopTable\tforkop_rule_bypass_first_subnets\t{ type ipv4_addr; flags interval; auto-merge; }' "bypass priority subnet set"
assert_contains "$NFT_LOG" $'nft\tadd\tset\tinet\tForkopTable\tforkop_rule_wide_proxy_subnets\t{ type ipv4_addr; flags interval; auto-merge; }' "proxy priority subnet set"
assert_contains "$NFT_LOG" $'nft\tadd\tset\tinet\tForkopTable\tforkop_rule_bypass_first_fully_sources\t{ type ipv4_addr; flags interval; auto-merge; }' "bypass fully routed source set"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tpriority_rules\tiifname\t@forkop_interfaces\tip\tsaddr\t@forkop_rule_bypass_first_fully_sources\tip\tdaddr\t!=\t@localv4\tip\tdaddr\t!=\t198.18.0.0/15\tcounter\taccept' "bypass fully routed real IP fast path"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tpriority_rules\tiifname\t@forkop_interfaces\tip6\tsaddr\t@forkop_rule_bypass_first_fully_sources6\tip6\tdaddr\t!=\t@localv6\tip6\tdaddr\t!=\tfc00::/18\tcounter\taccept' "bypass fully routed6 real IP fast path"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tpriority_rules\tiifname\t@forkop_interfaces\tip\tsaddr\t@forkop_rule_wide_proxy_fully_sources\tip\tdaddr\t!=\t@localv4\tmeta\tl4proto\ttcp\tmeta\tmark\tset\t0x00100000\tcounter\taccept' "proxy fully routed capture path"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tpriority_output_rules\tip\tdaddr\t!=\t@localv4\tip\tdaddr\t!=\t198.18.0.0/15\tcounter\taccept' "System fully routed bypass real-IP path"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tpriority_output_rules\tip\tdaddr\t!=\t@localv4\tmeta\tl4proto\ttcp\tmeta\tmark\tset\t0x00100000\tcounter\taccept' "System fully routed proxy capture path"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tpriority_output_rules\tip\tdaddr\t!=\t@localv4\tip\tdaddr\t@forkop_rule_system_filter_subnets\tmeta\tmark\tset\t0x00100000\tcounter\taccept' "System device filter applies to local output"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tpriority_rules\tiifname\t@forkop_interfaces\tip\tsaddr\t@forkop_rule_client_filter_sources\tip\tdaddr\t!=\t@localv4\tip\tdaddr\t@forkop_rule_client_filter_subnets\tmeta\tmark\tset\t0x00100000\tcounter\taccept' "ordinary device filter stays on forwarded traffic"
if grep -F $'priority_rules\tiifname\t@forkop_interfaces' "$NFT_LOG" | grep -Fq 'forkop_rule_system_filter'; then
  fail "System-only device filter must not match forwarded traffic"
fi
if grep -F $'priority_output_rules' "$NFT_LOG" | grep -Fq 'forkop_rule_client_filter'; then
  fail "ordinary device filter must not match local output"
fi
if grep -Fq '@system' "$NFT_LOG"; then
  fail "System sentinel must not be emitted into nft rules or sets"
fi
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tpriority_rules\tiifname\t@forkop_interfaces\tip\tdaddr\t!=\t@localv4\tip\tdaddr\t!=\t198.18.0.0/15\tip\tdaddr\t@forkop_rule_bypass_first_subnets\tcounter\taccept' "bypass priority accept rule"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tpriority_rules\tiifname\t@forkop_interfaces\tip\tdaddr\t!=\t@localv4\tip\tdaddr\t@forkop_rule_wide_proxy_subnets\tmeta\tmark\tset\t0x00100000\tcounter\taccept' "proxy priority capture rule"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tpriority_rules\tiifname\t@forkop_interfaces\tip\tdaddr\t!=\t@localv4\tip\tdaddr\t!=\t198.18.0.0/15\ttcp\tdport\t@forkop_rule_port_bypass_ports\tcounter\taccept' "port-only bypass priority rule"
assert_line_before "$NFT_LOG" \
  $'nft\tadd\trule\tinet\tForkopTable\tpriority_rules\tiifname\t@forkop_interfaces\tip\tdaddr\t!=\t@localv4\tip\tdaddr\t!=\t198.18.0.0/15\tip\tdaddr\t@forkop_rule_bypass_first_subnets\tcounter\taccept' \
  $'nft\tadd\trule\tinet\tForkopTable\tpriority_rules\tiifname\t@forkop_interfaces\tip\tdaddr\t!=\t@localv4\tip\tdaddr\t@forkop_rule_wide_proxy_subnets\tmeta\tmark\tset\t0x00100000\tcounter\taccept' \
  "bypass priority order"
assert_line_before "$NFT_LOG" \
  $'nft\tadd\trule\tinet\tForkopTable\tpriority_rules\tiifname\t@forkop_interfaces\tip\tsaddr\t@forkop_rule_bypass_first_fully_sources\tip\tdaddr\t!=\t@localv4\tip\tdaddr\t!=\t198.18.0.0/15\tcounter\taccept' \
  $'nft\tadd\trule\tinet\tForkopTable\tpriority_rules\tiifname\t@forkop_interfaces\tip\tsaddr\t@forkop_rule_wide_proxy_fully_sources\tip\tdaddr\t!=\t@localv4\tmeta\tl4proto\ttcp\tmeta\tmark\tset\t0x00100000\tcounter\taccept' \
  "fully routed section order"

# A built-in list can carry addresses constrained to ports, which is what the
# core exports as scoped groups and what the rule-set sync worker writes into the
# ip-port sets. The rules that read those sets used to be built only for a custom
# rule set, so a built-in list's port-constrained addresses were loaded into a set
# nothing matched.
assert_contains "$NFT_LOG" $'nft\tadd\tset\tinet\tForkopTable\tforkop_rule_builtin_subnets_ip_ports\t{ type ipv4_addr . inet_service; flags interval; auto-merge; }' "built-in subnet list ip-port set"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tpriority_rules\tiifname\t@forkop_interfaces\tip\tdaddr\t!=\t@localv4\tip\tdaddr\t.\tudp\tdport\t@forkop_rule_builtin_subnets_ip_ports\tmeta\tmark\tset\t0x00100000\tcounter\taccept' "built-in subnet list ip-port rule"

# A rule set can also limit addresses to one transport. A set of address and port
# pairs cannot say which, because the pair of rules that reads it matches both,
# so those addresses carry the transport in the set key and one rule covers them.
assert_contains "$NFT_LOG" $'nft\tadd\tset\tinet\tForkopTable\tforkop_rule_builtin_subnets_proto_ports\t{ type ipv4_addr . inet_proto . inet_service; flags interval; auto-merge; }' "transport-scoped set"
assert_contains "$NFT_LOG" $'nft\tadd\tset\tinet\tForkopTable\tforkop_rule_builtin_subnets_proto6_ports\t{ type ipv6_addr . inet_proto . inet_service; flags interval; auto-merge; }' "transport-scoped set6"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tpriority_rules\tiifname\t@forkop_interfaces\tip\tdaddr\t!=\t@localv4\tip\tdaddr\t.\tmeta\tl4proto\t.\tth\tdport\t@forkop_rule_builtin_subnets_proto_ports\tmeta\tmark\tset\t0x00100000\tcounter\taccept' "transport-scoped rule"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tpriority_output_rules\tip6\tdaddr\t!=\t@localv6\tip6\tdaddr\t.\tmeta\tl4proto\t.\tth\tdport\t@forkop_rule_builtin_subnets_proto6_ports\tmeta\tmark\tset\t0x00100000\tcounter\taccept' "transport-scoped output rule6"
assert_eq "2" \
  "$(grep -Fc $'th\tdport\t@forkop_rule_builtin_subnets_proto_ports' "$NFT_LOG")" \
  "one rule per chain covers both transports"

# A port next to an address is a condition on that address: the pair goes into
# the ip-port set and is matched together. A section that also matched the port
# on its own would claim every address on it, which is not what it selects.
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tpriority_rules\tiifname\t@forkop_interfaces\tip\tdaddr\t!=\t@localv4\tip\tdaddr\t.\ttcp\tdport\t@forkop_rule_ip_and_ports_ip_ports\tmeta\tmark\tset\t0x00100000\tcounter\taccept' "an address with a port is matched as a pair"
if grep -Fq $'dport\t@forkop_rule_ip_and_ports_ports' "$NFT_LOG"; then
  fail "a section that selects addresses must not also match its ports on their own"
fi

# Which sets a section owns is decided once, in nft/sections.uc, and the rule-set
# sync worker flushes exactly those. A set no rule reads is a kernel object per
# section that nothing can ever match, and there were five of them.
for absent in \
  forkop_rule_port_bypass_subnets \
  forkop_rule_port_bypass_sources \
  forkop_rule_port_bypass_fully_sources \
  forkop_rule_bypass_first_ports \
  forkop_rule_bypass_first_sources \
  forkop_rule_client_filter_fully_sources \
  forkop_rule_system_filter_sources \
  forkop_rule_ip_and_ports_ports \
  forkop_rule_ip_and_ports_subnets \
  forkop_rule_ip_and_ports_proto_ports \
  forkop_rule_bypass_first_proto_ports \
  forkop_rule_builtin_subnets_ports; do
  if grep -Fq $'\tadd\tset\tinet\tForkopTable\t'"$absent"$'\t' "$NFT_LOG"; then
    fail "no rule reads $absent, so it must not be created"
  fi
done
for present in \
  forkop_rule_bypass_first_subnets \
  forkop_rule_bypass_first_fully_sources \
  forkop_rule_port_bypass_ports \
  forkop_rule_client_filter_sources \
  forkop_rule_client_filter_subnets; do
  assert_contains "$NFT_LOG" $'\tadd\tset\tinet\tForkopTable\t'"$present"$'\t' "$present must be created"
done

: > "$IP_LOG"
: > "$LOGGER_LOG"
rt_tables="$WORK_DIR/rt_tables"
IP_ROUTE_LIST_FAIL=1 IP_ROUTE6_LIST_FAIL=1 IP_RULE_OUTPUT='' IP_RULE6_OUTPUT='' \
  nft_ucode ensure-tproxy-route-rule forkop 0x00100000 "$rt_tables" 2>"$WORK_DIR/tproxy-route-check.err"
[ ! -s "$WORK_DIR/tproxy-route-check.err" ] ||
  fail "missing tproxy route table predicates must suppress ip stderr"
assert_contains "$rt_tables" "105 forkop" "tproxy route table registry"
assert_contains "$IP_LOG" $'ip\troute\tadd\tlocal\t0.0.0.0/0\tdev\tlo\ttable\tforkop' "tproxy route add"
assert_contains "$IP_LOG" $'ip\t-6\troute\tadd\tlocal\t::/0\tdev\tlo\ttable\tforkop' "tproxy route6 add"
assert_contains "$IP_LOG" $'ip\t-4\trule\tadd\tfwmark\t0x00100000/0x00100000\ttable\tforkop\tpriority\t105' "tproxy marking rule add"
assert_contains "$IP_LOG" $'ip\t-6\trule\tadd\tfwmark\t0x00100000/0x00100000\ttable\tforkop\tpriority\t105' "tproxy marking rule6 add"
assert_contains "$LOGGER_LOG" "[debug] Added IPv4 tproxy route" "tproxy route creation log"
assert_contains "$LOGGER_LOG" "[debug] Added IPv6 tproxy route" "tproxy route6 creation log"
assert_contains "$LOGGER_LOG" "[debug] Creating IPv4 tproxy marking rule" "tproxy marking rule creation log"
assert_contains "$LOGGER_LOG" "[debug] Creating IPv6 tproxy marking rule" "tproxy marking rule6 creation log"

: > "$IP_LOG"
: > "$LOGGER_LOG"
printf '%s\n' '105 forkop' >"$rt_tables"
IP_ROUTE_OUTPUT='local default dev lo scope host' \
  IP_ROUTE6_OUTPUT='local default dev lo metric 1024 pref medium' \
  IP_RULE_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup forkop' \
  IP_RULE6_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup forkop' \
  nft_ucode ensure-tproxy-route-rule forkop 0x00100000 "$rt_tables"
if grep -Fq $'\tadd\t' "$IP_LOG"; then
  fail "existing tproxy route/rule should not be added again"
fi
# The absence of an `ip ... add` above is the check. Reporting four times that
# nothing needed doing is what made replacing the table take seven log lines to
# say one thing, so a run that changes nothing says nothing.
[ ! -s "$LOGGER_LOG" ] ||
  fail "an already configured tproxy route and rule must not be reported"
# The routing state predicates are nft/state.uc's, so they are asked of it
# directly: routing them through a pass-through mode of nft/apply.uc only put a
# second name on the same answer.
route_rule_present() {
  ucode -L "$FORKOP_LIB" -e '
    print(require("nft.state").tproxy_route_rule_present(ARGV[0], ARGV[1]) ? "yes" : "no", "\n");
  ' -- "$1" "$2"
}
assert_eq "yes" \
  "$(IP_ROUTE_OUTPUT='local default dev lo scope host' \
    IP_ROUTE6_OUTPUT='local default dev lo metric 1024 pref medium' \
    IP_RULE_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup forkop' \
    IP_RULE6_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup forkop' \
    route_rule_present forkop 0x00100000)" \
  "configured tproxy route and rule"
assert_eq "no" \
  "$(IP_ROUTE_OUTPUT='local default dev lo scope host' \
    IP_ROUTE6_OUTPUT='local default dev lo metric 1024 pref medium' \
    IP_RULE_OUTPUT='105: from all fwmark 0x200000/0x200000 lookup forkop' \
    IP_RULE6_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup forkop' \
    route_rule_present forkop 0x00100000)" \
  "tproxy route/rule presence requires the Forkop fwmark"
# Another package can register the same table id in /etc/iproute2/rt_tables, so
# iproute2 may print a foreign name for the Forkop table. The rule list is
# already scoped to the table, so the Forkop rule must still be recognized.
: > "$IP_LOG"
assert_eq "yes" \
  "$(IP_ROUTE_OUTPUT='local default dev lo scope host' \
    IP_ROUTE6_OUTPUT='local default dev lo metric 1024 pref medium' \
    IP_RULE_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup podkop' \
    IP_RULE6_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup podkop' \
    route_rule_present forkop 0x00100000)" \
  "tproxy rule presence must not depend on the printed table name"
assert_contains "$IP_LOG" $'ip\t-4\trule\tlist\ttable\tforkop' "tproxy marking rule query is table scoped"
assert_contains "$IP_LOG" $'ip\t-6\trule\tlist\ttable\tforkop' "tproxy marking rule6 query is table scoped"

: > "$SYSCTL_LOG"
: > "$LOGGER_LOG"
LSMOD_OUTPUT='br_netfilter 32768 0' SYSCTL_BRIDGE_NF_CALL_IPTABLES=1 nft_ucode ensure-bridge-netfilter-disabled
assert_contains "$SYSCTL_LOG" $'sysctl\t-n\tnet.bridge.bridge-nf-call-iptables' "bridge netfilter sysctl check"
assert_contains "$SYSCTL_LOG" $'sysctl\t-w\tnet.bridge.bridge-nf-call-iptables=0' "bridge netfilter ipv4 disable"
assert_contains "$SYSCTL_LOG" $'sysctl\t-w\tnet.bridge.bridge-nf-call-ip6tables=0' "bridge netfilter ipv6 disable"
assert_contains "$LOGGER_LOG" "[debug] br_netfilter is enabled; disabling it for transparent proxy routing" "bridge netfilter disable log"

: > "$SYSCTL_LOG"
LSMOD_OUTPUT='' SYSCTL_BRIDGE_NF_CALL_IPTABLES=1 nft_ucode ensure-bridge-netfilter-disabled
if [ -s "$SYSCTL_LOG" ]; then
  fail "bridge netfilter absent should not call sysctl"
fi

cat >"$WORK_DIR/populate-fixture.json" <<'JSON'
{
  "section": [
    {
      ".name": "disabled",
      ".type": "section",
      "enabled": "0",
      "action": "proxy",
      "ip_cidr": [ "192.0.2.1" ],
      "ports": [ "53" ],
      "fully_routed_ips": [ "192.168.1.50/32" ]
    },
    {
      ".name": "deferred",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "ip_cidr": [ "192.0.2.2" ],
      "ports": [ "54" ],
      "fully_routed_ips": [ "192.168.1.51/32" ]
    },
    {
      ".name": "inline",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "ip_cidr": [ "198.51.100.1", "203.0.113.0/24", "2001:db8::1" ],
      "source_ip_cidr": [ "192.168.1.60/32" ],
      "ports": [ "80", "443-444" ],
      "fully_routed_ips": [ "192.168.1.20/32", "192.168.1.20/32", "2001:db8::20/128", "@system" ]
    },
    {
      ".name": "inline_no_ports",
      ".type": "section",
      "enabled": "1",
      "action": "bypass",
      "ip_cidr": [ "198.51.100.200", "2001:db8::200" ],
      "fully_routed_ips": [ "192.168.1.21/32", "2001:db8::21/128" ]
    },
    {
      ".name": "ports_only",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "ports": [ "53", "853" ],
      "ports_text": "5353, 853"
    },
    {
      ".name": "ports_with_domain",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "domain_suffix": [ "example.org" ],
      "source_ip_cidr": [ "192.168.1.22/32", "2001:db8::22/128", "@system" ],
      "ports": [ "8443" ]
    },
    {
      ".name": "dns_only",
      ".type": "section",
      "enabled": "1",
      "action": "dns",
      "domain_suffix": [ "dns-only.example" ],
      "ip_cidr": [ "192.0.2.53" ],
      "source_ip_cidr": [ "192.168.1.54/32" ],
      "ports": [ "5353" ],
      "fully_routed_ips": [ "192.168.1.53/32" ]
    }
  ]
}
JSON

: > "$NFT_LOG"
nft_ucode nft-populate-runtime-sets-fixture "$WORK_DIR/populate-fixture.json" 1 "deferred" ForkopTable
assert_contains "$NFT_LOG" $'198.51.100.1 . 80,198.51.100.1 . 443-444,203.0.113.0/24 . 80' "populate inline ip-port first chunk"
assert_contains "$NFT_LOG" $'203.0.113.0/24 . 443-444' "populate inline ip-port second chunk"
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_rule_inline_ip_ports\t{ 198.51.100.1 . 80,198.51.100.1 . 443-444,203.0.113.0/24 . 80,203.0.113.0/24 . 443-444 }' "populate inline priority ip-port set"
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_rule_inline_ip6_ports\t{ 2001:db8::1 . 80,2001:db8::1 . 443-444 }' "populate inline priority ip6-port set"
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_rule_inline_no_ports_subnets\t{ 198.51.100.200 }' "populate inline ip without ports"
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_rule_inline_no_ports_subnets6\t{ 2001:db8::200 }' "populate inline ip6 without ports"
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_rule_ports_only_ports\t{ 53,853,5353 }' "populate ports-only set"
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_rule_inline_fully_sources\t{ 192.168.1.20/32 }' "populate fully routed source set"
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_rule_inline_fully_sources6\t{ 2001:db8::20/128 }' "populate fully routed6 source set"
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_rule_inline_no_ports_fully_sources\t{ 192.168.1.21/32 }' "populate bypass fully routed source set"
assert_contains "$NFT_LOG" $'nft\tadd\tchain\tinet\tForkopTable\tsystem_dns_redirect\t{ type nat hook output priority -151; policy accept; }' "System DNS output redirect chain"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tsystem_dns_redirect\tmeta\tmark\t!=\t0\treturn' "System DNS keeps sing-box outbounds out of the redirect"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tsystem_dns_redirect\tip\tdaddr\t127.0.0.0/8\treturn' "the router talking to its own resolver stays out of the capture"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tsystem_dns_redirect\tip6\tdaddr\t::1\treturn' "the router talking to its own resolver stays out of the capture over IPv6"
assert_line_before "$NFT_LOG" $'system_dns_redirect\tip\tdaddr\t127.0.0.0/8\treturn' $'system_dns_redirect\tudp\tdport\t53' "loopback leaves the system capture before anything is redirected"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tsystem_dns_redirect\tudp\tdport\t53\tcounter\tredirect\tto\t:1605' "System DNS redirect"
if grep -Fq '@system' "$NFT_LOG"; then
  fail "System sentinel must not be emitted into nft sets"
fi
if grep -Fq $'nft\tinsert\trule' "$NFT_LOG"; then
  fail "fully routed sources should use ordered priority sets"
fi
if grep -Fq '192.0.2.1' "$NFT_LOG"; then
  fail "disabled section should not populate nft"
fi
if grep -Fq '192.0.2.2' "$NFT_LOG"; then
  fail "deferred section should not populate nft"
fi
if grep -Fq $'nft\tadd\telement\tinet\tForkopTable\tforkop_rule_ports_with_domain_ports\t{ 8443 }' "$NFT_LOG"; then
  fail "ports with destination matchers should not populate global port set"
fi
if grep -Fq '192.0.2.53' "$NFT_LOG" || grep -Fq 'forkop_rule_dns_only' "$NFT_LOG"; then
  fail "DNS action should only populate the shared source-aware DNS set"
fi

# A section that fully routes the System device makes the router's resolver
# traffic follow the section, whatever its action - the capture must come with
# it or the router is left asking the provider resolver through the tunnel.
cat >"$WORK_DIR/system-proxy-fixture.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings" },
  "section": [
    {
      ".name": "vpn",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "fully_routed_ips": [ "@system" ]
    }
  ]
}
JSON
: > "$NFT_LOG"
nft_ucode nft-populate-runtime-sets-fixture "$WORK_DIR/system-proxy-fixture.json" 1 "" ForkopTable
assert_contains "$NFT_LOG" $'nft\tadd\tchain\tinet\tForkopTable\tsystem_dns_redirect\t{ type nat hook output priority -151; policy accept; }' "a fully routed System proxy captures the router DNS"

# Excluded devices are ignored by every capture path: the client DNS redirect
# and the mangle marking both return their traffic before touching it.
: > "$NFT_LOG"
nft_ucode nft-create-runtime-base ForkopTable localv4 forkop_interfaces "br-lan" 0x00100000 0x00200000 198.18.0.0/15 1602 0 localv6 fc00::/18 ::1 "192.168.1.50 2001:db8::5/128"
assert_contains "$NFT_LOG" $'nft\tadd\tset\tinet\tForkopTable\tforkop_excluded\t{ type ipv4_addr; flags interval; auto-merge; }' "excluded device set"
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_excluded\t{ 192.168.1.50 }' "excluded device address"
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_excluded6\t{ 2001:db8::5/128 }' "excluded IPv6 device address"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tdns_redirect\tip\tsaddr\t@forkop_excluded\tcounter\treturn' "excluded devices keep their own DNS"
assert_line_before "$NFT_LOG" $'dns_redirect\tip\tsaddr\t@forkop_excluded\tcounter\treturn' $'dns_redirect\tiifname\t@forkop_interfaces\ttcp\tdport\t53' "the DNS exclusion comes before the redirect"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle\tip\tsaddr\t@forkop_excluded\tcounter\treturn' "excluded devices leave the traffic capture"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle\tip6\tsaddr\t@forkop_excluded6\tcounter\treturn' "excluded IPv6 devices leave the traffic capture"
assert_line_before "$NFT_LOG" $'mangle\tip\tsaddr\t@forkop_excluded\tcounter\treturn' $'mangle\tjump\tpriority_rules' "the exclusion comes before any section rule can match"

# Without the list neither the sets nor the return rules exist.
: > "$NFT_LOG"
nft_ucode nft-create-runtime-base ForkopTable localv4 forkop_interfaces "br-lan" 0x00100000 0x00200000 198.18.0.0/15 1602 0 localv6 fc00::/18 ::1 ""
if grep -Fq 'forkop_excluded' "$NFT_LOG"; then
  fail "an empty exclusion list must not create sets or rules"
fi
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tdns_redirect\tiifname\t@forkop_interfaces\tudp\tdport\t53\tcounter\tredirect\tto\t:1603' "the client DNS capture is unconditional"

# The nft signature is a hash of the ruleset the builders would produce, so what
# it answers is "would the table come out different". These pin that: creating a
# section that contributes no nft rule used to move the signature and tear the
# whole table down for nothing.
nft_signature() {
  printf '%s' "$1" > "$WORK_DIR/sig.json"
  nft_ucode nft-runtime-signature-fixture "$WORK_DIR/sig.json"
}

SIG_SETTINGS='"settings":{"source_network_interfaces":"br-lan"}'
sig_baseline="$(nft_signature "{$SIG_SETTINGS,\"section\":[]}")"
[ -n "$sig_baseline" ] || fail "the nft signature must be computable"
assert_eq "$sig_baseline" "$(nft_signature "{$SIG_SETTINGS,\"section\":[]}")" \
  "the nft signature is the same for the same configuration"

assert_unchanged_signature() {
  local label="$1" config="$2"
  assert_eq "$sig_baseline" "$(nft_signature "$config")" "$label must not move the nft signature"
}

assert_changed_signature() {
  local label="$1" config="$2" actual
  actual="$(nft_signature "$config")"
  [ -n "$actual" ] || fail "$label: the nft signature must be computable"
  [ "$actual" != "$sig_baseline" ] || fail "$label must move the nft signature"
}

# Nothing here reaches nft: domains, keywords and rule sets without subnets are
# matched by sing-box, and a section with no nft matcher at all contributes no
# rule and no set.
assert_unchanged_signature "an empty section" \
  "{$SIG_SETTINGS,\"section\":[{\".name\":\"s\",\"enabled\":\"1\",\"action\":\"proxy\"}]}"
assert_unchanged_signature "a section carrying only domains" \
  "{$SIG_SETTINGS,\"section\":[{\".name\":\"s\",\"enabled\":\"1\",\"action\":\"proxy\",\"domain_suffix_text\":\"a.example\nb.example\"}]}"
assert_unchanged_signature "a renamed section label" \
  "{$SIG_SETTINGS,\"section\":[{\".name\":\"s\",\"enabled\":\"1\",\"action\":\"proxy\",\"label\":\"Renamed\"}]}"
assert_unchanged_signature "a disabled section with IP matchers" \
  "{$SIG_SETTINGS,\"section\":[{\".name\":\"s\",\"enabled\":\"0\",\"action\":\"proxy\",\"ip_cidr\":\"192.0.2.0/24\"}]}"
assert_unchanged_signature "a domain-only rule set" \
  "{$SIG_SETTINGS,\"section\":[{\".name\":\"s\",\"enabled\":\"1\",\"action\":\"proxy\",\"rule_set\":\"https://example.com/domains.lst\"}]}"

# These all reach nft, and each one has to be seen.
assert_changed_signature "an inline IP matcher" \
  "{$SIG_SETTINGS,\"section\":[{\".name\":\"s\",\"enabled\":\"1\",\"action\":\"proxy\",\"ip_cidr\":\"192.0.2.0/24\"}]}"
assert_changed_signature "a port matcher" \
  "{$SIG_SETTINGS,\"section\":[{\".name\":\"s\",\"enabled\":\"1\",\"action\":\"proxy\",\"ports\":\"443\"}]}"
assert_changed_signature "a rule set importing subnets" \
  "{$SIG_SETTINGS,\"section\":[{\".name\":\"s\",\"enabled\":\"1\",\"action\":\"proxy\",\"rule_set_with_subnets\":\"https://example.com/subnets.srs\"}]}"
assert_changed_signature "a community list carrying subnets" \
  "{$SIG_SETTINGS,\"section\":[{\".name\":\"s\",\"enabled\":\"1\",\"action\":\"proxy\",\"community_lists\":\"telegram\"}]}"
assert_changed_signature "fully routed devices" \
  "{$SIG_SETTINGS,\"section\":[{\".name\":\"s\",\"enabled\":\"1\",\"action\":\"bypass\",\"fully_routed_ips\":\"192.168.1.10/32\"}]}"
assert_changed_signature "the NTP exclusion" \
  "{\"settings\":{\"source_network_interfaces\":\"br-lan\",\"exclude_ntp\":\"1\"},\"section\":[]}"
assert_changed_signature "another source interface" \
  "{\"settings\":{\"source_network_interfaces\":\"br-lan tun0\"},\"section\":[]}"

# The elements are part of the table too, so their contents have to be seen and
# not just their presence.
sig_one_subnet="$(nft_signature "{$SIG_SETTINGS,\"section\":[{\".name\":\"s\",\"enabled\":\"1\",\"action\":\"proxy\",\"ip_cidr\":\"192.0.2.0/24\"}]}")"
sig_other_subnet="$(nft_signature "{$SIG_SETTINGS,\"section\":[{\".name\":\"s\",\"enabled\":\"1\",\"action\":\"proxy\",\"ip_cidr\":\"198.51.100.0/24\"}]}")"
[ "$sig_one_subnet" != "$sig_other_subnet" ] ||
  fail "a different IP list must move the nft signature"

# Hashing the ruleset must not apply it or report as if it had.
: > "$NFT_LOG"
: > "$LOGGER_LOG"
nft_signature "{$SIG_SETTINGS,\"section\":[{\".name\":\"s\",\"enabled\":\"1\",\"action\":\"proxy\",\"ip_cidr\":\"192.0.2.0/24\"}]}" >/dev/null
[ ! -s "$NFT_LOG" ] || fail "computing the nft signature must not touch nft"
[ ! -s "$LOGGER_LOG" ] || fail "computing the nft signature must not log as if it applied anything"

: > "$NFT_LOG"
nft_ucode nft-populate-runtime-sets-fixture "$WORK_DIR/populate-fixture.json" 0 "" ForkopTable
[ ! -s "$NFT_LOG" ] || fail "disabled nft population should not call nft"

# The rebuild entry point takes no arguments: the routing table, the nft table, its
# sets, the marks, the FakeIP ranges and each provider's binary, mark base and queue
# base are constants a caller could only have read from the same tables. Every one of
# them is overridden here, so a name resolved through the wrong key cannot pass - it
# would leave the default in the rules the fake nft records, which is what the last
# check refuses.
cat >"$WORK_DIR/rebuild-uci.state" <<'EOF_UCI'
forkop.settings=settings
forkop.settings.source_network_interfaces=br-lan
forkop.zapret_one=section
forkop.zapret_one.enabled=1
forkop.zapret_one.action=zapret
forkop.zapret2_one=section
forkop.zapret2_one.enabled=1
forkop.zapret2_one.action=zapret2
EOF_UCI
: > "$WORK_DIR/rebuild-rt_tables"
: > "$NFT_LOG"
: > "$IP_LOG"
FORKOP_UCI_STATE_FILE="$WORK_DIR/rebuild-uci.state" \
  FORKOP_RT_TABLES="$WORK_DIR/rebuild-rt_tables" \
  RT_TABLE_NAME=rebuild_route \
  NFT_TABLE_NAME=RebuildTable \
  NFT_LOCALV4_SET_NAME=rebuild_localv4 \
  NFT_LOCALV6_SET_NAME=rebuild_localv6 \
  NFT_INTERFACE_SET_NAME=rebuild_interfaces \
  NFT_FAKEIP_MARK=0x00100000 \
  NFT_OUTBOUND_MARK=0x00200000 \
  SB_FAKEIP_INET4_RANGE=192.0.2.0/24 \
  SB_FAKEIP_INET6_RANGE=fd00:2::/32 \
  SB_TPROXY_INBOUND_PORT=1699 \
  SB_TPROXY_INBOUND6_ADDRESS=fd00::1 \
  ZAPRET_PROVIDER_NFQWS_BIN="$provider_bin" \
  ZAPRET_ROUTE_MARK_BASE=0x03000000 \
  ZAPRET_QUEUE_BASE=4100 \
  ZAPRET_DESYNC_MARK=0x40000000 \
  ZAPRET_DESYNC_MARK_POSTNAT=0x20000000 \
  ZAPRET2_PROVIDER_NFQWS2_BIN="$provider_bin" \
  ZAPRET2_ROUTE_MARK_BASE=0x05000000 \
  ZAPRET2_QUEUE_BASE=4500 \
  ZAPRET2_DESYNC_MARK=0x50000000 \
  ZAPRET2_DESYNC_MARK_POSTNAT=0x60000000 \
  nft_ucode nft-rebuild-runtime-from-uci ||
  fail "nft runtime rebuild from UCI failed"
assert_line_before "$NFT_LOG" \
  $'nft\tdelete\ttable\tinet\tRebuildTable' \
  $'nft\tadd\ttable\tinet\tRebuildTable' \
  "rebuild drops the live table before it builds the new one"
assert_contains "$NFT_LOG" $'nft\tadd\tset\tinet\tRebuildTable\trebuild_localv4\t{ type ipv4_addr; flags interval; auto-merge; }' "rebuild localv4 set"
assert_contains "$NFT_LOG" $'nft\tadd\tset\tinet\tRebuildTable\trebuild_localv6\t{ type ipv6_addr; flags interval; auto-merge; }' "rebuild localv6 set"
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tRebuildTable\trebuild_interfaces\t{ br-lan }' "rebuild interface element"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tRebuildTable\tmangle\tiifname\t@rebuild_interfaces\tip\tdaddr\t192.0.2.0/24\tmeta\tl4proto\ttcp\tmeta\tmark\tset\t0x00100000\tcounter' "rebuild FakeIP capture"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tRebuildTable\tmangle\tiifname\t@rebuild_interfaces\tip6\tdaddr\tfd00:2::/32\tmeta\tl4proto\ttcp\tmeta\tmark\tset\t0x00100000\tcounter' "rebuild FakeIP6 capture"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tRebuildTable\tproxy\tmeta\tmark\t&\t0x00100000\t==\t0x00100000\tmeta\tl4proto\ttcp\ttproxy\tip6\tto\t[fd00::1]:1699\tcounter' "rebuild TProxy6 target"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tRebuildTable\tmangle_output\tmeta\tmark\t0x00200000\tcounter\treturn' "rebuild outbound return"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tRebuildTable\tmangle_output\tip\tdaddr\t192.0.2.0/24\tmeta\tl4proto\ttcp\tmeta\tmark\tset\t0x00100000\tcounter' "rebuild output FakeIP rule"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tRebuildTable\tmangle_output\tmeta\tmark\t&\t0x40000000\t==\t0x40000000\treturn' "rebuild zapret desync return"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tRebuildTable\tmangle_output\tmeta\tmark\t0x03000001\tmeta\tl4proto\ttcp\tcounter\tqueue\tnum\t4100\tbypass' "rebuild zapret queue rule"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tRebuildTable\tmangle_output\tmeta\tmark\t&\t0x50000000\t==\t0x50000000\treturn' "rebuild zapret2 desync return"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tRebuildTable\tmangle_output\tmeta\tmark\t0x05000001\tmeta\tl4proto\ttcp\tcounter\tqueue\tnum\t4500\tbypass' "rebuild zapret2 queue rule"
assert_contains "$IP_LOG" $'ip\troute\tadd\tlocal\t0.0.0.0/0\tdev\tlo\ttable\trebuild_route' "rebuild TProxy route"
assert_contains "$IP_LOG" $'ip\t-4\trule\tadd\tfwmark\t0x00100000/0x00100000\ttable\trebuild_route\tpriority\t105' "rebuild TProxy marking rule"
assert_contains "$WORK_DIR/rebuild-rt_tables" '105 rebuild_route' "rebuild route table registration"
for leaked in ForkopTable forkop_interfaces 198.18.0.0/15 fc00::/18 :1602; do
  if grep -Fq "$leaked" "$NFT_LOG"; then
    fail "nft runtime rebuild fell back to the default $leaked instead of the name core/constants.uc holds"
  fi
done

printf 'NFT apply checks passed\n'
