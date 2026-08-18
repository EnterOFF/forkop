import { describe, expect, it } from 'vitest';
import {
  parseStaticHosts,
  staticHostsDomainCount,
  validateStaticHosts,
} from '../validateStaticHosts.js';

const validRecords = [
  ['single domain', '130.255.77.28 ntc.party'],
  ['several domains', '130.255.77.28 ntc.party www.ntc.party'],
  ['IPv6 address', '2a03:4000::1 ntc.party'],
  ['tab separator', '130.255.77.28\tntc.party'],
  ['single label host', '192.168.1.10 printer'],
  ['comment line', '# just a note'],
  ['trailing comment', '130.255.77.28 ntc.party # pinned'],
  ['empty text', ''],
];

const invalidRecords = [
  ['swapped columns', 'ntc.party 130.255.77.28'],
  ['address only', '130.255.77.28'],
  ['empty label', '130.255.77.28 ntc..party'],
  ['leading dot', '130.255.77.28 .ntc.party'],
  ['subnet instead of address', '130.255.77.0/24 ntc.party'],
  ['url instead of domain', '130.255.77.28 https://ntc.party'],
];

describe('validateStaticHosts', () => {
  it.each(validRecords)('accepts %s', (_name, value) => {
    expect(validateStaticHosts(value).valid).toBe(true);
  });

  it.each(invalidRecords)('rejects %s', (_name, value) => {
    expect(validateStaticHosts(value).valid).toBe(false);
  });

  it('reports the failing entry', () => {
    expect(validateStaticHosts('130.255.77.28 ntc..party').message).toContain(
      'ntc..party',
    );
  });
});

describe('parseStaticHosts', () => {
  it('keeps every domain of a record', () => {
    expect(parseStaticHosts('130.255.77.28 ntc.party www.ntc.party')).toEqual([
      { address: '130.255.77.28', domains: ['ntc.party', 'www.ntc.party'] },
    ]);
  });

  it('drops comments and blank lines', () => {
    expect(
      parseStaticHosts('# note\n\n130.255.77.28 ntc.party // inline\n'),
    ).toEqual([{ address: '130.255.77.28', domains: ['ntc.party'] }]);
  });
});

describe('staticHostsDomainCount', () => {
  it('counts each domain once', () => {
    expect(
      staticHostsDomainCount(
        '130.255.77.28 ntc.party www.ntc.party\n2a03:4000::1 NTC.party\n',
      ),
    ).toBe(2);
  });

  it('returns zero without records', () => {
    expect(staticHostsDomainCount('# nothing here\n')).toBe(0);
  });
});
