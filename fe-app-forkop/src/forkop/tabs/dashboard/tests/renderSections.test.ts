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

  it('tests all URLTest members without testing the whole section', async () => {
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

    expect(onTestOutboundLatency).toHaveBeenCalledWith('proxy_list', [
      'main/Node 1',
      'main/Node 2',
    ]);
  }, 15000);

  it('tests all fallback members without testing the whole section', async () => {
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
        latencyTestCodes: ['main/Node 1', 'main/Node 2', 'main/Other'],
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
                  levelIndex: 0,
                  levelName: 'Primary',
                },
                {
                  code: 'main/Node 2',
                  displayName: 'Node 2',
                  latency: 20,
                  type: 'VLESS',
                  selected: false,
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
    expect(onTestOutboundLatency).toHaveBeenCalledWith('proxy_list', [
      'main/Node 1',
      'main/Node 2',
    ]);
    expect(onTestLatency).not.toHaveBeenCalled();

    (sectionButton?.attrs.click as (event: MouseEvent) => void)(event);
    expect(onTestLatency).toHaveBeenCalledWith([
      'main/Node 1',
      'main/Node 2',
      'main/Other',
    ]);
  }, 15000);

  it('renders a rotating loader while an outbound latency test is running', async () => {
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
      onTestLatency: vi.fn(),
      onTestOutboundLatency: vi.fn(),
      onChooseOutbound: vi.fn(),
      onCopyOutbound: vi.fn(),
      onShowUrlTestInfo: vi.fn(),
      onShowFallbackInfo: vi.fn(),
      onUpdateSubscription: vi.fn(),
      latencyFetching: true,
      latencyProgress: {
        completed: 0,
        total: 1,
        failed: 0,
        pending: ['main/Node'],
      },
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
    const icon = buttons[0]?.children.find(
      (child): child is FakeNode =>
        typeof child !== 'string' &&
        String(child.attrs.class || '').includes('loader-circle'),
    );
    const otherIcon = buttons[1]?.children.find(
      (child): child is FakeNode =>
        typeof child !== 'string' &&
        String(child.attrs.class || '').includes('loader-circle'),
    );
    const sectionButton = findNode(
      root,
      (node) =>
        node.type === 'button' &&
        String(node.attrs.class || '') ===
          'btn dashboard-sections-grid-item-test-latency',
    );

    expect(buttons).toHaveLength(2);
    expect(icon).toBeDefined();
    expect(otherIcon).toBeUndefined();
    expect(
      sectionButton?.children.some(
        (child) =>
          typeof child !== 'string' &&
          String(child.attrs.class || '').includes('loader-circle'),
      ),
    ).toBe(true);
    expect(buttons[0]?.attrs['aria-busy']).toBe('true');
    expect(buttons[1]?.attrs['aria-busy']).toBeUndefined();
    expect(
      icon?.children.some(
        (child) =>
          typeof child !== 'string' && child.type === 'animateTransform',
      ),
    ).toBe(true);
  }, 15000);

  it('stops each tested node loader as its latency completes', async () => {
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
            code: 'main/Node 1',
            displayName: 'Node 1',
            latency: 10,
            type: 'VLESS',
            selected: false,
          },
          {
            code: 'main/Node 2',
            displayName: 'Node 2',
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
      latencyFetching: true,
      latencyProgress: {
        completed: 1,
        total: 2,
        failed: 0,
        pending: ['main/Node 2'],
      },
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

    expect(buttons[0]?.attrs['aria-busy']).toBeUndefined();
    expect(buttons[1]?.attrs['aria-busy']).toBe('true');
  }, 15000);

  it('animates a group card and its tested member cards', async () => {
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
      latencyFetching: true,
      latencyProgress: {
        completed: 0,
        total: 1,
        failed: 0,
        pending: ['main/Node'],
      },
      latencyFetchingTarget: JSON.stringify(['main/Node']),
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
    expect(
      buttons.every((button) => button.attrs['aria-busy'] === 'true'),
    ).toBe(true);
  }, 15000);

  it('animates only a single node card when that node belongs to a group', async () => {
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
      latencyFetching: true,
      latencyFetchingTarget: 'main/Node',
      latencyProgress: {
        completed: 0,
        total: 1,
        failed: 0,
        pending: ['main/Node'],
      },
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
    expect(buttons[0]?.attrs['aria-busy']).toBeUndefined();
    expect(buttons[1]?.attrs['aria-busy']).toBe('true');
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
