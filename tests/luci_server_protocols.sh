#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIEW_DIR="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop"
SERVER_JS="$VIEW_DIR/server.js"
SECTION_JS="$VIEW_DIR/section.js"
FORKOP_JS="$VIEW_DIR/forkop.js"
FE_SRC="$ROOT_DIR/fe-app-forkop/src"

node - "$SERVER_JS" "$FORKOP_JS" "$SECTION_JS" "$VIEW_DIR" <<'NODE'
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const source = fs.readFileSync(process.argv[2], "utf8");
const entrySource = fs.readFileSync(process.argv[3], "utf8");
const sectionSource = fs.readFileSync(process.argv[4], "utf8");
const viewDir = process.argv[5];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function optionBlockFree(needle) {
  return source.includes(needle);
}

function requireSource(needle) {
  if (!source.includes(needle)) {
    fail(`missing server UI contract: ${needle}`);
  }
}

// The whole tab lives in one file. Splitting it again spreads the protocol table,
// the value checks and the share links over modules nobody reads together.
for (const name of fs.readdirSync(viewDir)) {
  if (/^server_.*\.js$/.test(name)) {
    fail(`the Servers tab must stay in server.js, found ${name}`);
  }
}

// Every protocol the form offers is described in the table, and every protocol with
// its own options reaches them through depends().
for (const protocol of [
  "naive", "ssh", "mieru", "anytls", "tuic", "mixed", "shadowsocks",
  "mtproto", "tailscale", "vless", "vmess", "trojan", "hysteria2",
  "json_inbound",
]) {
  requireSource(`id: "${protocol}"`);
}
for (const protocol of [
  "naive", "ssh", "mieru", "tuic", "mixed", "shadowsocks", "mtproto",
  "tailscale", "hysteria2", "json_inbound",
]) {
  requireSource(`depends("protocol", "${protocol}")`);
}

for (const option of [
  "naive_network",
  "naive_quic_congestion_control",
  "ssh_host_key_path",
  "mieru_transport",
  "mieru_user_hint_mandatory",
  "tuic_congestion_control",
  "tuic_zero_rtt_handshake",
  "hysteria2_masquerade",
  "tailscale_ephemeral",
  "tcp_fast_open",
  "routing_override",
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
  ["vmess", '["tls", "none"]'],
  ["mixed", '["none"]'],
  ["shadowsocks", '["none"]'],
]) {
  const block = source.slice(source.indexOf(`id: "${protocol}"`));
  const securityLine = block.slice(0, block.indexOf("credentials:"));
  if (!securityLine.includes(`securities: ${securities}`)) {
    fail(`${protocol} must offer exactly ${securities}`);
  }
}

// A plain local proxy is what most people set up first, so Mixed leads the list and
// the raw JSON inbound stays last.
const protocolOrder = [...source.matchAll(/^\s*id: "([A-Za-z0-9_]+)"/gm)].map(
  (match) => match[1],
);
if (protocolOrder[0] !== "mixed" || protocolOrder.at(-1) !== "json_inbound") {
  fail(`unexpected protocol order: ${protocolOrder.join(", ")}`);
}
if (protocolOrder.includes("socks")) {
  fail("the SOCKS inbound was replaced by the mixed inbound");
}
if (source.includes('label: _("SOCKS5 / HTTP")')) {
  fail("the mixed inbound is called Mixed");
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
    fail(`legacy sing-box capability branch remains: ${legacy}`);
  }
}

for (const needle of [
  "const JSON_INBOUND_TYPES = new Set([",
  "!JSON_INBOUND_TYPES.has(type)",
  // Forkop overwrites the tag with the server name, so a pasted tag is refused
  // instead of being dropped without a word.
  "Remove the tag field",
]) {
  requireSource(needle);
}

// Accounts are child sections edited with the same widget the Sections tab uses for
// interfaces, URLTests and tunnels, so both tabs behave the same way.
for (const needle of [
  'const CLIENT_TYPE = "server_client"',
  'const CLIENT_OWNER_OPTION = "server"',
  "sectionui.ButtonAddSettingsDynamicList",
  "sectionui.showChildItemSettingsModal",
  "o.childType = CLIENT_TYPE",
  "o.ownerOption = CLIENT_OWNER_OPTION",
  "xtls-rprx-vision",
]) {
  requireSource(needle);
}
for (const shared of [
  "ButtonAddSettingsDynamicList,",
  "showChildItemSettingsModal,",
  "childPendingSettingsStore,",
]) {
  if (!sectionSource.includes(shared)) {
    fail(`the Sections tab must export the shared child item helper: ${shared}`);
  }
}
for (const removed of [
  '"server_uuid"',
  '"server_password"',
  '"server_username"',
  '"socks_auth_enabled"',
  '"vmess_alter_id"',
]) {
  if (source.includes(removed)) {
    fail(`credentials belong to client sections now: ${removed}`);
  }
}

