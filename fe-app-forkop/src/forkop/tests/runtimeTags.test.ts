import { describe, expect, it } from 'vitest';

import { getOutboundTagBySection } from '../runtimeTags';

describe('runtimeTags', () => {
  it('uses the displayed section name as the selector tag', () => {
    expect(getOutboundTagBySection('Proxy')).toBe('Proxy');
    expect(getOutboundTagBySection('direct')).toBe('direct');
  });
});
