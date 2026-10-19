// The one text a section's domains and addresses are written in, as the two
// fields that edit it read each entry. The router reads the same text with
// config/rule.uc; tests/config/rule.test.uc holds the same entries there.

import { describe, expect, it } from 'vitest';

import { installUciStub } from './luciStubs';
import {
  analyzeDestinationText,
  analyzeDnsDestinationText,
} from '../../forkop/tabs/sections/conditions';

installUciStub();

function problems(analyze, text) {
  const analysis = analyze(text);
  return analysis.valid ? [] : analysis.message.split('\n').slice(1);
}

describe('a routing section', () => {
  it('takes domains of every kind and addresses side by side', () => {
    expect(
      problems(
        analyzeDestinationText,
        'example.org, full:api.example.org keyword:video\n' +
          'regex:^ads[.]\n192.0.2.1 198.51.100.0/24 # office\n' +
          '2001:db8::1, 2001:db8::/32 ::ffff:192.0.2.1',
      ),
    ).toEqual([]);
  });

  it.each([
    ['192.0.2', 'Invalid format. Use an IP address or CIDR subnet'],
    ['192.0.2.256', 'Invalid format. Use an IP address or CIDR subnet'],
    [
      '192.0.2.0/33',
      'CIDR must be between 0 and 32 for IPv4 or 0 and 128 for IPv6',
    ],
    ['2001:db8:::1', 'Invalid format. Use an IP address or CIDR subnet'],
    ['dead:beef', 'Invalid format. Use an IP address or CIDR subnet'],
  ])('tells a mistyped address %s what an address needs', (entry, message) => {
    expect(problems(analyzeDestinationText, entry)).toEqual([
      `${entry}: ${message}`,
    ]);
  });

  it.each(['example.123', 'full:192.0.2', 'example.org/24'])(
    'refuses %s, which is neither a domain nor an address',
    (entry) => {
      expect(problems(analyzeDestinationText, entry)).toEqual([
        `${entry}: Invalid domain address`,
      ]);
    },
  );

  it('reads a number behind a prefix as the domain condition it names', () => {
    expect(
      problems(analyzeDestinationText, 'keyword:192.0.2\nregex:^10[.]'),
    ).toEqual([]);
  });

  it('counts an address written twice as one, whatever its case', () => {
    expect(
      problems(analyzeDestinationText, '2001:DB8::1\n2001:db8::1'),
    ).toHaveLength(1);
  });
});

describe('a DNS section', () => {
  it('takes domains of every kind', () => {
    expect(
      problems(
        analyzeDnsDestinationText,
        'example.org full:api.example.org keyword:video regex:^ads[.]',
      ),
    ).toEqual([]);
  });

  it.each(['192.0.2.1', '198.51.100.0/24', '2001:db8::/32'])(
    'refuses the address %s it could never match',
    (entry) => {
      expect(
        problems(analyzeDnsDestinationText, `example.org\n${entry}`),
      ).toEqual([`${entry}: IP addresses cannot be used in a DNS section`]);
    },
  );
});
