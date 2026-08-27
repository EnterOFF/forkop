#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
GENERATOR_UC="$FORKOP_LIB/singbox/generator.uc"
VALIDATOR_UC="$FORKOP_LIB/config/validator.uc"

cat >"$WORK_DIR/runtime-tags.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "log_level": "warn", "bittorrent_direct": "1" },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "label": "Main",
      "enabled": "1",
      "action": "connection",
      "subscription_urls": [ "https://duplicate.example/sub" ],
      "selector_proxy_links": [ "socks://127.0.0.1:1080#manual" ],
      "outbound_jsons": [
        "{\"type\":\"socks\",\"tag\":\"germany\",\"server\":\"127.0.0.1\",\"server_port\":1201}",
        "{\"type\":\"socks\",\"tag\":\"germany\",\"server\":\"127.0.0.1\",\"server_port\":1203}",
        "{\"type\":\"direct\",\"tag\":\"direct-out\"}",
        "{\"type\":\"socks\",\"tag\":\"json-hop\",\"server\":\"127.0.0.1\",\"server_port\":1202}",
        "{\"type\":\"selector\",\"tag\":\"json-group\",\"outbounds\":[\"proxy-json-4-out\",\"direct-out\"],\"default\":\"json-hop\"}",
        "{\"type\":\"direct\",\"tag\":\"service-mixed-in\"}"
      ],
      "domain_suffix": [ "example.org" ]
    },
    {
      ".name": "backup",
      ".type": "section",
      "label": "Backup",
      "enabled": "1",
      "action": "connection",
      "outbound_jsons": [
        "{\"type\":\"socks\",\"tag\":\"json-hop\",\"server\":\"127.0.0.1\",\"server_port\":1301}"
      ],
      "domain_suffix": [ "backup.example.org" ]
    }
  ],
  "section_interface": [
    {
      ".name": "cfg-interface",
      ".type": "section_interface",
      "section": "proxy",
      "name": "wg0",
      "display_name": "NL Amsterdam"
    }
  ],
  "tunnel": [
    {
      ".name": "tun_tailnet",
      ".type": "tunnel",
      "section": "proxy",
      "order": "0",
      "kind": "tailscale",
      "name": "Tailnet",
      "tailscale_auth_key": "tskey-auth-test"
    }
  ],
  "urltest": [
    {
      ".name": "ut_name",
      ".type": "urltest",
      "section": "proxy",
      "name": "By name",
      "server_filter_mode": "include",
      "include_outbounds": [ "germany", "NL Amsterdam", "json-hop" ]
    },
    {
      ".name": "ut_regex",
      ".type": "urltest",
      "section": "proxy",
      "name": "By regex",
      "server_filter_mode": "include",
      "include_regex": "^germany$"
    }
  ],
  "fallback_group": [
    {
      ".name": "pg_main",
      ".type": "fallback_group",
      "section": "proxy",
      "name": "Fallback"
    }
  ],
  "fallback_level": [
    {
      ".name": "pl_main",
      ".type": "fallback_level",
      "group": "pg_main",
      "name": "All",
      "order": "0",
      "server_filter_mode": "all"
    }
  ]
}
JSON

runtime_config="$WORK_DIR/runtime-config.json"
ucode -L "$FORKOP_LIB" "$GENERATOR_UC" generate-config-fixture \
  "$WORK_DIR/runtime-tags.json" "$runtime_config" "127.0.0.1" "0"

