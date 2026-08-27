import { beforeEach, describe, expect, it, vi } from 'vitest';

// What removing a section takes with it, and what refuses to save one, are the
// two things this wrapper adds to the LuCI grid. Both are recorded rather than
// performed: the cleanup by the arguments it was called with, the parent save by
// whether it ran at all.
const cleanupCalls: unknown[][] = [];
let outboundMissing = false;
let missingLookup: unknown[] = [];

vi.mock('../../../cbi/childItems', () => ({
  cleanupRemovedChildItems: (...args: unknown[]) => {
    cleanupCalls.push(
      args.map((arg) => (typeof arg === 'function' ? arg.name : arg)),
    );
  },
}));
vi.mock('../../../cbi/grid', () => ({ loadVisibleTableOptions: () => {} }));
vi.mock('../fallback', () => ({ removeFallbackLevels() {} }));
vi.mock('../tunnels/model', () => ({ removeTunnelPeers() {} }));
vi.mock('../subscriptions/model', () => ({
  loadDefaultSubscriptionHeaders: () => Promise.resolve(),
}));
vi.mock('../references', () => ({
  missingConnectionOutbound: (...args: unknown[]) => {
    missingLookup = args;
    return outboundMissing;
  },
}));

import { configureSectionSection } from '../table';

// A section is deleted from a row and saved from a dialog; both are methods LuCI
// already put on the grid, so the wrapper has to call through to them.
let parentSaves = 0;
const parentSaveResult = {};
const removeCalls: Array<{ args: unknown[]; self: unknown }> = [];
const removeResult = {};

beforeEach(() => {
  cleanupCalls.length = 0;
  removeCalls.length = 0;
  parentSaves = 0;
  outboundMissing = false;
  (globalThis as unknown as { form: unknown }).form = {
    GridSection: {
      prototype: {
        handleModalSave() {
          parentSaves += 1;
          return parentSaveResult;
        },
      },
    },
  };
});

function configured() {
  const sectionRef = {
    handleRemove(...args: unknown[]) {
      // Recorded as a property rather than a local: the wrapper has to call the
      // grid its own method, on the grid.
      removeCalls.push({ args, self: this });
      return removeResult;
    },
  };
  configureSectionSection(sectionRef as unknown as CBISection);
  return sectionRef as unknown as CBISection & {
    handleRemove: (id: string, event: Event) => unknown;
    handleModalSave: (map: unknown, event: Event) => unknown;
  };
}

describe('deleting a section', () => {
  it('takes every kind of child with it, in one pass', () => {
    const event = {} as Event;
    const sectionRef = configured();

    expect(sectionRef.handleRemove('parent', event)).toBe(removeResult);
    expect(cleanupCalls).toEqual([
      ['parent', 'subscription_url', []],
      ['parent', 'section_interface', []],
      ['parent', 'urltest', []],
      ['parent', 'fallback_group', [], undefined, 'removeFallbackLevels'],
      ['parent', 'tunnel', [], undefined, 'removeTunnelPeers'],
    ]);
  });

  it('still calls the grid its own removal', () => {
    const event = {} as Event;
    const sectionRef = configured();
    sectionRef.handleRemove('parent', event);

    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0].args).toEqual(['parent', event]);
    expect(removeCalls[0].self).toBe(sectionRef);
  });
});

// LuCI parses the options one by one, so a check that refuses halfway leaves the
// fields that already passed behind. A section the runtime graph would drop is
// refused before the dialog writes anything: Save does nothing at all.
describe('saving a section the runtime graph would drop', () => {
  it('writes nothing', () => {
    const sectionRef = configured();
    const modalMap = { section: 'parent' };
    outboundMissing = true;

    sectionRef.handleModalSave(modalMap, {} as Event);

    expect(missingLookup).toEqual([modalMap, 'parent']);
    expect(parentSaves).toBe(0);
  });

  it('saves normally once the outbound is there', () => {
    const sectionRef = configured();
    const modalMap = { section: 'parent' };

    expect(sectionRef.handleModalSave(modalMap, {} as Event)).toBe(
      parentSaveResult,
    );
    expect(parentSaves).toBe(1);
  });
});
