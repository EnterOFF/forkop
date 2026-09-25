import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let validate: typeof import('../../src/forkop/tabs/sections/tunnels/validate').validateTunnelSettings;
beforeAll(async () => {
  vi.stubGlobal('_', (text: string) => text);
  vi.stubGlobal('L', { toArray: (value: unknown) => value || [] });
  validate = (await import('../../src/forkop/tabs/sections/tunnels/validate'))
    .validateTunnelSettings;
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
});
