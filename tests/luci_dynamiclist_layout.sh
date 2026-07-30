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
server_filter_options="$(sed -n '/^function addServerFilterOptions(/,/^function urlTestUrlChoices(/p' "$SECTION_JS")"
fallback_options="$(sed -n '/^function addFallbackLevelItemOptions(/,/^function addFallbackGroupItemOptions(/p' "$SECTION_JS")"
create_section="$(sed -n '/^function createSectionContent(/,/^function loadSectionTableOptions(/p' "$SECTION_JS")"
live_choices="$(sed -n '/^function configureLiveDynamicListChoices(/,/^function currentOutboundNameChoices(/p' "$SECTION_JS")"
close_all_styles="$(sed -n '/^\.fkp_monitoring-page #monitoring-close-all\.btn\.fkp_monitoring-page__icon-button:hover:not(:disabled) {$/,/^}$/p' "$MONITORING_STYLES")"

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
for key in filter_enabled include_regex exclude_regex; do
  grep -Fq "\"$key\"" <<<"$subscription_keys" ||
    fail "subscription/provider filter key $key is missing"
done
grep -Fq 'configureLiveDynamicListChoices(field, (itemId, values) =>' <<<"$server_filter_options" ||
  fail "URLTest server filters must stay comboboxes when no choices exist"
grep -Fq 'addServerFilterOptions(itemSection, parentSectionForItem, {' <<<"$fallback_options" ||
  fail "Fallback server filters must stay comboboxes when no choices exist"
grep -Fq 'form.Value' <<<"$server_filter_options" ||
  fail "server filter regular expressions must use single-value fields"
if grep -Eq 'include_countries|exclude_countries|countryChoices' <<<"$server_filter_options$fallback_options"; then
  fail "server filters must not expose country selectors"
fi
grep -Fq 'Add at least one Fallback level' "$SECTION_JS" ||
  fail "Fallback settings must require at least one level"
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
