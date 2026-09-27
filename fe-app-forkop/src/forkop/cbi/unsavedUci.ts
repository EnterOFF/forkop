import { FORKOP_UCI_PACKAGE } from '../../constants';

// What uci holds for the Forkop package and has not pushed to the router: the
// sections added, the options set and deleted, and the order a drag left the
// rows in. uci.js keeps all of it in uci.state until the next save pushes it.
export interface UnsavedUci {
  values: unknown;
  creates: unknown;
  changes: unknown;
  deletes: unknown;
  reorder: boolean;
  order: Record<string, unknown>;
}

function copy(value: unknown) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function captureUnsavedUci(): UnsavedUci {
  const state = uci.state;
  const values = state.values[FORKOP_UCI_PACKAGE] || {};

  return {
    values: state.values[FORKOP_UCI_PACKAGE],
    creates: copy(state.creates[FORKOP_UCI_PACKAGE]),
    changes: copy(state.changes[FORKOP_UCI_PACKAGE]),
    deletes: copy(state.deletes[FORKOP_UCI_PACKAGE]),
    reorder: state.reorder[FORKOP_UCI_PACKAGE] === true,
    order: Object.fromEntries(
      Object.entries(values).map(([sid, section]) => [sid, section['.index']]),
    ),
  };
}

export function restoreUnsavedUci(unsaved: UnsavedUci) {
  const state = uci.state;
  // A save pushes everything and reloads the package, after which there is
  // nothing of the captured state left to go back to.
  if (state.values[FORKOP_UCI_PACKAGE] !== unsaved.values) {
    return;
  }

  const put = (store: Record<string, unknown>, value: unknown) => {
    if (value === undefined) {
      delete store[FORKOP_UCI_PACKAGE];
    } else {
      store[FORKOP_UCI_PACKAGE] = copy(value);
    }
  };
  put(state.creates, unsaved.creates);
  put(state.changes, unsaved.changes);
  put(state.deletes, unsaved.deletes);
  if (unsaved.reorder) {
    state.reorder[FORKOP_UCI_PACKAGE] = true;
  } else {
    delete state.reorder[FORKOP_UCI_PACKAGE];
  }
  Object.entries(state.values[FORKOP_UCI_PACKAGE] || {}).forEach(
    ([sid, section]) => {
      if (Object.prototype.hasOwnProperty.call(unsaved.order, sid)) {
        section['.index'] = unsaved.order[sid] as number;
      }
    },
  );
}
