#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node - "$(node "$ROOT_DIR/tests/helpers/tab_source.js" sections)" "$ROOT_DIR" <<'NODE'
const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync(process.argv[2], 'utf8');

// The tab is several modules now, so a helper is taken by name rather than by
// what happens to follow it.
const { readFunction } = require(`${process.argv[3]}/tests/helpers/source_literal.js`);
const extract = (...names) =>
  names.map((name) => readFunction(source, name)).join('\n');

const UCI_PACKAGE = 'forkop';
// The extracted helpers name the constant the bundle imports.
const FORKOP_UCI_PACKAGE = UCI_PACKAGE;
const store = new Map();
let anonymous = 0;

const uci = {
  sections(pkg, type) {
    assert.strictEqual(pkg, UCI_PACKAGE);
    return Array.from(store.values()).filter(
      (section) => !type || section['.type'] === type,
    );
  },
  get(pkg, sid, option) {
    assert.strictEqual(pkg, UCI_PACKAGE);
    const section = store.get(sid);
    if (!section) return null;
    if (option == null) return section;
    return Object.prototype.hasOwnProperty.call(section, option)
      ? section[option]
      : null;
  },
  set(pkg, sid, option, value) {
    assert.strictEqual(pkg, UCI_PACKAGE);
    const section = store.get(sid);
    assert(section, `set on missing section ${sid}`);
    section[option] = value;
  },
  unset(pkg, sid, option) {
    const section = store.get(sid);
    if (section) delete section[option];
  },
  add(pkg, type, name) {
    assert.strictEqual(pkg, UCI_PACKAGE);
    const sid = name || `cfg${(anonymous += 1)}`;
    if (store.has(sid)) return null;
    store.set(sid, { '.name': sid, '.type': type });
    return sid;
  },
  remove(pkg, sid) {
    store.delete(sid);
  },
};

const adoptedValues = [];
function findDynamicListItemByValue(node, value) {
  return node.items.includes(value) ? { value } : null;
}
function setDynamicListItemValue(item, value) {
  adoptedValues.push([item.value, value]);
}

eval(
  extract(
    'normalizeDynamicListItems',
    'childOwnerOption',
    'childItemOrder',
    'getChildItemIds',
    'childItemValue',
    'childItemInputValue',
    'isExistingChildItem',
    'createChildItem',
    'applyChildItemSettings',
    'materializeChildItems',
    'adoptMaterializedChildItems',
    'removeChildItemsOf',
    'cleanupRemovedChildItems',
    'parentSectionIdForItem',
    // applyChildItemSettings() asks it before writing, so that a value already
    // stored is left alone.
    'settingValueEquals',
  ),
);

const LEVEL_OPTIONS = {
  typeName: 'fallback_level',
  ownerOption: 'group',
  valueOption: 'name',
  defaults: { server_filter_mode: 'include' },
};

function resetStore() {
  store.clear();
  anonymous = 0;
  adoptedValues.length = 0;
  store.set('grp', { '.name': 'grp', '.type': 'fallback_group', section: 'vpn' });
  store.set('lvl_old', {
    '.name': 'lvl_old',
    '.type': 'fallback_level',
    group: 'grp',
    name: 'Group #1',
    order: '0',
    server_filter_mode: 'exclude',
    exclude_regex: 'stale',
  });
}

function materializeLevels(values, staged) {
  return materializeChildItems(
    'grp',
    Object.assign({}, LEVEL_OPTIONS, {
      stagedSettings: (value) => (staged ? staged[value] || null : null),
    }),
    values,
  );
}

// A list value that repeats the name of an item which is still stored but no
// longer listed must create a new item instead of resurrecting the old one.
resetStore();
let result = materializeLevels(['Group #1'], {
  'Group #1': {
    name: 'Group #1',
    server_filter_mode: 'include',
    include_regex: 'fresh',
  },
});
assert.deepStrictEqual(result.itemIds, ['cfg1'], 'reused name must be a new item');
assert.deepStrictEqual(Array.from(result.resolved), [['Group #1', 'cfg1']]);
cleanupRemovedChildItems('grp', 'fallback_level', result.itemIds, 'group');
assert.deepStrictEqual(
  getChildItemIds('grp', 'fallback_level', 'group'),
  ['cfg1'],
  'the removed item must not survive the write',
);
assert.deepStrictEqual(uci.get(UCI_PACKAGE, 'cfg1', null), {
  '.name': 'cfg1',
  '.type': 'fallback_level',
  group: 'grp',
  name: 'Group #1',
  server_filter_mode: 'include',
  include_regex: 'fresh',
});

// A list value that is a stored child section id keeps that item untouched.
resetStore();
result = materializeLevels(['lvl_old'], {
  lvl_old: { include_regex: 'must not apply' },
});
assert.deepStrictEqual(result.itemIds, ['lvl_old'], 'stored ids must be kept');
assert.deepStrictEqual(Array.from(result.resolved), [['lvl_old', 'lvl_old']]);
assert.strictEqual(uci.get(UCI_PACKAGE, 'lvl_old', 'exclude_regex'), 'stale');
assert.strictEqual(uci.get(UCI_PACKAGE, 'lvl_old', 'include_regex'), null);

// Repeated draft values collapse into a single new item.
resetStore();
const stagedCalls = [];
result = materializeChildItems(
  'grp',
  Object.assign({}, LEVEL_OPTIONS, {
    stagedSettings: (value) => {
      stagedCalls.push(value);
      return { name: value };
    },
  }),
  ['Group #2', 'Group #2'],
);
assert.deepStrictEqual(result.itemIds, ['cfg1'], 'duplicate drafts must share an item');
assert.deepStrictEqual(stagedCalls, ['Group #2']);

// Writing the same widget twice keeps the item that was stored first, because
// the list values adopt the stored ids after every write.
resetStore();
result = materializeLevels(['Group #3'], {
  'Group #3': { name: 'Group #3', include_regex: 'fresh' },
});
const listNode = { items: ['Group #3'] };
adoptMaterializedChildItems(
  { getUIElement: () => ({ node: listNode }) },
  'settings',
  result.resolved,
);
assert.deepStrictEqual(adoptedValues, [['Group #3', 'cfg1']]);
const second = materializeLevels(['cfg1'], {});
assert.deepStrictEqual(second.itemIds, ['cfg1'], 'a repeated write must not duplicate items');
assert.strictEqual(uci.get(UCI_PACKAGE, 'cfg1', 'include_regex'), 'fresh');

// An unmounted widget must not break the write.
adoptMaterializedChildItems(
  {
    getUIElement: () => {
      throw new Error('not rendered');
    },
  },
  'settings',
  second.resolved,
);

assert.match(
  source,
  /const \{ itemIds, resolved \} = materializeChildItems\(/,
  'the child list write must consume the resolved list values',
);
assert.match(
  source,
  /adoptMaterializedChildItems\(this, section_id, resolved\);/,
  'the child list write must adopt the stored ids',
);
assert.match(
  source,
  /delete store\[inputValue\];\n\s*\/\/[\s\S]*?setDynamicListItemValue\(settings\.itemNode, nextInputValue\);/,
  'renaming a pending item must move its list value to the new display value',
);
for (const modal of [
  'showUrlTestSettingsModal',
  'showFallbackLevelSettingsModal',
]) {
  const body = readFunction(source, modal);
  assert.match(
    body,
    /\n\s{4}itemNode,\n/,
    `${modal} must pass its list item to the shared settings modal`,
  );
}
assert(
  !source.includes('findChildItemForInput'),
  'child items must not be looked up by their display value',
);

console.log('LuCI child item identity checks passed');
NODE
