#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node - "$(node "$ROOT_DIR/tests/helpers/tab_source.js" sections)" "$ROOT_DIR" <<'NODE'
const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync(process.argv[2], 'utf8');
// Taken by name: the tab is several modules now, and nothing follows the
// function in a fixed place any more.
const { readFunction } = require(`${process.argv[3]}/tests/helpers/source_literal.js`);
const configureSection = readFunction(source, 'configureSectionSection');

const cleanupCalls = [];
function loadVisibleTableOptions() {}
// A list whose items own children hands the cleanup what removing one takes
// with it, so the call is recorded by the name of that function.
function cleanupRemovedChildItems(...args) {
  cleanupCalls.push(
    args.map((arg) => (typeof arg === 'function' ? arg.name : arg)),
  );
}
function removeFallbackLevels() {}
function removeTunnelPeers() {}

let outboundMissing = false;
function missingConnectionOutbound(...args) {
  lookupArgs = args;
  return outboundMissing;
}
let lookupArgs;
let prototypeSaves = 0;
const savedResult = {};
const form = {
  GridSection: {
    prototype: {
      handleModalSave() {
        prototypeSaves += 1;
        return savedResult;
      },
    },
  },
};
eval(configureSection);

const event = {};
const result = {};
let parentArgs;
let parentThis;
const sectionRef = {
  handleRemove(...args) {
    parentArgs = args;
    parentThis = this;
    return result;
  },
};
configureSectionSection(sectionRef);

assert.strictEqual(sectionRef.handleRemove('parent', event), result);
assert.deepStrictEqual(cleanupCalls, [
  ['parent', 'subscription_url', []],
  ['parent', 'section_interface', []],
  ['parent', 'urltest', []],
  ['parent', 'fallback_group', [], undefined, 'removeFallbackLevels'],
  ['parent', 'tunnel', [], undefined, 'removeTunnelPeers'],
]);
assert.deepStrictEqual(parentArgs, ['parent', event]);
assert.strictEqual(parentThis, sectionRef);
// The shared cleanup knows nothing about these two types: the list that owns
// children says what removing one of its items takes with it, where the list is
// declared.
assert.match(
  source,
  /o\.childType = 'tunnel';[\s\S]{0,200}o\.removeNestedChildItems = removeTunnelPeers;/,
  'the tunnel list does not say that removing a tunnel takes its peers',
);
assert.match(
  source,
  /o\.childType = 'fallback_group';[\s\S]{0,200}o\.removeNestedChildItems = removeFallbackLevels;/,
  'the fallback list does not say that removing a group takes its levels',
);
assert.match(
  source,
  /function removeFallbackLevels\(groupId\) \{\s*removeChildItemsOf\(groupId, 'fallback_level', 'group'\);/,
  'removing a fallback group must remove its levels',
);
assert.match(
  source,
  /function removeTunnelPeers\(tunnelId\) \{\s*removeChildItemsOf\(tunnelId, 'tunnel_peer', 'tunnel'\);/,
  'removing a tunnel must remove its peers',
);

// A section the runtime graph would drop is refused before the dialog writes
// anything: Save does nothing at all rather than leaving half of it behind.
const modalMap = { section: 'parent' };
outboundMissing = true;
sectionRef.handleModalSave(modalMap, event);
assert.deepStrictEqual(lookupArgs, [modalMap, 'parent']);
assert.strictEqual(prototypeSaves, 0, 'a refused section was still saved');

outboundMissing = false;
assert.strictEqual(sectionRef.handleModalSave(modalMap, event), savedResult);
assert.strictEqual(prototypeSaves, 1, 'an accepted section was not saved');

console.log('LuCI section cascade checks passed');
NODE
