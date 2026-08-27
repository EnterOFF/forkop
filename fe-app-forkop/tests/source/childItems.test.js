// How a child list writes itself, at the two points where the list widget and
// the stored sections have to agree.
//
// Which section a list entry means is exercised as a call in
// src/forkop/cbi/tests/childItemIdentity.test.ts. What is left here is that the
// write goes through it: the resolved ids have to reach the widget, or the next
// save of the same open dialog stores the drafts a second time.
import { describe, expect, it } from 'vitest';

import { readFunction } from '../lib/sourceLiteral.js';
import { tabSource } from '../lib/tabSource.js';

const section = await tabSource('sections');

describe('the child list write', () => {
  it('consumes the resolved list values', () => {
    expect(section).toMatch(
      /const \{ itemIds, resolved \} = materializeChildItems\(/,
    );
  });

  it('adopts the stored ids into the widget', () => {
    expect(section).toMatch(
      /adoptMaterializedChildItems\(this, section_id, resolved\);/,
    );
  });
});

describe('renaming a draft item', () => {
  it('moves its list value to the new display value', () => {
    expect(section).toMatch(
      /delete store\[inputValue\];\n\s*\/\/[\s\S]*?setDynamicListItemValue\(settings\.itemNode, nextInputValue\);/,
    );
  });
});

describe.each(['showUrlTestSettingsModal', 'showFallbackLevelSettingsModal'])(
  '%s',
  (modal) => {
    it('passes its list item to the shared settings modal', () => {
      expect(readFunction(section, modal)).toMatch(/\n\s{4}itemNode,\n/);
    });
  },
);

// A display value is not an identity: two items can carry the same one.
it('looks no child item up by its display value', () => {
  expect(section).not.toContain('findChildItemForInput');
});

// The shared cleanup knows nothing about the two types that own children of their
// own, so the list that owns them says what removing one of its items takes with
// it, where the list is declared. A section nothing points at is unreachable: it
// would sit in the config for good and libuci would renumber the anonymous
// sections around it.
describe('a list whose items own children', () => {
  it.each([
    ['tunnel', 'removeTunnelPeers'],
    ['fallback_group', 'removeFallbackLevels'],
  ])('says that removing a %s takes its children', (type, remover) => {
    expect(section).toMatch(
      new RegExp(
        `o\\.childType = '${type}';[\\s\\S]{0,200}o\\.removeNestedChildItems = ${remover};`,
      ),
    );
  });

  it.each([
    ['removeFallbackLevels', 'groupId', 'fallback_level', 'group'],
    ['removeTunnelPeers', 'tunnelId', 'tunnel_peer', 'tunnel'],
  ])('%s removes them', (name, argument, childType, ownerOption) => {
    expect(section).toMatch(
      new RegExp(
        `function ${name}\\(${argument}\\) \\{\\s*removeChildItemsOf\\(${argument}, '${childType}', '${ownerOption}'\\);`,
      ),
    );
  });
});
