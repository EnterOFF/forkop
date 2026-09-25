#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
LIFECYCLE_UC="$FORKOP_LIB/service/lifecycle.uc"
SINGBOX_RUNTIME_UC="$FORKOP_LIB/singbox/runtime.uc"
SINGBOX_GENERATOR_UC="$FORKOP_LIB/singbox/generator.uc"

grep -Fq 'singbox/runtime.uc' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc must call singbox/runtime.uc for sing-box runtime operations"
if grep -R -n -E 'sing_box_runtime_ucode|rulesets_ucode|sing_box_configure_service|sing_box_init_config|get_service_listen_address|get_device_ipv4_address|get_download_detour_tag' "$FORKOP_BIN" "$FORKOP_LIB" --include='*.sh' >/dev/null 2>&1; then
  fail "sing-box runtime shell symbols must not remain"
fi
grep -Fq 'mode == "configure-service"' "$SINGBOX_RUNTIME_UC" ||
  fail "singbox/runtime.uc must own sing-box service configuration"
grep -Fq 'mode == "init-config"' "$SINGBOX_RUNTIME_UC" ||
  fail "singbox/runtime.uc must own sing-box config initialization"
grep -Fq 'function sing_box_process_running()' "$SINGBOX_RUNTIME_UC" ||
  fail "singbox/runtime.uc must retain the process check used by config initialization"
grep -Fq 'mode == "service-listen-address"' "$SINGBOX_RUNTIME_UC" ||
  fail "singbox/runtime.uc must own service listen address detection"
grep -Fq 'mode == "service-proxy-address"' "$SINGBOX_RUNTIME_UC" ||
  fail "singbox/runtime.uc must own service proxy address detection"
if grep -Fq 'log_file_lines(runtime_log, "debug", "sing-box config generator: ");' "$SINGBOX_RUNTIME_UC"; then
  fail "singbox/runtime.uc must not duplicate generator failure output as debug log"
fi
if grep -Fq 'warn("unsupported: "' "$SINGBOX_GENERATOR_UC"; then
  fail "singbox/generator.uc must emit concise generator failure reasons"
fi
if grep -n -E 'require\("uci"\)\.cursor|uci -q|uci", "-q"' "$SINGBOX_RUNTIME_UC" >/dev/null 2>&1; then
  fail "singbox/runtime.uc must use core.uci instead of owning direct UCI cursor or CLI calls"
fi
if grep -n -E 'require\("uci"\)\.cursor|uci -q|uci", "-q"' "$SINGBOX_GENERATOR_UC" >/dev/null 2>&1; then
  fail "singbox/generator.uc must use core.uci instead of owning direct UCI cursor or CLI calls"
fi
grep -Fq 'require("core.uci")' "$SINGBOX_GENERATOR_UC" ||
  fail "singbox/generator.uc must import core.uci"
# The cache file lives under /tmp by default and sing-box does not create its
# directory: after a reboot it is gone and the core refuses to start with
# "initialize cache-file: no such file or directory". Nothing else creates it when
# the generated configuration turns out unchanged, which is the case after a reboot.
grep -Fq 'ensure_parent_dir(option(settings, "cache_path"' "$SINGBOX_RUNTIME_UC" ||
  fail "singbox/runtime.uc must create the directory of the sing-box cache file before a start"
if grep -Fq 'FORKOP_RULE_CONDITION_CACHE' "$LIFECYCLE_UC"; then
  fail "service/lifecycle.uc must not transport the retired rule-condition cache"
fi
if grep -Fq 'FORKOP_SECTION_CACHE_DIR' "$LIFECYCLE_UC"; then
  fail "service/lifecycle.uc must not transport the retired section-cache path"
fi
if grep -Fq 'runtime_manifest' "$SINGBOX_RUNTIME_UC"; then
  fail "singbox/runtime.uc must not depend on the retired runtime manifest"
fi

mkdir -p "$WORK_DIR/bin" "$WORK_DIR/lib/core"
cat >"$WORK_DIR/lib/core/packages.uc" <<'EOF_PACKAGES'
#!/usr/bin/ucode
if ((ARGV[0] || "") == "version" && (ARGV[1] || "") == "sing-box-forkop-compressed")
  print("1.13.14~extended~2.5.3~f1\n");
EOF_PACKAGES
cat >"$WORK_DIR/bin/sing-box" <<'EOF_SING_BOX'
#!/bin/sh
echo 'sing-box version 1.13.14-extended-2.5.3-f1'
EOF_SING_BOX
chmod +x "$WORK_DIR/bin/sing-box"
runtime_version="$(
  PATH="$WORK_DIR/bin:$PATH" FORKOP_LIB="$WORK_DIR/lib" \
    ucode -L "$FORKOP_LIB" "$SINGBOX_RUNTIME_UC" version
)"
[ "$runtime_version" = "1.13.14-extended-2.5.3-f1" ] ||
  fail "singbox/runtime.uc must report the installed sing-box-forkop version"

mkdir -p "$WORK_DIR/check-bin"
cat >"$WORK_DIR/check-bin/sing-box" <<'EOF_SING_BOX_CHECK'
#!/bin/sh
printf '\n' >&2
printf '%s\n' 'FATAL[0000] route: missing outbound tag' >&2
exit 42
EOF_SING_BOX_CHECK
chmod +x "$WORK_DIR/check-bin/sing-box"
: >"$WORK_DIR/invalid-config.json"
if PATH="$WORK_DIR/check-bin:$PATH" \
  ucode -L "$FORKOP_LIB" "$SINGBOX_RUNTIME_UC" check-config-fixture \
  "$WORK_DIR/invalid-config.json" "$WORK_DIR/sing-box-check.log" \
  >"$WORK_DIR/sing-box-check.reason"; then
  fail "singbox/runtime.uc check fixture should preserve a failed sing-box status"
fi
[ "$(cat "$WORK_DIR/sing-box-check.reason")" = 'FATAL[0000] route: missing outbound tag' ] ||
  fail "singbox/runtime.uc must return the first non-empty sing-box check diagnostic"
grep -Fq 'Generated sing-box configuration is invalid: " + check_result.reason' "$SINGBOX_RUNTIME_UC" ||
  fail "generated config failure must include the captured sing-box check diagnostic"

cat >"$WORK_DIR/generator-failure.log" <<'EOF_GENERATOR_FAILURE'
skipped one optional outbound
connection section has no usable outbounds
EOF_GENERATOR_FAILURE
generator_reason="$(ucode -L "$FORKOP_LIB" "$SINGBOX_RUNTIME_UC" generator-failure-reason-fixture \
  "$WORK_DIR/generator-failure.log" 2)"
[ "$generator_reason" = 'connection section has no usable outbounds' ] ||
  fail "singbox/runtime.uc must report the terminal generator error instead of an earlier warning"

mkdir -p "$WORK_DIR/etc" "$WORK_DIR/tmp"
printf 'old config\n' >"$WORK_DIR/etc/config.json"
printf 'new config\n' >"$WORK_DIR/tmp/config.json"
ucode -L "$FORKOP_LIB" "$SINGBOX_RUNTIME_UC" save-config-file-fixture \
  "$WORK_DIR/tmp/config.json" "$WORK_DIR/etc/config.json"
[ "$(cat "$WORK_DIR/etc/config.json")" = "new config" ] ||
  fail "singbox/runtime.uc must replace an existing config from a temp file"
[ ! -e "$WORK_DIR/tmp/config.json" ] ||
  fail "singbox/runtime.uc must consume the temp config after save"

generate_config() {
  local fixture="$1"
  local output="$2"
  local mwan3_active="${3:-0}"

  mkdir -p "$output.rulesets"
  ucode -L "$FORKOP_LIB" "$FORKOP_LIB/singbox/generator.uc" generate-config-fixture \
    "$fixture" "$output" "127.0.0.1" "$mwan3_active"
}

cat >"$WORK_DIR/no-enabled-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": []
}
JSON

if ucode -L "$FORKOP_LIB" "$SINGBOX_GENERATOR_UC" generate-config-fixture \
  "$WORK_DIR/no-enabled-fixture.json" "$WORK_DIR/no-enabled.json" "127.0.0.1" "0" \
  >"$WORK_DIR/no-enabled.stdout" 2>"$WORK_DIR/no-enabled.stderr"; then
  fail "generator should reject a config without enabled sections"
fi
if grep -Fq 'unsupported:' "$WORK_DIR/no-enabled.stderr"; then
  fail "generator failure reason must not include redundant unsupported prefix"
fi
grep -Fxq 'no usable sections or servers' "$WORK_DIR/no-enabled.stderr" ||
  fail "generator failure reason should be concise"

# An unfinished Connection section is the state every first configuration passes
# through, and it reaches neither an outbound nor a route. Counting enabled
# sections instead of usable ones let it pass as configured, and Forkop started
# on a config byte-identical to the one it refuses for an empty section list.
cat >"$WORK_DIR/unfinished-only-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "unfinished",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "domain_suffix": [ "unfinished.example" ]
    }
  ],
  "server": []
}
JSON

if ucode -L "$FORKOP_LIB" "$SINGBOX_GENERATOR_UC" generate-config-fixture \
  "$WORK_DIR/unfinished-only-fixture.json" "$WORK_DIR/unfinished-only.json" "127.0.0.1" "0" \
  >"$WORK_DIR/unfinished-only.stdout" 2>"$WORK_DIR/unfinished-only.stderr"; then
  fail "generator should reject a config whose only enabled section has no sources"
fi
grep -Fxq 'no usable sections or servers' "$WORK_DIR/unfinished-only.stderr" ||
  fail "an unfinished Connection section must not pass as a usable section"
[ ! -e "$WORK_DIR/unfinished-only.json" ] ||
  fail "generator must not write a config it refused to generate"

cat >"$WORK_DIR/empty-connection-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "empty",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "domain_suffix": [ "empty.example" ]
    },
    {
      ".name": "usable",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "subscription_urls": [ "https://example.com/sub.json" ]
    }
  ]
}
JSON
generate_config "$WORK_DIR/empty-connection-fixture.json" "$WORK_DIR/empty-connection.json"
if grep -Fq '"empty"' "$WORK_DIR/empty-connection.json"; then
  fail "empty Connection rule must be omitted from sing-box config"
