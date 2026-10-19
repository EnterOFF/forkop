import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDashboardSections: vi.fn(),
  getClashApiProxyLatency: vi.fn(),
}));

vi.mock('../../../../methods/custom/getDashboardSections', () => ({
  getDashboardSections: mocks.getDashboardSections,
}));

vi.mock('../../../../methods', () => ({
  CustomForkopMethods: {
    getClashApiProxyLatency: mocks.getClashApiProxyLatency,
  },
}));

import { probeResult, runSectionsCheck } from '../sections';

function sections(data: unknown[]) {
  mocks.getDashboardSections.mockResolvedValue({ success: true, data });
}

const vpnSection = {
  withTagSelect: false,
  code: 'AWG',
  sectionName: 'awg',
  displayName: 'AWG',
  action: 'vpn',
  latencyTestTimeout: '10000',
  outbounds: [
    {
      code: 'AWG',
      displayName: 'awg1',
      latency: 0,
      type: 'Direct',
      selected: true,
      runtimeAvailable: true,
    },
  ],
};

const selectorSection = {
  withTagSelect: true,
  code: 'main',
  sectionName: 'main',
  displayName: 'Main',
  latencyTestTimeout: '7000',
  outbounds: [
    {
      code: 'Main/a',
      displayName: 'Selected',
      latency: 0,
      type: 'VLESS',
      selected: true,
    },
    {
      code: 'Main/b',
      displayName: 'Other',
      latency: 0,
      type: 'VLESS',
      selected: false,
    },
  ],
};

describe('the sections check', () => {
  beforeEach(() => {
    mocks.getDashboardSections.mockReset();
    mocks.getClashApiProxyLatency.mockReset();
  });

  it('reads how a latency test ended from the answer the Clash API gave', () => {
    expect(probeResult({ success: true, data: { delay: 120 } })).toEqual({
      delay: 120,
    });
    expect(
      [504, 503, 404, undefined].map((status) =>
        probeResult({ success: false, error: 'x', status }),
      ),
    ).toEqual([
      { failure: 'timeout' },
      { failure: 'error' },
      { failure: 'missing' },
      { failure: 'unavailable' },
    ]);
  });

  it('tests the node a selectable section uses now, with the budget of one test', async () => {
    sections([selectorSection]);
    mocks.getClashApiProxyLatency.mockResolvedValue({
      success: true,
      data: { delay: 123 },
    });

    const result = await runSectionsCheck();

    expect(mocks.getClashApiProxyLatency).toHaveBeenCalledWith('Main/a');
    expect(result).toEqual({
      state: 'success',
      description: 'Checks passed',
      items: [{ state: 'success', key: 'Main', value: 'Selected · 123 ms' }],
    });
  });

  it('names the node that failed and how', async () => {
    sections([selectorSection]);
    mocks.getClashApiProxyLatency.mockResolvedValue({
      success: false,
      error: 'Timeout',
      status: 504,
    });

    const result = await runSectionsCheck();

    expect(result.state).toBe('error');
    expect(result.items[0].value).toBe('Selected: no answer in time');
  });

  it('keeps a VPN interface that cannot reach the test address a warning, on the section timeout', async () => {
    sections([vpnSection]);
    mocks.getClashApiProxyLatency.mockResolvedValue({
      success: false,
      error: 'An error occurred in the delay test',
      status: 503,
    });

    const result = await runSectionsCheck();

    expect(mocks.getClashApiProxyLatency).toHaveBeenCalledWith('AWG', '10000');
    expect(result.items).toEqual([
      expect.objectContaining({
        state: 'warning',
        key: 'AWG',
        value: 'interface is up, no internet through it',
      }),
    ]);
  });

  it('tests every section at once', async () => {
    sections([selectorSection, vpnSection]);
    let pending = 0;
    let most = 0;
    mocks.getClashApiProxyLatency.mockImplementation(async () => {
      pending += 1;
      most = Math.max(most, pending);
      await new Promise((resolve) => setTimeout(resolve, 0));
      pending -= 1;
      return { success: true, data: { delay: 50 } };
    });

    await runSectionsCheck();

    expect(most).toBe(2);
  });

  it('says when there is nothing to test, and when the Clash API is not there', async () => {
    sections([]);
    expect(await runSectionsCheck()).toMatchObject({
      state: 'skipped',
      description: 'No sections with a proxy',
    });

    mocks.getDashboardSections.mockResolvedValue({ success: false, data: [] });
    expect(await runSectionsCheck()).toMatchObject({
      state: 'warning',
      description: 'Not checked: the Clash API did not answer',
    });
  });
});
