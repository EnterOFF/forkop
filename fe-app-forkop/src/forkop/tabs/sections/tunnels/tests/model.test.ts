import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ONE_SIDED_AMNEZIA_KEYS } from '../../../../../helpers/wireguard';

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

describe('the obfuscation generate button', () => {
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

  it('replaces every parameter the tunnel sends and nothing else', () => {
    const { map, options, data } = dialog({ jc: '7', i2: '<r 4>' });
    model.fillGeneratedOneSidedAmnezia(
      map as unknown as CBIMap,
      options as unknown as Record<string, CBIOption>,
    );
    expect(Object.keys(data).sort()).toEqual(
      ONE_SIDED_AMNEZIA_KEYS.map((key) => `amnezia_${key}`).sort(),
    );
    expect(data.amnezia_jc).toMatch(/^[3-6]$/u);
    expect(data.amnezia_i1).toMatch(/^<r 2><b 0x0100[0-9a-f]+>$/u);
    expect(data.amnezia_i2).toBe('');
  });
});
