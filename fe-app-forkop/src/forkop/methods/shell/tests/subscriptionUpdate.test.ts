import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeShellCommand: vi.fn(),
}));

vi.mock('../../../../helpers', () => ({
  executeShellCommand: mocks.executeShellCommand,
}));

import { ForkopShellMethods } from '../index';

describe('ForkopShellMethods.subscriptionUpdate', () => {
  beforeEach(() => {
    mocks.executeShellCommand.mockReset();
  });

  it('refreshes the selected native provider directly', async () => {
    mocks.executeShellCommand.mockResolvedValue({
      stdout: '',
      stderr: '',
      code: 0,
    });

    await expect(
      ForkopShellMethods.subscriptionUpdate('main', 2),
    ).resolves.toEqual({
      success: true,
      data: true,
    });
    expect(mocks.executeShellCommand).toHaveBeenCalledWith({
      command: '/usr/bin/forkop',
      args: ['subscription_update', 'main', '2'],
      timeout: null,
    });
  });

  it('returns a native refresh failure', async () => {
    mocks.executeShellCommand.mockResolvedValue({
      stdout: '',
      stderr: 'Provider refresh failed',
      code: 1,
    });

    await expect(
      ForkopShellMethods.subscriptionUpdate('main'),
    ).resolves.toEqual({
      success: false,
      error: 'Provider refresh failed',
    });
  });
});
