#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
NFT_RUNTIME="$ROOT_DIR/forkop/files/usr/lib/nft/apply.uc"
WORK_DIR="$(mktemp -d)"
NFT_LOG="$WORK_DIR/nft.log"
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
export LOGGER_LOG
export IP_LOG
export SYSCTL_LOG
export FORKOP_IP_BIN="$WORK_DIR/bin/ip"

assert_eq "/tmp/forkop-cache/condition_rule_1_domain_domains" \
  "$(nft_ucode cache-path 1 /tmp/forkop-cache condition rule_1 domain domains)" \
  "cache path"
if nft_ucode cache-path 1 /tmp/forkop-cache condition 'bad-name' domain domains >/dev/null 2>&1; then
  fail "unsafe cache key should fail"
fi

assert_eq "198.51.100.1,203.0.113.0/24" \
  "$(nft_ucode legacy-condition-csv subnets 1 0 $'198.51.100.1\nbad-value\n203.0.113.0/24' '10.0.0.0/8')" \
  "legacy text-mode subnets"
assert_eq "10.0.0.0/8,192.0.2.1" \
  "$(nft_ucode legacy-condition-csv subnets 0 0 '198.51.100.1' '10.0.0.0/8 192.0.2.1')" \
  "legacy list priority"
assert_eq "full:example.com,keyword:ads,regex:^foo" \
  "$(nft_ucode list-value-to-csv 'full:example.com keyword:ads regex:^foo')" \
  "list value csv"
assert_eq "one.example,list.example,legacy.example" \
  "$(nft_ucode rule-condition-csv domain domains 0 0 legacy.example '' 'full:one.example keyword:skip regex:^skip suffix.example' 'full:list.example keyword:list-skip')" \
  "combined domain plus legacy"
assert_eq "suffix.example,list.example" \
  "$(nft_ucode rule-condition-csv domain_suffix domains 0 0 legacy.example legacy-list.example 'full:one.example suffix.example keyword:skip' 'full:list-full.example list.example')" \
  "combined suffix ignores legacy"
assert_eq "xn--80aswg.xn--p1ai" \
  "$(nft_ucode rule-condition-csv domain_suffix domains 0 0 '' '' 'сайт.рф full:пример.испытание keyword:пример regex:^сайт[.]рф$' '')" \
  "combined IDN suffix is punycoded"
assert_eq "xn--e1afmkfd.xn--80akhbyknj4f" \
  "$(nft_ucode rule-condition-csv domain domains 0 0 '' '' 'сайт.рф full:пример.испытание keyword:пример regex:^сайт[.]рф$' '')" \
  "combined IDN full domain is punycoded"
assert_eq "xn--e1afmkfd" \
  "$(nft_ucode rule-condition-csv domain_keyword generic 0 0 '' '' 'сайт.рф full:пример.испытание keyword:пример regex:^сайт[.]рф$' '')" \
  "combined IDN keyword is punycoded"
assert_eq "^xn--80aswg[.]xn--p1ai$" \
  "$(nft_ucode rule-condition-csv domain_regex generic 0 0 '' '' 'сайт.рф full:пример.испытание keyword:пример regex:^сайт[.]рф$' '')" \
  "combined IDN regex is punycoded"

nft_ucode nft-create-runtime-base ForkopTable localv4 forkop_subnets forkop_ports forkop_ip_ports forkop_interfaces "br-lan tun0" 0x00100000 0x00200000 198.18.0.0/15 1602 1
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
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle\tiifname\t@forkop_interfaces\tip\tdaddr\t@forkop_subnets\tmeta\tl4proto\ttcp\tmeta\tmark\tset\t0x00100000\tcounter' "runtime common tcp rule"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle\tiifname\t@forkop_interfaces\tip6\tdaddr\t@forkop_subnets6\tmeta\tl4proto\ttcp\tmeta\tmark\tset\t0x00100000\tcounter' "runtime common6 tcp rule"
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
: > "$NFT_LOG"
FORKOP_UCI_STATE_FILE="$WORK_DIR/runtime-base-uci.state" \
  nft_ucode nft-create-runtime-base-from-uci ForkopTable localv4 forkop_subnets forkop_ports forkop_ip_ports forkop_interfaces 0x00100000 0x00200000 198.18.0.0/15 1602
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_interfaces\t{ br-lan }' "runtime base from UCI br-lan interface"
assert_contains "$NFT_LOG" $'nft\tadd\telement\tinet\tForkopTable\tforkop_interfaces\t{ tun0 }' "runtime base from UCI tun0 interface"
assert_contains "$NFT_LOG" $'nft\tinsert\trule\tinet\tForkopTable\tmangle\tudp\tdport\t123\treturn' "runtime base from UCI ntp exclusion"

