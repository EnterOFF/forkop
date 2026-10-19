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
