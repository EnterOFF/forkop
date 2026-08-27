// structuredClone is what the store copies its state with, and the browsers
// shipped on OpenWrt routers do not all have it. The polyfill therefore has to
// be installed before any module that uses it is evaluated - and in one bundle
// that means before the store service is constructed, which happens while its
// own module is being evaluated.
//
// Import order in an ES module is not the order of the statements around it:
// every import is hoisted and evaluated first, so the polyfill only wins by
// being an import of its own, placed first. This reads the built bundle because
// that is where the order is actually decided.
import fs from 'fs';

import { describe, expect, it } from 'vitest';

import { BUNDLE, SRC } from '../lib/paths.js';

const mainTs = fs.readFileSync(`${SRC}/main.ts`, 'utf8');
const bundle = fs.readFileSync(BUNDLE, 'utf8');

describe('main.ts', () => {
  it('loads the structuredClone polyfill as its first import', () => {
    expect(mainTs).toContain("import './helpers/structuredClonePolyfill';");
  });

  it('keeps the polyfill in its own module rather than after the imports', () => {
    expect(mainTs).not.toContain('globalThis.structuredClone');
  });
});

describe('the built bundle', () => {
  const lineOf = (needle) =>
    bundle.split('\n').findIndex((line) => line.includes(needle));

  it('contains the polyfill', () => {
    expect(lineOf('globalThis.structuredClone')).toBeGreaterThanOrEqual(0);
  });

  it('creates the store service', () => {
    expect(lineOf('new StoreService(')).toBeGreaterThanOrEqual(0);
  });

  it('runs the polyfill before the store service is created', () => {
    expect(lineOf('globalThis.structuredClone')).toBeLessThan(
      lineOf('new StoreService('),
    );
  });
});
