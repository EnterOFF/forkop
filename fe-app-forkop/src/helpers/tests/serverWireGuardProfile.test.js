import { describe, expect, it } from 'vitest';

import { installLuciStubs } from './luciStubs';
import { parseWireGuardConfig } from '../parseWireGuardConfig';
import { qrSvgDataUri } from '../../forkop/tabs/servers/qr';
import { buildWireGuardProfile } from '../../forkop/tabs/servers/profile';
import {
  freeTunnelSubnet,
  subnetContains,
  subnetOf,
} from '../../forkop/tabs/servers/form/tunnel';

const SERVER_PUBLIC = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
const CLIENT_PRIVATE = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=';
const PRESHARED = 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=';
const PROTECTION = 'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ=';
const SIGNATURE =
  '<r 2><b 0x858000010001000000000669636c6f756403636f6d0000010001c00c000100010000105a00044d583737>';

const CLIENT = {
  id: 'phone',
  name: 'Phone',
  uuid: '',
  password: '',
  flow: '',
};

// What prepare leaves in the configuration the router holds for an AmneziaWG
// server: the reference parameters, the junk the dialog filled in, and a key
// pair, a pre-shared key and an address in each subnet for the client.
const AMNEZIA = {
  amnezia_jc: '5',
  amnezia_jmin: '10',
  amnezia_jmax: '50',
  amnezia_s1: '12',
  amnezia_s2: '12',
  amnezia_s3: '12',
  amnezia_s4: '12',
  amnezia_h1: '1',
  amnezia_h2: '2',
  amnezia_h3: '3',
  amnezia_h4: '4',
  amnezia_i1: SIGNATURE,
  amnezia_header_protection_key: PROTECTION,
  amnezia_rekey_after_time: '100-120',
  amnezia_rekey_timeout: '3-7',
  amnezia_reject_after_time: '150-180',
  amnezia_keepalive_timeout: '5-15',
  amnezia_max_handshake_attempts: '15-20',
  amnezia_random_trailers: '1',
  amnezia_disable_cookies: '1',
};

function material(server = {}, client = {}) {
  return {
    home: { wireguard_public_key: SERVER_PUBLIC, ...server },
    phone: {
      wireguard_private_key: CLIENT_PRIVATE,
      wireguard_pre_shared_key: PRESHARED,
      wireguard_address: ['10.8.0.2/32', 'fd00:8::2/128'],
      ...client,
    },
  };
}

function load(server = {}) {
  installLuciStubs({
    home: {
      '.type': 'server',
      label: 'Home',
      protocol: 'wireguard',
      listen_port: '51820',
      public_host: '2001:db8::1',
      tunnel_address: ['10.8.0.1/24', 'fd00:8::1/64'],
      ...server,
    },
  });
}

describe('a WireGuard profile', () => {
  // A code carries no character set of its own, and scanners guess one for
  // anything past ASCII, so the profile is plain ASCII and the names go into
  // the file name alone.
  it('is the configuration a WireGuard app imports, named for its interface', () => {
    load();
    const result = buildWireGuardProfile('home', CLIENT, material());
    expect(result.fileName).toBe('Home-Phone.conf');
    expect(result.type).toBe('text/plain');
    expect(result.profile).toBe(
      [
        '[Interface]',
        `PrivateKey = ${CLIENT_PRIVATE}`,
        'Address = 10.8.0.2/32, fd00:8::2/128',
        'DNS = 10.8.0.1, fd00:8::1',
        '',
        '[Peer]',
        `PublicKey = ${SERVER_PUBLIC}`,
        `PresharedKey = ${PRESHARED}`,
        'AllowedIPs = 0.0.0.0/0, ::/0',
        'Endpoint = [2001:db8::1]:51820',
        'PersistentKeepalive = 25',
        '',
      ].join('\n'),
    );
  });

  it('is read back by the tunnel import as the same server', () => {
    load();
    const { profile } = buildWireGuardProfile('home', CLIENT, material());
    expect(parseWireGuardConfig(profile)).toEqual({
      valid: true,
      endpoint: {
        type: 'wireguard',
        address: ['10.8.0.2/32', 'fd00:8::2/128'],
        private_key: CLIENT_PRIVATE,
        peers: [
          {
            address: '2001:db8::1',
            port: 51820,
            public_key: SERVER_PUBLIC,
            pre_shared_key: PRESHARED,
            allowed_ips: ['0.0.0.0/0', '::/0'],
            persistent_keepalive_interval: 25,
          },
        ],
      },
    });
  });

  // wg-quick adds a route for every AllowedIPs entry, and ip refuses one with
  // host bits set.
  it('routes only the routes and the tunnel subnets while not all traffic goes through it', () => {
    load({ tunnel_all_traffic: '0', tunnel_routes: ['192.168.1.0/24'] });
    expect(buildWireGuardProfile('home', CLIENT, material()).profile).toContain(
      'AllowedIPs = 192.168.1.0/24, 10.8.0.0/24, fd00:8::/64',
    );
  });

  it('says what is missing before the router issued it or while the subnet changed', () => {
    load();
    expect(buildWireGuardProfile('home', CLIENT, {})).toEqual({
      missing: 'keys',
    });
    expect(
      buildWireGuardProfile(
        'home',
        CLIENT,
        material({}, { wireguard_address: ['10.9.0.2/32', 'fd00:8::2/128'] }),
      ),
    ).toEqual({ missing: 'keys' });
    load({ public_host: '', listen_port: '' });
    expect(buildWireGuardProfile('home', CLIENT, material())).toEqual({
      missing: 'address',
    });
  });

  it('gives a tunnel name WireGuard takes, whatever the names are', () => {
    load({ label: 'Дом' });
    expect(
      buildWireGuardProfile(
        'home',
        { ...CLIENT, name: 'Телефон Маши' },
        material(),
      ).fileName,
    ).toBe('wireguard.conf');
    load({ label: 'Summer house' });
    expect(
      buildWireGuardProfile(
        'home',
        { ...CLIENT, name: 'laptop-of-alexander' },
        material(),
      ).fileName,
    ).toBe('laptop-of-alexa.conf');
  });
});

