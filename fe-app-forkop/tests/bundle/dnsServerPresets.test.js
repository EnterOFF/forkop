import { beforeEach, describe, expect, it } from 'vitest';

import { createHarness } from '../lib/luciForm.js';

let harness;

beforeEach(() => {
  harness = createHarness();
  harness.uci.add('forkop', 'settings', 'settings');
});

function settingsOption(name) {
  const map = new harness.form.Map('forkop');
  const section = map.section(harness.form.TypedSection, 'settings');
  section.cfgsections = () => ['settings'];
  harness.bundle.createSettingsContent(section);
  return section.children.find((child) => child.option === name);
}

describe('the DNS server fields', () => {
  it('offer each public resolver over UDP and DoH as a main server', () => {
    const dns = settingsOption('dns_server');

    expect(dns.keylist).toEqual([
      '77.88.8.8',
      'https://77.88.8.8/dns-query',
      '1.1.1.1',
      'https://1.1.1.1/dns-query',
      '8.8.8.8',
      'https://8.8.8.8/dns-query',
      '9.9.9.9',
      'https://9.9.9.9/dns-query',
      '94.140.14.14',
      'https://94.140.14.14/dns-query',
    ]);
    expect(dns.vallist.slice(0, 2)).toEqual([
      '77.88.8.8 (Yandex)',
      'https://77.88.8.8/dns-query (Yandex)',
    ]);
  });

  it('offer only unfiltered resolvers over UDP as a bootstrap server', () => {
    const bootstrap = settingsOption('bootstrap_dns_server');

    expect(bootstrap.keylist).toEqual([
      '77.88.8.8',
      '1.1.1.1',
      '8.8.8.8',
      '9.9.9.9',
    ]);
    expect(bootstrap.vallist).toEqual([
      '77.88.8.8 (Yandex)',
      '1.1.1.1 (Cloudflare)',
      '8.8.8.8 (Google)',
      '9.9.9.9 (Quad9)',
    ]);
  });

  it('accept every resolver they offer', () => {
    for (const name of ['dns_server', 'bootstrap_dns_server']) {
      const option = settingsOption(name);
      for (const value of option.keylist)
        expect(option.validate('settings', value)).toBe(true);
    }
  });
});
