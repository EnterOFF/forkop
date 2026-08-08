#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIAGNOSTICS="$ROOT_DIR/forkop/files/usr/lib/diagnostics/status.uc"
DIAGNOSTICS_RUNTIME="$ROOT_DIR/forkop/files/usr/lib/diagnostics/runtime.uc"
FORKOP_BIN="$ROOT_DIR/forkop/files/usr/bin/forkop"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
CLI_UC="$FORKOP_BIN"
WORK_DIR="$(mktemp -d)"

status_ucode() {
  ucode -L "$FORKOP_LIB" "$DIAGNOSTICS" "$@"
}

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_status() {
  local running="$1"
  local enabled="$2"
  local dns="$3"
  local expected="$4"
  local json

  json="$(status_ucode service-status-json "$running" "$enabled" "$dns")"
  JSON_VALUE="$json" node - "$expected" "$dns" <<'NODE'
const expected = process.argv[2];
const expectedDns = Number(process.argv[3]);
const value = JSON.parse(process.env.JSON_VALUE);
if (value.status !== expected || value.dns_configured !== expectedDns) {
  console.error(`expected ${expected}/${expectedDns}, got ${value.status}/${value.dns_configured}`);
  process.exit(1);
}
NODE
}

assert_status 1 1 1 "running & enabled"
assert_status 1 0 0 "running but disabled"
assert_status 0 1 1 "stopped but enabled"
assert_status 0 0 0 "stopped & disabled"

[ ! -e "$FORKOP_LIB/status_diagnostics.sh" ] ||
  fail "status_diagnostics.sh shell owner must be removed"
grep -Fq 'get_system_info: [ "diagnostics/runtime.uc", "get-system-info", 0 ]' "$CLI_UC" ||
  fail "service/cli.uc must dispatch get_system_info through diagnostics/runtime.uc"
[ "$(FORKOP_VERSION=runtime-test ucode -L "$FORKOP_LIB" "$DIAGNOSTICS_RUNTIME" show-version)" = "runtime-test" ] ||
  fail "diagnostics/runtime.uc show-version mode failed"

system_info_bin="$WORK_DIR/system-info-bin"
system_info_luci="$WORK_DIR/system-info-luci"
mkdir -p "$system_info_bin" "$system_info_luci"
cat >"$system_info_bin/opkg" <<'SH'
#!/usr/bin/env sh
exit 1
SH
cat >"$system_info_bin/sing-box" <<'SH'
#!/usr/bin/env sh
exit 0
SH
chmod +x "$system_info_bin/opkg" "$system_info_bin/sing-box"
printf '%s\n' 'var FORKOP_LUCI_APP_VERSION = "runtime-test";' >"$system_info_luci/main.js"
printf '%s\n' '1.13.14-extended-2.5.3-f1' >"$WORK_DIR/sing-box-version"
printf '%s\n' '{"forkop_version":"runtime-test","luci_app_version":"runtime-test","sing_box_version":"not installed","generated_at":9999999999}' >"$WORK_DIR/system-info.json"
system_info="$(
  PATH="$system_info_bin:$PATH" \
  FORKOP_VERSION=runtime-test \
  FORKOP_LIB="$FORKOP_LIB" \
  FORKOP_LUCI_VIEW_DIR="$system_info_luci" \
  FORKOP_SYSTEM_INFO_CACHE_FILE="$WORK_DIR/system-info.json" \
  SING_BOX_FORKOP_VERSION_FILE="$WORK_DIR/sing-box-version" \
    ucode -L "$FORKOP_LIB" "$DIAGNOSTICS_RUNTIME" get-system-info
)"
JSON_VALUE="$system_info" node - <<'NODE'
const value = JSON.parse(process.env.JSON_VALUE);
if (value.sing_box_version !== '1.13.14-extended-2.5.3-f1') {
  console.error('system-info must recover sing-box version from the package marker while opkg is locked');
  process.exit(1);
}
NODE
if grep -n -E 'require\("uci"\)\.cursor|uci -q|uci", "show"|uci", "-q"' "$DIAGNOSTICS_RUNTIME" >/dev/null 2>&1; then
  fail "diagnostics/runtime.uc must use core.uci instead of owning direct UCI cursor or CLI calls"