fi
grep -Fq 'usable/sub1' "$WORK_DIR/empty-connection.json" ||
  fail "an empty Connection rule must not suppress the sections around it"

cat >"$WORK_DIR/deferred-section-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "subscription_only",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "subscription_urls": [ "https://example.com/sub.json" ]
    }
  ]
}
JSON
if ! ucode -L "$FORKOP_LIB" "$SINGBOX_GENERATOR_UC" generate-config-fixture \
  "$WORK_DIR/deferred-section-fixture.json" "$WORK_DIR/deferred-section.json" "127.0.0.1" "0"; then
  fail "generator must emit subscription-only sections as native providers"
fi
if ! grep -Fq 'subscription_only/sub1' "$WORK_DIR/deferred-section.json"; then
  fail "subscription-only section must be emitted as a native provider"
fi
if grep -Fq 'prepare_subscription_caches' "$SINGBOX_RUNTIME_UC"; then
  fail "singbox/runtime.uc must not prepare Forkop subscription caches"
fi

cat >"$WORK_DIR/tunnel-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "cache_path": "/tmp/sing-box/cache.db",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "tunnels",
      ".type": "section",
      "enabled": "1",
      "action": "connection"
    },
    {
      ".name": "control",
      ".type": "section",
      "enabled": "1",
      "action": "outbound",
      "outbound_json": "{\"type\":\"direct\"}"
    }
  ],
  "tunnel": [
    {
      ".name": "tun_warp", ".type": "tunnel", "section": "tunnels", "order": "0",
      "kind": "warp", "name": "Cloudflare WARP", "amnezia_jc": "7",
      "warp_profile_id": "profile-id", "warp_profile_auth_token": "auth-token",
      "warp_profile_private_key": "private-key", "warp_profile_license_key": "license-key",
      "amnezia_i1": "<r 1>", "amnezia_content_padding_addition": "8-16",
      "amnezia_s1": "40", "amnezia_h1": "100-200",
      "amnezia_header_protection_key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    },
    {
      ".name": "tun_amnezia", ".type": "tunnel", "section": "tunnels", "order": "1",
      "kind": "amneziawg", "name": "Amnezia", "address": ["10.0.0.2/32"],
      "private_key": "private", "amnezia_jc": "5", "amnezia_h1": "100"
    },
    {
      ".name": "tun_bare", ".type": "tunnel", "section": "tunnels", "order": "5",
      "kind": "wireguard", "name": "Bare", "address": ["10.0.0.4/32"],
      "private_key": "private"
    },
    {
      ".name": "tun_plain", ".type": "tunnel", "section": "tunnels", "order": "4",
      "kind": "wireguard", "name": "Plain", "address": ["10.0.0.3/32"],
      "private_key": "private", "amnezia_jc": "3", "amnezia_i1": "<r 2>",
      "amnezia_s1": "64", "amnezia_h1": "100-200",
      "amnezia_header_protection_key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    },
    {
      ".name": "tun_tailnet", ".type": "tunnel", "section": "tunnels", "order": "2",
      "kind": "tailscale", "name": "Tailnet", "tailscale_auth_key": "tskey-auth-test",
      "tailscale_hostname": "forkop-router", "tailscale_exit_node": "100.64.0.1",
      "tailscale_detour_section": "control"
    },
    {
      ".name": "tun_json", ".type": "tunnel", "section": "tunnels", "order": "3",
      "kind": "json", "endpoint_json": "{\"type\":\"vpn-client\",\"tag\":\"custom-endpoint\",\"server\":\"vpn.example.com\"}"
    }
  ],
  "tunnel_peer": [
    {
      ".name": "peer_amnezia", ".type": "tunnel_peer", "tunnel": "tun_amnezia", "order": "0",
      "address": "vpn.example.com", "port": "51820", "public_key": "public",
      "allowed_ips": ["0.0.0.0/0"]
    },
    {
      ".name": "peer_plain", ".type": "tunnel_peer", "tunnel": "tun_plain", "order": "0",
      "address": "wg.example.com", "port": "51820", "public_key": "public",
      "allowed_ips": ["0.0.0.0/0"]
    },
    {
      ".name": "peer_bare", ".type": "tunnel_peer", "tunnel": "tun_bare", "order": "0",
      "address": "wg.example.com", "port": "51820", "public_key": "public",
      "allowed_ips": ["0.0.0.0/0"]
    }
  ]
}
JSON
generate_config "$WORK_DIR/tunnel-fixture.json" "$WORK_DIR/tunnel.json"
node - "$WORK_DIR/tunnel.json" <<'NODE'
const fs = require('fs');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const warp = config.endpoints.find((endpoint) => endpoint.tag === 'tunnels/Cloudflare WARP');
const amnezia = config.endpoints.find((endpoint) => endpoint.tag === 'tunnels/Amnezia');
const tailscale = config.endpoints.find((endpoint) => endpoint.tag === 'tunnels/Tailnet');
const plain = config.endpoints.find((endpoint) => endpoint.tag === 'tunnels/Plain');
const custom = config.endpoints.find((endpoint) => endpoint.tag === 'tunnels/custom-endpoint');
const selector = config.outbounds.find((outbound) => outbound.tag === 'tunnels');
if (
  !warp ||
  warp.type !== 'warp' ||
  warp.profile?.license_key !== 'license-key' ||
  warp.amnezia?.jc !== 7 ||
  warp.amnezia?.i1 !== '<r 1>' ||
  warp.amnezia?.content_padding_addition !== '8-16' ||
  warp.amnezia?.s1 != null ||
  warp.amnezia?.h1 != null ||
  warp.amnezia?.header_protection_key != null
)
  throw new Error('native WARP endpoint contains incorrect Amnezia obfuscation fields');
if (
  !amnezia ||
  amnezia.type !== 'amneziawg' ||
  amnezia.amnezia?.jc !== 5 ||
  amnezia.amnezia?.h1 !== 100
)
  throw new Error('native AmneziaWG endpoint missing');
if (
  !plain ||
  plain.type !== 'wireguard' ||
  plain.amnezia?.jc !== 3 ||
  plain.amnezia?.i1 !== '<r 2>' ||
  plain.amnezia?.s1 != null ||
  plain.amnezia?.h1 != null ||
  plain.amnezia?.header_protection_key != null
)
  throw new Error('a WireGuard endpoint must carry only one-sided Amnezia fields');
for (const endpoint of config.endpoints) {
  if (endpoint.amnezia && Object.keys(endpoint.amnezia).length === 0)
    throw new Error(`an empty Amnezia block was written for ${endpoint.tag}`);
}
if (
  tailscale?.type !== 'tailscale' ||
  tailscale.state_directory !== '/etc/forkop/tailscale/tunnels-tun_tailnet' ||
  tailscale.detour !== 'control' ||
  tailscale.exit_node_allow_lan_access !== true
) throw new Error(`native Tailscale endpoint settings are not generated correctly: ${JSON.stringify(tailscale)}`);
if (custom?.type !== 'vpn-client' || custom.tag !== 'tunnels/custom-endpoint' || custom.detour)
  throw new Error('JSON endpoint was not preserved with a stable tag');
if (
  !selector?.outbounds?.includes(warp.tag) ||
  !selector.outbounds.includes(amnezia.tag) ||
  !selector.outbounds.includes(tailscale.tag) ||
  !selector.outbounds.includes(custom.tag)
)
  throw new Error('tunnels are not selectable connection outbounds');
if (config.experimental?.cache_file?.enabled !== true || config.experimental.cache_file.path !== '/tmp/sing-box/cache.db')
  throw new Error('sing-box state cache is not enabled at the configured path');
if (config.experimental?.cache_file?.store_warp_config !== true)
  throw new Error('WARP profile cache is not enabled');
NODE

cat >"$WORK_DIR/generator-uci.state" <<'EOF_UCI'
forkop.settings=settings
forkop.settings.dns_server=1.1.1.1
forkop.settings.bootstrap_dns_server=1.1.1.1
forkop.settings.config_path=/tmp/sing-box/config.json
forkop.settings.cache_path=/tmp/sing-box/cache.db
forkop.settings.log_level=warn
forkop.uci_proxy=section
forkop.uci_proxy.enabled=1
forkop.uci_proxy.action=connection
forkop.uci_proxy.outbound_jsons={"type":"direct"}
forkop.uci_proxy.domain_suffix=example.org
EOF_UCI
FORKOP_UCI_STATE_FILE="$WORK_DIR/generator-uci.state" \
  ucode -L "$FORKOP_LIB" "$SINGBOX_GENERATOR_UC" generate-config "$WORK_DIR/generated-from-uci.json" "127.0.0.1" "0"
grep -Fq '"example.org"' "$WORK_DIR/generated-from-uci.json" ||
  fail "singbox/generator.uc must read section matchers from core.uci"
grep -Fq '"uci_proxy"' "$WORK_DIR/generated-from-uci.json" ||
  fail "singbox/generator.uc must read section names from core.uci"

cat >"$WORK_DIR/disabled-updates-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "list_update_enabled": "0",
    "update_interval": "5m",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "outbound_jsons": [ "{\"type\":\"direct\"}" ],
      "domain_suffix": [ "example.org" ],
      "rule_set": [ "https://example.com/rules.srs" ],
      "ports": [ "8443" ]
    }
  ]
}
JSON

cat >"$WORK_DIR/default-updates-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "outbound",
      "outbound_json": "{\"type\":\"direct\"}",
      "rule_set": [ "https://example.com/rules.srs" ]
    }
  ]
}
JSON

