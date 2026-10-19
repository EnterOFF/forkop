import { describe, expect, it } from 'vitest';

import { createFormSectionStub, installLuciStubs } from './luciStubs';
import {
  addClientCredentialOptions,
  addClientOptions,
  addClientRoutingOptions,
} from '../../forkop/tabs/servers/clientDialog';
import { createServerContent } from '../../forkop/tabs/servers/form';

// The whole tab is declared in one pass, so anything that throws here is a form
// that does not open at all - and anything it declares wrongly is a field that is
// there but never shown, or shown when it should not be.
function build(server = {}) {
  const uci = installLuciStubs({
    srv: {
      '.type': 'server',
      label: 'Home',
      enabled: '1',
      protocol: 'vless',
      listen_port: '30000',
      ...server,
    },
  });
  const view = {
    addClientCredentialOptions,
    addClientOptions,
    addClientRoutingOptions,
    createServerContent,
  };
  const section = createFormSectionStub();
  view.createServerContent(section);
  return { section, view, uci };
}

describe('server form', () => {
  it('leaves a server that becomes AmneziaWG empty until its parameters are generated', () => {
    const { section, uci } = build({ protocol: 'wireguard' });
    const button = section.options.find(
      (option) => option.name === '_generate_amnezia',
    );
    expect(
      section.options
        .filter((option) => option.name.startsWith('amnezia_'))
        .map((option) => option.load?.('srv'))
        .filter(Boolean),
    ).toEqual([]);

    button.onclick(null, 'srv');
    expect(uci.get('forkop', 'srv', 'amnezia_jc')).toMatch(/^[3-6]$/u);
    expect(uci.get('forkop', 'srv', 'amnezia_header_protection_key')).toMatch(
      /^[A-Za-z0-9+/]{43}=$/u,
    );
    expect(uci.get('forkop', 'srv', 'amnezia_random_trailers')).toBe('1');
  });

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

  // A TLS server serves what the router issued it unless it is given one of the
  // user's; NaiveProxy has no choice, since its clients refuse a self-signed one.
  it('asks for a certificate only where it is the user who supplies it', () => {
    const { section } = build();
    const shown = (name, values) =>
      section.options
        .find((option) => option.name === name)
        .dependencies.some((dependency) =>
          Object.entries(dependency).every(
            ([key, value]) => (values[key] ?? '') === value,
          ),
        );
    const fields = (values) =>
      ['tls_certificate_source', 'tls_certificate', 'tls_key'].filter((name) =>
        shown(name, values),
      );

    expect(fields({ protocol: 'trojan', security: 'tls' })).toEqual([
      'tls_certificate_source',
    ]);
    expect(
      fields({
        protocol: 'trojan',
        security: 'tls',
        tls_certificate_source: 'custom',
      }),
    ).toEqual(['tls_certificate_source', 'tls_certificate', 'tls_key']);
    expect(
      fields({ protocol: 'hysteria2', tls_certificate_source: 'custom' }),
    ).toEqual(['tls_certificate_source', 'tls_certificate', 'tls_key']);
    expect(fields({ protocol: 'naive' })).toEqual([
      'tls_certificate',
      'tls_key',
    ]);
    expect(fields({ protocol: 'vless', security: 'reality' })).toEqual([]);
  });

  it('generates a name for a client from a button beside the field', () => {
    const { view } = build();
    const itemSection = createFormSectionStub();
    const field = { value: 'laptop' };
    const widget = {
      getValue: () => field.value,
      setValue: (value) => (field.value = value),
      triggerValidation: () => {},
    };
    const buttons = [];
    const luciE = globalThis.E;
    globalThis.form.Value.prototype.renderWidget = () => ({
      instance: widget,
      querySelector: () => null,
    });
    globalThis.E = (tag, attrs = {}, children = []) => {
      const node = {
        tag,
        attrs,
        children,
        listeners: {},
        addEventListener(type, listener) {
          node.listeners[type] = listener;
        },
      };
      if (tag === 'button') buttons.push(node);
      return node;
    };

    try {
      view.addClientOptions('srv', itemSection, {}, null);
      const name = itemSection.options.find((option) => option.name === 'name');
      name.map = {};
      name.renderWidget('srv', 0, 'laptop');
      buttons[0].listeners.click({
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    } finally {
      delete globalThis.form.Value.prototype.renderWidget;
      globalThis.E = luciE;
    }

    expect(buttons).toHaveLength(1);
    expect(field.value).toMatch(/^user-[a-z0-9]{5}$/);
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
