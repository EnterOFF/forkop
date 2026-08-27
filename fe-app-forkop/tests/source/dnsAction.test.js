// A section whose action is DNS answers queries instead of routing traffic, so
// the dialog shows a different set of fields for it: the domain conditions stay,
// the IP conditions go, the rule sets are a plain list rather than a settings
// list, and the device columns swap places. Every rule below is one of those
// differences.
//
// The behaviour that goes with them is exercised as calls elsewhere: the query
// mode in src/forkop/cbi/tests/configureDnsQueryMode.test.ts and the two
// device lists in src/forkop/tabs/sections/tests/makeDeviceOptionsExclusive.test.ts.
import fs from 'fs';

import { describe, expect, it } from 'vitest';

import { ROOT, SRC } from '../lib/paths.js';
import { readFunction } from '../lib/sourceLiteral.js';
import { tabSource } from '../lib/tabSource.js';

const section = await tabSource('sections');
const localDevices = fs.readFileSync(
  `${SRC}/forkop/cbi/localDevices.ts`,
  'utf8',
);
const acl = JSON.parse(
  fs.readFileSync(
    `${ROOT}/luci-app-forkop/root/usr/share/rpcd/acl.d/luci-app-forkop.json`,
    'utf8',
  ),
);

function at(needle, from = 0) {
  const index = section.indexOf(needle, from);
  expect(index, `missing source contract: ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe('the condition fields', () => {
  const domains = at("key: 'domain_suffix'");
  const ips = at(
    'const ipConditionOption = addTextConditionField(section, {',
    domains,
  );
  const builtIns = at('const builtInRulesetOption = section.taboption(', ips);

  it('keep the Domains field visible for a DNS section', () => {
    expect(section.slice(domains, ips)).not.toContain('dependsOnRoutingAction');
  });

  it('hide the IPs field for a DNS section', () => {
    expect(section.slice(ips, builtIns)).toContain(
      'dependsOnRoutingAction(ipConditionOption)',
    );
  });

  // The Domains field is one text area holding a list, and the user's own
  // layout - blank lines, comments, the order they typed - is part of it. Loading
  // it has to keep the text it was given rather than rebuild it from the values.
  it('load the Domains field without rewriting the text', () => {
    expect(section).toContain(
      'return appendUniqueDomainTextValues(textValue, values);',
    );
  });
});

describe('the DNS servers field', () => {
  const server = at(
    "'dns_server'",
    at('function createSectionContent(section)'),
  );
  const block = section.slice(
    section.lastIndexOf('section.taboption(', server),
    at("'dns_detour_enabled'", server),
  );

  it('is a DynamicList', () => {
    expect(block).toContain('form.DynamicList');
    expect(block).toContain("_('DNS Server')");
  });

  it('renders no shared protocol selector', () => {
    expect(block).not.toContain("'dns_type'");
  });

  it('renders no placeholder that looks like a recommendation', () => {
    expect(block).not.toContain("placeholder = '1.1.1.1'");
  });

  it.each([
    "'Resolves domains that match the section conditions. Several servers give automatic failover. The protocol is set by a prefix: udp://, tcp://, tls://, https://, quic://, h3://'",
    "'dns_fallback_strategy'",
    "_('DNS Query Mode')",
    "configureDnsQueryMode(dnsQueryModeOption, 'dns_server', {",
    "alsoDependsOn: { action: 'dns' },",
    "_('Route DNS requests through a section')",
    "_('DNS requests through')",
    "'A URL or local path. The format is detected automatically'",
  ])('carries %s', (expected) => {
    at(expected);
  });
});

describe('the rule set lists', () => {
  const dnsRuleSet = at('const dnsRuleSetOption = section.taboption(');
  const ruleSet = at('const ruleSetOption = section.taboption(', dnsRuleSet);
  const sourceIp = at(
    'const sourceIpOption = addLocalDeviceSubnetDynamicField(section',
    ruleSet,
  );

  it('give a DNS section the classic DynamicList', () => {
    const block = section.slice(dnsRuleSet, ruleSet);
    expect(block).toContain('form.DynamicList');
    expect(block).not.toContain('SettingsDynamicList');
    expect(block).toContain("dnsRuleSetOption.depends('action', 'dns')");
    expect(block).toContain('writeDnsRulesetReferences');
  });

  it('give a routing action the settings-enabled list, retained', () => {
    const block = section.slice(ruleSet, sourceIp);
    expect(block).toContain('SettingsDynamicList');
    expect(block).toContain('ruleSetOption.retain = true');
    expect(block).toContain('dependsOnRoutingAction(ruleSetOption)');
    expect(block).toContain('writeCustomRulesetReferences');
  });

  it.each(['domainIpListsOption', 'dnsDomainListsOption', 'domain_ip_lists'])(
    'keep no trace of the legacy %s',
    (removed) => {
      expect(section).not.toContain(removed);
    },
  );
});

describe('the device fields', () => {
  const sourceIp = at(
    'const sourceIpOption = addLocalDeviceSubnetDynamicField(section',
  );
  const fullyRouted = at(
    'const fullyRoutedOption = addLocalDeviceSubnetDynamicField(section',
    sourceIp,
  );
  const ports = at(
    'const portsOption = addDynamicConditionField(section',
    fullyRouted,
  );

  it('show the device filter only once the section has conditions', () => {
    expect(section.slice(sourceIp, fullyRouted)).toContain(
      'dependsOnRuleConditions(sourceIpOption)',
    );
  });

  it('expose forced routing on a DNS section', () => {
    expect(section.slice(fullyRouted, ports)).toContain(
      "fullyRoutedOption.depends('action', 'dns')",
    );
  });

  it('keep the filter and forced routing mutually exclusive', () => {
    expect(section.slice(fullyRouted, ports)).toContain(
      'makeDeviceOptionsExclusive(sourceIpOption, fullyRoutedOption)',
    );
  });

  it.each([
    "'domain'",
    "'ip_cidr'",
    "'community_lists'",
    "'rule_set'",
    "'ports'",
  ])('make the device filter follow the %s condition', (condition) => {
    expect(readFunction(section, 'dependsOnRuleConditions')).toContain(
      condition,
    );
  });

  it('ignore whitespace when deciding whether a condition is set', () => {
    expect(readFunction(section, 'dependsOnRuleConditions')).toContain('/\\S/');
  });

  it('refresh while the user is still typing a condition', () => {
    expect(section).toContain(
      "node.dispatchEvent(new CustomEvent('widget-change', { bubbles: true }))",
    );
  });
});

describe('the local device selector', () => {
  it.each([".load('dhcp')", "uci.sections('dhcp', 'host')"])(
    'reads the static DHCP hosts: %s',
    (expected) => {
      expect(localDevices).toContain(expected);
    },
  );

  it('needs read access to the DHCP host sections', () => {
    expect(acl['luci-app-forkop']?.read?.uci).toContain('dhcp');
  });

  it.each([
    "export const SYSTEM_DEVICE_VALUE = '@system'",
    "choices[SYSTEM_DEVICE_VALUE] = 'System'",
    "normalizedName.toLowerCase() === 'system'",
    "'%s (%s)'.format(normalizedName, normalizedIp)",
  ])('offers the router itself as a device: %s', (expected) => {
    expect(localDevices).toContain(expected);
  });

  it('lets the System sentinel pass validation', () => {
    expect(section).toContain('value === SYSTEM_DEVICE_VALUE');
  });

  it.each([
    'onWidgetReady(section_id, widget)',
    "node.addEventListener('cbi-dynlist-change'",
    'onListChange(section_id, widget.getValue())',
  ])('reports its own edits live: %s', (expected) => {
    expect(localDevices).toContain(expected);
  });
});

it('reuses the shared uci list normalizer', () => {
  expect(section).toMatch(
    /import \{[^}]*normalizeOptionValues[^}]*\} from '[^']*cbi\/listValues'/,
  );
});
