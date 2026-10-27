import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  getClashApiTailscale: vi.fn(),
  getConfigSections: vi.fn(),
}));
vi.mock('../../../../methods', () => ({
  CustomForkopMethods: {
    getClashApiTailscale: mocks.getClashApiTailscale,
    getConfigSections: mocks.getConfigSections,
  },
}));

// The core runs the tunnel as vpn/tail.
const applied = [
  { '.type': 'section', '.name': 'section_1', label: 'vpn' },
  {
    '.type': 'tunnel',
    '.name': 'tunnel_1',
    section: 'section_1',
    name: 'tail',
  },
];

let module: typeof import('../exitNodes');
beforeAll(async () => {
  vi.stubGlobal('_', (text: string) => text);
  // The session's view, with the section renamed and not applied yet.
  vi.stubGlobal('uci', { get: () => 'renamed' });
  vi.stubGlobal('form', {
    Value: {
      prototype: {
        renderWidget(this: { keylist: string[] }) {
          return this.keylist.length ? 'combobox' : 'textfield';
        },
      },
    },
  });
  module = await import('../exitNodes');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  mocks.getConfigSections.mockResolvedValue(applied);
});

const peer = (name: string, online: boolean, exitNodeOption = true) => ({
  name,
  addresses: [],
  online,
  exitNodeOption,
});

function respond(endpoints: object[]) {
  mocks.getClashApiTailscale.mockResolvedValue({
    success: true,
    data: { endpoints },
  });
}

const running = (tag: string, peers: ReturnType<typeof peer>[]) => ({
  tag,
  state: 'Running',
  connected: true,
  addresses: [],
  advertisesExitNode: false,
  exitNodeApproved: false,
  routes: [],
  health: [],
  peers,
});

// The option as the dialog builds it, rendered for a Tailscale tunnel.
async function rendered(tunnelId = 'tunnel_1') {
  const option = {
    value(this: { keylist: string[] }, key: string) {
      this.keylist.push(key);
    },
  } as unknown as CBIOption & { keylist: string[]; description: string };
  module.offerTailscaleExitNodes(option, 'section_1', tunnelId, {
    tunnel_type: 'tailscale',
  });
  const widget = await option.renderWidget('settings', '0', '');
  return { widget, keys: option.keylist, description: option.description };
}

describe('the exit node field of a Tailscale tunnel', () => {
  it('offers the approved exit nodes of the running tunnel, online first, by its applied names', async () => {
    respond([
      running('vpn/tail', [
        peer('zeta', true),
        peer('alpha', false),
        peer('beta', true),
        peer('phone', true, false),
      ]),
    ]);
    expect(await rendered()).toEqual({
      widget: 'combobox',
      keys: ['beta', 'zeta', 'alpha'],
      description:
        'The device internet traffic leaves through. Without one, only tailnet devices and the subnets they share are reachable',
    });
  });

  it('is a plain field until the tunnel itself is connected', async () => {
    const waiting =
      'IP address or name of the device. Once the tunnel connects, the devices of its tailnet are offered here';
    respond([running('Server #1', [peer('home', true)])]);
    expect(await rendered()).toEqual({
      widget: 'textfield',
      keys: [],
      description: waiting,
    });
    respond([running('vpn/tail', [peer('home', true)])]);
    expect((await rendered('tunnel_new')).description).toBe(waiting);
    mocks.getConfigSections.mockRejectedValue(new Error('timed out'));
    expect((await rendered()).description).toBe(waiting);
    mocks.getClashApiTailscale.mockResolvedValue({
      success: false,
      error: 'x',
    });
    expect((await rendered()).widget).toBe('textfield');
  });

  it('names what keeps a running tunnel out of its tailnet', async () => {
    respond([
      { ...running('vpn/tail', []), state: 'NeedsLogin', connected: false },
    ]);
    expect(await rendered()).toEqual({
      widget: 'textfield',
      keys: [],
      description:
        'IP address or name of the device. The tunnel is not signed in to its tailnet: check the authorization key',
    });
    respond([{ ...running('vpn/tail', []), connected: false }]);
    expect((await rendered()).description).toBe(
      'IP address or name of the device. The tunnel has no connection to the coordination server',
    );
  });

  it('says so when the tailnet approved no exit node', async () => {
    respond([running('vpn/tail', [peer('phone', true, false)])]);
    expect(await rendered()).toEqual({
      widget: 'textfield',
      keys: [],
      description: 'No device of the tailnet is approved as an exit node',
    });
  });
});
