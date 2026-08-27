// The DynamicList rows a section is built out of - subscriptions, interfaces,
// tunnels, URLTest and Fallback groups - and the settings button beside each one.
//
// LuCI's DynamicList is a list of text inputs with an add field at the bottom.
// Forkop hangs a settings button next to each row and, for some lists, replaces
// the add field with a button. Neither is something LuCI supports, so both are
// built out of the theme's own classes and measured against the row rather than
// styled: a colour or a border of our own would look wrong in every theme but the
// one it was written against, and a hard-coded height would break the moment the
// row wraps. That is what most of the rules below are.
//
// The behaviour these rows carry is exercised as calls elsewhere - the header
// grid, the shared filter fields, the generated names and the subscription option
// set all have colocated tests under src.
import fs from 'fs';

import { describe, expect, it } from 'vitest';

import { SRC } from '../lib/paths.js';
import { tabDeclaration, tabSource } from '../lib/tabSource.js';

const section = await tabSource('sections');

// The block of a CSS rule, from its selector to the closing brace in column zero.
function cssRule(selector) {
  const start = section.indexOf(`\n${selector} {`);
  expect(start, `${selector} was not found`).toBeGreaterThanOrEqual(0);
  const end = section.indexOf('\n}', start);
  return section.slice(start, end);
}

const listStyles = cssRule('.fkp-connections-dynlist');
const settingsStyles = cssRule(
  '.fkp-connections-dynlist > .fkp-dynlist-settings',
);
const itemStyles = cssRule('.fkp-connections-dynlist > .item');

const settingsWidget = await tabDeclaration(
  'sections',
  'SettingsUIDynamicList',
);
const buttonAddWidget =
  (await tabDeclaration('sections', 'updateButtonAddDynamicListLayout')) +
  (await tabDeclaration('sections', 'ButtonAddSettingsUIDynamicList'));
const subscriptionOptions = await tabDeclaration(
  'sections',
  'addSubscriptionUrlItemOptions',
);
const serverFilterOptions = await tabDeclaration(
  'sections',
  'addServerFilterOptions',
);
const urltestOptions = await tabDeclaration(
  'sections',
  'addUrlTestItemOptions',
);
const fallbackOptions = await tabDeclaration(
  'sections',
  'addFallbackLevelItemOptions',
);
const fallbackGroupOptions = await tabDeclaration(
  'sections',
  'addFallbackGroupItemOptions',
);
// The rows a URLTest and a Fallback group ask the same way are declared once.
const sharedHealthCheck =
  (await tabDeclaration('sections', 'addExpectedStatusOption')) +
  (await tabDeclaration('sections', 'addGroupHealthCheckTailOptions'));
const createSection = await tabDeclaration('sections', 'createSectionContent');
const liveChoices = await tabDeclaration(
  'sections',
  'configureLiveDynamicListChoices',
);
const subscriptionKeys = [
  'remoteSubscriptionUrlSettingsKeys',
  'subscriptionUrlSettingsKeys',
  'cleanupRemoteSubscriptionUrlSettings',
  'defaultSubscriptionUrlSettings',
]
  .map((name) => tabDeclaration('sections', name))
  .reduce(async (all, one) => (await all) + (await one), Promise.resolve(''));
const subscriptionHeaderEditor = fs.readFileSync(
  `${SRC}/forkop/tabs/sections/subscriptions/headers.ts`,
  'utf8',
);

/* ------------------------------------------------------ the add-item button */

