#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
GENERATOR_UC="$FORKOP_LIB/singbox/generator.uc"
VALIDATOR_UC="$FORKOP_LIB/config/validator.uc"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

cat >"$WORK_DIR/runtime-tags.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "log_level": "warn", "bittorrent_direct": "1" },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
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

ucode -e '
let fs = require("fs");
let config = json(fs.readfile(ARGV[0]));
let manifest = json(fs.readfile(ARGV[1]));
let proxy_metadata = (manifest.sections || {}).proxy || {};
let backup_metadata = (manifest.sections || {}).backup || {};
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
if (length(keys(by_tag)) != count)
    die("generated outbound tags are not globally unique\n");

for (let tag in [
    "direct-out", "proxy-out", "backup-out",
    "germany", "germany-1", "service-mixed-in-1",
    "proxy-interface-1-out", "direct-out-1", "json-hop", "json-hop-1",
    "json-group", "proxy-urltest-ut_name-out", "proxy-urltest-ut_regex-out",
    "proxy-fallback-pg_main-out"
])
    if (!by_tag[tag])
        die("missing allocated outbound tag: " + tag + "\n");

let proxy_selector = by_tag["proxy-out"];
let expected_providers = [ "proxy-manual-provider", "proxy-subscription-1-provider" ];
if (sprintf("%J", proxy_selector.providers || []) != sprintf("%J", expected_providers))
    die("manual connection URL provider must precede subscription providers in the selector\n");
let expected_selector_outbounds = [
    "proxy-urltest-ut_name-out", "proxy-urltest-ut_regex-out", "proxy-fallback-pg_main-out",
    "proxy-interface-1-out", "proxy-tunnel-1-out", "germany", "germany-1", "direct-out-1", "json-hop",
    "json-group", "service-mixed-in-1"
];
if (sprintf("%J", proxy_selector.outbounds || []) != sprintf("%J", expected_selector_outbounds))
    die("selector outbounds do not follow group and configured-node order\n");
let expected_dashboard_sources = [
    { type: "outbound", tag: "proxy-urltest-ut_name-out" },
    { type: "outbound", tag: "proxy-urltest-ut_regex-out" },
    { type: "outbound", tag: "proxy-fallback-pg_main-out" },
    { type: "provider", tag: "proxy-manual-provider" },
    { type: "outbound", tag: "proxy-interface-1-out" },
    { type: "outbound", tag: "proxy-tunnel-1-out" },
    { type: "outbound", tag: "germany" },
    { type: "outbound", tag: "germany-1" },
    { type: "outbound", tag: "direct-out-1" },
    { type: "outbound", tag: "json-hop" },
    { type: "outbound", tag: "json-group" },
    { type: "outbound", tag: "service-mixed-in-1" },
    { type: "provider", tag: "proxy-subscription-1-provider" }
];
if (sprintf("%J", proxy_metadata.dashboardSources || []) != sprintf("%J", expected_dashboard_sources))
    die("runtime manifest does not preserve canonical dashboard source order\n");

let json_group = by_tag["json-group"];
if (length(json_group.outbounds || []) != 2 ||
    json_group.outbounds[0] != "json-hop" || json_group.outbounds[1] != "direct-out-1")
    die("JSON outbound references were not rewritten to allocated tags\n");
if (json_group.default != "json-hop")
    die("JSON selector default was not rewritten to its allocated tag\n");

let name_group = by_tag["proxy-urltest-ut_name-out"];
let regex_group = by_tag["proxy-urltest-ut_regex-out"];
if (length(name_group.outbounds || []) != 4)
    die("display-name filter did not select matching JSON and interface outbounds\n");
for (let tag in [ "germany", "germany-1", "proxy-interface-1-out", "json-hop" ])
    if (index(name_group.outbounds, tag) < 0)
        die("display-name filter is missing " + tag + "\n");
if (length(regex_group.outbounds || []) != 2)
    die("display-name regex did not collapse runtime suffixes\n");
for (let tag in [ "germany", "germany-1" ])
    if (index(regex_group.outbounds, tag) < 0)
        die("display-name regex is missing " + tag + "\n");
if (sprintf("%J", name_group.providers || []) != sprintf("%J", expected_providers) ||
    index(name_group.include || "", "germany") < 0)
    die("native provider filter was not attached to the URLTest group\n");
let fallback_group = by_tag["proxy-fallback-pg_main-out"];
let fallback_level = fallback_group && (fallback_group.levels || [])[0];
if (!fallback_level || fallback_level.tag != "pl_main" ||
    sprintf("%J", fallback_level.providers || []) != sprintf("%J", expected_providers))
    die("manual connection URL provider must precede subscription providers in Fallback\n");

let names = proxy_metadata.names || {};
for (let tag in [ "germany", "germany-1" ])
    if (names[tag] != "germany")
        die("runtime suffix leaked into display name for " + tag + "\n");
if (names["proxy-interface-1-out"] != "NL Amsterdam" || names["json-hop"] != "json-hop")
    die("interface or JSON display tag metadata is missing\n");
if (names["service-mixed-in-1"] != "service-mixed-in")
    die("system-tag collision suffix leaked into display metadata\n");
if ((backup_metadata.names || {})["json-hop-1"] != "json-hop")
    die("cross-section JSON tag allocation or display metadata is invalid\n");
if (manifest.version != 1 || manifest.providerTags != null ||
    proxy_metadata.providerTags != null || proxy_metadata.urltestGroups != null ||
    proxy_metadata.fallbackGroups != null || proxy_metadata.urltestCandidateTags != null)
    die("legacy section cache fields leaked into runtime manifest\n");
' "$runtime_config" "$runtime_config.runtime-manifest.json" || fail "runtime outbound tag allocation"

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

validate_rejects "$WORK_DIR/duplicate-json-tags.json" "duplicate JSON outbound tag 'same'"
validate_rejects "$WORK_DIR/tagless-json.json" "JSON outbound without a non-empty tag"

printf 'outbound tag checks passed\n'
