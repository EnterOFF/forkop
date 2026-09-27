import { afterEach, describe, expect, it } from 'vitest';

import { getRuleEditButtonText } from '../grid';

// A row action button has to stay short, and LuCI's own catalog translates
// "Edit" at length. So the button asks for a msgid of Forkop's own and falls
// back to the English word when the catalog returns the msgid unchanged.

const globals = globalThis as unknown as Record<string, unknown>;
const translate = globals._;

afterEach(() => {
  globals._ = translate;
});

describe('the row action label', () => {
  it('is Edit when the catalog has no answer', () => {
    globals._ = (key: string) => key;
    expect(getRuleEditButtonText()).toBe('Edit');
  });

  it('is the translation when the catalog has one', () => {
    globals._ = () => 'Изменить';
    expect(getRuleEditButtonText()).toBe('Изменить');
  });
});