cat >"$WORK_DIR/server-inbound-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "outbound",
      "outbound_json": "{\"type\":\"direct\"}",
      "domain_suffix": [ "example.org" ]
    }
  ],
  "server": [
    {
      ".name": "unfinished",
      ".type": "server",
      "protocol": "shadowsocks",
      "shadowsocks_method": "2022-blake3-aes-128-gcm",
      "listen": "0.0.0.0",
      "routing_mode": "direct"
    },
    {
      ".name": "edge",
      ".type": "server",
      "enabled": "1",
      "protocol": "mixed",
      "mixed_auth_enabled": "1",
      "listen": "0.0.0.0",
      "listen_port": "18080",
      "routing_mode": "direct"
    },
    {
      ".name": "tailnet",
      ".type": "server",
      "enabled": "1",
      "protocol": "tailscale",
      "tailscale_auth_key": "tskey-auth-server",
      "tailscale_hostname": "forkop-server",
      "tailscale_detour_enabled": "1",
      "tailscale_detour_section": "proxy",
      "routing_mode": "direct"
    },
    {
      ".name": "open",
      ".type": "server",
      "enabled": "1",
      "protocol": "mixed",
      "mixed_auth_enabled": "1",
      "listen": "0.0.0.0",
      "listen_port": "18081",
      "mixed_auth_enabled": "0",
      "routing_mode": "direct"
    },
    {
      ".name": "mtproxy",
      ".type": "server",
      "enabled": "1",
      "protocol": "mtproto",
      "listen": "0.0.0.0",
      "listen_port": "18442",
      "mtproto_faketls": "google.com",
      "routing_mode": "direct"
    },
    {
      ".name": "naive",
      ".type": "server",
      "enabled": "1",
      "protocol": "naive",
      "listen": "0.0.0.0",
      "listen_port": "18443",
      "security": "tls",
      "tls_certificate_path": "/etc/forkop/server-certs/naive.crt",
      "tls_key_path": "/etc/forkop/server-certs/naive.key",
      "naive_network": "tcp_udp",
      "routing_mode": "direct"
    },
    {
      ".name": "ssh",
      ".type": "server",
      "enabled": "1",
      "protocol": "ssh",
      "listen": "0.0.0.0",
      "listen_port": "18222",
      "ssh_host_key_path": [ "/etc/forkop/ssh/host_key" ],
      "routing_mode": "direct"
    },
    {
      ".name": "mieru",
      ".type": "server",
      "enabled": "1",
      "protocol": "mieru",
      "listen": "0.0.0.0",
      "listen_port": "18444",
      "mieru_transport": "UDP",
      "routing_mode": "direct"
    },
    {
      ".name": "anytls",
      ".type": "server",
      "enabled": "1",
      "protocol": "anytls",
      "listen": "0.0.0.0",
      "listen_port": "18445",
      "label": "AnyTLS user",
      "security": "tls",
      "tls_certificate_path": "/etc/forkop/server-certs/anytls.crt",
      "tls_key_path": "/etc/forkop/server-certs/anytls.key",
      "routing_mode": "direct"
    },
    {
      ".name": "tuic",
      ".type": "server",
      "enabled": "1",
      "protocol": "tuic",
      "listen": "0.0.0.0",
      "listen_port": "18446",
      "label": "TUIC user",
      "security": "tls",
      "tls_certificate_path": "/etc/forkop/server-certs/tuic.crt",
      "tls_key_path": "/etc/forkop/server-certs/tuic.key",
      "tuic_congestion_control": "bbr",
      "tuic_heartbeat": "12s",
      "tuic_zero_rtt_handshake": "1",
      "routing_mode": "direct"
    },
    {
      ".name": "vlessmux",
      ".type": "server",
      "enabled": "1",
      "protocol": "vless",
      "listen": "0.0.0.0",
      "listen_port": "18447",
      "label": "VLESS mux",
      "security": "reality",
      "reality_private_key": "reality-private",
      "reality_public_key": "reality-public",
      "reality_short_id": [ "abcd" ],
      "multiplex_enabled": "1",
      "multiplex_padding": "1",
      "routing_mode": "direct"
    },
    {
      ".name": "ss2022",
      ".type": "server",
      "enabled": "1",
      "protocol": "shadowsocks",
      "listen": "0.0.0.0",
      "listen_port": "18448",
      "label": "Shadowsocks 2022",
      "shadowsocks_method": "2022-blake3-aes-128-gcm",
      "shadowsocks_psk": "c2VydmVyLXByZXNoYXJlZC1rZXk=",
      "routing_mode": "direct"
    }
  ],
  "server_client": [
    {
      ".name": "edge_tester",
      ".type": "server_client",
      "server": "edge",
      "name": "tester",
      "password": "secret"
    },
    {
      ".name": "edge_ruled",
      ".type": "server_client",
      "server": "edge",
      "name": "ruled",
      "password": "ruled-secret",
      "routing_override": "1",
      "routing_mode": "rules"
    },
    {
      ".name": "open_ignored",
      ".type": "server_client",
      "server": "open",
      "name": "ignored",
      "password": "ignored"
    },
    {
      ".name": "mtproxy_phone",
      ".type": "server_client",
      "server": "mtproxy",
      "name": "phone",
      "secret": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    {
      ".name": "naive_user",
      ".type": "server_client",
      "server": "naive",
      "name": "naive-user",
      "password": "naive-password"
    },
    {
      ".name": "ssh_user",
      ".type": "server_client",
      "server": "ssh",
      "name": "ssh-user",
      "password": "ssh-password",
      "authorized_keys": [ "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 user@host" ]
    },
    {
      ".name": "mieru_user",
      ".type": "server_client",
      "server": "mieru",
      "name": "mieru-user",
      "password": "mieru-password"
    },
    {
      ".name": "anytls_user",
      ".type": "server_client",
      "server": "anytls",
      "name": "anytls-client",
      "password": "anytls-password"
    },
    {
      ".name": "tuic_user",
      ".type": "server_client",
      "server": "tuic",
      "name": "tuic-client",
      "uuid": "33333333-3333-4333-8333-333333333333",
      "password": "tuic-password"
    },
    {
      ".name": "vlessmux_phone",
      ".type": "server_client",
      "server": "vlessmux",
      "name": "phone",
      "uuid": "44444444-4444-4444-8444-444444444444",
      "flow": "xtls-rprx-vision"
    },
    {
      ".name": "vlessmux_laptop",
      ".type": "server_client",
      "server": "vlessmux",
      "name": "laptop",
      "uuid": "55555555-5555-4555-8555-555555555555",
      "routing_override": "1",
      "routing_mode": "direct"
    },
    {
      ".name": "ss2022_phone",
      ".type": "server_client",
      "server": "ss2022",
      "name": "phone",
      "password": "Y2xpZW50LXByZXNoYXJlZC1rZXk="
    }
  ]
}
JSON

cat >"$WORK_DIR/runtime-matchers-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "dns_strategy": "prefer_ipv6",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "detour",
      ".type": "section",
      "enabled": "1",
      "action": "outbound",
      "outbound_json": "{\"type\":\"direct\"}",
      "domain_suffix": [ "detour.example" ]
    },
    {
      ".name": "bypass",
      ".type": "section",
      "enabled": "1",
      "action": "bypass",
      "domain_suffix": [ "example.org" ],
      "source_ip_cidr": [ "10.0.0.3/32" ],
      "ports": [ "443" ]
    },
    {
      ".name": "bypass_ruleset",
      ".type": "section",
      "enabled": "1",
      "action": "bypass",
      "rule_set": [ "https://example.com/bypass-port.srs" ],
      "source_ip_cidr": [ "10.0.0.4/32" ],
      "ports": [ "8443" ]
    },
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "selector_proxy_links": [ "socks5://127.0.0.1:1080" ],
      "domain": "commented.example # ignored.example\nfull:exact-comment.example // ignored-full.example\nfull:source-priority.test\nkeyword:clip",
      "domain_suffix": [ "proxy.example.org", "сайт.рф", "full:пример.испытание", "keyword:пример", "regex:^сайт[.]рф$" ],
      "ip_cidr": "77.111.247.0/24 #77.111.247.19\n198.51.100.0/24 //203.0.113.0/24",
      "source_ip_cidr": "10.0.0.2/32 #10.0.0.99\n2001:db8::2/128 //2001:db8::99/128\n@system",
      "ports_text": "80 # 443\n8080 // 8443",
      "outbound_detour_enabled": "1",
      "outbound_detour_section": "detour"
    },
    {
      ".name": "proxy_global",
      ".type": "section",
      "enabled": "1",
      "action": "outbound",
      "outbound_json": "{\"type\":\"direct\"}",
      "domain_suffix": [ "example.org" ]
    },
    {
      ".name": "bypass_global",
      ".type": "section",
      "enabled": "1",
      "action": "bypass",
      "domain": [ "source-priority.test" ]
    }
  ],
  "server": [
    {
      ".name": "server_proxy_mixed",
      ".type": "server",
      "enabled": "1",
      "label": "proxy - Mixed proxy",
      "protocol": "mixed",
      "mixed_auth_enabled": "1",
      "listen": "0.0.0.0",
      "listen_port": "19090",
      "open_firewall": "0",
      "routing_mode": "section",
      "routing_section": "proxy"
    }
  ],
  "server_client": [
    {
      ".name": "client_proxy_mixed",
      ".type": "server_client",
      "server": "server_proxy_mixed",
      "name": "user",
      "password": "pass"
    }
  ]
}
JSON

cat >"$WORK_DIR/dns-action.lst" <<'EOF_DNS_ACTION_LIST'
list-dns.example
198.51.100.0/24
EOF_DNS_ACTION_LIST
cat >"$WORK_DIR/dns-action-fixture.json" <<JSON
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "dns_first",
      ".type": "section",
      "enabled": "1",
      "action": "dns",
      "dns_server": [ "tls://9.9.9.9:5353", "https://1.1.1.1/dns-query", "quic://9.9.9.9", "h3://1.1.1.1/dns-query", "tcp://8.8.8.8", "8.8.4.4" ],
      "dns_fallback_strategy": "sequential",
      "dns_detour_enabled": "1",
      "dns_detour_section": "detour",
      "domain_suffix": [ "dns-first.example" ],
      "community_lists": [ "youtube" ],
      "rule_set": [ "https://example.com/domain-only.srs", "$WORK_DIR/dns-action.lst" ],
      "ip_cidr": [ "203.0.113.0/24" ],
      "source_ip_cidr": [ "192.0.2.1/32" ],
      "fully_routed_ips": [ "192.0.2.2/32" ],
      "ports": [ "443" ]
    },
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "outbound_jsons": [ "{\"type\":\"direct\"}" ],
      "domain_suffix": [ "dns-first.example", "proxy-first.example" ]
    },
    {
      ".name": "dns_second",
      ".type": "section",
      "enabled": "1",
      "action": "dns",
      "dns_server": [ "8.8.8.8" ],
      "domain_suffix": [ "proxy-first.example" ],
      "fully_routed_ips": [ "192.0.2.3/32" ]
    },
    {
      ".name": "detour",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "outbound_jsons": [ "{\"type\":\"direct\"}" ],
      "domain_suffix": [ "detour.example" ]
    }
  ]
}
JSON

