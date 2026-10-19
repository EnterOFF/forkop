// What the page offers is what the installed sing-box can run, read off the tags
// the core was built with. A choice the core lacks is not offered, and one a
// configuration already holds stays - marked, and refused on save by name - so
// neither a save nor the router loses it without the user seeing why.
import { beforeEach, describe, expect, it } from 'vitest';

import { coreFeatures } from '../lib/coreFeatures.js';
import { createHarness } from '../lib/luciForm.js';

const base = () => coreFeatures();
const without = (...tags) => coreFeatures({ remove: tags });

let harness;

beforeEach(() => {
  harness = createHarness();
});

function addSections(list) {
  list.forEach(([type, sid, values]) => {
    harness.uci.add('forkop', type, sid);
    Object.assign(harness.store.get(sid), values);
  });
  harness.operations.length = 0;
}

function grid(type, build) {
  const map = new harness.form.Map('forkop');
  const section = map.section(harness.form.GridSection, type);
  build(section);
  return section;
}

const option = (section, name) =>
  section.children.find((child) => child.option === name);

describe('the Servers tab', () => {
  it('offers only the protocols the core has', async () => {
    harness.bundle.setCoreFeatures(without('with_quic'));
    addSections([['server', 'srv', { protocol: 'vless' }]]);
    const servers = grid('server', (s) =>
      harness.bundle.createServerContent(s),
    );
    const protocol = option(servers, 'protocol');

    await protocol.load('srv');

    expect(protocol.keylist).toEqual(
      expect.arrayContaining(['mixed', 'vless', 'naive', 'mieru']),
    );
    for (const missing of ['hysteria2', 'tuic', 'tailscale'])
      expect(protocol.keylist).not.toContain(missing);
  });

  it('keeps a stored protocol the core lacks, marked, and refuses it on save', async () => {
    harness.bundle.setCoreFeatures(without('with_quic'));
    addSections([['server', 'srv', { protocol: 'hysteria2' }]]);
    const servers = grid('server', (s) =>
      harness.bundle.createServerContent(s),
    );
    const protocol = option(servers, 'protocol');

    await protocol.load('srv');

    const index = protocol.keylist.indexOf('hysteria2');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(protocol.vallist[index]).toBe(
      'Hysteria2 (the installed sing-box lacks with_quic)',
    );
    expect(protocol.validate('srv', 'hysteria2')).toBe(
      'sing-box is built without with_quic',
    );
    expect(option(servers, '_protocol_display').textvalue('srv')).toBe(
      'Hysteria2 (the installed sing-box lacks with_quic)',
    );
  });

  it('asks for uTLS for Reality and for QUIC for NaiveProxy over UDP', () => {
    harness.bundle.setCoreFeatures(without('with_utls', 'with_quic'));
    addSections([['server', 'srv', { protocol: 'vless' }]]);
    const servers = grid('server', (s) =>
      harness.bundle.createServerContent(s),
    );

    expect(option(servers, 'security').validate('srv', 'reality')).toBe(
      'sing-box is built without with_utls',
    );
    expect(option(servers, 'security').validate('srv', 'tls')).toBe(true);
    expect(option(servers, 'naive_network').validate('srv', 'udp')).toBe(
      'sing-box is built without with_quic',
    );
    expect(option(servers, 'naive_network').validate('srv', 'tcp')).toBe(true);
  });

  it('refuses nothing the base build has', () => {
    harness.bundle.setCoreFeatures(base());
    addSections([['server', 'srv', { protocol: 'vless' }]]);
    const servers = grid('server', (s) =>
      harness.bundle.createServerContent(s),
    );

    expect(option(servers, 'protocol').validate('srv', 'hysteria2')).toBe(true);
    expect(option(servers, 'security').validate('srv', 'reality')).toBe(true);
    expect(option(servers, 'protocol').validate('srv', 'tailscale')).toBe(
      'sing-box is built without with_tailscale',
    );
  });
});

