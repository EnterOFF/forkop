#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
GENERATOR="$FORKOP_LIB/singbox/generator.uc"
VALIDATOR="$FORKOP_LIB/config/validator.uc"

assert_rejects() {
  local label="$1" fixture="$2" expected="$3" output
  output="$(ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-runtime-fixture "$fixture" '{}' 2>&1 || true)"
  case "$output" in
    *"$expected"*) ;;
    "") fail "$label was accepted" ;;
    *) fail "$label reported '$output'" ;;
  esac
}

generate() {
  local fixture="$1" output="$2" validation
  validation="$(ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-runtime-fixture "$fixture" '{}' 2>&1 || true)"
  [ -z "$validation" ] || fail "valid fixture was rejected: $validation"
  ucode -L "$FORKOP_LIB" "$GENERATOR" generate-config-fixture "$fixture" "$output" 127.0.0.1 0
}

cat >"$WORK_DIR/fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "dns_server": [ "1.1.1.1" ],
    "bootstrap_dns_server": [ "1.1.1.1" ],
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "selector_proxy_links": [
        "vless://11111111-1111-1111-1111-111111111111@vless.example:443?security=tls#VLESS node",
        "socks5://socks.example:1080#SOCKS node",
        "ss://YWVzLTI1Ni1nY206cGFzcw@ss.example:8388#SS node"
      ]
    }
  ],
  "subscription_url": [
    {
      ".name": "source",
      ".type": "subscription_url",
      "section": "proxy",
      "url": "https://example.com/subscription",
      "tag": "sub1",
      "server_filter_mode": "exclude",
      "exclude_types": [ "shadowsocks", "Trojan" ]
    }
  ],
  "urltest": [
    {
      ".name": "fast",
      ".type": "urltest",
      "section": "proxy",
      "name": "Fast",
      "server_filter_mode": "exclude",
      "exclude_types": [ "socks" ]
    }
  ],
  "fallback_group": [
    {
      ".name": "backup",
      ".type": "fallback_group",
      "section": "proxy",
      "name": "Backup"
    }
  ],
  "fallback_level": [
    {
      ".name": "level",
      ".type": "fallback_level",
      "group": "backup",
      "name": "Primary",
      "server_filter_mode": "exclude",
      "exclude_types": [ "vless" ],
      "include_groups": [ "Fast" ]
    }
  ]
}
JSON

generate "$WORK_DIR/fixture.json" "$WORK_DIR/config.json"

ucode -e '
let fs = require("fs");
let config = json(fs.readfile(ARGV[0]));
let provider = null;
let by_tag = {};
for (let item in config.providers || [])
    if (item.tag == "proxy/sub1")
        provider = item;
for (let outbound in config.outbounds || [])
    by_tag[outbound.tag] = outbound;

if (!provider || length(provider.exclude_types || []) != 2 ||
    provider.exclude_types[0] != "shadowsocks" || provider.exclude_types[1] != "trojan")
    die("subscription provider did not receive the normalized type filter");

let fast = by_tag["proxy/Fast"];
if (!fast || length(fast.exclude_types || []) != 1 || fast.exclude_types[0] != "socks")
    die("URLTest did not receive its native type filter");
if (index(fast.outbounds || [], "proxy/SOCKS node") >= 0)
    die("manual server of an excluded type stayed in the URLTest");
if (index(fast.outbounds || [], "proxy/VLESS node") < 0 || index(fast.outbounds || [], "proxy/SS node") < 0)
    die("URLTest dropped manual servers of allowed types");
if (index(fast.outbounds || [], "proxy/Backup") >= 0)
    die("URLTest must not hold another group");

let backup = by_tag["proxy/Backup"];
if (!backup || length(backup.groups || []) != 1)
    die("fallback group was not generated");
let level = backup.groups[0];
if (length(level.exclude_types || []) != 1 || level.exclude_types[0] != "vless")
    die("fallback level did not receive its native type filter");
if (index(level.outbounds || [], "proxy/VLESS node") >= 0)
    die("manual server of an excluded type stayed in the fallback level");
if (index(level.outbounds || [], "proxy/Fast") < 0)
    die("fallback level did not include the referenced URLTest");

let selector = by_tag["proxy"];
if (index(selector.outbounds || [], "proxy/Fast") < 0 || index(selector.outbounds || [], "proxy/Backup") < 0)
    die("section selector lost its groups");
' "$WORK_DIR/config.json" || fail "server type and group filter generation"

