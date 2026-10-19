import { describe, expect, it } from 'vitest';

import { getDiagnosticsChecks } from '../diagnostic.store';

// The page draws the checks sorted by their order and runs them in the order
// they are listed; both have to agree, or a card lights up out of turn.
describe('the order of the Status checks', () => {
  it('follows what traffic depends on, with the servers last', () => {
    const checks = getDiagnosticsChecks('', { includeServers: true });
    const expected = ['SERVICE', 'DNS', 'TRAFFIC', 'SECTIONS', 'SERVERS'];

    expect(checks.map((check) => check.code)).toEqual(expected);
    expect(
      [...checks].sort((a, b) => a.order - b.order).map((check) => check.code),
    ).toEqual(expected);
  });

  it('lists the servers only for a configuration that has one', () => {
    expect(getDiagnosticsChecks('').map((check) => check.code)).toEqual([
      'SERVICE',
      'DNS',
      'TRAFFIC',
      'SECTIONS',
    ]);
  });
});
