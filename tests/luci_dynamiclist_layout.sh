#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js"
MONITORING_STYLES="$ROOT_DIR/fe-app-forkop/src/forkop/tabs/monitoring/styles.ts"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

settings_list_styles="$(sed -n '/^\.fkp-connections-dynlist {$/,/^}$/p' "$SECTION_JS")"
settings_styles="$(sed -n '/^\.fkp-connections-dynlist > \.fkp-dynlist-settings {$/,/^}$/p' "$SECTION_JS")"
settings_item_styles="$(sed -n '/^\.fkp-connections-dynlist > \.item {$/,/^}$/p' "$SECTION_JS")"
settings_widget="$(sed -n '/^const SettingsUIDynamicList =/,/^const ButtonAddSettingsUIDynamicList/p' "$SECTION_JS")"
button_add_widget="$(sed -n '/^function updateButtonAddDynamicListLayout(/,/^function setDynamicListItemValue(/p' "$SECTION_JS"; sed -n '/^const ButtonAddSettingsUIDynamicList =/,/^const SettingsDynamicList/p' "$SECTION_JS")"
subscription_keys="$(sed -n '/^function remoteSubscriptionUrlSettingsKeys(/,/^function defaultSubscriptionUrlSettings(/p' "$SECTION_JS")"
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
const subscriptionValidationSource = source.match(
  /function parseSubscriptionUrlEntry\([\s\S]*?\n}\n\nfunction escapeHtml\(/,
);
assert(subscriptionValidationSource, 'subscription validation helpers not found');
const validateSubscription = new Function(
  'main',
  '_',
  `${subscriptionValidationSource[0].slice(0, -'\n\nfunction escapeHtml('.length)}; return validateSubscriptionUrlEntry;`,
)(
  {
    validateUrl: (value) => ({ valid: /^https?:\/\/[^/]+/.test(value) }),
    validatePath: (value) => ({ valid: /^\/[a-zA-Z0-9_\-/.]+$/.test(value) }),
  },
  (value) => value,
);
assert.strictEqual(validateSubscription('settings', 'https://example.com/sub'), true);
assert.strictEqual(validateSubscription('settings', '/etc/forkop/subscription.txt'), true);
assert.match(validateSubscription('settings', 'relative/subscription.txt'), /absolute local path/);

const subscriptionOptionsSource = source.match(
  /function addSubscriptionUrlItemOptions\([\s\S]*?\n}\n\nfunction addInterfaceItemOptions\(/,
);
assert(subscriptionOptionsSource, 'subscription options not found');
const addSubscriptionOptions = new Function(
  'form',
  '_',
  'addServerFilterOptions',
  'subscriptionServerFilterDescriptions',
  `${subscriptionOptionsSource[0].slice(0, -'\n\nfunction addInterfaceItemOptions('.length)}; return addSubscriptionUrlItemOptions;`,
)(
  { Flag: 'flag', Value: 'value', ListValue: 'list', Button: 'button' },
  (value) => value,
  (section) => section.created.push('server_filter_mode'),
  // The shared help is asserted against the source below; only names matter here.
  () => ({}),
);
const optionNames = (remote) => {
  const section = {
    created: [],
    map: {},
    option: (_type, name) => {
      section.created.push(name);
      return { depends() {}, value() {} };
    },
  };
  addSubscriptionOptions(section, { remote, parentSectionId: () => 'proxy' });
  return section.created;
};
const remoteOptionNames = optionNames(true);
const localOptionNames = optionNames(false);
[
  'subscription_update_enabled',
  'subscription_update_interval',
  'download_via_proxy_enabled',
  'download_via_proxy_section',
  '_subscription_headers',
  'show_dashboard_metadata',
].forEach((name) => {
  assert(remoteOptionNames.includes(name), `remote subscription option missing: ${name}`);
  assert(!localOptionNames.includes(name), `local subscription exposes remote option: ${name}`);
});
['show_subscription_name', 'tag', 'server_filter_mode'].forEach((name) =>
  assert(localOptionNames.includes(name), `local subscription option missing: ${name}`),
);
assert.match(
  source,
  /if \(!remote && existing\) cleanupRemoteSubscriptionUrlSettings\(itemId\);/,
  'saving existing local subscription settings must remove stale remote options',
);

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
assert.strictEqual(fallbackDefault('attempt_timeout'), '5s');
assert.strictEqual(fallbackDefault('expected_status'), '*');
assert.strictEqual(fallbackDefault('idle_timeout'), '5m');
assert.strictEqual(fallbackDefault('interrupt_exist_connections'), '0');
assert.match(
  fallbackSource,
  /urlTestUrlChoices\(\)\.forEach\(\(value\) => o\.value\(value\)\);/,
);
const helper = source.match(
  /function syncServerFilterFields\([\s\S]*?\n}\n\nfunction addServerFilterOptions\(/,
);
assert(helper, 'server filter synchronization helper not found');
eval(helper[0].slice(0, -'\n\nfunction addServerFilterOptions('.length));

const nameHelpers = source.match(
  /function normalizeDynamicListItems\([\s\S]*?\n}\n\nfunction uniqueDynamicListItems\(/,
);
assert(nameHelpers, 'DynamicList name helper not found');
eval(nameHelpers[0].slice(0, -'\n\nfunction uniqueDynamicListItems('.length));

const visibleItems = { value: [] };
const nameOption = { formvalue: () => visibleItems.value };
assert.strictEqual(
  nextDynamicListName(nameOption, 'settings', ['saved-1', 'saved-2'], 'Group'),
  'Group #1',
  'deleted unsaved rows must not affect the next generated name',
);
visibleItems.value = ['visible-1', 'visible-2'];
assert.strictEqual(
  nextDynamicListName(nameOption, 'settings', [], 'Group'),
  'Group #3',
);

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

grep -Fq 'addButton.className = "cbi-dropdown fkp-button-add-control";' <<<"$button_add_widget" ||
  fail "button-only DynamicList actions must use the native LuCI dropdown surface"
grep -Fq 'E("li", { placeholder: "", selected: "", display: "0" })' <<<"$button_add_widget" ||
  fail "button-only DynamicList actions must use the native dropdown label structure"
grep -Fq 'E("span", { "aria-hidden": "true" }, "\u200b")' <<<"$button_add_widget" ||
  fail "button-only DynamicList actions must retain the native dropdown line height"
grep -Fq 'input?.remove();' <<<"$button_add_widget" ||
  fail "button-only DynamicList actions must not retain the text-input layout"
grep -Fq 'event.target.closest(".add-item > .fkp-button-add-control")' <<<"$button_add_widget" ||
  fail "button-only DynamicList actions must preserve click and keyboard behavior"
if grep -Fq '.fkp-button-add-dynlist > .add-item' "$SECTION_JS"; then
  fail "button-only DynamicList actions must not carry theme-specific presentation CSS"
fi
grep -Fq 'display: inline-grid;' <<<"$settings_list_styles" ||
  fail "DynamicList values and settings buttons must use a shared grid"
grep -Fq 'grid-template-columns: minmax(0, 1fr) auto;' <<<"$settings_list_styles" ||
  fail "DynamicList settings buttons must occupy a separate content-sized column"
grep -Fq 'column-gap: var(--fkp-dynlist-action-gap);' <<<"$settings_list_styles" ||
  fail "DynamicList settings buttons must keep a theme-relative gap from values"
grep -Fq 'grid-column: 1;' <<<"$settings_item_styles" ||
  fail "DynamicList values must stay in the value column"
grep -Fq 'grid-column: 2;' <<<"$settings_styles" ||
  fail "DynamicList settings buttons must sit outside the value field"
grep -Fq 'block-size: var(--fkp-dynlist-row-size, auto);' <<<"$settings_styles" ||
  fail "DynamicList settings buttons must follow their measured value row height"
grep -Fq 'inline-size: var(--fkp-dynlist-action-size) !important;' <<<"$settings_styles" ||
  fail "DynamicList settings buttons must preserve their original theme-relative width"
grep -Fq 'min-block-size: 0;' <<<"$settings_styles" ||
  fail "DynamicList settings buttons must override oversized theme minimum heights"
grep -Fq 'min-inline-size: 0;' <<<"$settings_styles" ||
  fail "DynamicList settings buttons must override oversized theme minimum widths"
grep -Fq 'margin-block-start: var(--fkp-dynlist-row-offset, 0px);' <<<"$settings_styles" ||
  fail "DynamicList settings buttons must align with the value's inner border edge"
grep -Fq '"btn cbi-button cbi-button-neutral fkp-dynlist-settings"' "$SECTION_JS" ||
  fail "DynamicList settings actions must use a native neutral LuCI button"
grep -Fq 'item.after(settingsButton);' <<<"$settings_widget" ||
  fail "DynamicList settings actions must be DOM siblings so item hover stays isolated"
grep -Fq 'settingsButton.remove();' <<<"$settings_widget" ||
  fail "DynamicList settings actions must be removed with their value"
grep -Fq 'this.syncSettingsButtons(node);' <<<"$settings_widget" ||
  fail "DynamicList settings actions must follow values after drag-and-drop"
grep -Fq 'node.addEventListener("touchstart", () => this.syncSettingsButtons(node));' <<<"$settings_widget" ||
  fail "DynamicList settings actions must stay paired when mobile dragging starts"
grep -Fq 'node.addEventListener("touchmove", () => this.syncSettingsButtons(node));' <<<"$settings_widget" ||
  fail "DynamicList settings actions must stay paired while mobile dragging moves"
grep -Fq 'new ResizeObserver((entries) =>' <<<"$settings_widget" ||
  fail "DynamicList settings actions must track responsive value row heights"
grep -Fq 'const height = item && item.clientHeight;' <<<"$settings_widget" ||
  fail "DynamicList settings actions must measure the value's inner height"
grep -Fq '`${item.clientTop}px`' <<<"$settings_widget" ||
  fail "DynamicList settings actions must follow the value's actual border offset"
grep -Fq 'button.style.setProperty("--fkp-dynlist-row-size", `${height}px`);' <<<"$settings_widget" ||
  fail "DynamicList settings actions must use the measured value row height"
if grep -Fq 'title: _("Settings")' <<<"$settings_widget"; then
  fail "DynamicList settings actions must not expose a redundant hover tooltip"
fi
if grep -Eq '^[[:space:]]*(background|border(-|:)|box-shadow|color:)' <<<"$settings_styles"; then
  fail "DynamicList settings button colors and framing must remain theme-owned"
fi

grep -Fq 'addServerFilterOptions(itemSection, parentSectionForItem, {' <<<"$subscription_options" ||
  fail "subscription settings must expose native provider filters"
grep -Fq 'loadSubscriptionOutboundNameChoices(sectionId, options.ownerId());' "$SECTION_JS" ||
  fail "subscription exact-name filters must load their own provider nodes"
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
grep -Fq '_("Headers")' <<<"$subscription_options" ||
  fail "subscription settings header editor button is missing"
grep -Fq 'o.depends("show_subscription_name", "1");' <<<"$subscription_options" ||
  fail "subscription tag must stay hidden until subscription names are enabled"
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
grep -Fq 'configureLiveDynamicListChoices(field, (itemId) =>' <<<"$server_filter_options" ||
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
# The three filter blocks read the same help out of one place, so the only thing
# each block chooses is whether its servers end up in a group or are imported.
grep -Fq '...subscriptionServerFilterDescriptions(),' <<<"$subscription_options" ||
  fail "the subscription filter must take the shared descriptions"
for block in "$urltest_options" "$fallback_options"; do
  grep -Fq '...groupServerFilterDescriptions(),' <<<"$block" ||
    fail "a group filter must take the shared descriptions"
done
if grep -Eq 'includeServersDescription|excludeTypesDescription|ExcludeServersDescription|excludeRegexDescription' \
  <<<"$subscription_options$urltest_options$fallback_options"; then
  fail "a filter block must not spell out a description the shared helpers own"
fi
for description in \
  'The servers that end up in the group' \
  'The servers that do not end up in the group' \
  'Servers of these protocols do not end up in the group' \
  'The servers that are imported' \
  'The servers that are not imported' \
  'Servers of these protocols are not imported' \
  'Servers whose names match the regular expression' \
  'Remove servers whose names match the regular expression' \
  'Remove servers from the selection above'; do
  grep -Fq "$description" "$SECTION_JS" ||
    fail "server filter description is missing: $description"
done
# Naming a mode after the list it keeps means remembering which list is which.
if grep -Eq '_\("Blacklist"\)|_\("Whitelist"\)' "$SECTION_JS"; then
  fail "filter modes must say what they select, not which list they are"
fi
for label in 'All except selected' 'Only selected' 'All remaining'; do
  grep -Fq "$label" "$SECTION_JS" ||
    fail "filter mode label is missing: $label"
done
grep -Fq '{ value: "direct", label: _("Direct") }' <<<"$fallback_options" ||
  fail "Fallback direct mode must use the concise Direct label"
grep -Fq 'Server filter' "$SECTION_JS" ||
  fail "server filter selector is missing"
if grep -Fq 'Server group filter' "$SECTION_JS"; then
  fail "the Fallback group filter must use the same label as the other two"
fi
if grep -Fq '"filter_enabled"' "$SECTION_JS"; then
  fail "server filter toggle must stay removed"
fi
if grep -Fq 'form.Flag' <<<"$fallback_options"; then
  fail "Fallback Direct must not use a separate toggle"
fi
if grep -Eq 'include_countries|exclude_countries|countryChoices' <<<"$server_filter_options$fallback_options"; then
  fail "server filters must not expose country selectors"
fi
grep -Fq 'Add at least one server group' "$SECTION_JS" ||
  fail "Fallback settings must require at least one server group"
for option in health_check_url health_check_interval health_check_timeout attempt_timeout expected_status idle_timeout interrupt_exist_connections; do
  grep -Fq "\"$option\"" <<<"$fallback_group_options" ||
    fail "Fallback settings are missing $option"
done
if grep -Fq '"max_failed_times"' <<<"$fallback_group_options"; then
  fail "the failure counter must stay a core constant instead of a setting"
fi
grep -Fq 'health_check_interval: "5m"' "$SECTION_JS" ||
  fail "Fallback health interval default must match Mihomo"
grep -Fq 'health_check_timeout: "5s"' "$SECTION_JS" ||
  fail "Fallback health timeout default must match Mihomo"
grep -Fq 'idle_timeout: "5m"' "$SECTION_JS" ||
  fail "Fallback idle timeout must preserve Mihomo lazy behavior"
grep -Fq 'attempt_timeout: "5s"' "$SECTION_JS" ||
  fail "Fallback attempt timeout default is missing"
if grep -Fq 'interrupt_exist_connections: "1"' "$SECTION_JS"; then
  fail "group connection interruption must be disabled by default"
fi
if grep -Fq 'blacklist_timeout' <<<"$fallback_group_options"; then
  fail "Fallback settings still expose blacklist_timeout"
fi
for generated_name in \
  '"Tunnel"' \
  '"URLTest"' \
  '"Fallback"' \
  '"Group"'; do
  grep -Fq "$generated_name" "$SECTION_JS" ||
    fail "generated DynamicList name is missing: $generated_name"
done
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
grep -Fq 'dashboardFilterChoiceRefreshers.get(refreshSectionId).add(refreshChoices);' <<<"$live_choices" ||
  fail "dashboard selectors must register the rendered modal widget for source changes"
grep -Fq 'node.addEventListener("mousedown", refreshBeforeOpening, true);' <<<"$live_choices" ||
  fail "dashboard selectors must refresh choices before opening"
grep -Fq 'if (currentSignature === choiceSignature)' "$SECTION_JS" ||
  fail "dashboard selectors must not rebuild unchanged choices while selecting an item"
if grep -Fq 'widget.setValue(' <<<"$live_choices"; then
  fail "live choice refresh must not rewrite selected server filters"
fi
grep -Fq 'A URL or local path. The format is detected automatically.' <<<"$create_section" ||
  fail "universal rule sets must explain automatic format detection"
grep -Fq 'ruleSetOption.hasItemSettings = function (section_id)' <<<"$create_section" ||
  fail "routing actions must retain per-item subnet settings"
if grep -Eq 'domainIpListsOption|dnsDomainListsOption|domain_ip_lists' <<<"$create_section"; then
  fail "legacy domain/IP list controls must stay removed"
fi

grep -Fq 'background: transparent !important;' <<<"$close_all_styles" ||
  fail "close-all hover must match the pause button's transparent background"
grep -Fq 'color: color-mix(in srgb, var(--fkp-monitoring-danger-color) 70%, white) !important;' <<<"$close_all_styles" ||
  fail "close-all hover must highlight its icon"

printf 'LuCI DynamicList layout checks passed\n'
