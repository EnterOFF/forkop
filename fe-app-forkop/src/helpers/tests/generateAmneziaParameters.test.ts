import { describe, expect, it } from 'vitest';
import {
  AMNEZIA_KEYS,
  generateAmneziaParameters,
  parseRange,
  validateAmneziaSet,
  validateAmneziaValue,
} from '../wireguard';

const DRAWS = Array.from({ length: 300 }, () => generateAmneziaParameters());

function bounds(value: string) {
  const parts = value.split('-').map(Number);
  return [parts[0], parts[parts.length - 1]];
}

describe('a generated AmneziaWG parameter set', () => {
  it('names every parameter, each with a value the core takes', () => {
    for (const set of DRAWS) {
      expect(Object.keys(set).sort()).toEqual([...AMNEZIA_KEYS].sort());
      for (const key of AMNEZIA_KEYS) {
        expect(validateAmneziaValue(key, set[key]), `${key}=${set[key]}`).toBe(
          true,
        );
      }
      expect(validateAmneziaSet(set)).toBe(true);
    }
  });

  it('keeps the handshake packets apart and the headers off WireGuard types', () => {
    for (const set of DRAWS) {
      expect(Number(set.s1) + 56).not.toBe(Number(set.s2));
      const headers = ['h1', 'h2', 'h3', 'h4'].map((key) => Number(set[key]));
      expect(new Set(headers).size).toBe(4);
      for (const header of headers) {
        expect(header).toBeGreaterThanOrEqual(5);
        expect(header).toBeLessThanOrEqual(2147483647);
      }
    }
  });

  it('sends a DNS query of its own as the signature packet', () => {
    for (const set of DRAWS) {
      const match = /^<r 2><b 0x((?:[0-9a-f]{2})+)>$/u.exec(set.i1);
      expect(match, set.i1).not.toBeNull();
      const bytes = Uint8Array.from(
        match![1].match(/../gu)!.map((byte) => parseInt(byte, 16)),
      );
      expect([...bytes.subarray(0, 10)]).toEqual([
        1, 0, 0, 1, 0, 0, 0, 0, 0, 0,
      ]);
      const labels: string[] = [];
      let offset = 10;
      while (bytes[offset] !== 0) {
        const length = bytes[offset];
        expect(length).toBeLessThanOrEqual(63);
        labels.push(
          String.fromCharCode(
            ...bytes.subarray(offset + 1, offset + 1 + length),
          ),
        );
        offset += 1 + length;
      }
      expect(labels.length).toBeGreaterThanOrEqual(2);
      for (const label of labels) expect(label).toMatch(/^[a-z0-9-]+$/u);
      expect([...bytes.subarray(offset)]).toEqual([0, 0, 1, 0, 1]);
    }
    expect(new Set(DRAWS.map((set) => set.i1)).size).toBeGreaterThan(1);
  });

  it('rekeys before the earliest rejection', () => {
    for (const set of DRAWS) {
      expect(parseRange(set.rekey_after_time)).toBeDefined();
      expect(bounds(set.rekey_after_time)[1] + 30).toBeLessThanOrEqual(
        bounds(set.reject_after_time)[0],
      );
    }
  });

  it('draws another set every time', () => {
    expect(new Set(DRAWS.map((set) => set.header_protection_key)).size).toBe(
      DRAWS.length,
    );
  });
});
