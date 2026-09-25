#!/usr/bin/env bash
# The Servers tab writes a sing-box inbound directly, so the rule is symmetric: what
# the core refuses, the runtime check has to refuse by name, and what the core accepts
# the runtime check must not refuse. This drives both halves over one server per case.
#
# Every expectation below was measured against `sing-box check` and a real start on a
# listener carrying exactly that value. With a sing-box binary on PATH the measurement
# is repeated here, which is what notices the core changing its mind; without one the
# recorded verdict is still compared with the runtime check.
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
VALIDATOR="$FORKOP_LIB/config/validator.uc"
GENERATOR="$FORKOP_LIB/singbox/generator.uc"
SING_BOX="${FORKOP_SING_BOX_BIN:-$(command -v sing-box || true)}"

# A certificate a TLS listener can actually open, so a case about something else is
# not refused for a missing file.
CERT="$WORK_DIR/server.crt"
KEY="$WORK_DIR/server.key"
if [ -n "$SING_BOX" ]; then
  "$SING_BOX" generate tls-keypair boundaries.example --months 1 >"$WORK_DIR/pair.pem" 2>/dev/null || true
  awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/' "$WORK_DIR/pair.pem" >"$CERT"
  awk '/BEGIN PRIVATE KEY/,/END PRIVATE KEY/' "$WORK_DIR/pair.pem" >"$KEY"
fi
[ -s "$CERT" ] || printf -- '-----BEGIN CERTIFICATE-----\nplaceholder\n-----END CERTIFICATE-----\n' >"$CERT"
[ -s "$KEY" ] || printf -- '-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----\n' >"$KEY"
HOST_KEY="$WORK_DIR/ssh.key"
if command -v ssh-keygen >/dev/null 2>&1; then
  ssh-keygen -q -t ed25519 -N '' -f "$HOST_KEY" >/dev/null 2>&1 || true
fi
[ -s "$HOST_KEY" ] ||
  printf -- '-----BEGIN OPENSSH PRIVATE KEY-----\nplaceholder\n-----END OPENSSH PRIVATE KEY-----\n' >"$HOST_KEY"

# One server per case. "verdict" is what the core does with the inbound the generator
# builds from it: accept, or refuse before the listener is up. "expect" is what the
# runtime check has to say - a message fragment when it refuses, empty when it must
# not. A case where the core refuses and the check is silent leaves the whole service
# down on apply; a case where the core accepts and the check refuses takes a working
# setting away.
node - "$WORK_DIR" "$CERT" "$KEY" "$HOST_KEY" <<'NODE'
const fs = require("fs");
const [dir, cert, key, hostKey] = process.argv.slice(2);

const client = (name, extra) => ({
  ".name": `c_${name}`,
  ".type": "server_client",
  server: "srv",
  name: "phone",
  ...extra,
});

const server = (extra) => ({
  ".name": "srv",
  ".type": "server",
  enabled: "1",
  label: "srv",
  listen: "0.0.0.0",
  listen_port: "20001",
  public_host: "203.0.113.9",
  ...extra,
});

const tls = { tls_certificate_path: cert, tls_key_path: key };
const reality = {
  security: "reality",
  tls_server_name: "example.com",
  reality_private_key: "kP1C4vzQnlzyKRo3DORq6f_v3n9u7nGY8dl0AKbx11A",
  reality_public_key: "kP1C4vzQnlzyKRo3DORq6f_v3n9u7nGY8dl0AKbx11A",
  reality_short_id: "4aee2254",
};
const uuid = "11111111-1111-4111-8111-111111111111";
const key32 = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

