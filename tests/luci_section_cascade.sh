#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node - "$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js" <<'NODE'
const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync(process.argv[2], 'utf8');
const match = source.match(
  /function configureSectionSection\(sectionRef, options = \{\}\) \{[\s\S]*?\n\}\n\nconst EntryPoint/,
);
assert(match, 'configureSectionSection not found');

const cleanupCalls = [];
function setActionProvidersAvailabilityLoader() {}
function loadSectionTableOptions() {}
function cleanupRemovedChildItems(...args) {
  cleanupCalls.push(args);
}

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
eval(match[0].slice(0, -'\n\nconst EntryPoint'.length));

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
  ['parent', 'fallback_group', []],
  ['parent', 'tunnel', []],
]);
assert.deepStrictEqual(parentArgs, ['parent', event]);
assert.strictEqual(parentThis, sectionRef);
assert.match(
  source,
  /typeName === "fallback_group"[\s\S]*cleanupFallbackLevelsForGroup\(itemId\)/,
  'fallback_group cleanup does not cascade to fallback_level',
);
assert.match(
  source,
  /typeName === "tunnel"[\s\S]*cleanupTunnelPeers\(itemId\)/,
  'tunnel cleanup does not cascade to tunnel_peer',
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