fi
grep -Fq '"forkop-stably-running", RT_TABLE_NAME, NFT_TABLE_NAME, NFT_FAKEIP_MARK, RUNTIME_STABLE_MIN_AGE' "$DIAGNOSTICS_RUNTIME" ||
  fail "diagnostics Forkop status must use stable runtime state to avoid crash-loop flicker"
grep -Fq '"sing-box-service-stable",' "$DIAGNOSTICS_RUNTIME" ||
  fail "diagnostics sing-box status must use stable runtime state to avoid crash-loop flicker"

if grep -Fq 'get-dashboard-section-cache' "$DIAGNOSTICS_RUNTIME"; then
  fail "diagnostics runtime must not retain the retired section-cache API"
fi

if grep -Fq 'get-server-capabilities' "$DIAGNOSTICS_RUNTIME"; then
  fail "diagnostics runtime must not retain sing-box variant capability probes"
fi
grep -Fq 'check_proxy_through_running_core' "$DIAGNOSTICS_RUNTIME" ||
  fail "proxy diagnostics must reuse the running core on low-memory routers"
grep -Fq '"--proxy", proxy' "$DIAGNOSTICS_RUNTIME" ||
  fail "proxy diagnostics must not spawn a second sing-box process while the core is active"
grep -Fq 'CHECK_PROXY_LOCK_DIR' "$DIAGNOSTICS_RUNTIME" ||
  fail "proxy diagnostics must serialize concurrent checks"

diagnostics_bin="$WORK_DIR/diagnostics-bin"
mkdir -p "$diagnostics_bin"
cat >"$diagnostics_bin/dig" <<'SH'
#!/usr/bin/env sh
printf '%s\n' "$*" >"$DIG_ARGS_FILE"
printf '%s\n' '203.0.113.7'
SH
chmod +x "$diagnostics_bin/dig"
dns_result="$(
  DIG_ARGS_FILE="$WORK_DIR/dig-args" PATH="$diagnostics_bin:$PATH" \
    ucode -L "$FORKOP_LIB" "$DIAGNOSTICS_RUNTIME" dns-check-resolve-host-fixture example.com 127.0.0.1:5335 2
)"
[ "$dns_result" = "203.0.113.7" ] ||
  fail "custom-port bootstrap DNS fixture did not resolve"
[ "$(cat "$WORK_DIR/dig-args")" = "@127.0.0.1 -p 5335 example.com A +short +timeout=2 +tries=1" ] ||
  fail "custom-port bootstrap DNS must pass the resolver port through dig -p"

cat >"$diagnostics_bin/curl" <<'SH'
#!/usr/bin/env sh
exit 0
SH
cat >"$diagnostics_bin/sleep" <<'SH'
#!/usr/bin/env sh
exit 0
SH
cat >"$diagnostics_bin/nft" <<'SH'
#!/usr/bin/env sh
case "$*" in
  "list table inet ForkopTable") exit 0 ;;
  "list chain inet ForkopTable mangle")
    printf '%s\n' 'counter packets 0 bytes 0'
    ;;
  "list chain inet ForkopTable priority_rules")
    printf '%s\n' 'counter packets 4 bytes 256'
    ;;
  "list chain inet ForkopTable mangle_output"|"list chain inet ForkopTable proxy")
    printf '%s\n' 'counter packets 1 bytes 64'
    ;;
  "list tables")
    printf '%s\n' 'table inet ForkopTable'
    ;;
esac
SH
chmod +x "$diagnostics_bin/curl" "$diagnostics_bin/sleep" "$diagnostics_bin/nft"
nft_status="$(FORKOP_LIB="$FORKOP_LIB" PATH="$diagnostics_bin:$PATH" \
  ucode -L "$FORKOP_LIB" "$DIAGNOSTICS_RUNTIME" check-nft-rules)"
JSON_VALUE="$nft_status" node - <<'NODE'
const value = JSON.parse(process.env.JSON_VALUE);
if (value.rules_mangle_counters !== 1) {
  console.error('priority_rules traffic must satisfy the mangle counter diagnostic');
  process.exit(1);
}
NODE

masked_config="$WORK_DIR/forkop-masked"
cat >"$masked_config" <<'EOF'
config settings 'main'
        option hwid 'device-secret'
        option proxy_string 'vless://secret@example.com:443'
config subscription_url 'sub1'
        option url 'https://user:password@example.com/subscription?token=secret'
        list header 'Authorization: Bearer header-secret'
