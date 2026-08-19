#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIEW_DIR="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop"
SERVER_JS="$VIEW_DIR/server.js"
FORKOP_JS="$VIEW_DIR/forkop.js"
FE_SRC="$ROOT_DIR/fe-app-forkop/src"

node - "$SERVER_JS" "$FORKOP_JS" "$VIEW_DIR" <<'NODE'
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const source = fs.readFileSync(process.argv[2], "utf8");
const entrySource = fs.readFileSync(process.argv[3], "utf8");
const viewDir = process.argv[4];
const read = (name) => fs.readFileSync(path.join(viewDir, name), "utf8");
const specSource = read("server_spec.js");
const clientsSource = read("server_clients.js");
const linkSource = read("server_link.js");
const validateSource = read("server_validate.js");
const serverModules = source + specSource + clientsSource + linkSource + validateSource;

function requireSource(needle) {
  if (!source.includes(needle)) {
    console.error(`FAIL: missing server UI contract: ${needle}`);
    process.exit(1);
  }
}

function requireModules(needle) {
  if (!serverModules.includes(needle)) {
    console.error(`FAIL: missing server contract: ${needle}`);
    process.exit(1);
  }
}

// Every protocol the form offers has to be described in the spec table, and every
// protocol with its own options has to reach them through depends().
for (const protocol of ["naive", "ssh", "mieru", "anytls", "tuic", "mixed", "shadowsocks", "mtproto", "tailscale", "vless", "vmess", "trojan", "hysteria2", "json_inbound"]) {
  requireModules(`id: "${protocol}"`);
}
for (const protocol of ["naive", "ssh", "mieru", "tuic", "mixed", "shadowsocks", "mtproto", "tailscale", "hysteria2", "json_inbound"]) {
  requireSource(`depends("protocol", "${protocol}")`);
}

for (const option of [
  "naive_network",
  "ssh_host_key_path",
  "mieru_transport",
  "tuic_congestion_control",
  "tuic_zero_rtt_handshake",
]) {
  requireSource(`"${option}"`);
}

// A protocol that cannot run without TLS must not offer any other security mode.
for (const [protocol, securities] of [
  ["naive", '["tls"]'],
  ["anytls", '["tls"]'],
  ["tuic", '["tls"]'],
  ["hysteria2", '["tls"]'],
  ["vless", '["reality", "tls", "none"]'],
  ["mixed", '["none"]'],
  ["shadowsocks", '["none"]'],
]) {
  const block = specSource.slice(specSource.indexOf(`id: "${protocol}"`));
  const securityLine = block.slice(0, block.indexOf("credentials:"));
  if (!securityLine.includes(`securities: ${securities}`)) {
    console.error(`FAIL: ${protocol} must offer exactly ${securities}`);
    process.exit(1);
  }
}

requireSource('option.depends("protocol", "tailscale")');
for (const needle of [
  '"tailscale_detour_enabled"',
  '"tailscale_detour_section"',
  '_("Control plane through section")',
  'Auth Key from the Tailscale admin console',
  'Name shown in the Tailscale admin console.',
  'Accept subnets advertised by other devices in your Tailscale network.',
  'Specify local subnets to give other devices in your Tailscale network access to them.',
]) {
  requireSource(needle);
}

