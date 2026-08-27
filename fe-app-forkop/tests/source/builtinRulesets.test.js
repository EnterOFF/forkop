// The built-in rule sets a section can match on. Two regional lists used to be
// mutually exclusive, and the dialog enforced that by silently clearing whatever
// the user had picked before; the restriction is gone and nothing of it may come
// back.
import fs from 'fs';

import { describe, expect, it } from 'vitest';

import { BUNDLE } from '../lib/paths.js';
import { tabSource } from '../lib/tabSource.js';

const bundle = fs.readFileSync(BUNDLE, 'utf8');

describe('the built-in rule sets', () => {
  it.each(['russia_inside', 'russia_outside', 'ukraine_inside'])(
    '%s is still offered',
    (option) => {
      expect(bundle).toContain(`${option}:`);
    },
  );

  it.each([
    'REGIONAL_OPTIONS',
    'builtInRulesetOption.onchange',
    'Regional options cannot be used together',
    'Previous selections have been removed',
  ])('carry no trace of the removed restriction: %s', async (removed) => {
    expect(await tabSource('sections')).not.toContain(removed);
    expect(bundle).not.toContain(removed);
  });
});
