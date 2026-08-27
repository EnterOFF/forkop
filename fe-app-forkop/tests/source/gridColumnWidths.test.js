// The Sections and Servers tabs are the same table twice: a name, a switch, one
// column naming what the row is, and the row actions. A LuCI grid sizes its
// columns from the widths its options declare, and whatever those do not take
// goes to the undeclared name column beside them - so a width declared on one
// tab and not the other moves every column on the page the moment the user
// clicks across, which is how the two tables drifted 32px apart. The widths are
// shared constants for that reason, and this holds them shared.
import { describe, expect, it } from 'vitest';

import {
  GRID_KIND_COLUMN_WIDTH,
  GRID_SWITCH_COLUMN_WIDTH,
} from '../../src/forkop/cbi/grid';
import { tabSource } from '../lib/tabSource.js';

const TABS = ['sections', 'servers'];

describe('the shared column widths', () => {
  it.each([
    ['GRID_SWITCH_COLUMN_WIDTH', GRID_SWITCH_COLUMN_WIDTH],
    ['GRID_KIND_COLUMN_WIDTH', GRID_KIND_COLUMN_WIDTH],
  ])('%s is a rem measure', (_name, value) => {
    expect(value).toMatch(/^[0-9.]+rem$/);
  });

  // The kind column carries protocol names on one tab and rule actions on the
  // other, and a value wider than the column widens it past the declared width -
  // which puts the tables back out of step. Shadowsocks is the longest of either.
  it('leaves the kind column room for Shadowsocks', () => {
    expect(Number.parseFloat(GRID_KIND_COLUMN_WIDTH)).toBeGreaterThanOrEqual(8);
  });
});

describe.each(TABS)('the %s table', (tab) => {
  it.each(['GRID_SWITCH_COLUMN_WIDTH', 'GRID_KIND_COLUMN_WIDTH'])(
    'takes its width from %s',
    async (name) => {
      expect(await tabSource(tab)).toContain(`o.width = ${name};`);
    },
  );

  // A literal anywhere in either table is the drift coming back: it agrees with
  // the other tab until somebody edits one of them.
  it('declares no width of its own', async () => {
    const literals = (await tabSource(tab))
      .split('\n')
      .filter((line) => /\.width = ['"]/.test(line));
    expect(literals).toEqual([]);
  });
});
