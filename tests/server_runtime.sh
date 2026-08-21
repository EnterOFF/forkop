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

# The SSH inbound can hand a client a key pair, so the verb has to be reachable from
# the CLI the LuCI form calls.
grep -Fq 'generate-ssh-keypair' "$SERVER_RUNTIME" &&
  fail "server/service.uc must not generate SSH client key pairs"
grep -Fq 'generate_ssh_keypair' "$ROOT_DIR/forkop/files/usr/bin/forkop" &&
  fail "the forkop CLI must not expose an SSH key pair verb"

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
forkop.cff0001=server_client
forkop.cff0001.server=vless
forkop.cff0001.uuid=22222222-2222-4222-8222-222222222222
forkop.cff0001.flow=xtls-rprx-vision
forkop.mixed=server
forkop.mixed.protocol=mixed
forkop.mixed.label=Рабочий стол
forkop.cff0003=server_client
forkop.cff0003.server=mixed
forkop.cff0003.name=Рабочий стол
forkop.cff0003.password=desktop-password
forkop.mixed_open=server
forkop.mixed_open.protocol=mixed
forkop.mixed_open.label=guest
forkop.mixed_open.mixed_auth_enabled=0
forkop.cff0004=server_client
forkop.cff0004.server=mixed_open
forkop.cff0004.name=guest
forkop.orphan_client=server_client
forkop.orphan_client.server=removed_server
forkop.orphan_client.name=orphan
forkop.shadowsocks=server
forkop.shadowsocks.protocol=shadowsocks
forkop.shadowsocks.shadowsocks_method=2022-blake3-aes-256-gcm
forkop.tailscale=server
forkop.tailscale.protocol=tailscale
forkop.json=server
forkop.json.protocol=json_inbound
forkop.mtproto=server
forkop.mtproto.protocol=mtproto
forkop.cff0002=server_client
forkop.cff0002.server=mtproto
forkop.cff0002.secret=eeaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6578616d706c652e6f7267
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
forkop.vless_no_client=server
forkop.vless_no_client.protocol=vless
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

# Clients are their own sections, so the generated accounts are looked up by owner.
client_of() {
  awk -F= -v owner="$1" '
    $1 ~ /^forkop.[A-Za-z0-9_]+.server$/ && substr($0, length($1) + 2) == owner {
      split($1, parts, ".")
      print parts[2]
      found = 1
    }
    END { exit found ? 0 : 1 }
  ' "$STATE"
}

assert_client() {
  local owner="$1" option="$2" expected="$3" client actual
  client="$(client_of "$owner")" || fail "server $owner has no client section"
  actual="$(uci_get "forkop.$client.$option" 2>/dev/null || true)"
  [ "$actual" = "$expected" ] || fail "client of $owner: $option expected '$expected', got '$actual'"
}

client_value() {
  local owner="$1" option="$2" client
  client="$(client_of "$owner")" || fail "server $owner has no client section"
  uci_get "forkop.$client.$option" 2>/dev/null || true
}


assert_empty() {
  local path="$1" actual
  actual="$(uci_get "$path" 2>/dev/null || true)"
  [ -z "$actual" ] || fail "$path must stay empty, got '$actual'"
}

# Derived values the backend owns, because the runtime has to agree with the form on
# which security mode a protocol actually runs with.
assert_value forkop.vless.security reality
assert_value forkop.mixed.security none
assert_value forkop.tailscale.security none
assert_value forkop.json.security none
assert_value forkop.naive.security tls
assert_value forkop.ssh.security none
assert_value forkop.mieru.security none
assert_value forkop.anytls.security tls
assert_value forkop.tuic.security tls
assert_value forkop.vless.listen 0.0.0.0

# Nothing is generated behind the user's back any more: a value the form leaves empty
# stays empty and the validator reports it instead.
for invented_path in \
  forkop.vless.listen_port \
  forkop.vless.public_host \
  forkop.vless.reality_short_id \
  forkop.vless.reality_private_key \
  forkop.vless.reality_public_key \
  forkop.vless.tls_server_name \
  forkop.shadowsocks.shadowsocks_psk \
  forkop.tailscale.tailscale_hostname \
  forkop.naive.naive_network \
  forkop.mieru.mieru_transport \
  forkop.tuic.tuic_congestion_control \
  forkop.tuic.tuic_auth_timeout \
  forkop.tuic.tuic_heartbeat; do
  assert_empty "$invented_path"
done

# A server without clients keeps none: an inbound with no users is a validation
# error, not something the backend papers over.
for owner in vless_no_client shadowsocks anytls tuic; do
  client_of "$owner" >/dev/null 2>&1 && fail "server $owner must not get a generated client"
done
assert_client vless uuid 22222222-2222-4222-8222-222222222222
assert_client vless flow xtls-rprx-vision
assert_empty "forkop.$(client_of vless).password"

# Credentials never move to the server section.
for removed_path in forkop.mixed.server_password forkop.mixed.server_username forkop.vless.server_uuid forkop.mtproto.mtproto_secret; do
  assert_empty "$removed_path"
done

# A login protocol turns the client name into an account name, because that name goes
# on the wire. A name outside the safe set falls back to the server name.
assert_client mixed name mixed
assert_client mixed_open name guest
assert_value forkop.mixed_open.mixed_auth_enabled 0
assert_client mixed password desktop-password

# A secret pasted in its full form carries the FakeTLS host, so it is split back into
# the stored secret and the server option.
assert_client mtproto secret aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
assert_value forkop.mtproto.mtproto_faketls example.org

# Clients of a server that no longer exists are removed with it.
assert_empty forkop.orphan_client.server

# Files only the backend can create.
assert_value forkop.tailscale.tailscale_control_url https://controlplane.tailscale.com
assert_value forkop.ssh.ssh_host_key_path "$WORK_DIR/ssh/host_key $WORK_DIR/ssh/host_key_secondary"
assert_value forkop.ssh_disabled.ssh_host_key_path /etc/forkop/server-ssh/ssh_disabled.key
[ -s "$WORK_DIR/ssh/host_key" ] || fail 'persistent SSH host key was not generated'
[ -s "$WORK_DIR/ssh/host_key_secondary" ] || fail 'secondary persistent SSH host key was not generated'
[ "$(wc -l <"$FORKOP_SSH_KEYGEN_LOG")" -eq 4 ] || fail 'SSH host key generation did not convert every configured key exactly once'
grep -Fxq 'commit forkop' "$LOG" || fail 'expected config commit'

: >"$LOG"
: >"$FORKOP_SSH_KEYGEN_LOG"
ucode -L "$UCODE_LIB" "$SERVER_RUNTIME" prepare-all-defaults
[ ! -s "$LOG" ] || fail 'unchanged server defaults must not rewrite or commit configuration on every reload'
[ ! -s "$FORKOP_SSH_KEYGEN_LOG" ] || fail 'persistent SSH host key must not be regenerated on reload'

printf 'server runtime checks passed\n'
