#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
GENERATOR_UC="$FORKOP_LIB/singbox/generator.uc"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

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
      "urltest_filter_enabled": "1",
      "urltest_include_regex": "Riga"
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
if (!selector || selector.providers[0] != provider.tag)
    die("section selector does not consume the subscription provider\n");
if (selector.exclude_provider_group_members != null || selector.exclude_provider_dependencies != null)
    die("subscription detour nodes must remain visible in the selector\n");
if (provider.exclude_types != null)
    die("subscription provider still contains removed type filters\n");
if (!urltest || urltest.providers[0] != provider.tag || index(urltest.include || "", "Riga") < 0)
    die("URLTest does not consume provider updates through its native filter\n");
if (length(urltest.outbounds || []) != 0)
    die("Forkop parsed provider nodes into static URLTest membership\n");
' "$WORK_DIR/config.json" || fail "native provider URLTest wiring"

printf 'URLTest group checks passed\n'
