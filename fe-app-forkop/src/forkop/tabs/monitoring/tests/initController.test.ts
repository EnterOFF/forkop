import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClashApiConnections: vi.fn(),
  getConfigSections: vi.fn(),
}));

vi.mock('../../../services/socket.service', () => ({
  socket: { subscribe: vi.fn(), disconnect: vi.fn(), resetAll: vi.fn() },
}));
vi.mock('../../../../helpers/onMount', () => ({ onMount: async () => ({}) }));
vi.mock('../../../../helpers/showToast', () => ({ showToast: vi.fn() }));
vi.mock('../../../methods', () => ({
  CustomForkopMethods: {
    getClashApiConnections: mocks.getClashApiConnections,
    getConfigSections: mocks.getConfigSections,
  },
}));
vi.mock('../../../methods/custom/getClashApiSecret', () => ({
  getClashApiSecret: async () => 'secret',
}));
vi.mock('../../../methods/custom/clashApi', () => ({
  resetClashApiTransport: vi.fn(),
}));
vi.mock('../../../cbi/localDevices', () => ({
  loadLocalDevices: async () => ({ choices: {}, order: [], names: {} }),
}));
vi.mock('../../../../icons', () => ({
  renderSearchIcon24: () => new FakeElement('svg'),
  renderXIcon24: () => new FakeElement('svg'),
}));

type Child = FakeElement | string;

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

function connection(
  id: string,
  { sourceIP = '192.168.1.101', chains = ['direct-out'], rule = '' } = {},
) {
  return {
    id,
    rule,
    metadata: {
      host: `${id}.example.com`,
      destinationPort: '443',
      network: 'tcp',
      sourceIP,
      type: 'tproxy/tproxy-in',
    },
    chains,
    start: new Date().toISOString(),
  };
}

function answerWith(...connections: ReturnType<typeof connection>[]) {
  mocks.getClashApiConnections.mockResolvedValue({
    success: true,
    data: { connections },
  });
}

function answer(...ids: string[]) {
  answerWith(...ids.map((id) => connection(id)));
}

function choose(id: string, value: string) {
  const filter = byId(id);
  filter.value = value;
  (filter.onchange as () => void)();
}

function optionTexts(id: string) {
  return byId(id).children.map((option) =>
    typeof option === 'string' ? option : option.textContent,
  );
}

function hosts() {
  return rows().map((row) => row.descendants()[1].textContent);
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
  mocks.getConfigSections.mockReset().mockResolvedValue([]);
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

describe('the Monitoring filters', () => {
  it('shows only the connections of the chosen device', async () => {
    answerWith(connection('a'), connection('b', { sourceIP: '192.168.1.102' }));
    await openMonitoring();
    expect(optionTexts('monitoring-device-filter')).toEqual([
      'All devices',
      '192.168.1.101',
      '192.168.1.102',
    ]);

    choose('monitoring-device-filter', '192.168.1.102');
    expect([hosts(), activeCount()]).toEqual([['b.example.com'], '1']);
    expect(byId('monitoring-close-all').textContent).toBe('Close matching');

    choose('monitoring-device-filter', '');
    expect([rows().length, activeCount()]).toEqual([2, '2']);
    expect(byId('monitoring-close-all').textContent).toBe('Close all');
  });

  it('shows only the connections of the chosen route', async () => {
    mocks.getConfigSections.mockResolvedValue([
      { '.name': 'section_b', '.type': 'section', label: 'proxy' },
      { '.name': 'section_a', '.type': 'section', label: 'google' },
      { '.name': 'section_c', '.type': 'section', label: 'off', enabled: '0' },
    ]);
    answerWith(
      connection('a'),
      connection('b', { chains: ['google/node', 'google'] }),
      connection('c', { chains: ['proxy/node', 'proxy'] }),
      connection('d', { chains: [], rule: 'final => route(other-out)' }),
    );
    await openMonitoring();
    expect(optionTexts('monitoring-route-filter')).toEqual([
      'All routes',
      'Direct',
      'proxy',
      'google',
      'other-out',
    ]);

    choose('monitoring-route-filter', 'google');
    expect([hosts(), activeCount()]).toEqual([['b.example.com'], '1']);
    expect(byId('monitoring-close-all').textContent).toBe('Close matching');

    choose('monitoring-route-filter', '');
    expect([rows().length, activeCount()]).toEqual([4, '4']);
    expect(byId('monitoring-close-all').textContent).toBe('Close all');
  });

  it('tells a route named all from all routes', async () => {
    mocks.getConfigSections.mockResolvedValue([
      { '.name': 'section_a', '.type': 'section', label: 'all' },
    ]);
    answerWith(connection('a'), connection('b', { chains: ['all'] }));
    await openMonitoring();

    choose('monitoring-route-filter', 'all');
    expect([hosts(), activeCount()]).toEqual([['b.example.com'], '1']);
  });

  it('tells a section named Direct from the direct route', async () => {
    mocks.getConfigSections.mockResolvedValue([
      { '.name': 'section_a', '.type': 'section', label: 'Direct' },
    ]);
    answerWith(connection('a'), connection('b', { chains: ['Direct'] }));
    await openMonitoring();
    expect(optionTexts('monitoring-route-filter')).toEqual([
      'All routes',
      'Direct',
      'Direct',
    ]);

    choose('monitoring-route-filter', 'Direct');
    expect([hosts(), activeCount()]).toEqual([['b.example.com'], '1']);

    choose('monitoring-route-filter', 'direct-out');
    expect([hosts(), activeCount()]).toEqual([['a.example.com'], '1']);
  });

  it('combines the device and the route', async () => {
    answerWith(
      connection('a'),
      connection('b', { chains: [], rule: 'final => route(other-out)' }),
      connection('c', {
        sourceIP: '192.168.1.102',
        chains: [],
        rule: 'final => route(other-out)',
      }),
    );
    await openMonitoring();

    choose('monitoring-route-filter', 'other-out');
    choose('monitoring-device-filter', '192.168.1.101');
    expect([hosts(), activeCount()]).toEqual([['b.example.com'], '1']);
  });
});