# AmneziaWG is a Forkop tunnel type rather than a sing-box protocol, so the
# filter has to tell it apart from a plain WireGuard endpoint.
cat >"$WORK_DIR/amnezia.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [
    {
      ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection",
      "selector_proxy_links": [ "socks5://socks.example:1080#Node" ]
    }
  ],
  "tunnel": [
    {
      ".name": "plain", ".type": "tunnel", "section": "proxy", "kind": "json",
      "endpoint_json": "{\"type\":\"wireguard\",\"tag\":\"Plain WG\"}"
    },
    {
      ".name": "junk", ".type": "tunnel", "section": "proxy", "kind": "json",
      "endpoint_json": "{\"type\":\"amneziawg\",\"tag\":\"Amnezia WG\",\"amnezia\":{\"jc\":4,\"s1\":64}}"
    },
    {
      ".name": "warp", ".type": "tunnel", "section": "proxy", "kind": "json",
      "endpoint_json": "{\"type\":\"warp\",\"tag\":\"WARP junk\",\"amnezia\":{\"jc\":4}}"
    }
  ],
  "urltest": [
    {
      ".name": "noamnezia", ".type": "urltest", "section": "proxy", "name": "No amnezia",
      "server_filter_mode": "exclude", "exclude_types": [ "amneziawg" ]
    },
    {
      ".name": "nowireguard", ".type": "urltest", "section": "proxy", "name": "No wireguard",
      "server_filter_mode": "exclude", "exclude_types": [ "wireguard" ]
    },
    {
      ".name": "nointerface", ".type": "urltest", "section": "proxy", "name": "No interface",
      "server_filter_mode": "exclude", "exclude_types": [ "direct" ]
    }
  ]
}
JSON

generate "$WORK_DIR/amnezia.json" "$WORK_DIR/amnezia-config.json"

ucode -e '
let fs = require("fs");
let config = json(fs.readfile(ARGV[0]));
let by_tag = {};
for (let outbound in config.outbounds || [])
    by_tag[outbound.tag] = outbound;

let no_amnezia = by_tag["proxy/No amnezia"];
if (index(no_amnezia.outbounds || [], "proxy/Amnezia WG") >= 0)
    die("excluding AmneziaWG kept the AmneziaWG endpoint");
if (index(no_amnezia.outbounds || [], "proxy/Plain WG") < 0)
    die("excluding AmneziaWG dropped a plain WireGuard endpoint");
if (index(no_amnezia.outbounds || [], "proxy/WARP junk") < 0)
    die("excluding AmneziaWG dropped a WARP endpoint with junk fields");

let no_wireguard = by_tag["proxy/No wireguard"];
if (index(no_wireguard.outbounds || [], "proxy/Plain WG") >= 0)
    die("excluding WireGuard kept a plain WireGuard endpoint");
if (index(no_wireguard.outbounds || [], "proxy/Amnezia WG") < 0)
    die("excluding WireGuard also dropped the AmneziaWG endpoint");

// Only outbounds reach a provider, so an endpoint protocol has nothing to
// match natively and must not be written into the config.
let no_interface = by_tag["proxy/No interface"];
if (no_interface.exclude_types != null)
    die("an endpoint protocol leaked into the native type filter");
if (no_amnezia.exclude_types != null || no_wireguard.exclude_types != null)
    die("a Forkop-only protocol leaked into the native type filter");
' "$WORK_DIR/amnezia-config.json" || fail "AmneziaWG filtering"

cat >"$WORK_DIR/prune.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [
    {
      ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection",
      "selector_proxy_links": [ "socks5://socks.example:1080#Node" ]
    }
  ],
  "urltest": [
    { ".name": "empty", ".type": "urltest", "section": "proxy", "name": "Empty", "server_filter_mode": "include" },
    { ".name": "real", ".type": "urltest", "section": "proxy", "name": "Real", "server_filter_mode": "all" }
  ],
  "fallback_group": [
    { ".name": "dangling", ".type": "fallback_group", "section": "proxy", "name": "Dangling" }
  ],
  "fallback_level": [
    {
      ".name": "level", ".type": "fallback_level", "group": "dangling", "name": "Only empty",
      "server_filter_mode": "include", "include_groups": [ "Empty" ]
    }
  ]
}
JSON

generate "$WORK_DIR/prune.json" "$WORK_DIR/prune-config.json"

ucode -e '
let fs = require("fs");
let config = json(fs.readfile(ARGV[0]));
let by_tag = {};
for (let outbound in config.outbounds || [])
    by_tag[outbound.tag] = outbound;
if (by_tag["proxy/Empty"] != null)
    die("a group without members was generated");
if (by_tag["proxy/Dangling"] != null)
    die("a group that only referenced an empty group was kept");
if (by_tag["proxy/Real"] == null)
    die("pruning removed a group that still had members");
if (index(by_tag["proxy"].outbounds || [], "proxy/Dangling") >= 0)
    die("section selector kept a pruned group");
' "$WORK_DIR/prune-config.json" || fail "empty group pruning"

