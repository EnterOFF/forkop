import { describe, expect, it, vi } from 'vitest';
import { Forkop } from '../../../types';

interface FakeNode {
  type: string;
  attrs: Record<string, unknown>;
  children: Array<FakeNode | string>;
}

function installElementFactory() {
  const fakeE = (type: string, attrs?: unknown, children?: unknown) => ({
    type,
    attrs: (attrs || {}) as Record<string, unknown>,
    children:
      children === undefined
        ? []
        : Array.isArray(children)
          ? (children as Array<FakeNode | string>)
          : [children as FakeNode | string],
  });
  (globalThis as unknown as { E: unknown }).E = fakeE;
}

function findNode(
  node: FakeNode | string,
  predicate: (candidate: FakeNode) => boolean,
): FakeNode | undefined {
  if (typeof node === 'string') {
    return undefined;
  }

  if (predicate(node)) {
    return node;
  }

  for (const child of node.children) {
    const found = findNode(child, predicate);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function findNodes(
  node: FakeNode | string,
  predicate: (candidate: FakeNode) => boolean,
): FakeNode[] {
  if (typeof node === 'string') {
    return [];
  }

  return [
    ...(predicate(node) ? [node] : []),
    ...node.children.flatMap((child) => findNodes(child, predicate)),
  ];
}

describe('renderSections latency actions', () => {
  it('tests the clicked outbound instead of the selector group', async () => {
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe() {}
      },
    );
    vi.stubGlobal('document', {
      body: {},
      querySelectorAll: () => [],
      querySelector: () => null,
      createElementNS: (_namespace: string, type: string) => ({
        type,
        attrs: {},
        children: [] as Array<FakeNode | string>,
        setAttribute(name: string, value: string) {
          (this.attrs as Record<string, string>)[name] = value;
        },
        appendChild(child: FakeNode) {
          this.children.push(child);
        },
      }),
    });
    installElementFactory();
    const { renderSections } = await import('../partials/renderSections');
    const onTestLatency = vi.fn();
    const onTestOutboundLatency = vi.fn();
    const section: Forkop.OutboundGroup = {
      code: 'proxy-out',
      sectionName: 'main',
      displayName: 'Main',
      withTagSelect: true,
      outbounds: [
        {
          code: 'main/Node',
          displayName: 'Node',
          latency: 0,
          type: 'VLESS',
          selected: false,
        },
      ],
    };

    const root = renderSections({
      loading: false,
      failed: false,
      section,
      onTestLatency,
      onTestOutboundLatency,
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      onUpdateSubscription: vi.fn(),
      latencyFetching: false,
      subscriptionUpdating: false,
    }) as unknown as FakeNode;
    const button = findNode(
      root,
      (node) =>
        node.type === 'button' &&
        String(node.attrs.class || '').includes(
          'fkp_dashboard-page__outbound-grid__item__latency',
        ),
    );

    expect(button).toBeDefined();
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;
    (button?.attrs.click as (event: MouseEvent) => void)(event);

    expect(onTestOutboundLatency).toHaveBeenCalledWith('proxy', 'main/Node');
    expect(onTestLatency).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  }, 15000);

  it('toggles temporary latency sorting for multi-card sections', async () => {
    installElementFactory();
    const { renderSections } = await import('../partials/renderSections');
    const onSortByLatencyChange = vi.fn();
    const outbound = (
      displayName: string,
      latency: number,
      type = 'VLESS',
    ): Forkop.Outbound => ({
      code: displayName.toLowerCase(),
      displayName,
      latency,
      type,
      selected: false,
    });
    const outbounds: Forkop.Outbound[] = [
      outbound('Missing', 0),
      outbound('Fallback', 200, 'Fallback'),
      outbound('Node', 50),
      outbound('URLTest', 100, 'URLTest'),
    ];
    const render = (sortByLatency = false) =>
      renderSections({
        loading: false,
        failed: false,
        section: {
          code: 'main-out',
          sectionName: 'main',
          displayName: 'Main',
          withTagSelect: true,
          outbounds,
        },
        onTestLatency: vi.fn(),
        onTestOutboundLatency: vi.fn(),
        onChooseOutbound: vi.fn(),
        onCopyOutbound: vi.fn(),
        onShowUrlTestInfo: vi.fn(),
        onShowFallbackInfo: vi.fn(),
        onUpdateSubscription: vi.fn(),
        onSortByLatencyChange,
        sortByLatency,
        latencyFetching: false,
        subscriptionUpdating: false,
      }) as unknown as FakeNode;
    const findSortButton = (root: FakeNode) =>
      findNode(
        root,
        (node) =>
          node.type === 'button' &&
          String(node.attrs.class || '')
            .split(' ')
            .includes('fkp_dashboard-page__outbound-section__sort-by-latency'),
      );
    const inactiveRoot = render();
    const inactiveButton = findSortButton(inactiveRoot);
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;

    expect(inactiveButton?.attrs.title).toBe('Sort by latency');
    expect(inactiveButton?.attrs['aria-label']).toBe('Sort by latency');
    expect(inactiveButton?.attrs['aria-pressed']).toBe('false');
    (inactiveButton?.attrs.click as (event: MouseEvent) => void)(event);
    expect(onSortByLatencyChange).toHaveBeenCalledWith('main', true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();

    const activeRoot = render(true);
    const activeButton = findSortButton(activeRoot);
    const cards = findNodes(activeRoot, (node) =>
      String(node.attrs.class || '')
        .split(' ')
        .includes('fkp_dashboard-page__outbound-grid__item'),
    );
    const names = cards.map(
      (card) => findNode(card, (node) => node.type === 'b')?.children[0],
    );

    expect(names).toEqual(['Node', 'URLTest', 'Fallback', 'Missing']);
    expect(outbounds.map((outbound) => outbound.displayName)).toEqual([
      'Missing',
      'Fallback',
      'Node',
      'URLTest',
    ]);
    expect(activeButton?.attrs['aria-pressed']).toBe('true');
    expect(String(activeButton?.attrs.class)).toContain(
      'fkp_dashboard-page__outbound-section__sort-by-latency--active',
    );

    (activeButton?.attrs.click as (event: MouseEvent) => void)(event);
    expect(onSortByLatencyChange).toHaveBeenLastCalledWith('main', false);

    const singleCardRoot = renderSections({
      loading: false,
      failed: false,
      section: {
        code: 'main-out',
        sectionName: 'main',
        displayName: 'Main',
        withTagSelect: true,
        outbounds: [outbounds[0]],
      },
      onTestLatency: vi.fn(),
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      onUpdateSubscription: vi.fn(),
      latencyFetching: false,
      subscriptionUpdating: false,
    }) as unknown as FakeNode;

    expect(findSortButton(singleCardRoot)).toBeUndefined();
  }, 15000);

  it('does not choose an outbound when its name is selected', async () => {
    installElementFactory();
    const getSelection = vi.fn(() => ({ isCollapsed: false }));
    vi.stubGlobal('window', { getSelection });
    const { renderSections } = await import('../partials/renderSections');
    const onChooseOutbound = vi.fn();
    const root = renderSections({
      loading: false,
      failed: false,
      section: {
        code: 'proxy-out',
        sectionName: 'main',
        displayName: 'Main',
        withTagSelect: true,
        outbounds: [
          {
            code: 'main/Node',
            displayName: 'Node',
            latency: 0,
            type: 'VLESS',
            selected: false,
          },
        ],
      },
      onTestLatency: vi.fn(),
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound,
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      onUpdateSubscription: vi.fn(),
      latencyFetching: false,
      subscriptionUpdating: false,
    }) as unknown as FakeNode;
    const card = findNode(root, (node) =>
      String(node.attrs.class || '')
        .split(' ')
        .includes('fkp_dashboard-page__outbound-grid__item'),
    );
    const click = card?.attrs.click as () => void;

    click();
    expect(onChooseOutbound).not.toHaveBeenCalled();

    getSelection.mockReturnValue({ isCollapsed: true });
    click();
    expect(onChooseOutbound).toHaveBeenCalledWith(
      'main',
      'proxy-out',
      'main/Node',
    );
  }, 15000);

  it('tests a URLTest through its group endpoint', async () => {
    installElementFactory();
    const { renderSections } = await import('../partials/renderSections');
    const onTestOutboundLatency = vi.fn();
    const section: Forkop.OutboundGroup = {
      code: 'proxy-out',
      sectionName: 'main',
      displayName: 'Main',
      withTagSelect: true,
      outbounds: [
        {
          code: 'main/URLTest',
          displayName: 'URLTest',
          latency: 0,
          type: 'URLTest',
          selected: false,
          urlTestInfo: {
            code: 'main/URLTest',
            displayName: 'URLTest',
            selectedCode: 'main/Node 2',
            outbounds: [
              {
                code: 'main/Node 1',
                displayName: 'Node 1',
                latency: 10,
                type: 'VLESS',
                selected: false,
              },
              {
                code: 'main/Node 2',
                displayName: 'Node 2',
                latency: 20,
                type: 'VLESS',
                selected: true,
              },
            ],
          },
        },
      ],
    };

    const root = renderSections({
      loading: false,
      failed: false,
      section,
      onTestLatency: vi.fn(),
      onTestOutboundLatency,
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      onUpdateSubscription: vi.fn(),
      latencyFetching: false,
      subscriptionUpdating: false,
    }) as unknown as FakeNode;
    const button = findNode(
      root,
      (node) =>
        node.type === 'button' &&
        String(node.attrs.class || '').includes(
          'fkp_dashboard-page__outbound-grid__item__latency',
        ),
    );

    expect(button).toBeDefined();
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;
    (button?.attrs.click as (event: MouseEvent) => void)(event);

    expect(onTestOutboundLatency).toHaveBeenCalledWith('group', 'main/URLTest');
  }, 15000);

  it('tests a fallback through its group endpoint', async () => {
    installElementFactory();
    const { renderSections } = await import('../partials/renderSections');
    const onTestLatency = vi.fn();
    const onTestOutboundLatency = vi.fn();
    const root = renderSections({
      loading: false,
      failed: false,
      section: {
        code: 'main-out',
        sectionName: 'main',
        displayName: 'Main',
        withTagSelect: true,
        latencyTestCode: 'main-out',
        outbounds: [
          {
            code: 'main/Fallback',
            displayName: 'Fallback',
            latency: 10,
            type: 'Fallback',
            selected: false,
            fallbackInfo: {
              code: 'main/Fallback',
              displayName: 'Fallback',
              outbounds: [
                {
                  code: 'main/Node 1',
                  displayName: 'Node 1',
                  latency: 10,
                  type: 'VLESS',
                  selected: true,
                  pinned: false,
                  levelIndex: 0,
                  levelName: 'Primary',
                },
                {
                  code: 'main/Node 2',
                  displayName: 'Node 2',
                  latency: 20,
                  type: 'VLESS',
                  selected: false,
                  pinned: false,
                  levelIndex: 1,
                  levelName: 'Backup',
                },
              ],
            },
          },
        ],
      },
      onTestLatency,
      onTestOutboundLatency,
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      onUpdateSubscription: vi.fn(),
      latencyFetching: false,
      subscriptionUpdating: false,
    }) as unknown as FakeNode;
    const buttons = findNodes(root, (node) => node.type === 'button');
    const fallbackButton = buttons.find((button) =>
      String(button.attrs.class || '').includes(
        'fkp_dashboard-page__outbound-grid__item__latency',
      ),
    );
    const sectionButton = buttons.find(
      (button) =>
        String(button.attrs.class || '') ===
        'btn dashboard-sections-grid-item-test-latency',
    );
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;

    (fallbackButton?.attrs.click as (event: MouseEvent) => void)(event);
    expect(onTestOutboundLatency).toHaveBeenCalledWith(
      'group',
      'main/Fallback',
    );
    expect(onTestLatency).not.toHaveBeenCalled();

    (sectionButton?.attrs.click as (event: MouseEvent) => void)(event);
    expect(onTestLatency).toHaveBeenCalledWith('main-out');
  }, 15000);

  it('blocks only the section button during a section latency test', async () => {
    installElementFactory();
    const { renderSections } = await import('../partials/renderSections');
    const onTestLatency = vi.fn();
    const props = {
      loading: false,
      failed: false,
      section: {
        code: 'proxy-out',
        sectionName: 'main',
        displayName: 'Main',
        withTagSelect: true,
        outbounds: [
          {
            code: 'main/Node',
            displayName: 'Node',
            latency: 1600,
            type: 'VLESS',
            selected: false,
          },
          {
            code: 'main/Other',
            displayName: 'Other',
            latency: 20,
            type: 'VLESS',
            selected: false,
          },
        ],
      },
      onTestLatency,
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      onUpdateSubscription: vi.fn(),
      latencyFetching: true,
      subscriptionUpdating: false,
    };
    const root = renderSections(props) as unknown as FakeNode;
    const buttons = findNodes(
      root,
      (node) =>
        node.type === 'button' &&
        String(node.attrs.class || '').includes(
          'fkp_dashboard-page__outbound-grid__item__latency',
        ),
    );
    const sectionButton = findNode(
      root,
      (node) =>
        node.type === 'button' &&
        String(node.attrs.class || '') ===
          'btn dashboard-sections-grid-item-test-latency',
    );
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.attrs.disabled).toBeUndefined();
    expect(buttons[1]?.attrs.disabled).toBeUndefined();
    expect(buttons[0]?.attrs['aria-busy']).toBeUndefined();
    expect(buttons[1]?.attrs['aria-busy']).toBeUndefined();
    expect(
      sectionButton?.children.some(
        (child) =>
          typeof child !== 'string' &&
          String(child.attrs.class || '').includes('loader-circle'),
      ),
    ).toBe(true);
    expect(sectionButton?.attrs.disabled).toBe(true);
    expect(sectionButton?.attrs['aria-busy']).toBe('true');
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;
    (sectionButton?.attrs.click as (event: MouseEvent) => void)(event);
    expect(onTestLatency).not.toHaveBeenCalled();
  }, 15000);

  it('blocks only the exact card during an outbound latency test', async () => {
    installElementFactory();
    const { renderSections } = await import('../partials/renderSections');
    const root = renderSections({
      loading: false,
      failed: false,
      section: {
        code: 'proxy-out',
        sectionName: 'main',
        displayName: 'Main',
        withTagSelect: true,
        outbounds: [
          {
            code: 'main/URLTest',
            displayName: 'URLTest',
            latency: 0,
            type: 'URLTest',
            selected: false,
            urlTestInfo: {
              code: 'main/URLTest',
              displayName: 'URLTest',
              outbounds: [
                {
                  code: 'main/Node',
                  displayName: 'Node',
                  latency: 0,
                  type: 'VLESS',
                  selected: false,
                },
              ],
            },
          },
          {
            code: 'main/Node',
            displayName: 'Node',
            latency: 0,
            type: 'VLESS',
            selected: false,
          },
        ],
      },
      onTestLatency: vi.fn(),
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      onUpdateSubscription: vi.fn(),
      latencyFetching: false,
      latencyFetchingTargets: new Set(['main/URLTest']),
      subscriptionUpdating: false,
    }) as unknown as FakeNode;
    const buttons = findNodes(
      root,
      (node) =>
        node.type === 'button' &&
        String(node.attrs.class || '').includes(
          'fkp_dashboard-page__outbound-grid__item__latency',
        ),
    );

    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.attrs['aria-busy']).toBe('true');
    expect(buttons[0]?.attrs.disabled).toBe(true);
    expect(buttons[1]?.attrs['aria-busy']).toBeUndefined();
    expect(buttons[1]?.attrs.disabled).toBeUndefined();
    const sectionButton = findNode(
      root,
      (node) =>
        node.type === 'button' &&
        String(node.attrs.class || '') ===
          'btn dashboard-sections-grid-item-test-latency',
    );
    expect(sectionButton?.attrs['aria-busy']).toBeUndefined();
    expect(sectionButton?.attrs.disabled).toBeUndefined();
  }, 15000);

  it('does not render latency or selection actions for an empty group', async () => {
    installElementFactory();
    const { renderSections } = await import('../partials/renderSections');
    const onChooseOutbound = vi.fn();
    const root = renderSections({
      loading: false,
      failed: false,
      section: {
        code: 'proxy-out',
        sectionName: 'main',
        displayName: 'Main',
        withTagSelect: true,
        outbounds: [
          {
            code: 'main/Empty',
            displayName: 'Empty',
            latency: 0,
            type: 'URLTest',
            selected: false,
            runtimeAvailable: false,
            urlTestInfo: {
              code: 'main/Empty',
              displayName: 'Empty',
              outbounds: [],
            },
          },
        ],
      },
      onTestLatency: vi.fn(),
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound,
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      onUpdateSubscription: vi.fn(),
      latencyFetching: false,
      subscriptionUpdating: false,
    }) as unknown as FakeNode;
    const latency = findNode(
      root,
      (node) =>
        node.type === 'button' &&
        String(node.attrs.class || '').includes(
          'fkp_dashboard-page__outbound-grid__item__latency',
        ),
    );
    const card = findNode(root, (node) =>
      String(node.attrs.class || '')
        .split(' ')
        .includes('fkp_dashboard-page__outbound-grid__item'),
    );

    expect(latency).toBeUndefined();
    expect(String(card?.attrs.class)).toContain(
      'fkp_dashboard-page__outbound-grid__item--disabled',
    );
    (card?.attrs.click as () => void)();
    expect(onChooseOutbound).not.toHaveBeenCalled();
  }, 15000);
});