describe('a list whose add field is a button', () => {
  it.each([
    // The dropdown surface is what the theme already styles as an add control.
    [
      'uses the native LuCI dropdown surface',
      "addButton.className = 'cbi-dropdown fkp-button-add-control';",
    ],
    [
      'uses the native dropdown label structure',
      "E('li', { placeholder: '', selected: '', display: '0' })",
    ],
    [
      // A zero-width space, written as an escape, so the empty label still
      // occupies a line.
      'retains the native dropdown line height',
      "E('span', { 'aria-hidden': 'true' }, '\\u200b')",
    ],
    ['does not retain the text-input layout', 'input?.remove();'],
    [
      'preserves click and keyboard behaviour',
      "event.target.closest('.add-item > .fkp-button-add-control')",
    ],
  ])('%s', (_label, expected) => {
    expect(buttonAddWidget).toContain(expected);
  });

  it('carries no theme-specific presentation CSS', () => {
    expect(section).not.toContain('.fkp-button-add-dynlist > .add-item');
  });
});

/* --------------------------------------------------- the settings button row */

describe('the settings button beside a row', () => {
  it('shares one grid with the values', () => {
    expect(listStyles).toContain('display: inline-grid;');
    expect(listStyles).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(listStyles).toContain('column-gap: var(--fkp-dynlist-action-gap);');
  });

  it('sits in its own column, outside the value field', () => {
    expect(itemStyles).toContain('grid-column: 1;');
    expect(settingsStyles).toContain('grid-column: 2;');
  });

  it.each([
    [
      'follows the measured value row height',
      'block-size: var(--fkp-dynlist-row-size, auto);',
    ],
    [
      'keeps its theme-relative width',
      'inline-size: var(--fkp-dynlist-action-size) !important;',
    ],
    ['overrides oversized theme minimum heights', 'min-block-size: 0;'],
    ['overrides oversized theme minimum widths', 'min-inline-size: 0;'],
    [
      "aligns with the value's inner border edge",
      'margin-block-start: var(--fkp-dynlist-row-offset, 0px);',
    ],
  ])('%s', (_label, declaration) => {
    expect(settingsStyles).toContain(declaration);
  });

  // Colour, framing and shadow belong to whichever theme the user has.
  it('leaves its colours and framing to the theme', () => {
    expect(settingsStyles).not.toMatch(
      /^[\t ]*(background|border(-|:)|box-shadow|color:)/m,
    );
  });

  it('is a native neutral LuCI button', () => {
    expect(section).toContain(
      "'btn cbi-button cbi-button-neutral fkp-dynlist-settings'",
    );
  });

  it('shows no redundant hover tooltip', () => {
    expect(settingsWidget).not.toContain("title: _('Settings')");
  });

  it.each([
    // A child of the row would take the row's hover styling with it.
    ['is a DOM sibling of its row', 'item.after(settingsButton);'],
    ['is removed with its value', 'settingsButton.remove();'],
    [
      'follows its value after drag-and-drop',
      'this.syncSettingsButtons(node);',
    ],
    [
      'stays paired when mobile dragging starts',
      "node.addEventListener('touchstart', () => this.syncSettingsButtons(node));",
    ],
    [
      'stays paired while mobile dragging moves',
      "node.addEventListener('touchmove', () => this.syncSettingsButtons(node));",
    ],
    ['tracks responsive row heights', 'new ResizeObserver((entries) =>'],
    [
      "measures the value's inner height",
      'const height = item && item.clientHeight;',
    ],
    ["follows the value's actual border offset", '`${item.clientTop}px`'],
    [
      'uses the measured row height',
      "button.style.setProperty('--fkp-dynlist-row-size', `${height}px`);",
    ],
  ])('%s', (_label, expected) => {
    expect(settingsWidget).toContain(expected);
  });
});

/* ------------------------------------------------------------ subscriptions */

