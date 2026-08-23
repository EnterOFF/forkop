import { describe, expect, it } from 'vitest';
import { generateAmneziaParameters } from '../generateAmneziaParameters';
import {
  parseWireGuardConfig,
  validateAmneziaSignature,
} from '../parseWireGuardConfig';

const PRIVATE_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const PUBLIC_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';

// Two-sided parameters have to match the server, so a client may not invent
// them. The generated set is the complement of this list.
const TWO_SIDED = [
  's1',
  's2',
  's3',
  's4',
  'h1',
  'h2',
  'h3',
  'h4',
  'header_protection_key',
];

describe('generateAmneziaParameters', () => {
  it('fills every one-sided field and no other', () => {
    const generated = generateAmneziaParameters();
    expect(Object.keys(generated).sort()).toEqual([
      'content_padding_addition',
      'i1',
      'i2',
      'i3',
      'i4',
      'i5',
      'jc',
      'jmax',
      'jmin',
      'keepalive_timeout',
      'max_handshake_attempts',
      'reject_after_time',
      'rekey_after_time',
      'rekey_timeout',
    ]);
    for (const key of TWO_SIDED) {
      expect(generated[key]).toBeUndefined();
    }
  });

  it('keeps the junk count inside the range the Amnezia client uses', () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const count = Number(generateAmneziaParameters().jc);
      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThanOrEqual(4);
      expect(count).toBeLessThanOrEqual(6);
    }
  });

  it('produces values the parser and the core accept', () => {
    const generated = generateAmneziaParameters();
    expect(validateAmneziaSignature(generated.i1)).toBe(true);

    const lines = Object.entries(generated)
      .filter(([, value]) => value !== '')
      .map(([key, value]) => `${key} = ${value}`)
      .join('\n');
    const result = parseWireGuardConfig(`[Interface]
PrivateKey = ${PRIVATE_KEY}
Address = 10.0.0.2/32
${lines}
[Peer]
PublicKey = ${PUBLIC_KEY}
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0`);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.endpoint.amnezia).toMatchObject({
      jmin: 10,
      jmax: 50,
      content_padding_addition: '10-100',
      max_handshake_attempts: '15-20',
    });
  });
});