cat >"$WORK_DIR/urltest-filter-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "outbound_jsons": [
        "{\"type\":\"http\",\"tag\":\"Keep\",\"server\":\"127.0.0.1\",\"server_port\":18081}",
        "{\"type\":\"http\",\"tag\":\"Drop\",\"server\":\"127.0.0.1\",\"server_port\":18082}"
      ],
      "urltest_enabled": "1",
      "urltest_server_filter_mode": "include",
      "urltest_include_outbounds": [ "Keep" ],
      "domain_suffix": [ "example.org" ]
    }
  ]
}
JSON

cat >"$WORK_DIR/manual-http-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "dns_server": "1.1.1.1"
  },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "selector_proxy_links": [ "http://127.0.0.1:8080" ]
    }
  ]
}
JSON

cat >"$WORK_DIR/manual-transport-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "selector_proxy_links": [
        "vless://11111111-1111-4111-8111-111111111111@127.0.0.1:443?security=tls&type=ws&path=%2Fws&host=example.com&sni=example.com&alpn=h2%2Chttp%2F1.1&encryption=mlkem768x25519plus.native.test#WS",
        "vmess://eyJ2IjoiMiIsInBzIjoiVk1lc3MgV1MiLCJhZGQiOiIxMjcuMC4wLjEiLCJwb3J0IjoiNDQzIiwiaWQiOiIyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIiLCJhaWQiOiI0Iiwic2N5IjoiYXV0byIsIm5ldCI6IndzIiwidHlwZSI6Im5vbmUiLCJob3N0Ijoidm1lc3MuZXhhbXBsZSIsInBhdGgiOiIvdm1lc3MiLCJ0bHMiOiJ0bHMiLCJzbmkiOiJ2bWVzcy5leGFtcGxlIiwiYWxwbiI6ImgyLGh0dHAvMS4xIiwiZnAiOiJjaHJvbWUifQ==#VMess",
        "ss://YWVzLTEyOC1nY206cGFzcw@127.0.0.1:8388#SS"
      ],
      "domain_suffix": [ "example.org" ]
    }
  ]
}
JSON

cat >"$WORK_DIR/vpn-interface-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "renamed_awg",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "domain_suffix": [ "vpn.example" ]
    },
    {
      ".name": "detoured_awg",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "label": "Detoured",
      "domain_suffix": [ "detour.example" ]
    },
    {
      ".name": "resolver_detour",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "label": "Resolver detour",
      "selector_proxy_links": [ "vless://00000000-0000-4000-8000-000000000003@127.0.0.1:8443?security=none&type=tcp#Detour" ]
    }
  ],
  "section_interface": [
    {
      ".name": "vpn-interface",
      ".type": "section_interface",
      "section": "renamed_awg",
      "name": "tun0",
      "domain_resolver_enabled": "1",
      "domain_resolver_dns_server": [ "https://dns.example/dns-query", "tls://1.1.1.1" ],
      "domain_resolver_dns_fallback_strategy": "sequential"
    },
    {
      ".name": "detour-interface",
      ".type": "section_interface",
      "section": "detoured_awg",
      "name": "tun1",
      "domain_resolver_enabled": "1",
      "domain_resolver_dns_server": [ "9.9.9.9" ],
      "domain_resolver_dns_detour_enabled": "1",
      "domain_resolver_dns_detour_section": "resolver_detour"
    }
  ]
}
JSON

cat >"$WORK_DIR/download-via-proxy-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1",
    "download_lists_via_proxy": "1",
    "download_subscriptions_via_proxy": "1",
    "download_components_via_proxy": "1",
    "download_lists_via_proxy_section": "proxy",
    "download_components_via_proxy_section": "components_proxy"
  },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "outbound",
      "outbound_json": "{\"type\":\"socks\",\"server\":\"127.0.0.1\",\"server_port\":1080}",
      "domain_suffix": [ "example.org" ],
      "community_lists": [ "discord" ],
      "rule_set": [ "https://example.com/rules.srs" ],
      "rule_set_with_subnets": [ "https://example.com/mixed.txt" ]
    },
    {
      ".name": "components_proxy",
      ".type": "section",
      "enabled": "1",
      "action": "outbound",
      "outbound_json": "{\"type\":\"socks\",\"server\":\"127.0.0.2\",\"server_port\":1080}",
      "domain_suffix": [ "components.example" ]
    }
  ]
}
JSON

cat >"$WORK_DIR/fully-routed-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "proxy_high",
      ".type": "section",
      "enabled": "1",
      "action": "outbound",
      "outbound_json": "{\"type\":\"direct\"}",
      "domain_suffix": [ "forced-higher.test" ]
    },
    {
      ".name": "bypass",
      ".type": "section",
      "enabled": "1",
      "action": "bypass",
      "fully_routed_ips": [ "192.168.1.20/32", "192.168.1.30/32", "2001:db8::20/128", "@system" ],
      "domain_suffix": [ "example.org" ]
    },
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "outbound",
      "outbound_json": "{\"type\":\"direct\"}",
      "fully_routed_ips": [ "192.168.1.40/32" ],
      "domain_suffix": [ "proxy.example.org", "forced-lower.test" ]
    }
  ]
}
JSON

cat >"$WORK_DIR/mwan3-auto-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "outbound",
      "outbound_json": "{\"type\":\"direct\"}",
      "domain_suffix": [ "example.org" ]
    }
  ]
}
JSON

cat >"$WORK_DIR/mwan3-pinned-fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1",
    "output_network_interface": "wan2"
  },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "outbound",
      "outbound_json": "{\"type\":\"direct\"}",
      "domain_suffix": [ "example.org" ]
    }
  ]
}
JSON

cat >"$WORK_DIR/domain-ip.lst" <<'EOF_LIST'
example.net
203.0.113.0/24
EOF_LIST

cat >"$WORK_DIR/with-subnets.json" <<'JSON'
{
  "version": 3,
  "rules": [
    { "domain_suffix": [ "ruleset.example" ], "ip_cidr": [ "198.51.100.0/24" ] }
  ]
}
JSON

cat >"$WORK_DIR/universal-rulesets-fixture.json" <<JSON
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_path": "/tmp/sing-box/config.json",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "outbound",
      "outbound_json": "{\\"type\\":\\"direct\\"}",
      "domain_suffix": [ "example.org" ],
      "rule_set_with_subnets": [ "$WORK_DIR/with-subnets.json", "$WORK_DIR/domain-ip.lst", "https://example.com/domain-ip.txt" ]
    }
  ]
}
JSON

cat >"$WORK_DIR/manual-xhttp-fixture.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": "1.1.1.1" },
  "section": [
    {
      ".name": "manual_xhttp",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "selector_proxy_links": [
        "vless://00000000-0000-4000-8000-000000000001@xhttp.example:443?encryption=none&security=tls&sni=xhttp.example&type=xhttp#Manual XHTTP"
      ]
    }
  ]
}
JSON

cat >"$WORK_DIR/json-xhttp-fixture.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": "1.1.1.1" },
  "section": [
    {
      ".name": "json_xhttp",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "outbound_jsons": [
        "{\"type\":\"vless\",\"tag\":\"JSON XHTTP\",\"server\":\"xhttp.example\",\"server_port\":443,\"uuid\":\"00000000-0000-4000-8000-000000000002\",\"transport\":{\"type\":\"xhttp\"}}"
      ]
    }
  ]
}
JSON

generate_config "$WORK_DIR/disabled-updates-fixture.json" "$WORK_DIR/disabled.json"
generate_config "$WORK_DIR/default-updates-fixture.json" "$WORK_DIR/default.json"
generate_config "$WORK_DIR/server-inbound-fixture.json" "$WORK_DIR/server.json"
generate_config "$WORK_DIR/runtime-matchers-fixture.json" "$WORK_DIR/matchers.json"
generate_config "$WORK_DIR/dns-action-fixture.json" "$WORK_DIR/dns-action.json"
generate_config "$WORK_DIR/urltest-filter-fixture.json" "$WORK_DIR/urltest.json"
generate_config "$WORK_DIR/manual-http-fixture.json" "$WORK_DIR/manual-http.json"
grep -Fq '"type": "parser"' "$WORK_DIR/manual-http.json" ||
  fail "manual connection URLs must be passed to parser outbounds"
generate_config "$WORK_DIR/manual-transport-fixture.json" "$WORK_DIR/manual.json"
grep -Fq 'vless://11111111-1111-4111-8111-111111111111@127.0.0.1:443?security=tls&amp;type=ws' "$WORK_DIR/manual.json" ||
  grep -Fq 'vless://11111111-1111-4111-8111-111111111111@127.0.0.1:443?security=tls&type=ws' "$WORK_DIR/manual.json" ||
  fail "manual connection URLs must stay verbatim for parser outbounds"
generate_config "$WORK_DIR/vpn-interface-fixture.json" "$WORK_DIR/vpn.json"
generate_config "$WORK_DIR/download-via-proxy-fixture.json" "$WORK_DIR/download.json"
generate_config "$WORK_DIR/fully-routed-fixture.json" "$WORK_DIR/fully-routed.json"
generate_config "$WORK_DIR/mwan3-auto-fixture.json" "$WORK_DIR/mwan3-auto.json" 1
generate_config "$WORK_DIR/mwan3-pinned-fixture.json" "$WORK_DIR/mwan3-pinned.json" 1
generate_config "$WORK_DIR/universal-rulesets-fixture.json" "$WORK_DIR/universal-rulesets.json"
generate_config "$WORK_DIR/manual-xhttp-fixture.json" "$WORK_DIR/manual-xhttp.json"
grep -Fq 'type=xhttp' "$WORK_DIR/manual-xhttp.json" ||
  fail "XHTTP connection URLs must be delegated to the native provider parser"
generate_config "$WORK_DIR/json-xhttp-fixture.json" "$WORK_DIR/json-xhttp.json"
grep -Fq '"type": "xhttp"' "$WORK_DIR/json-xhttp.json" ||
  fail "sing-box-forkop must accept explicit JSON XHTTP configuration"

