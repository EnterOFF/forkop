import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callUbus } from '../callUbus';

type RpcStub = {
  declare: ReturnType<typeof vi.fn>;
};

function stubRpc(call: ReturnType<typeof vi.fn>) {
  const rpc: RpcStub = {
    declare: vi.fn(() => call),
  };
  (globalThis as unknown as { rpc?: unknown }).rpc = rpc;
  return rpc;
}

function notFound() {
  return Object.assign(new Error('Object not found'), { ubus_rpc_status: 4 });
}

beforeEach(() => {
  vi.useRealTimers();
  (globalThis as unknown as { rpc?: unknown }).rpc = undefined;
  (globalThis as unknown as { L?: unknown }).L = { env: {} };
  // withTimeout reaches for LuCI's translation helper for its default message.
  (globalThis as unknown as { _: (value: string) => string })._ = (value) =>
    value;
});

describe('callUbus', () => {
  it('returns what the object answered', async () => {
    const call = vi.fn().mockResolvedValue({ revision: 3 });
    stubRpc(call);

    await expect(
      callUbus<{ revision: number }>({
        object: 'forkop',
        method: 'state',
        timeoutMs: 1000,
      }),
    ).resolves.toEqual({ success: true, data: { revision: 3 } });
  });

  // A service being restarted is missing for a second and then back. Sending the
  // page down its fallback path for a gap that is about to close would be worse
  // than waiting it out.
  it('waits out a service that is only briefly missing', async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce({ revision: 9 });
    stubRpc(call);

    await expect(
      callUbus<{ revision: number }>({
        object: 'forkop',
        method: 'state',
        timeoutMs: 1000,
      }),
    ).resolves.toEqual({ success: true, data: { revision: 9 } });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('gives up on an object that is genuinely not there', async () => {
    const call = vi.fn().mockRejectedValue(notFound());
    stubRpc(call);

    const result = await callUbus({
      object: 'forkop',
      method: 'state',
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({ success: false, unavailable: true });
    expect(call).toHaveBeenCalledTimes(3);
  }, 10000);

  // An error from a method that did run is not the same thing, and retrying it
  // would just repeat whatever went wrong.
  it('does not retry a failure that is not an absence', async () => {
    const call = vi.fn().mockRejectedValue(new Error('boom'));
    stubRpc(call);

    const result = await callUbus({
      object: 'forkop',
      method: 'state',
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({ success: false, unavailable: false });
    expect(call).toHaveBeenCalledOnce();
  });

  // LuCI joins the calls of one animation frame into a single HTTP request, and
  // uhttpd answers it only once every call in it is done.
  it('keeps a call out of LuCI batches only when asked to', async () => {
    const call = vi.fn().mockResolvedValue({ revision: 3 });
    const rpc = stubRpc(call);

    await callUbus({ object: 'forkop', method: 'state', timeoutMs: 1000 });
    await callUbus({
      object: 'forkop',
      method: 'state_wait',
      params: { revision: 3 },
      timeoutMs: 1000,
      nobatch: true,
    });

    expect(rpc.declare.mock.calls.map(([options]) => options.nobatch)).toEqual([
      undefined,
      true,
    ]);
  });

  it('reports rpc being absent as an absence, without retrying it', async () => {
    const result = await callUbus({
      object: 'forkop',
      method: 'state',
      timeoutMs: 1000,
      retryUnavailable: false,
    });

    expect(result).toMatchObject({ success: false, unavailable: true });
  });
});
