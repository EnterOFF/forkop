#!/usr/bin/env bash
# The Servers tab writes a sing-box inbound directly, so a key the core does not
# have is a start-up failure and an option the core dropped is a dead field. Both
# are caught here: the generator is run over one server per protocol and every key
# it emits is looked up in a snapshot of the core inbound option structs, and the
# UCI options the dialog offers are compared with the list this file declares.
#
# The snapshot lives in the repository so the check runs without a core checkout.
# When one is present it is rebuilt and compared, which is what catches an option
# the core renamed or removed.
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
GENERATOR="$FORKOP_LIB/singbox/generator.uc"
SCHEMA_HELPER="$ROOT_DIR/tests/helpers/singbox_option_schema.js"
SCHEMA_SNAPSHOT="$ROOT_DIR/tests/data/singbox_inbound_options.json"
SERVER_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/server.js"
CORE_OPTION_DIR="${FORKOP_SING_BOX_OPTION_DIR:-$ROOT_DIR/sandbox/sing-box-forkop/option}"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

# One server per protocol, filled in the way the dialog fills it in, so the
# generator emits every key it can emit.
cat >"$WORK_DIR/servers.json" <<'JSON'
{
  "settings": {
    "dns_server": "77.88.8.8",
    "bootstrap_dns_server": "77.88.8.8",
    "service_listen_address": "127.0.0.1"
  },
  "section": [
    {
      ".name": "proxy", ".type": "section", "label": "proxy", "enabled": "1",
      "action": "connection", "connection_url": "socks5://127.0.0.1:1080",
      "user_domains": "example.com"
    }
  ],
  "server": [
    {
      ".name": "mixed_srv", ".type": "server", "enabled": "1", "label": "mixed",
      "protocol": "mixed", "listen": "0.0.0.0", "listen_port": "20001",
      "mixed_auth_enabled": "1", "tcp_fast_open": "1", "routing_mode": "direct"
    },
    {
      ".name": "vless_srv", ".type": "server", "enabled": "1", "label": "vless",
      "protocol": "vless", "listen": "0.0.0.0", "listen_port": "20002",
      "security": "reality", "tls_server_name": "www.microsoft.com",
      "reality_handshake_server": "www.microsoft.com",
      "reality_handshake_server_port": "443",
      "reality_private_key": "kP1C4vzQnlzyKRo3DORq6f_v3n9u7nGY8dl0AKbx11A",
      "reality_public_key": "kP1C4vzQnlzyKRo3DORq6f_v3n9u7nGY8dl0AKbx11A",
      "reality_short_id": "4aee2254", "transport": "tcp",
      "multiplex_enabled": "1", "multiplex_padding": "1",
      "routing_mode": "direct"
    },
    {
      ".name": "vmess_srv", ".type": "server", "enabled": "1", "label": "vmess",
      "protocol": "vmess", "listen": "0.0.0.0", "listen_port": "20003",
      "security": "tls", "tls_server_name": "example.com",
      "tls_alpn": [ "h2", "http/1.1" ],
      "tls_certificate_path": "/etc/forkop/server-certs/vmess.crt",
      "tls_key_path": "/etc/forkop/server-certs/vmess.key",
      "transport": "ws", "transport_path": "/ws", "transport_host": "example.com",
      "routing_mode": "direct"
    },
    {
      ".name": "trojan_srv", ".type": "server", "enabled": "1", "label": "trojan",
      "protocol": "trojan", "listen": "0.0.0.0", "listen_port": "20004",
      "security": "tls",
      "tls_certificate_path": "/etc/forkop/server-certs/trojan.crt",
      "tls_key_path": "/etc/forkop/server-certs/trojan.key",
      "transport": "xhttp", "transport_path": "/x",
      "transport_xhttp_mode": "auto", "routing_mode": "direct"
    },
    {
      ".name": "trojan_grpc", ".type": "server", "enabled": "1", "label": "trojan grpc",
      "protocol": "trojan", "listen": "0.0.0.0", "listen_port": "20014",
      "security": "tls",
      "tls_certificate_path": "/etc/forkop/server-certs/grpc.crt",
      "tls_key_path": "/etc/forkop/server-certs/grpc.key",
      "transport": "grpc", "transport_service_name": "grpc",
      "routing_mode": "direct"
    },
    {
      ".name": "vless_http", ".type": "server", "enabled": "1", "label": "vless http",
      "protocol": "vless", "listen": "0.0.0.0", "listen_port": "20015",
      "security": "none", "transport": "http", "transport_path": "/h",
      "transport_hosts": [ "a.example.com", "b.example.com" ],
      "routing_mode": "direct"
    },
    {
      ".name": "vmess_upgrade", ".type": "server", "enabled": "1", "label": "vmess upgrade",
      "protocol": "vmess", "listen": "0.0.0.0", "listen_port": "20016",
      "security": "none", "transport": "httpupgrade", "transport_path": "/u",
      "transport_host": "example.com", "routing_mode": "direct"
    },
    {
      ".name": "ss_srv", ".type": "server", "enabled": "1", "label": "shadowsocks",
      "protocol": "shadowsocks", "listen": "0.0.0.0", "listen_port": "20005",
      "shadowsocks_method": "2022-blake3-aes-256-gcm",
      "shadowsocks_psk": "ZGVmYXVsdC1rZXktZm9yLXRlc3RzLTMyLWJ5dGVzIQ==",
      "multiplex_enabled": "1", "routing_mode": "direct"
    },
    {
      ".name": "hy2_srv", ".type": "server", "enabled": "1", "label": "hysteria2",
      "protocol": "hysteria2", "listen": "0.0.0.0", "listen_port": "20006",
      "security": "tls",
      "tls_certificate_path": "/etc/forkop/server-certs/hy2.crt",
      "tls_key_path": "/etc/forkop/server-certs/hy2.key",
      "hysteria2_up_mbps": "100", "hysteria2_down_mbps": "200",
      "hysteria2_obfs_type": "salamander",
      "hysteria2_obfs_password": "obfs-password",
      "hysteria2_ignore_client_bandwidth": "1",
      "hysteria2_masquerade": "https://example.com",
      "routing_mode": "direct"
    },
    {
      ".name": "tuic_srv", ".type": "server", "enabled": "1", "label": "tuic",
      "protocol": "tuic", "listen": "0.0.0.0", "listen_port": "20007",
      "security": "tls",
      "tls_certificate_path": "/etc/forkop/server-certs/tuic.crt",
      "tls_key_path": "/etc/forkop/server-certs/tuic.key",
      "tuic_congestion_control": "bbr", "tuic_heartbeat": "12s",
      "tuic_zero_rtt_handshake": "1", "routing_mode": "direct"
    },
    {
      ".name": "anytls_srv", ".type": "server", "enabled": "1", "label": "anytls",
      "protocol": "anytls", "listen": "0.0.0.0", "listen_port": "20008",
      "security": "tls",
      "tls_certificate_path": "/etc/forkop/server-certs/anytls.crt",
      "tls_key_path": "/etc/forkop/server-certs/anytls.key",
      "routing_mode": "direct"
    },
    {
      ".name": "naive_srv", ".type": "server", "enabled": "1", "label": "naive",
      "protocol": "naive", "listen": "0.0.0.0", "listen_port": "20009",
      "security": "tls",
      "tls_certificate_path": "/etc/forkop/server-certs/naive.crt",
      "tls_key_path": "/etc/forkop/server-certs/naive.key",
      "naive_network": "tcp_udp", "routing_mode": "direct"
    },
    {
      ".name": "ssh_srv", ".type": "server", "enabled": "1", "label": "ssh",
      "protocol": "ssh", "listen": "0.0.0.0", "listen_port": "20010",
      "ssh_host_key_path": "/etc/forkop/server-ssh/ssh.key",
      "routing_mode": "direct"
    },
    {
      ".name": "mieru_srv", ".type": "server", "enabled": "1", "label": "mieru",
      "protocol": "mieru", "listen": "0.0.0.0", "listen_port": "20011",
      "mieru_transport": "UDP", "routing_mode": "direct"
    },
    {
      ".name": "mtproto_srv", ".type": "server", "enabled": "1", "label": "mtproto",
      "protocol": "mtproto", "listen": "0.0.0.0", "listen_port": "20012",
      "mtproto_faketls": "google.com", "routing_mode": "direct"
    },
    {
      ".name": "tailscale_srv", ".type": "server", "enabled": "1", "label": "tailscale",
      "protocol": "tailscale", "tailscale_auth_key": "tskey-auth-contract",
      "tailscale_hostname": "forkop", "tailscale_control_url": "https://controlplane.tailscale.com",
      "tailscale_advertise_exit_node": "1", "tailscale_accept_routes": "1",
      "tailscale_ephemeral": "1", "tailscale_advertise_routes": [ "192.168.1.0/24" ],
      "routing_mode": "direct"
    }
  ],
  "server_client": [
    { ".name": "c_mixed", ".type": "server_client", "server": "mixed_srv", "name": "user", "password": "pass" },
    { ".name": "c_vless", ".type": "server_client", "server": "vless_srv", "name": "phone", "uuid": "11111111-1111-4111-8111-111111111111" },
    { ".name": "c_vless_http", ".type": "server_client", "server": "vless_http", "name": "phone", "uuid": "11111111-1111-4111-8111-111111111112", "flow": "xtls-rprx-vision" },
    { ".name": "c_vmess", ".type": "server_client", "server": "vmess_srv", "name": "phone", "uuid": "22222222-2222-4222-8222-222222222222" },
    { ".name": "c_vmess_up", ".type": "server_client", "server": "vmess_upgrade", "name": "phone", "uuid": "22222222-2222-4222-8222-222222222223" },
    { ".name": "c_trojan", ".type": "server_client", "server": "trojan_srv", "name": "phone", "password": "trojan-pass" },
    { ".name": "c_trojan_g", ".type": "server_client", "server": "trojan_grpc", "name": "phone", "password": "trojan-pass" },
    { ".name": "c_ss", ".type": "server_client", "server": "ss_srv", "name": "phone", "password": "ZGVmYXVsdC1rZXktZm9yLXRlc3RzLTMyLWJ5dGVzIQ==" },
    { ".name": "c_hy2", ".type": "server_client", "server": "hy2_srv", "name": "phone", "password": "hy2-pass" },
    { ".name": "c_tuic", ".type": "server_client", "server": "tuic_srv", "name": "phone", "uuid": "33333333-3333-4333-8333-333333333333", "password": "tuic-pass" },
    { ".name": "c_anytls", ".type": "server_client", "server": "anytls_srv", "name": "phone", "password": "anytls-pass" },
    { ".name": "c_naive", ".type": "server_client", "server": "naive_srv", "name": "phone", "password": "naive-pass" },
    { ".name": "c_ssh", ".type": "server_client", "server": "ssh_srv", "name": "phone", "password": "ssh-pass", "authorized_keys": [ "ssh-ed25519 AAAAC3Nz" ] },
    { ".name": "c_mieru", ".type": "server_client", "server": "mieru_srv", "name": "phone", "password": "mieru-pass" },
    { ".name": "c_mtproto", ".type": "server_client", "server": "mtproto_srv", "name": "phone", "secret": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  ]
}
JSON

mkdir -p "$WORK_DIR/generated.json.rulesets"
ucode -L "$FORKOP_LIB" "$GENERATOR" generate-config-fixture \
  "$WORK_DIR/servers.json" "$WORK_DIR/generated.json" "127.0.0.1" "0" ||
  fail "the generator refused the contract fixture"

[ -s "$WORK_DIR/generated.json" ] || fail "the generator produced no configuration"

node - "$WORK_DIR/generated.json" "$SCHEMA_SNAPSHOT" "$SERVER_JS" <<'NODE'
const fs = require("fs");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const schema = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const serverSource = fs.readFileSync(process.argv[4], "utf8");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// Keys Forkop adds for its own bookkeeping and strips before the file is written,
// plus the tag every inbound carries.
const OWN_KEYS = new Set(["type", "tag"]);

function walk(node, allowed, trail, type) {
  for (const [key, value] of Object.entries(node)) {
    if (trail.length === 0 && OWN_KEYS.has(key)) continue;
    const path = [...trail, key].join(".");
    const permitted = allowed && allowed[key];
    if (!permitted) {
      fail(`${type} inbound writes ${path}, which sing-box has no option for`);
    }
    if (permitted === true) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") walk(item, permitted, [...trail, key], type);
      }
      continue;
    }
    if (value && typeof value === "object") walk(value, permitted, [...trail, key], type);
  }
}

