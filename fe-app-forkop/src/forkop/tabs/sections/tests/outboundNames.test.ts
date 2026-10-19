import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ providers: vi.fn() }));
vi.mock('../../../methods/custom/clashApi', () => ({
  getClashApiProxyProviders: mocks.providers,
}));

import { installLuciStubs } from '../../../../helpers/tests/luciStubs';
import { childPendingSettingsStore } from '../../../cbi/itemSettings';
import {
  currentDraftOutboundNames,
  currentLiveDynamicListValues,
  forgetOutboundNameChoices,
  loadNativeProviderOutboundNames,
  loadSectionOutboundNameChoices,
  nativeProviderOutboundNames,
  outboundNameChoiceItems,
  outboundNameSourceOptions,
  validateSectionChildName,
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

// What the Clash API request answers with once it got through.
const clashAnswer = (value: unknown) => ({ success: true, data: value });

function answerWith(next: Promise<unknown>) {
  mocks.providers.mockImplementation(() => next);
}

beforeEach(() => {
  mocks.providers.mockReset();
  answerWith(Promise.resolve(clashAnswer(PAYLOAD)));
  installLuciStubs({});
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
    expect(mocks.providers).toHaveBeenCalledTimes(1);
  });

  // A stopped core is a request that goes unanswered, not a reason to offer the
  // user a shorter list than the one they configured.
  it('fails open when the core is unavailable', async () => {
    answerWith(
      Promise.resolve({ success: false, error: 'sing-box is unavailable' }),
    );

    await expect(loadNativeProviderOutboundNames([PROVIDER_TAG])).resolves.toBe(
      null,
    );
  });

  it('asks nothing when there is no provider to ask about', async () => {
    await expect(loadNativeProviderOutboundNames([])).resolves.toEqual([]);
    expect(mocks.providers).not.toHaveBeenCalled();
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

    answerWith(Promise.resolve(clashAnswer({ providers: {} })));
    await expect(
      loadSectionOutboundNameChoices('empty_first'),
    ).resolves.toEqual([]);

    // Still fresh: the empty answer stands.
    answerWith(Promise.resolve(clashAnswer(PAYLOAD)));
    await expect(
      loadSectionOutboundNameChoices('empty_first'),
    ).resolves.toEqual([]);

    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    await expect(
      loadSectionOutboundNameChoices('empty_first'),
    ).resolves.toEqual(['Main DE', 'Main US']);
  });

  // A subscription that updated since the last dialog delivers other servers.
  it('are looked up again for the next dialog', async () => {
    sectionWithSubscription('updated');
    await loadSectionOutboundNameChoices('updated');

    const updated = {
      providers: {
        [PROVIDER_TAG]: {
          proxies: [{ name: `${PROVIDER_TAG}/Main NL`, type: 'VLESS' }],
        },
      },
    };
    answerWith(Promise.resolve(clashAnswer(updated)));
    await expect(loadSectionOutboundNameChoices('updated')).resolves.toEqual([
      'Main DE',
      'Main US',
    ]);

    forgetOutboundNameChoices();
    await expect(loadSectionOutboundNameChoices('updated')).resolves.toEqual([
      'Main NL',
    ]);
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
      saved_link: {
        '.type': 'connection_link',
        section: 'main',
        uri: 'vless://saved.test#Fragment',
        name: 'Stored name',
      },
    });

    const interfaceOption = {
      sharedPendingSettingsKey: 'interfaces',
      formvalue: () => values.interfaces || [],
    };
    outboundNameSourceOptions.set('interfaces', interfaceOption);
    const linkOption = { formvalue: () => values.connection_link || [] };
    outboundNameSourceOptions.set('connection_link', linkOption);
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
    // A link is a section the moment it is added, so a link in the list is
    // one; text still in the add field is named after the link it holds.
    connection_link: ['saved_link', 'vless://example.test#Draft%20URL'],
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
      'Stored name',
      'Draft URL',
      'Renamed interface',
      'Draft interface',
      'Leaf JSON',
    ]);
  });

  it('drop an unsaved URL the moment it is deleted', () => {
    const values = sectionWithDrafts({
      ...SOURCES,
      connection_link: [],
    });
    void values;

    expect(currentDraftOutboundNames('main')).toEqual([
      'Renamed interface',
      'Draft interface',
      'Leaf JSON',
    ]);
  });
});

describe('a name in a section', () => {
  // A link, an interface, a JSON outbound and a URLTest, as the section form
  // lists them. Each runs as "Main/<name>".
  function section() {
    installLuciStubs({
      main: { '.type': 'section', label: 'Main' },
      germany: {
        '.type': 'connection_link',
        section: 'main',
        uri: 'vless://a.test#A',
        name: 'Germany',
      },
      uplink: {
        '.type': 'section_interface',
        section: 'main',
        name: 'wan',
        display_name: 'Uplink',
      },
      fastest: { '.type': 'urltest', section: 'main', name: 'Fastest' },
    });
    const listed = (values: string[]) => ({ formvalue: () => values });
    outboundNameSourceOptions.set('connection_link', listed(['germany']));
    outboundNameSourceOptions.set('interfaces', {
      sharedPendingSettingsKey: 'interfaces',
      ...listed(['uplink']),
    });
    outboundNameSourceOptions.set('tunnels', listed([]));
    outboundNameSourceOptions.set(
      'outbound_jsons',
      listed(['{"type":"socks","tag":"Hop"}']),
    );
    outboundNameSourceOptions.set('urltest', listed(['fastest']));
    outboundNameSourceOptions.set('fallback_group', listed([]));
  }
  const TAKEN = 'Name already taken';

  it('belongs to one server or group of whatever kind', () => {
    section();

    expect(validateSectionChildName('main', 'tunnel', 'Germany')).toBe(TAKEN);
    expect(validateSectionChildName('main', 'link', 'Fastest')).toBe(TAKEN);
    expect(validateSectionChildName('main', 'fallback', 'Hop')).toBe(TAKEN);
    expect(validateSectionChildName('main', 'json', 'Uplink')).toBe(TAKEN);
    expect(validateSectionChildName('main', 'tunnel', 'Netherlands')).toBe(
      true,
    );
  });

  // A list tells its own entries apart. An interface list does not, so an
  // interface is told apart from the others by its own name.
  it('leaves two of one list to the list, and knows an interface by its own name', () => {
    section();

    expect(validateSectionChildName('main', 'link', 'Germany')).toBe(true);
    expect(validateSectionChildName('main', 'interface', 'Uplink', 'wan')).toBe(
      true,
    );
    expect(validateSectionChildName('main', 'interface', 'Uplink', 'lan')).toBe(
      TAKEN,
    );
  });

  it('holds no slash', () => {
    section();

    expect(validateSectionChildName('main', 'link', 'US/LA')).toBe(
      'The / character is not allowed',
    );
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
    outboundNameSourceOptions.set('connection_link', {
      liveDynamicListNodes: new Map([['main', node]]),
    });
    (globalThis as unknown as Record<string, unknown>).document = {
      getElementById() {
        throw new Error('the stale duplicate DynamicList was used');
      },
    };

    expect(currentLiveDynamicListValues('main', 'connection_link')).toEqual([]);
  });

  it('answers nothing at all once the tracked widget is unmounted', () => {
    outboundNameSourceOptions.set('connection_link', {
      liveDynamicListNodes: new Map([['main', { isConnected: false }]]),
    });

    expect(currentLiveDynamicListValues('main', 'connection_link')).toBe(null);
  });
});
