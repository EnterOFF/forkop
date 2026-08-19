#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
GENERATOR="$FORKOP_LIB/singbox/generator.uc"
VALIDATOR="$FORKOP_LIB/config/validator.uc"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_rejects() {
  local label="$1" fixture="$2" expected="$3" output
  output="$(ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-runtime-fixture "$fixture" '{}' 2>&1 || true)"
  case "$output" in
    *"$expected"*) ;;
    "") fail "$label was accepted" ;;
    *) fail "$label reported '$output'" ;;
  esac
}

cat >"$WORK_DIR/fixture.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ],
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "hop", ".type": "section", "enabled": "1", "action": "connection",
      "selector_proxy_links": [ "socks5://127.0.0.1:1080#Hop" ]
    },
    {
      ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection",
      "outbound_detour_enabled": "1",
      "outbound_detour_section": "hop"
    }
  ],
  "subscription_url": [
    {
      ".name": "source",
      ".type": "subscription_url",
      "section": "proxy",
      "url": "https://example.com/subscription",
      "tag": "sub1",
      "override_prefix": "[Premium] ",
      "override_suffix": " *",
      "override_rename": [
        "^HK-(.*)$ => Hong Kong $1",
        "-([0-9]+)$ => #$1"
      ],
      "override_tcp_fast_open": "1",
      "override_tcp_multi_path": "0",
      "override_udp_fragment": "",
      "override_connect_timeout": "5s",
      "override_tls_insecure": "1",
      "override_tls_server_name": "example.org",
      "override_multiplex": "1",
      "override_multiplex_protocol": "h2mux",
      "override_multiplex_max_streams": "8",
      "override_patch": "{\"packet_encoding\":\"xudp\"}"
    }
  ]
}
JSON

validation="$(ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-runtime-fixture "$WORK_DIR/fixture.json" '{}' 2>&1 || true)"
[ -z "$validation" ] || fail "valid override was rejected: $validation"
ucode -L "$FORKOP_LIB" "$GENERATOR" generate-config-fixture \
  "$WORK_DIR/fixture.json" "$WORK_DIR/config.json" 127.0.0.1 0

ucode -e '
let fs = require("fs");
let config = json(fs.readfile(ARGV[0]));
let provider = null;
for (let item in config.providers || [])
    if (item.tag == "proxy/sub1")
        provider = item;
if (!provider)
    die("subscription provider was not generated");

let override = provider.override;
if (type(override) != "object")
    die("subscription override was not generated");
if (override.prefix != "[Premium] " || override.suffix != " *")
    die("name prefix or suffix was not generated");
if (length(override.rename || []) != 2 || override.rename[0].pattern != "^HK-(.*)$" ||
    override.rename[0].target != "Hong Kong $1" || override.rename[1].target != "#$1")
    die("rename rules were not generated");
if (override.detour != "hop")
    die("section cascade did not reach the override detour");
if (override.tcp_fast_open != true || override.tcp_multi_path != false)
    die("connection flags were not generated");
if (override.udp_fragment != null)
    die("an unchanged flag must stay out of the config");
if (override.connect_timeout != "5s")
    die("connection timeout was not generated");
if (type(override.tls) != "object" || override.tls.insecure != true ||
    override.tls.server_name != "example.org")
    die("TLS override was not generated");
if (type(override.patch) != "object" || type(override.patch.multiplex) != "object" ||
    override.patch.multiplex.enabled != true || override.patch.multiplex.protocol != "h2mux" ||
    override.patch.multiplex.max_streams != 8)
    die("multiplex override did not reach the patch");
if (override.patch.packet_encoding != "xudp")
    die("additional parameters were not merged into the patch");
if (provider.outbound_detour != null || provider.remove_emojis != null)
    die("removed provider options leaked into the config");
' "$WORK_DIR/config.json" || fail "subscription override generation"

