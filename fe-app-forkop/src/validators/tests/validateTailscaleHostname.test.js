import { describe, expect, it } from 'vitest';
import { validateTailscaleHostname } from '../validateTailscaleHostname';

describe('validateTailscaleHostname', () => {
  it('accepts a DNS label and rejects what Tailscale would rewrite', () => {
    expect(validateTailscaleHostname('forkop-home')).toBe(true);
    expect(validateTailscaleHostname(' forkop-home ')).toBe(true);
    expect(validateTailscaleHostname('Forkop_Home')).toMatch(/a-z, 0-9/);
    expect(validateTailscaleHostname('мой-роутер')).toMatch(/a-z, 0-9/);
    expect(validateTailscaleHostname('-home')).toMatch(/a-z, 0-9/);
    expect(validateTailscaleHostname('a'.repeat(64))).toMatch(/63/);
    expect(validateTailscaleHostname('')).toBe('Required');
  });
});
