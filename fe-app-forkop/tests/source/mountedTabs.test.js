// The box a self-rendering tab is laid out in.
//
// Every tab that renders itself rather than declaring CBI options is one
// form.DummyValue, and LuCI hands that option's value to the theme inside an
// <output>. The theme lays a .cbi-value out as a flex row, so the <output> is a
// flex item: the page inside it is as wide as its own content, not as wide as
// the content column it sits in. A page that wants the column has to say so.
//
// A rule addressed to children a DummyValue does not have - .cbi-value-title,
// .cbi-value-field, a child div - matches nothing, and a dead selector reads
// exactly like a working one, which is what this file catches. The Components
// tab still carries such a rule and is left alone.
import fs from 'fs';

import { describe, expect, it } from 'vitest';

import { SRC } from '../lib/paths.js';

const read = (tab) =>
  fs.readFileSync(`${SRC}/forkop/tabs/${tab}/styles.ts`, 'utf8');

// The tabs whose page takes the width of the content column, and the mount node
// each of them turns into a block to get it.
const FILLING = ['dashboard', 'logs', 'monitoring'];

const styles = Object.fromEntries(
  [...FILLING, 'diagnostic'].map((tab) => [tab, read(tab)]),
);

describe.each(FILLING)('the %s tab', (tab) => {
  it('makes its mount node a block', () => {
    expect(styles[tab]).toContain('-_mount_node {\n    display: block');
  });
});

// The Status tab is the exception, and deliberately so: above its breakpoint the
// shrink-to-fit box is what settles its two columns at 17rem + 34rem, so it
// becomes a block only where it stacks.
describe('the Status tab', () => {
  it('turns its mount node into a block only where it stacks', () => {
    expect(styles.diagnostic).not.toContain(
      '-_mount_node {\n    display: block',
    );
    expect(styles.diagnostic).toContain(
      '-_mount_node {\n        display: block',
    );
  });
});

describe.each([...FILLING, 'diagnostic'])('the %s tab', (tab) => {
  it.each(['.cbi-value-title', '.cbi-value-field', 'div'])(
    'addresses no `> %s` under its mount node',
    (child) => {
      expect(styles[tab]).not.toContain(`-_mount_node > ${child}`);
    },
  );
});
