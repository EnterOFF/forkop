import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installLuciStubs } from '../../../../helpers/tests/luciStubs';
import { childPendingSettingsStore } from '../../../cbi/itemSettings';
import {
  currentDraftOutboundNames,
  currentLiveDynamicListValues,
  loadNativeProviderOutboundNames,
  loadSectionOutboundNameChoices,
  nativeProviderOutboundNames,
  outboundNameChoiceItems,
  outboundNameSourceOptions,
} from '../outboundNames';

// The names a group or a dashboard filter may be given.
//
// They come from two places. The running core knows the servers a subscription
// actually delivered, and answers over the Clash API; the dialog knows what the
// user has typed into the section but not saved yet. Both have to be offered, and
// neither may be invented: a name the list does not offer is a filter that
// matches nothing, and a filter value rewritten behind the user's back is a
// selection they did not make.

const PROVIDER_TAG = 'Main/sub1';
const PAYLOAD = {
  providers: {
    [PROVIDER_TAG]: {
      proxies: [
        { name: `${PROVIDER_TAG}/Main US`, type: 'VLESS' },
        { name: `${PROVIDER_TAG}/Main DE`, type: 'AnyTLS' },
        // A group the core built out of the provider is not a server.
        { name: `${PROVIDER_TAG}/Main Auto`, type: 'URLTest' },
      ],
    },
    'other-subscription-provider': {
      proxies: [
        { name: 'other-subscription-provider/Other JP', type: 'VLESS' },
      ],
    },
  },
};

const transport = (value: unknown) =>
  JSON.stringify({ status: 200, body: JSON.stringify(value) });

let calls: unknown[][] = [];
let response: Promise<unknown>;

function answerWith(next: Promise<unknown>) {
  response = next;
}

