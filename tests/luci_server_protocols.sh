#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/server.js"
FORKOP_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/forkop.js"
FE_SRC="$ROOT_DIR/fe-app-forkop/src"

node - "$SERVER_JS" "$FORKOP_JS" <<'NODE'
const fs = require("fs");
const assert = require("assert");
const source = fs.readFileSync(process.argv[2], "utf8");
const entrySource = fs.readFileSync(process.argv[3], "utf8");

function requireSource(needle) {
  if (!source.includes(needle)) {
    console.error(`FAIL: missing server UI contract: ${needle}`);
    process.exit(1);
  }
}

for (const protocol of ["naive", "ssh", "mieru", "anytls", "tuic"]) {
  requireSource(`${protocol}:`);
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

for (const protocol of ["naive", "anytls", "tuic"]) {
  requireSource(`${protocol}: ["tls"]`);
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

if (source.indexOf('tailscale: "Tailscale"') > source.indexOf('json_inbound: "JSON Inbound"')) {
  console.error('FAIL: Tailscale must be the penultimate protocol and JSON Inbound the last');
  process.exit(1);
}
if (source.includes('"tailscale_advertise_exit_node"')) {
  console.error('FAIL: Tailscale exit-node advertising must be fixed in the generator, not exposed in UI');
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
  'JSON_INBOUND_TYPES.has(parsed.type.trim())',
  '_("Unsupported JSON inbound type")',
]) {
  requireSource(needle);
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