const cases = [
  // The listen address. The core parses it as an address and dies on the config.
  ["listen address", "refused", "which is not an IP address",
    server({ protocol: "vless", ...reality, listen: "nonsense" }), [client("v", { uuid })]],
  ["listen wildcard v6", "accepted", "",
    server({ protocol: "vless", ...reality, listen: "::" }), [client("v", { uuid })]],

  // The stream transport and the one XHTTP field with a closed set.
  ["transport name", "refused", "unsupported transport",
    server({ protocol: "vless", ...reality, transport: "quic" }), [client("v", { uuid })]],
  ["transport raw", "accepted", "",
    server({ protocol: "vless", ...reality, transport: "raw" }), [client("v", { uuid })]],
  ["xhttp mode", "refused", "unsupported transport_xhttp_mode",
    server({ protocol: "vless", ...reality, transport: "xhttp", transport_xhttp_mode: "burst" }),
    [client("v", { uuid })]],

  // Shadowsocks: the cipher name and both halves of a 2022 key.
  ["shadowsocks method", "refused", "unsupported shadowsocks_method",
    server({ protocol: "shadowsocks", shadowsocks_method: "rc4-md5" }),
    [client("s", { password: "x" })]],
  ["shadowsocks legacy method", "accepted", "",
    server({ protocol: "shadowsocks", shadowsocks_method: "aes-256-gcm" }),
    [client("s", { password: "anything" })]],
  ["shadowsocks listener key length", "refused", "server pre-shared key",
    server({ protocol: "shadowsocks", shadowsocks_method: "2022-blake3-aes-256-gcm", shadowsocks_psk: "YWJj" }),
    [client("s", { password: key32 })]],
  ["shadowsocks account key length", "refused", "pre-shared key",
    server({ protocol: "shadowsocks", shadowsocks_method: "2022-blake3-aes-256-gcm", shadowsocks_psk: key32 }),
    [client("s", { password: "YWJjZA==" })]],

  // Mieru will not start without a transport, and only knows two.
  ["mieru transport", "refused", "unsupported mieru_transport",
    server({ protocol: "mieru", mieru_transport: "tcp" }), [client("m", { password: "p" })]],
  ["mieru transport missing", "refused", "unsupported mieru_transport",
    server({ protocol: "mieru" }), [client("m", { password: "p" })]],

  // NaiveProxy takes a network list.
  ["naive network", "refused", "unsupported naive_network",
    server({ protocol: "naive", ...tls, naive_network: "quic" }),
    [client("n", { password: "p" })]],
  ["naive network pair", "accepted", "",
    server({ protocol: "naive", ...tls, naive_network: "tcp_udp" }),
    [client("n", { password: "p" })]],

  // TUIC: the congestion controller and the heartbeat duration.
  ["tuic congestion", "refused", "unsupported tuic_congestion_control",
    server({ protocol: "tuic", ...tls, tuic_congestion_control: "brutal" }),
    [client("t", { uuid, password: "p" })]],
  ["tuic heartbeat", "refused", "Invalid duration value",
    server({ protocol: "tuic", ...tls, tuic_heartbeat: "soon" }),
    [client("t", { uuid, password: "p" })]],

  // Hysteria2: obfuscation, the masquerade URL and the bandwidth numbers.
  ["hysteria2 obfs type", "refused", "unsupported hysteria2_obfs_type",
    server({ protocol: "hysteria2", ...tls, hysteria2_obfs_type: "scramble", hysteria2_obfs_password: "p" }),
    [client("h", { password: "p" })]],
  ["hysteria2 masquerade scheme", "refused", "must start with https://",
    server({ protocol: "hysteria2", ...tls, hysteria2_masquerade: "ftp://example.com" }),
    [client("h", { password: "p" })]],
  ["hysteria2 masquerade file", "accepted", "",
    server({ protocol: "hysteria2", ...tls, hysteria2_masquerade: "file:///tmp" }),
    [client("h", { password: "p" })]],
  ["hysteria2 bandwidth", "refused", "whole number of megabits",
    server({ protocol: "hysteria2", ...tls, hysteria2_up_mbps: "fast" }),
    [client("h", { password: "p" })]],

  // Reality: the short ID is hex bytes and at most eight of them.
  ["hysteria2 gecko", "accepted", "",
    server({ protocol: "hysteria2", ...tls, hysteria2_obfs_type: "gecko", hysteria2_obfs_password: "secret", hysteria2_gecko_min_packet_size: "512", hysteria2_gecko_max_packet_size: "1200", hysteria2_bbr_profile: "conservative" }),
    [client("h", { password: "p" })]],
  ["reality short id odd", "refused", "even number of hex digits",
    server({ protocol: "vless", ...reality, reality_short_id: "abc" }), [client("v", { uuid })]],
  ["reality short id long", "refused", "longer than 16 hex digits",
    server({ protocol: "vless", ...reality, reality_short_id: "0123456789abcdef01" }),
    [client("v", { uuid })]],
  ["reality short id 8 bytes", "accepted", "",
    server({ protocol: "vless", ...reality, reality_short_id: "0123456789abcdef" }),
    [client("v", { uuid })]],
  ["reality private key", "refused", "invalid reality_private_key",
    server({ protocol: "vless", ...reality, reality_private_key: "short" }), [client("v", { uuid })]],

  // The files a listener opens while it starts.
  ["tls certificate file", "refused", "does not exist",
    server({ protocol: "trojan", security: "tls", tls_certificate_path: "/tmp/forkop-absent.crt", tls_key_path: key }),
    [client("t", { password: "p" })]],
  ["ssh host key file", "refused", "does not exist",
    server({ protocol: "ssh", ssh_host_key_path: "/tmp/forkop-absent.key" }),
    [client("s", { password: "p" })]],
  ["ssh host key present", "accepted", "",
    server({ protocol: "ssh", ssh_host_key_path: hostKey }), [client("s", { password: "p" })]],

  // MTProto has no secret without a FakeTLS host, and the key is 32 hex characters.
  ["mtproto without faketls", "refused", "needs a FakeTLS host",
    server({ protocol: "mtproto" }), [client("m", { secret: "a".repeat(32) })]],
  ["mtproto secret", "refused", "needs a 32 hex character secret",
    server({ protocol: "mtproto", mtproto_faketls: "google.com" }),
    [client("m", { secret: "not-a-secret" })]],
];

