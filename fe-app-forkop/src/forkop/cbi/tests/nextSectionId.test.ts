import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nextSectionId } from '../childItems';

// An anonymous uci section can only be addressed as @type[index], which libuci
// numbers by position across the whole file - so every section a dialog creates
// is given a name of its own. The name is a per-type prefix and six hex digits,
// and it has to be free: free in the stored configuration, and free among the
// ids this dialog has already handed out but not yet saved.

const stored = new Set<string>();
const globals = globalThis as unknown as Record<string, unknown>;
let previousUci: unknown;

// The suffix comes from Math.random(), so the candidates a call gets to try are
// queued as the hex digits they have to produce.
const queued: number[] = [];
function queue(...digits: string[]) {
  digits.forEach((value) => queued.push(parseInt(value, 16) / 0x1000000));
}

beforeEach(() => {
  stored.clear();
  queued.length = 0;
  previousUci = globals.uci;
  globals.uci = {
    get: (packageName: string, sectionId: string) => {
      expect(packageName).toBe('forkop');
      return stored.has(sectionId) ? { '.name': sectionId } : null;
    },
  };
  vi.spyOn(Math, 'random').mockImplementation(() =>
    queued.length ? (queued.shift() as number) : 0.5,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  globals.uci = previousUci;
});

describe('nextSectionId', () => {
  // Every type the dialogs create, and the prefix its ids carry. A prefix that
  // changes renames every section the dialogs will create from then on.
  it.each([
    ['fallback_group', 'group'],
    ['fallback_level', 'level'],
    ['section', 'section'],
    ['section_interface', 'iface'],
    ['server', 'server'],
    ['server_client', 'client'],
    ['subscription_url', 'sub'],
    ['tunnel', 'tunnel'],
    ['tunnel_peer', 'peer'],
    ['urltest', 'urltest'],
  ])('names a %s section %s_<suffix>', (typeName, prefix) => {
    queue('0a1b2c');
    expect(nextSectionId(typeName)).toBe(`${prefix}_0a1b2c`);
  });

  it('keeps the suffix six hex digits however small it is', () => {
    queue('000abc');
    expect(nextSectionId('section')).toBe('section_000abc');
  });

  it('leaves a type it does not know about readable', () => {
    queue('0eeeee');
    expect(nextSectionId('priority_group')).toBe('priority_group_0eeeee');
  });

  it('skips a name a stored section already carries', () => {
    stored.add('server_0aaaaa');
    queue('0aaaaa', '0bbbbb');
    expect(nextSectionId('server')).toBe('server_0bbbbb');
  });

  // A staged child reaches uci only when its parent is saved, so uci.get()
  // cannot see an id handed out earlier in the same dialog.
  it('skips a name it has already handed out in this dialog', () => {
    queue('0ccccc');
    expect(nextSectionId('tunnel_peer')).toBe('peer_0ccccc');
    queue('0ccccc', '0ddddd');
    expect(nextSectionId('tunnel_peer')).toBe('peer_0ddddd');
  });

  it('produces a valid uci name from real randomness', () => {
    vi.restoreAllMocks();
    expect(nextSectionId('server_client')).toMatch(/^client_[0-9a-f]{6}$/);
  });
});
