import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfigSections: vi.fn(),
  getClashApiProxies: vi.fn(),
  getClashApiProxyProviders: vi.fn(),
  canUseDirectClashApi: vi.fn(),
}));

vi.mock('../getConfigSections', () => ({
  getConfigSections: mocks.getConfigSections,
}));

vi.mock('../../shell', () => ({
  ForkopShellMethods: {
    getClashApiProxies: mocks.getClashApiProxies,
    getClashApiProxyProviders: mocks.getClashApiProxyProviders,
  },
}));

vi.mock('../../../../helpers', () => ({
  canUseDirectClashApi: mocks.canUseDirectClashApi,
  getClashHttpUrl: () => 'http://router.example:9090',
  getProxyUrlName: (link?: string) =>
    link?.includes('#') ? decodeURIComponent(link.split('#').pop() || '') : '',
  isCopyableProxyLink: (link?: string) => Boolean(link),
}));

import { getDashboardSections } from '../getDashboardSections';
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

function setClashProxies(proxies: Record<string, ClashAPI.ProxyBase>) {
  mocks.getClashApiProxies.mockResolvedValue({
    success: true,
    data: { proxies },
  });
}

describe('getDashboardSections', () => {
  beforeEach(() => {
    mocks.getConfigSections.mockReset();
    mocks.getClashApiProxies.mockReset();
    mocks.getClashApiProxyProviders.mockReset();
    mocks.canUseDirectClashApi.mockReset();
    mocks.canUseDirectClashApi.mockReturnValue(false);
    mocks.getClashApiProxyProviders.mockResolvedValue({
      success: true,
      data: { providers: {} },
    });
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
    mocks.getClashApiProxyProviders.mockResolvedValue({
      success: true,
      data: {
        providers: {
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
    mocks.getClashApiProxyProviders.mockResolvedValue({
      success: true,
      data: {
        providers: {
          'Office/premium': {
            name: 'Office/premium',
            type: 'Remote',
            vehicleType: 'HTTP',
            proxies: [proxy('Trojan', { name: 'Office/premium/Remote' })],
          },
        },
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
        check_interval: '30s',
        tolerance: '25',
      }),
      child('fallback_group', 'rescue', {
        name: 'Rescue',
        health_check_url: 'https://fallback.example/204',
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
        all: ['Office/Fast', 'Office/Rescue'],
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
      },
    });
    expect(fallback).toMatchObject({
      code: 'Office/Rescue',
      displayName: 'Rescue',
      type: 'Fallback',
      selected: true,
      fallbackInfo: {
        selectedName: 'Node B',
        healthCheckUrl: 'https://fallback.example/204',
      },
    });
    expect(fallback.fallbackInfo?.outbounds).toEqual([
      expect.objectContaining({
        code: 'Office/Node A',
        displayName: 'Node A',
        levelName: 'Primary',
      }),
      expect.objectContaining({
        code: 'Office/Node B',
        displayName: 'Node B',
        levelName: 'Backup',
        selected: true,
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
      ok: true,
      json: async () => ({
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
    expect(mocks.getClashApiProxies).not.toHaveBeenCalled();
  });

  it('falls back to rpcd when direct Clash API access fails', async () => {
    mocks.getConfigSections.mockResolvedValue([
      section({ selector_proxy_links: ['vless://example#Node'] }),
    ]);
    mocks.canUseDirectClashApi.mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    setClashProxies({
      Office: proxy('Selector', { all: ['Office/Node'] }),
      'Office/Node': proxy('VLESS'),
    });

    const result = await getDashboardSections();

    expect(result.success).toBe(true);
    expect(mocks.getClashApiProxies).toHaveBeenCalledOnce();
  });
});
