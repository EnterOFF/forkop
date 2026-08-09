import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeShellCommand: vi.fn(),
}));

vi.mock('../../../../helpers', () => ({
  executeShellCommand: mocks.executeShellCommand,
}));

import { ForkopShellMethods } from '..';

describe('ForkopShellMethods.checkLogs', () => {
  beforeEach(() => {
    mocks.executeShellCommand.mockReset();
  });

  it('shares one in-flight log request between UI pollers', async () => {
    let finishRequest: (value: unknown) => void = () => {};
    mocks.executeShellCommand.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRequest = resolve;
        }),
    );

    const first = ForkopShellMethods.checkLogs();
    const second = ForkopShellMethods.checkLogs();

    expect(mocks.executeShellCommand).toHaveBeenCalledTimes(1);
    finishRequest({ stdout: 'line', stderr: '', code: 0 });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { success: true, data: 'line' },
      { success: true, data: 'line' },
    ]);

    const next = ForkopShellMethods.checkLogs();
    expect(mocks.executeShellCommand).toHaveBeenCalledTimes(2);
    finishRequest({ stdout: 'next line', stderr: '', code: 0 });
    await expect(next).resolves.toEqual({ success: true, data: 'next line' });
  });
});
