import { describe, expect, it } from 'vitest';

import { nextDynamicListName } from '../listValues';

// A new group is named "Group #n" so the user does not have to invent a name to
// get one. The number counts what is on screen, not what has ever existed: rows
// the user added and deleted again without saving must not push the next name
// along, and rows that are still there must.

function nameOption(visible: string[]) {
  return { formvalue: () => visible } as unknown as CBIOption;
}

describe('nextDynamicListName', () => {
  it('ignores rows that were added and deleted without saving', () => {
    expect(
      nextDynamicListName(
        nameOption([]),
        'settings',
        ['saved-1', 'saved-2'],
        'Group',
      ),
    ).toBe('Group #1');
  });

  it('counts the rows that are on screen', () => {
    expect(
      nextDynamicListName(
        nameOption(['visible-1', 'visible-2']),
        'settings',
        [],
        'Group',
      ),
    ).toBe('Group #3');
  });
});
