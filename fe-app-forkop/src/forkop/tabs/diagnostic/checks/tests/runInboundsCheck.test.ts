import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Forkop } from '../../../../types';

const mocks = vi.hoisted(() => ({
  checkInbounds: vi.fn(),
  updateCheckStore: vi.fn(),
}));

vi.mock('../../../../methods', () => ({
  ForkopShellMethods: { checkInbounds: mocks.checkInbounds },
}));
vi.mock('../updateCheckStore', () => ({
  updateCheckStore: mocks.updateCheckStore,
}));

import { runInboundsCheck } from '../runInboundsCheck';

const WAN = '100.116.152.154 2a00:1370:80ae:6686:5aea:1fff:fe08:5ebf';

const SERVER: Forkop.InboundCheckItem = {
  section: 'server_1',
  label: 'Server #1',
  protocol: 'vless',
  routing_mode: 'rules',
  tag: 'Server #1',
  listen: '::',
  listen_port: 35623,
  public_host: '2a00:1370:80ae:6599:5aea:1fff:fe08:5ebf',
  public_host_ips: '2a00:1370:80ae:6599:5aea:1fff:fe08:5ebf',
  expected_type: 'vless',
  required_proto: 'tcp',
  runtime_exists: 1,
  runtime_type: 'vless',
  runtime_listen: '::',
  runtime_port: 35623,
  runtime_ok: 1,
  listening: 1,
  firewall_required: 1,
  firewall_open: 1,
  port_conflict: 0,
  port_conflict_owners: '',
  routes_configured: 1,
  public_host_resolved: 1,
  public_host_public: 1,
  public_host_matches_wan: 1,
};

async function itemsFor(server: Partial<Forkop.InboundCheckItem>) {
  mocks.checkInbounds.mockResolvedValue({
    success: true,
    data: {
      enabled_count: 1,
      config_path: '',
      wan_ip: WAN,
      wan_public: 1,
      items: [{ ...SERVER, ...server }],
    },
  });
  await runInboundsCheck().catch(() => undefined);
  const { items } = mocks.updateCheckStore.mock.lastCall![0];
  return Object.fromEntries(
    items.map((item: { key: string; value: string }) => [item.key, item.value]),
  );
}

beforeEach(() => {
  mocks.checkInbounds.mockReset();
  mocks.updateCheckStore.mockReset();
});

// Every line of a server already starts with its name, and the WAN addresses
// have a line of their own, so a server's lines do not say either again.
describe('the inbound check', () => {
  it('names the protocol of an inbound tagged as its server', async () => {
    const items = await itemsFor({});

    expect(items['Server #1: Inbound created']).toBe('vless');
  });

  it('names the tag of an inbound tagged otherwise', async () => {
    const items = await itemsFor({ tag: 'server_1-in' });

    expect(items['Server #1: Inbound created']).toBe('server_1-in [vless]');
  });

  it('says a public address misses the WAN without listing the WAN again', async () => {
    const items = await itemsFor({ public_host_matches_wan: 0 });

    expect(items['WAN public IP']).toBe(WAN);
    expect(items['Server #1: Public address']).toBe(
      '2a00:1370:80ae:6599:5aea:1fff:fe08:5ebf (Does not match the WAN address)',
    );
  });
});