cat >"$WORK_DIR/bad-rename.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [ { ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" } ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "proxy",
      "url": "https://example.com/subscription", "tag": "sub1",
      "override_rename": [ "([ => x" ]
    }
  ]
}
JSON
assert_rejects "invalid rename pattern" "$WORK_DIR/bad-rename.json" "Invalid rename pattern"

cat >"$WORK_DIR/bad-patch.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [ { ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" } ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "proxy",
      "url": "https://example.com/subscription", "tag": "sub1",
      "override_patch": "{\"tag\":\"renamed\"}"
    }
  ]
}
JSON
assert_rejects "patch overriding the tag" "$WORK_DIR/bad-patch.json" "must not set 'tag'"

cat >"$WORK_DIR/broken-patch.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [ { ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" } ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "proxy",
      "url": "https://example.com/subscription", "tag": "sub1",
      "override_patch": "not json"
    }
  ]
}
JSON
assert_rejects "invalid patch JSON" "$WORK_DIR/broken-patch.json" "not valid JSON"

# A parameter with its own control is refused instead of resolved by
# precedence, so the free-form patch never fights a setting silently.
cat >"$WORK_DIR/reserved-detour.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [ { ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" } ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "proxy",
      "url": "https://example.com/subscription", "tag": "sub1",
      "override_patch": "{\"detour\":\"hop\"}"
    }
  ]
}
JSON
assert_rejects "patch setting the cascade detour" "$WORK_DIR/reserved-detour.json" "must not set 'detour'"

cat >"$WORK_DIR/reserved-nested.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [ { ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" } ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "proxy",
      "url": "https://example.com/subscription", "tag": "sub1",
      "override_patch": "{\"tls\":{\"insecure\":true,\"alpn\":[\"h2\"]}}"
    }
  ]
}
JSON
assert_rejects "patch setting a controlled TLS field" "$WORK_DIR/reserved-nested.json" "must not set 'tls.insecure'"

# A neighbouring field of the same object has no control of its own and stays
# reachable through the patch.
cat >"$WORK_DIR/allowed-nested.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [ { ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" } ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "proxy",
      "url": "https://example.com/subscription", "tag": "sub1",
      "override_patch": "{\"tls\":{\"alpn\":[\"h2\"]},\"multiplex\":{\"padding\":true}}"
    }
  ]
}
JSON
allowed="$(ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-runtime-fixture "$WORK_DIR/allowed-nested.json" '{}' 2>&1 || true)"
[ -z "$allowed" ] || fail "an uncontrolled patch field was rejected: $allowed"

# Every other override field is validated, so a hand-edited protocol must be too.
cat >"$WORK_DIR/bad-multiplex.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [ { ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" } ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "proxy",
      "url": "https://example.com/subscription", "tag": "sub1",
      "override_multiplex": "1", "override_multiplex_protocol": "mux"
    }
  ]
}
JSON
assert_rejects "unsupported multiplexing protocol" "$WORK_DIR/bad-multiplex.json" "Invalid multiplexing protocol 'mux'"

# The LuCI editor repeats the reserved list, so drift would let the dialog
# accept what the backend refuses.
node - "$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js" \
  "$(ucode -L "$FORKOP_LIB" -e 'let c = require("singbox.constants"); print(join(" ", c.RESERVED_OVERRIDE_PATCH_PATHS));')" <<'NODE'
const fs = require('fs');
const source = fs.readFileSync(process.argv[2], 'utf8');
const start = source.indexOf('function reservedOverridePatchPaths()');
if (start < 0) throw new Error('reservedOverridePatchPaths is missing');
const body = source.slice(start, source.indexOf('\n}', start));
const paths = [...body.matchAll(/"([a-z_.]+)"/g)].map((match) => match[1]);
const expected = process.argv[3].split(' ');
if (JSON.stringify(paths) !== JSON.stringify(expected)) {
  console.error(`reserved patch paths drifted: ${paths} vs ${expected}`);
  process.exit(1);
}
NODE

printf 'subscription override checks passed\n'
