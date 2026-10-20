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
  nextSectionChildName,
  outboundNameChoiceItems,
  outboundNameSourceOptions,
  validateSectionChildName,
} from '../outboundNames';

const PROVIDER_TAG = 'Main/sub1';
const PAYLOAD = {
  providers: {
    [PROVIDER_TAG]: {
      proxies: [
        { name: `${PROVIDER_TAG}/Main US`, type: 'VLESS' },
        { name: `${PROVIDER_TAG}/Main DE`, type: 'AnyTLS' },
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

  it('are looked up again after an empty answer goes stale', async () => {
    sectionWithSubscription('empty_first');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    answerWith(Promise.resolve(clashAnswer({ providers: {} })));
    await expect(
      loadSectionOutboundNameChoices('empty_first'),
    ).resolves.toEqual([]);

    answerWith(Promise.resolve(clashAnswer(PAYLOAD)));
    await expect(
      loadSectionOutboundNameChoices('empty_first'),
    ).resolves.toEqual([]);

    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    await expect(
      loadSectionOutboundNameChoices('empty_first'),
    ).resolves.toEqual(['Main DE', 'Main US']);
  });

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

describe('the draft names of a section', () => {
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

    childPendingSettingsStore(
      interfaceOption as unknown as CBIOption,
      'main',
    ).new_interface = { display_name: 'Draft interface' };

    return values;
  }

  const SOURCES = {
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

describe('the name offered to a new group or tunnel', () => {
  function section(urltests: Record<string, string>, linkName: string) {
    installLuciStubs({
      main: { '.type': 'section', label: 'Main' },
      link: {
        '.type': 'connection_link',
        section: 'main',
        uri: 'vless://a.test#A',
        name: linkName,
      },
      ...Object.fromEntries(
        Object.entries(urltests).map(([id, name]) => [
          id,
          { '.type': 'urltest', section: 'main', name },
        ]),
      ),
    });
    const listed = (values: string[]) => ({ formvalue: () => values });
    outboundNameSourceOptions.set('connection_link', listed(['link']));
    outboundNameSourceOptions.set('interfaces', listed([]));
    outboundNameSourceOptions.set('tunnels', listed([]));
    outboundNameSourceOptions.set('outbound_jsons', listed([]));
    outboundNameSourceOptions.set('urltest', listed(Object.keys(urltests)));
    outboundNameSourceOptions.set('fallback_group', listed([]));
  }

  it('is one past the highest number taken, not one past the count', () => {
    section({ second: 'URLTest #2' }, 'Germany');

    expect(nextSectionChildName('main', 'URLTest')).toBe('URLTest #3');
  });

  it('starts at one among groups the user named', () => {
    section({ fastest: 'test' }, 'Germany');

    expect(nextSectionChildName('main', 'URLTest')).toBe('URLTest #1');
  });

  it('skips a name a server of the section holds, since names are shared', () => {
    section({}, 'Fallback #1');

    expect(nextSectionChildName('main', 'Fallback')).toBe('Fallback #2');
  });
});

describe('outboundNameChoiceItems', () => {
  it('offers what the active sources hold', () => {
    expect(outboundNameChoiceItems(['lan2'], null)).toEqual([
      { value: 'lan2', label: 'lan2' },
    ]);
  });

  it('promotes no selected custom value into the offered choices', () => {
    expect(outboundNameChoiceItems([], null)).toEqual([]);
  });
});

describe('currentLiveDynamicListValues', () => {
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