// Tailscale needs neither a public address nor a forwarded port, so it stays the
// first choice, and the raw JSON inbound stays the last.
const protocolOrder = [...specSource.matchAll(/^\s*id: \"([A-Za-z0-9_]+)\"/gm)].map((match) => match[1]);
if (protocolOrder[0] !== "tailscale" || protocolOrder.at(-1) !== "json_inbound") {
  console.error(`FAIL: unexpected protocol order: ${protocolOrder.join(", ")}`);
  process.exit(1);
}
if (protocolOrder.includes("socks")) {
  console.error('FAIL: the SOCKS inbound was replaced by the mixed inbound');
  process.exit(1);
}

for (const legacy of [
  "singBoxExtended",
  "singBoxTiny",
  "singBoxTailscale",
  "normalizeServerCapabilities",
  "getDefaultProtocolForCapabilities",
  "applyServerCapabilities",
  "getServerCapabilities",
  "EXTENDED_PORT_PROTOCOLS",
  "mtproto_padding",
]) {
  if (source.includes(legacy) || entrySource.includes(legacy)) {
    console.error(`FAIL: legacy sing-box capability branch remains: ${legacy}`);
    process.exit(1);
  }
}

for (const needle of [
  'const JSON_INBOUND_TYPES = new Set([',
  '!JSON_INBOUND_TYPES.has(type)',
  '_("Unsupported JSON inbound type")',
  // Forkop overwrites the tag with the server name, so a pasted tag is refused
  // instead of being dropped without a word.
  'Remove the tag field',
]) {
  requireModules(needle);
}

// Every protocol that carries accounts must reach them through client sections, and
// the credentials must live there instead of on the server.
for (const needle of [
  'const CLIENT_TYPE = "server_client"',
  'uci.set(UCI_PACKAGE, clientId, "server", sectionId)',
  'function syncClients(sectionId)',
  'xtls-rprx-vision',
]) {
  requireModules(needle);
}
for (const removed of ['"server_uuid"', '"server_password"', '"server_username"', '"socks_auth_enabled"', '"vmess_alter_id"']) {
  if (serverModules.includes(removed)) {
    console.error(`FAIL: credentials belong to client sections now: ${removed}`);
    process.exit(1);
  }
}

// Secrets must use the LuCI password widget, which hides the value and offers the
// reveal control the rest of the app already uses.
const optionBlocks = source
  .split("section.option(")
  .slice(1)
  .map((block) => {
    const name = block.match(/"([a-z0-9_]+)"/);
    return { name: name ? name[1] : "", body: block };
  });

function optionBlock(name) {
  const block = optionBlocks.find((entry) => entry.name === name);
  if (!block) {
    console.error(`FAIL: option is absent from the server form: ${name}`);
    process.exit(1);
  }
  return block.body;
}

for (const secret of ["tailscale_auth_key", "reality_private_key", "hysteria2_obfs_password", "shadowsocks_psk"]) {
  if (!optionBlock(secret).includes("o.password = true")) {
    console.error(`FAIL: ${secret} must be rendered as a password field`);
    process.exit(1);
  }
}

// A short ID is decoded as hex bytes, so an odd digit count stops the service.
for (const needle of [
  'Reality short ID must use an even number of hex digits',
  'Reality short ID must not exceed 16 hex digits',
  'function validateListenPort',
  'Port %s is already used by %s',
]) {
  requireModules(needle);
}

for (const needle of [
  'sectionRef.map.data.createSID(configName)',
  'sectionRef.map.data.set(configName, sectionId, "label", label)',
  'sectionRef.addLabeledSection = function ()',
  'this.addLabeledSection()',
  'click: ui.createHandlerFn(sectionRef, "handleAdd")',
  'return this.renderMoreOptionsModal(sectionId)',
]) {
  if (!entrySource.includes(needle)) {
    console.error(`FAIL: labeled section creation contract is missing: ${needle}`);
    process.exit(1);
  }
}

if (entrySource.includes('cbi-section-create-name')) {
  console.error('FAIL: section tables must not require a name before adding');
  process.exit(1);
}

const addSectionHelper = entrySource.match(
  /function addLabeledSection\([\s\S]*?\n}\n\nfunction getRuleEditButtonText\(/,
);
assert(addSectionHelper, 'labeled section helper not found');
eval(addSectionHelper[0].slice(0, -'\n\nfunction getRuleEditButtonText('.length));

for (const [sectiontype, expectedLabel] of [
  ['section', 'Section #3'],
  ['server', 'Server #3'],
]) {
  let savedLabel = null;
  const sectionRef = {
    sectiontype,
    cfgsections: () => ['active-1', 'active-2'],
    map: {
      config: 'forkop',
      data: {
        createSID: () => 'cfg-new',
        add: () => 'cfg-new',
        set: (_config, _sectionId, _option, value) => { savedLabel = value; },
      },
    },
  };

  assert.strictEqual(addLabeledSection(sectionRef), 'cfg-new');
  assert.strictEqual(savedLabel, expectedLabel);
}

requireSource('const sectionId = this.addLabeledSection()');
NODE

if grep -R -n -E 'singBoxVariant|sing_box_(extended|tiny|tailscale)|GET_SERVER_CAPABILITIES|GetServerCapabilities|Install another build|startsWith\(.install_' \
  "$FE_SRC" >/dev/null 2>&1; then
  printf 'FAIL: frontend still contains legacy sing-box variant code\n' >&2
  exit 1
fi

printf 'LuCI native server protocol checks passed\n'