describe('the subscription settings', () => {
  it('expose the native provider filters', () => {
    expect(subscriptionOptions).toContain(
      'addServerFilterOptions(itemSection, parentSectionForItem, {',
    );
  });

  it('load their own provider nodes for the exact-name filters', () => {
    expect(section).toContain(
      'loadSubscriptionOutboundNameChoices(sectionId, options.ownerId());',
    );
  });

  it.each(['server_filter_mode', 'include_regex', 'exclude_regex', 'header'])(
    'persist %s',
    async (key) => {
      expect(await subscriptionKeys).toContain(`'${key}'`);
    },
  );

  it('persist no legacy HWID control', async () => {
    expect(await subscriptionKeys).not.toMatch(/'auto_hwid'|'hwid'/);
  });

  it('offer the header editor as a native LuCI button', () => {
    expect(subscriptionOptions).toContain('form.Button');
    expect(subscriptionOptions).toContain("_('Headers')");
  });

  it('hide the tag until subscription names are enabled', () => {
    expect(subscriptionOptions).toContain(
      "o.depends('show_subscription_name', '1');",
    );
  });

  it('remove stale remote options when a local subscription is saved', () => {
    expect(section).toMatch(
      /if \(!remote && existing\) cleanupRemoteSubscriptionUrlSettings\(itemId\);/,
    );
  });
});

describe('the subscription header grid', () => {
  it.each([
    ['is a native LuCI grid', 'form.GridSection'],
    ['does not repeat the modal title', 'headers.hidetitle = true'],
    ['adds an inline row', 'headers.handleAdd = function'],
    ['removes one inline row', 'headers.handleRemove = function'],
    ['preserves unsaved inline values', 'syncSubscriptionHeaderRows(section)'],
    ['reloads cached inline values', 'refreshSubscriptionHeaderRows(section)'],
    [
      'exposes delete without a nested edit action',
      'form.TableSection.prototype.renderRowActions.call',
    ],
  ])('%s', (_label, expected) => {
    expect(subscriptionHeaderEditor).toContain(expected);
  });

  it('opens no nested add modal', () => {
    expect(subscriptionHeaderEditor).not.toContain('headers.modaltitle');
  });
});

/* ----------------------------------------------------------- server filters */

describe('the server filters', () => {
  it('stay comboboxes when there are no choices to offer', () => {
    expect(serverFilterOptions).toContain(
      '(itemId) => choicesForItem(field, itemId),',
    );
    expect(fallbackOptions).toContain(
      'addServerFilterOptions(itemSection, parentSectionForItem, {',
    );
  });

  it('use single-value fields for the regular expressions', () => {
    expect(serverFilterOptions).toContain('form.Value');
  });

  it('use an explicit mode selector', () => {
    expect(serverFilterOptions).toContain('form.ListValue');
  });

  it('do not emulate group headings with dummy rows', () => {
    expect(serverFilterOptions).not.toContain('form.DummyValue');
  });

  it.each([
    'Include servers',
    'Include by pattern',
    'Exclude servers',
    'Exclude by pattern',
  ])('label their %s field', (label) => {
    expect(serverFilterOptions).toContain(label);
  });

  it('share one uci option between the two modes', () => {
    expect(serverFilterOptions).toContain('field.ucioption = storageKey;');
    expect(section).toContain(
      'targetElement.setValue(sourceElement.getValue());',
    );
  });

  // The three filter blocks read the same help out of one place, so the only
  // thing each block chooses is whether its servers end up in a group or are
  // imported.
  it('take the shared descriptions rather than spelling them out', () => {
    expect(subscriptionOptions).toContain(
      '...subscriptionServerFilterDescriptions(),',
    );
    expect(urltestOptions).toContain('...groupServerFilterDescriptions(),');
    expect(fallbackOptions).toContain('...groupServerFilterDescriptions(),');
    expect(subscriptionOptions + urltestOptions + fallbackOptions).not.toMatch(
      /includeServersDescription|excludeTypesDescription|ExcludeServersDescription|excludeRegexDescription/,
    );
  });

  it.each([
    'The servers that end up in the group',
    'The servers that do not end up in the group',
    'Servers of these protocols do not end up in the group',
    'The servers that are imported',
    'The servers that are not imported',
    'Servers of these protocols are not imported',
    'Servers whose names match the regular expression',
    'Remove servers whose names match the regular expression',
    'Remove servers from the selection above',
  ])('describe what they do: %s', (description) => {
    expect(section).toContain(description);
  });

  // Naming a mode after the list it keeps means remembering which list is which.
  it('say what a mode selects rather than which list it is', () => {
    expect(section).not.toMatch(/_\('Blacklist'\)|_\('Whitelist'\)/);
  });

  it.each(['All except selected', 'Only selected', 'All remaining'])(
    'label the %s mode',
    (label) => {
      expect(section).toContain(label);
    },
  );

  it('call the selector the same thing everywhere', () => {
    expect(section).toContain('Server filter');
    expect(section).not.toContain('Server group filter');
  });

  it('need no enabling toggle', () => {
    expect(section).not.toContain("'filter_enabled'");
    expect(fallbackOptions).not.toContain('form.Flag');
  });

  it('offer no country selector', () => {
    expect(serverFilterOptions + fallbackOptions).not.toMatch(
      /include_countries|exclude_countries|countryChoices/,
    );
  });

  it('label the Fallback direct mode concisely', () => {
    expect(fallbackOptions).toContain(
      "{ value: 'direct', label: _('Direct') }",
    );
  });
});

