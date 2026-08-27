import { describe, expect, it } from 'vitest';

import { syncServerFilterFields } from '../serverFilters';

// The two filter modes ask for the same exclusion list, and only one of them is
// on screen at a time. They are separate fields sharing one uci option, so what
// the user typed in the visible one has to reach the hidden one before the mode
// changes - otherwise switching modes shows an empty list and saving writes it.

function sharedField(store: { values: string[] }) {
  return {
    getUIElement() {
      return {
        getValue: () => store.values,
        setValue: (next: string[]) => {
          store.values = next;
        },
      };
    },
  };
}

describe('syncServerFilterFields', () => {
  it('copies the visible mode value into the hidden one', () => {
    const include = { values: ['Alpha'] };
    const exclude = { values: [] as string[] };

    syncServerFilterFields(
      {
        include: { exclude_outbounds: sharedField(include) },
        exclude: { exclude_outbounds: sharedField(exclude) },
      } as unknown as Parameters<typeof syncServerFilterFields>[0],
      'include',
      'settings',
    );

    expect(exclude.values).toEqual(['Alpha']);
  });

  it('does nothing for a mode that has no fields', () => {
    const include = { values: ['Alpha'] };

    expect(() =>
      syncServerFilterFields(
        {
          include: { exclude_outbounds: sharedField(include) },
        } as unknown as Parameters<typeof syncServerFilterFields>[0],
        'exclude',
        'settings',
      ),
    ).not.toThrow();
    expect(include.values).toEqual(['Alpha']);
  });
});
