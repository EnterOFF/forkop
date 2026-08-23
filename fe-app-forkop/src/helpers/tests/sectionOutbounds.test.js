// What a Connection section and a server filter have to name before they can be
// saved. Both checks read the dialog through LuCI's option lookup, so the test
// hands the same shape back: a map that answers with the value a widget holds.

import { describe, expect, it } from 'vitest';

import {
  createUciStub,
  loadLuciView,
  resetLuciViewCache,
} from './loadLuciView';

function load() {
  resetLuciViewCache();
  return loadLuciView('section', createUciStub(), [
    'missingConnectionOutboundMessage',
    'missingFilterSelectionMessage',
  ]);
}

function modalMap(values) {
  return {
    section: 'section_main',
    lookupOption(name, section_id) {
      return Object.prototype.hasOwnProperty.call(values, name)
        ? [{ formvalue: () => values[name] }, section_id || this.section]
        : null;
    },
  };
}

const OUTBOUND_SOURCES = {
  selector_proxy_links: ['vless://node@example.com:443'],
  subscription_url: ['sub_a1b2c3'],
  interfaces: ['awg0'],
  tunnels: ['tunnel_a1b2c3'],
  outbound_jsons: ['{"type":"socks","tag":"Local"}'],
};

describe('connection section outbounds', () => {
  it('refuses a section that names no outbound at all', () => {
    const { missingConnectionOutboundMessage } = load();
    const map = modalMap({ action: 'connection' });

    expect(missingConnectionOutboundMessage(map, map.section)).toMatch(
      /at least one outbound/,
    );
  });

  it('accepts a section that names any single source', () => {
    const { missingConnectionOutboundMessage } = load();

    for (const [option, value] of Object.entries(OUTBOUND_SOURCES)) {
      const map = modalMap({ action: 'connection', [option]: value });
      expect(missingConnectionOutboundMessage(map, map.section)).toBeNull();
    }
  });

  // A group takes its members from the sources of its own section, so it can
  // never stand in for one: the generator drops such a section entirely.
  it('does not count a URLTest or a Fallback as a source', () => {
    const { missingConnectionOutboundMessage } = load();
    const map = modalMap({
      action: 'connection',
      urltest: ['urltest_a1b2c3'],
      fallback_group: ['group_a1b2c3'],
    });

    expect(missingConnectionOutboundMessage(map, map.section)).toMatch(
      /at least one outbound/,
    );
  });

  it('treats a list of blank items as no source', () => {
    const { missingConnectionOutboundMessage } = load();
    const map = modalMap({
      action: 'connection',
      selector_proxy_links: ['', ' '],
    });

    expect(missingConnectionOutboundMessage(map, map.section)).toMatch(
      /at least one outbound/,
    );
  });

  it('leaves every other action alone', () => {
    const { missingConnectionOutboundMessage } = load();

    for (const action of ['dns', 'block', 'bypass', 'zapret', 'byedpi']) {
      const map = modalMap({ action });
      expect(missingConnectionOutboundMessage(map, map.section)).toBeNull();
    }
  });
});

describe('server filter selection', () => {
  function filterMode(mode, values = {}) {
    return { formvalue: () => mode, map: modalMap(values) };
  }

  it('refuses "only selected" without a single selection', () => {
    const { missingFilterSelectionMessage } = load();

    expect(
      missingFilterSelectionMessage(
        filterMode('include', {
          include_outbounds: [],
          include_regex: '',
        }),
        'settings',
      ),
    ).toMatch(/at least one server/);
  });

  it('accepts a selection made by name, by pattern or by group', () => {
    const { missingFilterSelectionMessage } = load();
    const selections = [
      { include_outbounds: ['Germany'] },
      { include_regex: 'Germany|Finland' },
      // Only a Fallback level offers this one, and a level that includes a
      // URLTest has that group as its member.
      { include_groups: ['Fastest'] },
    ];

    for (const selection of selections) {
      expect(
        missingFilterSelectionMessage(
          filterMode('include', selection),
          'settings',
        ),
      ).toBeNull();
    }
  });

  it('leaves the other filter modes alone', () => {
    const { missingFilterSelectionMessage } = load();

    for (const mode of ['all', 'exclude', 'direct']) {
      expect(
        missingFilterSelectionMessage(filterMode(mode, {}), 'settings'),
      ).toBeNull();
    }
  });
});