describe('renderSections subscription metadata', () => {
  it('renders metadata URLs as compact text links', async () => {
    installElementFactory();
    const { renderSections } = await import('../partials/renderSections');
    const root = renderSections({
      loading: false,
      failed: false,
      section: {
        code: 'proxy-out',
        sectionName: 'main',
        displayName: 'Main',
        withTagSelect: true,
        outbounds: [],
        subscriptionMetadata: [
          {
            title: 'Subscription',
            webPageUrl: 'https://subscription.example/profile',
            supportUrl: 'https://subscription.example/support',
            announceUrl: 'https://subscription.example/announce',
          },
        ],
      },
      onTestLatency: vi.fn(),
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      onUpdateSubscription: vi.fn(),
      latencyFetching: false,
      subscriptionUpdating: false,
    }) as unknown as FakeNode;
    const links = findNodes(
      root,
      (node) =>
        node.type === 'a' &&
        String(node.attrs.class || '') ===
          'fkp_dashboard-page__subscription-meta__action',
    );

    expect(links.map((link) => link.children[0])).toEqual([
      'Profile ↗',
      'Support ↗',
      'More details ↗',
    ]);
    expect(links.map((link) => link.attrs.href)).toEqual([
      'https://subscription.example/profile',
      'https://subscription.example/support',
      'https://subscription.example/announce',
    ]);
  });

  it('keeps the subscription tag as the metadata heading', async () => {
    installElementFactory();
    const { renderSections } = await import('../partials/renderSections');
    const root = renderSections({
      loading: false,
      failed: false,
      section: {
        code: 'proxy-out',
        sectionName: 'main',
        displayName: 'Main',
        withTagSelect: true,
        outbounds: [],
        subscriptionMetadata: [
          { title: 'Subscription', subscriptionTag: 'Premium' },
        ],
      },
      onTestLatency: vi.fn(),
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      onUpdateSubscription: vi.fn(),
      latencyFetching: false,
      subscriptionUpdating: false,
    }) as unknown as FakeNode;
    const heading = findNodes(
      root,
      (node) =>
        String(node.attrs.class || '') ===
        'fkp_dashboard-page__subscription-meta__heading',
    )[0];

    expect(heading).toBeTruthy();
    expect(heading.children).toHaveLength(1);
    const tag = (heading.children as FakeNode[])[0] as FakeNode;
    expect(String(tag.attrs.class || '')).toBe(
      'fkp_dashboard-page__outbound-grid__item__subscription-tag',
    );
    expect(tag.children[0]).toBe('Premium');
  });

  it('leaves out the metadata heading without a subscription tag', async () => {
    installElementFactory();
    const { renderSections } = await import('../partials/renderSections');
    const root = renderSections({
      loading: false,
      failed: false,
      section: {
        code: 'proxy-out',
        sectionName: 'main',
        displayName: 'Main',
        withTagSelect: true,
        outbounds: [],
        subscriptionMetadata: [{ title: 'Subscription', expire: 1893456000 }],
      },
      onTestLatency: vi.fn(),
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      onUpdateSubscription: vi.fn(),
      latencyFetching: false,
      subscriptionUpdating: false,
    }) as unknown as FakeNode;
    const heading = findNode(
      root,
      (node) =>
        String(node.attrs.class || '') ===
        'fkp_dashboard-page__subscription-meta__heading',
    );
    const title = findNode(
      root,
      (node) =>
        String(node.attrs.class || '') ===
        'fkp_dashboard-page__subscription-meta__title',
    );

    expect(heading).toBeUndefined();
    expect(title?.children[0]).toBe('Subscription');
  });
});