ucode -e '
let fs = require("fs");
let dir = ARGV[0];

function cfg(name) {
    return json(fs.readfile(dir + "/" + name + ".json"));
}

function as_array(value) {
    if (value == null)
        return [];
    return type(value) == "array" ? value : [ value ];
}

function contains(values, needle) {
    for (let value in as_array(values))
        if (value == needle)
            return true;
    return false;
}

function assert(condition, message) {
    if (!condition) {
        warn("FAIL: ", message, "\n");
        exit(1);
    }
}

function no_internal_fields(value) {
    if (type(value) == "array") {
        for (let item in value)
            if (!no_internal_fields(item))
                return false;
    }
    else if (type(value) == "object") {
        for (let key, item in value) {
            if (substr(key, 0, 2) == "__")
                return false;
            if (!no_internal_fields(item))
                return false;
        }
    }
    return true;
}

function first_remote_ruleset(config) {
    for (let rule_set in config.route.rule_set || [])
        if (rule_set && rule_set.type == "remote")
            return rule_set;
    return null;
}

function ruleset(config, tag) {
    for (let rule_set in config.route.rule_set || [])
        if (rule_set && rule_set.tag == tag)
            return rule_set;
    return null;
}

function ruleset_url(config, url) {
    for (let rule_set in config.route.rule_set || [])
        if (rule_set && rule_set.url == url)
            return rule_set;
    return null;
}

function ruleset_path(config, path) {
    for (let rule_set in config.route.rule_set || [])
        if (rule_set && rule_set.path == path)
            return rule_set;
    return null;
}

function outbound(config, tag) {
    for (let item in config.outbounds || [])
        if (item && item.tag == tag)
            return item;
    return null;
}

function provider(config, tag) {
    for (let item in config.providers || [])
        if (item && item.tag == tag)
            return item;
    return null;
}

function inbound(config, tag) {
    for (let item in config.inbounds || [])
        if (item && item.tag == tag)
            return item;
    return null;
}

function route_rule(config, predicate) {
    for (let rule in config.route.rules || [])
        if (rule && predicate(rule))
            return rule;
    return null;
}

function route_rule_index(config, predicate) {
    let rules = config.route.rules || [];
    for (let i = 0; i < length(rules); i++)
        if (rules[i] && predicate(rules[i]))
            return i;
    return -1;
}

function dns_rule(config, predicate) {
    for (let rule in config.dns.rules || [])
        if (rule && predicate(rule))
            return rule;
    return null;
}

function dns_rule_index(config, predicate) {
    let rules = config.dns.rules || [];
    for (let i = 0; i < length(rules); i++)
        if (rules[i] && predicate(rules[i]))
            return i;
    return -1;
}

function dns_server(config, predicate) {
    for (let server in config.dns.servers || [])
        if (server && predicate(server))
            return server;
    return null;
}

let disabled = cfg("disabled");
assert(first_remote_ruleset(disabled).update_interval == null, "disabled list updates omit the interval");
assert(route_rule(disabled, r => r.action == "resolve") == null,
    "no section resolves a destination before routing it any more");
let disabled_route = route_rule(disabled, r => r.type == "logical" && r.outbound == "proxy");
assert(disabled_route != null && length(disabled_route.rules || []) == 2 &&
    contains(disabled_route.rules[0].rule_set, first_remote_ruleset(disabled).tag) &&
    contains(disabled_route.rules[1].port, 8443), "section ports constrain the complete rule-set matcher");

let defaults = cfg("default");
assert(first_remote_ruleset(defaults).update_interval == "1d", "default list update interval");
assert(defaults.experimental.unified_delay.enabled === true, "Unified Delay setting is generated");
assert(defaults.dns.strategy == "prefer_ipv4", "missing DNS strategy keeps the prefer_ipv4 default");
assert(inbound(defaults, "source-dns-in") != null, "interface DNS inbound is always generated");
assert(dns_server(defaults, r => r.tag == "dnsmasq-server") != null, "the local resolver is always available as a DNS server");
assert(dns_rule(defaults, r => r.server == "dns-server" && contains(r.inbound, "source-dns-in") && r.source_ip_cidr == null && r.domain == null && r.domain_suffix == null && r.domain_regex == null && r.rule_set == null && r.query_type == null) != null, "unmatched interface DNS resolves through the Forkop DNS by default");
assert(dns_rule(defaults, r => r.server == "dnsmasq-server" && contains(r.inbound, "source-dns-in") && r.domain_regex == "^[^.]+$") != null, "the local resolver keeps the zone it is authoritative for");

let server = cfg("server");
// A server without the switch is one whose dialog was never saved. The runtime
// check and the reload signature both read that as off, so generating an inbound
// for it would hand sing-box a server nothing ever checked.
assert(inbound(server, "unfinished") == null, "a server without the enable switch is not generated");
let mixed = inbound(server, "edge");
assert(mixed && mixed.type == "mixed" && mixed.listen_port == 18080, "server mixed inbound answers SOCKS5 and HTTP on one port");
assert(mixed.users && mixed.users[0].username == "tester" && mixed.users[0].password == "secret", "mixed server authentication produces a user list");
let tailscale_server = null;
for (let endpoint in server.endpoints || [])
    if (endpoint && endpoint.tag == "tailnet")
        tailscale_server = endpoint;
