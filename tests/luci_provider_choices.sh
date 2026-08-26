#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$(node "$ROOT_DIR/tests/helpers/tab_source.js" sections)"

node - "$SECTION_JS" "$ROOT_DIR" <<'NODE'
const assert = require('assert');
const fsNode = require('fs');

const source = fsNode.readFileSync(process.argv[2], 'utf8');
// Functions are taken by name: the tab is several modules now, so what sits
// next to what is not part of any contract.
const { readFunction } = require(`${process.argv[3]}/tests/helpers/source_literal.js`);
const helpers = [
  readFunction(source, 'nativeProviderOutboundNames'),
  readFunction(source, 'loadNativeProviderOutboundNames'),
].join('\n');
const choiceLoader = readFunction(source, 'loadOutboundNameChoices');
const draftNames = readFunction(source, 'currentDraftOutboundNames');
const pendingStore = readFunction(source, 'childPendingSettingsStore');
const choiceItems = readFunction(source, 'outboundNameChoiceItems');

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const providerTag = 'Main/sub1';
const payload = {
  providers: {
    [providerTag]: {
      proxies: [
        { name: `${providerTag}/Main US`, type: 'VLESS' },
        { name: `${providerTag}/Main DE`, type: 'AnyTLS' },
        { name: `${providerTag}/Main Auto`, type: 'URLTest' },
      ],
    },
    'other-subscription-provider': {
      proxies: [{ name: 'other-subscription-provider/Other JP', type: 'VLESS' }],
    },
  },
};
const transport = (value) =>
  JSON.stringify({ status: 200, body: JSON.stringify(value) });
let response = Promise.resolve({ stdout: transport(payload) });
const calls = [];
const fs = {
  exec(path, args) {
    calls.push([path, args]);
    return response;
  },
};

eval(helpers);

const outboundNameChoicesCache = new Map();
const outboundNameChoicesInflight = new Map();
const outboundNameChoicesEmptyAt = new Map();
const emptyTtl = source.match(
  /const OUTBOUND_NAME_CHOICES_EMPTY_TTL_MS = (\d+);/,
);
assert(emptyTtl, 'empty outbound choice TTL not found');
const OUTBOUND_NAME_CHOICES_EMPTY_TTL_MS = Number(emptyTtl[1]);
const cacheHelpers = [
  readFunction(source, 'cacheOutboundNameChoices'),
  readFunction(source, 'outboundNameChoicesCached'),
].join('\n');
eval(cacheHelpers);
function readOutboundChoiceState() {
  return Promise.resolve({
    providerTags: [providerTag],
  });
}
function refreshDashboardFilterChoiceWidgets() {}
eval(choiceLoader);
eval(readFunction(source, 'loadSectionOutboundNameChoices'));

function normalizeDynamicListItems(value) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}
eval(choiceItems);

const sharedChildPendingSettings = new Map();
eval(pendingStore);
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
const FORKOP_UCI_PACKAGE = 'forkop';
function getProxyUrlName(value) {
  const fragment = String(value || '').split('#')[1] || '';
  return decodeURIComponent(fragment);
}
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
eval(draftNames);

const sourceBinding = source.match(
  /o\.liveDynamicListNodes = new Map\(\);[\s\S]*?outboundNameSourceOptions\.set\('selector_proxy_links', o\);/,
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
const liveReader = readFunction(source, 'currentLiveDynamicListValues');
eval(liveReader);
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
(async () => {
  assert.deepStrictEqual(await loadNativeProviderOutboundNames([providerTag]), [
    'Main US',
    'Main DE',
  ]);
  assert.deepStrictEqual(calls, [
    ['/usr/bin/forkop', ['clash_http', 'GET', '/providers/proxies', '']],
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

  response = Promise.resolve({ stdout: transport(payload) });
  assert.deepStrictEqual(await loadSectionOutboundNameChoices('main'), [
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

  // The core knows a subscription only after it has been fetched, so an empty
  // answer must not be cached until the page is reloaded.
  outboundNameChoicesCache.clear();
  outboundNameChoicesEmptyAt.clear();
  response = Promise.resolve({ stdout: transport({ providers: {} }) });
  assert.deepStrictEqual(await loadSectionOutboundNameChoices('main'), []);
  outboundNameChoicesEmptyAt.set('main', Date.now() - OUTBOUND_NAME_CHOICES_EMPTY_TTL_MS - 1);
  response = Promise.resolve({ stdout: transport(payload) });
  assert.deepStrictEqual(
    await loadSectionOutboundNameChoices('main'),
    ['Main DE', 'Main US'],
    'an expired empty result must be looked up again',
  );

  assert.match(source, /`\$\{sectionDisplayName\}\/\$\{/,
    'provider tags must be derived from the displayed section name and subscription tag');
  assert.match(
    source,
    /\[state\.providerTags\[providerIndex\]\]/,
    'subscription settings must load only their own native provider',
  );
  assert.match(
    source,
    /ownerId: options\.ownerId/,
    'subscription settings must identify their own child provider',
  );
  assert.doesNotMatch(
    readFunction(source, 'configureLiveDynamicListChoices'),
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
