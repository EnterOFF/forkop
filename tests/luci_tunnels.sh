#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$(node "$ROOT_DIR/tests/helpers/tab_source.js" sections)"
MAIN_TS="$ROOT_DIR/fe-app-forkop/src/main.ts"
CONNECTIONS_UC="$ROOT_DIR/forkop/files/usr/lib/config/connections.uc"

node - "$SECTION_JS" "$MAIN_TS" "$CONNECTIONS_UC" "$ROOT_DIR" <<'NODE'
const fs = require('fs');
const section = fs.readFileSync(process.argv[2], 'utf8');
const main = fs.readFileSync(process.argv[3], 'utf8');
const connections = fs.readFileSync(process.argv[4], 'utf8');
const { readFunction, readNameList } = require(
  `${process.argv[5]}/tests/helpers/source_literal.js`,
);

function requireSource(source, needle) {
  if (!source.includes(needle)) {
    console.error(`FAIL: missing native tunnel UI contract: ${needle}`);
    process.exit(1);
  }
}

for (const needle of [
  "'tunnels'",
  "_('+ Add tunnel')",
  "typeOption.value('wireguard', 'WireGuard')",
  "typeOption.value('amneziawg', 'AmneziaWG')",
  "typeOption.value('warp', 'Cloudflare WARP')",
  "typeOption.value('tailscale', 'Tailscale')",
  "typeOption.value('json', 'JSON endpoint')",
  "_('Tunnel settings')",
  "_('Import configuration')",
  "importButton.depends('tunnel_type', 'wireguard')",
  "importButton.depends('tunnel_type', 'amneziawg')",
  'parseWireGuardInput || parseWireGuardConfig',
  "ButtonAddSettingsDynamicList,\n    'peer_ids',",
  "typeName: 'tunnel_peer'",
  "o.childType = 'tunnel'",
  "_('+ Add peer')",
  'showWireGuardPeerSettingsModal',
  'wireGuardPeerFromSettings',
  'endpoint.amnezia = tunnelAmneziaSettings(settings)',
  "isExistingChildItem(sectionId, tunnelId, 'tunnel', 'section')",
  'const ONE_SIDED_AMNEZIA_FIELDS = [',
  "'content_padding_addition'",
  "_('Header protection key')",
  "_('Additional packet padding')",
  "_('Rekey interval')",
  "_('Rekey timeout')",
  "_('Data rejection timeout')",
  "_('Keepalive timeout')",
  "_('Maximum handshake attempts')",
  "_('Traffic obfuscation')",
  'Masks traffic with the Amnezia mechanism to make it harder to identify',
  "'warp_junk_enabled'",
  'option.retain = true;',
  'if (ONE_SIDED_AMNEZIA_FIELDS.includes(key)) {',
  "option.depends({ tunnel_type: 'warp', warp_junk_enabled: '1' });",
  "'wireguard_junk_enabled'",
  "wireguardJunkOption.depends('tunnel_type', 'wireguard');",
  "setModalOptionValue(map, wireguardJunkOption, '1');",
  'const ONE_SIDED_AMNEZIA_DEFAULTS = {',
  'function fillOneSidedAmneziaDefaults(map, amneziaOptions) {',
  'fillOneSidedAmneziaDefaults(map, amneziaOptions);',
  "let previousTunnelType = `${data.settings.tunnel_type || 'wireguard'}`;",
  "if (previousTunnelType === 'amneziawg') {",
  "setModalOptionValue(map, warpJunkOption, '1');",
  'parseWireGuardConfig',
  'endpoint.profile = profile',
  "['generate_warp_profile']",
  "_('Generate profile')",
  'setModalOptionValue(map, warpProfileIdOption, profile.id)',
  'setModalOptionValue(map, warpAuthTokenOption, profile.auth_token)',
  'setModalOptionValue(map, warpPrivateKeyOption, profile.private_key)',
  'profile.license_key = `${settings.warp_license_key}`.trim()',
  "_('License key')",
  'Applies WARP+ to the profile account',
  'warpLicenseKeyOption.password = true',
  'warpLicenseKeyOption.rmempty = true',
  'element.triggerValidation();',
  'map.checkDepends();',
  'profileValues.length !== 3',
  'warpProfileIdOption.rmempty = false',
  'warpAuthTokenOption.rmempty = false',
  'warpPrivateKeyOption.rmempty = false',
  "typeof peer.port !== 'number'",
  'const WIREGUARD_PEER_FIELDS = new Set(wireGuardPeerSettingsKeys())',
  'function validateWireGuardListInput(value)',
  "return `${value || ''}`.trim() ? validateWireGuardPrefix(value) : true;",
  'validateWireGuardPrefix(allowedIp)',
  "_('WireGuard peer contains unsupported fields')",
  "_('Forkop Error')",
  'Failed to generate WARP profile.',
  "'tailscale_auth_key'",
  "'tailscale_hostname'",
  "'tailscale_control_url'",
  "'tailscale_exit_node'",
  "'tailscale_detour_enabled'",
  "'tailscale_detour_section'",
  "_('Coordination server through a section')",
  'getOutboundTagBySection',
  'exit_node_allow_lan_access: true',
  "_('Enter a Tailscale exit node')",
  "'endpoint_json'",
  "_('JSON endpoint must contain a non-empty type')",
  "_('JSON endpoint must contain a non-empty tag')",
  'const JSON_ENDPOINT_TYPES = new Set([',
  'JSON_ENDPOINT_TYPES.has(endpoint.type.trim())',
  "_('Unsupported JSON endpoint type')",
  'this.formvalue(_itemId)',
  "_('Add at least one WireGuard peer')",
  'WireGuard, AmneziaWG, Cloudflare WARP, Tailscale and JSON endpoint are available',
  "_('Tunnel name')",
  "['wireguard', 'amneziawg', 'warp', 'tailscale']",
  'Registers a device and fills the fields below',
  '{ singleField: true }',
  "mtuOption.placeholder = '1408'",
  'endpointJsonOption.placeholder = JSON_ENDPOINT_PLACEHOLDER',
  'Required. Remote nodes to connect to',
  'Auth Key from the Tailscale admin console',
  'The name this device appears under in the Tailscale console',
  'Accept subnets advertised by other devices in your Tailscale network',
]) {
  requireSource(section, needle);
}