/* ------------------------------------------------------- the Fallback group */

describe('a Fallback group', () => {
  it('requires at least one server group', () => {
    expect(section).toContain('Add at least one server group');
  });

  it.each([
    'health_check_url',
    'health_check_interval',
    'health_check_timeout',
    'attempt_timeout',
  ])('asks for %s', (option) => {
    expect(fallbackGroupOptions).toMatch(new RegExp(`'${option}'`));
  });

  it.each(['expected_status', 'idle_timeout', 'interrupt_exist_connections'])(
    'takes %s from the shared health check rows',
    (option) => {
      expect(sharedHealthCheck).toMatch(new RegExp(`'${option}'`));
    },
  );

  // The value an option is declared with, out of the block that declares it.
  const declaredDefault = (block, name) => {
    const match = block.match(
      new RegExp(`'${name}',[\\s\\S]*?\\);\\n  o\\.default = '([^']+)';`),
    );
    expect(match, `no declared default for ${name}`).toBeTruthy();
    return match[1];
  };

  it.each([
    ['health_check_interval', '5m'],
    ['health_check_timeout', '5s'],
    ['attempt_timeout', '5s'],
  ])('defaults %s to the Mihomo value %s', (option, value) => {
    expect(declaredDefault(fallbackGroupOptions, option)).toBe(value);
  });

  it.each([
    ['expected_status', '*'],
    ['interrupt_exist_connections', '0'],
  ])('defaults the shared %s to %s', (option, value) => {
    expect(declaredDefault(sharedHealthCheck, option)).toBe(value);
  });

  it('stops checking after five idle minutes', () => {
    expect(fallbackGroupOptions).toMatch(
      /addGroupHealthCheckTailOptions\(itemSection, '5m'\)/,
    );
  });

  it('asks which replies count as an answer', () => {
    expect(fallbackGroupOptions).toMatch(
      /addExpectedStatusOption\(itemSection\)/,
    );
  });

  it('offers the shared latency test URLs', () => {
    expect(fallbackGroupOptions).toMatch(
      /LATENCY_TEST_URL_OPTIONS\.forEach\(\(value\) => o\.value\(value\)\);/,
    );
  });

  it.each([
    ["health_check_interval: '5m'", 'health interval'],
    ["health_check_timeout: '5s'", 'health timeout'],
    ["idle_timeout: '5m'", 'idle timeout'],
    ["attempt_timeout: '5s'", 'attempt timeout'],
  ])('seeds a new group with %s', (seed) => {
    expect(section).toContain(seed);
  });

  it('leaves connection interruption off by default', () => {
    expect(section).not.toContain("interrupt_exist_connections: '1'");
  });

  it('keeps the failure counter a core constant rather than a setting', () => {
    expect(fallbackGroupOptions).not.toContain("'max_failed_times'");
  });

  it('no longer exposes blacklist_timeout', () => {
    expect(fallbackGroupOptions).not.toContain('blacklist_timeout');
  });
});

