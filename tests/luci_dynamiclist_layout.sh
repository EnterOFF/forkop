#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js"
MONITORING_STYLES="$ROOT_DIR/fe-app-forkop/src/forkop/tabs/monitoring/styles.ts"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

wrapper_styles="$(sed -n '/^\.fkp-button-add-dynlist > \.add-item {$/,/^}$/p' "$SECTION_JS")"
button_styles="$(sed -n '/^\.fkp-button-add-dynlist > \.add-item > \.cbi-button-add {$/,/^}$/p' "$SECTION_JS")"
settings_styles="$(sed -n '/^\.fkp-connections-dynlist > \.item > \.fkp-dynlist-settings {$/,/^}$/p' "$SECTION_JS")"
subscription_keys="$(sed -n '/^function subscriptionUrlSettingsKeys(/,/^function defaultSubscriptionUrlSettings(/p' "$SECTION_JS")"
subscription_options="$(sed -n '/^function addSubscriptionUrlItemOptions(/,/^function addInterfaceItemOptions(/p' "$SECTION_JS")"
subscription_header_editor="$(sed -n '/^function subscriptionHeaderValues(/,/^function interfaceSettingsKeys(/p' "$SECTION_JS")"
server_filter_options="$(sed -n '/^function addServerFilterOptions(/,/^function urlTestUrlChoices(/p' "$SECTION_JS")"
urltest_options="$(sed -n '/^function addUrlTestItemOptions(/,/^function fallbackLevelSettingsForValidation(/p' "$SECTION_JS")"
fallback_options="$(sed -n '/^function addFallbackLevelItemOptions(/,/^function addFallbackGroupItemOptions(/p' "$SECTION_JS")"
fallback_group_options="$(sed -n '/^function addFallbackGroupItemOptions(/,/^function settingValueEquals(/p' "$SECTION_JS")"
create_section="$(sed -n '/^function createSectionContent(/,/^function loadSectionTableOptions(/p' "$SECTION_JS")"
live_choices="$(sed -n '/^function configureLiveDynamicListChoices(/,/^function currentOutboundNameChoices(/p' "$SECTION_JS")"
close_all_styles="$(sed -n '/^\.fkp_monitoring-page #monitoring-close-all\.btn\.fkp_monitoring-page__icon-button:hover:not(:disabled) {$/,/^}$/p' "$MONITORING_STYLES")"

