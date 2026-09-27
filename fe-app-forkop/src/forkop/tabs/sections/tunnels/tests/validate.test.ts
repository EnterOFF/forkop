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
      wireguard_junk_enabled: '1',
      warp_junk_enabled: '1',
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