: > "$NFT_LOG"
nft_ucode nft-create-runtime-output-rules ForkopTable forkop_subnets forkop_ports forkop_ip_ports 0x00100000 198.18.0.0/15
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle_output\tip\tdaddr\t@forkop_subnets\tmeta\tl4proto\ttcp\tmeta\tmark\tset\t0x00100000\tcounter' "runtime output common tcp"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle_output\tip6\tdaddr\t@forkop_subnets6\tmeta\tl4proto\ttcp\tmeta\tmark\tset\t0x00100000\tcounter' "runtime output common6 tcp"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle_output\tip\tdaddr\t.\ttcp\tdport\t@forkop_ip_ports\tmeta\tmark\tset\t0x00100000\tcounter' "runtime output ip-port tcp"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle_output\tip6\tdaddr\t.\ttcp\tdport\t@forkop_ip6_ports\tmeta\tmark\tset\t0x00100000\tcounter' "runtime output ip6-port tcp"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle_output\ttcp\tdport\t@forkop_ports\tmeta\tmark\tset\t0x00100000\tcounter' "runtime output port tcp"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tForkopTable\tmangle_output\tip\tdaddr\t198.18.0.0/15\tmeta\tl4proto\tudp\tmeta\tmark\tset\t0x00100000\tcounter' "runtime output fakeip udp"

: > "$NFT_LOG"
if NFT_LIST_TABLE_FAIL=1 nft_ucode nft-table-present-fixture ForkopTable 2>"$WORK_DIR/nft-table-present.err"; then
  fail "missing nft table should return false"
fi
[ ! -s "$WORK_DIR/nft-table-present.err" ] ||
  fail "missing nft table predicate must suppress nft stderr"
# Terse: whether the table exists is the whole question, and printing every
# element of every set to answer it costs seconds on a real rule set.
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
assert_contains "$LOGGER_LOG" "[debug] IPv4 tproxy route already exists" "existing tproxy route log"
assert_contains "$LOGGER_LOG" "[debug] IPv6 tproxy route already exists" "existing tproxy route6 log"
assert_contains "$LOGGER_LOG" "[debug] IPv4 tproxy marking rule already exists" "existing tproxy marking rule log"
assert_contains "$LOGGER_LOG" "[debug] IPv6 tproxy marking rule already exists" "existing tproxy marking rule6 log"
IP_ROUTE_OUTPUT='local default dev lo scope host' \
  IP_ROUTE6_OUTPUT='local default dev lo metric 1024 pref medium' \
  IP_RULE_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup forkop' \
  IP_RULE6_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup forkop' \
  nft_ucode tproxy-route-rule-present forkop 0x00100000
if IP_ROUTE_OUTPUT='local default dev lo scope host' \
  IP_ROUTE6_OUTPUT='local default dev lo metric 1024 pref medium' \
  IP_RULE_OUTPUT='105: from all fwmark 0x200000/0x200000 lookup forkop' \
  IP_RULE6_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup forkop' \
  nft_ucode tproxy-route-rule-present forkop 0x00100000 >/dev/null 2>&1; then
  fail "tproxy route/rule presence should require the Forkop fwmark"
