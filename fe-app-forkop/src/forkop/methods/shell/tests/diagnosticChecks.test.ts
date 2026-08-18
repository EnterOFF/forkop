import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeShellCommand: vi.fn(),
}));

vi.mock('../../../../helpers', () => ({
  executeShellCommand: mocks.executeShellCommand,
}));

import { ForkopShellMethods } from '..';

describe('diagnostic checks', () => {
  beforeEach(() => {
    mocks.executeShellCommand.mockReset();
    mocks.executeShellCommand.mockResolvedValue({
      stdout: '{}',
      stderr: '',
      code: 0,
    });
  });

  it.each([
    ['checkSingBox', 'check_sing_box'],
    ['checkNftRules', 'check_nft_rules'],
    ['checkDNSAvailable', 'check_dns_available'],
    ['checkFakeIP', 'check_fakeip'],
    ['checkInbounds', 'check_inbounds'],
    ['checkInboundsConfig', 'check_inbounds_config'],
  ] as const)(
    '%s waits long enough for a slow router',
    async (method, command) => {
      await ForkopShellMethods[method]();

      const call = mocks.executeShellCommand.mock.calls[0][0];

      expect(call.args[0]).toBe(command);
      expect(call.timeout).toBeGreaterThan(20000);
    },
  );

  it('keeps provider runtime checks on the diagnostic timeout', async () => {
    await ForkopShellMethods.checkZapretRuntime();

    const call = mocks.executeShellCommand.mock.calls[0][0];

    expect(call.args).toEqual(['check_provider_runtime', 'zapret']);
    expect(call.timeout).toBeGreaterThan(20000);
  });

  it('keeps short-lived UI state polling fast', async () => {
    await ForkopShellMethods.getUiState();

    expect(mocks.executeShellCommand.mock.calls[0][0].timeout).toBe(3000);
  });
});
