#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js"

node - "$SECTION_JS" <<'NODE'
const assert = require('assert');
const fsNode = require('fs');

const source = fsNode.readFileSync(process.argv[2], 'utf8');
const helpers = source.match(
  /function nativeProviderOutboundNames\([\s\S]*?\nfunction readOutboundChoiceState\(/,
);
assert(helpers, 'native provider choice helpers not found');
const choiceLoader = source.match(
  /function loadOutboundNameChoices\([\s\S]*?\nfunction subscriptionProviderIndex\(/,
);
assert(choiceLoader, 'outbound choice loader not found');
const draftNames = source.match(
  /function currentDraftOutboundNames\([\s\S]*?\nfunction refreshDashboardFilterChoiceWidgets\(/,
);
assert(draftNames, 'draft outbound name helper not found');
const pendingStore = source.match(
  /function childPendingSettingsStore\([\s\S]*?\nfunction pendingChildSettings\(/,
);
assert(pendingStore, 'shared pending child settings helper not found');
const choiceItems = source.match(
  /function outboundNameChoiceItems\([\s\S]*?\nfunction currentOutboundNameChoices\(/,
);
assert(choiceItems, 'outbound choice item helper not found');

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const providerTag = 'main-subscription-1-provider';
const payload = {
  providers: {
    [providerTag]: {
      proxies: [
        { name: `${providerTag}/Main US`, type: 'VLESS' },
        { name: `${providerTag}/Main DE`, type: 'AnyTLS' },
        { name: `${providerTag}/Main Auto`, type: 'URLTest' },
      ],
    },
    'main-manual-provider': {
      proxies: [{ name: 'main-manual-provider/Removed manual node', type: 'VLESS' }],
    },
    'other-subscription-provider': {
      proxies: [{ name: 'other-subscription-provider/Other JP', type: 'VLESS' }],
    },
  },
};
let response = Promise.resolve({ stdout: JSON.stringify(payload) });
const calls = [];
const fs = {
  exec(path, args) {
    calls.push([path, args]);
    return response;
  },
};

eval(helpers[0].slice(0, -'\nfunction readOutboundChoiceState('.length));

const outboundNameChoicesCache = new Map();
const outboundNameChoicesInflight = new Map();
function readOutboundChoiceState() {
  return Promise.resolve({
    names: ['Removed manual node'],
    providerTags: [providerTag, 'main-manual-provider'],
  });
}
function refreshDashboardFilterChoiceWidgets() {}
eval(choiceLoader[0].slice(0, -'\nfunction subscriptionProviderIndex('.length));

function normalizeDynamicListItems(value) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}
eval(choiceItems[0].slice(0, -'\nfunction currentOutboundNameChoices('.length));

const sharedChildPendingSettings = new Map();
eval(pendingStore[0].slice(0, -'\nfunction pendingChildSettings('.length));
const interfaceOption = { sharedPendingSettingsKey: 'interfaces' };
const modalInterfaceOption = Object.assign({}, interfaceOption);
childPendingSettingsStore(modalInterfaceOption, 'main').new_interface = {
  display_name: 'Draft interface',
};

const draftSourceValues = {
  selector_proxy_links: ['vless://example.test#Draft%20URL'],
  interfaces: ['saved_interface', 'new_interface'],
  outbound_jsons: [
    '{"type":"socks","tag":"Leaf JSON"}',
    '{"type":"fallback","tag":"fallback"}',
    '{"type":"urltest","tag":"urltest"}',
  ],
};
function currentSourceOptionValues(_sectionId, optionName) {
  return draftSourceValues[optionName] || [];
}
const outboundNameSourceOptions = new Map([['interfaces', interfaceOption]]);
const UCI_PACKAGE = 'forkop';
const main = {
  getProxyUrlName(value) {
    const fragment = String(value || '').split('#')[1] || '';
    return decodeURIComponent(fragment);
  },
};
function childItemInputValue(_sectionId, itemId) {
  return itemId === 'saved_interface' ? 'lan1' : itemId;
}
function isExistingChildItem(_sectionId, itemId) {
  return itemId === 'saved_interface';
}
const uci = {
  get(_packageName, itemId, option) {
    return itemId === 'saved_interface' && option === 'display_name'
      ? 'Renamed interface'
      : null;
  },
};
function parseOutboundJsonObject(value) {
  return JSON.parse(value);
}
function outboundJsonDisplayTag(value) {
  return parseOutboundJsonObject(value).tag;
}
function tunnelChildIds() {
  return [];
}
function tunnelDisplayName() {
  return '';
}
eval(draftNames[0].slice(0, -'\nfunction refreshDashboardFilterChoiceWidgets('.length));

const sourceBinding = source.match(
  /o\.liveDynamicListNodes = new Map\(\);[\s\S]*?outboundNameSourceOptions\.set\("selector_proxy_links", o\);/,
);
assert(sourceBinding, 'connection URL DynamicList binding not found');
const sourceValues = ['vless://saved.example'];
const sourceEvents = {};
const sourceNode = {
  isConnected: true,
  addEventListener(name, handler) {
    sourceEvents[name] = handler;
  },
  querySelectorAll() {
    return sourceValues.map((value) => ({ value }));
  },
  querySelector() {
    return null;
  },
};
const refreshes = [];
function refreshDashboardFilterChoiceWidgets(sectionId) {
  refreshes.push(sectionId);
}
const o = {
  renderWidget() {
    return sourceNode;
  },
};
eval(sourceBinding[0]);
o.renderWidget('main', 0, []);
assert.strictEqual(
  o.liveDynamicListNodes.get('main'),
  sourceNode,
  'connection URL widget must be tracked by section',
);
sourceValues.length = 0;
sourceEvents['cbi-dynlist-change']();
assert.deepStrictEqual(
  refreshes,
  ['main'],
  'connection URL removal must refresh filter choices before Apply',
);
const liveReader = source.match(
  /function currentLiveDynamicListValues\([\s\S]*?\nfunction currentDraftOutboundNames\(/,
);
assert(liveReader, 'live DynamicList reader not found');
eval(liveReader[0].slice(0, -'\nfunction currentDraftOutboundNames('.length));
global.document = {
  getElementById() {
    throw new Error('stale duplicate DynamicList was used');
  },
};
assert.deepStrictEqual(
  currentLiveDynamicListValues('main', 'selector_proxy_links'),
  [],
  'filter choices must read the tracked URL widget after removal',
);
delete global.document;

assert.deepStrictEqual(nativeProviderOutboundNames([providerTag], payload), [
  'Main US',
  'Main DE',
]);
assert.strictEqual(
  subscriptionSourceOutboundName('Main US', '1', 'Main'),
  'US',
  'subscription filter must use the pre-tag_prefix node name',
);
assert.strictEqual(
  subscriptionSourceOutboundName('Main US', '0', 'Main'),
  'Main US',
  'disabled prefixing must leave the node name unchanged',
);
assert.strictEqual(
  subscriptionSourceOutboundName('Mainland US', '1', 'Main'),
  'Mainland US',
  'partial prefix matches must not change the node name',
);

(async () => {
  assert.deepStrictEqual(await loadNativeProviderOutboundNames([providerTag]), [
    'Main US',
    'Main DE',
  ]);
  assert.deepStrictEqual(calls, [
    ['/usr/bin/forkop', ['clash_api', 'get_proxy_providers']],
  ]);

  response = Promise.reject(new Error('sing-box is unavailable'));
  assert.strictEqual(
    await loadNativeProviderOutboundNames([providerTag]),
    null,
    'native provider choice lookup must fail open',
  );

  const callsBeforeEmptyLookup = calls.length;
  assert.deepStrictEqual(await loadNativeProviderOutboundNames([]), []);
  assert.strictEqual(calls.length, callsBeforeEmptyLookup);

  response = Promise.resolve({ stdout: JSON.stringify(payload) });
  assert.deepStrictEqual(await loadOutboundNameChoices('main'), [
    'Main DE',
    'Main US',
  ]);
  assert.deepStrictEqual(
    currentDraftOutboundNames('main'),
    ['Draft URL', 'Renamed interface', 'Draft interface', 'Leaf JSON'],
    'draft choices must replace renamed interfaces, keep staged names, and exclude groups',
  );
  assert.deepStrictEqual(
    outboundNameChoiceItems(['lan2'], null),
    [{ value: 'lan2', label: 'lan2' }],
    'available choices must come only from active sources',
  );
  assert.deepStrictEqual(
    outboundNameChoiceItems([], null),
    [],
    'selected custom values must not be promoted into available choices',
  );
  draftSourceValues.selector_proxy_links = [];
  assert.deepStrictEqual(
    currentDraftOutboundNames('main'),
    ['Renamed interface', 'Draft interface', 'Leaf JSON'],
    'a deleted unsaved URL must disappear from available choices immediately',
  );

  assert.match(
    source,
    /state\.providerTags\.filter\(\(providerTag\) =>[\s\S]*subscription-\\d\+-provider/,
    'loadOutboundNameChoices must use subscription provider tags only',
  );
  assert.match(
    source,
    /normalizeOutboundChoice:[\s\S]*subscriptionSourceOutboundName\(/,
    'subscription choices do not account for native tag_prefix ordering',
  );
  assert.match(
    source,
    /loadNativeProviderOutboundNames\(\[state\.providerTags\[providerIndex\]\]\)/,
    'subscription settings must load only their own native provider',
  );
  assert.match(
    source,
    /ownerId: options\.ownerId/,
    'subscription settings must identify their own child provider',
  );
  assert.doesNotMatch(
    source.match(/function configureLiveDynamicListChoices\([\s\S]*?\nfunction outboundNameChoiceItems\(/)[0],
    /widget\.setValue\(/,
    'live choice refresh must not rewrite selected filter values',
  );
  assert.doesNotMatch(
    source,
    /renameServerFilterOutbound|outboundNameRenameAliases|removedOutboundNames/,
    'filter values must remain literal when sources are renamed or removed',
  );

  console.log('LuCI native provider choice checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