config section 'tunnels'
config tunnel 'tun_tailnet'
        option section 'tunnels'
        option kind 'tailscale'
        option tailscale_auth_key 'tskey-secret'
        option warp_profile_auth_token 'warp-token-secret'
        option warp_profile_private_key 'warp-private-secret'
config tunnel_peer 'peer_tailnet'
        option tunnel 'tun_tailnet'
        option pre_shared_key 'peer-secret'
EOF
masked_output="$(status_ucode forkop-config-masked "$masked_config")"
case "$masked_output" in
  *device-secret*|*vless://secret*|*token=secret*|*user:password*|*header-secret*|*tskey-secret*|*warp-token-secret*|*warp-private-secret*|*peer-secret*) fail "masked Forkop config leaked a secret" ;;
esac
case "$masked_output" in
  *"list header 'MASKED'"*) ;;
  *) fail "masked Forkop config must mask subscription request headers" ;;
esac
case "$masked_output" in
  *"option hwid 'MASKED'"*) ;;
  *) fail "masked Forkop config must preserve the HWID option shape" ;;
esac
case "$masked_output" in
  *"option url 'MASKED'"*) ;;
  *) fail "masked Forkop config must mask subscription section URLs" ;;
esac
case "$masked_output" in
  *"option tailscale_auth_key 'MASKED'"*"option warp_profile_auth_token 'MASKED'"*"option warp_profile_private_key 'MASKED'"*"option pre_shared_key 'MASKED'"*) ;;
  *) fail "masked Forkop config must mask tunnel credentials" ;;
esac

wan_wireguard="$WORK_DIR/network-wireguard"
cat >"$wan_wireguard" <<'EOF'
config interface 'wan'
        option proto 'wireguard'
        option private_key 'wireguard-private-secret'
        option addresses '192.0.2.2/32'
config interface 'lan'
        option private_key 'not-in-wan'
EOF
wan_output="$(status_ucode wan-config-masked "$wan_wireguard")"
case "$wan_output" in
  *wireguard-private-secret*) fail "masked WAN config leaked the WireGuard private key" ;;
esac
case "$wan_output" in
  *"option private_key '******'"*) ;;
  *) fail "masked WAN config must preserve a masked WireGuard private key option" ;;
esac

legacy_json="$(status_ucode service-status-json 1 0 ignored 1)"
JSON_VALUE="$legacy_json" node - <<'NODE'
const value = JSON.parse(process.env.JSON_VALUE);
if (value.status !== "running but disabled" || value.dns_configured !== 1) {
  console.error("legacy service-status-json call shape changed");
  process.exit(1);
}
NODE

{
  printf 'Tue Jun 30 10:59:59 2026 user.notice forkop: [info] historical log retained\n'
  printf 'Tue Jun 30 11:00:00 2026 user.notice forkop: [info] Starting Forkop\n'
  for i in $(seq 1 4500); do
    printf 'Tue Jun 30 11:00:%02d 2026 daemon.info unrelated[%04d]: filler filler filler filler filler filler filler filler filler filler\n' "$((i % 60))" "$i"
  done
  printf 'Tue Jun 30 11:01:00 2026 user.notice forkop: [info] large logread marker survived stdin transport\n'
} >"$WORK_DIR/large-logread.txt"
large_logs="$(FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$DIAGNOSTICS_RUNTIME" forkop-logs-fixture <"$WORK_DIR/large-logread.txt")" ||
  fail "diagnostics/runtime.uc must process large logread payloads through stdin without shell argument limits"
case "$large_logs" in
  *"large logread marker survived stdin transport"*) ;;
  *) fail "large logread marker missing from rendered logs" ;;
esac
case "$large_logs" in
  *"historical log retained"*) ;;
  *) fail "Forkop logs must include entries from before the latest service start" ;;
esac

{
  for i in $(seq 1 125); do
    printf 'Tue Jun 30 11:02:%02d 2026 daemon.info sing-box[%04d]: retained line\n' "$((i % 60))" "$i"
  done
} >"$WORK_DIR/sing-box-logread.txt"
full_sing_box_logs="$(status_ucode matching-log-tail sing-box 0 <"$WORK_DIR/sing-box-logread.txt")" ||
  fail "full sing-box log rendering failed"
case "$full_sing_box_logs" in
  *"sing-box[0001]"*"sing-box[0125]"*) ;;
  *) fail "sing-box logs must not be limited to the last 100 lines" ;;
