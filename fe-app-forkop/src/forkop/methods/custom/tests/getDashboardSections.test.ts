import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfigSections: vi.fn(),
  clashHttp: vi.fn(),
  canUseDirectClashApi: vi.fn(),
}));

vi.mock('../getConfigSections', () => ({
  getConfigSections: mocks.getConfigSections,
}));

vi.mock('../../shell', () => ({
  ForkopShellMethods: {
    clashHttp: mocks.clashHttp,
  },
}));

vi.mock('../../../../helpers', () => ({
  canUseDirectClashApi: mocks.canUseDirectClashApi,
  getClashHttpUrl: () => 'http://router.example:9090',
  getProxyUrlName: (link?: string) =>
    link?.includes('#') ? decodeURIComponent(link.split('#').pop() || '') : '',
  isCopyableProxyLink: (link?: string) => Boolean(link),
}));

import {
  closeAllClashApiConnections,
  getClashApiConnections,
  getDashboardSections,
  getClashApiProxyLink,
  setClashApiGroupProxy,
  updateClashApiProxyProviders,
} from '../getDashboardSections';
import { ClashAPI, Forkop } from '../../../types';

function proxy(
  type: string,
  options: Partial<ClashAPI.ProxyBase> = {},
): ClashAPI.ProxyBase {
  return {
    type,
    name: options.name || '',
    udp: true,
    history: options.history || [],
    now: options.now,
    all: options.all,
    url: options.url,
    interval: options.interval,
    idle_timeout: options.idle_timeout,
    groups: options.groups,
    fixed: options.fixed,
  };
}

function section(
  options: Partial<Forkop.ConfigSection> = {},
): Forkop.ConfigSection {
  return {
    '.name': 'main',
    '.type': 'section',
    enabled: '1',
    action: 'connection',
    label: 'Office',
    ...options,
  };
}

function child(
  type: Forkop.ConfigSection['.type'],
  name: string,
  options: Partial<Forkop.ConfigSection> = {},
): Forkop.ConfigSection {
  return {
    '.name': name,
    '.type': type,
    section: 'main',
    ...options,
  };
}

function neverAnsweringFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('The operation was aborted'));
        });
      }),
  );
}

function clashHttpJson(status: number, payload: unknown) {
  return {
    success: true,
    data: {
      status,
      body: payload === undefined ? '' : JSON.stringify(payload),
    },
  };
}

let clashProxies: Record<string, ClashAPI.ProxyBase> = {};
let clashProviders: Record<string, unknown> = {};

function useClashHttpRuntime() {
  mocks.clashHttp.mockImplementation(async (_method: string, path: string) =>
    path === '/providers/proxies'
      ? clashHttpJson(200, { providers: clashProviders })
      : clashHttpJson(200, { proxies: clashProxies }),
  );
}

function setClashProxies(proxies: Record<string, ClashAPI.ProxyBase>) {
  clashProxies = proxies;
  useClashHttpRuntime();
}

function setClashProviders(providers: Record<string, unknown>) {
  clashProviders = providers;
  useClashHttpRuntime();
}

