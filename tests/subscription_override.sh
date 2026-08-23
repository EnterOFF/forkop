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

assert_accepts() {
  local label="$1" fixture="$2" output
  output="$(ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-runtime-fixture "$fixture" '{}' 2>&1 || true)"
  [ -z "$output" ] || fail "$label was rejected: $output"
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
      "override_patch": "{\"packet_encoding\":\"xudp\",\"tls\":{\"insecure\":true},\"multiplex\":{\"enabled\":true,\"protocol\":\"h2mux\"}}"
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
if (type(override.patch) != "object" || override.patch.packet_encoding != "xudp")
    die("additional parameters were not generated");
// The dialog owns four settings now, so everything else a user asks for reaches
// the core through the patch instead of a named override field.
if (type(override.patch.tls) != "object" || override.patch.tls.insecure != true ||
    type(override.patch.multiplex) != "object" || override.patch.multiplex.protocol != "h2mux")
    die("nested additional parameters were not generated");
for (let key in [ "tcp_fast_open", "tcp_multi_path", "udp_fragment", "connect_timeout",
                  "tls", "outbound_detour", "remove_emojis" ])
    if (override[key] != null || provider[key] != null)
        die("removed provider option " + key + " leaked into the config");
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

cat >"$WORK_DIR/formless-rename.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [ { ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" } ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "proxy",
      "url": "https://example.com/subscription", "tag": "sub1",
      "override_rename": [ "^HK-(.*)$" ]
    }
  ]
}
JSON
assert_rejects "rename rule without a replacement" "$WORK_DIR/formless-rename.json" \
  "must be written as 'pattern => replacement'"

# A group reference swallows the letters behind it, so '$1x' asks for a group
# named '1x' and the core replaces the whole name with nothing.
cat >"$WORK_DIR/greedy-group.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [ { ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" } ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "proxy",
      "url": "https://example.com/subscription", "tag": "sub1",
      "override_rename": [ "^HK-(.*)$ => $1mbps" ]
    }
  ]
}
JSON
assert_rejects "group reference followed by a letter" "$WORK_DIR/greedy-group.json" \
  "must write '\${1}' where a letter follows the group number"

# The braced form, a digit-only reference and an escaped dollar sign are all
# unambiguous, so none of them may be refused.
cat >"$WORK_DIR/good-groups.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [ { ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" } ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "proxy",
      "url": "https://example.com/subscription", "tag": "sub1",
      "override_rename": [
        "^HK-(.*)$ => ${1}mbps",
        "^US-(.*)$ => $12",
        "^JP-(.*)$ => $$1x",
        "^SG-(.*)$ => $1-fast",
        "^DE-(.*)$ => "
      ]
    }
  ]
}
JSON
assert_accepts "unambiguous rename replacements" "$WORK_DIR/good-groups.json"

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

cat >"$WORK_DIR/array-patch.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [ { ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" } ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "proxy",
      "url": "https://example.com/subscription", "tag": "sub1",
      "override_patch": "[1,2]"
    }
  ]
}
JSON
assert_rejects "patch that is not an object" "$WORK_DIR/array-patch.json" "must be a JSON object"

# The section fills the detour of every server it imports from its cascade
# connection, so the patch is refused instead of quietly winning against it.
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

# Everything the dialog no longer asks for stays reachable through the patch,
# including the fields that used to have a control of their own.
cat >"$WORK_DIR/allowed-patch.json" <<'JSON'
{
  "settings": { ".name": "settings", ".type": "settings", "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ], "service_listen_address": "127.0.0.1" },
  "section": [ { ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection" } ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "proxy",
      "url": "https://example.com/subscription", "tag": "sub1",
      "override_patch": "{\"tcp_fast_open\":true,\"connect_timeout\":\"5s\",\"tls\":{\"insecure\":true,\"server_name\":\"example.org\",\"alpn\":[\"h2\"]},\"multiplex\":{\"enabled\":true,\"protocol\":\"h2mux\",\"max_streams\":8}}"
    }
  ]
}
JSON
assert_accepts "patch reaching a field with no control of its own" "$WORK_DIR/allowed-patch.json"

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

# The dialog stores exactly the four settings it shows, so a control removed
# from it cannot leave a write behind that nothing reads any more.
node - "$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js" <<'NODE'
const fs = require('fs');
const source = fs.readFileSync(process.argv[2], 'utf8');
const start = source.indexOf('function subscriptionOverrideKeys()');
if (start < 0) throw new Error('subscriptionOverrideKeys is missing');
const body = source.slice(start, source.indexOf('\n}', start));
const keys = [...body.matchAll(/"(override_[a-z_]+)"/g)].map((match) => match[1]);
const expected = [
  'override_prefix',
  'override_suffix',
  'override_rename',
  'override_patch',
];
if (JSON.stringify(keys) !== JSON.stringify(expected)) {
  console.error(`stored override settings drifted: ${keys} vs ${expected}`);
  process.exit(1);
}
const stray = [...source.matchAll(/"(override_[a-z_]+)"/g)]
  .map((match) => match[1])
  .filter((key) => !expected.includes(key));
if (stray.length) {
  console.error(`the dialog still references removed settings: ${[...new Set(stray)]}`);
  process.exit(1);
}
NODE

printf 'subscription override checks passed\n'