esac
grep -Fq '[ "matching-log-tail", "sing-box", "0" ]' "$DIAGNOSTICS_RUNTIME" ||
  fail "check_sing_box_logs must request the complete available sing-box log"

formatted_logs="$({
  printf 'Sat Aug  1 21:31:03 2026 daemon.err sing-box[31969]: \033[31mERROR\033[0m[120870] [\033[38;5;136m3042278520\033[0m 10.0s] dns: exchange failed for discord.com. IN A: context deadline exceeded\n'
  printf 'Sat Aug  1 21:43:33 2026 daemon.err uhttpd[2032]: [info] luci: accepted login on /admin/services/forkop for root from 192.168.1.140\n'
  printf 'Sat Aug  1 21:54:07 2026 daemon.err sing-box[31969]: \033[31mERROR\033[0m[122254] [\033[38;5;202m2228374970\033[0m 177ms] connection: open connection to api.github.com:443 using outbound/vless[proxy-manual-provider/Vless no warp-dpfsfl50]: EOF\n'
  printf 'Sat Aug  1 22:39:57 2026 user.notice forkop: [info] Stopping Forkop\n'
} | status_ucode forkop-logs)" || fail "formatted log rendering failed"
expected_formatted_logs="$(cat <<'EOF'
Aug 01 21:31:03 sing-box[31969]: [error] DNS exchange failed for discord.com (A): context deadline exceeded
Aug 01 21:43:33 uhttpd[2032]: [info] Accepted login for root from 192.168.1.140
Aug 01 21:54:07 sing-box[31969]: [error] Connection to api.github.com:443 via Vless no warp-dpfsfl50 failed: EOF
Aug 01 22:39:57 forkop: [info] Stopping Forkop
EOF
)"
[ "$formatted_logs" = "$expected_formatted_logs" ] || {
  printf 'FAIL: normalized logs differ\nEXPECTED:\n%s\nACTUAL:\n%s\n' "$expected_formatted_logs" "$formatted_logs" >&2
  exit 1
}

fake_bin="$WORK_DIR/bin"
mkdir -p "$fake_bin"
cat >"$fake_bin/curl" <<'SH'
#!/usr/bin/env sh
printf '%s\n' "$*" >>"$FAKE_CURL_LOG"
case "$*" in
  *'127.0.0.1:9090/providers/proxies') printf '%s\n' '{"providers":{}}' ;;
  *'127.0.0.1:9090/proxies/provider%2Fnode/link') printf '%s\n' '{"url":"vless://id@example.com:443"}' ;;
  *'127.0.0.1:9090/proxies') printf '%s\n' '{"proxies":{"urltest":{"type":"URLTest"},"provider-urltest":{"type":"urltest"},"proxy-a":{"type":"VLESS"},"proxy-b":{"type":"Trojan"}}}' ;;
  *'/group/urltest/delay'*) printf '%s\n' '{"urltest-member":2}' ;;
  *'/group/provider-urltest/delay'*) printf '%s\n' '{"provider-member":3}' ;;
  *) printf '%s\n' '{"delay":1}' ;;
esac
SH
chmod +x "$fake_bin/curl"
uci_state="$WORK_DIR/uci-state.txt"
cat >"$uci_state" <<'EOF'
forkop.settings=settings
forkop.settings.latency_test_url=https://latency.example/generate_204
forkop.settings.yacd_secret_key=local-secret
EOF
FAKE_CURL_LOG="$WORK_DIR/fake-curl.log" \
FORKOP_UCI_STATE_FILE="$uci_state" \
FORKOP_LIB="$FORKOP_LIB" \
PATH="$fake_bin:$PATH" \
  ucode -L "$FORKOP_LIB" "$DIAGNOSTICS_RUNTIME" clash-api get_proxy_latency proxy-out 5000 >/dev/null ||
  fail "clash-api get_proxy_latency should use fake curl successfully"
grep -Fq "url=https://latency.example/generate_204" "$WORK_DIR/fake-curl.log" ||
  fail "clash-api latency check must use settings.latency_test_url"

FAKE_CURL_LOG="$WORK_DIR/fake-provider-curl.log" \
FORKOP_UCI_STATE_FILE="$uci_state" \
FORKOP_LIB="$FORKOP_LIB" \
PATH="$fake_bin:$PATH" \
  ucode -L "$FORKOP_LIB" "$DIAGNOSTICS_RUNTIME" clash-api get_proxy_providers >/dev/null ||
  fail "clash-api get_proxy_providers should use fake curl successfully"