const warpFields = readNameList(section, 'ONE_SIDED_AMNEZIA_FIELDS');
for (const key of [
  'jc', 'jmin', 'jmax',
  'i1', 'i2', 'i3', 'i4', 'i5',
  'content_padding_addition',
  'rekey_after_time', 'rekey_timeout', 'reject_after_time',
  'keepalive_timeout', 'max_handshake_attempts',
]) {
  if (!warpFields.includes(key)) {
    console.error(`FAIL: WARP Amnezia field is missing: ${key}`);
    process.exit(1);
  }
}
for (const key of [
  's1', 's2', 's3', 's4',
  'h1', 'h2', 'h3', 'h4',
  'header_protection_key',
]) {
  if (warpFields.includes(key)) {
    console.error(`FAIL: incompatible WARP Amnezia field remains: ${key}`);
    process.exit(1);
  }
}

if ((section.match(/validateWireGuardListInput\(value\)/g) || []).length !== 3) {
  console.error('FAIL: WireGuard DynamicList inputs must tolerate their empty add field');
  process.exit(1);
}

const amneziaFields = readNameList(section, 'AMNEZIA_FIELDS');
let previousAmneziaField = -1;
for (const key of [
  'jc', 'jmin', 'jmax',
  's1', 's2', 's3', 's4',
  'h1', 'h2', 'h3', 'h4',
  'i1', 'i2', 'i3', 'i4', 'i5',
  'header_protection_key',
  'content_padding_addition',
  'rekey_after_time', 'rekey_timeout', 'reject_after_time',
  'keepalive_timeout', 'max_handshake_attempts',
]) {
  const fieldIndex = amneziaFields.indexOf(key);
  if (fieldIndex <= previousAmneziaField) {
    console.error(`FAIL: AmneziaWG field order is incorrect at ${key}`);
    process.exit(1);
  }
  previousAmneziaField = fieldIndex;
}

// AMNEZIA_FIELDS is the order the dialog shows; the four lists beside it say how
// each value is read. A field added to one and not the other is invisible until
// somebody notices a parameter the dialog never asks for, or asks for twice.
// AMNEZIA_STRING_FIELDS is the signature fields plus the one key below, so the
// literal lists are what there is to read.
const classifiedAmneziaFields = [
  'AMNEZIA_COUNT_FIELDS',
  'AMNEZIA_PADDING_FIELDS',
  'AMNEZIA_RANGE_FIELDS',
  'AMNEZIA_SIGNATURE_FIELDS',
]
  .flatMap((name) => readNameList(section, name))
  .concat('header_protection_key');