const index = [];
cases.forEach(([name, verdict, expect, srv, clients], i) => {
  const file = `${dir}/case-${String(i).padStart(2, "0")}.json`;
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        settings: {
          ".name": "settings",
          ".type": "settings",
          dns_server: ["77.88.8.8"],
          bootstrap_dns_server: ["77.88.8.8"],
          service_listen_address: "127.0.0.1",
        },
        section: [
          {
            ".name": "proxy",
            ".type": "section",
            label: "proxy",
            enabled: "1",
            action: "connection",
            connection_url: "socks5://127.0.0.1:1080",
            user_domains: "example.com",
          },
        ],
        server: [srv],
        server_client: clients,
      },
      null,
      2,
    ),
  );
  // read collapses a run of tabs, so the column is never empty.
  index.push({ name, verdict, expect: expect || "-", file });
});
fs.writeFileSync(`${dir}/index.tsv`, index.map((e) => [e.name, e.verdict, e.expect, e.file].join("\t")).join("\n") + "\n");
console.error(`${index.length} boundary cases`);
NODE

checked=0
refused=0
while IFS=$'\t' read -r name verdict expect file; do
  [ -n "$name" ] || continue
  checked=$((checked + 1))

  if output="$(FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$VALIDATOR" \
    validate-runtime-fixture "$file" '{}' 2>&1)"; then
    validator_verdict="accepted"
  else
    validator_verdict="refused"
  fi

  if [ "$verdict" = "refused" ]; then
    refused=$((refused + 1))
    [ "$validator_verdict" = "refused" ] ||
      fail "$name: the core refuses this and the runtime check accepts it"
    printf '%s\n' "$output" | grep -Fq -- "$expect" ||
      fail "$name: expected a message containing '$expect', got: $output"
  else
    [ "$validator_verdict" = "accepted" ] ||
      fail "$name: the core accepts this and the runtime check refuses it: $output"
  fi

  # The recorded verdict, re-measured. The generator turns the fixture into the
  # configuration the router would run, and the core is asked what it makes of it.
  if [ -n "$SING_BOX" ] && [ "$verdict" = "accepted" ]; then
    mkdir -p "$WORK_DIR/out.json.rulesets"
    ucode -L "$FORKOP_LIB" "$GENERATOR" generate-config-fixture \
      "$file" "$WORK_DIR/out.json" "127.0.0.1" "0" >/dev/null 2>&1 ||
      fail "$name: the generator refused a case the core accepts"
    "$SING_BOX" check -c "$WORK_DIR/out.json" >"$WORK_DIR/check.log" 2>&1 ||
      fail "$name: recorded as accepted, but the core refuses it: $(tail -1 "$WORK_DIR/check.log")"
  fi
done <"$WORK_DIR/index.tsv"

[ "$checked" -ge 25 ] || fail "expected at least 25 boundary cases, ran $checked"
[ "$refused" -ge 18 ] || fail "expected at least 18 refusals, got $refused"

if [ -z "$SING_BOX" ]; then
  printf 'note: no sing-box binary, the recorded core verdicts were not re-measured\n'
fi
printf 'server boundary checks passed (%d cases, %d refusals)\n' "$checked" "$refused"
