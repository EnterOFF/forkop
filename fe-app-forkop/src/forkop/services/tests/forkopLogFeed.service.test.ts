import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ callUbus: vi.fn() }));

vi.mock('../../../helpers/callUbus', () => ({
  callUbus: mocks.callUbus,
}));

// The feed keeps running for the life of the module, so each case starts one of
// its own.
async function freshFeed() {
  vi.resetModules();
  return (await import('../forkopLogFeed.service')).startForkopLogFeed;
}

type Answer = { success: boolean; [key: string]: unknown };

// Answers each request in turn, and parks the one after the last.
function answering(logs: Answer[], waits: Answer[]) {
  let parked: ((value: unknown) => void) | null = null;
  mocks.callUbus.mockImplementation(({ method }: { method: string }) => {
    const answer = (method === 'logs' ? logs : waits).shift();
    return answer
      ? Promise.resolve(answer)
      : new Promise((resolve) => (parked = resolve));
  });
  return { parked: () => parked };
}

const gone = { success: false, message: 'Object not found', unavailable: true };

beforeEach(() => {
  vi.useFakeTimers();
  mocks.callUbus.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the log feed', () => {
  // An upgrade restarts the state service and a crash does too; the feed lives
  // as long as the page and picks the new one up.
  it('carries on once the state service is back', async () => {
    const feed = answering(
      [{ success: true, data: { cursor: 0, lines: [] } }],
      [gone, { success: true, data: { cursor: 1, lines: ['forkop: back'] } }],
    );
    const startForkopLogFeed = await freshFeed();

    const lines: string[] = [];
    startForkopLogFeed((line) => lines.push(line));
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(0);

    expect(lines).toEqual(['forkop: back']);
    expect(feed.parked()).not.toBeNull();
  });

  // LuCI reloads the page after an apply; what the apply logged meanwhile is
  // still news to the user.
  it('goes on from the cursor of the page it took over from', async () => {
    const feed = answering(
      [],
      [{ success: true, data: { cursor: 9, lines: ['forkop: [error] x'] } }],
    );
    const startForkopLogFeed = await freshFeed();

    const lines: string[] = [];
    startForkopLogFeed((line) => lines.push(line), 7);
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.callUbus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ method: 'logs_wait', params: { cursor: 7 } }),
    );
    expect(lines).toEqual(['forkop: [error] x']);
    expect(feed.parked()).not.toBeNull();
  });

  // The page can open while the state service is being restarted.
  it('starts once the state service first answers', async () => {
    const feed = answering(
      [gone, { success: true, data: { cursor: 3, lines: ['forkop: old'] } }],
      [{ success: true, data: { cursor: 4, lines: ['forkop: new'] } }],
    );
    const startForkopLogFeed = await freshFeed();

    const lines: string[] = [];
    startForkopLogFeed((line) => lines.push(line));
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(0);

    expect(lines).toEqual(['forkop: new']);
    expect(mocks.callUbus).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'logs_wait', params: { cursor: 4 } }),
    );
    expect(feed.parked()).not.toBeNull();
  });
});
