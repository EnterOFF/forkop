#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js"
SETTINGS_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/settings.js"
LOCAL_DEVICES_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/local_devices.js"
ACL_JSON="$ROOT_DIR/luci-app-forkop/root/usr/share/rpcd/acl.d/luci-app-forkop.json"

for expected in \
  '_("Preferred IP address type for domains")' \
  '_("DNS through section")' \
  '_("DNS requests through")'; do
  grep -Fq "$expected" "$SETTINGS_JS" || {
    printf 'FAIL: missing settings DNS copy: %s\n' "$expected" >&2
    exit 1
  }
done

if grep -Fq '"dns_type"' "$SETTINGS_JS" ||
   grep -Eq 'DNS_SERVER_OPTIONS|BOOTSTRAP_DNS_SERVER_OPTIONS' "$SETTINGS_JS"; then
  printf 'FAIL: settings still expose the shared DNS protocol or preset selector\n' >&2
  exit 1
fi
for expected in \
  '_("DNS Server")' \
  '"Several servers give automatic failover. The protocol is set by a prefix: udp://, tcp://, tls://, https://, quic://, h3://"' \
  '"Resolve the addresses of the main DNS servers and proxies. Several servers give automatic failover. The protocol is set by a prefix: udp://, tcp://, tls://, https://, quic://, h3://"' \
  '_("Route main DNS requests through a section.")'; do
  grep -Fq "$expected" "$SETTINGS_JS" || {
    printf 'FAIL: missing DNS URI help: %s\n' "$expected" >&2
    exit 1
  }
done

if grep -Fq '_("DNS through proxy")' "$SETTINGS_JS"; then
  printf 'FAIL: settings still use the proxy-specific DNS label\n' >&2
  exit 1
fi

node - "$SECTION_JS" "$LOCAL_DEVICES_JS" "$ACL_JSON" <<'NODE'
const fs = require("fs");
const source = fs.readFileSync(process.argv[2], "utf8");
const localDevicesSource = fs.readFileSync(process.argv[3], "utf8");
const acl = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function requiredIndex(needle, from = 0) {
  const index = source.indexOf(needle, from);
  if (index < 0) fail(`missing source contract: ${needle}`);
  return index;
}

const domains = requiredIndex('key: "domain_suffix"');
const ips = requiredIndex('const ipConditionOption = addTextConditionField(section, {', domains);
const builtIns = requiredIndex('const builtInRulesetOption = section.taboption(', ips);
if (source.slice(domains, ips).includes("dependsOnRoutingAction")) {
  fail("DNS action must keep the Domains field visible");
}
if (!source.slice(ips, builtIns).includes("dependsOnRoutingAction(ipConditionOption)")) {
  fail("DNS action must hide the IPs field");
}

const sectionContent = requiredIndex("function createSectionContent(section)");
const server = requiredIndex('"dns_server"', sectionContent);
const serverOption = source.lastIndexOf("section.taboption(", server);
const serverBlock = source.slice(serverOption, requiredIndex('"dns_detour_enabled"', server));
if (serverBlock.includes('"dns_type"') || source.slice(sectionContent, server).includes('"dns_type"')) {
  fail("DNS action must not render a shared protocol selector");
}
if (!serverBlock.includes("form.DynamicList") || !serverBlock.includes('_("DNS Server")')) {
  fail("DNS action servers must use a DynamicList");
}
if (serverBlock.includes('placeholder = "1.1.1.1"')) {
  fail("DNS server must not render the 1.1.1.1 placeholder");
}

for (const expected of [
  '"Resolves domains that match the section conditions. Several servers give automatic failover. The protocol is set by a prefix: udp://, tcp://, tls://, https://, quic://, h3://"',
  '"dns_fallback_strategy"',
  '_("DNS Query Mode")',
  'action === "dns" && normalizeDynamicListItems(servers).length > 1',
  'node.addEventListener("cbi-dynlist-change"',
  '_("Route DNS requests through a section.")',
  '_("DNS requests through")',
  '"A URL or local path. The format is detected automatically."',
]) {
  requiredIndex(expected);
}