cat >"$WORK_DIR/missing.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [
    {
      ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection",
      "selector_proxy_links": [ "socks5://socks.example:1080#Node" ]
    }
  ],
  "fallback_group": [
    { ".name": "group", ".type": "fallback_group", "section": "proxy", "name": "Group" }
  ],
  "fallback_level": [
    {
      ".name": "level", ".type": "fallback_level", "group": "group", "name": "Level",
      "server_filter_mode": "include", "include_groups": [ "Nope" ]
    }
  ]
}
JSON
assert_rejects "missing URLTest reference" "$WORK_DIR/missing.json" "includes missing URLTest"

# A Fallback level holds URLTest groups only, so naming another Fallback is a
# missing reference rather than a nested ordering.
cat >"$WORK_DIR/nested-fallback.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [
    {
      ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection",
      "selector_proxy_links": [ "socks5://socks.example:1080#Node" ]
    }
  ],
  "fallback_group": [
    { ".name": "outer", ".type": "fallback_group", "section": "proxy", "name": "Outer" },
    { ".name": "inner", ".type": "fallback_group", "section": "proxy", "name": "Inner" }
  ],
  "fallback_level": [
    {
      ".name": "outer_level", ".type": "fallback_level", "group": "outer", "name": "Level",
      "server_filter_mode": "include", "include_groups": [ "Inner" ]
    },
    {
      ".name": "inner_level", ".type": "fallback_level", "group": "inner", "name": "Level",
      "server_filter_mode": "all"
    }
  ]
}
JSON
assert_rejects "nested fallback reference" "$WORK_DIR/nested-fallback.json" "includes missing URLTest"

cat >"$WORK_DIR/unknown-type.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [
    {
      ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection",
      "selector_proxy_links": [ "socks5://socks.example:1080#Node" ]
    }
  ],
  "urltest": [
    { ".name": "a", ".type": "urltest", "section": "proxy", "name": "A", "server_filter_mode": "exclude", "exclude_types": [ "shadowsocksx" ] }
  ]
}
JSON
assert_rejects "unknown server type" "$WORK_DIR/unknown-type.json" "is not available in URLTest"

cat >"$WORK_DIR/endpoint-type.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [
    {
      ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection",
      "selector_proxy_links": [ "socks5://socks.example:1080#Node" ]
    }
  ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "proxy",
      "url": "https://example.com/subscription", "tag": "sub1",
      "server_filter_mode": "exclude", "exclude_types": [ "direct" ]
    }
  ]
}
JSON
assert_rejects "endpoint type in a subscription" "$WORK_DIR/endpoint-type.json" "is not available in subscription"

cat >"$WORK_DIR/removed-type.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [
    {
      ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection",
      "selector_proxy_links": [ "socks5://socks.example:1080#Node" ]
    }
  ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "proxy",
      "url": "https://example.com/subscription", "tag": "sub1",
      "server_filter_mode": "exclude", "exclude_types": [ "shadowsocksr" ]
    }
  ]
}
JSON
assert_rejects "protocol sing-box removed" "$WORK_DIR/removed-type.json" "is not available in subscription"

# The LuCI dropdown repeats the backend lists, so drift between them would
# silently offer a filter that matches nothing.
node - "$ROOT_DIR/fe-app-forkop/src/forkop/tabs/sections/providers.ts" \
  "$(ucode -L "$FORKOP_LIB" -e 'let c = require("singbox.constants"); print(join(" ", c.FILTERABLE_PROVIDER_TYPES));')" \
  "$(ucode -L "$FORKOP_LIB" -e 'let c = require("singbox.constants"); print(join(" ", c.FILTERABLE_GROUP_TYPES));')" <<'NODE'
const fs = require('fs');
const source = fs.readFileSync(process.argv[2], 'utf8');

function listValues(functionName) {
  const start = source.indexOf(`function ${functionName}()`);
  if (start < 0) throw new Error(`${functionName} is missing`);
  const body = source.slice(start, source.indexOf('\n}', start));
  return [...body.matchAll(/\['([a-z0-9-]+)',/g)].map((match) => match[1]);
}

const provider = listValues('providerTypeChoices');
const group = [...provider, ...listValues('groupTypeChoices')];
const expectedProvider = process.argv[3].split(' ');
const expectedGroup = process.argv[4].split(' ');

if (JSON.stringify(provider) !== JSON.stringify(expectedProvider)) {
  console.error(`provider type choices drifted: ${provider} vs ${expectedProvider}`);
  process.exit(1);
}
if (JSON.stringify(group) !== JSON.stringify(expectedGroup)) {
  console.error(`group type choices drifted: ${group} vs ${expectedGroup}`);
  process.exit(1);
}
NODE

printf 'server type and group filter checks passed\n'
