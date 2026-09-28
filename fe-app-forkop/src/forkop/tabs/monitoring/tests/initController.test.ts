import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClashApiConnections: vi.fn(),
}));

vi.mock('../../../services/socket.service', () => ({
  socket: { subscribe: vi.fn(), disconnect: vi.fn(), resetAll: vi.fn() },
}));
vi.mock('../../../../helpers/onMount', () => ({ onMount: async () => ({}) }));
vi.mock('../../../../helpers/showToast', () => ({ showToast: vi.fn() }));
vi.mock('../../../methods', () => ({
  CustomForkopMethods: {
    getClashApiConnections: mocks.getClashApiConnections,
    getConfigSections: async () => [],
  },
}));
vi.mock('../../../methods/custom/getClashApiSecret', () => ({
  getClashApiSecret: async () => 'secret',
}));
vi.mock('../../../methods/custom/getDashboardSections', () => ({
  resetClashApiTransport: vi.fn(),
}));
vi.mock('../../../cbi/localDevices', () => ({
  loadLocalDeviceChoices: async () => ({}),
}));
vi.mock('../../../../icons', () => ({
  renderSearchIcon24: () => new FakeElement('svg'),
  renderXIcon24: () => new FakeElement('svg'),
}));

type Child = FakeElement | string;

// Just enough of an element for the tab to draw itself into and be read back.
class FakeElement {
  tag: string;
  attrs: Record<string, unknown>;
  children: Child[] = [];
  [property: string]: unknown;

  constructor(
    tag: string,
    attrs: Record<string, unknown> = {},
    children?: unknown,
  ) {
    this.tag = tag;
    this.attrs = attrs;
    Object.assign(this, attrs);
    this.classList = { toggle() {} };
    this.replaceChildren(
      ...((Array.isArray(children) ? children : [children]).filter(
        (child) => child != null,
      ) as Child[]),
    );
  }

  replaceChildren(...children: Child[]) {
    this.children = children;
  }

  get childNodes() {
    return this.children;
  }

  get textContent(): string {
    return this.children
      .map((child) => (typeof child === 'string' ? child : child.textContent))
      .join('');
  }

  set textContent(value: string) {
    this.children = [String(value)];
  }

  contains(node: unknown): boolean {
    return (
      node === this ||
      this.children.some(
        (child) => typeof child !== 'string' && child.contains(node),
      )
    );
  }

  descendants(): FakeElement[] {
    return [
      this,
      ...this.children.flatMap((child) =>
        typeof child === 'string' ? [] : child.descendants(),
      ),
    ];
  }
}

let page: FakeElement;
let selection: {
  isCollapsed: boolean;
  anchorNode: unknown;
  focusNode: unknown;
};
const documentListeners = new Map<string, Set<() => void>>();

function byId(id: string) {
  return page.descendants().find((element) => element.id === id) as FakeElement;
}

function connection(id: string) {
  return {
    id,
    metadata: {
      host: `${id}.example.com`,
      destinationPort: '443',
      network: 'tcp',
      sourceIP: '192.168.1.101',
      type: 'tproxy/tproxy-in',
    },
    chains: ['direct-out'],
    start: new Date().toISOString(),
  };
}

function answer(...ids: string[]) {
  mocks.getClashApiConnections.mockResolvedValue({
    success: true,
    data: { connections: ids.map(connection) },
  });
}

function rows() {
  return byId('monitoring-connections')
    .descendants()
    .filter(
      (element) =>
        element.attrs.role === 'row' &&
        !`${element.attrs.class}`.includes('--head'),
    );
}

function activeCount() {
  return byId('monitoring-tab-active').textContent.replace(/\D/g, '');
}

function select(node: unknown) {
  selection = { isCollapsed: node == null, anchorNode: node, focusNode: node };
  documentListeners.get('selectionchange')?.forEach((listener) => listener());
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  mocks.getClashApiConnections.mockReset();
  documentListeners.clear();
  selection = { isCollapsed: true, anchorNode: null, focusNode: null };

  vi.stubGlobal(
    'E',
    (tag: string, attrs?: Record<string, unknown>, children?: unknown) =>
      new FakeElement(tag, attrs, children),
  );
  vi.stubGlobal('window', { getSelection: () => selection });
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
    },
  );
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    body: {},
    getElementById: (id: string) => byId(id) ?? null,
    querySelector: (query: string) =>
      page
        .descendants()
        .find((element) => `${element.attrs.class}` === query.slice(1)) ?? null,
    querySelectorAll: () => [],
    addEventListener: (type: string, listener: () => void) => {
      if (!documentListeners.has(type)) {
        documentListeners.set(type, new Set());
      }
      documentListeners.get(type)?.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) =>
      documentListeners.get(type)?.delete(listener),
  });

  const { render } = await import('../render');
  page = render() as unknown as FakeElement;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openMonitoring() {
  const { store } = await import('../../../services/store.service');
  store.set({ tabService: { current: 'monitoring', all: [] } });
  const { initController } = await import('../initController');
  await initController();
  await vi.advanceTimersByTimeAsync(0);
}

// The table is redrawn twice a second, which would take a selection away before
// it could be copied, so the tab holds still while one is made in it.
describe('the Monitoring pause', () => {
  it('holds new connections back while Auto refresh is off', async () => {
    answer('a');
    await openMonitoring();
    expect(rows()).toHaveLength(1);

    const autoRefresh = byId('monitoring-auto-refresh');
    autoRefresh.checked = false;
    (autoRefresh.onchange as () => void)();
    answer('a', 'b');
    await vi.advanceTimersByTimeAsync(5000);
    expect([rows().length, activeCount()]).toEqual([1, '1']);

    autoRefresh.checked = true;
    (autoRefresh.onchange as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect([rows().length, activeCount()]).toEqual([2, '2']);
  });

  // The counters kept counting while the rows stood still, so the tab said 42
  // connections over a table of 40, and nothing said the table had stopped.
  it('holds the whole tab while text in the list is selected and says so', async () => {
    answer('a');
    await openMonitoring();
    const note = byId('monitoring-pause-note');
    expect(note.hidden).toBe(true);

    select(rows()[0].descendants()[1]);
    answer('a', 'b');
    await vi.advanceTimersByTimeAsync(5000);
    expect([rows().length, activeCount()]).toEqual([1, '1']);
    expect(note.hidden).toBe(false);
    expect(byId('monitoring-auto-refresh').checked).toBe(true);

    select(null);
    await vi.advanceTimersByTimeAsync(0);
    expect([rows().length, activeCount()]).toEqual([2, '2']);
    expect(note.hidden).toBe(true);
  });

  it('keeps the list live while text outside it is selected', async () => {
    answer('a');
    await openMonitoring();

    select(byId('monitoring-tab-active'));
    answer('a', 'b');
    await vi.advanceTimersByTimeAsync(5000);
    expect([rows().length, activeCount()]).toEqual([2, '2']);
    expect(byId('monitoring-pause-note').hidden).toBe(true);
  });

  it('leaves the note to the switch when Auto refresh is off anyway', async () => {
    answer('a');
    await openMonitoring();
    const autoRefresh = byId('monitoring-auto-refresh');
    autoRefresh.checked = false;
    (autoRefresh.onchange as () => void)();

    select(rows()[0].descendants()[1]);
    expect(byId('monitoring-pause-note').hidden).toBe(true);

    select(null);
    answer('a', 'b');
    await vi.advanceTimersByTimeAsync(5000);
    expect(rows()).toHaveLength(1);
  });
});
