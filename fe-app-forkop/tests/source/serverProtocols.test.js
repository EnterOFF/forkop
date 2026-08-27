// The Servers tab: fourteen inbound protocols, the fields each one needs, and
// the details dialog that hands a client its link.
//
// A server writes a sing-box inbound directly, so the shape of this dialog is the
// shape of the configuration - which is why so much of it is pinned here. The
// recurring themes: a protocol that cannot run without TLS must not offer another
// mode; nothing is generated until the user asks for it; and a value the dialog
// invents has to be written through autofill(), because LuCI keeps whatever
// load() returned as the option's stored value and a value equal to that is never
// saved.
import fs from 'fs';

import { describe, expect, it } from 'vitest';

import { SRC, VIEW_DIR } from '../lib/paths.js';
import { tabSource } from '../lib/tabSource.js';

const source = await tabSource('servers');
const entry = await tabSource('entry');
const section = await tabSource('sections');

// A needle is compared with the line breaks taken out: these checks are about
// what the code says, not about where a long line happens to wrap.
const flatten = (text) => text.replace(/\s+/g, ' ');
const flatSource = flatten(source);
const says = (needle) => flatSource.includes(flatten(needle));

/* -------------------------------------------------------------- the protocols */

describe('the protocol table', () => {
  it.each([
    'naive',
    'ssh',
    'mieru',
    'anytls',
    'tuic',
    'mixed',
    'shadowsocks',
    'mtproto',
    'tailscale',
    'vless',
    'vmess',
    'trojan',
    'hysteria2',
    'json_inbound',
  ])('describes %s', (protocol) => {
    expect(says(`id: '${protocol}'`)).toBe(true);
  });

  it.each([
    'naive',
    'ssh',
    'mieru',
    'tuic',
    'mixed',
    'shadowsocks',
    'mtproto',
    'tailscale',
    'hysteria2',
    'json_inbound',
  ])('reaches the fields of %s through depends()', (protocol) => {
    expect(says(`depends('protocol', '${protocol}')`)).toBe(true);
  });

  // A protocol that cannot run without TLS must not offer any other mode.
  it.each([
    ['naive', "['tls']"],
    ['anytls', "['tls']"],
    ['tuic', "['tls']"],
    ['hysteria2', "['tls']"],
    ['vless', "['reality', 'tls', 'none']"],
    ['vmess', "['tls', 'none']"],
    ['mixed', "['none']"],
    ['shadowsocks', "['none']"],
  ])('offers %s exactly %s', (protocol, securities) => {
    const block = source.slice(source.indexOf(`id: '${protocol}'`));
    expect(block.slice(0, block.indexOf('credentials:'))).toContain(
      `securities: ${securities}`,
    );
  });

  // A plain local proxy is what most people set up first, so Mixed leads the
  // list and the raw JSON inbound stays last.
  it('leads with Mixed and ends with the raw JSON inbound', () => {
    const order = [...source.matchAll(/^\s*id: '([A-Za-z0-9_]+)'/gm)].map(
      (match) => match[1],
    );
    expect(order[0]).toBe('mixed');
    expect(order.at(-1)).toBe('json_inbound');
    expect(order).not.toContain('socks');
  });

  it('calls the mixed inbound Mixed', () => {
    expect(says("label: _('SOCKS5 / HTTP')")).toBe(false);
  });

  it.each([
    'naive_network',
    'ssh_host_key_path',
    'mieru_transport',
    'tuic_congestion_control',
    'tuic_zero_rtt_handshake',
    'hysteria2_masquerade',
    'tailscale_ephemeral',
    'tcp_fast_open',
    'open_firewall',
    'routing_override',
  ])('asks for %s', (option) => {
    expect(says(`'${option}'`)).toBe(true);
  });

  // Either a working core default that never decides whether a client connects,
  // or a value Forkop now fixes itself.
  it.each([
    'mtproto_concurrency',
    'mtproto_prefer_ip',
    'mtproto_auto_update',
    'mtproto_allow_fallback_on_unknown_dc',
    'mtproto_tolerate_time_skewness',
    'mtproto_idle_timeout',
    'mtproto_handshake_timeout',
    'mtproto_domain_fronting_port',
    'mtproto_domain_fronting_ip',
    'mtproto_domain_fronting_proxy_protocol',
    'tuic_auth_timeout',
    'naive_quic_congestion_control',
    'mieru_user_hint_mandatory',
    'reality_max_time_difference',
    'tailscale_advertise_exit_node',
  ])('no longer asks for %s', (option) => {
    expect(says(`'${option}'`)).toBe(false);
  });

  it.each([
    'const JSON_INBOUND_TYPES = new Set([',
    '!JSON_INBOUND_TYPES.has(type)',
  ])('checks a pasted inbound type: %s', (needle) => {
    expect(says(needle)).toBe(true);
  });

  // Pasting a whole inbound is the point of the field, and a tag comes with it.
  // Forkop overwrites the tag with the server name instead of refusing the paste.
  it('overwrites a pasted tag rather than refusing the paste', () => {
    expect(says('Remove the tag field')).toBe(false);
  });
});