assert(tailscale_server && tailscale_server.type == "tailscale", "Tailscale server endpoint");
assert(tailscale_server.detour == "proxy", "Tailscale server control-plane detour");
assert(tailscale_server.advertise_exit_node === true, "a Tailscale server always advertises itself as an exit node");
assert(server.route.auto_detect_interface === false, "direct Tailscale server does not pin advertised LAN routes to the default WAN");
assert(route_rule(server, r => r.action == "sniff" && r.inbound == "tailnet") == null, "Tailscale endpoint is not sniffed");
let open_mixed = inbound(server, "open");
assert(open_mixed && open_mixed.type == "mixed" && open_mixed.listen_port == 18081, "server open mixed inbound");
assert(open_mixed.users == null, "disabled mixed authentication omits users");
let mtproxy = inbound(server, "mtproxy");
assert(mtproxy && mtproxy.type == "mtproxy" && mtproxy.listen_port == 18442, "MTProxy inbound");
assert(mtproxy.users[0].secret == "ee" + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" + "676f6f676c652e636f6d", "MTProxy secret carries the FakeTLS host");
assert(mtproxy.domain_fronting_host == null && mtproxy.concurrency == null && mtproxy.prefer_ip == null && mtproxy.idle_timeout == null,
    "MTProxy carries nothing mtg already defaults");
assert(mtproxy.domain_fronting_ip == null, "legacy MTProxy fronting IP key is not emitted");
let naive = inbound(server, "naive");
assert(naive && naive.type == "naive" && naive.network[0] == "tcp" && naive.network[1] == "udp", "Naive inbound networks");
assert(naive.users[0].username == "naive-user", "Naive inbound credentials");
assert(naive.quic_congestion_control == null, "Naive keeps the core QUIC congestion default");
assert(naive.tls && naive.tls.enabled === true, "Naive inbound TLS");
let ssh = inbound(server, "ssh");
assert(ssh && ssh.type == "ssh" && ssh.users[0].name == "ssh-user", "SSH inbound credentials");
assert(ssh.users[0].authorized_keys[0] == "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 user@host", "SSH clients can authenticate with a public key");
assert(ssh.host_key_path[0] == "/etc/forkop/ssh/host_key", "SSH inbound host key path");
let mieru = inbound(server, "mieru");
assert(mieru && mieru.type == "mieru" && mieru.transport == "UDP", "Mieru inbound transport");
assert(mieru.users[0].password == "mieru-password", "Mieru inbound credentials");
assert(mieru.user_hint_is_mandatory == null, "Mieru keeps the core user hint default");
let anytls = inbound(server, "AnyTLS user");
assert(anytls && anytls.type == "anytls" && anytls.users[0].password == "anytls-password", "AnyTLS inbound credentials");
assert(anytls.tls && anytls.tls.enabled === true, "AnyTLS inbound TLS");
let tuic = inbound(server, "TUIC user");
assert(tuic && tuic.type == "tuic" && tuic.users[0].uuid == "33333333-3333-4333-8333-333333333333", "TUIC inbound identity");
assert(tuic.congestion_control == "bbr" && tuic.heartbeat == "12s" && tuic.zero_rtt_handshake === true, "TUIC inbound options");
assert(tuic.auth_timeout == null, "TUIC keeps the core authentication timeout");
assert(tuic.tls && tuic.tls.enabled === true, "TUIC inbound TLS");

// Every protocol sing-box serves takes a user list, so one server can carry several
// accounts, each with its own identity.
let vless_mux = inbound(server, "VLESS mux");
assert(vless_mux && length(vless_mux.users) == 2, "a server accepts every client");
assert(vless_mux.users[0].name == "phone" && vless_mux.users[0].uuid == "44444444-4444-4444-8444-444444444444", "the first client keeps its own identity");
assert(vless_mux.users[0].flow == "xtls-rprx-vision" && vless_mux.users[1].flow == null, "VLESS flow is a per-client setting");
assert(vless_mux.users[1].name == "laptop", "the second client keeps its own identity");
assert(vless_mux.multiplex && vless_mux.multiplex.enabled === true && vless_mux.multiplex.padding === true, "multiplexing is generated when it is accepted");
assert(vless_mux.multiplex.brutal == null, "TCP Brutal is not generated: OpenWrt has no tcp-brutal module");
assert(vless_mux.tls.reality && vless_mux.tls.reality.enabled === true, "Reality is generated for the multiplexed VLESS server");

// A 2022 server holds its own pre-shared key next to the per client keys.
let ss2022 = inbound(server, "Shadowsocks 2022");
assert(ss2022 && ss2022.method == "2022-blake3-aes-128-gcm", "Shadowsocks 2022 method");
assert(ss2022.password == "c2VydmVyLXByZXNoYXJlZC1rZXk=", "the server pre-shared key stays on the inbound");
// sing-box decodes this field on its own, so an account carries just its own key.
// The server key joined with it belongs in the link a client reads, and putting the
// pair here made the core refuse the whole configuration.
assert(ss2022.users[0].password == "Y2xpZW50LXByZXNoYXJlZC1rZXk=", "a 2022 account carries its own key alone");
assert(index(ss2022.users[0].password, ":") < 0, "the server key is not joined into the user list");

assert(route_rule(server, r => r.inbound == "edge" && r.outbound == "direct-out") != null, "server direct route");
// A client of a direct server may still follow the shared rules: the set is cloned
// for that account alone, and those clones come before the rule of the server.
let ruled = route_rule(server, r => r.inbound == "edge" && r.auth_user == "ruled");
assert(ruled != null, "a client that follows the rules gets the shared set for its own account");
let ruled_at = -1;
let direct_at = -1;
for (let i = 0; i < length(server.route.rules); i++) {
    let rule = server.route.rules[i];
    if (type(rule) != "object" || rule.inbound != "edge")
        continue;
    if (rule.auth_user == "ruled" && ruled_at < 0)
        ruled_at = i;
    if (rule.auth_user == null && rule.outbound == "direct-out" && direct_at < 0)
        direct_at = i;
}
assert(ruled_at >= 0 && direct_at > ruled_at, "the rules of a client come before the rule of its server");

// A client that takes its own route gets a rule matched on auth_user, which is the
// only account field a route rule has, and it has
// to come before the rule of its server, because the first match wins.
let client_rule_index = -1;
let server_rule_index = -1;
let mux_rules = server.route.rules;
for (let index = 0; index < length(mux_rules); index++) {
    let rule = mux_rules[index];
    if (type(rule) != "object" || rule.inbound != "VLESS mux")
        continue;
    if (rule.auth_user == "laptop")
        client_rule_index = index;
    else if (rule.auth_user == null)
        server_rule_index = index;
}
assert(client_rule_index >= 0, "a client that overrides the route gets its own rule");
assert(mux_rules[client_rule_index].outbound == "direct-out", "the client rule uses its own mode");
assert(server_rule_index < 0 || client_rule_index < server_rule_index, "a client rule comes before the rule of its server");
// There is no user field in a route rule. sing-box drops a rule that carries one
// without saying anything, so the account silently took the route of its server.
for (let rule in server.route.rules)
    assert(type(rule) != "object" || rule.user == null,
        "a route rule names an account with auth_user, never with user");

let matchers = cfg("matchers");
assert(matchers.dns.strategy == "prefer_ipv6", "configured DNS strategy is generated");
assert(dns_server(matchers, r => r.tag == "fakeip-server" && r.inet6_range == "fc00::/18") != null, "FakeIP IPv6 range");
assert(inbound(matchers, "tproxy6-in") != null, "IPv6 TProxy inbound");
assert(inbound(matchers, "tproxy6-in").listen == "::1", "IPv6 TProxy listen address");
assert(inbound(matchers, "system-in").listen_port == 1604 && inbound(matchers, "system6-in").listen_port == 1604, "system traffic has dedicated TProxy inbounds");
assert(route_rule(matchers, r => r.action == "reject" && r.ip_version == 6) == null, "IPv6 traffic is not rejected globally");
assert(outbound(matchers, "direct-out").type == "direct", "direct outbound");
assert(outbound(matchers, "proxy/Node #1").detour == "detour", "connection parser detour");
let mixed = inbound(matchers, "proxy - Mixed proxy");
assert(mixed && mixed.listen_port == 19090 && mixed.users[0].username == "user", "mixed server auth");
assert(route_rule(matchers, r => r.inbound == "proxy - Mixed proxy" && r.outbound == "proxy") != null, "mixed server section route");
let source_dns_in = inbound(matchers, "source-dns-in");
assert(source_dns_in && source_dns_in.type == "direct" && source_dns_in.listen == "::" && source_dns_in.listen_port == 1603, "source-aware DNS uses one dual-stack inbound");
assert(route_rule(matchers, r => r.action == "sniff" && contains(r.inbound, "source-dns-in")) != null, "source-aware DNS inbound is sniffed before hijacking");
assert(route_rule(matchers, r => r.action == "hijack-dns" && r.protocol == "dns") != null, "sniffed DNS traffic is hijacked by protocol");
assert(route_rule(matchers, r => r.action == "hijack-dns" && r.port == 53) == null, "non-DNS traffic on port 53 is not hijacked");
assert(route_rule(matchers, r => r.action == "reject" && r.inbound == "source-dns-in") != null, "non-DNS traffic cannot loop through the source-aware DNS listener");
assert(inbound(matchers, "system-dns-in").listen_port == 1605, "system-aware DNS has a dedicated inbound");
assert(route_rule(matchers, r => r.action == "reject" && r.inbound == "system-dns-in") != null, "non-DNS traffic cannot loop through the system DNS listener");
assert(dns_server(matchers, r => r.tag == "dnsmasq-server" && r.type == "udp" && r.server == "127.0.0.1" && r.server_port == 53) != null, "source-aware DNS uses the existing dnsmasq instance");
let bypass_fake = dns_rule(matchers, r =>
    r.server == "fakeip-server" && contains(r.domain_suffix, "example.org") &&
    contains(r.source_ip_cidr, "10.0.0.3/32"));
assert(bypass_fake != null, "domain and port bypass keeps FakeIP so sing-box can match the destination port");
let bypass_port_ruleset = ruleset_url(matchers, "https://example.com/bypass-port.srs");
assert(bypass_port_ruleset != null, "domain and port bypass rule set");
let bypass_ruleset_dns = dns_rule(matchers, r =>
    r.server == "fakeip-server" && contains(r.rule_set, bypass_port_ruleset.tag) &&
    contains(r.source_ip_cidr, "10.0.0.4/32"));
assert(bypass_ruleset_dns != null, "rule-set and port bypass keeps FakeIP domain identity");
assert(bypass_ruleset_dns.rule_set_domain_only == null, "section DNS rules keep the stock rule-set semantics");
assert(dns_rule(matchers, r => r.server == "dns-server" && contains(r.domain_suffix, "example.org") && r.source_ip_cidr == null) == null, "filtered bypass no longer changes DNS for every device");
assert(dns_rule(matchers, r => r.server == "fakeip-server" && contains(r.domain_suffix, "example.org") && r.source_ip_cidr == null) != null, "lower global proxy still gives FakeIP to other devices");
let scoped_proxy_dns = dns_rule(matchers, r => r.server == "fakeip-server" && contains(r.domain_suffix, "proxy.example.org"));
assert(scoped_proxy_dns != null && contains(scoped_proxy_dns.source_ip_cidr, "10.0.0.2/32") && contains(scoped_proxy_dns.inbound, "source-dns-in"), "filtered proxy gives FakeIP only to its devices");
assert(dns_rule(matchers, r => r.server == "fakeip-server" && contains(r.domain_suffix, "proxy.example.org") && contains(r.inbound, "system-dns-in") && r.source_ip_cidr == null) != null, "System device filter keeps the same proxy DNS conditions");
let fakeip_dns_rule_count = 0;
for (let rule in matchers.dns.rules || []) {
    if (!rule || rule.server != "fakeip-server")
        continue;
    fakeip_dns_rule_count++;
    assert(rule.query_type != null && length(rule.query_type) == 2 &&
        contains(rule.query_type, "A") && contains(rule.query_type, "AAAA"),
        "FakeIP DNS rules stay limited to address queries so other types reach ordinary DNS");
}
assert(fakeip_dns_rule_count > 0, "matcher fixture must exercise FakeIP DNS rules");
let source_dns_fallback = dns_rule(matchers, r =>
    r.server == "dns-server" && r.type == null && r.domain == null &&
    r.domain_suffix == null && r.domain_regex == null && r.rule_set == null &&
    r.query_type == null && contains(r.inbound, "source-dns-in"));
assert(source_dns_fallback != null && source_dns_fallback.source_ip_cidr == null, "unmatched selected-interface DNS resolves through the Forkop DNS by default");
assert(dns_rule(matchers, r => r.server == "dnsmasq-server" && contains(r.inbound, "system-dns-in")) == null, "router queries never route to the local resolver: its upstream forwards are captured back here and would loop");
let system_dns_fallback = dns_rule(matchers, r => r.server == "dns-server" && r.domain == null && r.domain_suffix == null && r.rule_set == null && contains(r.inbound, "system-dns-in"));
assert(system_dns_fallback != null, "unmatched System DNS resolves through the Forkop DNS");
let bypass_fake_index = dns_rule_index(matchers, r => r.server == "fakeip-server" && contains(r.domain_suffix, "example.org") && contains(r.source_ip_cidr, "10.0.0.3/32"));
let proxy_below_bypass_index = dns_rule_index(matchers, r => r.server == "fakeip-server" && contains(r.domain_suffix, "example.org") && r.source_ip_cidr == null);
assert(bypass_fake_index >= 0 && proxy_below_bypass_index > bypass_fake_index, "source-aware port bypass keeps its section priority over lower proxy DNS");
let scoped_proxy_index = dns_rule_index(matchers, r => r.server == "fakeip-server" && contains(r.domain, "source-priority.test") && contains(r.source_ip_cidr, "10.0.0.2/32"));
let bypass_below_proxy_index = dns_rule_index(matchers, r => r.server == "dns-server" && contains(r.domain, "source-priority.test") && r.source_ip_cidr == null);
assert(scoped_proxy_index >= 0 && bypass_below_proxy_index > scoped_proxy_index, "source-aware proxy keeps its section priority over lower bypass DNS");
let scoped_proxy_route_index = route_rule_index(matchers, r => r.outbound == "proxy" && contains(r.domain, "source-priority.test") && contains(r.source_ip_cidr, "10.0.0.2/32"));
let bypass_below_proxy_route_index = route_rule_index(matchers, r => r.outbound == "direct-out" && contains(r.domain, "source-priority.test") && r.source_ip_cidr == null);
assert(scoped_proxy_route_index >= 0 && bypass_below_proxy_route_index > scoped_proxy_route_index, "route and DNS priorities stay aligned for filtered proxy");
assert(dns_rule(matchers, r => contains(r.domain_suffix, "xn--80aswg.xn--p1ai")).server == "fakeip-server", "IDN suffix converted for DNS rule");
assert(dns_rule(matchers, r => contains(r.domain, "xn--e1afmkfd.xn--80akhbyknj4f")).server == "fakeip-server", "IDN full domain converted for DNS rule");
assert(dns_rule(matchers, r => contains(r.domain_keyword, "xn--e1afmkfd")).server == "fakeip-server", "IDN keyword converted for DNS rule");
assert(dns_rule(matchers, r => contains(r.domain_regex, "^xn--80aswg[.]xn--p1ai$")).server == "fakeip-server", "IDN regex converted for DNS rule");
assert(dns_rule(matchers, r => contains(r.domain_suffix, "commented.example")).server == "fakeip-server", "commented domain value generated");
assert(dns_rule(matchers, r => contains(r.domain, "exact-comment.example")).server == "fakeip-server", "commented full domain generated");
assert(dns_rule(matchers, r => contains(r.domain_keyword, "clip")).server == "fakeip-server", "commented keyword generated");
assert(index(sprintf("%J", matchers), "ignored.example") < 0 && index(sprintf("%J", matchers), "ignored-full.example") < 0, "domain comments excluded from generated config");
assert(route_rule(matchers, r => r.outbound == "direct-out" && contains(r.domain_suffix, "example.org") && contains(r.source_ip_cidr, "10.0.0.3/32") && contains(r.port, 443)) != null, "domain bypass keeps its port matcher");
let bypass_ruleset_route = route_rule(matchers, r => r.type == "logical" && r.mode == "and" && r.outbound == "direct-out");
assert(bypass_ruleset_route != null && length(bypass_ruleset_route.rules || []) == 2 &&
    contains(bypass_ruleset_route.rules[0].rule_set, bypass_port_ruleset.tag) &&
    contains(bypass_ruleset_route.rules[0].inbound, "tproxy-in") &&
    bypass_ruleset_route.rules[0].source_ip_cidr == null &&
    bypass_ruleset_route.rules[0].port == null &&
    contains(bypass_ruleset_route.rules[1].source_ip_cidr, "10.0.0.4/32") &&
    contains(bypass_ruleset_route.rules[1].port, 8443),
    "rule-set bypass applies the section device filter and port as AND conditions");
assert(route_rule(matchers, r => r.outbound == "proxy" && contains(r.domain_suffix, "xn--80aswg.xn--p1ai")) != null, "IDN suffix converted for route rule");
assert(route_rule(matchers, r => r.outbound == "proxy" && contains(r.domain, "xn--e1afmkfd.xn--80akhbyknj4f")) != null, "IDN full domain converted for route rule");
assert(route_rule(matchers, r => r.outbound == "proxy" && contains(r.domain_keyword, "xn--e1afmkfd")) != null, "IDN keyword converted for route rule");
assert(route_rule(matchers, r => r.outbound == "proxy" && contains(r.domain_regex, "^xn--80aswg[.]xn--p1ai$")) != null, "IDN regex converted for route rule");
assert(route_rule(matchers, r => contains(r.inbound, "tproxy-in") && contains(r.inbound, "tproxy6-in") && r.outbound == "proxy") != null, "section route dual tproxy inbound");
assert(route_rule(matchers, r => r.outbound == "direct-out" && contains(r.source_ip_cidr, "192.168.1.5/32")) == null, "routing excluded source removed");
assert(route_rule(matchers, r => r.outbound == "proxy" && contains(r.source_ip_cidr, "10.0.0.2/32") && contains(r.source_ip_cidr, "2001:db8::2/128")) != null, "source_ip_cidr matcher");
assert(route_rule(matchers, r => r.outbound == "proxy" && contains(r.inbound, "system-in") && contains(r.inbound, "system6-in") && r.source_ip_cidr == null && contains(r.domain_suffix, "proxy.example.org")) != null, "System device filter keeps the same route conditions");
assert(index(sprintf("%J", matchers), "@system") < 0, "System sentinel never leaks into sing-box IP matchers");
let commented_ip_rule = route_rule(matchers, r => r.outbound == "proxy" && contains(r.ip_cidr, "77.111.247.0/24") && contains(r.ip_cidr, "198.51.100.0/24"));
assert(commented_ip_rule != null, "comment-aware ip_cidr matcher");
assert(contains(commented_ip_rule.port, 80) && contains(commented_ip_rule.port, 8080), "comment-aware port matcher");
let commented_rule_json = sprintf("%J", commented_ip_rule);
assert(index(commented_rule_json, "#77.111.247.19") < 0 && index(commented_rule_json, "203.0.113.0/24") < 0 && index(commented_rule_json, "10.0.0.99") < 0 && index(commented_rule_json, "2001:db8::99/128") < 0, "IP comments excluded from generated config");
assert(index(commented_rule_json, "443") < 0 && index(commented_rule_json, "8443") < 0, "port comments excluded from generated config");

let dns_action = cfg("dns-action");
let dns_first_server = dns_server(dns_action, r => r.tag == "dns_first-dns-server");
assert(dns_first_server && dns_first_server.type == "fallback" && dns_first_server.strategy == "sequential" && length(dns_first_server.servers) == 6, "DNS action server list uses its configured query mode");
assert(dns_server(dns_action, r => r.tag == "dns_first-dns-server-1" && r.type == "tls" && r.server == "9.9.9.9" && r.server_port == 5353 && r.detour == "detour") != null, "DNS action TLS server and detour");
assert(dns_server(dns_action, r => r.tag == "dns_first-dns-server-2" && r.type == "https" && r.path == "/dns-query") != null, "DNS action HTTPS server");
assert(dns_server(dns_action, r => r.tag == "dns_first-dns-server-3" && r.type == "quic" && r.server_port == 853) != null, "DNS action QUIC server");
assert(dns_server(dns_action, r => r.tag == "dns_first-dns-server-4" && r.type == "h3" && r.server_port == 443) != null, "DNS action HTTP3 server");
assert(dns_server(dns_action, r => r.tag == "dns_first-dns-server-5" && r.type == "tcp" && r.server_port == 53) != null, "DNS action TCP server");
assert(dns_server(dns_action, r => r.tag == "dns_first-dns-server-6" && r.type == "udp" && r.server_port == 53) != null, "DNS action default UDP server");
assert(dns_server(dns_action, r => r.tag == "dns_second-dns-server" && r.server == "8.8.8.8") != null, "second DNS action server");
assert(outbound(dns_action, "dns_first-out") == null && outbound(dns_action, "dns_second-out") == null, "DNS actions do not create outbounds");
assert(route_rule(dns_action, r => contains(r.domain_suffix, "dns-first.example") && r.outbound != null) != null, "proxy still owns its route rule");
assert(route_rule(dns_action, r => contains(r.domain_suffix, "list-dns.example")) == null, "DNS action does not create route rules");
let dns_first_index = dns_rule_index(dns_action, r => contains(r.domain_suffix, "dns-first.example") && r.server == "dns_first-dns-server");
let proxy_after_dns_index = dns_rule_index(dns_action, r => contains(r.domain_suffix, "dns-first.example") && r.server == "fakeip-server");
assert(dns_first_index >= 0 && proxy_after_dns_index > dns_first_index, "higher DNS action wins over lower proxy DNS rule");
let dns_first_rule = dns_rule(dns_action, r => contains(r.domain_suffix, "dns-first.example") && r.server == "dns_first-dns-server");
assert(contains(dns_first_rule.inbound, "source-dns-in") && contains(dns_first_rule.source_ip_cidr, "192.0.2.1/32"), "DNS action device filter keeps the client source");
let dns_first_forced_index = dns_rule_index(dns_action, r => r.server == "dns_first-dns-server" && r.domain == null && r.domain_suffix == null && contains(r.source_ip_cidr, "192.0.2.2/32"));
assert(dns_first_forced_index >= 0 && dns_first_forced_index < proxy_after_dns_index, "higher forced DNS action wins over lower proxy rules");
let proxy_first_index = dns_rule_index(dns_action, r => contains(r.domain_suffix, "proxy-first.example") && r.server == "fakeip-server");
let dns_after_proxy_index = dns_rule_index(dns_action, r => contains(r.domain_suffix, "proxy-first.example") && r.server == "dns_second-dns-server");
assert(proxy_first_index >= 0 && dns_after_proxy_index > proxy_first_index, "higher proxy DNS rule wins over lower DNS action");
let dns_second_forced_index = dns_rule_index(dns_action, r => r.server == "dns_second-dns-server" && r.domain == null && r.domain_suffix == null && contains(r.source_ip_cidr, "192.0.2.3/32"));
assert(dns_second_forced_index > proxy_first_index, "lower forced DNS action preserves higher proxy priority");
let dns_first_ruleset_rule = dns_rule(dns_action, r => contains(r.rule_set, "dns_first-youtube-community-ruleset") && r.server == "dns_first-dns-server" && contains(r.source_ip_cidr, "192.0.2.1/32"));
assert(dns_first_ruleset_rule != null, "DNS action device filter covers built-in domain rule sets");
assert(dns_first_ruleset_rule.rule_set_domain_only === true, "DNS action reads only the domain half of a rule set");
assert(dns_first_rule.rule_set_domain_only == null, "inline DNS action domains carry no rule-set projection");
let dns_custom_ruleset = ruleset_url(dns_action, "https://example.com/domain-only.srs");
assert(dns_custom_ruleset && dns_rule(dns_action, r => contains(r.rule_set, dns_custom_ruleset.tag) && r.server == "dns_first-dns-server" && contains(r.source_ip_cidr, "192.0.2.1/32")) != null, "DNS action device filter covers custom domain rule sets");
let dns_text_ruleset = ruleset_path(dns_action, dir + "/dns-action.lst");
assert(dns_text_ruleset && dns_text_ruleset.type == "local" && dns_text_ruleset.format == "auto", "DNS action emits a local universal rule set");
assert(dns_rule(dns_action, r => contains(r.rule_set, dns_text_ruleset.tag) && r.server == "dns_first-dns-server" && contains(r.source_ip_cidr, "192.0.2.1/32")) != null, "DNS action uses the universal rule set as a domain matcher");
let dns_action_fallback = dns_rule(dns_action, r => r.server == "dnsmasq-server" && r.domain == null && r.domain_suffix == null && r.rule_set == null && contains(r.inbound, "source-dns-in"));
assert(dns_action_fallback && dns_action_fallback.source_ip_cidr == null, "unmatched selected-interface DNS actions return through dnsmasq");
assert(route_rule(dns_action, r => contains(r.source_ip_cidr, "192.0.2.2/32")) == null, "forced DNS action does not route device traffic");
assert(fs.stat(dir + "/dns-action.json.rulesets/dns_first-lists-ruleset.json") == null, "DNS action no longer builds a parsed Forkop rule-set cache");

let urltest = cfg("urltest");
let urltest_out = outbound(urltest, "proxy/Fastest");
assert(urltest_out && length(urltest_out.outbounds) == 1 && urltest_out.outbounds[0] == "proxy/Keep", "URLTest include filter");
assert(outbound(urltest, "proxy/Keep").type == "http", "HTTP JSON outbound remains supported");
assert(outbound(urltest, "proxy").default == "proxy/Fastest", "selector defaults to URLTest");

let vpn = cfg("vpn");
assert(outbound(vpn, "renamed_awg/tun0").bind_interface == "tun0", "renamed VPN interface outbound");
assert(outbound(vpn, "renamed_awg/tun0").domain_resolver == "renamed_awg-interface-1-domain-resolver", "renamed VPN domain resolver tag");
let vpn_resolver = dns_server(vpn, r => r.tag == "renamed_awg-interface-1-domain-resolver");
assert(vpn_resolver != null, "renamed VPN domain resolver DNS server");
assert(vpn_resolver.type == "fallback" && vpn_resolver.strategy == "sequential", "several resolver servers must build a fallback group with the selected query mode");
assert(sprintf("%J", vpn_resolver.servers) == sprintf("%J", [ "renamed_awg-interface-1-domain-resolver-1", "renamed_awg-interface-1-domain-resolver-2" ]), "resolver fallback group must reference its own members");
let vpn_resolver_first = dns_server(vpn, r => r.tag == "renamed_awg-interface-1-domain-resolver-1");
assert(vpn_resolver_first.type == "https" && vpn_resolver_first.server == "dns.example" && vpn_resolver_first.path == "/dns-query",
    "resolver URI must keep its protocol, host, and path");
assert(vpn_resolver_first.detour == "renamed_awg/tun0", "a resolver without a DNS detour must query through its own interface");
let vpn_resolver_second = dns_server(vpn, r => r.tag == "renamed_awg-interface-1-domain-resolver-2");
assert(vpn_resolver_second.type == "tls" && vpn_resolver_second.server == "1.1.1.1" && vpn_resolver_second.server_port == 853,
    "resolver failover server must keep its own protocol and default port");
let detour_resolver = dns_server(vpn, r => r.tag == "detoured_awg-interface-1-domain-resolver");
assert(detour_resolver != null && detour_resolver.type == "udp" && detour_resolver.server == "9.9.9.9",
    "a single resolver server must stay a plain DNS server");
assert(detour_resolver.detour == "Resolver detour", "an enabled DNS detour must replace the interface with the selected section");
assert(outbound(vpn, "renamed_awg/tun0").detour == null, "interface outbound must not receive a detour");
assert(route_rule(vpn, r => r.outbound == "renamed_awg" && contains(r.domain_suffix, "vpn.example")) != null, "renamed VPN custom domain route");
assert(dns_rule(vpn, r => contains(r.domain_suffix, "vpn.example")) != null, "renamed VPN custom domain DNS rule");

// The proxy diagnostic reaches the running core through the service mixed
// inbound, so it must exist even without a download detour.
let check_inbound = inbound(matchers, "service-mixed-in");
assert(check_inbound != null && check_inbound.listen == "127.0.0.1" && check_inbound.listen_port == 4534,
    "proxy diagnostics must reach the running core through a loopback mixed inbound");
let check_route = route_rule(matchers, r => r.inbound == "service-mixed-in");
let check_domain_route = route_rule(matchers, r => r.domain == "ip.podkop.fyi" && r.outbound != null);
assert(check_route != null && check_domain_route != null && check_route.outbound == check_domain_route.outbound,
    "the proxy diagnostic inbound must measure the same outbound as its route rule");

let download = cfg("download");
assert(inbound(download, "service-mixed-in") != null, "service mixed inbound");
assert(route_rule(download, r => r.inbound == "service-mixed-in" && r.outbound == "proxy") != null, "service mixed route");
assert(inbound(download, "service-components-in") != null, "components service mixed inbound");
assert(route_rule(download, r => r.inbound == "service-components-in" && r.outbound == "components_proxy") != null, "components service mixed route");
assert(ruleset(download, "proxy-discord-community-ruleset").http_client.detour == "proxy", "HTTP client detour on community ruleset");
assert(ruleset_url(download, "https://example.com/rules.srs").http_client.detour == "proxy", "HTTP client detour on custom remote ruleset");
let download_text_ruleset = ruleset_url(download, "https://example.com/mixed.txt");
assert(download_text_ruleset && download_text_ruleset.format == "auto" && download_text_ruleset.update_interval == "1d" && download_text_ruleset.http_client.detour == "proxy", "remote universal rule set owns updates and detour");

let fully = cfg("fully-routed");
assert(route_rule(fully, r => r.outbound == "direct-out" && contains(r.inbound, "tproxy-in") && contains(r.inbound, "tproxy6-in") && contains(r.source_ip_cidr, "192.168.1.20/32") && contains(r.source_ip_cidr, "192.168.1.30/32") && contains(r.source_ip_cidr, "2001:db8::20/128")) != null, "fully routed bypass IP route");
assert(route_rule(fully, r => r.outbound == "direct-out" && contains(r.inbound, "system-in") && contains(r.inbound, "system6-in") && r.source_ip_cidr == null && r.domain == null) != null, "fully routed System bypass route");
assert(route_rule(fully, r => r.outbound == "proxy" && contains(r.source_ip_cidr, "192.168.1.40/32")) != null, "fully routed proxy IP route");
let fully_bypass_dns = dns_rule(fully, r =>
    r.type == "logical" && r.server == "dns-server" &&
    length(r.rules || []) == 2 && contains(r.rules[0].source_ip_cidr, "192.168.1.20/32") &&
    r.rules[0].domain == null && r.rules[0].domain_suffix == null && r.rules[0].rule_set == null);
assert(fully_bypass_dns != null, "fully routed bypass rejects FakeIP for every domain");
assert(dns_rule(fully, r => r.type == "logical" && r.server == "dns-server" && length(r.rules || []) == 2 && contains(r.rules[0].inbound, "system-dns-in")) != null, "fully routed System bypass rejects FakeIP through the Forkop DNS, never through the resolver it captures");
assert(dns_rule(fully, r => r.server == "dns-server" && contains(r.source_ip_cidr, "192.168.1.20/32") && contains(r.query_type, "A")) != null, "fully routed bypass falls back to real DNS");
assert(dns_rule(fully, r => r.type == "logical" && length(r.rules || []) > 0 && contains(r.rules[0].source_ip_cidr, "192.168.1.40/32")) == null, "fully routed proxy keeps normal FakeIP policy");
let higher_proxy_dns_index = dns_rule_index(fully, r => r.server == "fakeip-server" && contains(r.domain_suffix, "forced-higher.test"));
let forced_bypass_dns_index = dns_rule_index(fully, r => r.type == "logical" && length(r.rules || []) > 0 && contains(r.rules[0].source_ip_cidr, "192.168.1.20/32"));
let lower_proxy_dns_index = dns_rule_index(fully, r => r.server == "fakeip-server" && contains(r.domain_suffix, "forced-lower.test"));
assert(higher_proxy_dns_index >= 0 && forced_bypass_dns_index > higher_proxy_dns_index && lower_proxy_dns_index > forced_bypass_dns_index, "forced bypass stays at its section priority in DNS rules");
let higher_proxy_route_index = route_rule_index(fully, r => r.outbound == "proxy_high" && contains(r.domain_suffix, "forced-higher.test"));
let forced_bypass_route_index = route_rule_index(fully, r => r.outbound == "direct-out" && contains(r.source_ip_cidr, "192.168.1.20/32") && r.domain == null && r.domain_suffix == null);
let lower_proxy_route_index = route_rule_index(fully, r => r.outbound == "proxy" && contains(r.domain_suffix, "forced-lower.test"));
assert(higher_proxy_route_index >= 0 && forced_bypass_route_index > higher_proxy_route_index && lower_proxy_route_index > forced_bypass_route_index, "forced bypass stays at its section priority in route rules");
assert(index(sprintf("%J", fully), "@system") < 0, "fully routed System sentinel never leaks into sing-box config");

let mwan3_auto = cfg("mwan3-auto");
assert(mwan3_auto.route.auto_detect_interface === false, "mwan3 disables auto_detect_interface");
assert(mwan3_auto.route.default_interface == null, "mwan3 without pinned interface does not set default_interface");

let mwan3_pinned = cfg("mwan3-pinned");
assert(mwan3_pinned.route.auto_detect_interface === false, "mwan3 pinned interface disables auto_detect_interface");
assert(mwan3_pinned.route.default_interface == "wan2", "mwan3 pinned interface is preserved");

let lists = cfg("universal-rulesets");
assert(no_internal_fields(lists), "internal runtime fields stripped from generated config");
let local_ruleset = ruleset_path(lists, dir + "/domain-ip.lst");
let remote_text_ruleset = ruleset_url(lists, "https://example.com/domain-ip.txt");
assert(local_ruleset && local_ruleset.type == "local" && local_ruleset.format == "auto", "local rule-set format is detected by sing-box");
assert(remote_text_ruleset && remote_text_ruleset.type == "remote" && remote_text_ruleset.format == "auto" && remote_text_ruleset.update_interval == "1d", "remote universal rule set owns native updates");
assert(local_ruleset.tag != remote_text_ruleset.tag, "each universal rule-set reference has a stable independent tag");
assert(route_rule(lists, r => contains(r.rule_set, local_ruleset.tag) && contains(r.rule_set, remote_text_ruleset.tag) && length(as_array(r.rule_set)) >= 3) != null, "all universal rule sets share the section route");
assert(dns_rule(lists, r => contains(r.rule_set, local_ruleset.tag) && contains(r.rule_set, remote_text_ruleset.tag)) != null, "universal rule sets remain DNS matchers");

' "$WORK_DIR"

printf 'sing-box runtime checks passed\n'
