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
      "attempt_timeout": "9s", "expected_status": "204/200-299",
      "idle_timeout": "20m",
      "interrupt_exist_connections": "1"
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
for field in health_check_url health_check_interval health_check_timeout attempt_timeout expected_status idle_timeout interrupt_exist_connections; do
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
let group = outbound(config, "proxy/Main fallback");
let defaultGroup = outbound(config, "proxy/Default fallback");
if (!group || group.type != "fallback" || length(group.groups || []) != 5 || group.levels != null)
    fail("Fallback must be one native group with inline server groups");
let top = group.groups[0];
let mixed = group.groups[1];
let providerOnly = group.groups[2];
let direct = group.groups[3];
let remaining = group.groups[4];

same(top.outbounds, ["proxy/Beta"], "top static members");
same(mixed.outbounds, ["proxy/Alpha"], "mixed static members");
same(providerOnly.outbounds, [], "provider-only static members");
same(direct.outbounds, ["direct-out"], "direct level");
same(remaining.outbounds, ["proxy/Gamma"], "remaining static members");
if (top.tag != null || mixed.tag != null || providerOnly.tag != null || direct.tag != null || remaining.tag != null)
    fail("server groups still expose the removed tag field");
if (group.outbounds != null || group.exclude_group_members != null)
    fail("Fallback still contains nested group fields");

for (let item in [top, mixed, providerOnly, remaining]) {
    same(item.providers, ["proxy/sub1"], "native provider binding");
    if (item.exclude_types != null) fail("Fallback still contains removed provider type filters");
}
if (direct.providers != null) fail("direct level must not consume providers");
if (top.include == null || mixed.include == null || mixed.exclude == null)
    fail("native include/exclude filters are missing");
if (group.url != "https://health.example/generate_204" || group.interval != "12s" ||
    group.timeout != "4s" || group.attempt_timeout != "9s" ||
    group.expected_status != "204/200-299" ||
    group.idle_timeout != "20m" ||
    group.interrupt_exist_connections != true)
    fail("native Fallback health settings are incomplete");
if (!defaultGroup || defaultGroup.interval != "5m" || defaultGroup.timeout != "5s" ||
    defaultGroup.attempt_timeout != "5s" || defaultGroup.expected_status != "*" ||
    defaultGroup.idle_timeout != "5m" ||
    defaultGroup.interrupt_exist_connections != false)
    fail("native Fallback defaults do not match Mihomo timing");
if (group.max_failed_times != null || defaultGroup.max_failed_times != null)
    fail("the failure counter is a core constant and must not be generated");

for (let item in config.outbounds || [])
    if (index(item.tag || "", "proxy-fallback-pg_main-level-") == 0)
        fail("Fallback still generates nested level outbounds");
let selector = outbound(config, "proxy");
if (!selector || selector.default != group.tag)
    fail("section selector must default to its first Fallback group");
' "$WORK_DIR/config.json"

cat >"$WORK_DIR/bad-timeout.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"] },
  "section": [{ ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" }],
  "fallback_group": [{ ".name": "pg", ".type": "fallback_group", "section": "proxy", "name": "Bad", "attempt_timeout": "later" }],
  "fallback_level": [{ ".name": "level", ".type": "fallback_level", "group": "pg", "name": "Level" }]
}
JSON
if output="$(validate "$WORK_DIR/bad-timeout.json" 2>/dev/null)"; then
  printf 'invalid Fallback health check timeout was accepted\n' >&2
  exit 1
fi
grep -Fq 'attempt_timeout' <<<"$output"

cat >"$WORK_DIR/bad-status.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"] },
  "section": [{ ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" }],
  "fallback_group": [{ ".name": "pg", ".type": "fallback_group", "section": "proxy", "name": "Bad", "expected_status": "200-bad" }],
  "fallback_level": [{ ".name": "level", ".type": "fallback_level", "group": "pg", "name": "Level" }]
}
JSON
if output="$(validate "$WORK_DIR/bad-status.json" 2>/dev/null)"; then
  printf 'invalid Fallback expected status was accepted\n' >&2
  exit 1
fi
grep -Fq 'expected_status' <<<"$output"

for invalid_status in 99 600 299-200; do
  sed -e "s/\"expected_status\": \"200-bad\"/\"expected_status\": \"$invalid_status\"/" \
      "$WORK_DIR/bad-status.json" >"$WORK_DIR/bad-status-range.json"
  if validate "$WORK_DIR/bad-status-range.json" >/dev/null 2>&1; then
    printf 'invalid Fallback expected status %s was accepted\n' "$invalid_status" >&2
    exit 1
  fi
done

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
  printf 'Fallback without server groups was accepted\n' >&2
  exit 1
fi
grep -Fq 'has no server groups' <<<"$output"

cat >"$WORK_DIR/duplicate-server-groups.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"] },
  "section": [{ ".name": "proxy", ".type": "section", "label": "Proxy", "enabled": "1", "action": "connection" }],
  "fallback_group": [{ ".name": "pg", ".type": "fallback_group", "section": "proxy", "name": "Fallback" }],
  "fallback_level": [
    { ".name": "primary", ".type": "fallback_level", "group": "pg", "name": "Servers", "server_filter_mode": "direct" },
    { ".name": "backup", ".type": "fallback_level", "group": "pg", "name": "Servers", "server_filter_mode": "all" }
  ]
}
JSON
if output="$(validate "$WORK_DIR/duplicate-server-groups.json" 2>/dev/null)"; then
  printf 'Fallback with duplicate server group names was accepted\n' >&2
  exit 1
fi
grep -Fq "duplicate server group name 'Servers'" <<<"$output"

test ! -e "$FORKOP_LIB/singbox/fallback.uc"

printf 'Native Fallback checks passed\n'
