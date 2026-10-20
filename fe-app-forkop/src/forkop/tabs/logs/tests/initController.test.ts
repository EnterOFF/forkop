import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ checkLogs: vi.fn() }));

vi.mock('../../../methods', () => ({
  ForkopShellMethods: { checkLogs: mocks.checkLogs },
}));
vi.mock('../../../../helpers/onMount', () => ({ onMount: async () => ({}) }));
vi.mock('../../../../icons', () => ({ renderSearchIcon24: () => ({}) }));

function page() {
  const nodes: Record<string, Record<string, unknown>> = {};
  const node = (id: string) =>
    (nodes[id] ??= {
      textContent: 'Loading logs...',
      value: '',
      checked: false,
      disabled: false,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 0,
      clientHeight: 0,
      offsetParent: {},
      classList: { toggle() {} },
      setAttribute() {},
      addEventListener() {},
    });
  vi.stubGlobal('document', {
    hidden: false,
    getElementById: node,
    querySelector: () => null,
  });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback());
  return node;
}

beforeEach(() => {
  vi.resetModules();
  mocks.checkLogs.mockReset();
});

async function openedOn(tab: string) {
  const { store } = await import('../../../services/store.service');
  store.set({ tabService: { current: tab, all: [] } });
  const { initController } = await import('../initController');
  return initController;
}

async function switchTo(tab: string) {
  const { store } = await import('../../../services/store.service');
  store.set({ tabService: { current: tab, all: [] } });
}

describe('the Logs tab', () => {
  it('says there are no logs once an empty log arrives', async () => {
    const node = page();
    mocks.checkLogs.mockResolvedValue({ success: true, data: '' });
    const initController = await openedOn('logs');

    await initController();
    await Promise.resolve();

    expect(node('logs-output').textContent).toBe('No logs available');
  });

  it('says the read failed when it did', async () => {
    const node = page();
    mocks.checkLogs.mockResolvedValue({ success: false, error: 'refused' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const initController = await openedOn('logs');

    await initController();
    await Promise.resolve();

    expect(node('logs-output').textContent).toBe('Failed to load logs');
  });

  it('names the buttons for what a search found', async () => {
    const node = page();
    mocks.checkLogs.mockResolvedValue({ success: true, data: 'one\ntwo' });
    node('logs-search').value = 'two';
    const initController = await openedOn('logs');

    await initController();
    await Promise.resolve();

    expect(node('logs-output').textContent).toBe('two');
    expect(node('logs-copy').textContent).toBe('Copy matching');
    expect(node('logs-download').textContent).toBe('Download matching');
  });

  it('keeps the plain labels without a search', async () => {
    const node = page();
    mocks.checkLogs.mockResolvedValue({ success: true, data: 'one\ntwo' });
    const initController = await openedOn('logs');

    await initController();
    await Promise.resolve();

    expect(node('logs-copy').textContent).toBe('Copy');
    expect(node('logs-download').textContent).toBe('Download');
  });

  it('reads nothing while another tab is shown, and reads once it is', async () => {
    vi.useFakeTimers();
    page();
    mocks.checkLogs.mockResolvedValue({ success: true, data: 'line' });
    const initController = await openedOn('section');

    await initController();
    await vi.advanceTimersByTimeAsync(6000);
    expect(mocks.checkLogs).not.toHaveBeenCalled();

    await switchTo('logs');
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.checkLogs).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