cat >"$WORK_DIR/link-names.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings" },
  "section": [
    {
      ".name": "links", ".type": "section", "label": "Links", "enabled": "1", "action": "connection",
      "selector_proxy_links": [
        "anytls://secret@example.com:443#AnyTLS%20Node",
        "naive+https://user:pass@example.com:443#Naive+Node",
        "https://user:pass@example.com:443#HTTP%20Node",
        "hysteria://example.com:443#Hysteria%20Node",
        "hy2://secret@example.com:443#Hysteria2%20Node",
        "mierus://user:pass@example.com?profile=default#Mieru+Node",
        "socks5://user:pass@example.com:1080#SOCKS%20Node",
        "ss://YWVzLTEyOC1nY206cGFzcw@example.com:8388#SS%20Node",
        "trojan://secret@example.com:443#Trojan%20Node",
        "tuic://uuid:password@example.com:443#TUIC%20Node",
        "vless://00000000-0000-4000-8000-000000000001@example.com:443#VLESS%20Node",
        "vmess://eyJ2IjoiMiIsInBzIjoiVk1lc3MgV1MiLCJhZGQiOiIxMjcuMC4wLjEiLCJwb3J0IjoiNDQzIiwiaWQiOiIyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIiLCJhaWQiOiI0Iiwic2N5IjoiYXV0byIsIm5ldCI6IndzIiwidHlwZSI6Im5vbmUiLCJob3N0Ijoidm1lc3MuZXhhbXBsZSIsInBhdGgiOiIvdm1lc3MiLCJ0bHMiOiJ0bHMiLCJzbmkiOiJ2bWVzcy5leGFtcGxlIiwiYWxwbiI6ImgyLGh0dHAvMS4xIiwiZnAiOiJjaHJvbWUifQ==",
        "vmess://{\"ps\":\"Raw VMess\",\"add\":\"127.0.0.1\",\"port\":\"1080\",\"id\":\"00000000-0000-4000-8000-000000000000\",\"net\":\"ws\",\"path\":\"/ws?ed=2048#inside\"}",
        "trojan://secret@example.com:443"
      ]
    }
  ]
}
JSON
ucode -L "$FORKOP_LIB" "$GENERATOR_UC" generate-config-fixture \
  "$WORK_DIR/link-names.json" "$WORK_DIR/link-names-runtime.json" "127.0.0.1" "0"
ucode -e '
let config = json(require("fs").readfile(ARGV[0]));
let actual = [];
for (let outbound in config.outbounds || [])
    if (outbound.type == "parser")
        push(actual, outbound.tag);
let expected = [
    "Links/AnyTLS Node", "Links/Naive+Node", "Links/HTTP Node",
    "Links/Hysteria Node", "Links/Hysteria2 Node", "Links/Mieru+Node",
    "Links/SOCKS Node", "Links/SS Node", "Links/Trojan Node",
    "Links/TUIC Node", "Links/VLESS Node", "Links/VMess WS", "Links/Raw VMess", "Links/Node #14"
];
if (sprintf("%J", actual) != sprintf("%J", expected)) {
    warn("link parser names differ: " + sprintf("%J", actual) + "\n");
    exit(1);
}
' "$WORK_DIR/link-names-runtime.json" || fail "Forkop link names must match sing-box parser semantics"

# A manual link carries its protocol in its scheme, and a group filtering by
# protocol has to see it. A scheme the map does not know left the node with no
# protocol at all, so it survived a filter that was told to exclude it.
cat >"$WORK_DIR/link-types.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings" },
  "section": [
    {
      ".name": "links", ".type": "section", "label": "Links", "enabled": "1", "action": "connection",
      "selector_proxy_links": [
        "hy://example.com:443?auth=secret#Hysteria",
        "socks5h://user:pass@example.com:1080#SOCKS",
        "vless://00000000-0000-4000-8000-000000000001@example.com:443#VLESS"
      ]
    }
  ],
  "urltest": [
    {
      ".name": "ut_types", ".type": "urltest", "section": "links", "name": "Filtered",
      "server_filter_mode": "exclude", "exclude_types": [ "hysteria", "socks" ]
    }
  ]
}
JSON
ucode -L "$FORKOP_LIB" "$GENERATOR_UC" generate-config-fixture   "$WORK_DIR/link-types.json" "$WORK_DIR/link-types-runtime.json" "127.0.0.1" "0"
ucode -e '
let config = json(require("fs").readfile(ARGV[0]));
let urltest = null;
for (let outbound in config.outbounds || [])
    if (outbound.type == "urltest")
        urltest = outbound;