const orderedAmneziaFields = readNameList(section, 'AMNEZIA_FIELDS');
if (
  [...classifiedAmneziaFields].sort().join() !==
  [...orderedAmneziaFields].sort().join()
) {
  console.error('FAIL: every AmneziaWG field must be classified exactly once');
  process.exit(1);
}

if (section.includes('_("WireGuard or AmneziaWG configuration")')) {
  console.error('FAIL: tunnel settings must not embed the old import textarea');
  process.exit(1);
}

if (section.includes('`${_("WARP profile generation failed")}: ${reason}`')) {
  console.error('FAIL: WARP errors must not render arbitrary backend stderr');
  process.exit(1);
}

if (section.includes('Object.values(amneziaOptions).forEach((option) =>')) {
  console.error('FAIL: switching to WARP must preserve AmneziaWG parameters');
  process.exit(1);
}

const tunnelStorage = readFunction(section, 'tunnelStorageSettings');
if (
  tunnelStorage.includes('warp_junk_enabled:') ||
  tunnelStorage.includes('wireguard_junk_enabled:') ||
  !tunnelStorage.includes('const storedAmneziaFields =') ||
  !tunnelStorage.includes('oneSidedAmneziaEnabled(kind, settings)') ||
  !tunnelStorage.includes('result[`amnezia_${key}`] = storedAmneziaFields.includes(key)')
) {
  console.error('FAIL: the LuCI-only traffic obfuscation toggle must not be stored in UCI');
  process.exit(1);
}

const endpointBuilder = readFunction(section, 'tunnelEndpointFromSettings');
if (
  !endpointBuilder.includes('type: kind,') ||
  !endpointBuilder.includes('} else if (oneSidedAmneziaEnabled(kind, settings)) {')
) {
  console.error('FAIL: a tunnel endpoint must carry its own type and only the parameters its peer accepts');
  process.exit(1);
}

const importApply = readFunction(section, 'applyImportedTunnelEndpoint');
if (
  !importApply.includes('!ONE_SIDED_AMNEZIA_FIELDS.includes(key)') ||
  !importApply.includes("twoSided ? 'amneziawg' : 'wireguard'") ||
  !importApply.includes('fields.wireguardJunk')
) {
  console.error('FAIL: import must pick AmneziaWG only for parameters the peer has to match');
  process.exit(1);
}

const applySettings = readFunction(section, 'applyChildItemSettings');
if (
  !applySettings.includes('if (values.length) {') ||
  (applySettings.match(/uci\.unset\(FORKOP_UCI_PACKAGE, itemId, key\)/g) || [])
    .length !== 2
) {
  console.error('FAIL: empty child list settings must be removed instead of passed to uci.set');
  process.exit(1);
}

const warpEndpoint = endpointBuilder.slice(
  endpointBuilder.indexOf("if (kind === 'warp')"),
  endpointBuilder.indexOf('const peers ='),
);
if (
  !warpEndpoint.includes('const amnezia = tunnelAmneziaSettings(settings, ONE_SIDED_AMNEZIA_FIELDS);') ||
  !warpEndpoint.includes('oneSidedAmneziaEnabled(kind, settings)')
) {
  console.error('FAIL: WARP must apply Amnezia parameters only when traffic obfuscation is enabled');
  process.exit(1);
}

