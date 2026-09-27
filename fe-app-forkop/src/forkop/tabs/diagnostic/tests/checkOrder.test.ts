import { describe, expect, it } from 'vitest';

import { getDiagnosticsChecks } from '../diagnostic.store';

// The page draws the checks sorted by their order and runs them in the order
// they are listed; both have to agree, or a card lights up out of turn.
describe('the order of the Status checks', () => {
  it('puts the inbounds after the outbounds', () => {
    const checks = getDiagnosticsChecks('', { includeInbounds: true });
    const expected = [
      'DNS',
      'SINGBOX',
      'NFT',
      'OUTBOUNDS',
      'INBOUNDS',
      'FAKEIP',
    ];

    expect(checks.map((check) => check.code)).toEqual(expected);
    expect(
      [...checks].sort((a, b) => a.order - b.order).map((check) => check.code),
    ).toEqual(expected);
  });
});