if (urltest == null)
    die("the filtered group was not generated
");
let expected = [ "Links/VLESS" ];
if (sprintf("%J", urltest.outbounds || []) != sprintf("%J", expected)) {
    warn("filtered group members differ: " + sprintf("%J", urltest.outbounds) + "
");
    exit(1);
}
' "$WORK_DIR/link-types-runtime.json" || fail "a manual link must be filtered by the protocol of its scheme"

ucode -e '
let fs = require("fs");
let config = json(fs.readfile(ARGV[0]));
let by_tag = {};
let count = 0;
let torrent_rule = null;
for (let rule in config.route.rules || [])
    if (rule.protocol == "bittorrent")
        torrent_rule = rule;
if (!torrent_rule || torrent_rule.action != "route" || torrent_rule.outbound != "direct-out" ||
    index(torrent_rule.inbound, "tproxy-in") < 0 || index(torrent_rule.inbound, "tproxy6-in") < 0)
    die("enabled BitTorrent direct routing rule is missing\n");
for (let outbound in config.outbounds || []) {
    if (by_tag[outbound.tag])
        die("duplicate generated outbound tag: " + outbound.tag + "\n");
    by_tag[outbound.tag] = outbound;
    count++;
}
for (let endpoint in config.endpoints || []) {
    if (by_tag[endpoint.tag])
        die("duplicate generated endpoint tag: " + endpoint.tag + "\n");
    by_tag[endpoint.tag] = endpoint;
    count++;
}
if (length(keys(by_tag)) != count)
    die("generated outbound tags are not globally unique\n");

for (let tag in [
    "direct-out", "Main", "Backup",
    "Main/manual", "Main/NL Amsterdam", "Main/Tailnet",
    "Main/germany", "Main/germany #2", "Main/direct-out", "Main/json-hop",
    "Main/json-group", "Main/service-mixed-in", "Backup/json-hop",
    "Main/By name", "Main/By regex", "Main/Fallback"
])
    if (!by_tag[tag])
        die("missing allocated outbound tag: " + tag + "; got " + sprintf("%J", keys(by_tag)) + "\n");

let manual = by_tag["Main/manual"];
if (manual.type != "parser" || manual.link != "socks://127.0.0.1:1080#manual")
    die("manual URI was not emitted as a parser outbound\n");
let proxy_selector = by_tag["Main"];
let expected_providers = [ "Main/sub1" ];
if (sprintf("%J", proxy_selector.providers || []) != sprintf("%J", expected_providers))
    die("selector must reference only subscriptions from its section\n");
let expected_selector_outbounds = [
    "Main/By name", "Main/By regex", "Main/Fallback", "Main/manual",
    "Main/NL Amsterdam", "Main/Tailnet", "Main/germany", "Main/germany #2",
    "Main/direct-out", "Main/json-hop", "Main/json-group", "Main/service-mixed-in"
];
if (sprintf("%J", proxy_selector.outbounds || []) != sprintf("%J", expected_selector_outbounds))
    die("selector outbounds do not follow group and configured-node order\n");

let json_group = by_tag["Main/json-group"];
if (length(json_group.outbounds || []) != 2 ||
    json_group.outbounds[0] != "Main/json-hop" || json_group.outbounds[1] != "Main/direct-out")
    die("JSON outbound references were not rewritten to allocated tags\n");
if (json_group.default != "Main/json-hop")
    die("JSON selector default was not rewritten to its allocated tag\n");

let name_group = by_tag["Main/By name"];
let regex_group = by_tag["Main/By regex"];
if (length(name_group.outbounds || []) != 3)
    die("display-name filter selected " + sprintf("%J", name_group.outbounds || []) + "\n");
for (let tag in [ "Main/germany", "Main/NL Amsterdam", "Main/json-hop" ])
    if (index(name_group.outbounds, tag) < 0)
        die("display-name filter is missing " + tag + "\n");
if (length(regex_group.outbounds || []) != 1)
    die("display-name regex did not target the final visible tag\n");
for (let tag in [ "Main/germany" ])
    if (index(regex_group.outbounds, tag) < 0)
        die("display-name regex is missing " + tag + "\n");
if (sprintf("%J", name_group.providers || []) != sprintf("%J", expected_providers) ||
    index(name_group.include || "", "germany") < 0)
    die("native provider filter was not attached to the URLTest group\n");
let fallback_group = by_tag["Main/Fallback"];
let fallback_level = fallback_group && (fallback_group.groups || [])[0];
if (!fallback_level || fallback_level.tag != null ||
    sprintf("%J", fallback_level.providers || []) != sprintf("%J", expected_providers))
    die("subscription provider was not bound to Fallback\n");
if (fs.stat(ARGV[0] + ".runtime-manifest.json") != null)
    die("runtime manifest was generated\n");
' "$runtime_config" || fail "runtime outbound tag allocation"

cat >"$WORK_DIR/duplicate-json-tags.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings" },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "outbound_jsons": [
        "{\"type\":\"direct\",\"tag\":\"same\"}",
        "{\"type\":\"direct\",\"tag\":\"same\"}"
      ],
      "domain_suffix": [ "example.org" ]
    }
  ]
}
JSON

cat >"$WORK_DIR/tagless-json.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings" },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "outbound_jsons": [ "{\"type\":\"direct\"}" ],
      "domain_suffix": [ "example.org" ]
    }
  ]
}
JSON

cat >"$WORK_DIR/duplicate-section-names.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings" },
  "section": [
    { ".name": "one", ".type": "section", "label": "Office", "enabled": "0" },
    { ".name": "two", ".type": "section", "label": "Office", "enabled": "0" }
  ]
}
JSON

