import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeShellCommand: vi.fn(),
}));

vi.mock('../../../../helpers', () => ({
  executeShellCommand: mocks.executeShellCommand,
}));

import { ForkopShellMethods } from '..';

describe('getClashApiProxyLink', () => {
  beforeEach(() => {
    mocks.executeShellCommand.mockReset();
  });

  it('requests one runtime link only when the caller asks for it', async () => {
    mocks.executeShellCommand.mockResolvedValue({
      stdout: '{"url":"vless://id@example.com:443"}',
      stderr: '',
      code: 0,
    });

    await expect(
      ForkopShellMethods.getClashApiProxyLink(
        'main-subscription-1-provider/Example',
      ),
    ).resolves.toEqual({
      success: true,
      data: { url: 'vless://id@example.com:443' },
    });
    expect(mocks.executeShellCommand).toHaveBeenCalledWith({
      command: '/usr/bin/forkop',
      args: [
        'clash_api',
        'get_proxy_link',
        'main-subscription-1-provider/Example',
      ],
      timeout: 15000,
    });
  });
});
