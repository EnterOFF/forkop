#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

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

printf 'Clash controller address checks passed\n'
