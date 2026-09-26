#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
INCLUDE_NFT="$ROOT_DIR/forkop/files/usr/share/nftables.d/chain-pre/input/forkop.nft"
FORKOP_MAKEFILE="$ROOT_DIR/forkop/Makefile"
BUILD_SCRIPT="$ROOT_DIR/build.sh"

[ -r "$INCLUDE_NFT" ] ||
  fail "the package must ship an fw4 input include so isolated zones reach the TPROXY inbound"

# fw4 only auto-includes files whose path spells out the position and chain.
case "$INCLUDE_NFT" in
  */usr/share/nftables.d/chain-pre/input/*.nft) ;;
  *) fail "the include must live in /usr/share/nftables.d/chain-pre/input to be prepended to the fw4 input chain" ;;
esac

NFT_FAKEIP_MARK="$(ucode -L "$FORKOP_LIB" -e 'print(require("core.constants").NFT_FAKEIP_MARK);')"
dns_port="$(ucode -L "$FORKOP_LIB" -e 'print(require("singbox.constants").SOURCE_DNS_INBOUND_PORT);')"

[ -n "$NFT_FAKEIP_MARK" ] || fail "core constants must expose NFT_FAKEIP_MARK"
[ -n "$dns_port" ] || fail "sing-box constants must expose SOURCE_DNS_INBOUND_PORT"

grep -Fq "meta mark & $NFT_FAKEIP_MARK == $NFT_FAKEIP_MARK" "$INCLUDE_NFT" ||
  fail "the include must accept the FakeIP mark $NFT_FAKEIP_MARK that Forkop sets before TPROXY"
grep -Fq "th dport $dns_port" "$INCLUDE_NFT" ||
  fail "the include must accept DNS redirected to port $dns_port"
grep -Fq 'ct status dnat' "$INCLUDE_NFT" ||
  fail "the DNS accept must stay limited to packets Forkop redirected, not to the port itself"
grep -Fq 'forkop: TPROXY traffic' "$INCLUDE_NFT" ||
  fail "the TPROXY rule needs the comment postinst looks for in the running ruleset (tests/unit/service/package.test.uc)"

grep -Fq '$(INSTALL_DIR) $(1)/usr/share/nftables.d/chain-pre/input' "$FORKOP_MAKEFILE" ||
  fail "forkop/Makefile must install the fw4 input include"
grep -Fq 'usr/share/nftables.d/chain-pre/input/forkop.nft' "$BUILD_SCRIPT" ||
  fail "build.sh must stage the fw4 input include into the backend package root"

printf 'OK: firewall input include\n'