// The tab is a directory of TypeScript modules inside the bundle. Nothing of it
// may go back to being a LuCI view module of its own: a browser caches each of
// those separately, and an upgrade then leaves one beside a bundle that no longer
// matches it.
describe('the tab', () => {
  it('ships only inside the bundle', () => {
    expect(
      fs.readdirSync(VIEW_DIR).filter((name) => /^server.*\.js$/.test(name)),
    ).toEqual([]);
  });

  it.each([
    'singBoxExtended',
    'singBoxTiny',
    'singBoxTailscale',
    'normalizeServerCapabilities',
    'getDefaultProtocolForCapabilities',
    'applyServerCapabilities',
    'getServerCapabilities',
    'EXTENDED_PORT_PROTOCOLS',
    'mtproto_padding',
  ])('keeps no sing-box capability branch: %s', (legacy) => {
    expect(says(legacy)).toBe(false);
    expect(entry).not.toContain(legacy);
  });

  it('keeps no legacy sing-box variant code anywhere in the frontend', () => {
    const walk = (dir, out = []) => {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${item.name}`;
        if (item.isDirectory()) walk(full, out);
        else out.push(fs.readFileSync(full, 'utf8'));
      }
      return out;
    };
    expect(walk(SRC).join('\n')).not.toMatch(
      /singBoxVariant|sing_box_(extended|tiny|tailscale)|GET_SERVER_CAPABILITIES|GetServerCapabilities|Install another build|startsWith\('install_/,
    );
  });
});

/* ------------------------------------------------------------------ accounts */

// Accounts are child sections edited with the same widget the Sections tab uses
// for interfaces, URLTests and tunnels, so both tabs behave the same way.
describe('the accounts of a server', () => {
  it.each([
    "const CLIENT_TYPE = 'server_client'",
    "const CLIENT_OWNER_OPTION = 'server'",
    'ButtonAddSettingsDynamicList',
    'showChildItemSettingsModal',
    'o.childType = CLIENT_TYPE',
    'o.ownerOption = CLIENT_OWNER_OPTION',
    'xtls-rprx-vision',
  ])('use the shared child item widget: %s', (needle) => {
    expect(says(needle)).toBe(true);
  });

  it.each([
    'ButtonAddSettingsDynamicList,',
    'showChildItemSettingsModal,',
    'childPendingSettingsStore,',
  ])('take %s from the shared layer', (shared) => {
    expect(section).toContain(shared);
  });

  it.each([
    "'server_uuid'",
    "'server_password'",
    "'server_username'",
    "'socks_auth_enabled'",
    "'vmess_alter_id'",
  ])('keep the credentials out of the server itself: %s', (removed) => {
    expect(says(removed)).toBe(false);
  });

  // A numbered client name, so a client never inherits the server name, one past
  // the count the way a new section is named.
  it('are named one past the count', () => {
    expect(says("return 'client-%d'.format(taken.length + 1);")).toBe(true);
  });

  it('show their name rather than the section id they are stored as', () => {
    expect(says('o.renderListItemLabel = function (sectionId, value) {')).toBe(
      true,
    );
  });

  // Turning the switch on has to leave the account where the server already is.
  // A different starting mode makes the switch silently reroute the account the
  // moment it is enabled.
  it('start on the rules their server follows', () => {
    const block = source.slice(
      source.indexOf('  const mode = itemSection.option('),
      source.indexOf('  const target = itemSection.option('),
    );
    expect(block).toContain("mode.default = 'rules';");
  });
});

/* --------------------------------------------------------- generated values */

describe('the option blocks', () => {
  const blocks = source
    .split('section.option(')
    .slice(1)
    .map((block) => {
      const name = block.match(/'([a-z0-9_]+)'/);
      return { name: name ? name[1] : '', body: block };
    });

  const optionBlock = (name) => {
    const found = blocks.find((entry) => entry.name === name);
    expect(
      found,
      `option is absent from the server form: ${name}`,
    ).toBeTruthy();
    return found.body;
  };

  it.each([
    'tailscale_auth_key',
    'reality_private_key',
    'hysteria2_obfs_password',
    'shadowsocks_psk',
  ])('render %s as a password field', (secret) => {
    expect(optionBlock(secret)).toContain('o.password = true');
  });

  // Nothing is generated until the user asks for it, so every value that used to
  // be invented now has a button and no default.
  it.each([
    'listen_port',
    'shadowsocks_psk',
    'hysteria2_obfs_password',
    'reality_short_id',
    'tls_server_name',
    'mtproto_faketls',
  ])('offer a generate button for %s, and no default', (generated) => {
    const body = optionBlock(generated);
    expect(
      body.includes('addGenerateButton(') ||
        body.includes('addRealityKeypairButton('),
    ).toBe(true);
    expect(body).not.toMatch(/o\.default = '/);
  });

  it('generate the Reality key pair from its own button', () => {
    expect(optionBlock('reality_private_key')).toContain(
      'addRealityKeypairButton(',
    );
  });

  // LuCI keeps whatever load() returned as the stored value of an option, so a
  // value the dialog generates by itself compares equal on save and is never
  // written: that is how a server ended up with no port, no public host and no
  // Reality identity.
  it('write every generated value through autofill()', () => {
    expect(
      says(
        'function autofill(option, loader) {\n  option.forcewrite = true;\n  option.load = loader;\n}',
      ),
    ).toBe(true);
    for (const name of [
      'listen_port',
      'public_host',
      'shadowsocks_psk',
      'hysteria2_obfs_password',
      'tls_server_name',
      'reality_private_key',
      'reality_public_key',
      'reality_short_id',
      'mtproto_faketls',
    ]) {
      expect(optionBlock(name), name).toContain('autofill(');
    }
  });

  // Only an option that reads what is already stored may set load() directly.
  it('let only a reader set load() directly', () => {
    const allowed = new Set(['tailscale_detour_section', 'routing_section']);
    const direct = [];
    let at = source.indexOf('\n  o.load = ');
    while (at >= 0) {
      const opened = source.lastIndexOf('section.option(', at);
      const name = /'([a-z0-9_]+)'/.exec(source.slice(opened, opened + 200));
      const found = name ? name[1] : String(at);
      if (!allowed.has(found)) direct.push(found);
      at = source.indexOf('\n  o.load = ', at + 1);
    }
    expect(direct.join(', ')).toBe('');
  });

  // Opening the dialog must not touch the configuration.
  it('never write from a load handler', () => {
    for (const match of source.matchAll(
      /o\.load = (function[\s\S]*?\n {2}\};|\([\s\S]*?\);)/g,
    )) {
      expect(match[1]).not.toContain('uci.set(');
    }
  });
});

describe('the camouflage list', () => {
  const hosts = (() => {
    const start = source.indexOf('const CAMOUFLAGE_SITES = [');
    expect(start, 'the camouflage list is missing').toBeGreaterThanOrEqual(0);
    const block = source.slice(start, source.indexOf('];', start));
    return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  })();

  it('is long enough to be a choice', () => {
    expect(hosts.length).toBeGreaterThanOrEqual(5);
  });

  // A camouflage host is a suggestion the picker offers, never a stored default.
  it.each(hosts)('offers %s without storing it', (host) => {
    expect(source.split(host)).toHaveLength(2);
    expect(says(`o.default = '${host}'`)).toBe(false);
  });
});

describe('the field checks', () => {
  it.each([
    'Use an even number of hex digits, for example 0a1b2c3d',
    'A short ID holds at most 16 hex digits',
    'function validateListenPort',
    'Port %s is already used by %s',
  ])('explain a refusal: %s', (needle) => {
    expect(says(needle)).toBe(true);
  });

  // A widget is found by the id of the frame it renders, which every widget
  // carries. Only some of them also name the inner control widget.<cbid>: a
  // checkbox puts that in data-widget-id, so looking for the control found
  // nothing for a flag and every reader silently answered from the stored value
  // instead of the open dialog.
  it('find a widget by its frame id', () => {
    expect(says('function widgetNode(sectionId, name) {')).toBe(true);
    expect(says('widget.cbid')).toBe(false);
  });

  // A failed save is already reported on the offending field.
  it.each([
    'showServerValidationMessage',
    'fkp-server-validation-summary',
    'Cannot save server',
  ])('add no banner: %s', (removed) => {
    expect(says(removed)).toBe(false);
  });
});

/* ------------------------------------------------------------- the row table */

describe('the server table', () => {
  // The table stays down to the switch and the protocol; the rest belongs in the
  // dialog.
  it.each(['_endpoint_display', '_clients_display'])(
    'shows no %s column',
    (removed) => {
      expect(says(removed)).toBe(false);
    },
  );

  it.each([
    'nextSectionId(sectionRef.sectiontype)',
    "sectionRef.map.data.set(configName, sectionId, 'label', label)",
    'addLabeledSection(this)',
    "click: ui.createHandlerFn(sectionRef, 'handleAdd')",
    'return this.renderMoreOptionsModal(sectionId)',
  ])('creates a labelled row: %s', (needle) => {
    expect(entry).toContain(needle);
  });

  it('asks for no name before adding a row', () => {
    expect(entry).not.toContain('cbi-section-create-name');
  });

  it('hands a freshly added section to its tab', () => {
    expect(says('function prepareAddedServer(sectionId) {')).toBe(true);
    expect(entry).toContain('onSectionAdded?.(sectionId)');
  });

  // Add creates the section before the dialog is filled in, and nothing writes
  // the enable switch until the dialog is saved: a server without one counts as
  // disabled, so an abandoned one is skipped by the validator and the generator.
  it('leaves the enable switch unwritten until the dialog is saved', () => {
    expect(says("uci.set(FORKOP_UCI_PACKAGE, sectionId, 'enabled'")).toBe(
      false,
    );
    expect(says('addedServers.add(sectionId);')).toBe(true);
    expect(says('addedServers.delete(sectionId);')).toBe(true);
    expect(says("uci.unset(FORKOP_UCI_PACKAGE, sectionId, 'enabled');")).toBe(
      true,
    );
  });
});

/* ---------------------------------------------------------- the details dialog */

describe('the details dialog', () => {
  it('names the server and shows one block per account', () => {
    expect(
      says("_('Server details: %s').format(getServerName(sectionId))"),
    ).toBe(true);
    expect(says('function renderLinkRow(value, qrTitle) {')).toBe(true);
    expect(says('function linkTitle(sectionId, client, scheme) {')).toBe(true);
    expect(says('fkp-qr__link')).toBe(true);
  });

  // Everything the old block restated - the protocol, the address, the security,
  // the transport - is already inside the link the same dialog shows.
  it.each([
    'Copy all links',
    'fkp-server-info__tab',
    'Connect to this server',
    'private or reserved',
    'serverFactRows',
    'renderFacts',
    'fkp-details__facts',
    'clientFactRows',
    'clientConnectRows',
    'clientRoutingLabel',
  ])('carries no %s', (removed) => {
    expect(says(removed)).toBe(false);
  });

  // The theme widens .modal.cbi-modal to the size of a settings form, and the
  // URLTest and Fallback details are opened without that class, which is what
  // makes them the width they are. This dialog takes the same width by being
  // opened the same way, so it must not ask for cbi-modal or size itself.
  it('inherits the plain modal width', () => {
    const opens = source.slice(
      source.indexOf('function showServerDetailsModal'),
    );
    expect(opens.slice(0, opens.indexOf('loadLinkContext'))).not.toMatch(
      /cbi-modal/,
    );
    expect(source).not.toMatch(
      /'[^']*\.modal[^']*max-(?:width|inline-size)[^']*'/,
    );
  });

  // LuCI spreads the class arguments into classList.add(), which rejects a token
  // with a space in it, so a joined class list throws and the button opens
  // nothing.
  it('passes its modal classes as separate arguments', () => {
    expect(source).not.toMatch(/`cbi-modal \$\{/);
    expect(says('cbi-modal ${')).toBe(false);
  });

  it('closes on the right, where the theme puts a lone button', () => {
    expect(says('.fkp-details-actions{justify-content:flex-end')).toBe(true);
  });

  // One account is separated from the next by its own name and by space.
  it('separates accounts without a rule', () => {
    expect(source).not.toMatch(/fkp-details__client\{[^']*border/);
  });

  // Only a server whose accounts can be handed a link has details to show, which
  // leaves out SSH, Tailscale and a JSON inbound without naming any of them.
  it('is offered only where a link can be handed out', () => {
    expect(
      says(
        'usesClients(getProtocol(sectionId)) && linkScheme(getProtocol(sectionId))',
      ),
    ).toBe(true);
  });

  // A link carrying Reality parameters is only scannable at a size that would
  // push the rest of the dialog out of view, so the code is shown on request.
  it('shows a QR code on request rather than beside every account', () => {
    expect(says('function showQrModal(title, link) {')).toBe(true);
    expect(says('function renderQrButton(title, link) {')).toBe(true);
    expect(source).not.toMatch(/fkp-details__qr/);
  });

  // A copy control stays a copy control; the toast reports the result.
  it('does not turn the copy control into a tick', () => {
    expect(source).not.toMatch(/iconSvg\(copied \? 'check'/);
    expect(says("'check'")).toBe(false);
  });

  // A listener that asks for nothing still has a link: the address without an
  // account.
  it('offers the links of a server without authentication', () => {
    expect(says('function anonymousClient() {')).toBe(true);
    expect(
      says('This server accepts everybody, so it has no client links.'),
    ).toBe(false);
  });
});

// sing-box only ever sees the public half, and keeping the private one is not
// Forkop's business.
it('generates no SSH client key pairs', () => {
  expect(source).not.toMatch(/ssh.?keypair|SSH key pair|showSshPrivateKey/i);
});
