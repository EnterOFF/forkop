#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

for removed in 'dnsTypeChoices' '"domain_resolver_dns_type"' '_("DNS protocol")'; do
  if grep -Fq "$removed" "$SECTION_JS"; then
    fail "network interface settings must not keep the removed DNS protocol selector: $removed"
  fi
done

grep -Fq 'o.renderItemSettingsModal = showInterfaceSettingsModal;' "$SECTION_JS" ||
  fail "network interfaces must keep their settings modal handler"
grep -Fq 'defaults: (inputValue) => defaultInterfaceSettings(inputValue),' "$SECTION_JS" ||
  fail "new interface settings must default the display name to the interface name"
grep -Fq '"display_name",' "$SECTION_JS" ||
  fail "network interface settings must expose a display name"

grep -Fq 'o.datatype = "netdevname";' "$SECTION_JS" ||
  fail "custom network interfaces must use LuCI network device name validation"
if grep -Fq 'Select an existing network interface' "$SECTION_JS"; then
  fail "custom network interfaces must not be restricted to discovered devices"
fi

node - "$SECTION_JS" <<'NODE'
const fs = require("fs");
const source = fs.readFileSync(process.argv[2], "utf8");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function requiredIndex(needle, from = 0) {
  const index = source.indexOf(needle, from);
  if (index < 0) fail(`missing source contract: ${needle}`);
  return index;
}

const optionsStart = requiredIndex("function addInterfaceItemOptions(itemSection, options = {}) {");
const optionsEnd = requiredIndex("function addUrlTestItemOptions(", optionsStart);
const block = source.slice(optionsStart, optionsEnd);

for (const expected of [
  // The resolver must reuse the shared DNS server standard instead of a scalar field.
  "form.DynamicList,\n    \"domain_resolver_dns_server\"",
  '_("DNS Server")',
  '"DNS server used by the resolver. Specify several servers for automatic failover on failure. To select a protocol, use udp://, tcp://, tls://, https://, quic://, or h3://; UDP is used by default."',
  '_("Add at least one DNS server")',
  '"domain_resolver_dns_fallback_strategy"',
  '_("DNS Query Mode")',
  'node.addEventListener("cbi-dynlist-change"',
  '"domain_resolver_dns_detour_enabled"',
  '_("DNS through section")',
  '"Route the resolver\'s DNS requests through a section instead of this network interface."',
  '"domain_resolver_dns_detour_section"',
  '_("DNS requests through")',
  "refreshDnsDetourSectionOptionValues(this, parentSectionForItem(itemId))",
  '_("Select a section")',
]) {
  if (!block.includes(expected)) {
    fail(`interface resolver is missing the shared DNS contract: ${expected}`);
  }
}

const keysBlock = source.slice(
  requiredIndex("function interfaceSettingsKeys()"),
  requiredIndex("function subscriptionUserAgentChoices()"),
);
for (const expected of [
  '"domain_resolver_dns_server"',
  '"domain_resolver_dns_fallback_strategy"',
  '"domain_resolver_dns_detour_enabled"',
  '"domain_resolver_dns_detour_section"',
  'domain_resolver_dns_server: ["8.8.8.8"]',
  'domain_resolver_dns_fallback_strategy: "parallel"',
  'domain_resolver_dns_detour_enabled: "0"',
]) {
  if (!keysBlock.includes(expected)) {
    fail(`interface settings storage is missing: ${expected}`);
  }
}

function extractFunction(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  if (start < 0 || end < 0) fail(`missing function source: ${name}`);
  return source.slice(start, end);
}

eval(extractFunction("normalizeDynamicListItems", "uniqueDynamicListItems"));

// The query mode must appear as soon as a second server is typed, without a save.
const visibilityStart = requiredIndex("dnsQueryModeOption.checkDepends = function", optionsStart);
const visibilityEnd = requiredIndex("  o = itemSection.option(", visibilityStart);
const listeners = {};
const node = {
  addEventListener: (name, listener) => {
    listeners[name] = listener;
  },
};
let currentServers = ["8.8.8.8"];
let currentEnabled = "1";
const enabledOption = { formvalue: () => currentEnabled };
const dnsServerOption = {
  renderWidget: () => node,
  formvalue: () => currentServers,
};
const visibility = [];
const modalMap = {
  lookupOption: (name, itemId) => [
    name === "domain_resolver_enabled" ? enabledOption : dnsServerOption,
    itemId,
  ],
  checkDepends: () => {
    visibility.push(dnsQueryModeOption.checkDepends("settings"));
  },
};
const dnsQueryModeOption = { map: modalMap };
dnsServerOption.map = modalMap;
eval(source.slice(visibilityStart, visibilityEnd));
dnsServerOption.renderWidget("settings", 0, currentServers);
if (typeof listeners["cbi-dynlist-change"] !== "function") {
  fail("interface resolver servers must listen to the native DynamicList change event");
}
listeners["cbi-dynlist-change"]();
currentServers = ["8.8.8.8", "1.1.1.1"];
listeners["cbi-dynlist-change"]();
currentEnabled = "0";
listeners["cbi-dynlist-change"]();
if (JSON.stringify(visibility) !== JSON.stringify([false, true, false])) {
  fail("interface resolver query mode must react immediately to the live server count");
}
NODE

printf 'LuCI network interface settings checks passed\n'
