import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ONE_SIDED_AMNEZIA_KEYS } from '../../../../../helpers/wireguard';

// Traffic obfuscation on a WireGuard or WARP tunnel sends Amnezia's junk and
// signature packets from this side only, so it may carry just the parameters a
// plain peer never has to match; the header sizes and magic headers of an
// AmneziaWG tunnel have to be the server's own.

let model: typeof import('../model');
beforeAll(async () => {
  vi.stubGlobal('_', (text: string) => text);
  vi.stubGlobal('L', { toArray: (value: unknown) => value || [] });
  model = await import('../model');
});
afterAll(() => vi.unstubAllGlobals());

const AMNEZIA = {
  amnezia_jc: '4',
  amnezia_jmin: '10',
  amnezia_i1: '<r 2>',
  amnezia_s1: '12',
  amnezia_h1: '100-200',
};

const WIREGUARD = {
  tunnel_type: 'wireguard',
  address: ['10.0.0.2/32'],
  private_key: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
  ...AMNEZIA,
};

describe('an endpoint built from the dialog', () => {
  it.each([
    ['wireguard', WIREGUARD],
    ['warp', { tunnel_type: 'warp', ...AMNEZIA }],
  ])(
    'of a %s tunnel carries the one-sided parameters while obfuscation is on',
    (kind, settings) => {
      const on = model.tunnelEndpointFromSettings({
        ...settings,
        amnezia_enabled: '1',
      });
      expect(on?.type).toBe(kind);
      expect(on?.amnezia).toEqual({ jc: 4, jmin: 10, i1: '<r 2>' });

      const off = model.tunnelEndpointFromSettings({
        ...settings,
        amnezia_enabled: '0',
      });
      expect(off?.amnezia).toBeUndefined();
    },
  );

  it('of an AmneziaWG tunnel carries every parameter the server set', () => {
    const endpoint = model.tunnelEndpointFromSettings({
      ...WIREGUARD,
      tunnel_type: 'amneziawg',
    });
    expect(endpoint?.amnezia).toEqual({
      jc: 4,
      jmin: 10,
      i1: '<r 2>',
      s1: 12,
      h1: '100-200',
    });
  });
});

describe('a tunnel as it is stored', () => {
  it('keeps the one-sided parameters only while obfuscation is on, and not the switch', () => {
    const on = model.tunnelStorageSettings({
      ...WIREGUARD,
      amnezia_enabled: '1',
    });
    expect([
      on.amnezia_jc,
      on.amnezia_i1,
      on.amnezia_s1,
      on.amnezia_h1,
    ]).toEqual(['4', '<r 2>', '', '']);
    expect(on).not.toHaveProperty('amnezia_enabled');

    const off = model.tunnelStorageSettings({
      ...WIREGUARD,
      amnezia_enabled: '0',
    });
    expect(off.amnezia_jc).toBe('');
  });

  it('keeps every parameter of an AmneziaWG tunnel', () => {
    const stored = model.tunnelStorageSettings({
      ...WIREGUARD,
      tunnel_type: 'amneziawg',
    });
    expect([stored.amnezia_jc, stored.amnezia_s1, stored.amnezia_h1]).toEqual([
      '4',
      '12',
      '100-200',
    ]);
  });
});

describe("the switch for the server's DNS", () => {
  it.each(['openconnect', 'openvpn-client', 'tailscale'])(
    'is stored for a %s tunnel, on unless turned off',
    (kind) => {
      expect(
        model.tunnelStorageSettings({ tunnel_type: kind }).accept_server_dns,
      ).toBe('1');
      expect(
        model.tunnelStorageSettings({
          tunnel_type: kind,
          accept_server_dns: '0',
        }).accept_server_dns,
      ).toBe('0');
    },
  );

  it('is not stored for a tunnel whose server declares no names', () => {
    expect(
      model.tunnelStorageSettings({ ...WIREGUARD, accept_server_dns: '1' })
        .accept_server_dns,
    ).toBe('');
  });
});

describe('turning obfuscation on', () => {
  function dialog(values: Record<string, string>) {
    const data: Record<string, unknown> = {};
    const map = {
      config: 'tunnel',
      data: {
        get: (_config: string, _section: string, key: string) => data[key],
        set: (
          _config: string,
          _section: string,
          key: string,
          value: unknown,
        ) => {
          data[key] = value;
        },
      },
    };
    const options = Object.fromEntries(
      ONE_SIDED_AMNEZIA_KEYS.map((key) => [
        key,
        { option: `amnezia_${key}`, formvalue: () => values[key] ?? null },
      ]),
    );
    return { map, options, data };
  }

  it('fills the parameters it may choose and leaves what is already there', () => {
    const { map, options, data } = dialog({ jc: '7' });
    model.fillOneSidedAmneziaDefaults(
      map as unknown as CBIMap,
      options as unknown as Record<string, CBIOption>,
    );
    expect(data.amnezia_jc).toBeUndefined();
    expect(data.amnezia_jmin).toBe('10');
    expect(data.amnezia_rekey_timeout).toBe('3-7');
    expect(Object.keys(data)).not.toContain('amnezia_s1');
  });
});
