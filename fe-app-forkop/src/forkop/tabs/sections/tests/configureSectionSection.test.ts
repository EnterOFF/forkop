import { beforeEach, describe, expect, it, vi } from 'vitest';

// What removing a section takes with it, and what refuses to save one, are the
// two things this wrapper adds to the LuCI grid. Both are recorded rather than
// performed: the cleanup by the arguments it was called with, the save by
// whether it ran at all and what the user was told.
const cleanupCalls: unknown[][] = [];
let outboundMissing = false;
let missingLookup: unknown[] = [];
const saves: unknown[][] = [];
const refusals: unknown[] = [];
const saveResult = Promise.resolve(true);
const dialogCalls: string[] = [];

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
vi.mock('../../../cbi/modal', () => ({
  saveSectionModal: (...args: unknown[]) => {
    saves.push(args);
    return saveResult;
  },
  reportRefusedSave: (error: unknown) => {
    refusals.push(error);
  },
}));
vi.mock('../outboundNames', () => ({
  forgetOutboundNameChoices: () => {
    dialogCalls.push('forget server names');
  },
}));
vi.mock('../references', () => ({
  missingConnectionOutbound: (...args: unknown[]) => {
    missingLookup = args;
    return outboundMissing;
  },
}));

import { configureSectionSection } from '../table';

// A section is deleted from a row; that is a method LuCI already put on the
// grid, so the wrapper has to call through to it.
const removeCalls: Array<{ args: unknown[]; self: unknown }> = [];
const removeResult = {};

beforeEach(() => {
  cleanupCalls.length = 0;
  removeCalls.length = 0;
  saves.length = 0;
  refusals.length = 0;
  dialogCalls.length = 0;
  outboundMissing = false;
});

function configured() {
  const sectionRef = {
    renderMoreOptionsModal(sectionId: string) {
      dialogCalls.push(`open ${sectionId}`);
      return Promise.resolve();
    },
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

describe('opening a section dialog', () => {
  it('asks afresh for the server names its subscriptions deliver', async () => {
    const sectionRef = configured();

    await sectionRef.renderMoreOptionsModal('parent');

    expect(dialogCalls).toEqual(['forget server names', 'open parent']);
  });
});

describe('deleting a section', () => {
  it('takes every kind of child with it, in one pass', () => {
    const event = {} as Event;
    const sectionRef = configured();

    expect(sectionRef.handleRemove('parent', event)).toBe(removeResult);
    expect(cleanupCalls).toEqual([
      ['parent', 'connection_link', []],
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
// refused before the dialog writes anything, and the user is told why.
describe('saving a section the runtime graph would drop', () => {
  it('writes nothing and says why', () => {
    const sectionRef = configured();
    const modalMap = { section: 'parent' };
    outboundMissing = true;

    sectionRef.handleModalSave(modalMap, {} as Event);

    expect(missingLookup).toEqual([modalMap, 'parent']);
    expect(saves).toEqual([]);
    expect(refusals).toEqual([
      'Add a connection URI, a subscription, a network interface, a tunnel or a JSON outbound',
    ]);
  });

  it('saves normally once the outbound is there', () => {
    const sectionRef = configured();
    const modalMap = { section: 'parent' };
    const event = {} as Event;

    expect(sectionRef.handleModalSave(modalMap, event)).toBe(saveResult);
    expect(saves).toEqual([[sectionRef, modalMap, event]]);
    expect(refusals).toEqual([]);
  });
});
