import { beforeEach, describe, expect, it } from 'vitest';

import { installUciStub } from '../../../../../helpers/tests/luciStubs';
import { addSubscriptionUrlItemOptions } from '../options';
import { validateSubscriptionUrlEntry } from '../model';

// The dialog reads the stored value of a sibling option while it is building
// itself, and a bundled module takes uci off LuCI rather than importing it.
beforeEach(() => {
  installUciStub({});
});

// A subscription is either a URL the router fetches or a file on the router, and
// the dialog is the same dialog for both. Everything about fetching - the update
// schedule, the proxy to fetch through, the request headers - only makes sense
// for a URL, so the dialog shows it while the address field holds one, and a
// field the dialog hides is not stored.

const REMOTE_ONLY = [
  'subscription_update_enabled',
  'subscription_update_interval',
  'download_via_proxy_enabled',
  'download_via_proxy_section',
  '_subscription_headers',
  'show_dashboard_metadata',
];

const ALWAYS = ['tag', 'url', 'server_filter_mode'];

// Which options the dialog shows for an address, by what each one depends on.
function shownFor(source: string) {
  const dependencies = new Map<string, Array<Record<string, unknown>>>();
  const section = {
    map: {},
    option: (_type: unknown, name: string) => {
      dependencies.set(name, []);
      return {
        depends(key: unknown, value: unknown) {
          dependencies
            .get(name)!
            .push(
              typeof key === 'string'
                ? { [key]: value }
                : (key as Record<string, unknown>),
            );
        },
        value() {},
      };
    },
  };

  addSubscriptionUrlItemOptions(section as unknown as CBISection, {
    parentSectionId: () => 'proxy',
  });

  return [...dependencies.entries()]
    .filter(
      ([, depends]) =>
        !depends.length ||
        depends.some(
          (dependency) =>
            !(dependency.url instanceof RegExp) || dependency.url.test(source),
        ),
    )
    .map(([name]) => name);
}

describe('a remote subscription', () => {
  it.each([...REMOTE_ONLY, ...ALWAYS])('is offered %s', (name) => {
    expect(shownFor('https://example.com/sub')).toContain(name);
  });
});

describe('a local subscription', () => {
  it.each(REMOTE_ONLY)('is not offered %s', (name) => {
    expect(shownFor('/etc/forkop/subscription.txt')).not.toContain(name);
  });

  it.each(ALWAYS)('is offered %s', (name) => {
    expect(shownFor('/etc/forkop/subscription.txt')).toContain(name);
  });
});

describe('validateSubscriptionUrlEntry', () => {
  it('accepts a URL', () => {
    expect(
      validateSubscriptionUrlEntry('settings', 'https://example.com/sub'),
    ).toBe(true);
  });

  it('accepts an absolute local path', () => {
    expect(
      validateSubscriptionUrlEntry('settings', '/etc/forkop/subscription.txt'),
    ).toBe(true);
  });

  // A relative path is resolved against whatever directory the service happens
  // to run in, which is not something the user can see or rely on.
  it('refuses a relative path, saying why', () => {
    expect(
      validateSubscriptionUrlEntry('settings', 'relative/subscription.txt'),
    ).toBe('URL or absolute path only');
  });
});