beforeEach(() => {
  calls = [];
  answerWith(Promise.resolve({ stdout: transport(PAYLOAD) }));
  const globals = globalThis as unknown as Record<string, unknown>;
  installLuciStubs({});
  globals.fs = {
    exec: (path: string, args: unknown) => {
      calls.push([path, args]);
      return response;
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  outboundNameSourceOptions.clear();
});

/* ------------------------------------------------- what the core answers */

describe('nativeProviderOutboundNames', () => {
  it('takes the servers of the named providers, without their prefix', () => {
    expect(nativeProviderOutboundNames([PROVIDER_TAG], PAYLOAD)).toEqual([
      'Main US',
      'Main DE',
    ]);
  });

  it('leaves the groups the core built out of them alone', () => {
    expect(nativeProviderOutboundNames([PROVIDER_TAG], PAYLOAD)).not.toContain(
      'Main Auto',
    );
  });

  it('leaves the servers of another provider alone', () => {
    expect(nativeProviderOutboundNames([PROVIDER_TAG], PAYLOAD)).not.toContain(
      'Other JP',
    );
  });
});

describe('loadNativeProviderOutboundNames', () => {
  it('asks the core over the Clash API', async () => {
    await expect(
      loadNativeProviderOutboundNames([PROVIDER_TAG]),
    ).resolves.toEqual(['Main US', 'Main DE']);
    expect(calls).toEqual([
      ['/usr/bin/forkop', ['clash_http', 'GET', '/providers/proxies', '']],
    ]);
  });

  // A stopped core is a request that goes unanswered, not a reason to offer the
  // user a shorter list than the one they configured.
  it('fails open when the core is unavailable', async () => {
    answerWith(Promise.reject(new Error('sing-box is unavailable')));

    await expect(loadNativeProviderOutboundNames([PROVIDER_TAG])).resolves.toBe(
      null,
    );
  });

  it('asks nothing when there is no provider to ask about', async () => {
    await expect(loadNativeProviderOutboundNames([])).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });
});

/* ------------------------------------------------------------- the cache */

describe('the choices of a section', () => {
  function sectionWithSubscription(sectionId: string) {
    const uci = installLuciStubs({
      [sectionId]: { '.type': 'section', label: 'Main' },
      [`${sectionId}_sub`]: {
        '.type': 'subscription_url',
        section: sectionId,
        tag: 'sub1',
      },
    });
    (globalThis as unknown as Record<string, unknown>).fs = {
      exec: (path: string, args: unknown) => {
        calls.push([path, args]);
        return response;
      },
    };
    return uci;
  }

  it('come from the running core, sorted', async () => {
    sectionWithSubscription('main');

    await expect(loadSectionOutboundNameChoices('main')).resolves.toEqual([
      'Main DE',
      'Main US',
    ]);
  });

  // The core knows a subscription only after it has been fetched, so an empty
  // answer must not be cached until the page is reloaded.
  it('are looked up again after an empty answer goes stale', async () => {
    sectionWithSubscription('empty_first');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    answerWith(Promise.resolve({ stdout: transport({ providers: {} }) }));
    await expect(
      loadSectionOutboundNameChoices('empty_first'),
    ).resolves.toEqual([]);

    // Still fresh: the empty answer stands.
    answerWith(Promise.resolve({ stdout: transport(PAYLOAD) }));
    await expect(
      loadSectionOutboundNameChoices('empty_first'),
    ).resolves.toEqual([]);

    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    await expect(
      loadSectionOutboundNameChoices('empty_first'),
    ).resolves.toEqual(['Main DE', 'Main US']);
  });
});

/* ---------------------------------------------------- what the dialog holds */

describe('the draft names of a section', () => {
  // Every source the section holds, in a state where each one contributes.
  function sectionWithDrafts(values: Record<string, string[]>) {
    installLuciStubs({
      main: { '.type': 'section', label: 'Main' },
      saved_interface: {
        '.type': 'section_interface',
        section: 'main',
        name: 'lan1',
        display_name: 'Renamed interface',
      },
    });

    const interfaceOption = {
      sharedPendingSettingsKey: 'interfaces',
      formvalue: () => values.interfaces || [],
    };
    outboundNameSourceOptions.set('interfaces', interfaceOption);
    outboundNameSourceOptions.set('selector_proxy_links', {
      formvalue: () => values.selector_proxy_links || [],
    });
    outboundNameSourceOptions.set('outbound_jsons', {
      formvalue: () => values.outbound_jsons || [],
    });
    outboundNameSourceOptions.set('tunnels', {
      formvalue: () => values.tunnels || [],
    });

    // A staged interface: its dialog was filled in but the section not saved.
    childPendingSettingsStore(
      interfaceOption as unknown as CBIOption,
      'main',
    ).new_interface = { display_name: 'Draft interface' };

    return values;
  }

  const SOURCES = {
    selector_proxy_links: ['vless://example.test#Draft%20URL'],
    interfaces: ['saved_interface', 'new_interface'],
    outbound_jsons: [
      '{"type":"socks","tag":"Leaf JSON"}',
      '{"type":"fallback","tag":"fallback"}',
      '{"type":"urltest","tag":"urltest"}',
    ],
  };

  it('replace a renamed interface, keep a staged one, and exclude the groups', () => {
    sectionWithDrafts({ ...SOURCES });

    expect(currentDraftOutboundNames('main')).toEqual([
      'Draft URL',
      'Renamed interface',
      'Draft interface',
      'Leaf JSON',
    ]);
  });

  it('drop an unsaved URL the moment it is deleted', () => {
    const values = sectionWithDrafts({
      ...SOURCES,
      selector_proxy_links: [],
    });
    void values;

    expect(currentDraftOutboundNames('main')).toEqual([
      'Renamed interface',
      'Draft interface',
      'Leaf JSON',
    ]);
  });
});

describe('outboundNameChoiceItems', () => {
  it('offers what the active sources hold', () => {
    expect(outboundNameChoiceItems(['lan2'], null)).toEqual([
      { value: 'lan2', label: 'lan2' },
    ]);
  });

  // A value the user typed is theirs to keep, but it is not something to offer
  // anybody else as a choice.
  it('promotes no selected custom value into the offered choices', () => {
    expect(outboundNameChoiceItems([], null)).toEqual([]);
  });
});

describe('currentLiveDynamicListValues', () => {
  // A DynamicList that was rebuilt leaves its old node behind in the document,
  // and reading the stale one answers with values the user has already deleted.
  it('reads the tracked widget rather than the one the document still has', () => {
    const node = {
      isConnected: true,
      querySelectorAll: () => [],
      querySelector: () => null,
    };
    outboundNameSourceOptions.set('selector_proxy_links', {
      liveDynamicListNodes: new Map([['main', node]]),
    });
    (globalThis as unknown as Record<string, unknown>).document = {
      getElementById() {
        throw new Error('the stale duplicate DynamicList was used');
      },
    };

    expect(
      currentLiveDynamicListValues('main', 'selector_proxy_links'),
    ).toEqual([]);
  });

  it('answers nothing at all once the tracked widget is unmounted', () => {
    outboundNameSourceOptions.set('selector_proxy_links', {
      liveDynamicListNodes: new Map([['main', { isConnected: false }]]),
    });

    expect(currentLiveDynamicListValues('main', 'selector_proxy_links')).toBe(
      null,
    );
  });
});