const listeners = [
  ...(config.inbounds || []).filter((item) => schema[item.type]),
  ...(config.endpoints || []).filter((item) => schema[item.type]),
];

// Every protocol the tab serves has to be represented, or the check would pass by
// simply not generating anything.
const expectedTypes = [
  "mixed", "vless", "vmess", "trojan", "shadowsocks", "hysteria2",
  "tuic", "anytls", "naive", "ssh", "mieru", "mtproxy", "tailscale",
];
const seen = new Set(listeners.map((item) => item.type));
for (const type of expectedTypes) {
  if (!seen.has(type)) fail(`the contract fixture produced no ${type} listener`);
}

for (const listener of listeners) {
  walk(listener, schema[listener.type], [], listener.type);
}

// Users are a list of objects, so their keys are checked against the user struct of
// the protocol rather than the inbound itself.
const USER_KEYS = {
  mixed: ["username", "password"],
  naive: ["username", "password"],
  vless: ["name", "uuid", "flow"],
  vmess: ["name", "uuid", "alterId"],
  trojan: ["name", "password"],
  shadowsocks: ["name", "password"],
  hysteria2: ["name", "password"],
  tuic: ["name", "uuid", "password"],
  anytls: ["name", "password"],
  ssh: ["name", "password", "authorized_keys"],
  mieru: ["name", "password"],
  mtproxy: ["name", "secret"],
};
for (const listener of listeners) {
  const allowed = USER_KEYS[listener.type];
  if (!allowed) continue;
  for (const user of listener.users || []) {
    for (const key of Object.keys(user)) {
      if (!allowed.includes(key)) {
        fail(`${listener.type} user carries ${key}, which its user struct has no field for`);
      }
    }
  }
}

