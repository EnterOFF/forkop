#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

cat >"$WORK_DIR/fixture.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": "1.1.1.1" },
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
      "include_urltest_groups": "0",
      "hide_urltest_group_outbounds": "1",
      "hide_detour_outbounds": "1",
      "filter_mode": "mixed",
      "include_regex": [ "^(US|DE)" ],
      "include_protocols": [ "vless" ],
      "exclude_regex": [ "expired" ],
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
mkdir -p "$WORK_DIR/bin"
printf '#!/bin/sh\nprintf "sing-box version 1.13.14-forkop\\nEnvironment: test\\n"\n' >"$WORK_DIR/bin/sing-box"
chmod +x "$WORK_DIR/bin/sing-box"
PATH="$WORK_DIR/bin:$PATH" ucode -L "$FORKOP_LIB" "$FORKOP_LIB/singbox/generator.uc" generate-config-fixture \
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
if (remote.include != "(?:(?:^(US|DE)))" || remote.include_types[0] != "vless")
    die("provider include filters were not generated\n");
if (remote.exclude != "(?:(?:expired))" || remote.exclude_transports[0] != "grpc")
    die("provider exclude filters were not generated\n");
for (let group in [ "selector", "urltest", "fallback", "loadbalance" ])
    if (index(remote.exclude_types, group) < 0)
        die("disabled imported groups did not exclude " + group + "\n");
if (trim(fs.readfile(local.path)) != "vless://id@example.com:443?security=tls#Manual")
    die("manual URI source was not written verbatim for the core parser\n");
if (local.outbound_detour != "hop-out")
    die("manual provider cascade detour was not generated\n");

let selector = by_outbound["proxy-out"];
if (!selector || length(selector.providers || []) != 3)
    die("section selector does not consume all providers\n");
if (selector.exclude_provider_group_members[0] != remote.tag || selector.exclude_provider_dependencies[0] != remote.tag)
    die("provider visibility settings were not mapped to the selector\n");
let urltest = by_outbound["proxy-urltest-fast-out"];
if (!urltest || length(urltest.providers || []) != 3 || urltest.include_types[0] != "vless" || urltest.exclude_securities[0] != "none")
    die("URLTest did not receive dynamic providers and filters\n");
for (let group in [ "selector", "urltest", "fallback", "loadbalance" ])
    if (index(urltest.exclude_types, group) < 0)
        die("URLTest provider filter includes group outbound " + group + "\n");
if (index(urltest.include, "🇺🇸") < 0 || index(urltest.exclude, "slow") < 0)
    die("URLTest name/country regex filters were not compiled\n");
' "$output"

printf 'native outbound providers tests passed\n'
