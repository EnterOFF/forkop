import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeShellCommand: vi.fn(),
}));

vi.mock('../../../../helpers/executeShellCommand', () => ({
  executeShellCommand: mocks.executeShellCommand,
}));

import { ForkopShellMethods } from '..';

describe('ForkopShellMethods.clashApi', () => {
  beforeEach(() => {
    mocks.executeShellCommand.mockReset();
  });

  it('passes the requested method, path and body to the CLI transport', async () => {
    mocks.executeShellCommand.mockResolvedValue({
      stdout: '{"status":204,"body":""}',
      stderr: '',
      code: 0,
    });

    await expect(
      ForkopShellMethods.clashApi(
        'PUT',
        '/proxies/main-out',
        '{"name":"main-subscription-1-provider/Example"}',
      ),
    ).resolves.toEqual({
      success: true,
      data: { status: 204, body: '' },
    });
    expect(mocks.executeShellCommand).toHaveBeenCalledWith({
      command: '/usr/bin/forkop',
      args: [
        'clash_api',
        'PUT',
        '/proxies/main-out',
        '{"name":"main-subscription-1-provider/Example"}',
      ],
      timeout: 65000,
    });
  });

  it('returns the raw Clash API status and body for a GET request', async () => {
    mocks.executeShellCommand.mockResolvedValue({
      stdout:
        '{"status":200,"body":"{\\"url\\":\\"vless://id@example.com:443\\"}"}',
      stderr: '',
      code: 0,
    });

    await expect(
      ForkopShellMethods.clashApi(
        'GET',
        '/proxies/main-subscription-1-provider%2FExample/link',
      ),
    ).resolves.toEqual({
      success: true,
      data: {
        status: 200,
        body: '{"url":"vless://id@example.com:443"}',
      },
    });
    expect(mocks.executeShellCommand).toHaveBeenCalledWith({
      command: '/usr/bin/forkop',
      args: [
        'clash_api',
        'GET',
        '/proxies/main-subscription-1-provider%2FExample/link',
        '',
      ],
      timeout: 10000,
    });
  });

  it('reports a transport failure without inventing a status', async () => {
    mocks.executeShellCommand.mockResolvedValue({
      stdout: '',
      stderr: 'curl: (7) Failed to connect',
      code: 7,
    });

    await expect(
      ForkopShellMethods.clashApi('GET', '/proxies'),
    ).resolves.toEqual({
      success: false,
      error: 'curl: (7) Failed to connect',
    });
  });
});