/* ------------------------------------------------------ the live selectors */

describe('the dashboard filter selectors', () => {
  it('refresh as soon as a new server or group is added', () => {
    expect(section).toContain(
      'o.onListChange = refreshDashboardFilterChoiceWidgets;',
    );
  });

  it.each([
    [
      'always render the stock DynamicList combobox',
      'const widget = new ui.DynamicList(values, labels, {',
    ],
    [
      'use the LuCI 24.10-compatible validator binding',
      'validate: L.bind(this.validate, this, section_id),',
    ],
    ['refresh the rendered instance directly', 'const node = widget.render();'],
    [
      'register the rendered modal widget for source changes',
      'dashboardFilterChoiceRefreshers.get(refreshSectionId).add(refreshChoices);',
    ],
    [
      'refresh their choices before opening',
      "node.addEventListener('mousedown', refreshBeforeOpening, true);",
    ],
  ])('%s', (_label, expected) => {
    expect(liveChoices).toContain(expected);
  });

  it('do not require the newer LuCI getValidator API', () => {
    expect(liveChoices).not.toContain('this.getValidator(section_id)');
  });

  it('do not fall back to a plain DynamicList input when empty', () => {
    expect(liveChoices).not.toContain(
      'form.DynamicList.prototype.renderWidget',
    );
  });

  it('do not rebuild unchanged choices while an item is being selected', () => {
    expect(section).toContain('if (currentSignature === choiceSignature)');
  });

  it('do not rewrite the selected values', () => {
    expect(liveChoices).not.toContain('widget.setValue(');
  });
});

/* ---------------------------------------------------------------- leftovers */

describe('the section form', () => {
  it('explains automatic rule set format detection', () => {
    expect(createSection).toContain(
      'A URL or local path. The format is detected automatically',
    );
  });

  it('retains per-item subnet settings for routing actions', () => {
    expect(createSection).toContain(
      'ruleSetOption.hasItemSettings = function (section_id)',
    );
  });

  it('keeps no legacy domain or IP list control', () => {
    expect(createSection).not.toMatch(
      /domainIpListsOption|dnsDomainListsOption|domain_ip_lists/,
    );
  });

  it.each(["'Tunnel'", "'URLTest'", "'Fallback'", "'Group'"])(
    'can generate the name %s',
    (name) => {
      expect(section).toContain(name);
    },
  );

  it('keeps section-wide dashboard server filtering removed', () => {
    expect(section).not.toMatch(
      /dashboard_(filter|include|exclude|detect)|Servers on dashboard|addDashboardServerFilterOptions/,
    );
  });

  it('keeps server country detection removed', () => {
    expect(section).not.toMatch(
      /country_is|detect_server_country|Detect server country/,
    );
  });
});

// The Monitoring tab's close-all button is the same icon button as its pause
// button, and only its icon colour says what it does.
describe('the Monitoring close-all button', () => {
  const closeAll = (() => {
    const styles = fs.readFileSync(
      `${SRC}/forkop/tabs/monitoring/styles.ts`,
      'utf8',
    );
    const selector =
      '.fkp_monitoring-page #monitoring-close-all.btn.fkp_monitoring-page__icon-button:hover:not(:disabled)';
    const start = styles.indexOf(`\n${selector} {`);
    expect(
      start,
      'the close-all hover rule was not found',
    ).toBeGreaterThanOrEqual(0);
    return styles.slice(start, styles.indexOf('\n}', start));
  })();

  it("keeps the pause button's transparent background", () => {
    expect(closeAll).toContain('background: transparent !important;');
  });

  it('highlights its icon', () => {
    expect(closeAll).toContain(
      'color: color-mix(in srgb, var(--fkp-monitoring-danger-color) 70%, white) !important;',
    );
  });
});
