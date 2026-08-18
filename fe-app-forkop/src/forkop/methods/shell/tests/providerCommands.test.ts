import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeShellCommand: vi.fn(),
}));

vi.mock('../../../../helpers', () => ({
  executeShellCommand: mocks.executeShellCommand,
}));

import { ForkopShellMethods } from '..';

describe('DPI provider and config shell methods', () => {
  beforeEach(() => {
    mocks.executeShellCommand.mockReset();
    mocks.executeShellCommand.mockResolvedValue({
      stdout: '{"installed":true}',
      stderr: '',
      code: 0,
    });
  });

  function lastArgs() {
    return mocks.executeShellCommand.mock.lastCall?.[0].args;
  }

  it('routes every provider runtime check through one command', async () => {
    await ForkopShellMethods.checkZapretRuntime();
    expect(lastArgs()).toEqual(['check_provider_runtime', 'zapret']);

    await ForkopShellMethods.checkZapret2Runtime();
    expect(lastArgs()).toEqual(['check_provider_runtime', 'zapret2']);

    await ForkopShellMethods.checkByedpiRuntime();
    expect(lastArgs()).toEqual(['check_provider_runtime', 'byedpi']);
  });

  it('routes every provider status read through one command', async () => {
    await ForkopShellMethods.getZapretStatus();
    expect(lastArgs()).toEqual(['get_provider_status', 'zapret']);

    await ForkopShellMethods.getZapret2Status();
    expect(lastArgs()).toEqual(['get_provider_status', 'zapret2']);

    await ForkopShellMethods.getByedpiStatus();
    expect(lastArgs()).toEqual(['get_provider_status', 'byedpi']);
  });

  it('asks for the unmasked Forkop config so the page can mask it locally', async () => {
    mocks.executeShellCommand.mockResolvedValue({
      stdout: "config settings 'settings'\n\toption yacd_secret_key 'secret'\n",
      stderr: '',
      code: 0,
    });

    const response = await ForkopShellMethods.showConfig(false);

    expect(lastArgs()).toEqual(['show_config', 'raw']);
    expect(response).toEqual({
      success: true,
      data: "config settings 'settings'\n\toption yacd_secret_key 'secret'\n",
    });
  });
});