describe('getDashboardSections', () => {
  beforeEach(() => {
    mocks.getConfigSections.mockReset();
    mocks.clashHttp.mockReset();
    clashProxies = {};
    clashProviders = {};
    useClashHttpRuntime();
    mocks.canUseDirectClashApi.mockReset();
    mocks.canUseDirectClashApi.mockReturnValue(false);
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('fetch', undefined);
  });

  it('derives manual node identity and presentation from readable runtime tags', async () => {
    const links = [
      'vless://first@example.com:443#Same',
      'vless://second@example.com:443#Same',
      'trojan://secret@example.com:443',
      'vmess://example#Folder%2FNode',
    ];
    mocks.getConfigSections.mockResolvedValue([
      section({ selector_proxy_links: links }),
    ]);
    setClashProxies({
      Office: proxy('Selector', {
        name: 'Office',
        now: 'Office/Same',
        all: [
          'Office/Same',
          'Office/Same #2',
          'Office/Node #3',
          'Office/Folder/Node',
        ],
      }),
      'Office/Same': proxy('VLESS'),
      'Office/Same #2': proxy('VLESS'),
      'Office/Node #3': proxy('Trojan'),
      'Office/Folder/Node': proxy('VMess'),
    });

    const result = await getDashboardSections();
    const [dashboardSection] = result.data;

    expect(result.success).toBe(true);
    expect(dashboardSection.code).toBe('Office');
    expect(dashboardSection.outbounds).toEqual([
      expect.objectContaining({
        code: 'Office/Same',
        displayName: 'Same',
        link: links[0],
        selected: true,
      }),
      expect.objectContaining({
        code: 'Office/Same #2',
        displayName: 'Same #2',
        link: links[1],
      }),
      expect.objectContaining({
        code: 'Office/Node #3',
        displayName: 'Node #3',
        link: links[2],
      }),
      expect.objectContaining({
        code: 'Office/Folder/Node',
        displayName: 'Folder/Node',
        link: links[3],
      }),
    ]);
  });

  it('uses subscription tags as structure and only shows them as dashboard badges when enabled', async () => {
    mocks.getConfigSections.mockResolvedValue([
      section(),
      child('subscription_url', 'subscription1', {
        url: 'https://example.com/subscription',
        tag: 'premium',
        show_subscription_name: '1',
        show_dashboard_metadata: '1',
      }),
    ]);
    setClashProxies({
      Office: proxy('Selector', {
        name: 'Office',
        now: 'Office/premium/DE/Frankfurt',
        all: ['Office/premium/DE/Frankfurt'],
      }),
      'Office/premium/DE/Frankfurt': proxy('HTTP'),
    });
    setClashProviders({
      'Office/premium': {
        name: 'Office/premium',
        type: 'Remote',
        vehicleType: 'HTTP',
        proxies: [proxy('HTTP', { name: 'Office/premium/DE/Frankfurt' })],
        subscriptionInfo: {
          upload: 10,
          download: 20,
          total: 100,
          expire: 200,
        },
      },
    });

    const result = await getDashboardSections();
    const [dashboardSection] = result.data;

    expect(dashboardSection.proxyConfigType).toBe('subscription');
    expect(dashboardSection.outbounds[0]).toMatchObject({
      code: 'Office/premium/DE/Frankfurt',
      displayName: 'DE/Frankfurt',
      subscriptionTag: 'premium',
      canCopyLink: true,
    });
    expect(dashboardSection.subscriptionMetadata?.[0]).toMatchObject({
      sourceSection: 'Office/premium',
      traffic: { used: 30, total: 100, remaining: 70 },
      expire: 200,
    });
    expect(dashboardSection.subscriptionProviderTags).toEqual([
      'Office/premium',
    ]);
  });

  it('does not classify a static slash name as a subscription node', async () => {
    mocks.getConfigSections.mockResolvedValue([
      section({
        selector_proxy_links: [
          'vless://static@example.com:443#premium%2FStatic',
        ],
      }),
      child('subscription_url', 'subscription1', {
        url: 'https://example.com/subscription',
        tag: 'premium',
        show_subscription_name: '1',
      }),
    ]);
    setClashProxies({
      Office: proxy('Selector', {
        name: 'Office',
        now: 'Office/premium/Static',
        all: ['Office/premium/Static', 'Office/premium/Remote'],
      }),
      'Office/premium/Static': proxy('VLESS'),
      'Office/premium/Remote': proxy('Trojan'),
    });
    setClashProviders({
      'Office/premium': {
        name: 'Office/premium',
        type: 'Remote',
        vehicleType: 'HTTP',
        proxies: [proxy('Trojan', { name: 'Office/premium/Remote' })],
      },
    });

    const result = await getDashboardSections();

    expect(result.data[0].outbounds).toEqual([
      expect.objectContaining({
        code: 'Office/premium/Static',
        displayName: 'premium/Static',
        subscriptionTag: undefined,
      }),
      expect.objectContaining({
        code: 'Office/premium/Remote',
        displayName: 'Remote',
        subscriptionTag: 'premium',
      }),
    ]);
  });

  it('hydrates readable URLTest and Fallback groups from UCI and Clash API', async () => {
    mocks.getConfigSections.mockResolvedValue([
      section(),
      child('urltest', 'fast', {
        name: 'Fast',
        testing_url: 'https://fast.example/204',
        expected_status: '204/200-299',
        check_interval: '30s',
        tolerance: '25',
      }),
      child('fallback_group', 'rescue', {
        name: 'Rescue',
        health_check_url: 'https://fallback.example/204',
        attempt_timeout: '9s',
      }),
      child('fallback_level', 'primary', {
        section: undefined,
        group: 'rescue',
        name: 'Primary',
        order: '0',
      }),
      child('fallback_level', 'backup', {
        section: undefined,
        group: 'rescue',
        name: 'Backup',
        order: '1',
      }),
    ]);
    setClashProxies({
      Office: proxy('Selector', {
        name: 'Office',
        now: 'Office/Rescue',
        all: ['Office/Fast', 'Office/Rescue', 'Office/Nested'],
      }),
      'Office/Fast': proxy('URLTest', {
        name: 'Office/Fast',
        now: 'Office/Node A',
        all: ['Office/Node A', 'Office/Node B'],
        url: 'https://runtime.example/204',
        interval: '45s',
      }),
      'Office/Rescue': proxy('Fallback', {
        name: 'Office/Rescue',
        now: 'Office/Node B',
        fixed: 'Office/Node B',
        groups: [
          { outbounds: ['Office/Node A'] },
          { outbounds: ['Office/Node B'] },
        ],
      }),
      'Office/Node A': proxy('VLESS', {
        history: [{ time: '2026-08-13T00:00:00Z', delay: 80 }],
      }),
      'Office/Node B': proxy('Trojan', {
        history: [{ time: '2026-08-13T00:00:00Z', delay: 120 }],
      }),
      'Office/Nested': proxy('Selector', {
        all: ['Office/Node C'],
        now: 'Office/Node C',
      }),
      'Office/Node C': proxy('VLESS'),
    });

    const result = await getDashboardSections();
    const [urltest, fallback] = result.data[0].outbounds;

    expect(urltest).toMatchObject({
      code: 'Office/Fast',
      displayName: 'Fast',
      type: 'URLTest',
      urlTestInfo: {
        selectedName: 'Node A',
        url: 'https://runtime.example/204',
        interval: '45s',
        tolerance: 25,
        expectedStatus: '204/200-299',
      },
    });
    expect(result.data[0].latencyTestCode).toBe('Office');
    expect(fallback).toMatchObject({
      code: 'Office/Rescue',
      displayName: 'Rescue',
      type: 'Fallback',
      selected: true,
      fallbackInfo: {
        selectedName: 'Node B',
        healthCheckUrl: 'https://fallback.example/204',
        attemptTimeout: '9s',
        interruptExistConnections: false,
      },
    });
    expect(fallback.fallbackInfo?.outbounds).toEqual([
      expect.objectContaining({
        code: 'Office/Node A',
        displayName: 'Node A',
        levelName: 'Primary',
        pinned: false,
      }),
      expect.objectContaining({
        code: 'Office/Node B',
        displayName: 'Node B',
        levelName: 'Backup',
        selected: true,
        pinned: true,
      }),
    ]);
  });

  it('uses readable child tags for interface outbounds', async () => {
    mocks.getConfigSections.mockResolvedValue([
      section(),
      child('section_interface', 'interface1', {
        name: 'wg0',
        display_name: 'Home WG',
      }),
    ]);
    setClashProxies({
      Office: proxy('Selector', {
        name: 'Office',
        now: 'Office/Home WG',
        all: ['Office/Home WG'],
      }),
      'Office/Home WG': proxy('WireGuard'),
    });

    const result = await getDashboardSections();

    expect(result.data[0]).toMatchObject({
      code: 'Office',
      displayName: 'Office',
      proxyConfigType: 'interface',
    });
    expect(result.data[0].outbounds[0]).toMatchObject({
      code: 'Office/Home WG',
      displayName: 'Home WG',
      type: 'WireGuard',
    });
  });

  it('fetches Clash API directly when browser access is safe', async () => {
    mocks.getConfigSections.mockResolvedValue([
      section({ selector_proxy_links: ['vless://example#Node'] }),
    ]);
    mocks.canUseDirectClashApi.mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () =>
        JSON.stringify({
          proxies: {
            Office: proxy('Selector', { all: ['Office/Node'] }),
            'Office/Node': proxy('VLESS'),
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getDashboardSections();

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://router.example:9090/proxies',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(mocks.clashHttp).not.toHaveBeenCalled();
  });

  it('falls back to the CLI transport when the controller is unreachable', async () => {
    mocks.getConfigSections.mockResolvedValue([
      section({ selector_proxy_links: ['vless://example#Node'] }),
    ]);
    mocks.canUseDirectClashApi.mockReturnValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    setClashProxies({
      Office: proxy('Selector', { all: ['Office/Node'] }),
      'Office/Node': proxy('VLESS'),
    });

    const result = await getDashboardSections();

    expect(result.success).toBe(true);
    expect(mocks.clashHttp).toHaveBeenCalledWith('GET', '/proxies', '');
  });

  it('switches selectors through the direct Clash API', async () => {
    mocks.getConfigSections.mockResolvedValue([section()]);
    setClashProxies({
      Office: proxy('Selector', { all: ['Office/Node'] }),
      'Office/Node': proxy('VLESS'),
    });
    await getDashboardSections();
    mocks.clashHttp.mockClear();

    mocks.canUseDirectClashApi.mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue({ status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await setClashApiGroupProxy('Office/OUT', 'Office/Node');

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://router.example:9090/proxies/Office%2FOUT',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ name: 'Office/Node' }),
      }),
    );
    expect(mocks.clashHttp).not.toHaveBeenCalled();
  });

  it('fetches provider links and refreshes providers through the direct Clash API', async () => {
    mocks.getConfigSections.mockResolvedValue([section()]);
    setClashProxies({
      Office: proxy('Selector', { all: ['Office/Node'] }),
      'Office/Node': proxy('VLESS'),
    });
    await getDashboardSections();
    mocks.clashHttp.mockClear();

    mocks.canUseDirectClashApi.mockReturnValue(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        text: async () => JSON.stringify({ url: 'vless://id@example.com:443' }),
      })
      .mockResolvedValue({ status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getClashApiProxyLink('Office/Node')).resolves.toEqual({
      success: true,
      data: { url: 'vless://id@example.com:443' },
    });
    await expect(
      updateClashApiProxyProviders(['Office/premium', 'Office/backup']),
    ).resolves.toEqual({ success: true, data: undefined });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://router.example:9090/proxies/Office%2FNode/link',
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://router.example:9090/providers/proxies/Office%2Fpremium',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://router.example:9090/providers/proxies/Office%2Fbackup',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(mocks.clashHttp).not.toHaveBeenCalled();
  });

  it('surfaces a real Clash API HTTP error instead of retrying through the CLI', async () => {
    mocks.getConfigSections.mockResolvedValue([section()]);
    setClashProxies({
      Office: proxy('Selector', { all: ['Office/Node'] }),
      'Office/Node': proxy('VLESS'),
    });
    await getDashboardSections();
    mocks.clashHttp.mockClear();

    mocks.canUseDirectClashApi.mockReturnValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 403,
        text: async () => 'Forbidden',
      }),
    );

    await expect(getClashApiProxyLink('Office/Node')).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
    expect(mocks.clashHttp).not.toHaveBeenCalled();
  });

  it('does not repeat a mutation that timed out after it was sent', async () => {
    mocks.getConfigSections.mockResolvedValue([section()]);
    setClashProxies({
      Office: proxy('Selector', { all: ['Office/Node'] }),
      'Office/Node': proxy('VLESS'),
    });
    await getDashboardSections();
    mocks.clashHttp.mockClear();

    mocks.canUseDirectClashApi.mockReturnValue(true);
    vi.stubGlobal('fetch', neverAnsweringFetch());
    vi.useFakeTimers();

    const pending = closeAllClashApiConnections();
    await vi.advanceTimersByTimeAsync(60000);
    const result = await pending;
    vi.useRealTimers();

    expect(result.success).toBe(false);
    expect(mocks.clashHttp).not.toHaveBeenCalled();
  });

  it('retries an aborted read through the CLI transport', async () => {
    mocks.getConfigSections.mockResolvedValue([section()]);
    setClashProxies({
      Office: proxy('Selector', { all: ['Office/Node'] }),
      'Office/Node': proxy('VLESS'),
    });
    await getDashboardSections();
    mocks.clashHttp.mockClear();
    mocks.clashHttp.mockResolvedValue(clashHttpJson(200, { connections: [] }));

    mocks.canUseDirectClashApi.mockReturnValue(true);
    vi.stubGlobal('fetch', neverAnsweringFetch());
    vi.useFakeTimers();

    const pending = getClashApiConnections();
    await vi.advanceTimersByTimeAsync(60000);
    const result = await pending;
    vi.useRealTimers();

    expect(result).toEqual({
      success: true,
      data: { connections: [] },
    });
    expect(mocks.clashHttp).toHaveBeenCalledWith('GET', '/connections', '');
  });
});
