#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
GENERATOR="$FORKOP_LIB/singbox/generator.uc"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

cat >"$WORK_DIR/fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "dns_server": "1.1.1.1",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "hop",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "selector_proxy_links": [ "socks5://127.0.0.1:1080#Hop" ]
    },
    {
      ".name": "source",
      ".type": "section",
      "enabled": "1",
      "action": "connection",
      "selector_proxy_links": [ "socks5://127.0.0.1:1081#Manual" ],
      "interfaces": [ "wg0" ],
      "outbound_jsons": [
        "{\"type\":\"socks\",\"tag\":\"JSON plain\",\"server\":\"127.0.0.1\",\"server_port\":1082,\"version\":\"5\"}",
        "{\"type\":\"socks\",\"tag\":\"JSON explicit\",\"server\":\"127.0.0.1\",\"server_port\":1083,\"version\":\"5\",\"detour\":\"direct-out\"}"
      ],
      "outbound_detour_enabled": "1",
      "outbound_detour_section": "hop"
    }
  ],
  "subscription_url": [
    {
      ".name": "source_subscription",
      ".type": "subscription_url",
      "section": "source",
      "url": "https://subscription.example/source"
    }
  ]
}
JSON

ucode -L "$FORKOP_LIB" "$GENERATOR" generate-config-fixture \
    "$WORK_DIR/fixture.json" "$WORK_DIR/output.json" "127.0.0.1"

ucode -e '
let fs = require("fs");
let config = json(fs.readfile(ARGV[0]));

function outbound(tag) {
    for (let item in config.outbounds || [])
        if (item && item.tag == tag)
            return item;
    return null;
}

function provider(tag) {
    for (let item in config.providers || [])
        if (item && item.tag == tag)
            return item;
    return null;
}

function assert(condition, message) {
    if (!condition)
        die(message + "\n");
}

assert(outbound("source/Manual").type == "parser", "manual URI was not generated as a parser outbound");
assert(outbound("source/Manual").detour == "hop", "manual parser did not receive the section detour");
assert(provider("source/sub1").outbound_detour == "hop", "subscription provider did not receive the section detour");
assert(outbound("source/wg0").bind_interface == "wg0", "interface binding was not preserved");
assert(outbound("source/wg0").detour == null, "network interface must be excluded from section cascade");
assert(outbound("source/JSON plain").detour == null, "plain JSON outbound must be excluded from section cascade");
assert(outbound("source/JSON explicit").detour == "direct-out", "explicit JSON detour was not preserved");
assert(outbound("source").detour == null, "section selector must not receive its own detour");
' "$WORK_DIR/output.json" || fail "section cascade generation"

printf 'connection cascade checks passed\n'
