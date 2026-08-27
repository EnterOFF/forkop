// A subscription's override settings rewrite the servers it delivers: a prefix
// and suffix on the name, a rename table, and a JSON patch merged into each
// outbound.
//
// The dialog stores exactly the four settings it shows. A control removed from it
// that still has a key here would leave a write behind that nothing reads any
// more - the reserved-path list it shares with the backend is checked in
// tests/config/subscription_override.sh, which can compare it against ucode.
import { describe, expect, it } from 'vitest';

import { readFunction } from '../lib/sourceLiteral.js';
import { tabSource } from '../lib/tabSource.js';

const section = await tabSource('sections');

const STORED = [
  'override_prefix',
  'override_suffix',
  'override_rename',
  'override_patch',
];

describe('the override settings', () => {
  it('are exactly the four the dialog shows', () => {
    const body = readFunction(section, 'subscriptionOverrideKeys');
    expect(
      [...body.matchAll(/'(override_[a-z_]+)'/g)].map((match) => match[1]),
    ).toEqual(STORED);
  });

  it('are the only ones the dialog mentions', () => {
    const referenced = [
      ...new Set(
        [...section.matchAll(/'(override_[a-z_]+)'/g)].map((match) => match[1]),
      ),
    ];
    expect(referenced.filter((key) => !STORED.includes(key))).toEqual([]);
  });
});
