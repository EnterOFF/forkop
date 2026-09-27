import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkNftRules: vi.fn(),
  updateCheckStore: vi.fn(),
}));

vi.mock('../../../../methods', () => ({
  RemoteFakeIPMethods: {
    getFakeIpCheck: async () => ({}),
    getIpCheck: async () => ({}),
  },
  ForkopShellMethods: { checkNftRules: mocks.checkNftRules },
}));
vi.mock('../updateCheckStore', () => ({
  updateCheckStore: mocks.updateCheckStore,
}));

import { runNftCheck } from '../runNftCheck';

const NOTHING = {
  table_exist: 0,
  rules_mangle_exist: 0,
  rules_mangle_counters: 0,
  rules_mangle_output_exist: 0,
  rules_mangle_output_counters: 0,
  rules_proxy_exist: 0,
  rules_proxy_counters: 0,
  rules_other_mark_exist: 0,
};

beforeEach(() => {
  mocks.checkNftRules.mockReset();
  mocks.updateCheckStore.mockReset();
});

describe('the nftables check', () => {
  // No Forkop table at all is the one outcome that means nothing is
  // intercepted; that no other service marks packets is not a result.
  it('fails when the Forkop table is not there', async () => {
    mocks.checkNftRules.mockResolvedValue({ success: true, data: NOTHING });

    await runNftCheck().catch(() => undefined);

    expect(mocks.updateCheckStore).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'error' }),
    );
  });

  it('warns when the table is there but some rules are not', async () => {
    mocks.checkNftRules.mockResolvedValue({
      success: true,
      data: { ...NOTHING, table_exist: 1, rules_mangle_exist: 1 },
    });

    await runNftCheck().catch(() => undefined);

    expect(mocks.updateCheckStore).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'warning' }),
    );
  });
});
