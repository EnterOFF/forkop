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

generate_config() {
  local fixture="$1"
  local output="$2"
  mkdir -p "${output}.section-cache"
  ucode -L "$FORKOP_LIB" "$GENERATOR_UC" generate-config-fixture \
    "$fixture" "$output" "127.0.0.1"
}

validate_fixture() {
  local fixture="$1"
  FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$VALIDATOR_UC" \
    validate-runtime-fixture "$fixture" "{}"
}

cat >"$WORK_DIR/fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "dns_server": [ "77.88.8.8" ],
    "bootstrap_dns_server": [ "77.88.8.8" ]
  },
  "section": [
    {
      ".name": "proxy",
      ".type": "section",
      "enabled": "1",
      "action": "proxy",
      "outbound_jsons": [
        "{\"type\":\"vless\",\"tag\":\"Alpha\",\"server\":\"alpha.example\",\"server_port\":443,\"uuid\":\"00000000-0000-4000-8000-000000000001\",\"tls\":{\"enabled\":true}}",
        "{\"type\":\"vless\",\"tag\":\"Beta\",\"server\":\"beta.example\",\"server_port\":443,\"uuid\":\"00000000-0000-4000-8000-000000000002\",\"transport\":{\"type\":\"ws\"},\"tls\":{\"enabled\":true,\"reality\":{\"enabled\":true}}}",
        "{\"type\":\"vmess\",\"tag\":\"Gamma\",\"server\":\"gamma.example\",\"server_port\":443,\"uuid\":\"00000000-0000-4000-8000-000000000003\",\"transport\":{\"type\":\"grpc\"}}",
        "{\"type\":\"trojan\",\"tag\":\"Delta\",\"server\":\"delta.example\",\"server_port\":443,\"password\":\"secret\",\"transport\":{\"type\":\"xhttp\"},\"tls\":{\"enabled\":true}}",
        "{\"type\":\"http\",\"tag\":\"Echo\",\"server\":\"echo.example\",\"server_port\":8080}"
      ]
    }
  ],
  "urltest": [
    {
      ".name": "and_filter",
      ".type": "urltest",
      "section": "proxy",
      "name": "AND filter",
      "filter_mode": "mixed",
      "include_regex": [ "Alpha|Beta|Gamma|Delta" ],
      "include_proxy_parameters": "1",
      "include_protocols": [ "vless", "vmess" ],
      "include_transports": [ "tcp", "ws", "grpc" ],
      "include_securities": [ "tls", "reality", "none" ],
      "exclude_regex": [ "Alpha" ],
      "exclude_proxy_parameters": "1",
      "exclude_securities": [ "reality" ]
    },
    {
      ".name": "parameters_only",
      ".type": "urltest",
      "section": "proxy",
      "name": "Parameters only",
      "filter_mode": "include",
      "include_proxy_parameters": "1",
      "include_protocols": [ "http" ],
      "include_transports": [ "tcp" ],
      "include_securities": [ "none" ]
    }
  ],
  "priority_group": [
    {
      ".name": "pg_parameters",
      ".type": "priority_group",
      "section": "proxy",
      "name": "Parameter priority"
    }
  ],
  "priority_level": [
    {
      ".name": "pl_grpc",
      ".type": "priority_level",
      "group": "pg_parameters",
      "name": "gRPC VMess",
      "order": "0",
      "filter_mode": "include",
      "include_proxy_parameters": "1",
      "include_protocols": [ "vmess" ],
      "include_transports": [ "grpc" ],
      "include_securities": [ "none" ]
    },
    {
      ".name": "pl_mixed",
      ".type": "priority_level",
      "group": "pg_parameters",
      "name": "Mixed VLESS",
      "order": "1",
      "filter_mode": "mixed",
      "regex": [ "Alpha|Beta" ],
      "include_proxy_parameters": "1",
      "include_protocols": [ "vless" ],
      "exclude_regex": [ "Alpha" ],
      "exclude_proxy_parameters": "1",
      "exclude_securities": [ "reality" ]
    },
    {
      ".name": "pl_xhttp",
      ".type": "priority_level",
      "group": "pg_parameters",
      "name": "XHTTP Trojan",
      "order": "2",
      "filter_mode": "include",
      "include_proxy_parameters": "1",
      "include_protocols": [ "trojan" ],
      "include_transports": [ "xhttp" ],
      "include_securities": [ "tls" ]
    },
    {
      ".name": "pl_remaining",
      ".type": "priority_level",
      "group": "pg_parameters",
      "name": "Remaining",
      "order": "3",
      "filter_mode": "disabled"
    }
  ]
}
JSON

