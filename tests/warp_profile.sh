#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_BIN="$ROOT_DIR/forkop/files/usr/bin/forkop"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
VALIDATOR="$FORKOP_LIB/config/validator.uc"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

cat >"$WORK_DIR/sing-box" <<'SH'
#!/bin/sh
[ "$*" = "generate warp-profile --json" ] || exit 2
printf '%s\n' '{"id":"profile-id","auth_token":"auth-token","private_key":"private-key"}'
SH
chmod +x "$WORK_DIR/sing-box"

profile="$(
  FORKOP_LIB="$FORKOP_LIB" FORKOP_SING_BOX_BIN="$WORK_DIR/sing-box" \
    ucode "$FORKOP_BIN" generate_warp_profile
)"
node -e '
const profile = JSON.parse(process.argv[1]);
if (
  JSON.stringify(Object.keys(profile).sort()) !==
    JSON.stringify(["auth_token", "id", "private_key"]) ||
  profile.id !== "profile-id" ||
  profile.auth_token !== "auth-token" ||
  profile.private_key !== "private-key"
) process.exit(1);
' "$profile" ||
  fail "WARP profile wrapper changed the validated core response"

cat >"$WORK_DIR/sing-box" <<'SH'
#!/bin/sh
printf '%s\n' '{"id":"secret-leak"}'
printf '%s\n' 'secret-stderr' >&2
SH
mkdir -p "$WORK_DIR/failure-bin"
cat >"$WORK_DIR/failure-bin/logger" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >>"$LOGGER_LOG"
SH
chmod +x "$WORK_DIR/sing-box" "$WORK_DIR/failure-bin/logger"
set +e
PATH="$WORK_DIR/failure-bin:$PATH" LOGGER_LOG="$WORK_DIR/logger.log" \
  FORKOP_LIB="$FORKOP_LIB" FORKOP_SING_BOX_BIN="$WORK_DIR/sing-box" \
  ucode "$FORKOP_BIN" generate_warp_profile \
  >"$WORK_DIR/invalid.out" 2>"$WORK_DIR/invalid.err"
status="$?"
set -e
[ "$status" -ne 0 ] || fail "incomplete core WARP profile was accepted"
[ ! -s "$WORK_DIR/invalid.out" ] || fail "invalid WARP profile leaked to stdout"
grep -Fxq "Failed to generate WARP profile." "$WORK_DIR/invalid.err" ||
  fail "WARP profile failure message changed"
grep -Fq -- '-t forkop [error] Failed to generate WARP profile.' "$WORK_DIR/logger.log" ||
  fail "WARP profile failure was not logged by Forkop"
if grep -Fq "secret-" "$WORK_DIR/invalid.err"; then
  fail "WARP profile failure leaked core output"
fi

cat >"$WORK_DIR/valid.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": ["1.1.1.1"], "bootstrap_dns_server": ["1.1.1.1"]
  },
  "section": [{
    ".name": "tunnels", ".type": "section", "enabled": "1", "action": "connection"
  }],
  "tunnel": [
    {
      ".name": "tun_warp", ".type": "tunnel", "section": "tunnels", "order": "0",
      "kind": "warp", "name": "Generated WARP", "warp_profile_id": "profile-id",
      "warp_profile_auth_token": "auth-token", "warp_profile_private_key": "private-key",
      "warp_profile_license_key": "license-key",
      "amnezia_jc": "7", "amnezia_h1": "100-200"
    },
    {
      ".name": "tun_amnezia", ".type": "tunnel", "section": "tunnels", "order": "1",
      "kind": "amneziawg", "name": "Imported AmneziaWG", "address": ["10.0.0.2/32"],
      "private_key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "amnezia_jc": "5",
      "amnezia_h1": "100-200"
    },
    {
      ".name": "tun_tailnet", ".type": "tunnel", "section": "tunnels", "order": "2",
      "kind": "tailscale", "name": "Tailnet", "tailscale_auth_key": "tskey-auth-test",
      "tailscale_hostname": "forkop-router", "tailscale_exit_node": "100.64.0.1"
    },
    {
      ".name": "tun_json", ".type": "tunnel", "section": "tunnels", "order": "3",
      "kind": "json", "endpoint_json": "{\"type\":\"vpn-client\",\"tag\":\"custom-endpoint\"}"
    }
  ],
  "tunnel_peer": [{
    ".name": "peer_amnezia", ".type": "tunnel_peer", "tunnel": "tun_amnezia",
    "address": "vpn.example.com", "port": "51820",
    "public_key": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
    "allowed_ips": ["0.0.0.0/0"]
  }]
}
JSON
ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-runtime-fixture "$WORK_DIR/valid.json" '{}'

