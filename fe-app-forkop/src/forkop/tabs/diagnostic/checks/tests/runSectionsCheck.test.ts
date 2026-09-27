import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDashboardSections: vi.fn(),
  getClashApiProxyLatency: vi.fn(),
  getClashApiGroupLatency: vi.fn(),
  updateCheckStore: vi.fn(),
}));

vi.mock('../../../../methods/custom/getDashboardSections', () => ({
  getDashboardSections: mocks.getDashboardSections,
}));

vi.mock('../../../../methods', () => ({
  CustomForkopMethods: {
    getClashApiProxyLatency: mocks.getClashApiProxyLatency,
    getClashApiGroupLatency: mocks.getClashApiGroupLatency,
  },
}));

vi.mock('../updateCheckStore', () => ({
  updateCheckStore: mocks.updateCheckStore,
}));

import { runSectionsCheck } from '../runSectionsCheck';

describe('runSectionsCheck', () => {
  beforeEach(() => {
    mocks.getDashboardSections.mockReset();
    mocks.getClashApiProxyLatency.mockReset();
    mocks.getClashApiGroupLatency.mockReset();
    mocks.updateCheckStore.mockReset();
  });

  it('keeps VPN interface probe failures as warnings when the runtime outbound exists', async () => {
    mocks.getDashboardSections.mockResolvedValue({
      success: true,
      data: [
        {
          withTagSelect: false,
          code: 'AWG-out',
          sectionName: 'AWG',
          displayName: 'AWG',
          action: 'vpn',
          latencyTestTimeout: '10000',
          outbounds: [
            {
              code: 'AWG-out',
              displayName: 'awg1',
              latency: 0,
              type: 'Direct',
              selected: true,
              runtimeAvailable: true,
            },
          ],
        },
      ],
    });
    mocks.getClashApiProxyLatency.mockResolvedValue({
      success: true,
      data: { message: 'context deadline exceeded' },
    });

    await expect(runSectionsCheck()).resolves.toBeUndefined();

    expect(mocks.getClashApiProxyLatency).toHaveBeenCalledWith(
      'AWG-out',
      '10000',
    );
    expect(mocks.updateCheckStore).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: 'warning',
        description: 'Issues detected',
        items: [
          {
            state: 'warning',
            key: 'AWG',
            value: '[awg1] Connectivity probe failed',
          },
        ],
      }),
    );
  });

  it('checks only the selected concrete outbound for selectable proxy sections', async () => {
    mocks.getDashboardSections.mockResolvedValue({
      success: true,
      data: [
        {
          withTagSelect: true,
          code: 'main-out',
          sectionName: 'main',
          displayName: 'Main',
          latencyTestTimeout: '7000',
          outbounds: [
            {
              code: 'main-1-out',
              displayName: 'Selected',
              latency: 0,
              type: 'VLESS',
              selected: true,
            },
            {
              code: 'main-2-out',
              displayName: 'Other',
              latency: 0,
              type: 'VLESS',
              selected: false,
            },
          ],
        },
      ],
    });
    mocks.getClashApiProxyLatency.mockResolvedValue({
      success: true,
      data: { delay: 123 },
    });

    await expect(runSectionsCheck()).resolves.toBeUndefined();

    // The section timeout is the budget for sweeping its whole group, so a
    // single node is asked for with the ordinary single test budget.
    expect(mocks.getClashApiProxyLatency).toHaveBeenCalledWith('main-1-out');
    expect(mocks.getClashApiGroupLatency).not.toHaveBeenCalled();
    expect(mocks.updateCheckStore).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: 'success',
        items: [
          {
            state: 'success',
            key: 'Main',
            value: '[Selected] 123ms',
          },
        ],
      }),
    );
  });

  it('checks the selected URLTest outbound directly', async () => {
    mocks.getDashboardSections.mockResolvedValue({
      success: true,
      data: [
        {
          withTagSelect: true,
          code: 'main-out',
          sectionName: 'main',
          displayName: 'Main',
          proxyConfigType: 'selector',
          outbounds: [
            {
              code: 'main-urltest-out',
              displayName: 'Fastest',
              latency: 10,
              type: 'URLTest',
              selected: true,
            },
            {
              code: 'main-1-out',
              displayName: 'One',
              latency: 0,
              type: 'VLESS',
              selected: false,
            },
            {
              code: 'main-2-out',
              displayName: 'Two',
              latency: 0,
              type: 'VLESS',
              selected: false,
            },
          ],
        },
      ],
    });
    mocks.getClashApiProxyLatency.mockResolvedValue({
      success: true,
      data: { delay: 10 },
    });

    await expect(runSectionsCheck()).resolves.toBeUndefined();

    expect(mocks.getClashApiProxyLatency).toHaveBeenCalledWith(
      'main-urltest-out',
    );
    expect(mocks.getClashApiGroupLatency).not.toHaveBeenCalled();
    expect(mocks.updateCheckStore).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: 'success',
        items: [
          {
            state: 'success',
            key: 'Main',
            value: '[Fastest] 10ms',
          },
        ],
      }),
    );
  });

  // A section the runtime carries without a single server has nothing to test.
  it('reports a section with no server as not responding, asking nothing', async () => {
    mocks.getDashboardSections.mockResolvedValue({
      success: true,
      data: [
        {
          withTagSelect: true,
          code: 'main-out',
          sectionName: 'main',
          displayName: 'Main',
          proxyConfigType: 'subscription',
          outbounds: [],
        },
      ],
    });

    await runSectionsCheck().catch(() => undefined);

    expect(mocks.getClashApiProxyLatency).not.toHaveBeenCalled();
    expect(mocks.getClashApiGroupLatency).not.toHaveBeenCalled();
    expect(mocks.updateCheckStore).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: [{ state: 'error', key: 'Main', value: 'Not responding' }],
      }),
    );
  });

  // Nothing configured is not a pass, and not a failure either.
  it('skips a page with no section to check', async () => {
    mocks.getDashboardSections.mockResolvedValue({ success: true, data: [] });

    await expect(runSectionsCheck()).resolves.toBeUndefined();

    expect(mocks.updateCheckStore).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'skipped', items: [] }),
    );
  });
});
