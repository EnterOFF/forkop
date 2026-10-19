import { describe, expect, it } from 'vitest';

import { nextNumberedName } from '../nextNumberedName';

// A new entry is offered "<prefix> #N" so the user does not have to invent a
// name to get one, and the dialog has to accept the name it offers.

describe('nextNumberedName', () => {
  it('starts at one among entries the user named', () => {
    expect(nextNumberedName('URLTest', ['test', 'Fastest'])).toBe('URLTest #1');
  });

  // With 1, 2, 3, 5 and 6 left, a count of the entries offered "#6" again.
  it('is one past the highest number taken, not one past the count', () => {
    expect(
      nextNumberedName('Server', [
        'Server #1',
        'Server #2',
        'Server #3',
        'Server #5',
        'Server #6',
      ]),
    ).toBe('Server #7');
    expect(nextNumberedName('URLTest', ['URLTest #2'])).toBe('URLTest #3');
  });

  it('reads only the names numbered under its own prefix', () => {
    expect(
      nextNumberedName('Tunnel', [
        'Fallback #4',
        'My Tunnel #9',
        'Tunnel #x',
        ' Tunnel #1 ',
      ]),
    ).toBe('Tunnel #2');
  });
});
