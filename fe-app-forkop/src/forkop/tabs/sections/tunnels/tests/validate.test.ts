import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let validate: typeof import('../validate').validateTunnelSettings;
let endpointFromSettings: typeof import('../model').tunnelEndpointFromSettings;
beforeAll(async () => {
  vi.stubGlobal('_', (text: string) => text);
  vi.stubGlobal('L', { toArray: (value: unknown) => value || [] });
  validate = (await import('../validate')).validateTunnelSettings;
  endpointFromSettings = (await import('../model')).tunnelEndpointFromSettings;
});
afterAll(() => vi.unstubAllGlobals());

describe('AmneziaWG header protection', () => {
  const settings = {
    tunnel_type: 'amneziawg',
    name: 'AWG',
    address: ['10.0.0.2/32'],
    private_key: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
    amnezia_header_protection_key:
      'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
    amnezia_s1: '12',
    amnezia_s2: '12',
    amnezia_s3: '12',
    amnezia_s4: '12',
  };
  it('checks every padding against the core nonce size before saving', () => {
    for (const key of ['s1', 's2', 's3', 's4']) {
      for (const value of ['', '11'])
        expect(validate({ ...settings, [`amnezia_${key}`]: value })).toBe(
          'Header protection requires S1, S2, S3 and S4 of at least 12 bytes',
        );
    }
    expect(validate(settings)).toBe('Add at least one WireGuard peer');
  });
  it('allows zero padding with the disabled all-zero key', () => {
    expect(
      validate({
        ...settings,
        amnezia_s3: '0',
        amnezia_header_protection_key:
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      }),
    ).toBe('Add at least one WireGuard peer');
  });
  it('passes AmneziaWG 3.1 flags as booleans to the core', () => {
    expect(
      endpointFromSettings({
        ...settings,
        peer_ids: [],
        amnezia_random_trailers: '1',
        amnezia_disable_cookies: '0',
      })?.amnezia,
    ).toMatchObject({ random_trailers: true, disable_cookies: false });
  });
});

it.each(['wireguard', 'warp'])(
  'passes DisableCookies to %s without random trailers',
  (kind) => {
    const endpoint = endpointFromSettings({
      tunnel_type: kind,
      name: kind,
      address: ['10.0.0.2/32'],
      private_key: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
      peer_ids: [],
      amnezia_enabled: '1',
      amnezia_disable_cookies: '1',
      amnezia_random_trailers: '1',
    });
    expect(endpoint?.amnezia).toMatchObject({ disable_cookies: true });
    expect(endpoint?.amnezia).not.toHaveProperty('random_trailers');
  },
);

describe('a Tailscale tunnel', () => {
  const settings = {
    tunnel_type: 'tailscale',
    name: 'Tailnet',
    tailscale_auth_key: 'tskey-auth-test',
    tailscale_hostname: 'forkop-router',
    tailscale_control_url: 'https://controlplane.tailscale.com',
    tailscale_accept_routes: '1',
  };
  it('saves without an exit node and asks the core for none', () => {
    expect(validate(settings)).toBe(true);
    const endpoint = endpointFromSettings(settings);
    expect(endpoint).not.toHaveProperty('exit_node');
    expect(endpoint).not.toHaveProperty('exit_node_allow_lan_access');
  });
  it('keeps the LAN reachable while an exit node carries the rest', () => {
    expect(
      endpointFromSettings({ ...settings, tailscale_exit_node: '100.64.0.1' }),
    ).toMatchObject({
      exit_node: '100.64.0.1',
      exit_node_allow_lan_access: true,
    });
  });
  it('still refuses a tunnel without an auth key', () => {
    expect(validate({ ...settings, tailscale_auth_key: '' })).toBe(
      'Enter a Tailscale auth key',
    );
  });
  it('refuses a device name Tailscale would register differently', () => {
    expect(validate({ ...settings, tailscale_hostname: 'My Router' })).toBe(
      'Use lowercase letters, digits and hyphens',
    );
  });
});

