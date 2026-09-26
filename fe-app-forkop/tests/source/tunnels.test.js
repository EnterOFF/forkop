// The tunnel dialog: five kinds of endpoint a Connection section can dial out
// through, each with its own fields, and one shared list of AmneziaWG obfuscation
// parameters that the peer either has to match or does not.
//
// That last distinction is what most of this is about. AmneziaWG changes the
// shape of the WireGuard packets; some of those changes only affect what this end
// sends (junk packets, timings) and some rewrite the handshake in a way the other
// end has to agree to (signatures, header templates). Cloudflare WARP is a peer
// nobody controls, so only the one-sided parameters may be sent there - and a
// field classified into the wrong list is a tunnel that silently never connects.
import { describe, expect, it } from 'vitest';

import { readFunction, readNameList } from '../lib/sourceLiteral.js';
import { tabSource } from '../lib/tabSource.js';

const section = await tabSource('sections');

// Present in the source, all of them, reported together.
function requireAll(source, needles) {
  expect(needles.filter((needle) => !source.includes(needle)).join('\n')).toBe(
    '',
  );
}

function refuseAll(source, needles) {
  expect(needles.filter((needle) => source.includes(needle)).join('\n')).toBe(
    '',
  );
}

/* ------------------------------------------------------------ the tunnel list */

describe('the tunnel list', () => {
  it('is a child list of the section, with its own dialog', () => {
    requireAll(section, [
      "'tunnels'",
      "_('+ Add tunnel')",
      "_('Tunnel settings')",
      "o.childType = 'tunnel'",
      "isExistingChildItem(sectionId, tunnelId, 'tunnel', 'section')",
      "typeName: 'tunnel_peer'",
      "ButtonAddSettingsDynamicList,\n    'peer_ids',",
      "_('+ Add peer')",
      'showWireGuardPeerSettingsModal',
      'wireGuardPeerFromSettings',
    ]);
  });

  it('offers every kind of endpoint', () => {
    requireAll(section, [
      "typeOption.value('wireguard', 'WireGuard')",
      "typeOption.value('amneziawg', 'AmneziaWG')",
      "typeOption.value('warp', 'Cloudflare WARP')",
      "typeOption.value('tailscale', 'Tailscale')",
      "typeOption.value('json', 'JSON endpoint')",
      'WireGuard, AmneziaWG, Cloudflare WARP, Tailscale and JSON endpoint are available',
    ]);
  });

  it('appears before the hand-written JSON outbound', () => {
    const form = readFunction(section, 'createSectionContent');
    expect(form.indexOf("'tunnels'")).toBeGreaterThanOrEqual(0);
    expect(form.indexOf("'tunnels'")).toBeLessThan(
      form.indexOf("'outbound_jsons'"),
    );
  });

  it('stays valid while it is empty', () => {
    expect(section).toContain(
      "if (!`${value || ''}`.trim()) {\n      return true;",
    );
  });

  // Every DynamicList keeps an empty field at the bottom for the next entry, and
  // a validator that refuses it refuses the whole form.
  it('tolerates the empty add field of each of its three inputs', () => {
    expect(section.match(/validateWireGuardListInput\(value\)/g)).toHaveLength(
      3,
    );
    expect(section).toContain('function validateWireGuardListInput(value)');
    expect(section).toContain(
      "return `${value || ''}`.trim() ? validateWireGuardPrefix(value) : true;",
    );
  });

  it('shows the type first, then the name and the actions', () => {
    const modal = readFunction(section, 'showTunnelSettingsModal');
    const at = (needle) => {
      const index = modal.indexOf(needle);
      expect(index, `${needle} is missing from the dialog`).toBeGreaterThan(-1);
      return index;
    };
    expect(at("_('Tunnel type')")).toBeLessThan(at("_('Tunnel name')"));
    expect(at("_('Tunnel name')")).toBeLessThan(at("'_import_config'"));
    expect(at("_('Tunnel name')")).toBeLessThan(at("'_generate_warp_profile'"));
  });

  it('keeps the name visible for every kind that has one', () => {
    expect(section).toContain(
      "['wireguard', 'amneziawg', 'warp', 'tailscale', 'openvpn-client']",
    );
  });
});

/* ----------------------------------------------------- WireGuard and AmneziaWG */

