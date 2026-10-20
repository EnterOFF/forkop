import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ callUbus: vi.fn() }));

vi.mock('../../../helpers/callUbus', () => ({
  callUbus: mocks.callUbus,
}));

async function freshFeed() {
  vi.resetModules();
  return import('../forkopLogFeed.service');
}

const gone = { success: false, message: 'Object not found', unavailable: true };

beforeEach(() => {
  mocks.callUbus.mockReset();
});

describe('the log feed', () => {
  it('starts from where the log stands and takes only the lines after it', async () => {
    mocks.callUbus.mockResolvedValue({ success: true, data: { cursor: 3 } });
    const feed = await freshFeed();

    const lines: string[] = [];
    feed.startForkopLogFeed((line) => lines.push(line));
    feed.takeForkopLogLines({ cursor: 3, lines: ['forkop: old'] });
    await feed.placeForkopLogFeed();
    feed.takeForkopLogLines({ cursor: 4, lines: ['forkop: new'] });

    expect(lines).toEqual(['forkop: new']);
    expect(feed.getForkopLogCursor()).toBe(4);
  });

  it('goes on from the cursor of the page it took over from', async () => {
    const feed = await freshFeed();

    feed.startForkopLogFeed(() => {}, 7);
    await feed.placeForkopLogFeed();

    expect(feed.getForkopLogCursor()).toBe(7);
    expect(mocks.callUbus).not.toHaveBeenCalled();
  });

  it('asks where the log stands again once the state service is back', async () => {
    mocks.callUbus
      .mockResolvedValueOnce(gone)
      .mockResolvedValueOnce({ success: true, data: { cursor: 5 } });
    const feed = await freshFeed();

    feed.startForkopLogFeed(() => {});
    await feed.placeForkopLogFeed();
    expect(feed.getForkopLogCursor()).toBeUndefined();

    await feed.placeForkopLogFeed();
    expect(feed.getForkopLogCursor()).toBe(5);
  });
});
