#!/usr/bin/env bash
# A reload only regenerates sing-box when the signature changes, so any setting
# that reaches the generated config has to be part of that signature. Missing
# one makes Save & Apply look successful while the runtime keeps the old config.
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
STATE_UC="$FORKOP_LIB/service/state.uc"
GENERATOR_UC="$FORKOP_LIB/singbox/generator.uc"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

write_fixture() {
  local path="$1" extra="$2"
  cat >"$path" <<JSON
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ],
    "service_listen_address": "127.0.0.1"$extra
  },
  "section": [
    {
      ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection",
      "selector_proxy_links": [ "socks5://127.0.0.1:1080#Node" ],
      "rule_set": [ "https://example.com/list.srs" ]
    }
  ]
}
JSON
}

signature() {
  ucode -L "$FORKOP_LIB" "$STATE_UC" sing-box-signature-fixture "$1"
}

generate() {
  ucode -L "$FORKOP_LIB" "$GENERATOR_UC" generate-config-fixture "$1" "$2" 127.0.0.1 0
}

write_fixture "$WORK_DIR/base.json" ""
generate "$WORK_DIR/base.json" "$WORK_DIR/base-config.json"
base_signature="$(signature "$WORK_DIR/base.json")"

covered=0
for change in \
  '"dns_strategy": "prefer_ipv6"' \
  '"dns_rewrite_ttl": "120"' \
  '"disable_quic": "1"' \
  '"bittorrent_direct": "1"' \
  '"unified_delay": "1"' \
  '"static_hosts_text": "10.0.0.9 pinned.example"' \
  '"log_level": "debug"' \
  '"cache_path": "/tmp/other-cache.db"' \
  '"output_network_interface": "wan2"' \
  '"enable_yacd": "1"' \
  '"list_update_enabled": "0"' \
  '"update_interval": "6h"' \
  '"download_lists_via_proxy": "1", "download_lists_via_proxy_section": "proxy"' \
  '"dns_main_fallback_strategy": "sequential"'
do
  setting="${change%%\:*}"
  write_fixture "$WORK_DIR/changed.json" ", $change"
  generate "$WORK_DIR/changed.json" "$WORK_DIR/changed-config.json"

  # A setting that does not reach the config for this fixture proves nothing.
  if cmp -s "$WORK_DIR/base-config.json" "$WORK_DIR/changed-config.json"; then
    continue
  fi

  covered=$((covered + 1))
  [ "$(signature "$WORK_DIR/changed.json")" != "$base_signature" ] ||
    fail "$setting changes the generated config but not the sing-box signature, so a reload would skip it"
done

[ "$covered" -ge 10 ] ||
  fail "expected the fixture to exercise at least 10 settings, exercised $covered"

printf 'sing-box reload signature checks passed (%d settings)\n' "$covered"