cat >"$WORK_DIR/slash-server-name.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings" },
  "server": [
    { ".name": "server", ".type": "server", "label": "Home/Server", "enabled": "0" }
  ]
}
JSON

cat >"$WORK_DIR/duplicate-subscription-tags.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings" },
  "section": [
    { ".name": "proxy", ".type": "section", "label": "Office", "enabled": "0" }
  ],
  "subscription_url": [
    { ".name": "one", ".type": "subscription_url", "section": "proxy", "url": "https://one.example/sub", "tag": "premium" },
    { ".name": "two", ".type": "subscription_url", "section": "proxy", "url": "https://two.example/sub", "tag": "premium" }
  ]
}
JSON

cat >"$WORK_DIR/cross-namespace-display-name.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings" },
  "section": [
    { ".name": "proxy", ".type": "section", "label": "Shared", "enabled": "0" }
  ],
  "server": [
    { ".name": "server", ".type": "server", "label": "Shared", "enabled": "0" }
  ]
}
JSON

validate_rejects() {
  local fixture="$1"
  local expected="$2"
  local output
  local normalized="$WORK_DIR/validator-$(basename "$fixture")"
  node - "$fixture" "$normalized" <<'JS'
const fs = require('fs');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
input.settings.dns_server = ['77.88.8.8'];
input.settings.bootstrap_dns_server = ['77.88.8.8'];
fs.writeFileSync(process.argv[3], JSON.stringify(input));
JS
  if output="$(FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$VALIDATOR_UC" \
      validate-runtime-fixture "$normalized" '{}' 2>/dev/null)"; then
    fail "validator accepted $fixture"
  fi
  printf '%s\n' "$output" | grep -Fq "$expected" ||
    fail "validator message for $fixture does not contain: $expected"
}

# A subscription that stores no tag is named after its position, and one that
# stores a name another subscription's position would take pushes it to the next
# free number instead of producing the duplicate the whole configuration is
# refused for.
cat >"$WORK_DIR/untagged-subscriptions.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": [ "77.88.8.8" ], "bootstrap_dns_server": [ "77.88.8.8" ]
  },
  "section": [
    { ".name": "proxy", ".type": "section", "label": "Main", "enabled": "1", "action": "connection" }
  ],
  "subscription_url": [
    { ".name": "one", ".type": "subscription_url", "section": "proxy", "url": "https://one.example/sub" },
    { ".name": "two", ".type": "subscription_url", "section": "proxy", "url": "https://two.example/sub" }
  ]
}
JSON
sed 's|"url": "https://two.example/sub"|"url": "https://two.example/sub", "tag": "sub1"|' \
  "$WORK_DIR/untagged-subscriptions.json" >"$WORK_DIR/subscription-tag-takes-a-position.json"

assert_subscription_tags() {
  local fixture="$1"
  local expected="$2"
  local validation
  validation="$(FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$VALIDATOR_UC" \
    validate-runtime-fixture "$fixture" '{}' 2>&1 || true)"
  [ -z "$validation" ] || fail "$(basename "$fixture") was rejected: $validation"

  FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$GENERATOR_UC" generate-config-fixture \
    "$fixture" "$fixture.config" 127.0.0.1 0
  ucode -e '
let config = json(require("fs").readfile(ARGV[0]));
let actual = [];
for (let provider in config.providers || [])
    push(actual, provider.tag);
if (sprintf("%J", actual) != ARGV[1]) {
    warn("subscription providers became " + sprintf("%J", actual) + ", not " + ARGV[1] + "\n");
    exit(1);
}
' "$fixture.config" "$expected" || fail "$(basename "$fixture") named its providers wrong"
}

assert_subscription_tags "$WORK_DIR/untagged-subscriptions.json" '[ "Main/sub1", "Main/sub2" ]'
assert_subscription_tags "$WORK_DIR/subscription-tag-takes-a-position.json" '[ "Main/sub2", "Main/sub1" ]'

validate_rejects "$WORK_DIR/duplicate-json-tags.json" "duplicate JSON outbound tag 'same'"
validate_rejects "$WORK_DIR/tagless-json.json" "JSON outbound without a non-empty tag"
validate_rejects "$WORK_DIR/duplicate-section-names.json" "Duplicate section display name 'Office'"
validate_rejects "$WORK_DIR/slash-server-name.json" "Server display name 'Home/Server' contains '/'"
validate_rejects "$WORK_DIR/duplicate-subscription-tags.json" "Duplicate subscription tag 'premium'"
validate_rejects "$WORK_DIR/cross-namespace-display-name.json" "Duplicate server display name 'Shared'"

printf 'outbound tag checks passed\n'
