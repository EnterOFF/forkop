#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js"
MAIN_TS="$ROOT_DIR/fe-app-forkop/src/main.ts"

node - "$SECTION_JS" "$MAIN_TS" <<'NODE'
const fs = require('fs');
const section = fs.readFileSync(process.argv[2], 'utf8');
const main = fs.readFileSync(process.argv[3], 'utf8');

function requireSource(source, needle) {
  if (!source.includes(needle)) {
    console.error(`FAIL: missing native tunnel UI contract: ${needle}`);
    process.exit(1);
  }
}

for (const needle of [
  '"tunnels"',
  '_("+ Add tunnel")',
  'typeOption.value("wireguard", "WireGuard")',
  'typeOption.value("amneziawg", "AmneziaWG")',
  'typeOption.value("warp", "Cloudflare WARP")',
  'typeOption.value("tailscale", "Tailscale")',
  'typeOption.value("json", "JSON endpoint")',
  '_("Tunnel settings")',
  '_("Import configuration")',
  'importButton.depends("tunnel_type", "wireguard")',
  'importButton.depends("tunnel_type", "amneziawg")',
  'main.parseWireGuardInput || main.parseWireGuardConfig',
  'ButtonAddSettingsDynamicList,\n    "peer_ids"',
  'typeName: "tunnel_peer"',
  'o.childType = "tunnel"',
  '_("+ Add peer")',
  'showWireGuardPeerSettingsModal',
  'wireGuardPeerFromSettings',
  'endpoint.amnezia = tunnelAmneziaSettings(settings)',
  'const WARP_JUNK_FIELDS = [',
  '"jc", "jmin", "jmax", "i1", "i2", "i3", "i4", "i5"',
  '_("Traffic masking")',
  '"warp_junk_enabled"',
  'main.parseWireGuardConfig',
  'endpoint.profile = profile',
  '["generate_warp_profile"]',
  '_("Generate profile")',
  'setModalOptionValue(map, warpProfileIdOption, profile.id)',
  'setModalOptionValue(map, warpAuthTokenOption, profile.auth_token)',
  'setModalOptionValue(map, warpPrivateKeyOption, profile.private_key)',
  'element.triggerValidation();',
  'map.checkDepends();',
  'profileValues.length !== 3',
  'warpProfileIdOption.rmempty = false',
  'warpAuthTokenOption.rmempty = false',
  'warpPrivateKeyOption.rmempty = false',
  'typeof peer.port !== "number"',
  'const WIREGUARD_PEER_FIELDS = new Set([',
  'function validateWireGuardListInput(value)',
  'return `${value || ""}`.trim() ? validateWireGuardPrefix(value) : true;',
  'validateWireGuardPrefix(allowedIp)',
  '_("WireGuard peer contains unsupported fields")',
  '_("Forkop Error")',
  'Failed to generate WARP profile.',
  '"tailscale_auth_key"',
  '"tailscale_hostname"',
  '"tailscale_control_url"',
  '"tailscale_exit_node"',
  '"tailscale_detour_enabled"',
  '"tailscale_detour_section"',
  '_("Control plane through section")',
  'main.getOutboundTagBySection',
  'exit_node_allow_lan_access: true',
  '_("Enter a Tailscale exit node")',
  '"endpoint_json"',
  '_("JSON endpoint must contain a non-empty type")',
  '_("JSON endpoint must contain a non-empty tag")',
  'this.formvalue(_itemId)',
  '_("Add at least one WireGuard peer")',
  '_("WireGuard, AmneziaWG 2.0, Cloudflare WARP, and Tailscale tunnels")',
  '_("Name displayed on the dashboard")',
  '["wireguard", "amneziawg", "warp", "tailscale"]',
  'Automatically register a device and fill the required fields.',
  'Paste a WireGuard or AmneziaWG configuration or a link in vpn:// format.',
  'Leave empty to use the default value.',
  'List of remote WireGuard nodes to connect.',
  'Auth Key from the Tailscale admin console',
  'Name shown in the Tailscale admin console.',
  'Accept subnets advertised by other devices in your Tailscale network.',
]) {
  requireSource(section, needle);
}

if ((section.match(/validateWireGuardListInput\(value\)/g) || []).length !== 3) {
  console.error('FAIL: WireGuard DynamicList inputs must tolerate their empty add field');
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
  'Leave empty to use the core default.',
  'Leave empty to let sing-box choose it.',
  '"tailscale_exit_node_allow_lan_access"',
  'Allow LAN access through exit node',
]) {
  if (section.includes(forbidden)) {
    console.error(`FAIL: obsolete tunnel UI remains: ${forbidden}`);
    process.exit(1);
  }
}

const tunnelModalIndex = section.indexOf('function showTunnelSettingsModal');
const nameIndex = section.indexOf('_("Tunnel name")', tunnelModalIndex);
const importIndex = section.indexOf('"_import_config"', tunnelModalIndex);
const generateIndex = section.indexOf('"_generate_warp_profile"', tunnelModalIndex);
const typeIndex = section.indexOf('_("Tunnel type")', tunnelModalIndex);
if (
  tunnelModalIndex < 0 ||
  !(typeIndex < nameIndex && nameIndex < importIndex && nameIndex < generateIndex)
) {
  console.error('FAIL: tunnel type must be first, followed by name and actions');
  process.exit(1);
}
if (!section.includes('["wireguard", "amneziawg", "warp", "tailscale"]')) {
  console.error('FAIL: tunnel name must remain visible for non-JSON tunnel types');
  process.exit(1);
}

if (!section.includes('if (!`${value || ""}`.trim()) {\n      return true;')) {
  console.error('FAIL: an empty tunnel list must remain valid');
  process.exit(1);
}

if (
  !main.includes("parseWireGuardConfig") ||
  !main.includes("parseWireGuardInput") ||
  !main.includes("./helpers/parseWireGuardConfig")
) {
  console.error('FAIL: main must export the WireGuard and vpn:// import parsers');
  process.exit(1);
}

const tunnelIndex = section.indexOf('"tunnels"');
const jsonIndex = section.indexOf('"outbound_jsons"', tunnelIndex);
if (tunnelIndex < 0 || jsonIndex < 0 || tunnelIndex >= jsonIndex) {
  console.error('FAIL: native tunnel control must appear before JSON outbound');
  process.exit(1);
}
NODE

printf 'LuCI native tunnel checks passed\n'
