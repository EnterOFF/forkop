#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
LIFECYCLE_UC="$FORKOP_LIB/service/lifecycle.uc"

netstat_conflicts() {
  FORKOP_TEST_NETSTAT="$1" FORKOP_TEST_ENDPOINT="$2" \
    ucode -L "$FORKOP_LIB" -e 'let n=require("core.netstat"); exit(n.tcp_endpoint_in_use(getenv("FORKOP_TEST_NETSTAT"),getenv("FORKOP_TEST_ENDPOINT")) ? 0 : 1);'
}

explicit_listener='tcp 0 0 192.168.1.1:9090 0.0.0.0:* LISTEN'
ipv4_wildcard_listener='tcp 0 0 0.0.0.0:9090 0.0.0.0:* LISTEN'
ipv6_wildcard_listener='tcp 0 0 :::9090 :::* LISTEN'

netstat_conflicts "$explicit_listener" '192.168.1.1:9090' ||
  fail "an explicit listener on the requested Clash API address must conflict"
netstat_conflicts "$ipv4_wildcard_listener" '192.168.1.1:9090' ||
  fail "an IPv4 wildcard listener must conflict with an explicit Clash API address"
netstat_conflicts "$explicit_listener" '0.0.0.0:9090' ||
  fail "a wildcard Clash API address must conflict with an explicit IPv4 listener"
netstat_conflicts "$ipv6_wildcard_listener" '192.168.1.1:9090' ||
  fail "a dual-stack wildcard listener must conflict with an explicit Clash API address"
if netstat_conflicts "$explicit_listener" '192.168.1.2:9090'; then
  fail "different explicit addresses on the same port must not conflict"
fi
if netstat_conflicts "$explicit_listener" '192.168.1.1:9091'; then
  fail "different ports must not conflict"
fi

cat >"$WORK_DIR/config.json" <<'EOF'
{"experimental":{"clash_api":{"external_controller":"192.168.1.1:9090"}}}
EOF
printf '%s\n' "$ipv4_wildcard_listener" >"$WORK_DIR/netstat.txt"
mkdir -p "$WORK_DIR/bin"
cat >"$WORK_DIR/bin/logger" <<'SH'
#!/usr/bin/env sh
printf '%s\n' "$*" >>"$FORKOP_TEST_LOG"
SH
chmod +x "$WORK_DIR/bin/logger"

if FORKOP_TEST_LOG="$WORK_DIR/logger.log" PATH="$WORK_DIR/bin:$PATH" \
  ucode -L "$FORKOP_LIB" "$LIFECYCLE_UC" clash-controller-preflight-fixture \
    "$WORK_DIR/config.json" "$WORK_DIR/netstat.txt"; then
  fail "lifecycle preflight must reject an occupied Clash API address"
fi
grep -Fq '[fatal] Clash API address 192.168.1.1:9090 is already in use by another process. Aborted.' "$WORK_DIR/logger.log" ||
  fail "lifecycle preflight must explain the occupied Clash API address"

preflight_line="$(grep -nF 'status = clash_controller_preflight();' "$LIFECYCLE_UC" | cut -d: -f1)"
sing_box_start_line="$(grep -nF 'command_success_from_args([ SING_BOX_INIT, "start" ])' "$LIFECYCLE_UC" | head -n1 | cut -d: -f1)"
[ -n "$preflight_line" ] && [ -n "$sing_box_start_line" ] && [ "$preflight_line" -lt "$sing_box_start_line" ] ||
  fail "cold-start lifecycle must run the Clash API preflight before starting sing-box"
[ "$(grep -Fc 'status = clash_controller_preflight();' "$LIFECYCLE_UC")" = "1" ] ||
  fail "live sing-box reload must not run the cold-start port preflight"
grep -Fq 'command_output_from_args([ "netstat", "-lnt" ])' "$LIFECYCLE_UC" ||
  fail "Clash API preflight must inspect listening TCP sockets through netstat"
if sed -n '/^function clash_controller_preflight(/,/^}/p' "$LIFECYCLE_UC" | grep -Eq '(^|[^a-z])kill([^a-z]|$)'; then
  fail "Clash API preflight must not kill the process that owns the address"
fi

printf 'Clash controller preflight checks passed\n'
