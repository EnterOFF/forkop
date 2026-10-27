import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  protocol: 'wireguard',
}));

vi.mock('../protocols', () => ({
  getProtocol: () => mocks.protocol,
  getServerName: () => 'Server #1',
  isAuthenticationEnabled: () => true,
  usesProfile: (protocol: string) => protocol !== 'vless',
}));
vi.mock('../profile', () => ({
  buildClientProfile: () => ({
    profile: '[Interface]\nPrivateKey = x\n',
    fileName: 'user-am2ra.conf',
    type: 'text/plain',
  }),
}));
vi.mock('../links', () => ({
  buildClientLinks: () => [{ title: '', link: 'vless://id@example.com:443' }],
  hasRequiredCredentials: () => true,
  loadLinkContext: async () => ({}),
}));
vi.mock('../network', () => ({
  getListenPort: () => '443',
  getPublicHost: () => 'example.com',
}));
vi.mock('../issued', () => ({ loadIssuedMaterial: async () => ({}) }));
vi.mock('../../../../helpers/showToast', () => ({ showToast: vi.fn() }));

interface FakeNode {
  type: string;
  attrs: Record<string, unknown>;
  children: Array<FakeNode | string>;
  appendChild(child: FakeNode): void;
  setAttribute(name: string, value: string): void;
  addEventListener(): void;
}

function fakeNode(type: string, attrs: unknown, children?: unknown): FakeNode {
  return {
    type,
    attrs: (attrs || {}) as Record<string, unknown>,
    children:
      children === undefined
        ? []
        : Array.isArray(children)
          ? (children as Array<FakeNode | string>)
          : [children as FakeNode | string],
    appendChild(child) {
      this.children.push(child);
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    addEventListener() {},
  };
}

function findAll(
  node: FakeNode | string,
  predicate: (candidate: FakeNode) => boolean,
): FakeNode[] {
  if (typeof node === 'string') {
    return [];
  }
  return [
    ...(predicate(node) ? [node] : []),
    ...node.children.flatMap((child) => findAll(child, predicate)),
  ];
}

const hasClass = (className: string) => (node: FakeNode) =>
  String(node.attrs.class || '')
    .split(' ')
    .includes(className);

function textOf(node: FakeNode | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

async function renderClient() {
  const { renderDetailsContent } = await import('../details');
  return renderDetailsContent(
    'server1',
    [
      {
        id: 'c1',
        name: 'user-am2ra',
        uuid: 'id',
        password: '',
        flow: '',
      } as ServerClient,
    ],
    {} as ShareLinkContext,
  ) as unknown as FakeNode;
}

beforeEach(() => {
  (globalThis as unknown as { E: unknown }).E = fakeNode;
  vi.stubGlobal('document', {
    createElementNS: (_namespace: string, type: string) => fakeNode(type, {}),
  });
});

describe('the server details', () => {
  it('shows a profile as its file, not as a field to read', async () => {
    mocks.protocol = 'wireguard';
    const root = await renderClient();

    expect(findAll(root, (node) => node.type === 'input')).toEqual([]);
    expect(textOf(findAll(root, hasClass('fkp-details__file'))[0])).toBe(
      'user-am2ra.conf',
    );
  });

  it('keeps a link in a field, where it can be read and selected', async () => {
    mocks.protocol = 'vless';
    const root = await renderClient();
    const inputs = findAll(root, (node) => node.type === 'input');

    expect(inputs.map((input) => input.attrs.value)).toEqual([
      'vless://id@example.com:443',
    ]);
    expect(findAll(root, hasClass('fkp-details__file'))).toEqual([]);
  });
});