const defaults = readNameList(section, 'ONE_SIDED_AMNEZIA_DEFAULTS');
for (const key of [
  'jc', 'jmin', 'jmax', 'i1',
  'content_padding_addition',
  'rekey_after_time', 'rekey_timeout', 'reject_after_time',
  'keepalive_timeout', 'max_handshake_attempts',
]) {
  if (!defaults.includes(key)) {
    console.error(`FAIL: obfuscation default is missing: ${key}`);
    process.exit(1);
  }
}
for (const key of ['s1', 's2', 's3', 's4', 'h1', 'h2', 'h3', 'h4', 'header_protection_key']) {
  if (defaults.includes(key)) {
    console.error(`FAIL: a parameter the peer has to match must not be filled in: ${key}`);
    process.exit(1);
  }
}
const fill = readFunction(section, 'fillOneSidedAmneziaDefaults');
if (!fill.includes('if (!current) {')) {
  console.error('FAIL: filling the defaults must not overwrite an existing value');
  process.exit(1);
}
// Both obfuscation toggles fill the defaults when they are switched on, and only
// then: filling on the way off would write parameters the endpoint has stopped
// carrying, and never filling leaves the toggle doing nothing at all.
const fillOnEnable =
  section.match(
    /if \(value === '1'\) \{\s*fillOneSidedAmneziaDefaults\(/g,
  ) || [];
if (fillOnEnable.length !== 2) {
  console.error('FAIL: asking for traffic obfuscation must fill the one-sided defaults');
  process.exit(1);
}

for (const forbidden of [
  'AmneziaWG / WireGuard',
  '"amnezia_enabled"',
  '"peers_json"',
  'WARP profile generated',
  'Try again or check the Forkop log.',
  'does not support WARP profile generation',
  'WARP profile generation failed with HTTP',
  'did not return a WARP profile',
  'Numeric AmneziaWG obfuscation parameter from the client profile.',
  'AmneziaWG packet header size or range from the client profile.',
  'AmneziaWG packet header template from the client profile.',
  'Fill all WARP profile fields or leave all of them empty',
  'Choose WireGuard, AmneziaWG, or Cloudflare WARP.',
  'Add one or more WireGuard peers and configure each one separately.',
  'placeholder = "30"',
  'placeholder = "100 or 100-200"',
  'Junk packet obfuscation',
  'Traffic masking',
  'Adds AmneziaWG traffic obfuscation to make the traffic harder to identify.',
  'Leave empty to use the core default.',
  'Leave empty to let sing-box choose it.',
  '"tailscale_exit_node_allow_lan_access"',
  'Allow LAN access through exit node',
  '"j1"',
  '"j2"',
  '"j3"',
  '"itime"',
]) {
  if (section.includes(forbidden)) {
    console.error(`FAIL: obsolete tunnel UI remains: ${forbidden}`);
    process.exit(1);
  }
}

const tunnelModal = readFunction(section, 'showTunnelSettingsModal');
const nameIndex = tunnelModal.indexOf("_('Tunnel name')");
const importIndex = tunnelModal.indexOf("'_import_config'");
const generateIndex = tunnelModal.indexOf("'_generate_warp_profile'");
const typeIndex = tunnelModal.indexOf("_('Tunnel type')");
if (
  [nameIndex, importIndex, generateIndex, typeIndex].includes(-1) ||
  !(typeIndex < nameIndex && nameIndex < importIndex && nameIndex < generateIndex)
) {
  console.error('FAIL: tunnel type must be first, followed by name and actions');
  process.exit(1);
}
if (!section.includes("['wireguard', 'amneziawg', 'warp', 'tailscale']")) {
  console.error('FAIL: tunnel name must remain visible for non-JSON tunnel types');
  process.exit(1);
}

if (!section.includes("if (!`${value || ''}`.trim()) {\n      return true;")) {
  console.error('FAIL: an empty tunnel list must remain valid');
  process.exit(1);
}

if (
  !section.includes("parseWireGuardConfig") ||
  !section.includes("parseWireGuardInput")
) {
  console.error('FAIL: the tunnel dialog must use the WireGuard and vpn:// import parsers');
  process.exit(1);
}

const warpGeneratorStart = connections.indexOf('if (kind == "warp")');
const warpGeneratorEnd = connections.indexOf('    endpoint.address', warpGeneratorStart);
const warpGenerator = connections.slice(warpGeneratorStart, warpGeneratorEnd);
if (
  !connections.includes('const ONE_SIDED_AMNEZIA_KEYS = [') ||
  !warpGenerator.includes('for (let key in ONE_SIDED_AMNEZIA_KEYS)') ||
  warpGenerator.includes('for (let key in AMNEZIA_KEYS)')
) {
  console.error('FAIL: backend WARP generation must use the compatible Amnezia field whitelist');
  process.exit(1);
}

const sectionForm = readFunction(section, 'createSectionContent');
const tunnelIndex = sectionForm.indexOf("'tunnels'");
const jsonIndex = sectionForm.indexOf("'outbound_jsons'");
if (tunnelIndex < 0 || jsonIndex < 0 || tunnelIndex >= jsonIndex) {
  console.error('FAIL: native tunnel control must appear before JSON outbound');
  process.exit(1);
}
NODE

for toggle in warp_junk_enabled wireguard_junk_enabled; do
  if grep -Fq "$toggle" "$ROOT_DIR/forkop/files/usr/lib/config/connections.uc"; then
    printf 'FAIL: LuCI-only traffic obfuscation toggle reached the UCI generator\n' >&2
    exit 1
  fi
done

printf 'LuCI native tunnel checks passed\n'
