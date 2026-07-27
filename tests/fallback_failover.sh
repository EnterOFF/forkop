#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
GENERATOR="$FORKOP_LIB/singbox/generator.uc"
VALIDATOR="$FORKOP_LIB/config/validator.uc"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

generate() {
  mkdir -p "$2.section-cache"
  ucode -L "$FORKOP_LIB" "$GENERATOR" generate-config-fixture "$1" "$2" 127.0.0.1
}

validate() {
  ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-runtime-fixture "$1" '{}'
}

cat >"$WORK_DIR/fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"]
  },
  "section": [
    {
      ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection",
      "outbound_jsons": [
        "{\"type\":\"socks\",\"tag\":\"Alpha\",\"server\":\"127.0.0.1\",\"server_port\":1001}",
        "{\"type\":\"socks\",\"tag\":\"Beta\",\"server\":\"127.0.0.1\",\"server_port\":1002}",
        "{\"type\":\"socks\",\"tag\":\"Gamma\",\"server\":\"127.0.0.1\",\"server_port\":1003}",
        "{\"type\":\"fallback\",\"tag\":\"Nested\",\"outbounds\":[\"Alpha\"]}"
      ]
    }
  ],
  "subscription_url": [
    {
      ".name": "sub_main", ".type": "subscription_url", "section": "proxy",
      "url": "https://example.com/sub", "subscription_update_enabled": "1"
    }
  ],
  "fallback_group": [
    {
      ".name": "pg_main", ".type": "fallback_group", "section": "proxy",
      "name": "Main fallback", "blacklist_timeout": "45s", "pin_dashboard": "1"
    }
  ],
  "fallback_level": [
    {
      ".name": "pl_top", ".type": "fallback_level", "group": "pg_main",
      "name": "Top", "order": "0", "filter_mode": "include", "server_name": ["Beta"]
    },
    {
      ".name": "pl_mixed", ".type": "fallback_level", "group": "pg_main",
      "name": "Mixed", "order": "1", "filter_mode": "mixed",
      "regex": ["Alpha|Gamma"], "exclude_outbounds": ["Gamma"]
    },
    {
      ".name": "pl_provider", ".type": "fallback_level", "group": "pg_main",
      "name": "Provider only", "order": "2", "filter_mode": "include", "regex": ["Provider only"]
    },
    {
      ".name": "pl_direct", ".type": "fallback_level", "group": "pg_main",
      "name": "Direct", "order": "3", "direct": "1"
    },
    {
      ".name": "pl_remaining", ".type": "fallback_level", "group": "pg_main",
      "name": "Remaining", "order": "4", "filter_mode": "disabled"
    }
  ]
}
JSON

validate "$WORK_DIR/fixture.json"
generate "$WORK_DIR/fixture.json" "$WORK_DIR/config.json"

ucode -e '
let fs = require("fs");
function fail(message) { die(message + "\n"); }
function outbound(config, tag) { for (let item in config.outbounds || []) if (item.tag == tag) return item; return null; }
function same(actual, expected, label) {
    if (sprintf("%J", actual || []) != sprintf("%J", expected))
        fail(label + ": " + sprintf("%J", actual));
}
let config = json(fs.readfile(ARGV[0]));
let cache = json(fs.readfile(ARGV[1]));
let prefix = "proxy-fallback-pg_main-level-";
let top = outbound(config, prefix + "pl_top-out");
let mixed = outbound(config, prefix + "pl_mixed-out");
let providerOnly = outbound(config, prefix + "pl_provider-out");
let direct = outbound(config, prefix + "pl_direct-out");
let remaining = outbound(config, prefix + "pl_remaining-out");
let group = outbound(config, "proxy-fallback-pg_main-out");
for (let item in [top, mixed, providerOnly, direct, remaining, group])
    if (!item || item.type != "fallback") fail("Fallback must be composed only from native fallback groups");

same(top.outbounds, ["Beta"], "top static members");
same(mixed.outbounds, ["Alpha"], "mixed static members");
same(providerOnly.outbounds, [], "provider-only static members");
same(direct.outbounds, ["direct-out"], "direct level");
same(remaining.outbounds, ["Gamma"], "remaining static members");
same(group.outbounds, [top.tag, mixed.tag, providerOnly.tag, direct.tag, remaining.tag], "outer level order");
same(mixed.exclude_group_members, [top.tag], "second level excludes first");
same(remaining.exclude_group_members, [top.tag, mixed.tag, providerOnly.tag, direct.tag], "remaining level excludes every higher level");

for (let item in [top, mixed, providerOnly, remaining]) {
    same(item.providers, ["proxy-subscription-1-provider"], "native provider binding");
    if (item.exclude_types != null) fail("Fallback still contains removed provider type filters");
    if (item.blacklist_timeout != "45s") fail("native blacklist timeout missing");
}
if (direct.providers != null) fail("direct level must not consume providers");
if (top.include == null || mixed.include == null || mixed.exclude == null)
    fail("native include/exclude filters are missing");

let cached = (cache.fallbackGroups || {})[group.tag];
if (!cached || cached.blacklist_timeout != "45s" || length(cached.levels || []) != 5)
    fail("native Fallback dashboard metadata is incomplete");
if (cached.levels[0].tag != top.tag || cached.levels[4].tag != remaining.tag)
    fail("Fallback level runtime tags are not cached");
let selector = outbound(config, "proxy-out");
if (!selector || selector.default != group.tag)
    fail("section selector must default to its first Fallback group");
' "$WORK_DIR/config.json" "$WORK_DIR/config.json.section-cache/proxy.json"

cat >"$WORK_DIR/bad-timeout.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"] },
  "section": [{ ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" }],
  "fallback_group": [{ ".name": "pg", ".type": "fallback_group", "section": "proxy", "name": "Bad", "blacklist_timeout": "later" }]
}
JSON
if output="$(validate "$WORK_DIR/bad-timeout.json" 2>/dev/null)"; then
  printf 'invalid Fallback blacklist timeout was accepted\n' >&2
  exit 1
fi
grep -Fq 'blacklist_timeout' <<<"$output"

test ! -e "$FORKOP_LIB/singbox/fallback.uc"

printf 'Native Fallback checks passed\n'
