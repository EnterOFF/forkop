import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeShellCommand: vi.fn(),
}));

vi.mock('../../../../helpers/executeShellCommand', () => ({
  executeShellCommand: mocks.executeShellCommand,
}));

import { ForkopShellMethods } from '../index';

describe('ForkopShellMethods.serviceAction', () => {
  beforeEach(() => {
    mocks.executeShellCommand.mockReset();
  });

  it('returns the started job id', async () => {
    mocks.executeShellCommand.mockResolvedValue({
      stdout: JSON.stringify({
        success: true,
        job_id: 'job-1',
        message: 'Service restart started',
      }),
      stderr: '',
      code: 0,
    });

    await expect(
      ForkopShellMethods.serviceActionStart('restart'),
    ).resolves.toEqual({
      success: true,
      data: {
        success: true,
        job_id: 'job-1',
        message: 'Service restart started',
      },
    });
  });

  it('returns the backend service action start error message', async () => {
    mocks.executeShellCommand.mockResolvedValue({
      stdout: JSON.stringify({
        success: false,
        message: 'Another service action is already running',
      }),
      stderr: '',
      code: 1,
    });

    await expect(
      ForkopShellMethods.serviceActionStart('restart'),
    ).resolves.toEqual({
      success: false,
      error: 'Another service action is already running',
    });
  });
});
