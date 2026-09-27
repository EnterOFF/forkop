import { beforeEach, describe, expect, it } from 'vitest';

import { captureUnsavedUci, restoreUnsavedUci } from '../unsavedUci';

// uci keeps everything not yet pushed to the router in uci.state: the sections
// added, the options set and deleted, and the order a drag left the rows in. The
// writes below are the ones uci.js makes for add, set, unset, remove and move.
let state: {
  values: Record<string, Record<string, Record<string, unknown>>>;
  creates: Record<string, Record<string, Record<string, unknown>>>;
  changes: Record<string, Record<string, Record<string, unknown>>>;
  deletes: Record<string, Record<string, unknown>>;
  reorder: Record<string, boolean>;
};

beforeEach(() => {
  state = {
    values: {
      forkop: {
        sec_a: { '.name': 'sec_a', '.type': 'section', '.index': 0 },
        sec_b: { '.name': 'sec_b', '.type': 'section', '.index': 1 },
      },
      network: { lan: { '.name': 'lan', '.index': 0 } },
    },
    creates: {},
    changes: {},
    deletes: {},
    reorder: {},
  };
  (globalThis as unknown as { uci: unknown }).uci = { state };
});

describe('what a dismissed dialog leaves in uci', () => {
  it('is taken back to what uci held when the dialog opened', () => {
    state.changes.forkop = { sec_a: { label: 'kept' } };
    const unsaved = captureUnsavedUci();

    state.creates.forkop = {
      tun_1: { '.name': 'tun_1', '.type': 'tunnel', section: 'sec_a' },
    };
    state.changes.forkop.sec_a.label = 'dismissed';
    state.changes.forkop.sec_b = { enabled: '0' };
    state.deletes.forkop = { sec_b: true };
    restoreUnsavedUci(unsaved);

    expect(state.creates.forkop).toBeUndefined();
    expect(state.changes.forkop).toEqual({ sec_a: { label: 'kept' } });
    expect(state.deletes.forkop).toBeUndefined();
  });

  // Rows dragged before the dialog opened are an unsaved change of their own,
  // pushed by the page's Save; the dialog must not undo it.
  it('keeps the order the rows were dragged into before the dialog', () => {
    state.values.forkop.sec_a['.index'] = 1;
    state.values.forkop.sec_b['.index'] = 0;
    state.reorder.forkop = true;
    const unsaved = captureUnsavedUci();

    state.values.forkop.sec_a['.index'] = 0;
    state.values.forkop.sec_b['.index'] = 1;
    restoreUnsavedUci(unsaved);

    expect(state.reorder.forkop).toBe(true);
    expect(state.values.forkop.sec_a['.index']).toBe(1);
    expect(state.values.forkop.sec_b['.index']).toBe(0);
  });

  it('touches no other package', () => {
    state.changes.network = { lan: { proto: 'dhcp' } };
    const unsaved = captureUnsavedUci();
    state.changes.network.lan.proto = 'static';
    restoreUnsavedUci(unsaved);

    expect(state.changes.network).toEqual({ lan: { proto: 'static' } });
  });

  // A save in between pushed everything and reloaded the package; what was
  // captured before it describes a state that no longer exists.
  it('is left alone once a save has reloaded the package', () => {
    const unsaved = captureUnsavedUci();
    state.values.forkop = {
      sec_a: { '.name': 'sec_a', '.type': 'section', '.index': 0 },
    };
    state.changes.forkop = { sec_a: { label: 'new' } };
    restoreUnsavedUci(unsaved);

    expect(state.changes.forkop).toEqual({ sec_a: { label: 'new' } });
  });
});