fi
# Another package can register the same table id in /etc/iproute2/rt_tables, so
# iproute2 may print a foreign name for the Forkop table. The rule list is
# already scoped to the table, so the Forkop rule must still be recognized.
: > "$IP_LOG"
IP_ROUTE_OUTPUT='local default dev lo scope host' \
  IP_ROUTE6_OUTPUT='local default dev lo metric 1024 pref medium' \
  IP_RULE_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup podkop' \
  IP_RULE6_OUTPUT='105: from all fwmark 0x100000/0x100000 lookup podkop' \
  nft_ucode tproxy-route-rule-present forkop 0x00100000 ||
  fail "tproxy rule presence must not depend on the printed table name"
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
cat >"$WORK_DIR/signature-fixture.json" <<'JSON'
{
  "settings": {
    "source_network_interfaces": [ "br-lan", "tun0" ],
    "exclude_ntp": "1"
  },
  "section": [
    {
      ".name": "disabled",
      ".type": "section",
      "enabled": "0",
      "action": "proxy",
      "ip_cidr": [ "192.0.2.10" ],
      "ports": [ "1234" ],
      "community_lists": [ "discord" ]
    },
    {
      ".name": "text_rule",
      ".type": "section",
      "enabled": "1",
      "action": "bypass",
      "ip_cidr_text_mode": "1",
      "ip_cidr_text": "198.51.100.1\nbad-value\n203.0.113.0/24",
      "ip_cidr": [ "10.0.0.0/8" ],
      "ports": [ "443", "bad-value", "443" ],
      "ports_text": "80, 443-444\n0\n65536",
      "fully_routed_ips": [ "192.168.1.10/32" ],
      "community_lists": [ "geoblock", "meta", "telegram", "youtube", "discord" ],
      "rule_set_with_subnets": [ "/tmp/local.json", "https://example.com/mixed.lst" ]
    },
    {
      ".name": "default_enabled",
      ".type": "section",
      "action": "proxy",
      "ip_cidr": [ "10.0.0.0/8", "192.0.2.1" ],
      "source_ip_cidr": [ "@system" ],
      "ports_text": "53 853",
      "community_lists": [ "youtube", "cloudflare", "roblox" ]
    }
  ]
}
JSON

cat >"$WORK_DIR/signature-expected.txt" <<'EOF_EXPECTED'
[settings.source_network_interfaces]
br-lan tun0
[settings.exclude_ntp]
1
[rule.text_rule.action]
bypass
[rule.text_rule.ip_cidr]
198.51.100.1,203.0.113.0/24
[rule.text_rule.source_ip_cidr]

[rule.text_rule.source_aware_dns]
1
[rule.text_rule.ports]
443,80,443-444
[rule.text_rule.fully_routed_ips]
192.168.1.10/32
[rule.text_rule.community_subnet_lists]
meta telegram discord
[rule.text_rule.rule_set_with_subnets]
/tmp/local.json https://example.com/mixed.lst
[rule.default_enabled.action]
proxy
[rule.default_enabled.ip_cidr]
10.0.0.0/8,192.0.2.1
[rule.default_enabled.source_ip_cidr]
@system
[rule.default_enabled.source_aware_dns]
1
[rule.default_enabled.ports]
53,853
[rule.default_enabled.fully_routed_ips]

[rule.default_enabled.community_subnet_lists]
cloudflare roblox
[rule.default_enabled.rule_set_with_subnets]

EOF_EXPECTED
expected_signature="$(md5sum "$WORK_DIR/signature-expected.txt" | awk '{print $1}')"
assert_eq "$expected_signature" \
  "$(nft_ucode nft-runtime-signature-fixture "$WORK_DIR/signature-fixture.json")" \
  "nft runtime signature fixture"

cat >"$WORK_DIR/signature-uci.state" <<'EOF_UCI'
forkop.settings=settings
forkop.settings.source_network_interfaces=br-lan tun0
forkop.settings.exclude_ntp=1
forkop.disabled=section
forkop.disabled.enabled=0
forkop.disabled.ip_cidr=192.0.2.10
forkop.enabled=section
forkop.enabled.enabled=1
forkop.enabled.action=bypass
forkop.enabled.ip_cidr=10.0.0.0/8 192.0.2.1
forkop.enabled.ports=443 bad-value
forkop.enabled.ports_text=80 443-444 65536
forkop.enabled.fully_routed_ips=192.168.1.10/32
forkop.enabled.community_lists=geoblock meta telegram youtube discord
forkop.enabled.rule_set_with_subnets=/tmp/local.json https://example.com/mixed.lst
EOF_UCI
cat >"$WORK_DIR/signature-uci-expected.txt" <<'EOF_EXPECTED'
[settings.source_network_interfaces]
br-lan tun0
[settings.exclude_ntp]
1
[rule.enabled.action]
bypass
[rule.enabled.ip_cidr]
10.0.0.0/8,192.0.2.1
[rule.enabled.source_ip_cidr]