// The UCI options the dialog offers. A field that disappears from the form without
// this list changing is a silently dropped setting; a field added without a decision
// shows up here as an unexpected name.
const FORM_OPTIONS = [
  "_protocol_display", "authorized_keys", "client_fingerprint", "clients",
  "enabled", "flow", "hysteria2_down_mbps", "hysteria2_ignore_client_bandwidth",
  "hysteria2_masquerade", "hysteria2_obfs_password", "hysteria2_obfs_type",
  "hysteria2_up_mbps", "inbound_json", "label", "listen", "listen_port",
  "mieru_transport", "mixed_auth_enabled", "mtproto_faketls", "multiplex_enabled",
  "multiplex_padding", "naive_network", "name", "open_firewall", "protocol",
  "public_host", "reality_handshake_server", "reality_handshake_server_port",
  "reality_private_key", "reality_public_key", "reality_short_id",
  "routing_mode", "routing_override", "routing_section", "security",
  "shadowsocks_method", "shadowsocks_psk", "ssh_host_key_path",
  "tailscale_accept_routes", "tailscale_advertise_exit_node",
  "tailscale_advertise_routes", "tailscale_auth_key", "tailscale_control_url",
  "tailscale_detour_enabled", "tailscale_detour_section", "tailscale_ephemeral",
  "tailscale_hostname", "tcp_fast_open", "tls_alpn", "tls_certificate_path",
  "tls_key_path", "tls_server_name", "transport", "transport_host",
  "transport_hosts", "transport_path", "transport_service_name",
  "transport_xhttp_mode", "tuic_congestion_control", "tuic_heartbeat",
  "tuic_zero_rtt_handshake",
];
const declared = new Set(
  [...serverSource.matchAll(/\.option\(\s*(?:form|sectionui)\.[A-Za-z]+\s*,\s*"([a-z0-9_]+)"/g)]
    .map((match) => match[1]),
);
const missing = FORM_OPTIONS.filter((name) => !declared.has(name));
const extra = [...declared].filter((name) => !FORM_OPTIONS.includes(name));
if (missing.length) fail(`the dialog stopped asking for: ${missing.join(", ")}`);
if (extra.length) fail(`the dialog asks for options this contract does not list: ${extra.join(", ")}`);
NODE

# With a core checkout the snapshot is rebuilt, which is what notices an option the
# core renamed, removed or added under a different name.
if [ -d "$CORE_OPTION_DIR" ]; then
  node - "$SCHEMA_HELPER" "$CORE_OPTION_DIR" "$SCHEMA_SNAPSHOT" <<'NODE'
const fs = require("fs");
const { buildSchema } = require(process.argv[2]);

function sortKeys(value) {
  if (value === true) return true;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
  return out;
}

const rebuilt = JSON.stringify(sortKeys(buildSchema(process.argv[3])), null, 2) + "\n";
const stored = fs.readFileSync(process.argv[4], "utf8");
if (rebuilt !== stored) {
  console.error("FAIL: the sing-box inbound option snapshot no longer matches the core");
  console.error("Regenerate it with:");
  console.error(
    "  node -e 'const fs=require(\"fs\");const{buildSchema}=require(\"./tests/helpers/singbox_option_schema.js\");" +
      "const s=(v)=>v===true?true:Object.fromEntries(Object.keys(v).sort().map((k)=>[k,s(v[k])]));" +
      "fs.writeFileSync(\"tests/data/singbox_inbound_options.json\",JSON.stringify(s(buildSchema(\"sandbox/sing-box-forkop/option\")),null,2)+\"\\n\")'",
  );
  process.exit(1);
}
NODE
else
  printf 'note: %s is absent, the core snapshot was not rebuilt\n' "$CORE_OPTION_DIR"
fi

printf 'server option contract checks passed\n'
