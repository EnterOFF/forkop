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
      "user_agent": "Happ",
      "header": [ "X-HWID: router-hwid", "X-Device-OS: OpenWrt Linux", "X-Test: one", "x-test: two", "X-Empty:" ],
      "subscription_update_enabled": "0",
      "download_via_proxy_enabled": "1",
      "download_via_proxy_section": "hop",
      "show_subscription_name": "1",
      "tag": "premium",
      "server_filter_mode": "include",
      "include_regex": "^(US|DE)",
      "exclude_regex": "expired"
    },
    {
      ".name": "source_auto",
      ".type": "subscription_url",
      "section": "proxy",
      "url": "https://example.com/auto",
      "header": [ "X-HWID: configured-hwid" ]
    },
    {
      ".name": "source_without_hwid",
      ".type": "subscription_url",
      "section": "proxy",
      "url": "https://example.com/no-hwid"
    },
    {
      ".name": "source_local",
      ".type": "subscription_url",
      "section": "proxy",
      "url": "/etc/forkop/local-subscription.txt",
      "subscription_update_enabled": "1",
      "subscription_update_interval": "invalid",
      "download_via_proxy_enabled": "1",
      "download_via_proxy_section": "proxy",
      "user_agent": "ignored",
      "header": [ "Broken Header" ],
      "show_dashboard_metadata": "1",
      "show_subscription_name": "1",
      "tag": "local",
      "server_filter_mode": "include",
      "include_regex": "^Local",
      "exclude_regex": "Expired"
    }
  ],
  "urltest": [
    {
      ".name": "fast",
      ".type": "urltest",
      "section": "proxy",
      "name": "Fastest",
      "server_filter_mode": "include",
      "include_regex": "🇺🇸",
      "exclude_regex": "slow"
    }
  ]
}
JSON

output="$WORK_DIR/config.json"
ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-runtime-fixture "$WORK_DIR/fixture.json" '{}' >/dev/null
ucode -L "$FORKOP_LIB" "$FORKOP_LIB/singbox/generator.uc" generate-config-fixture \
  "$WORK_DIR/fixture.json" "$output" 127.0.0.1 0

ucode -L "$FORKOP_LIB" -e '
let subscription_headers = require("singbox.subscription_headers");
let parsed = subscription_headers.parse_header_lines(subscription_headers.default_header_lines());
if (!parsed.valid || length(keys(parsed.headers)) != 6 || parsed.headers["X-HWID"][0] == "")
    die("default subscription headers were not generated\n");
'

ucode -e '
let fs = require("fs");
let config = json(fs.readfile(ARGV[0]));
let by_provider = {};
let by_outbound = {};
for (let provider in config.providers || [])
    by_provider[provider.tag] = provider;
for (let outbound in config.outbounds || [])
    by_outbound[outbound.tag] = outbound;

let remote = by_provider["proxy/premium"];
let automatic = by_provider["proxy/sub2"];
let without_hwid = by_provider["proxy/sub3"];
let local = by_provider["proxy/local"];
if (!remote || !automatic || !without_hwid || !local || length(keys(by_provider)) != 4)
    die("remote subscription providers were not generated with readable tags\n");
if (remote.url != "https://example.com/subscription" || remote.user_agent != "Happ")
    die("remote provider request profile was not preserved\n");
if (automatic.user_agent != "sing-box")
    die("default subscription User-Agent was not generated\n");
if (automatic.headers["X-HWID"][0] != "configured-hwid")
    die("configured subscription headers were not generated\n");
if (remote.headers["X-HWID"][0] != "router-hwid" || remote.headers["X-Device-OS"][0] != "OpenWrt Linux")
    die("remote provider device headers were not preserved\n");
if (length(remote.headers["X-Test"]) != 2 || remote.headers["X-Test"][1] != "two")
    die("repeated subscription headers were not combined case-insensitively\n");
if (type(remote.headers["X-Empty"]) != "array" || remote.headers["X-Empty"][0] != "")
    die("empty subscription header values must stay valid\n");
if (without_hwid.headers["X-HWID"] != null)
    die("disabled empty HWID must omit the request header\n");
if (remote.download_detour != "hop" || remote.outbound_detour != "hop")
    die("provider download/cascade detours were not generated\n");
if (remote.update_interval != "876000h")
    die("disabled provider updates must use the inert interval\n");
if (remote.tag_prefix != null)
    die("removed provider tag_prefix leaked into the config\n");
if (remote.include != "(?:(?:^(US|DE)))")
    die("provider include filters were not generated\n");
if (remote.exclude != "(?:(?:expired))")
    die("provider exclude filters were not generated\n");
if (remote.include_types != null || remote.include_transports != null || remote.include_securities != null || remote.exclude_types != null || remote.exclude_transports != null || remote.exclude_securities != null)
    die("provider still contains removed parameter filters\n");
if (local.type != "local" || local.path != "/etc/forkop/local-subscription.txt")
    die("local subscription provider was not generated from its path\n");
if (local.url != null || local.user_agent != null || local.headers != null || local.update_interval != null || local.download_detour != null)
    die("local subscription provider contains unsupported remote options\n");
if (local.outbound_detour != "hop" || local.include != "(?:(?:^Local))" || local.exclude != "(?:(?:Expired))")
    die("local subscription provider did not preserve detour and server filters\n");
let manual = by_outbound["proxy/Manual"];
if (!manual || manual.type != "parser" || manual.link != "vless://id@example.com:443?security=tls#Manual")
    die("manual URI was not delegated to the core parser\n");
if (manual.detour != "hop")
    die("manual parser cascade detour was not generated\n");

let selector = by_outbound["proxy"];
if (!selector || length(selector.providers || []) != 4 || selector.outbounds[1] != "proxy/Manual")
    die("section selector does not consume all providers\n");
if (selector.exclude_provider_group_members != null || selector.exclude_provider_dependencies != null)
    die("subscription detour nodes must remain visible in the selector\n");
let urltest = by_outbound["proxy/Fastest"];
if (!urltest || length(urltest.providers || []) != 4)
    die("URLTest did not receive dynamic providers and filters\n");
if (urltest.include_types != null || urltest.include_transports != null || urltest.include_securities != null || urltest.exclude_types != null || urltest.exclude_transports != null || urltest.exclude_securities != null)
    die("URLTest still contains removed parameter filters\n");
if (index(urltest.include, "🇺🇸") < 0 || index(urltest.exclude, "slow") < 0)
    die("URLTest name regex filters were not compiled\n");
' "$output"

printf 'native outbound providers tests passed\n'
