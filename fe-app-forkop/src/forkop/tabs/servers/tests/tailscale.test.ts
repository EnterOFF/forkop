import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../methods', () => ({ CustomForkopMethods: {} }));
vi.mock('../details', () => ({
  iconSvg: () => ({ tag: 'svg', attrs: {}, children: [] }),
  injectDetailsStyles: () => {},
  renderCloseRow: () => ({ tag: 'div', attrs: {}, children: [] }),
  copyWithToast: () => {},
}));

interface Tree {
  tag: string;
  attrs: Record<string, string>;
  children: unknown;
}

let render: typeof import('../tailscale').renderTailscaleContent;
const options: Record<string, string> = {};
beforeAll(async () => {
  vi.stubGlobal('_', (text: string) => text);
  vi.stubGlobal('E', (tag: string, attrs: unknown, children: unknown) => ({
    tag,
    attrs: attrs || {},
    children,
  }));
  vi.stubGlobal('uci', {
    get: (_config: string, _section: string, name: string) => options[name],
  });
  vi.stubGlobal('document', { documentElement: { lang: 'en' } });
  ({ renderTailscaleContent: render } = await import('../tailscale'));
});
afterAll(() => vi.unstubAllGlobals());

// String.prototype.format as LuCI adds it.
Object.defineProperty(String.prototype, 'format', {
  configurable: true,
  value(this: string, ...args: unknown[]) {
    let index = 0;
    return this.replace(/%[sd]/g, () => String(args[index++]));
  },
});

function texts(node: unknown): string[] {
  if (node == null) {
    return [];
  }
  if (typeof node === 'string') {
    return [node];
  }
  if (Array.isArray(node)) {
    return node.flatMap(texts);
  }
  return texts((node as Tree).children);
}

function stateClasses(node: unknown): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(stateClasses);
  }
  if (!node || typeof node !== 'object') {
    return [];
  }
  const tree = node as Tree;
  const own = /fkp-ts--(\w+)/.exec(tree.attrs.class || '');
  return [
    ...(own ? [`${own[1]}:${texts(tree.children).join('')}`] : []),
    ...stateClasses(tree.children),
  ];
}

const endpoint = (fields: object) => ({
  tag: 'Server #1',
  state: 'Running',
  connected: true,
  addresses: ['100.64.0.1'],
  advertisesExitNode: true,
  exitNodeApproved: true,
  routes: [],
  health: [],
  peers: [],
  ...fields,
});

describe('the Tailscale server dialog', () => {
  it('tells a live session from one the coordination server lost', () => {
    expect(stateClasses(render('srv', { endpoint: endpoint({}) }))).toContain(
      'ok:Online',
    );
    expect(
      stateClasses(render('srv', { endpoint: endpoint({ connected: false }) })),
    ).toContain('error:No connection to the coordination server');
  });

  it('offers the sign-in link while the device waits for it', () => {
    const content = render('srv', {
      endpoint: endpoint({
        state: 'NeedsLogin',
        authURL: 'https://login.tailscale.com/a/1',
      }),
    });
    expect(stateClasses(content)).toContain('warn:Waiting for sign-in');
    expect(texts(content)).toContain('Sign in');
  });

  it('names the device as the tailnet does, its addresses on one line', () => {
    const lines = texts(
      render('srv', {
        endpoint: endpoint({
          name: 'forkop-3',
          addresses: ['100.64.0.1', 'fd7a::1'],
        }),
      }),
    );
    expect(lines).toContain('forkop-3');
    expect(lines).toEqual(expect.arrayContaining(['100.64.0.1', 'fd7a::1']));
  });

  it('says when a device was last online', () => {
    const peer = { name: 'phone', addresses: [], exitNodeOption: false };
    const states = (fields: object) =>
      stateClasses(
        render('srv', {
          endpoint: endpoint({ peers: [{ ...peer, ...fields }] }),
        }),
      );
    expect(states({ online: true })).toContain('ok:Online now');
    expect(states({ online: false })).toContain('muted:Offline');
    expect(
      states({ online: false, lastSeen: Date.now() / 1000 - 7200 }),
    ).toContain('muted:Offline, seen 2 hours ago');
  });

  it('marks the exit node and each route by their approval', () => {
    const states = stateClasses(
      render('srv', {
        endpoint: endpoint({
          exitNodeApproved: false,
          routes: [
            { prefix: '192.168.1.0/24', approved: true },
            { prefix: '10.0.0.0/8', approved: false },
          ],
        }),
      }),
    );
    expect(states).toEqual([
      'ok:Online',
      'warn:Waiting for approval in the console',
      'ok:Approved',
      'warn:Waiting for approval in the console',
      'muted:Does not expire',
    ]);
  });

  it('explains a server the core does not run', () => {
    expect(texts(render('srv', {}))).toEqual([
      'The server is not running yet. Apply the settings, or start Forkop.',
    ]);
    options.enabled = '0';
    expect(texts(render('srv', {}))).toEqual(['The server is disabled.']);
    delete options.enabled;
    expect(texts(render('srv', { error: 'timeout' }))).toEqual([
      'Failed to get the Tailscale state: timeout',
    ]);
  });
});