node - "$WORK_DIR/valid.json" "$WORK_DIR/missing-allowed-ips.json" "$WORK_DIR/bad-key.json" "$WORK_DIR/bad-amnezia-range.json" "$WORK_DIR/overflow-amnezia-range.json" "$WORK_DIR/missing-warp-profile.json" "$WORK_DIR/missing-tailscale-auth.json" "$WORK_DIR/missing-json-type.json" "$WORK_DIR/missing-json-tag.json" "$WORK_DIR/incomplete.json" <<'NODE'
const fs = require('fs');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const write = (path, mutate) => {
  const copy = JSON.parse(JSON.stringify(input));
  mutate(copy);
  fs.writeFileSync(path, JSON.stringify(copy));
};
write(process.argv[3], (copy) => delete copy.tunnel_peer[0].allowed_ips);
write(process.argv[4], (copy) => { copy.tunnel_peer[0].public_key = 'invalid'; });
write(process.argv[5], (copy) => { copy.tunnel[1].amnezia_h1 = '200-100'; });
write(process.argv[6], (copy) => { copy.tunnel[1].amnezia_h1 = '4294967296'; });
write(process.argv[7], (copy) => {
  delete copy.tunnel[0].warp_profile_id;
  delete copy.tunnel[0].warp_profile_auth_token;
  delete copy.tunnel[0].warp_profile_private_key;
});
write(process.argv[8], (copy) => delete copy.tunnel[2].tailscale_auth_key);
write(process.argv[9], (copy) => {
  const endpoint = JSON.parse(copy.tunnel[3].endpoint_json);
  delete endpoint.type;
  copy.tunnel[3].endpoint_json = JSON.stringify(endpoint);
});
write(process.argv[10], (copy) => {
  const endpoint = JSON.parse(copy.tunnel[3].endpoint_json);
  delete endpoint.tag;
  copy.tunnel[3].endpoint_json = JSON.stringify(endpoint);
});
write(process.argv[11], (copy) => delete copy.tunnel[0].warp_profile_private_key);
NODE

for invalid in "$WORK_DIR/missing-allowed-ips.json" "$WORK_DIR/bad-key.json" "$WORK_DIR/bad-amnezia-range.json" "$WORK_DIR/overflow-amnezia-range.json" "$WORK_DIR/missing-warp-profile.json" "$WORK_DIR/missing-tailscale-auth.json" "$WORK_DIR/missing-json-type.json" "$WORK_DIR/missing-json-tag.json"; do
  if ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-runtime-fixture "$invalid" '{}' >/dev/null 2>&1; then
    fail "invalid tunnel fixture was accepted: $invalid"
  fi
done

if ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-runtime-fixture \
  "$WORK_DIR/incomplete.json" '{}' >/dev/null 2>&1; then
  fail "incomplete WARP profile passed backend validation"
fi

grep -Fq '[ SING_BOX_BIN, "generate", "warp-profile", "--json" ]' \
  "$FORKOP_LIB/singbox/runtime.uc" ||
  fail "WARP profile wrapper does not call sing-box-forkop directly"
if grep -Fq '/generate/warp-profile' "$FORKOP_LIB/singbox/runtime.uc"; then
  fail "WARP profile wrapper still depends on the Clash API"
fi

printf 'WARP profile checks passed\n'