describe('an AmneziaWG profile', () => {
  it('carries every parameter of its server, as the Amnezia client writes them', () => {
    load({ protocol: 'amneziawg' });
    const { profile } = buildWireGuardProfile(
      'home',
      CLIENT,
      material(AMNEZIA),
    );
    const lines = profile.split('\n');
    expect(lines.slice(4, 26)).toEqual([
      'MTU = 1280',
      'Jc = 5',
      'Jmin = 10',
      'Jmax = 50',
      'S1 = 12',
      'S2 = 12',
      'S3 = 12',
      'S4 = 12',
      'H1 = 1',
      'H2 = 2',
      'H3 = 3',
      'H4 = 4',
      `I1 = ${SIGNATURE}`,
      `HeaderProtectionKey = ${PROTECTION}`,
      'RekeyAfterTime = 100-120',
      'RekeyTimeout = 3-7',
      'RejectAfterTime = 150-180',
      'KeepaliveTimeout = 5-15',
      'MaxHandshakeAttempts = 15-20',
      'RandomTrailers = on',
      'DisableCookies = on',
      '',
    ]);
    expect(profile).toContain('PersistentKeepalive = 25-35');
  });

  it('is read back by the tunnel import as an AmneziaWG tunnel with the same parameters', () => {
    load({ protocol: 'amneziawg' });
    const { profile } = buildWireGuardProfile(
      'home',
      CLIENT,
      material(AMNEZIA),
    );
    const parsed = parseWireGuardConfig(profile);
    expect(parsed.valid).toBe(true);
    expect(parsed.endpoint.mtu).toBe(1280);
    expect(parsed.endpoint.amnezia).toEqual({
      jc: 5,
      jmin: 10,
      jmax: 50,
      s1: 12,
      s2: 12,
      s3: 12,
      s4: 12,
      h1: 1,
      h2: 2,
      h3: 3,
      h4: 4,
      i1: SIGNATURE,
      header_protection_key: PROTECTION,
      rekey_after_time: '100-120',
      rekey_timeout: '3-7',
      reject_after_time: '150-180',
      keepalive_timeout: '5-15',
      max_handshake_attempts: '15-20',
      random_trailers: true,
      disable_cookies: true,
    });
  });

  it('waits for the parameters the router issues', () => {
    load({ protocol: 'amneziawg' });
    expect(buildWireGuardProfile('home', CLIENT, material())).toEqual({
      missing: 'keys',
    });
  });

  // The longest profile the dialog makes: every parameter, a signature packet
  // in each of the five fields, both families and a long host.
  it('fits a QR code a phone reads', () => {
    load({
      protocol: 'amneziawg',
      label: 'Загородный дом',
      public_host: 'vpn.a-rather-long-domain-name.example.org',
    });
    const five = Object.fromEntries(
      ['i1', 'i2', 'i3', 'i4', 'i5'].map((key) => [
        `amnezia_${key}`,
        SIGNATURE,
      ]),
    );
    const { profile } = buildWireGuardProfile(
      'home',
      { ...CLIENT, name: 'Телефон Маши' },
      material({ ...AMNEZIA, ...five }),
    );
    expect(qrSvgDataUri(profile)).not.toBe('');
  });
});

describe('the tunnel subnet of a new server', () => {
  it('is one no other server hands out', () => {
    installLuciStubs({
      office: { '.type': 'server', tunnel_address: ['10.8.0.1/24'] },
      home: {
        '.type': 'server',
        tunnel_address: ['10.8.1.1/24', 'fd00:8::1/64'],
      },
      fresh: { '.type': 'server' },
    });
    expect(freeTunnelSubnet('fresh')).toBe('10.8.2.1/24');
    expect(freeTunnelSubnet('office')).toBe('10.8.0.1/24');
  });

  it('is written as a route, and holds the addresses of its clients', () => {
    expect(subnetOf('10.8.0.1/24')).toBe('10.8.0.0/24');
    expect(subnetOf('172.16.5.254/20')).toBe('172.16.0.0/20');
    expect(subnetOf('fd00:8::1/64')).toBe('fd00:8::/64');
    expect(subnetContains('10.8.0.1/24', '10.8.0.200/32')).toBe(true);
    expect(subnetContains('10.8.0.1/24', '10.8.1.2/32')).toBe(false);
    expect(subnetContains('10.8.0.1/24', 'fd00:8::2/128')).toBe(false);
    expect(subnetContains('fd00:8::1/64', 'fd00:8::2/128')).toBe(true);
  });
});
