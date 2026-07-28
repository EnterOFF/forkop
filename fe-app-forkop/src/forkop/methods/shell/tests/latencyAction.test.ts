import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeShellCommand: vi.fn(),
}));

vi.mock('../../../../helpers', () => ({
  executeShellCommand: mocks.executeShellCommand,
}));

import { ForkopShellMethods } from '../index';

describe('ForkopShellMethods.latencyAction', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.executeShellCommand.mockReset();
  });

  it('passes an optional timeout to latency jobs', async () => {
    mocks.executeShellCommand.mockResolvedValue({
      stdout: JSON.stringify({ success: true, job_id: 'latency-1' }),
      stderr: '',
      code: 0,
    });

    await ForkopShellMethods.latencyTestStart(
      'proxy',
      'AWG',
      'AWG-out',
      '10000',
    );

    expect(mocks.executeShellCommand).toHaveBeenCalledWith({
      command: '/usr/bin/forkop',
      args: ['latency_test_async', 'proxy', 'AWG', 'AWG-out', '10000'],
      timeout: 15000,
    });
  });

  it('keeps following a latency job beyond 30 seconds', async () => {
    vi.useFakeTimers();
    let statusCalls = 0;

    mocks.executeShellCommand.mockImplementation(async () => {
      statusCalls += 1;
      return {
        stdout: JSON.stringify({
          job_id: 'latency-1',
          section: 'proxy',
          latency_type: 'proxy_list',
          tag: '[]',
          running: statusCalls < 31,
          progress: { completed: statusCalls, total: 31, failed: 0 },
        }),
        stderr: '',
        code: 0,
      };
    });

    const wait = ForkopShellMethods.waitLatencyTestJob('latency-1');
    await vi.advanceTimersByTimeAsync(31000);

    await expect(wait).resolves.toMatchObject({
      success: true,
      data: { running: false },
    });
    expect(statusCalls).toBe(31);
  });
});
