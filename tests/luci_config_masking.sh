#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATUS_UC="$ROOT_DIR/forkop/files/usr/lib/diagnostics/status.uc"
MASK_TS="$ROOT_DIR/fe-app-forkop/src/forkop/tabs/diagnostic/helpers/maskDiagnostics.ts"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

# The Forkop config masker exists twice: diagnostics/status.uc masks the copy
# embedded in global_check, and maskDiagnostics.ts masks the copy the LuCI app
# fetches for its "show values" toggle. They must cover the same options.
STATUS_UC="$STATUS_UC" MASK_TS="$MASK_TS" node - <<'NODE'
const fs = require("fs");

const uc = fs.readFileSync(process.env.STATUS_UC, "utf8");
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

const ucBody = /function forkop_config_masked_line\(line\) \{(.*?)\n\}/s.exec(uc);
if (!ucBody) fail("forkop_config_masked_line is absent from status.uc");

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

// status.uc masks the WAN interface options in wan_config_masked(), while the
// LuCI masker sees the whole global_check text in one pass and covers them
// inline. status.uc drops the tailscale toggles that the LuCI masker masks.
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
  fail(`status.uc does not mask: ${missingInRuntime.join(", ")}`);
}

// Every credential a tunnel can carry has to be covered by both maskers.
const requiredTunnelTokens = [
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
];
const uncovered = requiredTunnelTokens.filter(
  (token) => !ucSpace.includes(token) || !tsSpace.includes(token),
);
if (uncovered.length) {
  fail(`tunnel options are not masked everywhere: ${uncovered.join(", ")}`);
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
EOF

masked="$(ucode -L "$FORKOP_LIB" "$STATUS_UC" forkop-config-masked "$WORK_DIR/forkop")"

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
  'leaked'
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

printf 'config masking checks passed\n'
