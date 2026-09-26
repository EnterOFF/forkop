import { describe, expect, it } from 'vitest';
import { validateTailscaleHostname } from '../validateTailscaleHostname';

describe('validateTailscaleHostname', () => {
  it('accepts a DNS label and rejects what Tailscale would rewrite', () => {
    expect(validateTailscaleHostname('forkop-home')).toBe(true);
    expect(validateTailscaleHostname(' forkop-home ')).toBe(true);
    expect(validateTailscaleHostname('Forkop_Home')).toMatch(/lowercase/);
    expect(validateTailscaleHostname('мой-роутер')).toMatch(/lowercase/);
    expect(validateTailscaleHostname('-home')).toMatch(/lowercase/);
    expect(validateTailscaleHostname('a'.repeat(64))).toMatch(/63/);
    expect(validateTailscaleHostname('')).toMatch(/required/);
  });
});