describe('a JSON endpoint', () => {
  const json = (endpoint: unknown) => ({
    tunnel_type: 'json',
    endpoint_json: JSON.stringify(endpoint),
  });
  // What the endpoint holds is sing-box's to judge, so a type this Forkop does
  // not know is handed to the core, which says in its log what it refuses.
  it('takes any object that carries a tag', () => {
    expect(
      validate(json({ type: 'a-type-from-a-newer-core', tag: 'new' })),
    ).toBe(true);
    expect(validate(json({ tag: 'typeless' }))).toBe(true);
  });
  it('refuses an endpoint without a tag or one that is not an object', () => {
    expect(validate(json({ type: 'wireguard' }))).toBe(
      'JSON endpoint must contain a non-empty tag',
    );
    expect(validate({ tunnel_type: 'json', endpoint_json: '[]' })).toBe(
      'Enter a valid JSON endpoint object',
    );
  });
});

// sing-box's check passes both, and the whole service then fails to start on
// the endpoint: the device refuses headers that overlap, a header it is not
// given being the WireGuard type number it keeps.
describe('AmneziaWG parameters that only fail together', () => {
  const settings = {
    tunnel_type: 'amneziawg',
    name: 'AWG',
    address: ['10.0.0.2/32'],
    private_key: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
  };
  const PEERLESS = 'Add at least one WireGuard peer';
  it('refuses headers that overlap, the device defaults included', () => {
    expect(
      validate({ ...settings, amnezia_h1: '100-200', amnezia_h2: '150' }),
    ).toBe('H1, H2, H3 and H4 must not overlap');
    expect(validate({ ...settings, amnezia_h1: '2' })).toBe(
      'H1, H2, H3 and H4 must not overlap',
    );
    expect(validate({ ...settings, amnezia_h1: '1' })).toBe(PEERLESS);
    expect(
      validate({
        ...settings,
        amnezia_h1: '100-200',
        amnezia_h2: '201',
        amnezia_h3: '300-400',
        amnezia_h4: '5',
      }),
    ).toBe(PEERLESS);
  });
  it.each(['amneziawg', 'wireguard'])(
    'refuses a junk minimum above its maximum on %s',
    (kind) => {
      const junk = {
        ...settings,
        tunnel_type: kind,
        amnezia_enabled: '1',
        amnezia_jmin: '60',
      };
      expect(validate({ ...junk, amnezia_jmax: '10' })).toBe(
        'Jmin must not be greater than Jmax',
      );
      expect(validate(junk)).toBe('Jmin must not be greater than Jmax');
      expect(validate({ ...junk, amnezia_jmax: '60' })).toBe(PEERLESS);
    },
  );
});

// The fields refuse these by their datatypes as they are typed; a tunnel the
// dialog did not write is checked by the same rules the router applies.
describe('a stored tunnel the dialog did not write', () => {
  const wireguard = {
    tunnel_type: 'wireguard',
    name: 'Plain',
    address: ['10.0.0.2/32'],
    private_key: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
  };
  const warp = {
    tunnel_type: 'warp',
    name: 'WARP',
    warp_profile_id: 'id',
    warp_auth_token: 'token',
    warp_private_key: 'key',
  };
  it('refuses a listen port or an MTU the core cannot read', () => {
    for (const value of ['65536', 'abc']) {
      expect(validate({ ...wireguard, listen_port: value })).toBe(
        'Enter a valid listen port',
      );
      expect(validate({ ...wireguard, mtu: value })).toBe(
        'Enter an MTU from 1 to 65535',
      );
    }
    expect(validate({ ...wireguard, mtu: '0' })).toBe(
      'Enter an MTU from 1 to 65535',
    );
    expect(validate({ ...wireguard, listen_port: '0', mtu: '1280' })).toBe(
      'Add at least one WireGuard peer',
    );
  });
  it('refuses a WARP server or keepalive the core cannot use', () => {
    expect(validate(warp)).toBe(true);
    expect(validate({ ...warp, warp_address: 'not a host' })).toBe(
      'Enter a valid server address',
    );
    for (const address of [
      'engage.cloudflareclient.com',
      '2606:4700:d0::a29f:c001',
    ])
      expect(validate({ ...warp, warp_address: address })).toBe(true);
    expect(validate({ ...warp, warp_port: '70000' })).toBe(
      'Enter a valid server port',
    );
    expect(validate({ ...warp, warp_keepalive: '25-5' })).toBe(
      'AmneziaWG ranges must be between 0 and 4294967295 with the start no greater than the end',
    );
  });
});