describe('a WireGuard or AmneziaWG tunnel', () => {
  it('imports a configuration instead of pasting it into a textarea', () => {
    requireAll(section, [
      "_('Import configuration')",
      "importButton.depends('tunnel_type', 'wireguard')",
      "importButton.depends('tunnel_type', 'amneziawg')",
      'parseWireGuardInput || parseWireGuardConfig',
      'parseWireGuardConfig',
    ]);
    expect(section).not.toContain('_("WireGuard or AmneziaWG configuration")');
  });

  it('refuses a peer with fields it cannot carry', () => {
    requireAll(section, [
      'const WIREGUARD_PEER_FIELDS = new Set(wireGuardPeerSettingsKeys())',
      "_('WireGuard peer contains unsupported fields')",
      "typeof peer.port !== 'number'",
      'validateWireGuardPrefix(allowedIp)',
      "_('Add at least one WireGuard peer')",
    ]);
  });

  it('lists every Amnezia field in the order the dialog shows them', () => {
    const fields = readNameList(section, 'AMNEZIA_FIELDS');
    const expected = [
      'jc',
      'jmin',
      'jmax',
      's1',
      's2',
      's3',
      's4',
      'h1',
      'h2',
      'h3',
      'h4',
      'i1',
      'i2',
      'i3',
      'i4',
      'i5',
      'header_protection_key',
      'content_padding_addition',
      'rekey_after_time',
      'rekey_timeout',
      'reject_after_time',
      'keepalive_timeout',
      'max_handshake_attempts',
      'random_trailers',
      'disable_cookies',
    ];
    expect(
      expected.filter((key) => !fields.includes(key)).join(', '),
      'missing from AMNEZIA_FIELDS',
    ).toBe('');
    // The order matters: it is what the user reads down the dialog.
    const positions = expected.map((key) => fields.indexOf(key));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  // AMNEZIA_FIELDS is the order the dialog shows; the lists beside it say how
  // each value is read. A field added to one and not the other is invisible until
  // somebody notices a parameter the dialog never asks for, or asks for twice.
  it('classifies every Amnezia field exactly once', () => {
    const classified = [
      'AMNEZIA_COUNT_FIELDS',
      'AMNEZIA_PADDING_FIELDS',
      'AMNEZIA_RANGE_FIELDS',
      'AMNEZIA_SIGNATURE_FIELDS',
      'AMNEZIA_BOOLEAN_FIELDS',
    ]
      .flatMap((name) => readNameList(section, name))
      // AMNEZIA_STRING_FIELDS is the signature fields plus this one key.
      .concat('header_protection_key');

    expect([...classified].sort()).toEqual(
      [...readNameList(section, 'AMNEZIA_FIELDS')].sort(),
    );
  });

  it('names every Amnezia field the dialog offers', () => {
    requireAll(section, [
      "_('Header protection key')",
      "_('Additional packet padding')",
      "_('Rekey interval')",
      "_('Rekey timeout')",
      "_('Data rejection timeout')",
      "_('Keepalive timeout')",
      "_('Maximum handshake attempts')",
      "_('Random trailers')",
      "_('Disable cookies')",
    ]);
  });
});

/* --------------------------------------------- one-sided obfuscation and WARP */

describe('traffic obfuscation', () => {
  const oneSided = () => readNameList(section, 'ONE_SIDED_AMNEZIA_FIELDS');

  it('is offered as a switch on both WireGuard and WARP', () => {
    requireAll(section, [
      "_('Traffic obfuscation')",
      'Masks traffic with the Amnezia mechanism to make it harder to identify',
      "'warp_junk_enabled'",
      "'wireguard_junk_enabled'",
      "wireguardJunkOption.depends('tunnel_type', 'wireguard');",
      "option.depends({ tunnel_type: 'warp', warp_junk_enabled: '1' });",
      'const ONE_SIDED_AMNEZIA_FIELDS = [',
      'if (ONE_SIDED_AMNEZIA_FIELDS.includes(key)) {',
    ]);
  });

  it.each([
    'jc',
    'jmin',
    'jmax',
    'i1',
    'i2',
    'i3',
    'i4',
    'i5',
    'content_padding_addition',
    'rekey_after_time',
    'rekey_timeout',
    'reject_after_time',
    'keepalive_timeout',
    'max_handshake_attempts',
    'disable_cookies',
  ])('carries %s, which the peer does not have to match', (key) => {
    expect(oneSided()).toContain(key);
  });

  it.each([
    's1',
    's2',
    's3',
    's4',
    'h1',
    'h2',
    'h3',
    'h4',
    'header_protection_key',
    'random_trailers',
  ])('does not carry %s, which the peer would have to match', (key) => {
    expect(oneSided()).not.toContain(key);
  });

  it('fills in a default for the parameters it may choose itself', () => {
    const defaults = readNameList(section, 'ONE_SIDED_AMNEZIA_DEFAULTS');
    requireAll(section, [
      'const ONE_SIDED_AMNEZIA_DEFAULTS = {',
      'function fillOneSidedAmneziaDefaults(map, amneziaOptions) {',
      'fillOneSidedAmneziaDefaults(map, amneziaOptions);',
    ]);
    requireAll(defaults.join('\n'), [
      'jc',
      'jmin',
      'jmax',
      'i1',
      'content_padding_addition',
      'rekey_after_time',
      'rekey_timeout',
      'reject_after_time',
      'keepalive_timeout',
      'max_handshake_attempts',
    ]);
    refuseAll(defaults.join('\n'), [
      's1',
      's2',
      's3',
      's4',
      'h1',
      'h2',
      'h3',
      'h4',
      'header_protection_key',
    ]);
  });

  it('does not overwrite a value that is already there', () => {
    expect(readFunction(section, 'fillOneSidedAmneziaDefaults')).toContain(
      'if (!current) {',
    );
  });

  // Filling on the way off would write parameters the endpoint has stopped
  // carrying; never filling leaves the switch doing nothing at all.
  it('fills the defaults when the switch goes on, and only then', () => {
    expect(
      section.match(/if \(value === '1'\) \{\s*fillOneSidedAmneziaDefaults\(/g),
    ).toHaveLength(2);
  });

  it('is a dialog switch, never a stored option', () => {
    const storage = readFunction(section, 'tunnelStorageSettings');
    expect(storage).not.toContain('warp_junk_enabled:');
    expect(storage).not.toContain('wireguard_junk_enabled:');
    requireAll(storage, [
      'const storedAmneziaFields =',
      'oneSidedAmneziaEnabled(kind, settings)',
      'result[`amnezia_${key}`] = storedAmneziaFields.includes(key)',
    ]);
  });

  it('keeps the AmneziaWG parameters when the type changes to WARP', () => {
    expect(section).not.toContain(
      'Object.values(amneziaOptions).forEach((option) =>',
    );
    requireAll(section, [
      'option.retain = true;',
      "let previousTunnelType = `${data.settings.tunnel_type || 'wireguard'}`;",
      "if (previousTunnelType === 'amneziawg') {",
      "setModalOptionValue(map, warpJunkOption, '1');",
      "setModalOptionValue(map, wireguardJunkOption, '1');",
    ]);
  });
});

describe('an endpoint built from the dialog', () => {
  const builder = () => readFunction(section, 'tunnelEndpointFromSettings');

  it('carries its own type and only the parameters its peer accepts', () => {
    requireAll(builder(), [
      'type: kind,',
      '} else if (oneSidedAmneziaEnabled(kind, settings)) {',
    ]);
  });

  it('applies the Amnezia parameters to WARP only while obfuscation is on', () => {
    const body = builder();
    const warp = body.slice(
      body.indexOf("if (kind === 'warp')"),
      body.indexOf('const peers ='),
    );
    requireAll(warp, [
      'const amnezia = tunnelAmneziaSettings(settings, ONE_SIDED_AMNEZIA_FIELDS);',
      'oneSidedAmneziaEnabled(kind, settings)',
    ]);
  });

  it('takes the Amnezia settings from the shared helper', () => {
    expect(section).toContain(
      'endpoint.amnezia = tunnelAmneziaSettings(settings)',
    );
  });
});

describe('importing a configuration', () => {
  it('picks AmneziaWG only for parameters the peer has to match', () => {
    requireAll(readFunction(section, 'applyImportedTunnelEndpoint'), [
      '!ONE_SIDED_AMNEZIA_FIELDS.includes(key)',
      "twoSided ? 'amneziawg' : 'wireguard'",
      'fields.wireguardJunk',
    ]);
  });
});

/* ------------------------------------------------------------- WARP profiles */

describe('a WARP profile', () => {
  it('is generated on the router and written into the fields', () => {
    requireAll(section, [
      "['generate_warp_profile']",
      "_('Generate profile')",
      'setModalOptionValue(map, warpProfileIdOption, profile.id)',
      'setModalOptionValue(map, warpAuthTokenOption, profile.auth_token)',
      'setModalOptionValue(map, warpPrivateKeyOption, profile.private_key)',
      'endpoint.profile = profile',
      'element.triggerValidation();',
      'map.checkDepends();',
      'Registers a device and fills the fields below',
    ]);
  });

  it('takes a WARP+ license key without storing it in the clear', () => {
    requireAll(section, [
      'profile.license_key = `${settings.warp_license_key}`.trim()',
      "_('License key')",
      'Applies WARP+ to the profile account',
      'warpLicenseKeyOption.password = true',
      'warpLicenseKeyOption.rmempty = true',
    ]);
  });

  it('is all three fields or none of them', () => {
    requireAll(section, [
      'profileValues.length !== 3',
      'warpProfileIdOption.rmempty = false',
      'warpAuthTokenOption.rmempty = false',
      'warpPrivateKeyOption.rmempty = false',
    ]);
  });

  // The router's stderr is not a message for the user, and it can carry the
  // account identifiers the request was made with.
  it('reports a failure without repeating what the router said', () => {
    requireAll(section, [
      "_('Forkop Error')",
      'Failed to generate WARP profile.',
    ]);
    expect(section).not.toContain(
      '`${_("WARP profile generation failed")}: ${reason}`',
    );
  });
});

/* ---------------------------------------------------------------- Tailscale */

describe('a Tailscale tunnel', () => {
  it('asks for the account and the device it registers as', () => {
    requireAll(section, [
      "'tailscale_auth_key'",
      "'tailscale_hostname'",
      "'tailscale_control_url'",
      "'tailscale_exit_node'",
      'Auth Key from the Tailscale admin console',
      'The name this device appears under in the Tailscale console',
      "_('Enter a Tailscale exit node')",
      'Accept subnets advertised by other devices in your Tailscale network',
      'exit_node_allow_lan_access: true',
    ]);
  });

  it('can reach its coordination server through a section', () => {
    requireAll(section, [
      "'tailscale_detour_enabled'",
      "'tailscale_detour_section'",
      "_('Coordination server through a section')",
      'tailscaleDetourTag',
    ]);
  });
});

/* ------------------------------------------------------------ JSON endpoint */

describe('a JSON endpoint', () => {
  it('is refused unless it names a supported type and a tag', () => {
    requireAll(section, [
      "'endpoint_json'",
      "_('JSON endpoint must contain a non-empty type')",
      "_('JSON endpoint must contain a non-empty tag')",
      'const JSON_ENDPOINT_TYPES = new Set([',
      'JSON_ENDPOINT_TYPES.has(endpoint.type.trim())',
      "_('Unsupported JSON endpoint type')",
      'endpointJsonOption.placeholder = JSON_ENDPOINT_PLACEHOLDER',
    ]);
  });
});

/* -------------------------------------------------------------- the leftovers */

describe('the dialog', () => {
  it('reads the value of the item being edited', () => {
    requireAll(section, [
      'this.formvalue(_itemId)',
      '{ singleField: true }',
      "mtuOption.placeholder = '1408'",
      'Required. Remote nodes to connect to',
      "_('Tunnel name')",
    ]);
  });

  it('removes an empty child list setting instead of writing it', () => {
    const apply = readFunction(section, 'applyChildItemSettings');
    expect(apply).toContain('if (values.length) {');
    expect(
      apply.match(/uci\.unset\(FORKOP_UCI_PACKAGE, itemId, key\)/g),
    ).toHaveLength(2);
  });

  it.each([
    'AmneziaWG / WireGuard',
    '"amnezia_enabled"',
    '"peers_json"',
    'WARP profile generated',
    'Try again or check the Forkop log.',
    'does not support WARP profile generation',
    'WARP profile generation failed with HTTP',
    'did not return a WARP profile',
    'Numeric AmneziaWG obfuscation parameter from the client profile.',
    'AmneziaWG packet header size or range from the client profile.',
    'AmneziaWG packet header template from the client profile.',
    'Fill all WARP profile fields or leave all of them empty',
    'Choose WireGuard, AmneziaWG, or Cloudflare WARP.',
    'Add one or more WireGuard peers and configure each one separately.',
    'placeholder = "30"',
    'placeholder = "100 or 100-200"',
    'Junk packet obfuscation',
    'Traffic masking',
    'Adds AmneziaWG traffic obfuscation to make the traffic harder to identify.',
    'Leave empty to use the core default.',
    'Leave empty to let sing-box choose it.',
    '"tailscale_exit_node_allow_lan_access"',
    'Allow LAN access through exit node',
    '"j1"',
    '"j2"',
    '"j3"',
    '"itime"',
  ])('keeps no trace of the removed %s', (obsolete) => {
    expect(section).not.toContain(obsolete);
  });
});
