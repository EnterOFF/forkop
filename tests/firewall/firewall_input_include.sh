#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
PACKAGE_UC="$FORKOP_LIB/service/package.uc"
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

eval "$(ucode -L "$FORKOP_LIB" "$FORKOP_LIB/core/constants.uc" shell-env)"
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
  fail "the TPROXY rule needs the comment postinst looks for in the running ruleset"

grep -Fq '$(INSTALL_DIR) $(1)/usr/share/nftables.d/chain-pre/input' "$FORKOP_MAKEFILE" ||
  fail "forkop/Makefile must install the fw4 input include"
grep -Fq 'usr/share/nftables.d/chain-pre/input/forkop.nft' "$BUILD_SCRIPT" ||
  fail "build.sh must stage the fw4 input include into the backend package root"

grep -Fq 'FIREWALL_INPUT_MARKER' "$PACKAGE_UC" ||
  fail "service/package.uc must own the firewall include reload"

make_stub() {
  local path="$1"
  shift
  cat >"$path" <<SH
#!/usr/bin/env bash
$*
SH
  chmod 0755 "$path"
}

mkdir -p "$WORK_DIR/bin"
export PATH="$WORK_DIR/bin:$PATH"
touch "$WORK_DIR/include.nft"

run_postinst() {
  FORKOP_FIREWALL_INIT="$WORK_DIR/bin/firewall-init" \
  FORKOP_FIREWALL_INPUT_INCLUDE="$1" \
  FORKOP_PACKAGE_UPGRADE_STATE="$WORK_DIR/missing-upgrade-state" \
  FORKOP_INIT="$WORK_DIR/bin/forkop-init" \
    ucode -L "$FORKOP_LIB" "$PACKAGE_UC" postinst
}

make_stub "$WORK_DIR/bin/firewall-init" 'printf "%s\n" "$1" >>"${FIREWALL_LOG:?}"'
make_stub "$WORK_DIR/bin/forkop-init" 'exit 0'
export FIREWALL_LOG="$WORK_DIR/firewall.log"

# A running firewall without the accept rule has to be reloaded.
: >"$FIREWALL_LOG"
make_stub "$WORK_DIR/bin/nft" 'printf "chain input {\n\tiif \"lo\" accept\n}\n"'
run_postinst "$WORK_DIR/include.nft"
grep -Fxq reload "$FIREWALL_LOG" ||
  fail "postinst must reload the firewall when the running input chain lacks the Forkop accept"

# Reloading again on every upgrade would restart the firewall for nothing.
: >"$FIREWALL_LOG"
make_stub "$WORK_DIR/bin/nft" 'printf "chain input {\n\tmeta mark & 0x04000000 == 0x04000000 counter accept comment \"forkop: TPROXY traffic\"\n}\n"'
run_postinst "$WORK_DIR/include.nft"
[ ! -s "$FIREWALL_LOG" ] ||
  fail "postinst must leave a firewall that already carries the Forkop accept alone"

# A firewall that is not loaded reads the include on its own next start.
: >"$FIREWALL_LOG"
make_stub "$WORK_DIR/bin/nft" 'exit 1'
run_postinst "$WORK_DIR/include.nft"
[ ! -s "$FIREWALL_LOG" ] ||
  fail "postinst must not start a firewall the user keeps stopped"

# Without the shipped file there is nothing for a reload to pick up.
: >"$FIREWALL_LOG"
make_stub "$WORK_DIR/bin/nft" 'printf "chain input {\n\tiif \"lo\" accept\n}\n"'
run_postinst "$WORK_DIR/missing-include.nft"
[ ! -s "$FIREWALL_LOG" ] ||
  fail "postinst must not reload the firewall when the include is missing"

printf 'OK: firewall input include\n'
