import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../cbi/childItems', () => ({ nextSectionId: () => 'x' }));
vi.mock('../../cbi/grid', () => ({ getRuleEditButtonText: () => 'Edit' }));

import { configureGridSection } from '../gridSection';

// A section dialog's nested dialogs write into uci as they close, before the
// dialog itself is saved. What the grid adds to LuCI's dialog is that closing it
// without saving takes those writes back, and closing it by saving keeps them.
const calls: unknown[][] = [];
let state: {
  values: Record<string, Record<string, Record<string, unknown>>>;
  creates: Record<string, unknown>;
  changes: Record<string, unknown>;
  deletes: Record<string, unknown>;
  reorder: Record<string, boolean>;
};

beforeEach(() => {
  calls.length = 0;
  state = {
    values: { forkop: { sec: { '.name': 'sec', '.index': 0 } } },
    creates: {},
    changes: {},
    deletes: {},
    reorder: {},
  };
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.uci = { state, get: () => null };
  globals.form = {
    GridSection: {
      prototype: {
        renderMoreOptionsModal(sectionId: string) {
          calls.push(['open', sectionId]);
          return Promise.resolve();
        },
        handleModalCancel(_map: unknown, _ev: Event, isSaving: boolean) {
          calls.push(['close', isSaving]);
          return Promise.resolve();
        },
      },
    },
  };
});

function grid() {
  const sectionRef = { map: {}, titleFn: () => '' } as unknown as CBISection;
  configureGridSection(sectionRef, 'section', 'Section', 'Add');
  return sectionRef as CBISection & {
    handleModalCancel: (map: unknown, ev: Event, isSaving?: boolean) => unknown;
  };
}

// What a tunnel dialog leaves behind when it is saved inside a section dialog.
function nestedDialogWrites() {
  state.creates.forkop = { tun_1: { '.type': 'tunnel', section: 'sec' } };
  state.changes.forkop = { sec: { tunnels: ['tun_1'] } };
}

describe('a section dialog', () => {
  it('takes back what its nested dialogs wrote when it is dismissed', async () => {
    const sectionRef = grid();
    await sectionRef.renderMoreOptionsModal('sec');
    nestedDialogWrites();

    await sectionRef.handleModalCancel({}, {} as Event, false);

    expect(state.creates.forkop).toBeUndefined();
    expect(state.changes.forkop).toBeUndefined();
    expect(calls).toEqual([
      ['open', 'sec'],
      ['close', false],
    ]);
  });

  it('keeps them when it closes by saving', async () => {
    const sectionRef = grid();
    await sectionRef.renderMoreOptionsModal('sec');
    nestedDialogWrites();

    await sectionRef.handleModalCancel({}, {} as Event, true);

    expect(state.creates.forkop).toEqual({
      tun_1: { '.type': 'tunnel', section: 'sec' },
    });
    expect(calls).toEqual([
      ['open', 'sec'],
      ['close', true],
    ]);
  });
});