[rule.enabled.source_aware_dns]
1
[rule.enabled.ports]
443,80,443-444
[rule.enabled.fully_routed_ips]
192.168.1.10/32
[rule.enabled.community_subnet_lists]
meta telegram discord
[rule.enabled.rule_set_with_subnets]
/tmp/local.json https://example.com/mixed.lst
EOF_EXPECTED
expected_signature="$(md5sum "$WORK_DIR/signature-uci-expected.txt" | awk '{print $1}')"
assert_eq "$expected_signature" \
  "$(FORKOP_UCI_STATE_FILE="$WORK_DIR/signature-uci.state" nft_ucode nft-runtime-signature)" \
  "nft runtime signature from UCI state"

cat >"$WORK_DIR/signature-defaults-fixture.json" <<'JSON'
{}
JSON
cat >"$WORK_DIR/signature-defaults-expected.txt" <<'EOF_EXPECTED'
[settings.source_network_interfaces]
br-lan
[settings.exclude_ntp]
0
EOF_EXPECTED
expected_signature="$(md5sum "$WORK_DIR/signature-defaults-expected.txt" | awk '{print $1}')"
assert_eq "$expected_signature" \
  "$(nft_ucode nft-runtime-signature-fixture "$WORK_DIR/signature-defaults-fixture.json")" \
  "nft runtime signature defaults"

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
  NFT_COMMON_SET_NAME=rebuild_subnets \
  NFT_COMMON6_SET_NAME=rebuild_subnets6 \
  NFT_PORT_SET_NAME=rebuild_ports \
  NFT_IP_PORT_SET_NAME=rebuild_ip_ports \
  NFT_IP_PORT6_SET_NAME=rebuild_ip6_ports \
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
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tRebuildTable\tmangle_output\tip\tdaddr\t@rebuild_subnets\tmeta\tl4proto\ttcp\tmeta\tmark\tset\t0x00100000\tcounter' "rebuild output common rule"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tRebuildTable\tmangle_output\tmeta\tmark\t&\t0x40000000\t==\t0x40000000\treturn' "rebuild zapret desync return"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tRebuildTable\tmangle_output\tmeta\tmark\t0x03000001\tmeta\tl4proto\ttcp\tcounter\tqueue\tnum\t4100\tbypass' "rebuild zapret queue rule"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tRebuildTable\tmangle_output\tmeta\tmark\t&\t0x50000000\t==\t0x50000000\treturn' "rebuild zapret2 desync return"
assert_contains "$NFT_LOG" $'nft\tadd\trule\tinet\tRebuildTable\tmangle_output\tmeta\tmark\t0x05000001\tmeta\tl4proto\ttcp\tcounter\tqueue\tnum\t4500\tbypass' "rebuild zapret2 queue rule"
assert_contains "$IP_LOG" $'ip\troute\tadd\tlocal\t0.0.0.0/0\tdev\tlo\ttable\trebuild_route' "rebuild TProxy route"
assert_contains "$IP_LOG" $'ip\t-4\trule\tadd\tfwmark\t0x00100000/0x00100000\ttable\trebuild_route\tpriority\t105' "rebuild TProxy marking rule"
assert_contains "$WORK_DIR/rebuild-rt_tables" '105 rebuild_route' "rebuild route table registration"
for leaked in ForkopTable forkop_subnets forkop_ports forkop_ip_ports forkop_interfaces; do
  if grep -Fq "$leaked" "$NFT_LOG"; then
    fail "nft runtime rebuild fell back to the default $leaked instead of the name core/constants.uc holds"
  fi
done

printf 'NFT apply checks passed\n'
