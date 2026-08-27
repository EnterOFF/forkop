#!/usr/bin/env bash
# A reload only regenerates sing-box when the signature changes, so any setting
# that reaches the generated config has to be part of that signature. Missing
# one makes Save & Apply look successful while the runtime keeps the old config.
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
STATE_UC="$FORKOP_LIB/service/state.uc"
GENERATOR_UC="$FORKOP_LIB/singbox/generator.uc"

write_fixture() {
  local path="$1" extra="$2"
  cat >"$path" <<JSON
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": [ "1.1.1.1" ], "bootstrap_dns_server": [ "1.1.1.1" ],
    "service_listen_address": "127.0.0.1"$extra
  },
  "section": [
    {
      ".name": "proxy", ".type": "section", "enabled": "1", "action": "connection",
      "selector_proxy_links": [ "socks5://127.0.0.1:1080#Node" ],
      "rule_set": [ "https://example.com/list.srs" ]
    }
  ]
}
JSON
}

signature() {
  ucode -L "$FORKOP_LIB" "$STATE_UC" sing-box-signature-fixture "$1"
}

generate() {
  ucode -L "$FORKOP_LIB" "$GENERATOR_UC" generate-config-fixture "$1" "$2" 127.0.0.1 0
}

write_fixture "$WORK_DIR/base.json" ""
generate "$WORK_DIR/base.json" "$WORK_DIR/base-config.json"
base_signature="$(signature "$WORK_DIR/base.json")"

covered=0
for change in \
  '"dns_strategy": "prefer_ipv6"' \
  '"dns_rewrite_ttl": "120"' \
  '"disable_quic": "1"' \
  '"bittorrent_direct": "1"' \
  '"unified_delay": "1"' \
  '"static_hosts_text": "10.0.0.9 pinned.example"' \
  '"log_level": "debug"' \
  '"cache_path": "/tmp/other-cache.db"' \
  '"output_network_interface": "wan2"' \
  '"enable_yacd": "1"' \
  '"list_update_enabled": "0"' \
  '"update_interval": "6h"' \
  '"download_lists_via_proxy": "1", "download_lists_via_proxy_section": "proxy"' \
  '"dns_main_fallback_strategy": "sequential"'
do
  setting="${change%%\:*}"
  write_fixture "$WORK_DIR/changed.json" ", $change"
  generate "$WORK_DIR/changed.json" "$WORK_DIR/changed-config.json"

  # A setting that does not reach the config for this fixture proves nothing.
  if cmp -s "$WORK_DIR/base-config.json" "$WORK_DIR/changed-config.json"; then
    continue
  fi

  covered=$((covered + 1))
  [ "$(signature "$WORK_DIR/changed.json")" != "$base_signature" ] ||
    fail "$setting changes the generated config but not the sing-box signature, so a reload would skip it"
done

[ "$covered" -ge 10 ] ||
  fail "expected the fixture to exercise at least 10 settings, exercised $covered"

# The server half of the signature is a list of option names, so it is compared with
# the option names the server side of the generator actually reads. A field the
# generator reads and the signature omits keeps a changed server on the old config; a
# field the signature carries and nothing reads reloads sing-box for nothing.
node - "$STATE_UC" "$FORKOP_LIB/singbox/servers.uc" "$GENERATOR_UC" <<'NODE'
const fs = require("fs");
const stateSource = fs.readFileSync(process.argv[2], "utf8");
const serversSource = fs.readFileSync(process.argv[3], "utf8");
const generatorSource = fs.readFileSync(process.argv[4], "utf8");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function block(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  if (start < 0 || end < 0) fail(`cannot find ${from}`);
  return source.slice(start, end);
}

// The field list of append_sing_box_server_signature_body, plus the ones it adds by
// hand outside the table.
const signatureBlock = block(
  stateSource,
  "function append_sing_box_server_signature_body",
  "function sing_box_signature_body",
);
const signed = new Set([
  ...[...signatureBlock.matchAll(/\[ "([a-z0-9_]+)", /g)].map((m) => m[1]),
  ...[...signatureBlock.matchAll(/prefix \+ "\.([a-z0-9_]+)"/g)].map((m) => m[1]),
  ...[...signatureBlock.matchAll(/for \(let field in \[ ([^\]]+)\]/gs)]
    .flatMap((m) => [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((n) => n[1])),
  ...[...signatureBlock.matchAll(/list_option\(client, "([a-z0-9_]+)"\)/g)].map((m) => m[1]),
]);

// Everything the generator reads off a server section or one of its clients. In
// servers.uc the server section is always named section; in generator.uc the server
// functions name it server.
const readers = /(?:option|list_option|bool_option|int_option)\((section|server|client), "([a-z0-9_]+)"/g;
const read = new Set([
  ...[...serversSource.matchAll(readers)].map((m) => m[2]),
  ...[...block(generatorSource, "function has_direct_tailscale_server", "function generate_config").matchAll(readers)].map((m) => m[2]),
]);

// Two the generator reads through a named helper rather than an option() call: the
// display name is the inbound tag, and the switch decides whether the server is
// generated at all.
read.add("label");
read.add("enabled");

const missing = [...read].filter((name) => !signed.has(name)).sort();
const extra = [...signed].filter((name) => !read.has(name)).sort();
if (missing.length) {
  fail(`the generator reads server options the reload signature omits: ${missing.join(", ")}`);
}
if (extra.length) {
  fail(`the reload signature carries server options nothing reads: ${extra.join(", ")}`);
}
NODE

printf 'sing-box reload signature checks passed (%d settings)\n' "$covered"
