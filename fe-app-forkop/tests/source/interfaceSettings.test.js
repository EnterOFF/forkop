// A network interface a Connection section dials out through can run a resolver
// of its own, and that resolver asks the same DNS questions as the Settings tab
// and a DNS section - through the same shared helpers, so there is one answer to
// keep right instead of four.
//
// The visibility rule itself is exercised as a call in
// src/forkop/cbi/tests/configureDnsQueryMode.test.ts.
import { describe, expect, it } from 'vitest';

import { readFunction } from '../lib/sourceLiteral.js';
import { tabSource } from '../lib/tabSource.js';

const section = await tabSource('sections');
const block = readFunction(section, 'addInterfaceItemOptions');
const storage =
  readFunction(section, 'interfaceSettingsKeys') +
  readFunction(section, 'defaultInterfaceSettings');

describe('the interface dialog', () => {
  it('keeps its settings modal handler', () => {
    expect(section).toContain(
      'o.renderItemSettingsModal = showInterfaceSettingsModal;',
    );
  });

  it('defaults a new display name to the interface name', () => {
    expect(section).toContain(
      'defaults: (inputValue) => defaultInterfaceSettings(inputValue),',
    );
  });

  it('exposes a display name', () => {
    expect(section).toContain("'display_name',");
  });

  it('validates a custom interface as a network device name', () => {
    expect(section).toContain("o.datatype = 'netdevname';");
  });

  // A device that is not up yet does not appear in the discovered list, and a
  // field that only accepts what it discovered cannot name it.
  it('does not restrict the interface to discovered devices', () => {
    expect(section).not.toContain('Select an existing network interface');
  });

  it.each([
    'dnsTypeChoices',
    "'domain_resolver_dns_type'",
    "_('DNS protocol')",
  ])('keeps no trace of the removed DNS protocol selector: %s', (removed) => {
    expect(section).not.toContain(removed);
  });
});

describe('the resolver fields', () => {
  it.each([
    // The resolver reuses the shared DNS server standard rather than a scalar field.
    "form.DynamicList,\n    'domain_resolver_dns_server'",
    "_('DNS Server')",
    "'Several servers give automatic failover. The protocol is set by a prefix: udp://, tcp://, tls://, https://, quic://, h3://'",
    'configureDnsServerList(dnsServerOption, {',
    "'domain_resolver_dns_fallback_strategy'",
    "_('DNS Query Mode')",
    "configureDnsQueryMode(dnsQueryModeOption, 'domain_resolver_dns_server', {",
    "alsoDependsOn: { domain_resolver_enabled: '1' },",
    "'domain_resolver_dns_detour_enabled'",
    "_('DNS through section')",
    '"Route the resolver\'s DNS requests through a section instead of this network interface"',
    "'domain_resolver_dns_detour_section'",
    "_('DNS requests through')",
    'refreshDnsDetourSectionOptionValues(this, parentSectionForItem(itemId))',
    "_('Select a section')",
  ])('follow the shared DNS contract: %s', (expected) => {
    expect(block).toContain(expected);
  });

  it('take their refusal message from the shared helper', () => {
    expect(section).toContain("_('Add at least one DNS server')");
  });

  it.each([
    "'domain_resolver_dns_server'",
    "'domain_resolver_dns_fallback_strategy'",
    "'domain_resolver_dns_detour_enabled'",
    "'domain_resolver_dns_detour_section'",
  ])('are read and diffed by the dialog: %s', (expected) => {
    expect(storage).toContain(expected);
  });

  // Each one is hidden until the resolver is enabled, and a hidden option is
  // dropped when the dialog is saved - so seeding a default for it on creation
  // would write a value the first save then deletes.
  it.each([
    'domain_resolver_dns_server:',
    'domain_resolver_dns_fallback_strategy:',
    'domain_resolver_dns_detour_enabled:',
    'domain_resolver_dns_detour_section:',
  ])('are not seeded when an interface is created: %s', (seeded) => {
    expect(storage).not.toContain(seeded);
  });
});
