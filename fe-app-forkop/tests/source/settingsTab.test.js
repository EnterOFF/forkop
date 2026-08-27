// The Settings tab: the router's own resolvers, the static DNS records, and the
// schedule the component update check runs on.
//
// The rules the fields apply are exercised as calls - the DNS query mode in
// src/forkop/cbi/tests/configureDnsQueryMode.test.ts, the cron interval in
// src/forkop/tabs/settings/tests/isCronExpressibleInterval.test.ts. What is left
// here is that the fields exist, say the right thing, and run those checks.
import fs from 'fs';

import { describe, expect, it } from 'vitest';

import { SRC } from '../lib/paths.js';
import { tabSource } from '../lib/tabSource.js';

const settings = await tabSource('settings');

const readAll = (dir) => {
  const walk = (current, out = []) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = `${current}/${item.name}`;
      if (item.isDirectory()) walk(full, out);
      else out.push(fs.readFileSync(full, 'utf8'));
    }
    return out;
  };
  return walk(`${SRC}/${dir}`).join('\n');
};

describe('the DNS fields', () => {
  it.each([
    "_('Preferred IP address type for domains')",
    "_('DNS through section')",
    "_('DNS requests through')",
    "_('DNS Server')",
    "_('Route main DNS requests through a section')",
    "'Several servers give automatic failover. The protocol is set by a prefix: udp://, tcp://, tls://, https://, quic://, h3://'",
    "'Resolve the addresses of the main DNS servers and proxies. Several servers give automatic failover. The protocol is set by a prefix: udp://, tcp://, tls://, https://, quic://, h3://'",
  ])('say %s', (expected) => {
    expect(settings).toContain(expected);
  });

  // The protocol is a prefix on the address now, so there is no separate
  // selector and no list of presets to pick from.
  it('expose no shared protocol selector', () => {
    expect(settings).not.toContain("'dns_type'");
  });

  it('expose no preset server list', () => {
    expect(settings).not.toMatch(
      /DNS_SERVER_OPTIONS|BOOTSTRAP_DNS_SERVER_OPTIONS/,
    );
  });

  // The detour is a section, which may be a DPI rule rather than a proxy.
  it('do not call the detour a proxy', () => {
    expect(settings).not.toContain("_('DNS through proxy')");
  });
});

describe('the static DNS records', () => {
  it('are checked before they are saved', () => {
    expect(settings).toContain('analyzeStaticHosts(');
  });

  it('mark an invalid entry while it is typed', () => {
    expect(settings).toContain('configureTextareaOption(');
  });

  it('are edited from a dedicated button', () => {
    expect(settings).toContain("_('Edit')");
  });
});

describe('the component update interval', () => {
  it('runs the cron rule in its own validator', () => {
    // The field and its validator, up to whichever option is declared next.
    const start = settings.indexOf("'component_update_check_interval',");
    expect(start, 'the interval field was not found').toBeGreaterThan(0);
    const next = settings.indexOf('o = section.option(', start + 1);
    expect(settings.slice(start, next < 0 ? undefined : next)).toContain(
      'isCronExpressibleInterval',
    );
  });

  // The subscription update interval is handed to sing-box, never to cron, and
  // must keep accepting the values cron cannot express. So the cron rule is a
  // check of its own beside the shared duration validator, never folded into it.
  // One copy of the generic check, in the shared validators: both tabs import
  // it, and they are modules of one bundle the browser loads whole or not at all.
  it('leaves the generic duration check in the shared validators', () => {
    expect(readAll('forkop')).not.toContain('function isSingBoxDuration');
  });

  it('does not reach the shared duration validator', () => {
    const duration = fs.readFileSync(
      `${SRC}/validators/validateSingBoxDuration.ts`,
      'utf8',
    );
    expect(duration).toContain('function isSingBoxDuration');
    expect(duration).not.toContain('isCronExpressibleInterval');
  });
});
