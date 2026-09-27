import { describe, expect, it } from 'vitest';

import { subscriptionTags } from '../subscriptionTags';

// The Dashboard finds a subscription's provider by the name the backend gave it,
// so the two have to name an untagged subscription the same way.
describe('the name a subscription runs under', () => {
  it('is its stored tag', () => {
    expect(subscriptionTags(['main', ' spare '])).toEqual(['main', 'spare']);
  });

  it('is its position when it has none', () => {
    expect(subscriptionTags(['', null, undefined])).toEqual([
      'sub1',
      'sub2',
      'sub3',
    ]);
  });

  it('moves past a number another subscription is tagged with', () => {
    expect(subscriptionTags(['', 'sub1'])).toEqual(['sub2', 'sub1']);
    expect(subscriptionTags(['sub2', '', ''])).toEqual([
      'sub2',
      'sub3',
      'sub4',
    ]);
  });
});