// A numbered client name, so a client never inherits the server name.
requireSource('const pattern = "client-%d";');

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
    fail(`option is absent from the server form: ${name}`);
  }
  return block.body;
}

// Secrets use the LuCI password widget, which hides the value and offers the reveal
// control the rest of the app already uses.
for (const secret of [
  "tailscale_auth_key",
  "reality_private_key",
  "hysteria2_obfs_password",
  "shadowsocks_psk",
]) {
  if (!optionBlock(secret).includes("o.password = true")) {
    fail(`${secret} must be rendered as a password field`);
  }
}

// Nothing is generated until the user asks for it, so every value that used to be
// invented now has a button and no default.
for (const generated of [
  "listen_port",
  "shadowsocks_psk",
  "hysteria2_obfs_password",
  "reality_short_id",
  "reality_handshake_server",
  "tls_server_name",
  "mtproto_faketls",
]) {
  const body = optionBlock(generated);
  if (!body.includes("addGenerateButton(") && !body.includes("addRealityKeypairButton(")) {
    fail(`${generated} must offer a generate button`);
  }
  if (/o\.default = "/.test(body)) {
    fail(`${generated} must start empty instead of carrying a default`);
  }
}
if (!optionBlock("reality_private_key").includes("addRealityKeypairButton(")) {
  fail("the Reality key pair must be generated by its own button");
}
if (!source.includes("const CAMOUFLAGE_SITES = [")) {
  fail("the SNI and Reality pickers need a list of camouflage sites");
}
// A camouflage host is a suggestion the picker offers, never a stored default.
const camouflageBlock = source.slice(
  source.indexOf("const CAMOUFLAGE_SITES = ["),
  source.indexOf("];", source.indexOf("const CAMOUFLAGE_SITES = [")),
);
const camouflageHosts = [...camouflageBlock.matchAll(/"([^"]+)"/g)].map(
  (match) => match[1],
);
if (camouflageHosts.length < 5) {
  fail("the camouflage list is too short to be a choice");
}
for (const host of camouflageHosts) {
  if (source.split(host).length - 1 > 1) {
    fail(`${host} is used outside the camouflage list`);
  }
  if (source.includes(`o.default = "${host}"`)) {
    fail(`${host} must not be a stored default`);
  }
}

// Opening the dialog must not touch the configuration, so a load handler only reads.
for (const match of source.matchAll(/o\.load = (function[\s\S]*?\n  \};|\([\s\S]*?\);)/g)) {
  if (match[1].includes("uci.set(")) {
    fail("a load handler must not write to the configuration");
  }
}

// A short ID is decoded as hex bytes, so an odd digit count stops the service.
for (const needle of [
  "Use an even number of hex digits, for example 0a1b2c3d",
  "A short ID holds at most 16 hex digits",
  "function validateListenPort",
  "Port %s is already used by %s",
]) {
  requireSource(needle);
}

// The table stays down to the switch and the protocol; the rest belongs in the dialog.
for (const removedColumn of ["_endpoint_display", "_clients_display"]) {
  if (source.includes(removedColumn)) {
    fail(`the server table must not show the ${removedColumn} column`);
  }
}

// The details dialog names the server, shows one block per client and offers no
// bulk copy button.
requireSource('_("Server details: %s").format(getServerName(sectionId))');
for (const removed of ["Copy all links", "fkp-server-info__tab", "Connect to this server"]) {
  if (source.includes(removed)) {
    fail(`the details dialog must not keep: ${removed}`);
  }
}
if (source.includes("private or reserved")) {
  fail("the details dialog must not warn about a private public address");
}

