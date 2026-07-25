#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_RUNTIME="$ROOT_DIR/forkop/files/usr/lib/server/service.uc"
UCODE_LIB="$ROOT_DIR/forkop/files/usr/lib"
WORK_DIR="$(mktemp -d)"
STATE="$WORK_DIR/uci.state"
LOG="$WORK_DIR/uci.log"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  printf 'UCI state:\n' >&2
  cat "$STATE" >&2 2>/dev/null || true
  printf 'UCI log:\n' >&2
  cat "$LOG" >&2 2>/dev/null || true
  exit 1
}

mkdir -p "$WORK_DIR/bin"
cat >"$WORK_DIR/bin/sing-box" <<'SINGBOX'
#!/usr/bin/env bash
set -eo pipefail

case "$*" in
  "generate uuid")
    printf '%s\n' '33333333-3333-4333-8333-333333333333'
    ;;
  "generate rand --base64 18")
    printf '%s\n' 'generated-password'
    ;;
  "generate rand --hex 4")
    printf '%s\n' 'abcd1234'
    ;;
  "generate rand --hex 16")
    printf '%s\n' '11111111111111111111111111111111'
    ;;
  "generate reality-keypair")
    printf 'PrivateKey: private-key\nPublicKey: public-key\n'
    ;;
  *)
    printf 'unsupported sing-box command: %s\n' "$*" >&2
    exit 2
    ;;
esac
SINGBOX
chmod 0755 "$WORK_DIR/bin/sing-box"

cat >"$WORK_DIR/bin/logger" <<'LOGGER'
#!/usr/bin/env bash
set -eo pipefail
exit 0
LOGGER
chmod 0755 "$WORK_DIR/bin/logger"

export PATH="$WORK_DIR/bin:$PATH"
export FORKOP_UCI_STATE_FILE="$STATE"
export FORKOP_UCI_LOG_FILE="$LOG"
export FORKOP_CONFIG_NAME="forkop"
export FORKOP_SERVER_RUNTIME_UC="$SERVER_RUNTIME"

if grep -E 'uci -q|command -v uci' "$SERVER_RUNTIME" >/dev/null; then
  fail "server/service.uc must use ucode UCI access instead of shelling out to uci"
fi
if grep -F 'output("ucode "' "$SERVER_RUNTIME" >/dev/null; then
  fail "server defaults must not spawn service.uc without the Forkop module path"
fi
grep -Fq '+dropbearconvert' "$ROOT_DIR/forkop/Makefile" ||
  fail "forkop package must depend on dropbearconvert for persistent SSH host keys"
grep -Fq 'BACKEND_DEPENDS_IPK="' "$ROOT_DIR/build.sh" &&
  grep -Fq 'ip-full, dropbearconvert"' "$ROOT_DIR/build.sh" ||
  fail "standalone IPK packages must depend on dropbearconvert"
grep -Fq 'BACKEND_DEPENDS_APK="' "$ROOT_DIR/build.sh" &&
  grep -Fq 'curl dropbearconvert ip-full' "$ROOT_DIR/build.sh" ||
  fail "standalone APK packages must depend on dropbearconvert"

cat >"$STATE" <<'EOF_STATE'
forkop.vless=server
forkop.vless.protocol=vless
forkop.vless.server_uuid=22222222-2222-4222-8222-222222222222
forkop.vless.vless_flow=xtls-rprx-vision
forkop.socks=server
forkop.socks.protocol=socks
forkop.socks.label=desk
forkop.socks_open=server
forkop.socks_open.protocol=socks
forkop.socks_open.label=guest
forkop.socks_open.socks_auth_enabled=0
forkop.tailscale=server
forkop.tailscale.protocol=tailscale
forkop.json=server
forkop.json.protocol=json_inbound
forkop.mtproto=server
forkop.mtproto.protocol=mtproto
forkop.mtproto.mtproto_secret=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
forkop.naive=server
forkop.naive.protocol=naive
forkop.naive.enabled=0
forkop.ssh=server
forkop.ssh.protocol=ssh
forkop.ssh_disabled=server
forkop.ssh_disabled.protocol=ssh
forkop.ssh_disabled.enabled=0
forkop.mieru=server
forkop.mieru.protocol=mieru
forkop.anytls=server
forkop.anytls.protocol=anytls
forkop.anytls.enabled=0
forkop.tuic=server
forkop.tuic.protocol=tuic
forkop.tuic.enabled=0
EOF_STATE
printf 'forkop.ssh.ssh_host_key_path=%s %s\n' "$WORK_DIR/ssh/host_key" "$WORK_DIR/ssh/host_key_secondary" >>"$STATE"

cat >"$WORK_DIR/bin/dropbearkey" <<'DROPBEARKEY'
#!/usr/bin/env bash
set -eo pipefail

output=
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-f" ]; then
    output="$2"
    shift 2
  else
    shift
  fi
done
[ -n "$output" ]
printf 'dropbear-key\n' >"$output"
printf 'dropbearkey\n' >>"$FORKOP_SSH_KEYGEN_LOG"
DROPBEARKEY
chmod 0755 "$WORK_DIR/bin/dropbearkey"

