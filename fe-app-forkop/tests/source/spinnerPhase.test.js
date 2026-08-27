// Every spinner on the page is built with an animation-delay that places it part
// of the way into the .rotate keyframes, so that one rendered in place of another
// carries on from the angle that one had reached. The delay is a remainder of the
// period, so the two have to be the same number: shorten the keyframes without
// telling helpers/spinPhase.ts and every spinner is anchored to the wrong phase,
// which looks exactly like the jitter the delay was added to remove.
import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { SPIN_PERIOD_MS } from '../../src/helpers/spinPhase';
import { SRC } from '../lib/paths.js';

const styles = fs.readFileSync(path.join(SRC, 'styles.ts'), 'utf8');

describe('the turn a spinner is anchored to', () => {
  it('is the period the delay is a remainder of', () => {
    expect(styles).toContain(
      'animation: spin ${SPIN_PERIOD_MS}ms linear infinite;',
    );
  });

  it('is a whole number of milliseconds', () => {
    expect(Number.isInteger(SPIN_PERIOD_MS)).toBe(true);
    expect(SPIN_PERIOD_MS).toBeGreaterThan(0);
  });
});
