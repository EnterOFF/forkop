#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
PARSER_UC="$FORKOP_LIB/subscription/parser.uc"
GENERATOR_UC="$FORKOP_LIB/singbox/generator.uc"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

cat >"$WORK_DIR/xray.json" <<'JSON'
{
  "remarks": "Latvia group",
  "burstObservatory": {
    "pingConfig": {
      "destination": "https://probe.example/204",
      "interval": "45s",
      "timeout": "3s"
    }
  },
  "routing": {
    "balancers": [ { "tag": "latvia-balancer", "selector": [ "lv-" ] } ]
  },
  "outbounds": [
    {
      "protocol": "vless",
      "tag": "lv-Riga A",
      "settings": { "vnext": [ { "address": "riga-a.example", "port": 443, "users": [ {
        "id": "00000000-0000-4000-8000-000000000001", "encryption": "none"
      } ] } ] }
    },
    {
      "protocol": "vless",
      "tag": "lv-Riga B",
      "settings": { "vnext": [ { "address": "riga-b.example", "port": 443, "users": [ {
        "id": "00000000-0000-4000-8000-000000000002", "encryption": "none"
      } ] } ] }
    }
  ]
}
JSON

ucode -L "$FORKOP_LIB" "$PARSER_UC" normalize-content \
  "$WORK_DIR/xray.json" "$WORK_DIR/xray-normalized.json"
ucode -e '
let fs = require("fs");
let value = json(fs.readfile(ARGV[0]));
let group = null;
for (let outbound in value.outbounds || [])
    if (outbound.type == "urltest")
        group = outbound;
if (!group || group.url != "https://probe.example/204" || group.interval != "45s" || length(group.outbounds || []) != 2)
    die("legacy Xray URLTest normalization regressed\n");
' "$WORK_DIR/xray-normalized.json" || fail "Xray URLTest normalization"

cat >"$WORK_DIR/fixture.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": "1.1.1.1" },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "subscription_urls": [ "https://xray.example/sub" ],
      "urltest_enabled": "1",
      "urltest_filter_mode": "include",
      "urltest_include_regex": [ "Riga" ]
    }
  ]
}
JSON

ucode -L "$FORKOP_LIB" "$GENERATOR_UC" generate-config-fixture \
  "$WORK_DIR/fixture.json" "$WORK_DIR/config.json" 127.0.0.1 0
ucode -e '
let fs = require("fs");
let config = json(fs.readfile(ARGV[0]));
let provider = null;
let selector = null;
let urltest = null;
for (let item in config.providers || [])
    if (item.tag == "proxy-subscription-1-provider")
        provider = item;
for (let outbound in config.outbounds || []) {
    if (outbound.tag == "proxy-out")
        selector = outbound;
    if (outbound.tag == "proxy-urltest-out")
        urltest = outbound;
}
if (!provider || provider.type != "remote" || provider.url != "https://xray.example/sub")
    die("subscription was not delegated to a native remote provider\n");
if (!selector || selector.providers[0] != provider.tag ||
    selector.exclude_provider_group_members[0] != provider.tag ||
    selector.exclude_provider_dependencies[0] != provider.tag)
    die("provider group/dependency visibility was not mapped to the selector\n");
if (!urltest || urltest.providers[0] != provider.tag || index(urltest.include || "", "Riga") < 0)
    die("URLTest does not consume provider updates through its native filter\n");
if (length(urltest.outbounds || []) != 0)
    die("Forkop parsed provider nodes into static URLTest membership\n");
' "$WORK_DIR/config.json" || fail "native provider URLTest wiring"

printf 'URLTest group checks passed\n'
