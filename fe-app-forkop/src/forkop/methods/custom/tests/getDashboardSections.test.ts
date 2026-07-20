import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfigSections: vi.fn(),
  getClashApiProxies: vi.fn(),
  getClashApiProxyProviders: vi.fn(),
  canUseDirectClashApi: vi.fn(),
  dashboardCacheRead: vi.fn(),
}));

vi.mock('../getConfigSections', () => ({
  getConfigSections: mocks.getConfigSections,
}));

vi.mock('../../shell', () => ({
  ForkopShellMethods: {
    getClashApiProxies: mocks.getClashApiProxies,
    getClashApiProxyProviders: mocks.getClashApiProxyProviders,
    getDashboardSectionCache: async (section: string) => {
      try {
        return {
          success: true,
          data: JSON.parse(await mocks.dashboardCacheRead(section)),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '',
        };
      }
    },
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
  };
}

function proxySection(
  options: Partial<Forkop.ConfigSection> = {},
): Forkop.ConfigSection {
  return {
    '.name': 'main',
    '.type': 'section',
    enabled: '1',
    action: 'proxy',
    selector_proxy_links: ['vless://example#one'],
    urltests: ['urltest'],
    urltest_settings: urlTestSettings('urltest', {
      display_name: 'Fastest',
      urltest_filter_mode: 'exclude',
    }),
    ...options,
  };
}

function urlTestSettings(
  id: string,
  settings: Record<string, string> = {},
): string {
  return JSON.stringify({
    [id]: settings,
  });
}

function priorityGroup(
  id: string,
  options: Partial<Forkop.ConfigSection> = {},
): Forkop.ConfigSection {
  return {
    '.name': id,
    '.type': 'priority_group',
    section: 'main',
    name: 'Codex Priority',
    blacklist_timeout: '45s',
    pin_dashboard: '1',
    ...options,
  };
}

function priorityLevel(
  id: string,
  options: Partial<Forkop.ConfigSection> = {},
): Forkop.ConfigSection {
  return {
    '.name': id,
    '.type': 'priority_level',
    group: 'pg_main',
    name: 'Germany',
    order: '0',
    regex: ['Included'],
    ...options,
  };
}

const clashProxies: Record<string, ClashAPI.ProxyBase> = {
  'main-out': proxy('Selector', {
    name: 'main-out',
    now: 'main-1-out',
    all: ['main-1-out', 'main-2-out', 'main-3-out', 'main-urltest-out'],
  }),
  'main-urltest-out': proxy('URLTest', {
    name: 'main-urltest-out',
    history: [{ time: '2026-05-27T00:00:00Z', delay: 10 }],
    all: ['main-1-out', 'main-3-out'],
  }),
  'main-1-out': proxy('VLESS', {
    name: 'Included 1',
    history: [{ time: '2026-05-27T00:00:00Z', delay: 100 }],
  }),
  'main-2-out': proxy('VLESS', {
    name: 'Filtered 2',
    history: [{ time: '2026-05-27T00:00:00Z', delay: 200 }],
  }),
  'main-3-out': proxy('VLESS', {
    name: 'Included 3',
    history: [{ time: '2026-05-27T00:00:00Z', delay: 300 }],
  }),
};

describe('getDashboardSections', () => {
  beforeEach(() => {
    mocks.getConfigSections.mockReset();
    mocks.getClashApiProxies.mockReset();
    mocks.getClashApiProxyProviders.mockReset();
    mocks.canUseDirectClashApi.mockReset();
    mocks.dashboardCacheRead.mockReset();
    mocks.dashboardCacheRead.mockResolvedValue('{}');
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('fetch', undefined);

    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: { proxies: clashProxies },
    });
    mocks.getClashApiProxyProviders.mockResolvedValue({
      success: true,
      data: { providers: {} },
    });
    mocks.canUseDirectClashApi.mockReturnValue(false);
  });

  it('shows the full selector group by default', async () => {
    mocks.getConfigSections.mockResolvedValue([proxySection()]);

    const result = await getDashboardSections();
    const [section] = result.data;

    expect(result.success).toBe(true);
    expect(section.latencyTestCode).toBe('main-out');
    expect(section.latencyTestCodes).toEqual([
      'main-urltest-out',
      'main-1-out',
      'main-2-out',
      'main-3-out',
    ]);
    expect(section.outbounds.map((item) => item.code)).toEqual([
      'main-urltest-out',
      'main-1-out',
      'main-2-out',
      'main-3-out',
    ]);
  });

  it('surfaces dashboard section cache read failures', async () => {
    mocks.getConfigSections.mockResolvedValue([proxySection()]);
    mocks.dashboardCacheRead.mockRejectedValue(new Error('cache read failed'));

    await expect(getDashboardSections()).rejects.toThrow('cache read failed');
  });

  it('hydrates URLTest details from the section cache and Clash API', async () => {
    mocks.getConfigSections.mockResolvedValue([proxySection()]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: {
        proxies: {
          ...clashProxies,
          'main-urltest-out': proxy('URLTest', {
            name: 'main-urltest-out',
            now: 'main-3-out',
            history: [{ time: '2026-05-27T00:00:00Z', delay: 10 }],
            all: ['main-1-out', 'main-3-out'],
          }),
        },
      },
    });
    mocks.dashboardCacheRead.mockResolvedValue(
      JSON.stringify({
        outboundMetadata: {
          names: {
            'main-1-out': 'First cached',
            'main-3-out': 'Third cached',
          },
        },
        urltestGroups: {
          'main-urltest-out': {
            displayName: 'Fastest',
            outbounds: ['main-1-out', 'main-3-out', 'main-2-out'],
            url: 'https://probe.example/204',
            interval: '3m',
            tolerance: 50,
            interrupt_exist_connections: true,
          },
        },
      }),
    );

    const result = await getDashboardSections();
    const [section] = result.data;
    const urltest = section.outbounds.find(
      (item) => item.code === 'main-urltest-out',
    );

    expect(result.success).toBe(true);
    expect(urltest?.urlTestInfo).toMatchObject({
      code: 'main-urltest-out',
      displayName: 'Fastest',
      url: 'https://probe.example/204',
      interval: '3m',
      tolerance: 50,
      idleTimeout: '30m',
      interruptExistConnections: true,
      selectedCode: 'main-3-out',
      selectedName: 'Third cached',
    });
    expect(urltest?.urlTestInfo?.outbounds.map((item) => item.code)).toEqual([
      'main-3-out',
      'main-1-out',
      'main-2-out',
    ]);
    expect(urltest?.urlTestInfo?.outbounds[0]).toMatchObject({
      displayName: 'Third cached',
      latency: 300,
      type: 'VLESS',
      selected: true,
    });
    expect(urltest?.urlTestInfo?.outbounds[1]).toMatchObject({
      displayName: 'First cached',
      latency: 100,
      selected: false,
    });
  });

  it('hides overlapping URLTest and Priority members but keeps every group', async () => {
    const urlTestCode = 'main-urltest-fast-out';
    const priorityCode = 'main-priority-priority-out';
    const priorityLevelCode = 'main-priority-priority-level-primary-out';
    const nodeCodes = ['node-a', 'node-b', 'node-c', 'node-d'];

    mocks.getConfigSections.mockResolvedValue([
      proxySection({
        selector_proxy_links: [],
        urltests: [],
        urltest_settings: undefined,
      }),
      {
        '.name': 'fast',
        '.type': 'urltest',
        section: 'main',
        name: 'Fast',
      },
      priorityGroup('priority', {
        name: 'Priority',
      }),
      priorityLevel('primary', {
        group: 'priority',
        name: 'Primary',
      }),
    ]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: {
        proxies: {
          'main-out': proxy('Selector', {
            now: priorityCode,
            all: [urlTestCode, priorityCode, ...nodeCodes],
          }),
          [urlTestCode]: proxy('URLTest', {
            all: ['node-a', 'node-b'],
          }),
          [priorityCode]: proxy('Fallback', {
            all: [priorityLevelCode],
            now: priorityLevelCode,
          }),
          [priorityLevelCode]: proxy('Fallback', {
            all: ['node-c', 'node-d'],
            now: 'node-c',
          }),
          ...Object.fromEntries(
            nodeCodes.map((code) => [code, proxy('VLESS', { name: code })]),
          ),
        },
      },
    });
    mocks.dashboardCacheRead.mockResolvedValue(
      JSON.stringify({
        urltestGroups: {
          [urlTestCode]: { hide_dashboard_members: true },
        },
        priorityGroups: {
          [priorityCode]: { hide_dashboard_members: true },
        },
      }),
    );

    const result = await getDashboardSections();

    expect(result.data[0].outbounds.map((outbound) => outbound.code)).toEqual([
      urlTestCode,
      priorityCode,
    ]);
  });

  it('keeps an empty configured URLTest visible when sing-box skipped the group', async () => {
    mocks.getConfigSections.mockResolvedValue([
      proxySection({
        urltest_settings: urlTestSettings('urltest', {
          display_name: 'Empty URLTest',
          urltest_filter_mode: 'include',
        }),
      }),
    ]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: {
        proxies: {
          'main-out': proxy('Selector', {
            name: 'main-out',
            now: 'main-1-out',
            all: ['main-1-out'],
          }),
          'main-1-out': clashProxies['main-1-out'],
        },
      },
    });
    mocks.dashboardCacheRead.mockResolvedValue(
      JSON.stringify({
        urltestGroups: {
          'main-urltest-out': {
            displayName: 'Empty URLTest',
            outbounds: [],
            url: 'https://probe.example/204',
            interval: '3m',
            tolerance: 50,
          },
        },
      }),
    );

    const result = await getDashboardSections();
    const [section] = result.data;
    const urltest = section.outbounds.find(
      (item) => item.code === 'main-urltest-out',
    );

    expect(result.success).toBe(true);
    expect(section.outbounds.map((item) => item.code)).toEqual([
      'main-urltest-out',
      'main-1-out',
    ]);
    expect(urltest).toMatchObject({
      displayName: 'Empty URLTest',
      type: 'URLTest',
      runtimeAvailable: false,
    });
    expect(urltest?.urlTestInfo?.selectedName).toBeUndefined();
    expect(urltest?.urlTestInfo?.outbounds).toEqual([]);
  });

  it('hydrates Priority dashboard details from config, cache and Clash API', async () => {
    mocks.getConfigSections.mockResolvedValue([
      proxySection({ urltests: [], urltest_settings: undefined }),
      priorityGroup('pg_main'),
      priorityLevel('pl_de', {
        name: 'Germany',
        order: '0',
      }),
      priorityLevel('pl_nl', {
        name: 'Netherlands',
        order: '1',
        regex: ['Filtered'],
      }),
    ]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: {
        proxies: {
          ...clashProxies,
          'main-out': proxy('Selector', {
            name: 'main-out',
            now: 'main-priority-pg_main-out',
            all: ['main-1-out', 'main-2-out', 'main-priority-pg_main-out'],
          }),
          'main-priority-pg_main-out': proxy('Fallback', {
            name: 'main-priority-pg_main-out',
            now: 'main-priority-pg_main-level-pl_de-out',
            all: [
              'main-priority-pg_main-level-pl_de-out',
              'main-priority-pg_main-level-pl_nl-out',
            ],
          }),
          'main-priority-pg_main-level-pl_de-out': proxy('Fallback', {
            name: 'main-priority-pg_main-level-pl_de-out',
            now: 'main-2-out',
            all: ['main-2-out'],
          }),
          'main-priority-pg_main-level-pl_nl-out': proxy('Fallback', {
            name: 'main-priority-pg_main-level-pl_nl-out',
            now: 'main-1-out',
            all: ['main-1-out'],
          }),
        },
      },
    });
    mocks.dashboardCacheRead.mockResolvedValue(
      JSON.stringify({
        outboundMetadata: {
          names: {
            'main-1-out': 'First cached',
            'main-2-out': 'Second cached',
          },
        },
        priorityGroups: {
          'main-priority-pg_main-out': {
            displayName: 'Codex Priority',
            blacklist_timeout: '45s',
            outbounds: [
              'main-priority-pg_main-level-pl_de-out',
              'main-priority-pg_main-level-pl_nl-out',
            ],
            levels: [
              {
                id: 'pl_de',
                tag: 'main-priority-pg_main-level-pl_de-out',
                displayName: 'Germany',
                order: 0,
                outbounds: [],
              },
              {
                id: 'pl_nl',
                tag: 'main-priority-pg_main-level-pl_nl-out',
                displayName: 'Netherlands',
                order: 1,
                outbounds: [],
              },
            ],
          },
        },
      }),
    );

    const result = await getDashboardSections();
    const [section] = result.data;
    const priority = section.outbounds.find(
      (item) => item.code === 'main-priority-pg_main-out',
    );

    expect(result.success).toBe(true);
    expect(priority).toMatchObject({
      displayName: 'Codex Priority',
      type: 'Priority',
      selected: true,
    });
    expect(priority?.priorityInfo).toMatchObject({
      selectedCode: 'main-2-out',
      selectedName: 'Second cached',
      blacklistTimeout: '45s',
    });
    expect(
      priority?.priorityInfo?.outbounds.map((item) => ({
        code: item.code,
        levelIndex: item.levelIndex,
        levelName: item.levelName,
        selected: item.selected,
      })),
    ).toEqual([
      {
        code: 'main-2-out',
        levelIndex: 0,
        levelName: 'Germany',
        selected: true,
      },
      {
        code: 'main-1-out',
        levelIndex: 1,
        levelName: 'Netherlands',
        selected: false,
      },
    ]);
  });

  it('keeps an empty Priority group visible when sing-box skipped the selector', async () => {
    mocks.getConfigSections.mockResolvedValue([
      proxySection({
        selector_proxy_links: [],
        urltests: [],
        urltest_settings: undefined,
      }),
      priorityGroup('pg_empty', { name: 'Empty Priority' }),
    ]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: { proxies: {} },
    });
    mocks.dashboardCacheRead.mockResolvedValue(
      JSON.stringify({
        priorityGroups: {
          'main-priority-pg_empty-out': {
            displayName: 'Empty Priority',
            outbounds: [],
            levels: [],
            interrupt_exist_connections: true,
          },
        },
      }),
    );

    const result = await getDashboardSections();
    const [section] = result.data;
    const priority = section.outbounds.find(
      (item) => item.code === 'main-priority-pg_empty-out',
    );

    expect(result.success).toBe(true);
    expect(section.outbounds.map((item) => item.code)).toEqual([
      'main-priority-pg_empty-out',
    ]);
    expect(priority).toMatchObject({
      displayName: 'Empty Priority',
      type: 'Priority',
      runtimeAvailable: false,
      latency: 0,
    });
    expect(priority?.priorityInfo?.selectedName).toBeUndefined();
    expect(priority?.priorityInfo?.outbounds).toEqual([]);
  });

  it('keeps legacy URLTest sections compatible before migration', async () => {
    mocks.getConfigSections.mockResolvedValue([
      proxySection({
        urltests: undefined,
        urltest_settings: undefined,
        urltest_enabled: '1',
        urltest_filter_mode: 'exclude',
      }),
    ]);

    const result = await getDashboardSections();
    const [section] = result.data;

    expect(result.success).toBe(true);
    expect(section.outbounds.map((item) => item.code)).toEqual([
      'main-urltest-out',
      'main-1-out',
      'main-2-out',
      'main-3-out',
    ]);
    expect(section.outbounds[0].displayName).toBe('Fastest');
  });

  it('supports multiple configured URLTest groups', async () => {
    mocks.getConfigSections.mockResolvedValue([
      proxySection({
        urltests: undefined,
        urltest_settings: undefined,
      }),
      {
        '.name': 'cfg010001',
        '.type': 'urltest',
        section: 'main',
        name: 'Fast group',
      },
      {
        '.name': 'cfg010002',
        '.type': 'urltest',
        section: 'main',
        name: 'Stable group',
      },
    ]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: {
        proxies: {
          ...clashProxies,
          'main-out': proxy('Selector', {
            name: 'main-out',
            now: 'main-urltest-cfg010001-out',
            all: [
              'main-1-out',
              'main-urltest-cfg010002-out',
              'main-2-out',
              'main-urltest-cfg010001-out',
            ],
          }),
          'main-urltest-cfg010001-out': proxy('URLTest', {
            name: 'main-urltest-cfg010001-out',
            history: [{ time: '2026-05-27T00:00:00Z', delay: 10 }],
            all: ['main-1-out'],
          }),
          'main-urltest-cfg010002-out': proxy('URLTest', {
            name: 'main-urltest-cfg010002-out',
            history: [{ time: '2026-05-27T00:00:00Z', delay: 50 }],
            all: ['main-2-out'],
          }),
        },
      },
    });

    const result = await getDashboardSections();
    const [section] = result.data;

    expect(result.success).toBe(true);
    expect(section.outbounds.map((item) => item.code)).toEqual([
      'main-urltest-cfg010001-out',
      'main-urltest-cfg010002-out',
      'main-1-out',
      'main-2-out',
    ]);
    expect(section.outbounds.map((item) => item.displayName)).toEqual([
      'Fast group',
      'Stable group',
      'Included 1',
      'Filtered 2',
    ]);
  });

  it('keeps manual connection URLs on native local-provider runtime tags', async () => {
    const firstCode = 'main-manual-provider/Manual VLESS';
    const secondCode = 'main-manual-provider/Manual Trojan';
    const firstLink = 'vless://id@example.com:443#Manual%20VLESS';
    const secondLink = 'trojan://secret@example.com:443#Manual%20Trojan';
    mocks.getConfigSections.mockResolvedValue([
      proxySection({
        selector_proxy_links: [firstLink, secondLink],
        urltests: [],
        urltest_settings: undefined,
      }),
    ]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: {
        proxies: {
          'main-out': proxy('Selector', {
            name: 'main-out',
            now: firstCode,
            all: [firstCode, secondCode],
          }),
          [firstCode]: proxy('VLESS', { name: firstCode }),
          [secondCode]: proxy('Trojan', { name: secondCode }),
        },
      },
    });

    const result = await getDashboardSections();

    expect(result.data[0].outbounds).toEqual([
      expect.objectContaining({
        code: firstCode,
        link: firstLink,
        canCopyLink: true,
      }),
      expect.objectContaining({
        code: secondCode,
        link: secondLink,
        canCopyLink: true,
      }),
    ]);
  });

  it('keeps duplicate manual node names paired in provider source order', async () => {
    const firstCode = 'main-manual-provider/Same';
    const secondCode = 'main-manual-provider/Same #2';
    const firstLink = 'vless://first@example.com:443#Same';
    const secondLink = 'vless://second@example.com:443#Same';
    mocks.getConfigSections.mockResolvedValue([
      proxySection({
        selector_proxy_links: [firstLink, secondLink],
        urltests: [],
        urltest_settings: undefined,
      }),
    ]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: {
        proxies: {
          'main-out': proxy('Selector', {
            name: 'main-out',
            all: [firstCode, secondCode],
          }),
          [firstCode]: proxy('VLESS', { name: firstCode }),
          [secondCode]: proxy('VLESS', { name: secondCode }),
        },
      },
    });

    const result = await getDashboardSections();

    expect(
      result.data[0].outbounds.map(({ code, link }) => ({ code, link })),
    ).toEqual([
      { code: firstCode, link: firstLink },
      { code: secondCode, link: secondLink },
    ]);
  });

  it('keeps non-built-in URLTest groups in selector order when latency sorting is disabled', async () => {
    mocks.getConfigSections.mockResolvedValue([proxySection()]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: {
        proxies: {
          'main-out': proxy('Selector', {
            name: 'main-out',
            now: 'main-2-out',
            all: [
              'main-2-out',
              'main-provider-urltest-out',
              'main-1-out',
              'main-urltest-out',
            ],
          }),
          'main-urltest-out': proxy('URLTest', {
            name: 'main-urltest-out',
            history: [{ time: '2026-06-11T00:00:00Z', delay: 10 }],
            all: ['main-2-out', 'main-1-out'],
          }),
          'main-provider-urltest-out': proxy('URLTest', {
            name: 'Provider URLTest',
            history: [{ time: '2026-06-11T00:00:00Z', delay: 150 }],
            all: ['provider-hidden-1-out'],
          }),
          'main-1-out': proxy('VLESS', {
            name: 'Fast leaf',
            history: [{ time: '2026-06-11T00:00:00Z', delay: 100 }],
          }),
          'main-2-out': proxy('VLESS', {
            name: 'Slow leaf',
            history: [{ time: '2026-06-11T00:00:00Z', delay: 300 }],
          }),
        },
      },
    });

    const result = await getDashboardSections();
    const [section] = result.data;

    expect(result.success).toBe(true);
    expect(section.latencyTestCodes).toEqual([
      'main-urltest-out',
      'main-2-out',
      'main-provider-urltest-out',
      'main-1-out',
    ]);
    expect(section.outbounds.map((item) => item.code)).toEqual([
      'main-urltest-out',
      'main-2-out',
      'main-provider-urltest-out',
      'main-1-out',
    ]);
  });

  it('sorts outbounds by latency only when enabled and does not prioritize URLTest groups except Fastest', async () => {
    mocks.getConfigSections.mockResolvedValue([
      proxySection({ sort_by_latency: '1' }),
    ]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: {
        proxies: {
          'main-out': proxy('Selector', {
            name: 'main-out',
            now: 'main-2-out',
            all: [
              'main-2-out',
              'main-provider-urltest-out',
              'main-1-out',
              'main-urltest-out',
            ],
          }),
          'main-urltest-out': proxy('URLTest', {
            name: 'main-urltest-out',
            history: [{ time: '2026-06-11T00:00:00Z', delay: 10 }],
            all: ['main-2-out', 'main-1-out'],
          }),
          'main-provider-urltest-out': proxy('URLTest', {
            name: 'Provider URLTest',
            history: [{ time: '2026-06-11T00:00:00Z', delay: 150 }],
            all: ['provider-hidden-1-out'],
          }),
          'main-1-out': proxy('VLESS', {
            name: 'Fast leaf',
            history: [{ time: '2026-06-11T00:00:00Z', delay: 100 }],
          }),
          'main-2-out': proxy('VLESS', {
            name: 'Slow leaf',
            history: [{ time: '2026-06-11T00:00:00Z', delay: 300 }],
          }),
        },
      },
    });

    const result = await getDashboardSections();
    const [section] = result.data;

    expect(result.success).toBe(true);
    expect(section.latencyTestCodes).toEqual([
      'main-urltest-out',
      'main-1-out',
      'main-provider-urltest-out',
      'main-2-out',
    ]);
    expect(section.outbounds.map((item) => item.code)).toEqual([
      'main-urltest-out',
      'main-1-out',
      'main-provider-urltest-out',
      'main-2-out',
    ]);
  });

  it('sorts an unpinned configured URLTest group by latency', async () => {
    mocks.getConfigSections.mockResolvedValue([
      proxySection({
        sort_by_latency: '1',
        urltest_settings: urlTestSettings('urltest', {
          display_name: 'Fastest',
          pin_dashboard: '0',
        }),
      }),
    ]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: {
        proxies: {
          'main-out': proxy('Selector', {
            name: 'main-out',
            now: 'main-2-out',
            all: ['main-2-out', 'main-1-out', 'main-urltest-out'],
          }),
          'main-urltest-out': proxy('URLTest', {
            name: 'main-urltest-out',
            history: [{ time: '2026-06-11T00:00:00Z', delay: 250 }],
            all: ['main-2-out', 'main-1-out'],
          }),
          'main-1-out': proxy('VLESS', {
            name: 'Fast leaf',
            history: [{ time: '2026-06-11T00:00:00Z', delay: 100 }],
          }),
          'main-2-out': proxy('VLESS', {
            name: 'Slow leaf',
            history: [{ time: '2026-06-11T00:00:00Z', delay: 300 }],
          }),
        },
      },
    });

    const result = await getDashboardSections();
    const [section] = result.data;

    expect(result.success).toBe(true);
    expect(section.outbounds.map((item) => item.code)).toEqual([
      'main-1-out',
      'main-urltest-out',
      'main-2-out',
    ]);
  });

  it('uses native provider names and subscription metadata without cached links', async () => {
    mocks.getConfigSections.mockResolvedValue([
      proxySection({
        subscription_urls: [
          'https://subscription.example/hidden',
          'https://subscription.example/list',
        ],
        subscription_url_settings: JSON.stringify({
          'https://subscription.example/hidden': {
            show_dashboard_metadata: '0',
          },
        }),
        selector_proxy_links: [],
        urltests: [],
        urltest_settings: undefined,
      }),
    ]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: {
        proxies: {
          'main-out': proxy('Selector', {
            name: 'main-out',
            now: 'main-subscription-2-provider/DE Node',
            all: [
              'main-subscription-2-provider/DE Node',
              'main-subscription-2-provider/Unsupported Node',
            ],
          }),
          'main-subscription-2-provider/DE Node': proxy('VLESS', {
            name: 'main-subscription-2-provider/DE Node',
          }),
          'main-subscription-2-provider/Unsupported Node': proxy('AnyTLS', {
            name: 'main-subscription-2-provider/Unsupported Node',
          }),
        },
      },
    });
    mocks.getClashApiProxyProviders.mockResolvedValue({
      success: true,
      data: {
        providers: {
          'main-subscription-1-provider': {
            type: 'Proxy',
            vehicleType: 'HTTP',
            name: 'main-subscription-1-provider',
            proxies: [],
          },
          'main-subscription-2-provider': {
            type: 'Proxy',
            vehicleType: 'HTTP',
            name: 'main-subscription-2-provider',
            proxies: [
              proxy('VLESS', {
                name: 'main-subscription-2-provider/DE Node',
              }),
              proxy('AnyTLS', {
                name: 'main-subscription-2-provider/Unsupported Node',
              }),
            ],
            subscriptionInfo: {
              Upload: 10,
              Download: 20,
              Total: 100,
              Expire: 2_000_000_000,
            },
            subscriptionMetadata: {
              title: 'Native subscription',
              supportUrl: 'https://subscription.example/support',
            },
          },
        },
      },
    });
    mocks.dashboardCacheRead.mockResolvedValue(
      JSON.stringify({
        providerTags: [
          'main-subscription-1-provider',
          'main-subscription-2-provider',
        ],
      }),
    );

    const result = await getDashboardSections();
    const [section] = result.data;
    const subscriptionOutbound = section.outbounds.find(
      (item) => item.code === 'main-subscription-2-provider/DE Node',
    );
    const unsupportedOutbound = section.outbounds.find(
      (item) => item.code === 'main-subscription-2-provider/Unsupported Node',
    );

    expect(result.success).toBe(true);
    expect(subscriptionOutbound?.displayName).toBe('DE Node');
    expect(subscriptionOutbound?.link).toBe('');
    expect(subscriptionOutbound?.canCopyLink).toBe(true);
    expect(unsupportedOutbound?.canCopyLink).toBe(false);
    expect(section.subscriptionMetadata).toEqual([
      expect.objectContaining({
        title: 'Native subscription',
        sourceIndex: 2,
        sourceSection: 'main-subscription-2-provider',
        expire: 2_000_000_000,
        traffic: expect.objectContaining({
          upload: 10,
          download: 20,
          used: 30,
          total: 100,
          remaining: 70,
          isUnlimited: false,
        }),
      }),
    ]);
  });

  it('uses allocated tags for section names that collide with system tags', async () => {
    mocks.getConfigSections.mockResolvedValue([
      proxySection({
        '.name': 'direct',
        urltests: [],
        urltest_settings: undefined,
        urltest_enabled: '0',
      }),
    ]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: {
        proxies: {
          'direct-out-1': proxy('Selector', {
            name: 'direct-out-1',
            now: 'direct-1-out',
            all: ['direct-1-out'],
          }),
          'direct-1-out': proxy('VLESS', {
            name: 'Direct manual',
            history: [{ time: '2026-05-27T00:00:00Z', delay: 100 }],
          }),
        },
      },
    });

    const result = await getDashboardSections();
    const [section] = result.data;

    expect(result.success).toBe(true);
    expect(section.code).toBe('direct-out-1');
    expect(section.outbounds.map((item) => item.code)).toEqual([
      'direct-1-out',
    ]);
  });

  it('shows legacy VPN interface sections as a Connection selector group', async () => {
    mocks.getConfigSections.mockResolvedValue([
      {
        '.name': 'AWG',
        '.type': 'section',
        enabled: '1',
        action: 'vpn',
        interface: 'awg1',
      },
    ]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: {
        proxies: {
          'AWG-out': proxy('Selector', {
            name: 'AWG-out',
            now: 'AWG-interface-1-out',
            all: ['AWG-interface-1-out'],
          }),
          'AWG-interface-1-out': proxy('Direct', {
            name: 'awg1',
            history: [{ time: '2026-06-07T00:00:00Z', delay: 445 }],
          }),
        },
      },
    });

    const result = await getDashboardSections();
    const [section] = result.data;

    expect(result.success).toBe(true);
    expect(section.action).toBe('vpn');
    expect(section.withTagSelect).toBe(true);
    expect(section.proxyConfigType).toBe('interface');
    expect(section.outbounds[0]).toMatchObject({
      code: 'AWG-interface-1-out',
      displayName: 'awg1',
      selected: true,
    });
  });

  it('hydrates migrated interface children into the Connection selector group', async () => {
    mocks.getConfigSections.mockResolvedValue([
      {
        '.name': 'AWG',
        '.type': 'section',
        enabled: '1',
        action: 'connection',
      },
      {
        '.name': 'cfg01',
        '.type': 'section_interface',
        section: 'AWG',
        name: 'awg1',
      },
    ]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: {
        proxies: {
          'AWG-out': proxy('Selector', {
            name: 'AWG-out',
            now: 'AWG-interface-1-out',
            all: ['AWG-interface-1-out'],
          }),
          'AWG-interface-1-out': proxy('Direct', {
            name: 'awg1',
            history: [{ time: '2026-07-13T00:00:00Z', delay: 445 }],
          }),
        },
      },
    });

    const result = await getDashboardSections();
    const [section] = result.data;

    expect(result.success).toBe(true);
    expect(section.code).toBe('AWG-out');
    expect(section.withTagSelect).toBe(true);
    expect(section.proxyConfigType).toBe('interface');
    expect(section.outbounds[0]).toMatchObject({
      code: 'AWG-interface-1-out',
      displayName: 'awg1',
      selected: true,
    });
  });

  it('does not expose ByeDPI sections on the dashboard', async () => {
    mocks.getConfigSections.mockResolvedValue([
      proxySection(),
      {
        '.name': 'dpi',
        '.type': 'section',
        enabled: '1',
        action: 'byedpi',
      },
    ]);
    mocks.getClashApiProxies.mockResolvedValue({
      success: true,
      data: {
        proxies: {
          ...clashProxies,
          'dpi-out': proxy('Socks', {
            name: 'dpi-out',
            history: [{ time: '2026-06-10T00:00:00Z', delay: 20 }],
          }),
        },
      },
    });

    const result = await getDashboardSections();

    expect(result.success).toBe(true);
    expect(result.data.map((section) => section.sectionName)).toEqual(['main']);
  });

  it('fetches Clash API proxies directly in the browser to avoid rpcd output limits', async () => {
    mocks.getConfigSections.mockResolvedValue([
      { '.name': 'settings', '.type': 'settings', yacd_secret_key: 'secret' },
      proxySection(),
    ]);
    mocks.canUseDirectClashApi.mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ proxies: clashProxies }),
    });

    vi.stubGlobal('window', { location: { hostname: 'router.example' } });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getDashboardSections();

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://router.example:9090/proxies',
      expect.objectContaining({
        headers: { Authorization: 'Bearer secret' },
        signal: expect.anything(),
      }),
    );
    expect(mocks.getClashApiProxies).not.toHaveBeenCalled();
  });

  it('uses rpcd fallback when direct Clash API access times out', async () => {
    vi.useFakeTimers();

    try {
      mocks.getConfigSections.mockResolvedValue([proxySection()]);
      mocks.canUseDirectClashApi.mockReturnValue(true);
      const fetchMock = vi.fn(
        (_url: string, options?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      );

      vi.stubGlobal('fetch', fetchMock);

      const resultPromise = getDashboardSections();
      await vi.advanceTimersByTimeAsync(5000);
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(mocks.getClashApiProxies).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses rpcd fallback when direct Clash API access is unsafe', async () => {
    mocks.getConfigSections.mockResolvedValue([proxySection()]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ proxies: clashProxies }),
    });

    vi.stubGlobal('window', {
      location: { hostname: 'router.example', protocol: 'https:' },
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getDashboardSections();

    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.getClashApiProxies).toHaveBeenCalledTimes(1);
  });
});
