// LuCI ships several themes and the user picks one; a page that paints its own
// background is readable in the theme it was written against and unreadable in
// the others. The component cards on the Updates tab therefore declare no
// background at all and inherit whatever the active theme paints.
//
// Both the source and the built bundle are read: the styles are a template
// string, so a background reintroduced anywhere on the way through the build
// would be just as visible to the user.
import fs from 'fs';

import { describe, expect, it } from 'vitest';

import { BUNDLE, SRC } from '../lib/paths.js';

const CARD_RULE = '.fkp_updates-page__component {';

function cardStyles(source) {
  const start = source.indexOf(`\n${CARD_RULE}`);
  expect(start, `${CARD_RULE} was not found`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n}', start);
  expect(end, `${CARD_RULE} never closes`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe.each([
  ['the frontend source', `${SRC}/forkop/tabs/updates/styles.ts`],
  ['the LuCI bundle', BUNDLE],
])('component cards in %s', (_name, file) => {
  it('inherit the active theme background', () => {
    const styles = cardStyles(fs.readFileSync(file, 'utf8'));
    expect(styles).not.toMatch(/^\s*background(-color)?:/m);
  });
});
