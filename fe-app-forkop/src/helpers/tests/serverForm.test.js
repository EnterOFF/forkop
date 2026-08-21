import { describe, expect, it } from 'vitest';

import {
  createFormSectionStub,
  createUciStub,
  loadLuciView,
  resetLuciViewCache,
} from './loadLuciView';

// The whole tab is declared in one pass, so anything that throws here is a form
// that does not open at all - and anything it declares wrongly is a field that is
// there but never shown, or shown when it should not be.
function build(server = {}) {
  resetLuciViewCache();
  const uci = createUciStub({
    srv: {
      '.type': 'server',
      label: 'Home',
      enabled: '1',
      protocol: 'vless',
      listen_port: '30000',
      ...server,
    },
  });
  const view = loadLuciView('server', uci, [
    'addClientCredentialOptions',
    'addClientOptions',
    'addClientRoutingOptions',
  ]);
  const section = createFormSectionStub();
  view.createServerContent(section);
  return { section, view, uci };
}

describe('server form', () => {
  it('declares the whole tab without throwing', () => {
    const { section } = build();

    expect(section.options.length).toBeGreaterThan(40);
  });

  // Two options under one name is one option: the second declaration wins and the
  // first is dead weight that still writes to the same key.
  it('declares every option once', () => {
    const { section } = build();
    const seen = new Map();

    for (const option of section.options) {
      seen.set(option.name, (seen.get(option.name) || 0) + 1);
    }

    expect([...seen].filter(([, count]) => count > 1)).toEqual([]);
  });

  // A dependency on an option that is not declared is never satisfied, so the field
  // simply never appears. LuCI says nothing about it.
  it('depends only on options the form declares', () => {
    const { section } = build();
    const declared = new Set(section.options.map((option) => option.name));
    const dangling = [];

    for (const option of section.options) {
      for (const dependency of option.dependencies) {
        for (const key of Object.keys(dependency)) {
          // A leading ! negates, and a dotted key addresses another section.
          const name = key.replace(/^!/, '');
          if (!name.includes('.') && !declared.has(name)) {
            dangling.push(`${option.name} depends on ${name}`);
          }
        }
      }
    }

    expect(dangling).toEqual([]);
  });

  // The listener is what a client is pointed at, so its address and port are always
  // asked for, and the widget for each is the one that can hold the answer.
  it('gives each option a widget that fits it', () => {
    const { section } = build();
    const byName = Object.fromEntries(
      section.options.map((option) => [option.name, option]),
    );

    expect(byName.enabled.widget).toBe('Flag');
    expect(byName.protocol.widget).toBe('ListValue');
    expect(byName.listen_port.widget).toBe('Value');
    expect(byName.tls_alpn.widget).toBe('MultiValue');
    expect(byName.transport_hosts.widget).toBe('DynamicList');
    expect(byName.inbound_json.widget).toBe('TextValue');
  });

  // The camouflage site is asked for once: the handshake target follows it, so a
  // second field could only be a way to disagree with the first.
  it('asks for the camouflage site once', () => {
    const { section } = build({ security: 'reality' });
    const names = section.options.map((option) => option.name);

    expect(names).toContain('tls_server_name');
    expect(names).not.toContain('reality_handshake_server');
    expect(names).not.toContain('reality_handshake_server_port');
  });

  // Turning on a client's own route leaves it on the rules the server follows, so
  // enabling the switch does not silently reroute the client.
  it('starts an overridden client on the rules', () => {
    const { view } = build();
    const itemSection = createFormSectionStub();

    view.addClientRoutingOptions('srv', itemSection);
    const mode = itemSection.options.find(
      (option) => option.name === 'routing_mode',
    );

    expect(mode.default).toBe('rules');
    expect(mode.choices[0][0]).toBe('rules');
  });
});
