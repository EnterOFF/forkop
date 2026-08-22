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
  "generate tls-keypair "*)
    printf '%s\n' "$*" >>"$TLS_KEYPAIR_LOG"
    printf '%s\n' '-----BEGIN PRIVATE KEY-----' 'key-body' '-----END PRIVATE KEY-----'
    printf '%s\n' '-----BEGIN CERTIFICATE-----' 'cert-body' '-----END CERTIFICATE-----'
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

export FORKOP_SERVER_CERT_DIR="$WORK_DIR/server-certs"
mkdir -p "$FORKOP_SERVER_CERT_DIR"
export TLS_KEYPAIR_LOG="$WORK_DIR/tls-keypair.log"
: >"$TLS_KEYPAIR_LOG"
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
forkop.mixed_cased=server
forkop.mixed_cased.protocol=mixed
forkop.mixed_cased.label=Office
forkop.cff0005=server_client
forkop.cff0005.server=mixed_cased
forkop.cff0005.name=Alice.Phone-2
forkop.cff0005.password=office-password
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
forkop.hy2=server
forkop.hy2.label=Edge hy2
forkop.hy2.protocol=hysteria2
forkop.hy2.enabled=1
forkop.hy2.tls_server_name=naive-sni.example
forkop.cff0009=server_client
forkop.cff0009.server=hy2
forkop.cff0009.password=hy2-secret
EOF_STATE
printf 'forkop.ssh.ssh_host_key_path=%s %s\n' "$WORK_DIR/ssh/host_key" "$WORK_DIR/ssh/host_key_secondary" >>"$STATE"
# The server points at its own pair, because nothing is issued for one that was
# never told where to keep it, and that path is only known once the work directory
# is.
printf 'forkop.hy2.tls_certificate_path=%s/hy2.crt\nforkop.hy2.tls_key_path=%s/hy2.key\n' \
  "$FORKOP_SERVER_CERT_DIR" "$FORKOP_SERVER_CERT_DIR" >>"$STATE"

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

# The subject is what a client checks, so it is the SNI, or the address the links
# carry, or the name of the server - never the section id, which means nothing
# outside the configuration file.
grep -Fq "generate tls-keypair naive-sni.example" "$TLS_KEYPAIR_LOG" ||
  fail "the certificate subject must come from the SNI"
if grep -Eq "generate tls-keypair (naive|anytls|tuic|hy2) " "$TLS_KEYPAIR_LOG"; then
  fail "the certificate subject must not be the section id"
fi

# A self signed certificate that is pinned has no reason to expire while its
# server runs, and a month is what the sing-box default would have given it.
grep -Fq -- "--months 120" "$TLS_KEYPAIR_LOG" ||
  fail "the generated certificate must be valid for longer than a month"

# Nothing is issued for a server that was never told where to keep a certificate:
# the dialog asks for both paths and its button fills them in, and the runtime check
# names the field when they are missing.
if [ -n "$(uci_get forkop.naive.tls_certificate_path 2>/dev/null || true)" ]; then
  fail "a certificate path must not be invented for a server that has none"
fi
[ -s "$FORKOP_SERVER_CERT_DIR/hy2.crt" ] ||
  fail "a stored certificate path must still get its file"

# The file name comes from the section id and the subject from the display name: a
# name has to be sanitised to be a file name, and two servers named in Cyrillic - Дом
# and Сад - would both want ______.crt and take turns overwriting one certificate.
: >"$TLS_KEYPAIR_LOG"
ucode -L "$UCODE_LIB" "$SERVER_RUNTIME" generate-server-certificate 'Дом' 'newaaaa' >/dev/null
ucode -L "$UCODE_LIB" "$SERVER_RUNTIME" generate-server-certificate 'Сад' 'newbbbb' >/dev/null
for name in newaaaa newbbbb; do
  [ -s "$FORKOP_SERVER_CERT_DIR/$name.crt" ] ||
    fail "the certificate of $name must be named after the section"
  [ -s "$FORKOP_SERVER_CERT_DIR/$name.key" ] ||
    fail "the private key of $name must be named after the section"
