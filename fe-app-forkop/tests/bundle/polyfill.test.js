// structuredClone is what the store copies its state with, and the browsers
// some routers ship do not have it. The bundle installs a fallback, and it has
// to do so before the store service is created, which happens while the
// service's own module is being evaluated.
import { afterEach, expect, it } from 'vitest';

import { loadBundle } from '../lib/bundle.js';

const native = globalThis.structuredClone;

afterEach(() => {
  globalThis.structuredClone = native;
});

it('loads in a browser without structuredClone', () => {
  delete globalThis.structuredClone;
  expect(() => loadBundle()).not.toThrow();
  expect(globalThis.structuredClone({ a: [1] })).toEqual({ a: [1] });
});
