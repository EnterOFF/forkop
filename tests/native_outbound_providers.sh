#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
VALIDATOR="$FORKOP_LIB/config/validator.uc"

cat >"$WORK_DIR/fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ]
  },
  "section": [
    {
      ".name": "hop",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "outbound_jsons": [ "{\"type\":\"socks\",\"tag\":\"hop-node\",\"server\":\"127.0.0.1\",\"server_port\":1080}" ]
    },
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "selector_proxy_links": [ "vless://id@example.com:443?security=tls#Manual" ],
      "outbound_detour_enabled": "1",
      "outbound_detour_section": "hop"
    }
  ],
  "subscription_url": [
    {
      ".name": "source",
      ".type": "subscription_url",
      "section": "proxy",
      "url": "https://example.com/subscription",
      "auto_user_agent": "0",
      "user_agent": "Happ",
      "auto_hwid": "0",
      "hwid": "router-hwid",
      "subscription_update_enabled": "0",
      "download_via_proxy_enabled": "1",
      "download_via_proxy_section": "hop",
      "prefix_nodes": "1",
      "node_prefix": "Main",
      "filter_mode": "mixed",
      "include_regex": [ "^(US|DE)" ],
      "include_proxy_parameters": "1",
      "include_protocols": [ "vless" ],
      "exclude_regex": [ "expired" ],
      "exclude_proxy_parameters": "1",
      "exclude_transports": [ "grpc" ]
    },
    {
      ".name": "source_auto",
      ".type": "subscription_url",
      "section": "proxy",
      "url": "https://example.com/auto"
    }
  ],
  "urltest": [
    {
      ".name": "fast",
      ".type": "urltest",
      "section": "proxy",
      "filter_mode": "mixed",
      "include_countries": [ "US" ],
      "include_proxy_parameters": "1",
      "include_protocols": [ "vless" ],
      "exclude_regex": [ "slow" ],
      "exclude_proxy_parameters": "1",
      "exclude_securities": [ "none" ]
    }
  ]
}
JSON

output="$WORK_DIR/config.json"
ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-runtime-fixture "$WORK_DIR/fixture.json" '{}' >/dev/null
mkdir -p "$WORK_DIR/bin" "$WORK_DIR/lib/core"
cat >"$WORK_DIR/lib/core/packages.uc" <<'EOF_PACKAGES'
#!/usr/bin/ucode
if ((ARGV[0] || "") == "version" && (ARGV[1] || "") == "sing-box-forkop-compressed")
  print("1.13.14~forkop\n");
EOF_PACKAGES
printf '#!/bin/sh\nprintf "sing-box version 1.13.14-forkop\\nEnvironment: test\\n"\n' >"$WORK_DIR/bin/sing-box"
chmod +x "$WORK_DIR/bin/sing-box"
PATH="$WORK_DIR/bin:$PATH" FORKOP_LIB="$WORK_DIR/lib" ucode -L "$FORKOP_LIB" "$FORKOP_LIB/singbox/generator.uc" generate-config-fixture \
  "$WORK_DIR/fixture.json" "$output" 127.0.0.1 0

mac="$(cat /sys/class/net/eth0/address 2>/dev/null || cat /sys/class/net/br-lan/address 2>/dev/null || true)"
model="$(cat /tmp/sysinfo/model 2>/dev/null || true)"
model="${model:-OpenWrt Router}"
hash="$(printf %s "$mac-$model" | md5sum | cut -c1-16)"
expected_hwid="${hash:0:4}-${hash:4:4}-${hash:8:4}-${hash:12:4}"

EXPECTED_HWID="$expected_hwid" ucode -e '
let fs = require("fs");
let config = json(fs.readfile(ARGV[0]));
let by_provider = {};
let by_outbound = {};
for (let provider in config.providers || [])
    by_provider[provider.tag] = provider;
for (let outbound in config.outbounds || [])
    by_outbound[outbound.tag] = outbound;

let remote = by_provider["proxy-subscription-1-provider"];
let automatic = by_provider["proxy-subscription-2-provider"];
let local = by_provider["proxy-manual-provider"];
if (!remote || !automatic || !local)
    die("native remote/local providers were not generated\n");
if (remote.url != "https://example.com/subscription" || remote.user_agent[0] != "Happ")
    die("remote provider request profile was not preserved\n");
if (automatic.user_agent[0] != "sing-box/1.13.14-forkop" || automatic.user_agent[1] != "Happ")
    die("automatic User-Agent order diverged from the legacy request profile\n");
if (automatic.headers["X-HWID"][0] != getenv("EXPECTED_HWID"))
    die("automatic HWID diverged from the legacy router identity algorithm\n");
if (remote.headers["X-HWID"][0] != "router-hwid" || remote.headers["X-Device-OS"][0] != "OpenWrt Linux")
    die("remote provider device headers were not preserved\n");
if (remote.download_detour != "hop-out" || remote.outbound_detour != "hop-out")
    die("provider download/cascade detours were not generated\n");
if (remote.update_interval != "876000h")
    die("disabled provider updates must use the inert interval\n");
if (remote.tag_prefix != "Main ")
    die("provider node prefix was not generated\n");
if (remote.include != "(?:(?:^(US|DE)))" || remote.include_types[0] != "vless")
    die("provider include filters were not generated\n");
if (remote.exclude != "(?:(?:expired))" || remote.exclude_transports[0] != "grpc")
    die("provider exclude filters were not generated\n");
for (let group in [ "selector", "urltest", "fallback" ])
    if (index(remote.exclude_types, group) < 0)
        die("subscription provider did not exclude group type " + group + "\n");
if (trim(fs.readfile(local.path)) != "vless://id@example.com:443?security=tls#Manual")
    die("manual URI source was not written verbatim for the core parser\n");
if (local.outbound_detour != "hop-out")
    die("manual provider cascade detour was not generated\n");

let selector = by_outbound["proxy-out"];
if (!selector || length(selector.providers || []) != 3)
    die("section selector does not consume all providers\n");
if (selector.exclude_provider_group_members != null || selector.exclude_provider_dependencies != null)
    die("subscription detour nodes must remain visible in the selector\n");
let urltest = by_outbound["proxy-urltest-fast-out"];
if (!urltest || length(urltest.providers || []) != 3 || urltest.include_types[0] != "vless" || urltest.exclude_securities[0] != "none")
    die("URLTest did not receive dynamic providers and filters\n");
for (let group in [ "selector", "urltest", "fallback" ])
    if (index(urltest.exclude_types, group) < 0)
        die("URLTest provider filter includes group outbound " + group + "\n");
if (index(urltest.include, "🇺🇸") < 0 || index(urltest.exclude, "slow") < 0)
    die("URLTest name/country regex filters were not compiled\n");
' "$output"

sed '0,/"include_protocols": \[ "vless" \]/{s//"include_protocols": [ "invalid" ]/}' \
  "$WORK_DIR/fixture.json" >"$WORK_DIR/invalid-filter.json"
if ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-runtime-fixture "$WORK_DIR/invalid-filter.json" '{}' >/dev/null 2>&1; then
  printf 'invalid subscription provider protocol filter was accepted\n' >&2
  exit 1
fi

printf 'native outbound providers tests passed\n'