done
[ ! -e "$FORKOP_SERVER_CERT_DIR/______.crt" ] ||
  fail "a display name must not become the file name"
grep -Fq 'generate tls-keypair Дом' "$TLS_KEYPAIR_LOG" ||
  fail "the certificate subject must be the name a client checks"

# Forkop replaces what it generated when the stamp it wrote is gone or close, and
# never touches a pair the user pointed at.
grep -Fq 'function server_cert_is_managed(certificate_path, key_path)' "$SERVER_RUNTIME" ||
  fail "server/service.uc must tell its own certificate from the user's"
grep -Fq 'function server_cert_needs_replacement(certificate_path, key_path)' "$SERVER_RUNTIME" ||
  fail "server/service.uc must replace a certificate that is about to expire"

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
# And a name the protocol can carry is left exactly as it was typed. SOCKS, HTTP, SSH
# and Mieru compare an account name byte for byte, so lowercasing one the dialog
# accepted renamed the account on every apply and broke the link already handed out.
assert_client mixed_cased name Alice.Phone-2
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
# Nothing is invented for a server that was never told where to keep a host key:
# the dialog asks for the path and its button fills it in.
assert_empty forkop.ssh_disabled.ssh_host_key_path
[ -s "$WORK_DIR/ssh/host_key" ] || fail 'persistent SSH host key was not generated'
[ -s "$WORK_DIR/ssh/host_key_secondary" ] || fail 'secondary persistent SSH host key was not generated'
[ "$(wc -l <"$FORKOP_SSH_KEYGEN_LOG")" -eq 4 ] || fail 'SSH host key generation did not convert every configured key exactly once'
grep -Fxq 'commit forkop' "$LOG" || fail 'expected config commit'

: >"$LOG"
: >"$FORKOP_SSH_KEYGEN_LOG"
ucode -L "$UCODE_LIB" "$SERVER_RUNTIME" prepare-all-defaults
[ ! -s "$LOG" ] || fail 'unchanged server defaults must not rewrite or commit configuration on every reload'
[ ! -s "$FORKOP_SSH_KEYGEN_LOG" ] || fail 'persistent SSH host key must not be regenerated on reload'

# The WAN zone of an OpenWrt firewall rejects what it was not told to accept, so a
# server that exists to be dialled from outside needs a rule. The switch in the
# dialog decides, the include is derived from it, and a listener that carries UDP
# gets a UDP rule as well.
export FORKOP_SERVER_FIREWALL_INCLUDE="$WORK_DIR/nftables.d/chain-pre/input/forkop-servers.nft"
export FORKOP_FIREWALL_INIT="$WORK_DIR/bin/firewall-missing"

cat >>"$STATE" <<'EOF_FIREWALL'
forkop.fw_tcp=server
forkop.fw_tcp.protocol=vless
forkop.fw_tcp.listen_port=31001
forkop.fw_udp=server
forkop.fw_udp.protocol=hysteria2
forkop.fw_udp.listen_port=31002
forkop.fw_both=server
forkop.fw_both.protocol=naive
forkop.fw_both.naive_network=tcp_udp
forkop.fw_both.listen_port=31003
forkop.fw_closed=server
forkop.fw_closed.protocol=vless
forkop.fw_closed.listen_port=31004
forkop.fw_closed.open_firewall=0
forkop.fw_off=server
forkop.fw_off.protocol=vless
forkop.fw_off.listen_port=31005
forkop.fw_off.enabled=0
forkop.fw_tailscale=server
forkop.fw_tailscale.protocol=tailscale
forkop.fw_tailscale.listen_port=31006
forkop.fw_ss=server
forkop.fw_ss.protocol=shadowsocks
forkop.fw_ss.listen_port=31007
EOF_FIREWALL

ucode -L "$UCODE_LIB" "$SERVER_RUNTIME" sync-firewall
include="$FORKOP_SERVER_FIREWALL_INCLUDE"
[ -s "$include" ] || fail 'sync-firewall must write the fw4 input include'
grep -Eq '^meta l4proto tcp th dport \{ [0-9, ]*31001[0-9, ]*\} counter accept' "$include" ||
  fail 'a TCP listener must be accepted on its port'