for (const expected of ['"require uci"', '.load("dhcp")', 'uci.sections("dhcp", "host")']) {
  if (!localDevicesSource.includes(expected)) {
    fail(`static DHCP hosts are missing local-device contract: ${expected}`);
  }
}
for (const expected of [
  'const SYSTEM_DEVICE_VALUE = "@system"',
  'choices[SYSTEM_DEVICE_VALUE] = "System"',
  'normalizedName.toLowerCase() === "system"',
  '"%s (%s)".format(normalizedName, normalizedIp)',
]) {
  if (!localDevicesSource.includes(expected)) {
    fail(`System device choice is missing contract: ${expected}`);
  }
}
if (!source.includes('value === localDevices.SYSTEM_DEVICE_VALUE')) {
  fail("System device sentinel must pass device-selector validation");
}
if (!acl["luci-app-forkop"]?.read?.uci?.includes("dhcp")) {
  fail("local-device selector needs read access to DHCP UCI host sections");
}

const dnsRuleSetOption = requiredIndex("const dnsRuleSetOption = section.taboption(");
const ruleSetOption = requiredIndex("const ruleSetOption = section.taboption(", dnsRuleSetOption);
const nativeRuleSetBlock = source.slice(dnsRuleSetOption, ruleSetOption);
if (!nativeRuleSetBlock.includes("form.DynamicList") ||
    nativeRuleSetBlock.includes("SettingsDynamicList") ||
    !nativeRuleSetBlock.includes('dnsRuleSetOption.depends("action", "dns")') ||
    !nativeRuleSetBlock.includes("writeDnsRulesetReferences")) {
  fail("DNS action rule sets must use the classic DynamicList");
}
const sourceIpOption = requiredIndex("const sourceIpOption = addLocalDeviceSubnetDynamicField(section", ruleSetOption);
const ruleSetBlock = source.slice(ruleSetOption, sourceIpOption);
if (!ruleSetBlock.includes("SettingsDynamicList") ||
    !ruleSetBlock.includes("ruleSetOption.retain = true") ||
    !ruleSetBlock.includes("dependsOnRoutingAction(ruleSetOption)") ||
    !ruleSetBlock.includes("writeCustomRulesetReferences")) {
  fail("routing actions must retain the settings-enabled rule-set list");
}
for (const removed of ["domainIpListsOption", "dnsDomainListsOption", "domain_ip_lists"]) {
  if (source.includes(removed)) {
    fail(`legacy list UI remains: ${removed}`);
  }
}

const fullyRoutedOption = requiredIndex("const fullyRoutedOption = addLocalDeviceSubnetDynamicField(section", sourceIpOption);
const portsOption = requiredIndex("const portsOption = addDynamicConditionField(section", fullyRoutedOption);
if (!source.slice(sourceIpOption, fullyRoutedOption).includes("dependsOnRuleConditions(sourceIpOption)")) {
  fail("device filter visibility must follow section conditions");
}
if (!source.slice(fullyRoutedOption, portsOption).includes('fullyRoutedOption.depends("action", "dns")')) {
  fail("DNS action must expose forced device routing");
}
if (!source.slice(fullyRoutedOption, portsOption).includes("makeDeviceOptionsExclusive(sourceIpOption, fullyRoutedOption)")) {
  fail("device filter and forced routing must be mutually exclusive");
}

const conditionDependencies = source.slice(
  requiredIndex("function dependsOnRuleConditions(option)"),
  requiredIndex("const ANNOTATED_TEXTAREA_STYLE_ID"),
);
for (const condition of [
  '"domain"',
  '"ip_cidr"',
  '"community_lists"',
  '"rule_set"',
  '"ports"',
]) {
  if (!conditionDependencies.includes(condition)) {
    fail(`device filter is missing dependency on ${condition}`);
  }
}
if (!conditionDependencies.includes("/\\S/")) {
  fail("device filter visibility must ignore empty whitespace");
}
for (const expected of [
  'option.onDeviceWidgetReady(section_id, widget)',
  'node.addEventListener("cbi-dynlist-change"',
  "option.onDeviceListChange(section_id, widget.getValue())",
]) {
  if (!localDevicesSource.includes(expected)) {
    fail(`local device list is missing live event contract: ${expected}`);
  }
}
if (!source.includes('node.dispatchEvent(new CustomEvent("widget-change", { bubbles: true }))')) {
  fail("text conditions must refresh device-filter visibility while editing");
}