// The theme widens .modal.cbi-modal to the size of a settings form, and the URLTest
// and Fallback details are opened without that class, which is what makes them the
// width they are. This dialog takes the same width by being opened the same way, so
// it must not ask for cbi-modal and must not carry a width of its own.
{
  const opens = source.slice(source.indexOf("function showServerDetailsModal"));
  if (/cbi-modal/.test(opens.slice(0, opens.indexOf("loadLinkContext")))) {
    fail("the details dialog must be opened without cbi-modal, like the URLTest details");
  }
  // A style rule that sizes the dialog, not any mention of the overlay: the widget
  // lookup legitimately queries the open modal.
  if (/"[^"]*\.modal[^"]*max-(?:width|inline-size)[^"]*"/.test(source)) {
    fail("the details dialog must not size itself: it inherits the plain modal width");
  }
}
// LuCI spreads the class arguments into classList.add(), which rejects a token with
// a space in it, so a joined class list throws and the button opens nothing.
if (/`cbi-modal \$\{/.test(source)) {
  fail("modal classes must be separate arguments, not one joined string");
}
// LuCI spreads the class arguments into classList.add(), which rejects a token with
// a space in it: a joined class list throws there and the button opens nothing.
if (source.includes("cbi-modal ${")) {
  fail("modal classes must be separate arguments, not one joined string");
}

// What the server is, once, above the accounts: it is what a client is pointed at
// and the first thing looked at when one cannot connect. Anything a link already
// carries stays out of it.
requireSource("function serverFactRows(sectionId) {");
for (const fact of [
  '_("Protocol")',
  '_("Address")',
  '_("Security")',
  '_("Transport")',
  '_("Routing mode")',
]) {
  if (!optionBlockFree(fact)) {
    fail(`the server block must state ${fact}`);
  }
}

// An account shows its name and its link, and nothing else: the link already holds
// the credentials, the flow and everything the client needs.
requireSource("function renderLinkRow(value, qrTitle) {");
for (const removed of [
  "clientFactRows",
  "clientConnectRows",
  "clientRoutingLabel",
]) {
  if (source.includes(removed)) {
    fail(`an account block must not list ${removed}`);
  }
}

// A code says what it belongs to, and the link it carries is written out under it.
requireSource("function linkTitle(sectionId, client, scheme) {");
requireSource("fkp-qr__link");

// The summary is the same dl/dt/dd those dialogs build. Half of how their labels
// read comes from the theme through the tag - dl dt is bold - so a grid of spans
// carrying the same class rules could never match them.
requireSource("grid-template-columns:max-content minmax(0,1fr);gap:8px 16px");
requireSource("--text-color-medium,#666");
requireSource('E("dt", {}, label)');
requireSource('E("dd", {}, E("span", {}, value))');
requireSource(".fkp-details__param{display:contents}");
for (const removed of [
  "fkp-details__fact-label",
  "fkp-details__fact-value",
]) {
  if (source.includes(removed)) {
    fail(`the summary must be a definition list, not ${removed}`);
  }
}

// The theme pushes a lone button to the left, and both dialogs close on the right.
requireSource(".fkp-details-actions{justify-content:flex-end");

// One account is separated from the next by its own name and by space, not by a rule.
if (/fkp-details__client{[^"]*border/.test(source)) {
  fail("accounts must not be separated by a border");
}

// Only a server whose accounts can be handed a link has details to show, which
// leaves out SSH, Tailscale and a JSON inbound without naming any of them.
requireSource(
  "usesClients(getProtocol(sectionId)) && linkScheme(getProtocol(sectionId))",
);

// The code is shown on request. A link carrying Reality parameters is only
// scannable at a size that would push the rest of the dialog out of view.
requireSource("function showQrModal(title, link) {");
requireSource("function renderQrButton(title, link) {");
if (/fkp-details__qr/.test(source)) {
  fail("the details dialog must not render a QR code beside every account");
}

// A copy control stays a copy control; the toast reports the result.
if (/iconSvg\(copied \? "check"/.test(source) || source.includes('"check"')) {
  fail("the copy control must not turn into a tick");
}

// A listener that asks for nothing still has a link: the address without an
// account. The dialog shows it instead of saying there is nothing to show.
requireSource("function anonymousClient() {");
if (source.includes("This server accepts everybody, so it has no client links.")) {
  fail("a server without authentication must still offer its links");
}

// A failed save is already reported on the offending field, so there is no banner.
for (const removed of ["showServerValidationMessage", "fkp-server-validation-summary", "Cannot save server"]) {
  if (source.includes(removed)) {
    fail(`the save handler must not add a banner: ${removed}`);
  }
}

for (const needle of [
  "sectionRef.map.data.createSID(configName)",
  'sectionRef.map.data.set(configName, sectionId, "label", label)',
  "sectionRef.addLabeledSection = function ()",
  "this.addLabeledSection()",
  'click: ui.createHandlerFn(sectionRef, "handleAdd")',
  "return this.renderMoreOptionsModal(sectionId)",
]) {
  if (!entrySource.includes(needle)) {
    fail(`labeled section creation contract is missing: ${needle}`);
  }
}

if (entrySource.includes("cbi-section-create-name")) {
  fail("section tables must not require a name before adding");
}

const addSectionHelper = entrySource.match(
  /function addLabeledSection\([\s\S]*?\n}\n\nfunction getRuleEditButtonText\(/,
);
assert(addSectionHelper, "labeled section helper not found");
eval(addSectionHelper[0].slice(0, -"\n\nfunction getRuleEditButtonText(".length));

for (const [sectiontype, expectedLabel] of [
  ["section", "Section #3"],
  ["server", "Server #3"],
]) {
  let savedLabel = null;
  const sectionRef = {
    sectiontype,
    cfgsections: () => ["active-1", "active-2"],
    map: {
      config: "forkop",
      data: {
        createSID: () => "cfg-new",
        add: () => "cfg-new",
        set: (_config, _sectionId, _option, value) => {
          savedLabel = value;
        },
      },
    },
  };

  assert.strictEqual(addLabeledSection(sectionRef), "cfg-new");
  assert.strictEqual(savedLabel, expectedLabel);
}

requireSource("const sectionId = this.addLabeledSection()");

// Add creates the section before the dialog is filled in, and nothing writes the
// enable switch until the dialog is saved: a server without one counts as
// disabled, so an abandoned one is skipped by the validator and by the generator.
if (source.includes('uci.set(UCI_PACKAGE, sectionId, "enabled"')) {
  fail("adding a server must not write the enable switch");
}
requireSource("addedServers.add(sectionId);");
requireSource("addedServers.delete(sectionId);");
requireSource('uci.unset(UCI_PACKAGE, sectionId, "enabled");');

// LuCI keeps whatever load() returned as the stored value of an option, so a
// value the dialog generates by itself compares equal on save and is never
// written: that is how a server ended up with no port, no public host and no
// Reality identity. Every generated value goes through autofill(), which sets
// forcewrite so the save writes it.
requireSource(`function autofill(option, loader) {
  option.forcewrite = true;
  option.load = loader;
}`);
for (const name of [
  "listen_port",
  "public_host",
  "shadowsocks_psk",
  "hysteria2_obfs_password",
  "tls_server_name",
  "reality_handshake_server",
  "reality_private_key",
  "reality_public_key",
  "reality_short_id",
  "mtproto_faketls",
]) {
  if (!optionBlock(name).includes("autofill(")) {
    fail(`the generated value of ${name} must be written through autofill()`);
  }
}

// Only an option that reads what is already stored may set load() directly.
{
  const allowed = new Set(["tailscale_detour_section", "routing_section"]);
  const marker = "\n  o.load = ";
  let at = source.indexOf(marker);
  while (at >= 0) {
    const opened = source.lastIndexOf("section.option(", at);
    const name = /"([a-z0-9_]+)"/.exec(source.slice(opened, opened + 200));
    const found = name ? name[1] : String(at);
    if (!allowed.has(found)) {
      fail(`${found} sets load() directly; use autofill() so the value is written`);
    }
    at = source.indexOf(marker, at + 1);
  }
}

// A widget is found by the id of the frame it renders, which every widget carries.
// Only some of them also name the inner control widget.<cbid>: a checkbox puts that
// in data-widget-id, so looking for the control found nothing for a flag and every
// reader silently answered from the stored value instead of the open dialog.
requireSource("function widgetNode(sectionId, name) {");
if (source.includes("widget.cbid")) {
  fail("a widget must be found by its frame id, not by the id of its inner control");
}

// The client list shows the account names. A widget item carries the child
// section id as its value, so without a label of its own it shows that id.
requireSource("o.renderListItemLabel = function (sectionId, value) {");

// Forkop does not generate SSH client keys: sing-box only ever sees the public
// half, and keeping the private one is not Forkop's business.
if (/ssh.?keypair|SSH key pair|showSshPrivateKey/i.test(source)) {
  fail("the Servers tab must not generate SSH client key pairs");
}
NODE

if grep -R -n -E 'singBoxVariant|sing_box_(extended|tiny|tailscale)|GET_SERVER_CAPABILITIES|GetServerCapabilities|Install another build|startsWith\(.install_' \
  "$FE_SRC" >/dev/null 2>&1; then
  printf 'FAIL: frontend still contains legacy sing-box variant code\n' >&2
  exit 1
fi

printf 'LuCI native server protocol checks passed\n'