grep -Eq '^meta l4proto udp th dport \{ [0-9, ]*31002[0-9, ]*\} counter accept' "$include" ||
  fail 'a UDP listener must be accepted on its port'
grep -Eq '^meta l4proto tcp th dport \{ [0-9, ]*31003[0-9, ]*\}' "$include" &&
  grep -Eq '^meta l4proto udp th dport \{ [0-9, ]*31003[0-9, ]*\}' "$include" ||
  fail 'a listener that carries both protocols needs both rules'
grep -Fq '31004' "$include" && fail 'a server with the switch off must stay closed'
grep -Fq '31005' "$include" && fail 'a disabled server must stay closed'
grep -Fq '31006' "$include" && fail 'a Tailscale endpoint has no listener to open'
# A Shadowsocks listener takes the default network, which is TCP and UDP, and the
# UDP half is how a client relays datagrams.
grep -Eq '^meta l4proto tcp th dport \{ [0-9, ]*31007[0-9, ]*\}' "$include" &&
  grep -Eq '^meta l4proto udp th dport \{ [0-9, ]*31007[0-9, ]*\}' "$include" ||
  fail 'a Shadowsocks listener needs both protocols accepted'
# nftables only takes a double quoted comment; fw4 drops an include with a single
# quoted one and says nothing about it.
grep -Fq "comment \"$(printf 'forkop: server ports')\"" "$include" ||
  fail 'the include must use a double quoted nftables comment'
grep -Fq "comment '" "$include" && fail 'a single quoted comment is not nftables syntax'

before="$(cat "$include")"
ucode -L "$UCODE_LIB" "$SERVER_RUNTIME" sync-firewall
[ "$before" = "$(cat "$include")" ] || fail 'an unchanged server set must not rewrite the include'

ucode -L "$UCODE_LIB" "$SERVER_RUNTIME" sync-firewall clear
[ ! -e "$include" ] || fail 'a stopped runtime must not leave server ports accepted'

# Forkop issues certificates and SSH host keys into two directories of its own. A
# removed server leaves them behind, nothing will ever reference them again, and a
# private key of a server that no longer exists has no business staying on the
# overlay. Only those directories, and only a file no server points at.
export FORKOP_SERVER_SSH_DIR="$WORK_DIR/server-ssh"
mkdir -p "$FORKOP_SERVER_SSH_DIR" "$WORK_DIR/elsewhere"
printf 'orphan\n' >"$FORKOP_SERVER_CERT_DIR/gone.crt"
printf 'orphan\n' >"$FORKOP_SERVER_CERT_DIR/gone.key"
printf '0\n' >"$FORKOP_SERVER_CERT_DIR/gone.crt.expires"
printf 'orphan\n' >"$FORKOP_SERVER_SSH_DIR/gone.key"
# Referenced by a server, even though it sits in Forkop's own directory and was put
# there by hand: a path the configuration points at is in use.
printf 'kept\n' >"$FORKOP_SERVER_CERT_DIR/handmade.crt"
printf 'kept\n' >"$FORKOP_SERVER_CERT_DIR/handmade.key"
printf 'kept\n' >"$FORKOP_SERVER_SSH_DIR/handmade.key"
printf 'outside\n' >"$WORK_DIR/elsewhere/private.crt"
cat >>"$STATE" <<EOF_FILES
forkop.fw_certs=server
forkop.fw_certs.protocol=trojan
forkop.fw_certs.enabled=0
forkop.fw_certs.listen_port=31008
forkop.fw_certs.security=tls
forkop.fw_certs.tls_certificate_path=$FORKOP_SERVER_CERT_DIR/handmade.crt
forkop.fw_certs.tls_key_path=$FORKOP_SERVER_CERT_DIR/handmade.key
forkop.fw_ssh=server
forkop.fw_ssh.protocol=ssh
forkop.fw_ssh.enabled=0
forkop.fw_ssh.listen_port=31009
forkop.fw_ssh.ssh_host_key_path=$FORKOP_SERVER_SSH_DIR/handmade.key
EOF_FILES