grep -Fq '/providers/proxies' "$WORK_DIR/fake-provider-curl.log" ||
  fail "provider dashboard data must come from the native provider API"

proxy_link="$(FAKE_CURL_LOG="$WORK_DIR/fake-link-curl.log" \
FORKOP_UCI_STATE_FILE="$uci_state" \
FORKOP_LIB="$FORKOP_LIB" \
PATH="$fake_bin:$PATH" \
  ucode -L "$FORKOP_LIB" "$DIAGNOSTICS_RUNTIME" clash-api get_proxy_link 'provider/node')" ||
  fail "clash-api get_proxy_link should use fake curl successfully"
JSON_VALUE="$proxy_link" node - <<'NODE'
const value = JSON.parse(process.env.JSON_VALUE);
if (value.url !== 'vless://id@example.com:443') process.exit(1);
NODE
grep -Fq '/proxies/provider%2Fnode/link' "$WORK_DIR/fake-link-curl.log" ||
  fail "proxy links must be requested from the native per-outbound endpoint"
grep -Fq 'Authorization: Bearer local-secret' "$WORK_DIR/fake-link-curl.log" ||
  fail "local Clash API calls must authenticate whenever the generated API has a secret"

running_proxy_bin="$WORK_DIR/running-proxy-bin"
mkdir -p "$running_proxy_bin"
cat >"$running_proxy_bin/pgrep" <<'SH'
#!/usr/bin/env sh
[ "$1" = "-x" ] && [ "$2" = "sing-box" ]
SH
cat >"$running_proxy_bin/sing-box" <<'SH'
#!/usr/bin/env sh
printf '%s\n' "$*" >>"$FAKE_SING_BOX_LOG"
exit 0
SH
cat >"$running_proxy_bin/curl" <<'SH'
#!/usr/bin/env sh
printf '%s\n' "$*" >>"$FAKE_RUNNING_CURL_LOG"
printf '%s\n' '198.51.100.9'
SH
chmod +x "$running_proxy_bin"/*
running_uci_state="$WORK_DIR/running-proxy-uci.state"
printf 'forkop.settings=settings\nforkop.settings.config_path=%s\n' "$WORK_DIR/running-config.json" >"$running_uci_state"
: >"$WORK_DIR/running-config.json"
: >"$WORK_DIR/fake-sing-box.log"
FAKE_SING_BOX_LOG="$WORK_DIR/fake-sing-box.log" \
FAKE_RUNNING_CURL_LOG="$WORK_DIR/fake-running-curl.log" \
FORKOP_UCI_STATE_FILE="$running_uci_state" \
FORKOP_LIB="$FORKOP_LIB" \
FORKOP_RUNTIME_STATE_DIR="$WORK_DIR/running-proxy-runtime" \
PATH="$running_proxy_bin:$PATH" \
  ucode -L "$FORKOP_LIB" "$DIAGNOSTICS_RUNTIME" check-proxy >"$WORK_DIR/running-proxy.output" ||
  fail "active proxy diagnostics should use the running core mixed inbound"
grep -Fq -- '--proxy socks5h://127.0.0.1:4534' "$WORK_DIR/fake-running-curl.log" ||
  fail "active proxy diagnostics must route curl through the native mixed inbound"
if grep -Fq 'tools fetch' "$WORK_DIR/fake-sing-box.log"; then
  fail "active proxy diagnostics must not launch a second sing-box tools process"
fi

latency_action_dir="$WORK_DIR/ui-state/latency-actions"
mkdir -p "$latency_action_dir"
latency_state="$latency_action_dir/latency-1.json"
printf '%s\n' '{"success":true,"running":true,"kind":"latency","latency_type":"proxy_list","section":"main","tag":"[]","started_at":100}' >"$latency_state"
FAKE_CURL_LOG="$WORK_DIR/fake-curl-latencies.log" \
FORKOP_UCI_STATE_FILE="$uci_state" \
FORKOP_LIB="$FORKOP_LIB" \
FORKOP_UI_LATENCY_ACTION_DIR="$latency_action_dir" \
PATH="$fake_bin:$PATH" \
  ucode -L "$FORKOP_LIB" "$DIAGNOSTICS_RUNTIME" clash-api get_proxy_latencies '["urltest","proxy-a","provider-urltest","proxy-b"]' 5000 "$latency_state" >/dev/null ||
  fail "clash-api get_proxy_latencies should update latency progress"
JOB_STATE="$latency_state" node - <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.env.JOB_STATE, "utf8"));
if (
  !value.progress ||
  value.progress.completed !== 4 ||
  value.progress.total !== 4 ||
  value.progress.failed !== 0 ||
  value.progress.pending?.length !== 0 ||
  value.progress.latencies?.["proxy-a"] !== 1 ||
  value.progress.latencies?.["proxy-b"] !== 1 ||
  value.progress.latencies?.["urltest-member"] !== 2 ||
  value.progress.latencies?.["provider-member"] !== 3
) {
  console.error("latency progress after proxy list mismatch");
  process.exit(1);
}
NODE
expected_latency_paths=(
  '/proxies/proxy-a/delay'
  '/proxies/proxy-b/delay'
  '/group/urltest/delay'
  '/group/provider-urltest/delay'
)
for index in "${!expected_latency_paths[@]}"; do
  sed -n "$((index + 2))p" "$WORK_DIR/fake-curl-latencies.log" |
    grep -Fq "${expected_latency_paths[$index]}" ||
    fail "bulk latency must test ordinary proxies before URLTest groups"
done

firewall_rules="$(cat <<'EOF'
firewall.@rule[0]=rule
firewall.@rule[0].enabled='1'
firewall.@rule[0].target='ACCEPT'
firewall.@rule[0].src='wan'
firewall.@rule[0].proto='tcp udp'
firewall.@rule[0].dest_port='443'
EOF
)"

printf '%s\n' "$firewall_rules" |
  status_ucode firewall-required-protocols-open 443 "tcp udp" >/dev/null ||
  fail "tcp+udp firewall rule should satisfy required protocols"
if printf '%s\n' "$firewall_rules" |
  status_ucode firewall-required-protocols-open 8443 "tcp" >/dev/null 2>&1; then
  fail "wrong firewall port should not satisfy required protocols"
fi

[ "$(status_ucode server-required-inbound-proto hysteria2)" = "udp" ] ||
  fail "Hysteria2 inbound diagnostics must require UDP"
[ "$(status_ucode server-required-inbound-proto tuic)" = "udp" ] ||
  fail "TUIC inbound diagnostics must require UDP"
[ "$(status_ucode server-required-inbound-proto mieru UDP)" = "udp" ] ||
  fail "Mieru UDP inbound diagnostics must require UDP"
[ "$(status_ucode server-required-inbound-proto mieru TCP)" = "tcp" ] ||
  fail "Mieru TCP inbound diagnostics must require TCP"
[ "$(status_ucode server-required-inbound-proto naive udp)" = "udp" ] ||
  fail "Naive UDP inbound diagnostics must require UDP"
[ "$(status_ucode server-required-inbound-proto naive tcp_udp)" = "tcp udp" ] ||
  fail "Naive TCP+UDP inbound diagnostics must require both transports"
[ "$(status_ucode server-required-inbound-proto naive tcp)" = "tcp" ] ||
  fail "Naive TCP inbound diagnostics must require TCP"

firewall_src_port_rule="$(cat <<'EOF'
firewall.@rule[0]=rule
firewall.@rule[0].enabled='1'
firewall.@rule[0].target='ACCEPT'
firewall.@rule[0].src='wan'
firewall.@rule[0].proto='tcp'
firewall.@rule[0].src_port='12345'
firewall.@rule[0].dest_port='443'
EOF
)"
if printf '%s\n' "$firewall_src_port_rule" |
  status_ucode firewall-required-protocols-open 443 "tcp" >/dev/null 2>&1; then
  fail "firewall rule limited by source port should not satisfy public inbound diagnostic"
fi

status_ucode server-listen-requires-firewall 0.0.0.0 "" 0 >/dev/null ||
  fail "wildcard listen should require firewall"
status_ucode server-listen-requires-firewall :: "" 0 >/dev/null ||
  fail "IPv6 wildcard listen should require firewall"
status_ucode server-listen-requires-firewall 198.51.100.2 198.51.100.2 0 >/dev/null ||
  fail "WAN listen address should require firewall"
status_ucode server-listen-requires-firewall 2001:db8::2 "198.51.100.2 2001:db8::2" 0 >/dev/null ||
  fail "IPv6 WAN listen address should require firewall"
status_ucode server-listen-requires-firewall 203.0.113.2 "" 1 >/dev/null ||
  fail "public listen address should require firewall"
if status_ucode server-listen-requires-firewall 192.168.1.2 198.51.100.2 0 >/dev/null 2>&1; then
  fail "private non-WAN listen address should not require firewall"
fi

[ "$(status_ucode public-host-flags '' '' 8.8.8.8 1)" = "-1 -1 -1" ] ||
  fail "empty public host flags changed"
[ "$(status_ucode public-host-flags example.com '' 8.8.8.8 1)" = "0 -1 -1" ] ||
  fail "unresolved public host flags changed"
[ "$(status_ucode public-host-flags example.com '1.1.1.1 8.8.8.8' 8.8.8.8 1)" = "1 1 1" ] ||
  fail "public host WAN match flags changed"
[ "$(status_ucode public-host-flags example.com '192.168.1.10' 8.8.8.8 1)" = "1 0 0" ] ||
  fail "private public host flags changed"
[ "$(status_ucode public-host-flags example.com '8.8.8.8' 8.8.8.8 0)" = "1 1 -1" ] ||
  fail "non-public WAN host match flags changed"
[ "$(status_ucode public-host-flags example.com '2606:4700:4700::1111' '198.51.100.2 2606:4700:4700::1111' 1)" = "1 1 1" ] ||
  fail "IPv6 public host flags changed"

netstat_listening="$(cat <<'EOF'
Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State
tcp        0      0 0.0.0.0:443             0.0.0.0:*               LISTEN
udp        0      0 0.0.0.0:443             0.0.0.0:*
EOF
)"

printf '%s\n' "$netstat_listening" |
  status_ucode server-required-ports-listening 0.0.0.0 443 "tcp udp" >/dev/null ||
  fail "tcp+udp netstat listeners should satisfy required protocols"
if printf '%s\n' "$netstat_listening" |
  status_ucode server-required-ports-listening 0.0.0.0 8443 "tcp" >/dev/null 2>&1; then
  fail "missing netstat listener should fail"
fi

netstat_listening6="$(cat <<'EOF'
Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State
tcp        0      0 ::1:8443                :::*                    LISTEN
EOF
)"

printf '%s\n' "$netstat_listening6" |
  status_ucode server-required-ports-listening ::1 8443 "tcp" >/dev/null ||
  fail "IPv6 tcp netstat listener should satisfy required protocols"

sing_box_netstat="$(cat <<'EOF'
Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name
tcp        0      0 127.0.0.42:53           0.0.0.0:*               LISTEN      16244/sing-box
tcp        0      0 0.0.0.0:1602            0.0.0.0:*               LISTEN      16244/sing-box
tcp        0      0 ::1:1602                :::*                    LISTEN      16244/sing-box
udp        0      0 127.0.0.42:53           0.0.0.0:*                           16244/sing-box
udp        0      0 0.0.0.0:1602            0.0.0.0:*                           16244/sing-box
udp        0      0 ::1:1602                :::*                                16244/sing-box
EOF
)"

printf '%s\n' "$sing_box_netstat" |
  FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$DIAGNOSTICS_RUNTIME" sing-box-standard-ports-listening-fixture >/dev/null ||
  fail "sing-box standard listeners should satisfy diagnostics"
if printf '%s\n' "$sing_box_netstat" | sed '/0.0.0.0:1602/d' |
  FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$DIAGNOSTICS_RUNTIME" sing-box-standard-ports-listening-fixture >/dev/null 2>&1; then
  fail "missing sing-box tproxy listener should fail diagnostics"
fi

netstat_owners="$(cat <<'EOF'
Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name
tcp        0      0 0.0.0.0:443             0.0.0.0:*               LISTEN      111/nginx
udp        0      0 0.0.0.0:443             0.0.0.0:*                           222/dnsmasq
tcp        0      0 0.0.0.0:443             0.0.0.0:*               LISTEN      333/sing-box
EOF
)"

owners="$(printf '%s\n' "$netstat_owners" |
  status_ucode server-required-port-conflict-owners 0.0.0.0 443 "tcp udp")"
[ "$owners" = "111/nginx 222/dnsmasq" ] ||
  fail "unexpected conflict owners: $owners"

printf 'diagnostics status checks passed\n'
