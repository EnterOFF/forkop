import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ callUbus: vi.fn() }));

vi.mock('../../../helpers', () => ({ callUbus: mocks.callUbus }));

const { startForkopLogFeed } = await import('../forkopLogFeed.service');

describe('the log feed', () => {
  // An upgrade restarts the state service and a crash does too; the feed lives
  // as long as the page and picks the new one up.
  it('carries on once the state service is back', async () => {
    vi.useFakeTimers();
    const answers = [
      { success: false, message: 'Object not found', unavailable: true },
      { success: true, data: { cursor: 1, lines: ['forkop: back'] } },
    ];
    let parked: ((value: unknown) => void) | null = null;
    mocks.callUbus.mockImplementation(({ method }: { method: string }) => {
      if (method === 'logs')
        return Promise.resolve({
          success: true,
          data: { cursor: 0, lines: [] },
        });
      const answer = answers.shift();
      return answer
        ? Promise.resolve(answer)
        : new Promise((resolve) => (parked = resolve));
    });

    const lines: string[] = [];
    await startForkopLogFeed((line) => lines.push(line));
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(0);

    expect(lines).toEqual(['forkop: back']);
    expect(parked).not.toBeNull();
    vi.useRealTimers();
  });
});
