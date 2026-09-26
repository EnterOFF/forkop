#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
MASK_UC="$ROOT_DIR/forkop/files/usr/lib/diagnostics/mask.uc"
MASK_TS="$ROOT_DIR/fe-app-forkop/src/forkop/tabs/diagnostic/helpers/maskDiagnostics.ts"

# The Forkop config masker exists twice: diagnostics/mask.uc masks the copy
# embedded in global_check, and maskDiagnostics.ts masks the copy the LuCI app
# fetches for its "show values" toggle. They must cover the same options.
MASK_UC="$MASK_UC" MASK_TS="$MASK_TS" node - <<'NODE'
const fs = require("fs");

const uc = fs.readFileSync(process.env.MASK_UC, "utf8");
const ts = fs.readFileSync(process.env.MASK_TS, "utf8");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function tsArray(name) {
  const matched = new RegExp(`const ${name} = \\[(.*?)\\];`, "s").exec(ts);
  if (!matched) fail(`${name} is absent from maskDiagnostics.ts`);
  return [...matched[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

const ucBody = /function forkop_config_line\(line\) \{(.*?)\n\}/s.exec(uc);
if (!ucBody) fail("forkop_config_line is absent from mask.uc");

function ucTokens(fn, body) {
  return [
    ...body.matchAll(new RegExp(`${fn}\\(line, "([^"]+)"\\)`, "g")),
  ].map((item) => item[1]);
}

const ucPlain = ucTokens("mask_after_token", ucBody[1]).filter(
  (token) => !ucTokens("mask_after_token_space", ucBody[1]).includes(token),
);
const ucSpace = ucTokens("mask_after_token_space", ucBody[1]);
const ucDeleted = [
  ...uc.matchAll(/delete_token_space\(line, "([^"]+)"\)/g),
].map((item) => item[1]);

// mask.uc masks the WAN interface options in wan_config(), while the LuCI
// masker sees the whole global_check text in one pass and covers them inline.
// mask.uc drops the tailscale toggles that the LuCI masker masks.
const luciOnly = new Set([
  ...ucDeleted,
  "option ipaddr",
  "option netmask",
  "option gateway",
  "option username",
  "option password",
]);

const tsPlain = tsArray("FORKOP_MASK_AFTER_TOKEN");
const tsSpace = tsArray("FORKOP_MASK_AFTER_TOKEN_SPACE");

const missingInLuci = [
  ...ucPlain.filter((token) => !tsPlain.includes(token)),
  ...ucSpace.filter((token) => !tsSpace.includes(token)),
];
if (missingInLuci.length) {
  fail(`maskDiagnostics.ts does not mask: ${missingInLuci.join(", ")}`);
}

const missingInRuntime = [
  ...tsPlain.filter((token) => !ucPlain.includes(token) && !luciOnly.has(token)),
  ...tsSpace.filter((token) => !ucSpace.includes(token) && !luciOnly.has(token)),
];
if (missingInRuntime.length) {
  fail(`mask.uc does not mask: ${missingInRuntime.join(", ")}`);
}

// Every credential a tunnel or a JSON inbound can carry has to be covered by
// both maskers.
const requiredTokens = [
  "option private_key",
  "option public_key",
  "option pre_shared_key",
  "option address",
  "list address",
  "option port",
  "list allowed_ips",
  "option endpoint_json",
  "option warp_profile_id",
  "option warp_profile_auth_token",
  "option warp_profile_private_key",
  "option warp_profile_license_key",
  "option inbound_json",
];
const uncovered = requiredTokens.filter(
  (token) => !ucSpace.includes(token) || !tsSpace.includes(token),
);
if (uncovered.length) {
  fail(`credential options are not masked everywhere: ${uncovered.join(", ")}`);
}

for (const key of [
  "private_key",
  "public_key",
  "pre_shared_key",
  "address",
  "port",
  "allowed_ips",
  "auth_token",
  "license_key",
  "id",
  "link",
]) {
  if (!new RegExp(`^\\s*'${key}',$`, "m").test(ts)) {
    fail(`sing-box masker does not mask the ${key} key`);
  }
}
NODE

cat >"$WORK_DIR/forkop" <<'EOF'
config tunnel 'tun_warp'
	option kind 'warp'
	option name 'warp'
	option warp_profile_id 'e9f13cd5-37ec-442f-b288-5833ad86b9e5'
	option warp_profile_auth_token 'e2279ee0-8668-44e7-8bb6-3e1299736ece'
	option warp_profile_private_key 'MB4Pym1juYXjCVpks1803AwJfLL9Ppfzip9hO+ao4UA='
	option warp_profile_license_key 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
	option amnezia_jc '4'

config tunnel 'tun_awg'
	option kind 'amneziawg'
	list address '10.8.1.9/32'
	option private_key 'zz5/p+jwYqPFlg9mWcOP5ad8xXa4XfOOlrzouVD6E1w='
	option listen_port '51820'
	option mtu '1280'

config tunnel_peer 'tp_awg'
	option tunnel 'tun_awg'
	option address 'peer.example.com'
	option port '47132'
	option public_key 'AKR8dq2b9o7/cO8d5mAzxvuxRhhw4DXi1pfUC3IPGWo='
	option pre_shared_key 'aHTnu1QJ36K47dAVMKz+P1RDvmTGhJiS+FK8IfPzL0M='
	list allowed_ips '0.0.0.0/0'
	option persistent_keepalive_interval '25'

config tunnel 'tun_json'
	option kind 'json'
	option endpoint_json '{
	"type": "wireguard",
	"private_key": "leaked"
}'

config server 'srv_cloudflared'
	option protocol 'json_inbound'
	option inbound_json '{"type":"cloudflared","token":"cloudflared-tunnel-token"}'

config server 'srv_json'
	option protocol 'json_inbound'
	option inbound_json '{
	"type": "shadowsocks",
	"password": "inbound-leaked"
}'
	option routing_mode 'direct'
EOF

masked="$(ucode -L "$FORKOP_LIB" -e "print(require('diagnostics.mask').forkop_config(
  require('fs').readfile('$WORK_DIR/forkop')));")"

for secret in \
  'e9f13cd5-37ec-442f-b288-5833ad86b9e5' \
  'e2279ee0-8668-44e7-8bb6-3e1299736ece' \
  'MB4Pym1juYXjCVpks1803AwJfLL9Ppfzip9hO+ao4UA=' \
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' \
  '10.8.1.9/32' \
  'zz5/p+jwYqPFlg9mWcOP5ad8xXa4XfOOlrzouVD6E1w=' \
  'peer.example.com' \
  '47132' \
  'AKR8dq2b9o7/cO8d5mAzxvuxRhhw4DXi1pfUC3IPGWo=' \
  'aHTnu1QJ36K47dAVMKz+P1RDvmTGhJiS+FK8IfPzL0M=' \
  '0.0.0.0/0' \
  'leaked' \
  'cloudflared-tunnel-token' \
  'inbound-leaked'
do
  if printf '%s\n' "$masked" | grep -Fq "$secret"; then
    fail "masked Forkop config still exposes $secret"
  fi
done

printf '%s\n' "$masked" | grep -Fq "option kind 'warp'" ||
  fail "masked Forkop config must keep non-sensitive tunnel fields readable"
printf '%s\n' "$masked" | grep -Fq "option amnezia_jc '4'" ||
  fail "masked Forkop config must keep obfuscation parameters readable"
printf '%s\n' "$masked" | grep -Fq "option mtu '1280'" ||
  fail "masked Forkop config must keep the tunnel MTU readable"
printf '%s\n' "$masked" | grep -Fq "option routing_mode 'direct'" ||
  fail "masked Forkop config must resume after a multi-line JSON inbound"

# Anything the editor renders as a password ends up in show_config, which users
# paste into the support chat, so every one of them has to be masked there.
# The WARP fields are named differently in the tunnel dialog than in UCI, so the
# name they are stored under is what must be covered.
node - "$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop" "$MASK_UC" \
  "$ROOT_DIR/fe-app-forkop/src/forkop/tabs" <<'NODE'
const fs = require('fs');
const path = require('path');

const viewDir = process.argv[2];
const maskSource = fs.readFileSync(process.argv[3], 'utf8');
// The tabs live in the bundle, so their own sources are read: main.js is
// generated, and the dialogs that carry a password field are all in there now.
function tabModules(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) tabModules(full, found);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      found.push(fs.readFileSync(full, 'utf8'));
    }
  }
  return found;
}
const tabSources = tabModules(process.argv[4]);
const block = maskSource.slice(
  maskSource.indexOf('function forkop_config_line'),
  maskSource.indexOf('\n    return line;'),
);
const masked = new Set(
  [...block.matchAll(/"(?:option|list) ([a-z0-9_]+)/g)].map((m) => m[1]),
);

// dialog field -> the UCI option it is stored as
const storedAs = {
  warp_auth_token: 'warp_profile_auth_token',
  warp_private_key: 'warp_profile_private_key',
  warp_license_key: 'warp_profile_license_key',
};

const optionPattern =
  /\.option\(\s*(?:form|widgets)\.[A-Za-z]+\s*,\s*\n?\s*["']([a-z0-9_]+)["']/g;

const unmasked = [];
let found = 0;

const sources = [
  ...fs
    .readdirSync(viewDir)
    .filter((n) => n.endsWith('.js') && n !== 'main.js')
    .map((n) => fs.readFileSync(path.join(viewDir, n), 'utf8')),
  ...tabSources,
];

for (const source of sources) {
  for (const match of source.matchAll(/\.password\s*=\s*true/g)) {
    const names = [...source.slice(0, match.index).matchAll(optionPattern)].map((m) => m[1]);
    if (!names.length) continue;
    const field = names[names.length - 1];
    found += 1;
    const stored = storedAs[field] || field;
    if (!masked.has(stored)) unmasked.push(`${field} (stored as ${stored})`);
  }
}

if (!found) {
  console.error('FAIL: no password fields found, the scan is broken');
  process.exit(1);
}
if (unmasked.length) {
  console.error(`FAIL: show_config would expose: ${unmasked.join(', ')}`);
  process.exit(1);
}
NODE

printf 'config masking checks passed\n'

ucode -L "$FORKOP_LIB" -e '
let mask = require("diagnostics.mask");
for (let key in [ "psk", "userkey", "static_key", "key", "client_key", "certificate", "client_certificate", "peer_fingerprint", "cookie", "token", "auth_token", "license_key" ]) {
    let value = { endpoints: [{ tls: { [key]: [ "sensitive" ] } }] };
    if (mask.sing_box_config(value).endpoints[0].tls[key] != "MASKED") die("unmasked native credential: " + key);
    if (value.endpoints[0].tls[key][0] != "sensitive") die("mask mutated input");
}'