function extractFunction(name, nextName, text = source) {
  const start = text.indexOf(`function ${name}(`);
  const end = text.indexOf(`function ${nextName}(`, start);
  if (start < 0 || end < 0) fail(`missing function source: ${name}`);
  return text.slice(start, end);
}

if (!source.includes("const normalizeOptionValues = localDevices.normalizeOptionValues;")) {
  fail("section must reuse the local-device option normalizer");
}
eval(extractFunction("normalizeOptionValues", "normalizeLocalDeviceName", localDevicesSource));
eval(extractFunction("normalizeDynamicListItems", "uniqueDynamicListItems"));
eval(extractFunction("stringArraysEqual", "writeListOption"));
eval(extractFunction("makeDeviceOptionsExclusive", "childOwnerOption"));

// The interface resolver reuses the same option names, so stay inside the rule form.
const dnsModeVisibilityStart = requiredIndex("dnsQueryModeOption.checkDepends = function", sectionContent);
const dnsModeVisibilityEnd = requiredIndex("  o = section.taboption(", dnsModeVisibilityStart);
const dnsModeListeners = {};
const dnsModeNode = {
  addEventListener: (name, listener) => { dnsModeListeners[name] = listener; },
};
let currentDnsServers = ["1.1.1.1"];
let currentDnsAction = "dns";
const actionOption = {
  formvalue: () => currentDnsAction,
};
const dnsServerOption = {
  renderWidget: () => dnsModeNode,
  formvalue: () => currentDnsServers,
};
const dnsModeVisibility = [];
const modalMap = {
  lookupOption: (name, sectionId) => [
    name === "action" ? actionOption : dnsServerOption,
    sectionId,
  ],
  checkDepends: () => {
    dnsModeVisibility.push(dnsQueryModeOption.checkDepends("section"));
  },
};
const dnsQueryModeOption = {
  map: modalMap,
};
dnsServerOption.map = modalMap;
eval(source.slice(dnsModeVisibilityStart, dnsModeVisibilityEnd));
dnsServerOption.renderWidget("section", 0, currentDnsServers);
if (typeof dnsModeListeners["cbi-dynlist-change"] !== "function") {
  fail("DNS server list must listen to the native DynamicList change event");
}
dnsModeListeners["cbi-dynlist-change"]();
currentDnsServers = ["1.1.1.1", "8.8.8.8"];
dnsModeListeners["cbi-dynlist-change"]();
currentDnsAction = "connection";
dnsModeListeners["cbi-dynlist-change"]();
if (JSON.stringify(dnsModeVisibility) !== JSON.stringify([false, true, false])) {
  fail("DNS query mode must react immediately to the live server count");
}

function deviceOption(values) {
  const widget = {
    values,
    getValue() {
      return this.values;
    },
    setValue(next) {
      this.values = next;
    },
  };
  return {
    widget,
  };
}

const filtered = deviceOption(["192.0.2.1/32"]);
const forced = deviceOption(["192.0.2.1/32", "192.0.2.2/32"]);
makeDeviceOptionsExclusive(filtered, forced);
filtered.onDeviceWidgetReady("section", filtered.widget);
forced.onDeviceWidgetReady("section", forced.widget);
filtered.onDeviceListChange("section", filtered.widget.values);
if (JSON.stringify(forced.widget.values) !== JSON.stringify(["192.0.2.2/32"])) {
  fail("adding a filtered device must remove it from forced routing");
}
forced.widget.values = ["192.0.2.1/32", "192.0.2.2/32"];
forced.onDeviceListChange("section", forced.widget.values);
if (filtered.widget.values.length !== 0) {
  fail("adding a forced device must remove it from the device filter");
}
NODE

printf 'DNS action UI checks passed\n'
