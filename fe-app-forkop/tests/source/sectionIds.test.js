// Who is allowed to name a uci section.
//
// The whole page is one bundle, so nothing may name a section itself: an id
// comes from nextSectionId() in the shared CBI layer, or it is LuCI's own
// placeholder - which marks a section the browser has not saved and would be
// written to the config for good. nextSectionId is exercised as a call in
// src/forkop/cbi/tests/nextSectionId.test.ts; what is left here is who calls it.
import { describe, expect, it } from 'vitest';

import { tabSource } from '../lib/tabSource.js';

const TABS = [
  ['the page', 'entry'],
  ['the Sections tab', 'sections'],
  ['the Servers tab', 'servers'],
];

// A child list names the type of item it holds, and the constant some of them
// use for it.
const CHILD_TYPE_ALIASES = { CLIENT_TYPE: 'server_client' };

function resolve(match) {
  return match[1] || CHILD_TYPE_ALIASES[match[2]] || match[2];
}

describe.each(TABS)('%s', (_label, tab) => {
  it.each(['.createSID(', '`pg_', '`tun_', '`tp_'])(
    'names no section with %s',
    async (stale) => {
      expect(await tabSource(tab)).not.toContain(stale);
    },
  );
});

// Every type a view creates has to get an id: without one the section is
// anonymous, and an anonymous section is addressed by its position in the file.
// The page itself holds no child list - the two tabs below build the dialogs -
// so asking it this question could only ever answer vacuously.
describe.each(TABS.filter(([, tab]) => tab !== 'entry'))(
  '%s',
  (_label, tab) => {
    it('gives every child type it creates an id', async () => {
      const source = await tabSource(tab);
      const declared = [
        ...new Set(
          Array.from(
            source.matchAll(/\bchildType = (?:'([a-z_]+)'|([A-Z_]+));/g),
            resolve,
          ),
        ),
      ];
      const named = new Set(
        Array.from(
          source.matchAll(/nextSectionId\((?:'([a-z_]+)'|([A-Z_]+))\)/g),
          resolve,
        ),
      );

      expect(declared, 'no child list was found at all').not.toEqual([]);
      expect(declared.filter((type) => !named.has(type))).toEqual([]);
    });
  },
);