cat >"$WORK_DIR/bin/dropbearconvert" <<'DROPBEARCONVERT'
#!/usr/bin/env bash
set -eo pipefail

[ "$1" = "dropbear" ]
[ "$2" = "openssh" ]
[ -s "$3" ]
printf '%s\n' \
  '-----BEGIN OPENSSH PRIVATE KEY-----' \
  'test-key' \
  '-----END OPENSSH PRIVATE KEY-----' >"$4"
printf 'dropbearconvert\n' >>"$FORKOP_SSH_KEYGEN_LOG"
DROPBEARCONVERT
chmod 0755 "$WORK_DIR/bin/dropbearconvert"

export FORKOP_SSH_KEYGEN_LOG="$WORK_DIR/ssh-keygen.log"

ucode -L "$UCODE_LIB" "$SERVER_RUNTIME" prepare-all-defaults

uci_get() {
  awk -F= -v key="$1" '$1 == key { print substr($0, length($1) + 2); found = 1 } END { exit found ? 0 : 1 }' "$STATE"
}

assert_value() {
  local path="$1" expected="$2" actual
  actual="$(uci_get "$path" 2>/dev/null || true)"
  [ "$actual" = "$expected" ] || fail "$path: expected '$expected', got '$actual'"
}

assert_value forkop.vless.security reality
assert_value forkop.vless.listen 0.0.0.0
assert_value forkop.vless.listen_port 443
assert_value forkop.vless.server_uuid 22222222-2222-4222-8222-222222222222
assert_value forkop.vless.vless_flow xtls-rprx-vision
short_id="$(uci_get forkop.vless.reality_short_id 2>/dev/null || true)"
[[ "$short_id" =~ ^[0-9a-f]{8}$ ]] || fail "reality short id has invalid format: $short_id"
assert_value forkop.vless.reality_private_key private-key
assert_value forkop.vless.reality_public_key public-key
assert_value forkop.socks.security none
assert_value forkop.socks.socks_auth_enabled 1
assert_value forkop.socks.server_username desk
for password_path in \
  forkop.socks.server_password \
  forkop.socks_open.server_password \
  forkop.naive.server_password \
  forkop.ssh.server_password \
  forkop.mieru.server_password \
  forkop.anytls.server_password \
  forkop.tuic.server_password; do
  password="$(uci_get "$password_path" 2>/dev/null || true)"
  [ -n "$password" ] || fail "$password_path must be generated"
done
assert_value forkop.socks_open.socks_auth_enabled 0
assert_value forkop.socks_open.server_username guest
assert_value forkop.tailscale.security none
assert_value forkop.tailscale.tailscale_control_url https://controlplane.tailscale.com
assert_value forkop.tailscale.tailscale_hostname forkop-tailscale
[ -z "$(uci_get forkop.tailscale.tailscale_advertise_exit_node 2>/dev/null || true)" ] ||
  fail "Tailscale exit-node advertising must not be stored as a user setting"
assert_value forkop.json.security none
assert_value forkop.mtproto.mtproto_secret aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
assert_value forkop.naive.security tls
assert_value forkop.naive.server_username naive
assert_value forkop.naive.naive_network tcp
assert_value forkop.ssh.security none
assert_value forkop.ssh.server_username ssh
assert_value forkop.ssh.ssh_host_key_path "$WORK_DIR/ssh/host_key $WORK_DIR/ssh/host_key_secondary"
assert_value forkop.ssh_disabled.ssh_host_key_path /etc/forkop/server-ssh/ssh_disabled.key
[ -s "$WORK_DIR/ssh/host_key" ] || fail 'persistent SSH host key was not generated'
[ -s "$WORK_DIR/ssh/host_key_secondary" ] || fail 'secondary persistent SSH host key was not generated'
[ "$(wc -l <"$FORKOP_SSH_KEYGEN_LOG")" -eq 4 ] || fail 'SSH host key generation did not convert every configured key exactly once'
assert_value forkop.mieru.security none
assert_value forkop.mieru.server_username mieru
assert_value forkop.mieru.mieru_transport TCP
assert_value forkop.anytls.security tls
assert_value forkop.tuic.security tls
tuic_uuid="$(uci_get forkop.tuic.server_uuid 2>/dev/null || true)"
[[ "$tuic_uuid" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || fail "TUIC UUID has invalid format: $tuic_uuid"
assert_value forkop.tuic.tuic_congestion_control cubic
assert_value forkop.tuic.tuic_auth_timeout 3s
assert_value forkop.tuic.tuic_heartbeat 10s
grep -Fxq 'commit forkop' "$LOG" || fail 'expected config commit'

: >"$LOG"
: >"$FORKOP_SSH_KEYGEN_LOG"
ucode -L "$UCODE_LIB" "$SERVER_RUNTIME" prepare-all-defaults
[ ! -s "$LOG" ] || fail 'unchanged MTProto defaults must not rewrite or commit configuration on every reload'
[ ! -s "$FORKOP_SSH_KEYGEN_LOG" ] || fail 'persistent SSH host key must not be regenerated on reload'

printf 'server runtime checks passed\n'
