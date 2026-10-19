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
  // Every section header draws icons, and an icon is built through the
  // document; a case run on its own has none unless it is given one here.
  if (typeof document === 'undefined') {
    vi.stubGlobal('document', {
      timeline: { currentTime: 0 },
      createElementNS: (_namespace: string, type: string) => ({
        ...fakeE(type, {}),
        setAttribute(this: FakeNode, name: string, value: string) {
          this.attrs[name] = value;
        },
        appendChild(this: FakeNode, child: FakeNode) {
          this.children.push(child);
        },
      }),
    });
  }
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
      latencyFetching: false,
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
        onSortByLatencyChange,
        sortByLatency,
        latencyFetching: false,
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
      latencyFetching: false,
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
      latencyFetching: false,
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
      latencyFetching: false,
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
      latencyFetching: false,
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
      latencyFetching: true,
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
      latencyFetching: false,
      latencyFetchingTargets: new Set(['main/URLTest']),
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

  // The group is on the dashboard because the Clash API reports it; it has no
  // members because its filter or its provider left it without any.
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
      latencyFetching: false,
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
      latencyFetching: false,
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
      latencyFetching: false,
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
      latencyFetching: false,
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

  // The assembled entry always carries which source it came from, so counting
  // its keys says nothing about whether there is anything to show. What decides
  // is content, and a tag is not content: it is already in front of every node
  // name below.
  it('leaves out a block that would hold nothing but the tag', async () => {
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
          { subscriptionTag: 'Premium', sourceIndex: 1, sourceSection: 'main' },
        ],
      },
      onTestLatency: vi.fn(),
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      latencyFetching: false,
    }) as unknown as FakeNode;

    expect(
      findNode(
        root,
        (node) =>
          String(node.attrs.class || '') ===
          'fkp_dashboard-page__subscription-meta',
      ),
    ).toBeUndefined();
  });

  // Traffic, an expiry, a support link or an announcement each make the block
  // worth its border, tag or no tag.
  it('keeps a block that has something of its own to say', async () => {
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
            subscriptionTag: 'Premium',
            sourceIndex: 1,
            sourceSection: 'main',
            supportUrl: 'https://subscription.example/support',
          },
        ],
      },
      onTestLatency: vi.fn(),
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      latencyFetching: false,
    }) as unknown as FakeNode;

    expect(
      findNode(
        root,
        (node) =>
          String(node.attrs.class || '') ===
          'fkp_dashboard-page__subscription-meta',
      ),
    ).toBeTruthy();
  });
});

