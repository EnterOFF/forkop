#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
GENERATOR="$FORKOP_LIB/singbox/generator.uc"
VALIDATOR="$FORKOP_LIB/config/validator.uc"
STATE="$FORKOP_LIB/service/state.uc"
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
      "name": "Main fallback", "health_check_url": "https://health.example/generate_204",
      "health_check_interval": "12s", "health_check_timeout": "4s",
      "idle_timeout": "20m",
      "interrupt_exist_connections": "1", "pin_dashboard": "1"
    },
    {
      ".name": "pg_default", ".type": "fallback_group", "section": "proxy",
      "name": "Default fallback"
    }
  ],
  "fallback_level": [
    {
      ".name": "pl_top", ".type": "fallback_level", "group": "pg_main",
      "name": "Top", "order": "0", "server_filter_mode": "include", "include_outbounds": ["Beta"]
    },
    {
      ".name": "pl_mixed", ".type": "fallback_level", "group": "pg_main",
      "name": "Mixed", "order": "1", "server_filter_mode": "include",
      "include_regex": "Alpha|Gamma", "exclude_outbounds": ["Gamma"]
    },
    {
      ".name": "pl_provider", ".type": "fallback_level", "group": "pg_main",
      "name": "Provider only", "order": "2", "server_filter_mode": "include", "include_regex": "Provider only"
    },
    {
      ".name": "pl_direct", ".type": "fallback_level", "group": "pg_main",
      "name": "Direct", "order": "3", "server_filter_mode": "direct"
    },
    {
      ".name": "pl_remaining", ".type": "fallback_level", "group": "pg_main",
      "name": "Remaining", "order": "4", "server_filter_mode": "all"
    },
    {
      ".name": "pl_default", ".type": "fallback_level", "group": "pg_default",
      "name": "Direct", "order": "0", "server_filter_mode": "direct"
    }
  ]
}
JSON

validate "$WORK_DIR/fixture.json"
generate "$WORK_DIR/fixture.json" "$WORK_DIR/config.json"

signature="$(ucode -L "$FORKOP_LIB" "$STATE" sing-box-signature-body-fixture "$WORK_DIR/fixture.json")"
for field in health_check_url health_check_interval health_check_timeout idle_timeout interrupt_exist_connections; do
  grep -Fq "\"$field\"" <<<"$signature" || {
    printf 'Fallback runtime signature is missing %s\n' "$field" >&2
    exit 1
  }
done
if grep -Fq 'blacklist_timeout' <<<"$signature"; then
  printf 'Fallback runtime signature still contains blacklist_timeout\n' >&2
  exit 1
fi

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
let group = outbound(config, "proxy-fallback-pg_main-out");
let defaultGroup = outbound(config, "proxy-fallback-pg_default-out");
if (!group || group.type != "fallback" || length(group.levels || []) != 5)
    fail("Fallback must be one native group with inline levels");
let top = group.levels[0];
let mixed = group.levels[1];
let providerOnly = group.levels[2];
let direct = group.levels[3];
let remaining = group.levels[4];

same(top.outbounds, ["Beta"], "top static members");
same(mixed.outbounds, ["Alpha"], "mixed static members");
same(providerOnly.outbounds, [], "provider-only static members");
same(direct.outbounds, ["direct-out"], "direct level");
same(remaining.outbounds, ["Gamma"], "remaining static members");
same([top.tag, mixed.tag, providerOnly.tag, direct.tag, remaining.tag],
    ["pl_top", "pl_mixed", "pl_provider", "pl_direct", "pl_remaining"], "level order");
if (group.outbounds != null || group.exclude_group_members != null)
    fail("Fallback still contains nested group fields");

for (let item in [top, mixed, providerOnly, remaining]) {
    same(item.providers, ["proxy-subscription-1-provider"], "native provider binding");
    if (item.exclude_types != null) fail("Fallback still contains removed provider type filters");
}
if (direct.providers != null) fail("direct level must not consume providers");
if (top.include == null || mixed.include == null || mixed.exclude == null)
    fail("native include/exclude filters are missing");
if (group.url != "https://health.example/generate_204" || group.interval != "12s" ||
    group.timeout != "4s" || group.idle_timeout != "20m" ||
    group.interrupt_exist_connections != true)
    fail("native Fallback health settings are incomplete");
if (!defaultGroup || defaultGroup.interval != "5m" || defaultGroup.timeout != "5s" ||
    defaultGroup.idle_timeout != "5m" ||
    defaultGroup.interrupt_exist_connections != true)
    fail("native Fallback defaults do not match Mihomo timing");

let cached = (cache.fallbackGroups || {})[group.tag];
if (!cached || cached.url != group.url || cached.interval != group.interval ||
    cached.timeout != group.timeout ||
    cached.idle_timeout != group.idle_timeout || cached.interrupt_exist_connections != true ||
    length(cached.levels || []) != 5)
    fail("native Fallback dashboard metadata is incomplete");
if (cached.levels[0].tag != "pl_top" || cached.levels[4].tag != "pl_remaining")
    fail("Fallback level metadata is not cached");
for (let item in config.outbounds || [])
    if (index(item.tag || "", "proxy-fallback-pg_main-level-") == 0)
        fail("Fallback still generates nested level outbounds");
let selector = outbound(config, "proxy-out");
if (!selector || selector.default != group.tag)
    fail("section selector must default to its first Fallback group");
' "$WORK_DIR/config.json" "$WORK_DIR/config.json.section-cache/proxy.json"

cat >"$WORK_DIR/bad-timeout.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"] },
  "section": [{ ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" }],
  "fallback_group": [{ ".name": "pg", ".type": "fallback_group", "section": "proxy", "name": "Bad", "health_check_timeout": "later" }],
  "fallback_level": [{ ".name": "level", ".type": "fallback_level", "group": "pg", "name": "Level" }]
}
JSON
if output="$(validate "$WORK_DIR/bad-timeout.json" 2>/dev/null)"; then
  printf 'invalid Fallback health check timeout was accepted\n' >&2
  exit 1
fi
grep -Fq 'health_check_timeout' <<<"$output"

cat >"$WORK_DIR/bad-idle.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"] },
  "section": [{ ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" }],
  "fallback_group": [{ ".name": "pg", ".type": "fallback_group", "section": "proxy", "name": "Bad", "health_check_interval": "1m", "idle_timeout": "10s" }],
  "fallback_level": [{ ".name": "level", ".type": "fallback_level", "group": "pg", "name": "Level" }]
}
JSON
if output="$(validate "$WORK_DIR/bad-idle.json" 2>/dev/null)"; then
  printf 'Fallback interval longer than idle timeout was accepted\n' >&2
  exit 1
fi
grep -Fq 'longer than its idle timeout' <<<"$output"

cat >"$WORK_DIR/no-levels.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"] },
  "section": [{ ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" }],
  "fallback_group": [{ ".name": "pg", ".type": "fallback_group", "section": "proxy", "name": "Empty" }]
}
JSON
if output="$(validate "$WORK_DIR/no-levels.json" 2>/dev/null)"; then
  printf 'Fallback without levels was accepted\n' >&2
  exit 1
fi
grep -Fq 'has no levels' <<<"$output"

test ! -e "$FORKOP_LIB/singbox/fallback.uc"

printf 'Native Fallback checks passed\n'