ucode -L "$UCODE_LIB" "$SERVER_RUNTIME" prepare-all-defaults

for gone in "$FORKOP_SERVER_CERT_DIR/gone.crt" "$FORKOP_SERVER_CERT_DIR/gone.key" \
  "$FORKOP_SERVER_CERT_DIR/gone.crt.expires" "$FORKOP_SERVER_SSH_DIR/gone.key"; do
  [ ! -e "$gone" ] || fail "a file of a removed server must not stay behind: $gone"
done
# A disabled server still owns its files, and the expiry stamp belongs to its
# certificate.
for kept in "$FORKOP_SERVER_CERT_DIR/handmade.crt" "$FORKOP_SERVER_CERT_DIR/handmade.key" \
  "$FORKOP_SERVER_SSH_DIR/handmade.key" "$FORKOP_SERVER_CERT_DIR/hy2.crt" \
  "$FORKOP_SERVER_CERT_DIR/hy2.crt.expires" "$WORK_DIR/ssh/host_key"; do
  [ -e "$kept" ] || fail "a file the configuration points at must be kept: $kept"
done
# Nothing outside the two directories Forkop issues into is ever looked at, let
# alone removed: a path the user chose is theirs.
[ -e "$WORK_DIR/elsewhere/private.crt" ] ||
  fail 'a file outside the directories Forkop owns must never be touched'
grep -Fq 'for (let dir in [ SERVER_CERT_DIR, SERVER_SSH_DIR ])' "$SERVER_RUNTIME" ||
  fail 'server/service.uc must only sweep the two directories it issues into'

# A file named after a server that still exists is that server's, even when no
# option points at it: a cleared certificate field must not cost the file.
printf 'named\n' >"$FORKOP_SERVER_CERT_DIR/fw_certs.crt"
printf 'named\n' >"$FORKOP_SERVER_SSH_DIR/fw_ssh.key"
ucode -L "$UCODE_LIB" "$SERVER_RUNTIME" prepare-all-defaults
for kept in "$FORKOP_SERVER_CERT_DIR/fw_certs.crt" "$FORKOP_SERVER_SSH_DIR/fw_ssh.key"; do
  [ -e "$kept" ] || fail "a file named after an existing server must be kept: $kept"
done

# An empty server list is indistinguishable from a list that could not be read, and
# acting on it turns every certificate, host key and account on the router into
# garbage. It happened once; it must not be possible.
EMPTY_STATE="$WORK_DIR/empty.state"
EMPTY_LOG="$WORK_DIR/empty.log"
EMPTY_CERTS="$WORK_DIR/empty-certs"
EMPTY_SSH="$WORK_DIR/empty-ssh"
mkdir -p "$EMPTY_CERTS" "$EMPTY_SSH"
printf 'orphan\n' >"$EMPTY_CERTS/whatever.crt"
printf 'orphan\n' >"$EMPTY_SSH/whatever.key"
cat >"$EMPTY_STATE" <<'EOF_EMPTY'
forkop.settings=settings
forkop.stray_client=server_client
forkop.stray_client.server=vanished
forkop.stray_client.name=phone
forkop.stray_client.password=secret
EOF_EMPTY
FORKOP_UCI_STATE_FILE="$EMPTY_STATE" FORKOP_UCI_LOG_FILE="$EMPTY_LOG" \
  FORKOP_SERVER_CERT_DIR="$EMPTY_CERTS" FORKOP_SERVER_SSH_DIR="$EMPTY_SSH" \
  ucode -L "$UCODE_LIB" "$SERVER_RUNTIME" prepare-all-defaults
[ -e "$EMPTY_CERTS/whatever.crt" ] ||
  fail 'a configuration with no servers must not have its certificates removed'
[ -e "$EMPTY_SSH/whatever.key" ] ||
  fail 'a configuration with no servers must not have its host keys removed'
grep -Fq 'forkop.stray_client.password=secret' "$EMPTY_STATE" ||
  fail 'a configuration with no servers must not have its accounts removed'

printf 'server runtime checks passed\n'