node - "$SECTION_JS" <<'NODE'
const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(process.argv[2], 'utf8');
const fallbackGroupOptions = source.match(
  /function addFallbackGroupItemOptions\([\s\S]*?\n}\n\nfunction settingValueEquals\(/,
);
assert(fallbackGroupOptions, 'Fallback group options not found');
const fallbackSource = fallbackGroupOptions[0];
const fallbackDefault = (name) => {
  const match = fallbackSource.match(
    new RegExp(`"${name}",[\\s\\S]*?\\);\\n  o\\.default = "([^"]+)";`),
  );
  assert(match, `Fallback default not found: ${name}`);
  return match[1];
};
assert.strictEqual(fallbackDefault('health_check_interval'), '5m');
assert.strictEqual(fallbackDefault('health_check_timeout'), '5s');
assert.strictEqual(fallbackDefault('idle_timeout'), '5m');
assert.strictEqual(fallbackDefault('interrupt_exist_connections'), '1');
assert.match(
  fallbackSource,
  /urlTestUrlChoices\(\)\.forEach\(\(value\) => o\.value\(value\)\);/,
);
const helper = source.match(
  /function syncServerFilterFields\([\s\S]*?\n}\n\nfunction addServerFilterOptions\(/,
);
assert(helper, 'server filter synchronization helper not found');
eval(helper[0].slice(0, -'\n\nfunction addServerFilterOptions('.length));

const values = { include: ['Alpha'], exclude: [] };
const field = (mode) => ({
  getUIElement() {
    return {
      getValue: () => values[mode],
      setValue: (value) => {
        values[mode] = value;
      },
    };
  },
});
syncServerFilterFields(
  {
    include: { exclude_outbounds: field('include') },
    exclude: { exclude_outbounds: field('exclude') },
  },
  'include',
  'settings',
);
assert.deepStrictEqual(values.exclude, ['Alpha']);

const headerHelpers = source.match(
  /function subscriptionHeaderValues\([\s\S]*?\n}\n\nfunction showSubscriptionHeadersModal\(/,
);
assert(headerHelpers, 'subscription header helpers not found');
eval(headerHelpers[0].slice(0, -'\n\nfunction showSubscriptionHeadersModal('.length));
assert.deepStrictEqual(subscriptionHeaderRows(['Authorization: Bearer token', 'X-Empty:']), [
  { '.name': 'header_0', '.type': 'header', name: 'Authorization', value: 'Bearer token' },
  { '.name': 'header_1', '.type': 'header', name: 'X-Empty', value: '' },
]);
assert.deepStrictEqual(subscriptionHeaderLines({
  config: 'json',
  data: { sections: () => [{ name: 'Authorization', value: 'Bearer token' }, { name: 'X-Empty' }] },
}), ['Authorization: Bearer token', 'X-Empty:']);
const storedHeaders = {
  header_0: { name: 'Old', value: 'old' },
  header_1: { name: '', value: '' },
};
const headerSection = {
  map: {
    config: 'json',
    data: {
      get: (_config, section) => storedHeaders[section] ?? null,
      set: (_config, section, option, value) => { storedHeaders[section][option] = value; },
      unset: (_config, section, option) => { delete storedHeaders[section][option]; },
    },
  },
  cfgsections: () => ['header_0', 'header_1'],
  children: [
    { editable: true, option: 'name', formvalue: (section) => section === 'header_0' ? 'Changed' : '' },
    { editable: true, option: 'value', formvalue: (section) => section === 'header_0' ? 'current' : '' },
  ],
  nextHeaderRowIndex: 2,
};
syncSubscriptionHeaderRows(headerSection);
assert.deepStrictEqual(storedHeaders.header_0, { name: 'Changed', value: 'current' });
assert.deepStrictEqual(storedHeaders.header_1, { name: '', value: '' });
assert.strictEqual(nextSubscriptionHeaderRowId(headerSection), 'header_2');
storedHeaders.header_2 = {};
assert.strictEqual(nextSubscriptionHeaderRowId(headerSection), 'header_3');
delete storedHeaders.header_2;
assert.strictEqual(nextSubscriptionHeaderRowId(headerSection), 'header_4');
NODE

grep -Fq 'display: flex;' <<<"$wrapper_styles" ||
  fail "button-only DynamicList add rows must use a content-sized flex wrapper"
grep -Fq 'width: var(--fkp-button-add-width, 210px);' <<<"$wrapper_styles" ||
  fail "button-only DynamicList wrappers must follow the measured button width"
grep -Fq 'max-width: 100%;' <<<"$wrapper_styles" ||
  fail "button-only DynamicList wrappers must stay inside narrow option fields"
grep -Fq 'min-width: 0;' <<<"$wrapper_styles" ||
  fail "button-only DynamicList wrappers must not inherit theme minimum widths"
grep -Fq 'background: transparent;' <<<"$wrapper_styles" ||
  fail "button-only DynamicList wrappers must not render as empty input groups"
grep -Fq 'border: 0;' <<<"$wrapper_styles" ||
  fail "button-only DynamicList wrappers must leave framing to the button"

grep -Fq 'width: 100% !important;' <<<"$button_styles" ||
  fail "button-only DynamicList buttons must fill their content-sized wrapper"
grep -Fq 'max-width: 100% !important;' <<<"$button_styles" ||
  fail "button-only DynamicList buttons must not overflow narrow wrappers"
grep -Fq 'text-overflow: ellipsis !important;' <<<"$button_styles" ||
  fail "button-only DynamicList labels must truncate instead of overflowing"
grep -Fq 'var(--background-color-high, var(--primary, ButtonFace))' <<<"$button_styles" ||
  fail "button-only DynamicList buttons must remain visible outside Bootstrap themes"
grep -Fq 'min-width: var(--fkp-dynlist-action-width);' <<<"$settings_styles" ||
  fail "DynamicList settings buttons must resist theme label sizing"

grep -Fq 'addServerFilterOptions(itemSection, parentSectionForItem, {' <<<"$subscription_options" ||
  fail "subscription settings must expose native provider filters"
grep -Fq 'subscriptionSourceOutboundName(' <<<"$subscription_options" ||
  fail "subscription exact-name filters must account for provider tag prefixes"
for key in server_filter_mode include_regex exclude_regex; do
  grep -Fq "\"$key\"" <<<"$subscription_keys" ||
    fail "subscription/provider filter key $key is missing"
done
grep -Fq '"header"' <<<"$subscription_keys" ||
  fail "subscription settings must persist request headers"
if grep -Eq '"auto_hwid"|"hwid"' <<<"$subscription_keys"; then
  fail "subscription settings must not persist legacy HWID controls"
fi
grep -Fq 'form.Button' <<<"$subscription_options" ||
  fail "subscription settings must expose the header editor as a native LuCI button"
grep -Fq '_("Edit headers")' <<<"$subscription_options" ||
  fail "subscription settings header editor button is missing"
grep -Fq 'form.GridSection' <<<"$subscription_header_editor" ||
  fail "subscription headers must use a native LuCI grid"
grep -Fq 'headers.hidetitle = true' <<<"$subscription_header_editor" ||
  fail "subscription header grid must not repeat the modal title"
grep -Fq 'headers.handleAdd = function' <<<"$subscription_header_editor" ||
  fail "subscription header add button must create an inline row"
grep -Fq 'headers.handleRemove = function' <<<"$subscription_header_editor" ||
  fail "subscription header delete button must remove one inline row"
grep -Fq 'syncSubscriptionHeaderRows(section)' <<<"$subscription_header_editor" ||
  fail "subscription header grid must preserve unsaved inline values"
grep -Fq 'refreshSubscriptionHeaderRows(section)' <<<"$subscription_header_editor" ||
  fail "subscription header grid must reload cached inline values"
grep -Fq 'form.TableSection.prototype.renderRowActions.call' <<<"$subscription_header_editor" ||
  fail "subscription header rows must expose delete without a nested edit action"
if grep -Fq 'headers.modaltitle' <<<"$subscription_header_editor"; then
  fail "subscription header grid must not open a nested add modal"
fi
grep -Fq 'configureLiveDynamicListChoices(field, (itemId, values) =>' <<<"$server_filter_options" ||
  fail "URLTest server filters must stay comboboxes when no choices exist"
grep -Fq 'addServerFilterOptions(itemSection, parentSectionForItem, {' <<<"$fallback_options" ||
  fail "Fallback server filters must stay comboboxes when no choices exist"
grep -Fq 'form.Value' <<<"$server_filter_options" ||
  fail "server filter regular expressions must use single-value fields"
grep -Fq 'form.ListValue' <<<"$server_filter_options" ||
  fail "server filtering must use an explicit mode selector"
if grep -Fq 'form.DummyValue' <<<"$server_filter_options"; then
  fail "server filters must not emulate group headings with DummyValue rows"
fi
for label in \
  'Include servers' \
  'Include by pattern' \
  'Exclude servers' \
  'Exclude by pattern'; do
  grep -Fq "$label" <<<"$server_filter_options" ||
    fail "server filter field label is missing: $label"
done
grep -Fq 'field.ucioption = storageKey;' <<<"$server_filter_options" ||
  fail "conditional exclusion fields must use LuCI native shared UCI storage"
grep -Fq 'targetElement.setValue(sourceElement.getValue());' "$SECTION_JS" ||
  fail "switching filter modes must preserve pending exclusion values"
for description in \
  'Only the selected servers will be added from the subscription.' \
  'Servers that should not be added from the subscription.' \
  'Exclude servers from the subscription using a regular expression.'; do
  grep -Fq "$description" <<<"$subscription_options" ||
    fail "subscription filter description is missing: $description"
done
for description in \
  'Only the selected servers will be added to the URLTest group.' \
  'Servers that should not be added to the URLTest group.' \
  'Exclude servers from the URLTest group using a regular expression.'; do
  grep -Fq "$description" <<<"$urltest_options" ||
    fail "URLTest filter description is missing: $description"
done
for description in \
  'Only the selected servers will be added to this priority level.' \
  'Servers that should not be added to this priority level.' \
  'Exclude servers from this level using a regular expression.'; do
  grep -Fq "$description" <<<"$fallback_options" ||
    fail "Fallback filter description is missing: $description"
done
for description in \
  'Add servers whose names match the regular expression.' \
  'Optional. Remove specific servers from the selection above.' \
  'Optional. Exclude servers from the selection above using a regular expression.'; do
  grep -Fq "$description" "$SECTION_JS" ||
    fail "shared server filter description is missing: $description"
done
grep -Fq '{ value: "direct", label: _("Direct") }' <<<"$fallback_options" ||
  fail "Fallback direct mode must use the concise Direct label"
for label in 'Subscription server filter' 'URLTest group filter' 'Level server filter'; do
  grep -Fq "$label" "$SECTION_JS" ||
    fail "context-specific filter selector is missing: $label"
done
if grep -Fq '"filter_enabled"' "$SECTION_JS"; then
  fail "server filter toggle must stay removed"
fi
if grep -Fq 'form.Flag' <<<"$fallback_options"; then
  fail "Fallback Direct must not use a separate toggle"
fi
if grep -Eq 'include_countries|exclude_countries|countryChoices' <<<"$server_filter_options$fallback_options"; then
  fail "server filters must not expose country selectors"
fi
grep -Fq 'Add at least one Fallback level' "$SECTION_JS" ||
  fail "Fallback settings must require at least one level"
for option in health_check_url health_check_interval health_check_timeout idle_timeout interrupt_exist_connections; do
  grep -Fq "\"$option\"" <<<"$fallback_group_options" ||
    fail "Fallback settings are missing $option"
done
grep -Fq 'health_check_interval: "5m"' "$SECTION_JS" ||
  fail "Fallback health interval default must match Mihomo"
grep -Fq 'health_check_timeout: "5s"' "$SECTION_JS" ||
  fail "Fallback health timeout default must match Mihomo"
grep -Fq 'idle_timeout: "5m"' "$SECTION_JS" ||
  fail "Fallback idle timeout must preserve Mihomo lazy behavior"
grep -Fq 'interrupt_exist_connections: "1"' "$SECTION_JS" ||
  fail "Fallback connection interruption must be enabled by default"
if grep -Fq 'blacklist_timeout' <<<"$fallback_group_options"; then
  fail "Fallback settings still expose blacklist_timeout"
fi
grep -Fq 'defaults.name = `Priority #${number}`;' "$SECTION_JS" ||
  fail "new Fallback levels must receive sequential Priority names"
if grep -Eq 'dashboard_(filter|include|exclude|detect)|Servers on dashboard|addDashboardServerFilterOptions' "$SECTION_JS"; then
  fail "legacy section-wide dashboard server filtering must stay removed"
fi
if grep -Eq 'country_is|detect_server_country|Detect server country' "$SECTION_JS"; then
  fail "server country detection choices must stay removed"
fi
grep -Fq 'o.onListChange = refreshDashboardFilterChoiceWidgets;' "$SECTION_JS" ||
  fail "new servers and groups must refresh live filter selectors immediately"
grep -Fq 'const widget = new ui.DynamicList(values, labels, {' <<<"$live_choices" ||
  fail "live selectors must always render the stock DynamicList combobox"
grep -Fq 'validate: L.bind(this.validate, this, section_id),' <<<"$live_choices" ||
  fail "dashboard selectors must use the LuCI 24.10-compatible validator binding"
if grep -Fq 'this.getValidator(section_id)' <<<"$live_choices"; then
  fail "dashboard selectors must not require the newer LuCI getValidator API"
fi
grep -Fq 'const node = widget.render();' <<<"$live_choices" ||
  fail "dashboard selectors must refresh their rendered DynamicList instance directly"
if grep -Fq 'form.DynamicList.prototype.renderWidget' <<<"$live_choices"; then
  fail "empty dashboard choices must not fall back to a plain DynamicList input"
fi
grep -Fq 'dashboardFilterChoiceRefreshers.get(section_id).add(refreshChoices);' <<<"$live_choices" ||
  fail "dashboard selectors must register the rendered modal widget for source changes"
grep -Fq 'node.addEventListener("mousedown", refreshBeforeOpening, true);' <<<"$live_choices" ||
  fail "dashboard selectors must refresh choices before opening"
grep -Fq 'if (currentSignature === choiceSignature)' "$SECTION_JS" ||
  fail "dashboard selectors must not rebuild unchanged choices while selecting an item"
grep -Fq 'Add an HTTP(S) URL or local path. The format is detected automatically.' <<<"$create_section" ||
  fail "universal rule sets must explain automatic format detection"
grep -Fq 'ruleSetOption.hasItemSettings = function (section_id)' <<<"$create_section" ||
  fail "routing actions must retain per-item subnet settings"
if grep -Eq 'domainIpListsOption|dnsDomainListsOption|dnsRuleSetOption|domain_ip_lists' <<<"$create_section"; then
  fail "legacy domain/IP list controls must stay removed"
fi

grep -Fq 'background: transparent !important;' <<<"$close_all_styles" ||
  fail "close-all hover must match the pause button's transparent background"
grep -Fq 'color: color-mix(in srgb, var(--fkp-monitoring-danger-color) 70%, white) !important;' <<<"$close_all_styles" ||
  fail "close-all hover must highlight its icon"

printf 'LuCI DynamicList layout checks passed\n'
