#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$(node "$ROOT_DIR/tests/helpers/tab_source.js" sections)"
SETTINGS_JS="$(node "$ROOT_DIR/tests/helpers/tab_source.js" settings --double-quotes)"
LOCAL_DEVICES_TS="$ROOT_DIR/fe-app-forkop/src/forkop/cbi/localDevices.ts"
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
  '_("Route main DNS requests through a section")'; do
  grep -Fq "$expected" "$SETTINGS_JS" || {
    printf 'FAIL: missing DNS URI help: %s\n' "$expected" >&2
    exit 1
  }
done

if grep -Fq '_("DNS through proxy")' "$SETTINGS_JS"; then
  printf 'FAIL: settings still use the proxy-specific DNS label\n' >&2
  exit 1
fi

node - "$SECTION_JS" "$LOCAL_DEVICES_TS" "$ACL_JSON" "$ROOT_DIR" <<'NODE'
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

const domains = requiredIndex("key: 'domain_suffix'");
const ips = requiredIndex('const ipConditionOption = addTextConditionField(section, {', domains);
const builtIns = requiredIndex('const builtInRulesetOption = section.taboption(', ips);
if (source.slice(domains, ips).includes("dependsOnRoutingAction")) {
  fail("DNS action must keep the Domains field visible");
}
if (!source.slice(ips, builtIns).includes("dependsOnRoutingAction(ipConditionOption)")) {
  fail("DNS action must hide the IPs field");
}

const sectionContent = requiredIndex("function createSectionContent(section)");
const server = requiredIndex("'dns_server'", sectionContent);
const serverOption = source.lastIndexOf("section.taboption(", server);
const serverBlock = source.slice(serverOption, requiredIndex("'dns_detour_enabled'", server));
if (serverBlock.includes('"dns_type"') || source.slice(sectionContent, server).includes('"dns_type"')) {
  fail("DNS action must not render a shared protocol selector");
}
if (!serverBlock.includes("form.DynamicList") || !serverBlock.includes("_('DNS Server')")) {
  fail("DNS action servers must use a DynamicList");
}
if (serverBlock.includes('placeholder = "1.1.1.1"')) {
  fail("DNS server must not render the 1.1.1.1 placeholder");
}

for (const expected of [
  "'Resolves domains that match the section conditions. Several servers give automatic failover. The protocol is set by a prefix: udp://, tcp://, tls://, https://, quic://, h3://'",
  "'dns_fallback_strategy'",
  "_('DNS Query Mode')",
  "configureDnsQueryMode(dnsQueryModeOption, 'dns_server', {",
  "alsoDependsOn: { action: 'dns' },",
  "_('Route DNS requests through a section')",
  "_('DNS requests through')",
  "'A URL or local path. The format is detected automatically'",
]) {
  requiredIndex(expected);
}

for (const expected of [".load('dhcp')", "uci.sections('dhcp', 'host')"]) {
  if (!localDevicesSource.includes(expected)) {
    fail(`static DHCP hosts are missing local-device contract: ${expected}`);
  }
}
for (const expected of [
  "export const SYSTEM_DEVICE_VALUE = '@system'",
  "choices[SYSTEM_DEVICE_VALUE] = 'System'",
  "normalizedName.toLowerCase() === 'system'",
  "'%s (%s)'.format(normalizedName, normalizedIp)",
]) {
  if (!localDevicesSource.includes(expected)) {
    fail(`System device choice is missing contract: ${expected}`);
  }
}
if (!source.includes('value === SYSTEM_DEVICE_VALUE')) {
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
    !nativeRuleSetBlock.includes("dnsRuleSetOption.depends('action', 'dns')") ||
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
if (!source.slice(fullyRoutedOption, portsOption).includes("fullyRoutedOption.depends('action', 'dns')")) {
  fail("DNS action must expose forced device routing");
}
if (!source.slice(fullyRoutedOption, portsOption).includes("makeDeviceOptionsExclusive(sourceIpOption, fullyRoutedOption)")) {
  fail("device filter and forced routing must be mutually exclusive");
}

// The helper is taken by name: the tab is several modules now, so what comes
// after it in the concatenation is not part of any contract.
const { readFunction } = require(`${process.argv[5]}/tests/helpers/source_literal.js`);
const conditionDependencies = readFunction(source, "dependsOnRuleConditions");
for (const condition of [
  "'domain'",
  "'ip_cidr'",
  "'community_lists'",
  "'rule_set'",
  "'ports'",
]) {
  if (!conditionDependencies.includes(condition)) {
    fail(`device filter is missing dependency on ${condition}`);
  }
}
if (!conditionDependencies.includes("/\\S/")) {
  fail("device filter visibility must ignore empty whitespace");
}
for (const expected of [
  'onWidgetReady(section_id, widget)',
  "node.addEventListener('cbi-dynlist-change'",
  'onListChange(section_id, widget.getValue())',
]) {
  if (!localDevicesSource.includes(expected)) {
    fail(`local device list is missing live event contract: ${expected}`);
  }
}
if (!source.includes("node.dispatchEvent(new CustomEvent('widget-change', { bubbles: true }))")) {
  fail("text conditions must refresh device-filter visibility while editing");
}



if (
  !/import \{[^}]*normalizeOptionValues[^}]*\} from '[^']*cbi\/listValues'/.test(
    source,
  )
) {
  fail("section must reuse the shared uci list normalizer");
}
for (const name of [
  "normalizeOptionValues",
  "normalizeDynamicListItems",
  "stringArraysEqual",
  "makeDeviceOptionsExclusive",
]) {
  eval(readFunction(source, name));
}

// The query mode is wired by the shared DNS helper, so the visibility rule is
// driven through that helper rather than through a slice of the tab calling it.
const _ = (text) => text;
// "more than one server" is not a value depends() can compare against, so the
// mode depends on a sentinel no DNS server can be and answers the real question
// in checkDepends.
const sentinelMatch = /const MULTIPLE_DNS_SENTINEL = '([^']+)'/.exec(source);
if (!sentinelMatch) {
  fail("the DNS query mode must depend on a sentinel value");
}
const MULTIPLE_DNS_SENTINEL = sentinelMatch[1];
for (const name of [
  "optionListValues",
  "siblingValues",
  "configureDnsQueryMode",
]) {
  eval(readFunction(source, name));
}

// LuCI re-checks the whole map on widget-change from any option, and a
// DynamicList raises that on every edit, so the check drives checkDepends
// directly rather than through a listener of ours.
let currentDnsServers = ["1.1.1.1"];
let currentDnsAction = "dns";
const actionOption = {
  formvalue: () => currentDnsAction,
  cfgvalue: () => null,
};
const dnsServerOption = {
  formvalue: () => currentDnsServers,
  cfgvalue: () => null,
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
  value: () => {},
  depends: () => {},
};
dnsServerOption.map = modalMap;
configureDnsQueryMode(dnsQueryModeOption, "dns_server", {
  alsoDependsOn: { action: "dns" },
});
modalMap.checkDepends();
currentDnsServers = ["1.1.1.1", "8.8.8.8"];
modalMap.checkDepends();
currentDnsAction = "connection";
modalMap.checkDepends();
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