describe('the Sections tab', () => {
  function sections() {
    return grid('section', (s) => {
      harness.bundle.configureSectionSection(s, {
        loadActionProvidersAvailability: () =>
          Promise.resolve({
            zapretInstalled: false,
            zapret2Installed: false,
            byedpiInstalled: false,
          }),
      });
      delete s.load;
      harness.bundle.createSectionContent(s);
    });
  }

  it('lists and takes only the links the core can dial', () => {
    harness.bundle.setCoreFeatures(base());
    const links = option(sections(), 'connection_link');

    expect(links.description).toBe(
      'Supported URIs: vless, vmess, shadowsocks, trojan, socks, tuic, hysteria, mieru, anytls',
    );
    expect(links.validate('sec', 'naive+https://u:p@example.com:443#n')).toBe(
      'sing-box is built without with_naive_outbound',
    );
    expect(links.validate('sec', 'hy2://p@example.com:443#h')).toBe(true);
  });

  it('names only the tunnel kinds the core has', () => {
    harness.bundle.setCoreFeatures(base());
    expect(option(sections(), 'tunnels').description).toBe(
      'Available: WireGuard, AmneziaWG, Cloudflare WARP, OpenVPN, JSON endpoint',
    );

    harness.bundle.setCoreFeatures(coreFeatures({ add: ['with_tailscale'] }));
    expect(option(sections(), 'tunnels').description).toBe(
      'Available: WireGuard, AmneziaWG, Cloudflare WARP, Tailscale, OpenVPN, JSON endpoint',
    );
  });

  it('marks a section whose tunnel the core lacks', () => {
    harness.bundle.setCoreFeatures(without('with_wireguard'));
    addSections([
      ['section', 'sec', { action: 'connection', enabled: '1', label: 'Home' }],
      ['tunnel', 'tun', { section: 'sec', kind: 'wireguard', name: 'WG' }],
    ]);

    expect(option(sections(), '_action_display').cfgvalue('sec')).toBe(
      'Connection (the installed sing-box lacks with_wireguard)',
    );
  });

  it('offers a new tunnel only the kinds the core has', async () => {
    harness.bundle.setCoreFeatures(without('with_wireguard'));
    addSections([
      ['section', 'sec', { action: 'connection', enabled: '1', label: 'Home' }],
    ]);
    const dialog = await harness.openDialog(
      option(sections(), 'tunnels'),
      'sec',
      '',
      { adding: true },
    );
    const kind = option(dialog.map.children[0], 'tunnel_type');

    expect(kind.keylist).toEqual(['openvpn-client', 'json']);
    expect(await kind.load('settings')).toBe('openvpn-client');
  });
});

describe('the Settings tab', () => {
  function settings() {
    const map = new harness.form.Map('forkop');
    const section = map.section(harness.form.TypedSection, 'settings');
    section.cfgsections = () => ['settings'];
    harness.bundle.createSettingsContent(section);
    return section;
  }

  it('shows the sing-box dashboard only with the API service, or while it is on', async () => {
    harness.bundle.setCoreFeatures(base());
    addSections([['settings', 'settings', {}]]);
    let dashboard = option(settings(), 'enable_native_api');
    dashboard.cfgvalue('settings', '0');
    expect(dashboard.checkDepends('settings')).toBe(false);

    dashboard.cfgvalue('settings', '1');
    expect(dashboard.checkDepends('settings')).toBe(true);
    expect(dashboard.validate('settings', '1')).toBe(
      'sing-box is built without with_api',
    );
    expect(dashboard.validate('settings', '0')).toBe(true);

    harness.bundle.setCoreFeatures(coreFeatures({ add: ['with_api'] }));
    dashboard = option(settings(), 'enable_native_api');
    dashboard.cfgvalue('settings', '0');
    expect(dashboard.checkDepends('settings')).toBe(true);
    expect(dashboard.validate('settings', '1')).toBe(true);
  });

  it('offers WARP profile requests through a section only with WARP, or while they are on', () => {
    harness.bundle.setCoreFeatures(without('with_wireguard'));
    addSections([['settings', 'settings', {}]]);
    let flag = option(settings(), 'warp_profiles_via_proxy');
    flag.cfgvalue('settings', '0');
    expect(flag.checkDepends('settings')).toBe(false);

    flag.cfgvalue('settings', '1');
    expect(flag.checkDepends('settings')).toBe(true);
    expect(flag.validate('settings', '1')).toBe(
      'sing-box is built without with_wireguard',
    );
    expect(flag.validate('settings', '0')).toBe(true);

    harness.bundle.setCoreFeatures(base());
    flag = option(settings(), 'warp_profiles_via_proxy');
    flag.cfgvalue('settings', '0');
    expect(flag.checkDepends('settings')).toBe(true);
    expect(flag.validate('settings', '1')).toBe(true);
  });

  it('asks for QUIC for DNS over QUIC and over HTTP/3', () => {
    harness.bundle.setCoreFeatures(without('with_quic'));
    addSections([['settings', 'settings', {}]]);
    const dns = option(settings(), 'dns_server');

    expect(dns.description).toBe(
      'Several servers give automatic failover. The protocol is set by a prefix: udp://, tcp://, tls://, https://',
    );
    expect(dns.validate('settings', 'quic://dns.example.com')).toBe(
      'sing-box is built without with_quic',
    );
    expect(dns.validate('settings', 'h3://1.1.1.1/dns-query')).toBe(
      'sing-box is built without with_quic',
    );
    expect(dns.validate('settings', 'tls://1.1.1.1')).toBe(true);
  });
});
