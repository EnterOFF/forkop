import type {
  IDiagnosticsChecksItem,
  IDiagnosticsChecksStoreItem,
} from '../../../services';

type ItemState = IDiagnosticsChecksItem['state'];

export type CheckOutcome = Pick<
  IDiagnosticsChecksStoreItem,
  'state' | 'description' | 'items'
>;

const SEVERITY: Record<ItemState, number> = {
  success: 0,
  warning: 1,
  error: 2,
};

export function finding(
  state: ItemState,
  key: string,
  value: string,
): IDiagnosticsChecksItem {
  return { state, key, value };
}

// A group takes the state of its worst finding, and its header says how bad
// that is; the findings themselves are listed under it.
export function summarize(
  items: IDiagnosticsChecksItem[],
): Pick<IDiagnosticsChecksStoreItem, 'state' | 'description'> {
  const state = items.reduce<ItemState>(
    (worst, item) =>
      SEVERITY[item.state] > SEVERITY[worst] ? item.state : worst,
    'success',
  );

  return {
    state,
    description:
      state === 'error'
        ? _('Checks failed')
        : state === 'warning'
          ? _('Issues detected')
          : _('Checks passed'),
  };
}

export function outcome(items: IDiagnosticsChecksItem[]): CheckOutcome {
  return { ...summarize(items), items };
}

export function skipped(description: string): CheckOutcome {
  return { state: 'skipped', description, items: [] };
}

// The call itself failed: the router said nothing about what it checks.
export function unanswered(): CheckOutcome {
  return {
    state: 'error',
    description: _('Cannot receive checks result'),
    items: [],
  };
}

export function formatMs(ms: number) {
  return _('%d ms').format(ms);
}

export function formatMegabytes(kilobytes: number) {
  return _('%d MB').format(Math.round(kilobytes / 1024));
}

// Two units at most: "3 d 4 h", "2 h 15 min", "40 s".
export function formatDuration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);

  if (days > 0) {
    return hours > 0
      ? `${_('%d d').format(days)} ${_('%d h').format(hours)}`
      : _('%d d').format(days);
  }
  if (hours > 0) {
    return minutes > 0
      ? `${_('%d h').format(hours)} ${_('%d min').format(minutes)}`
      : _('%d h').format(hours);
  }
  return minutes > 0 ? _('%d min').format(minutes) : _('%d s').format(value);
}