describe('renderSections collapse action', () => {
  const section = {
    code: 'proxy-out',
    sectionName: 'main',
    displayName: 'Main',
    withTagSelect: true,
    outbounds: [
      {
        code: 'main/Node',
        displayName: 'Node',
        latency: 42,
        type: 'VLESS',
        selected: true,
      },
      {
        code: 'main/Other',
        displayName: 'Other',
        latency: 84,
        type: 'VLESS',
        selected: false,
      },
    ],
    subscriptionMetadata: [
      {
        title: 'Subscription',
        traffic: { used: 1024, total: 2048, isUnlimited: false },
      },
    ],
  } as Forkop.OutboundGroup;

  async function render(
    props: {
      collapsible?: boolean;
      collapsed?: boolean;
      onCollapsedChange?: (sectionName: string, collapsed: boolean) => void;
    } = {},
  ) {
    installElementFactory();
    const { renderSections } = await import('../partials/renderSections');
    return renderSections({
      loading: false,
      failed: false,
      section,
      onTestLatency: vi.fn(),
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      latencyFetching: false,
      ...props,
    }) as unknown as FakeNode;
  }

  const findCollapseButton = (root: FakeNode) =>
    findNode(
      root,
      (node) =>
        node.type === 'button' &&
        String(node.attrs.class || '')
          .split(' ')
          .includes('fkp_dashboard-page__outbound-section__collapse'),
    );

  const childClasses = (root: FakeNode, className: string) =>
    (
      findNode(root, (node) =>
        String(node.attrs.class || '')
          .split(' ')
          .includes(className),
      )?.children || []
    )
      .filter((child): child is FakeNode => typeof child !== 'string')
      .map((child) => String(child.attrs.class || ''));

  it('stays out of a dashboard showing a single section', async () => {
    expect(findCollapseButton(await render())).toBeUndefined();
    expect(
      findCollapseButton(await render({ collapsible: false })),
    ).toBeUndefined();
  });

  // In front of the title, every section has it at the same place: at the
  // head of the actions it moved along with how many of them a section had.
  it('sits in front of the title once another section shares the page', async () => {
    const root = await render({ collapsible: true });
    const button = findCollapseButton(root);

    expect(button).toBeDefined();
    expect(button?.attrs.title).toBe('Collapse section');
    expect(button?.attrs['aria-label']).toBe('Collapse section');
    expect(button?.attrs['aria-expanded']).toBe('true');
    expect(
      childClasses(root, 'fkp_dashboard-page__outbound-section__heading'),
    ).toEqual([
      expect.stringContaining('fkp_dashboard-page__outbound-section__collapse'),
      'fkp_dashboard-page__outbound-section__title-section__title',
      'fkp_dashboard-page__outbound-section__current',
    ]);
    expect(
      childClasses(
        root,
        'fkp_dashboard-page__outbound-section__title-section__actions',
      ).some((name) => name.includes('outbound-section__collapse')),
    ).toBe(false);
  });

  it('reports the state the click asks for', async () => {
    const onCollapsedChange = vi.fn();
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;
    const expanded = await render({ collapsible: true, onCollapsedChange });

    (findCollapseButton(expanded)?.attrs.click as (event: MouseEvent) => void)(
      event,
    );
    expect(onCollapsedChange).toHaveBeenCalledWith('main', true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();

    const collapsed = await render({
      collapsible: true,
      collapsed: true,
      onCollapsedChange,
    });
    const collapsedButton = findCollapseButton(collapsed);

    expect(collapsedButton?.attrs.title).toBe('Expand section');
    expect(collapsedButton?.attrs['aria-expanded']).toBe('false');
    expect(String(collapsedButton?.attrs.class)).toContain(
      'fkp_dashboard-page__outbound-section__collapse--collapsed',
    );
    (collapsedButton?.attrs.click as (event: MouseEvent) => void)(event);
    expect(onCollapsedChange).toHaveBeenLastCalledWith('main', false);
  });

  it('folds away every card and subscription block, keeping the title row', async () => {
    const expanded = await render({ collapsible: true });
    const collapsed = await render({ collapsible: true, collapsed: true });
    const count = (root: FakeNode, className: string) =>
      findNodes(root, (node) =>
        String(node.attrs.class || '')
          .split(' ')
          .includes(className),
      ).length;

    expect(count(expanded, 'fkp_dashboard-page__outbound-grid')).toBe(1);
    expect(count(expanded, 'fkp_dashboard-page__outbound-grid__item')).toBe(2);
    expect(count(expanded, 'fkp_dashboard-page__subscription-meta')).toBe(1);

    expect(count(collapsed, 'fkp_dashboard-page__outbound-grid')).toBe(0);
    expect(count(collapsed, 'fkp_dashboard-page__outbound-grid__item')).toBe(0);
    expect(count(collapsed, 'fkp_dashboard-page__subscription-meta')).toBe(0);
    expect(
      findNode(collapsed, (node) =>
        String(node.attrs.class || '').includes(
          'fkp_dashboard-page__outbound-section__title-section__title',
        ),
      )?.children[0],
    ).toBe('Main');
    expect(
      findNode(collapsed, (node) =>
        String(node.attrs.class || '').includes(
          'dashboard-sections-grid-item-test-latency',
        ),
      ),
    ).toBeDefined();
  });
});

describe('renderSections header', () => {
  const node = (code: string, selected: boolean, latency = 0) => ({
    code,
    displayName: code.split('/')[1],
    latency,
    type: 'VLESS',
    selected,
  });

  async function current(
    section: Partial<Forkop.OutboundGroup>,
    collapsed = false,
  ) {
    installElementFactory();
    const { renderSections } = await import('../partials/renderSections');
    const root = renderSections({
      loading: false,
      failed: false,
      section: {
        code: 'main-out',
        sectionName: 'main',
        displayName: 'Main',
        withTagSelect: true,
        outbounds: [],
        ...section,
      },
      onTestLatency: vi.fn(),
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      latencyFetching: false,
      collapsible: true,
      collapsed,
    }) as unknown as FakeNode;
    const found = findNode(root, (candidate) =>
      String(candidate.attrs.class || '')
        .split(' ')
        .includes('fkp_dashboard-page__outbound-section__current'),
    );
    return found
      ? findNodes(found, () => true)
          .flatMap((candidate) =>
            candidate.children.filter(
              (child): child is string => typeof child === 'string',
            ),
          )
          .join(' ')
      : undefined;
  }

  it('names the node the section chose, with its latency', async () => {
    expect(
      await current({
        outbounds: [node('main/Node', false, 42), node('main/Other', true, 84)],
      }),
    ).toBe('Other 84ms');
    expect(
      await current({
        outbounds: [node('main/Node', true), node('main/Other', false)],
      }),
    ).toBe('Node');
  });

  it('leaves a section of one node to its card until it is folded', async () => {
    const outbounds = [node('main/Only', true, 30)];

    expect(await current({ outbounds })).toBeUndefined();
    expect(await current({ outbounds }, true)).toBe('Only 30ms');
  });

  it('says nothing for a section that has no choice to make', async () => {
    expect(
      await current({
        withTagSelect: false,
        outbounds: [node('main/Node', true, 42), node('main/Other', false)],
      }),
    ).toBeUndefined();
  });

  // Every section has the button, so its label repeated down the page; an icon
  // carries the name for a pointer and a screen reader instead.
  it('tests the section from an icon that carries its name', async () => {
    installElementFactory();
    const { renderSections } = await import('../partials/renderSections');
    const root = renderSections({
      loading: false,
      failed: false,
      section: {
        code: 'main-out',
        sectionName: 'main',
        displayName: 'Main',
        withTagSelect: true,
        outbounds: [node('main/Node', true)],
      },
      onTestLatency: vi.fn(),
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      latencyFetching: false,
    }) as unknown as FakeNode;
    const button = findNode(
      root,
      (candidate) =>
        candidate.type === 'button' &&
        String(candidate.attrs.class || '').includes(
          'dashboard-sections-grid-item-test-latency',
        ),
    );

    expect(button?.attrs['aria-label']).toBe('Test latency');
    expect(button?.attrs.title).toBe('Test latency');
    expect(
      findNodes(button as FakeNode, () => true).some((candidate) =>
        candidate.children.some((child) => typeof child === 'string'),
      ),
    ).toBe(false);
  });

  it('carries no refresh of its own, which the toolbar does for every section', async () => {
    installElementFactory();
    const { renderSections } = await import('../partials/renderSections');
    const root = renderSections({
      loading: false,
      failed: false,
      section: {
        code: 'main-out',
        sectionName: 'main',
        displayName: 'Main',
        withTagSelect: true,
        subscriptionSourceCount: 1,
        subscriptionProviderTags: ['main/sub1'],
        outbounds: [node('main/Node', true), node('main/Other', false)],
      },
      onTestLatency: vi.fn(),
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      latencyFetching: false,
    }) as unknown as FakeNode;
    const labels = findNodes(root, (candidate) => candidate.type === 'button')
      .map((button) =>
        String(button.attrs['aria-label'] || button.attrs.title || ''),
      )
      .filter(Boolean);

    expect(labels).not.toContain('Update subscriptions');
    expect(labels).not.toContain('Update lists');
  });

  async function header(
    props: Partial<{
      collapsible: boolean;
      collapsed: boolean;
      onCollapsedChange: (sectionName: string, collapsed: boolean) => void;
    }>,
  ) {
    installElementFactory();
    const { renderSections } = await import('../partials/renderSections');
    const root = renderSections({
      loading: false,
      failed: false,
      section: {
        code: 'main-out',
        sectionName: 'main',
        displayName: 'Main',
        withTagSelect: true,
        outbounds: [node('main/Node', true), node('main/Other', false)],
      },
      onTestLatency: vi.fn(),
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      latencyFetching: false,
      ...props,
    }) as unknown as FakeNode;
    return findNode(root, (candidate) =>
      String(candidate.attrs.class || '')
        .split(' ')
        .includes('fkp_dashboard-page__outbound-section__title-section'),
    ) as FakeNode;
  }

  function select(collapsed: boolean) {
    vi.stubGlobal('window', {
      getSelection: () => ({ isCollapsed: collapsed }),
    });
  }

  it('folds from anywhere on the header, not only from the chevron', async () => {
    const onCollapsedChange = vi.fn();
    select(true);

    (
      (await header({ collapsible: true, onCollapsedChange })).attrs
        .click as () => void
    )();
    (
      (await header({ collapsible: true, collapsed: true, onCollapsedChange }))
        .attrs.click as () => void
    )();

    expect(onCollapsedChange.mock.calls).toEqual([
      ['main', true],
      ['main', false],
    ]);
    expect(
      (await header({ collapsible: false, onCollapsedChange })).attrs.click,
    ).toBeUndefined();
  });

  it('leaves a click that ends a text selection alone', async () => {
    const onCollapsedChange = vi.fn();
    select(false);

    (
      (await header({ collapsible: true, onCollapsedChange })).attrs
        .click as () => void
    )();

    expect(onCollapsedChange).not.toHaveBeenCalled();
  });
});