validate_fixture "$WORK_DIR/fixture.json" >/dev/null || fail "valid proxy parameter filters"
generate_config "$WORK_DIR/fixture.json" "$WORK_DIR/config.json"

ucode -e '
let fs = require("fs");
function fail(message) { die(message + "\n"); }
function outbound_by_tag(config, tag) {
    for (let outbound in config.outbounds || [])
        if (outbound && outbound.tag == tag)
            return outbound;
    return null;
}
function assert_array(value, expected, label) {
    value = value || [];
    if (length(value) != length(expected))
        fail(label + " length mismatch: " + sprintf("%J", value));
    for (let i = 0; i < length(expected); i++)
        if (value[i] != expected[i])
            fail(label + " mismatch: " + sprintf("%J", value));
}
let config = json(fs.readfile(ARGV[0]));
let cache = json(fs.readfile(ARGV[1]));
assert_array(outbound_by_tag(config, "proxy-urltest-and_filter-out").outbounds, [ "Gamma" ], "URLTest AND/OR filter");
assert_array(outbound_by_tag(config, "proxy-urltest-parameters_only-out").outbounds, [ "Echo" ], "URLTest parameter-only filter");
assert_array(outbound_by_tag(config, "proxy-priority-pg_parameters-out").outbounds,
    [
        "proxy-priority-pg_parameters-level-pl_grpc-out",
        "proxy-priority-pg_parameters-level-pl_xhttp-out",
        "proxy-priority-pg_parameters-level-pl_remaining-out"
    ], "Priority nested fallback levels");
assert_array(outbound_by_tag(config, "proxy-priority-pg_parameters-level-pl_grpc-out").outbounds,
    [ "Gamma" ], "Priority gRPC level filter");
assert_array(outbound_by_tag(config, "proxy-priority-pg_parameters-level-pl_xhttp-out").outbounds,
    [ "Delta" ], "Priority XHTTP level filter");
assert_array(outbound_by_tag(config, "proxy-priority-pg_parameters-level-pl_remaining-out").outbounds,
    [ "Alpha", "Beta", "Echo" ], "Priority remaining level filter");
if (outbound_by_tag(config, "proxy-priority-pg_parameters-level-pl_mixed-out") != null)
    fail("empty Priority level must not be generated");
let priority_levels = ((cache.priorityGroups || {})["proxy-priority-pg_parameters-out"] || {}).levels || [];
let cached_level_tags = [];
for (let level in priority_levels)
    push(cached_level_tags, level.tag);
assert_array(cached_level_tags, [
    "proxy-priority-pg_parameters-level-pl_grpc-out",
    "proxy-priority-pg_parameters-level-pl_xhttp-out",
    "proxy-priority-pg_parameters-level-pl_remaining-out"
], "Priority cached nested levels");

let metadata = cache.outboundMetadata || {};
if (metadata.protocols.Alpha != "vless" || metadata.protocols.Echo != "http")
    fail("protocol metadata was not normalized");
if (metadata.transports.Alpha != "tcp" || metadata.transports.Beta != "ws" || metadata.transports.Delta != "xhttp")
    fail("transport metadata was not normalized");
if (metadata.securities.Alpha != "tls" || metadata.securities.Beta != "reality" || metadata.securities.Gamma != "none")
    fail("security metadata was not normalized");
' "$WORK_DIR/config.json" "$WORK_DIR/config.json.section-cache/proxy.json" ||
  fail "URLTest and Priority proxy parameter filtering"

node - "$WORK_DIR/fixture.json" "$WORK_DIR/invalid.json" "$WORK_DIR/extended.json" <<'JS'
const fs = require('fs');
const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
fixture.urltest[0].include_protocols = ['invalid'];
fs.writeFileSync(process.argv[3], JSON.stringify(fixture));
const extended = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
extended.urltest[1].include_protocols = ['anytls'];
extended.urltest[1].include_transports = ['mkcp'];
fs.writeFileSync(process.argv[4], JSON.stringify(extended));
JS

if validate_fixture "$WORK_DIR/invalid.json" >/dev/null 2>&1; then
  fail "invalid proxy protocol should be rejected"
fi

validate_fixture "$WORK_DIR/extended.json" >/dev/null ||
  fail "Extended protocol and mKCP filters should be accepted"

printf 'proxy parameter filter regression tests passed\n'
