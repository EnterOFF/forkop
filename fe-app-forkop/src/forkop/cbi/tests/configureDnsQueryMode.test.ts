import { describe, expect, it } from 'vitest';

import { configureDnsQueryMode } from '../dnsServers';

// Parallel or sequential is a question only worth asking once there is a second
// server to fall back to, and it has to appear the moment the user types that
// second one - not after a save. LuCI's depends() can only compare an option to a
// literal value, and "holds more than one entry" is not a value, so the option
// depends on a sentinel and answers the real question in checkDepends. This
// drives checkDepends the way LuCI does: it re-checks the whole map whenever any
// widget changes, and a DynamicList raises that on every edit.

type Values = string[] | string | null;

function harness(
  gate: Record<string, string>,
  gateValues: Record<string, string>,
) {
  let servers: Values = [];
  const gateState = { ...gateValues };

  const option = (formvalue: () => Values) => ({
    formvalue,
    cfgvalue: () => null,
  });
  const serverOption = option(() => servers);

  const map = {
    lookupOption: (name: string, sectionId: string) => [
      name === 'dns_server'
        ? serverOption
        : option(() => gateState[name] ?? null),
      sectionId,
    ],
  };

  const modeOption = {
    map,
    value: () => {},
    depends: () => {},
    checkDepends: (_sectionId: string) => false,
  };

  configureDnsQueryMode(modeOption as unknown as CBIOption, 'dns_server', {
    alsoDependsOn: gate,
  });

  return {
    setServers: (next: Values) => {
      servers = next;
    },
    setGate: (name: string, value: string) => {
      gateState[name] = value;
    },
    visible: () => modeOption.checkDepends('section'),
  };
}

describe.each([
  ['a DNS section', { action: 'dns' }, { action: 'dns' }],
  [
    "a network interface's own resolver",
    { domain_resolver_enabled: '1' },
    { domain_resolver_enabled: '1' },
  ],
])('in %s', (_label, gate, open) => {
  it('is hidden while there is one server', () => {
    const dialog = harness(gate, open);
    dialog.setServers(['1.1.1.1']);
    expect(dialog.visible()).toBe(false);
  });

  it('appears as soon as a second server is typed', () => {
    const dialog = harness(gate, open);
    dialog.setServers(['1.1.1.1']);
    expect(dialog.visible()).toBe(false);
    dialog.setServers(['1.1.1.1', '8.8.8.8']);
    expect(dialog.visible()).toBe(true);
  });

  it('disappears when what gates it is switched off', () => {
    const dialog = harness(gate, open);
    dialog.setServers(['1.1.1.1', '8.8.8.8']);
    expect(dialog.visible()).toBe(true);
    const [name] = Object.keys(gate);
    dialog.setGate(name, 'something else');
    expect(dialog.visible()).toBe(false);
  });
});

// Without retain LuCI removes the option every time the mode is hidden, which
// would drop a stored choice the moment a second server is taken away.
it('keeps its stored value while it is hidden', () => {
  const modeOption = {
    map: { lookupOption: () => null },
    value: () => {},
    depends: () => {},
  } as unknown as CBIOption & { retain?: boolean; default?: string };
  configureDnsQueryMode(modeOption, 'dns_server');

  expect(modeOption.retain).toBe(true);
  expect(modeOption.default).toBe('parallel');
});
