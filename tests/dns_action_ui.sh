#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js"
LOCAL_DEVICES_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/local_devices.js"
ACL_JSON="$ROOT_DIR/luci-app-forkop/root/usr/share/rpcd/acl.d/luci-app-forkop.json"

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
const protocol = requiredIndex('"dns_type"', sectionContent);
const server = requiredIndex('"dns_server"', protocol);
if (server <= protocol || !source.slice(protocol, server).includes('_("DNS protocol")')) {
  fail("DNS protocol must be rendered before DNS server");
}
if (source.slice(server, requiredIndex('"dns_detour_enabled"', server)).includes('placeholder = "1.1.1.1"')) {
  fail("DNS server must not render the 1.1.1.1 placeholder");
}

for (const expected of [
  '_("DNS server used by the resolver")',
  '_("DNS requests through section")',
  '"Add an HTTP(S) URL or local path. The format is detected automatically."',
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

const ruleSetOption = requiredIndex("const ruleSetOption = section.taboption(");
const sourceIpOption = requiredIndex("const sourceIpOption = addLocalDeviceSubnetDynamicField(section", ruleSetOption);
const ruleSetBlock = source.slice(ruleSetOption, sourceIpOption);
if (!ruleSetBlock.includes("SettingsDynamicList") ||
    !ruleSetBlock.includes("ruleSetOption.retain = true") ||
    !ruleSetBlock.includes('getRuleResolvedAction(section_id) !== "dns"') ||
    !ruleSetBlock.includes("writeCustomRulesetReferences")) {
  fail("all actions must share one retained universal rule-set list");
}
for (const removed of ["dnsRuleSetOption", "domainIpListsOption", "dnsDomainListsOption", "domain_ip_lists"]) {
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
  requiredIndex("const ZAPRET_LEGACY_DEFAULT_NFQWS_OPT"),
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
