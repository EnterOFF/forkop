import { describe, expect, it } from 'vitest';

import { installLuciStubs } from './luciStubs';
import { parseOpenVPNConfig } from '../parseOpenVPNConfig';
import { CA, CLIENT_CERT, CLIENT_KEY, STATIC_KEY } from './openvpnFixtures';
import { buildOpenVPNProfile } from '../../forkop/tabs/servers/profile';
import {
  validateTunnelSubnet,
  validateTunnelSubnets,
} from '../../forkop/tabs/servers/form/tunnel';

const CLIENT = {
  id: 'laptop',
  name: 'Ноутбук',
  uuid: '',
  password: '',
  flow: '',
};

// What prepare leaves in the configuration the router holds.
const MATERIAL = {
  office: { openvpn_certificate: CA, openvpn_tls_crypt_key: STATIC_KEY },
  laptop: { openvpn_certificate: CLIENT_CERT, openvpn_key: CLIENT_KEY },
};

function load(server = {}) {
  installLuciStubs({
    office: {
      '.type': 'server',
      label: 'Office',
      protocol: 'openvpn',
      listen_port: '1194',
      public_host: 'vpn.example.com',
      ...server,
    },
  });
}

describe('OpenVPN profile', () => {
  it('carries the server, the certificates and the tls-crypt key inline', () => {
    load();
    const result = buildOpenVPNProfile('office', CLIENT, MATERIAL);
    expect(result.fileName).toBe('Office-Ноутбук.ovpn');
    const lines = result.profile.split('\n');
    expect(lines.slice(0, 12)).toEqual([
      '# Office · Ноутбук',
      'client',
      'dev tun',
      'proto udp',
      'remote vpn.example.com 1194',
      'nobind',
      'persist-tun',
      'remote-cert-tls server',
      'explicit-exit-notify',
      'ignore-unknown-option block-outside-dns',
      'verb 3',
      '<ca>',
    ]);
    for (const block of [CA, CLIENT_CERT, CLIENT_KEY, STATIC_KEY]) {
      expect(result.profile).toContain(block);
    }
  });

  it('is a profile the tunnel import reads back as the same server', () => {
    load({ openvpn_network: 'tcp', public_host: '2001:db8::1' });
    const { profile } = buildOpenVPNProfile('office', CLIENT, MATERIAL);
    const parsed = parseOpenVPNConfig(profile);
    expect(parsed.valid).toBe(true);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.endpoint).toMatchObject({
      server: '2001:db8::1',
      server_port: 1194,
      network: 'tcp',
      tls: {
        certificate: CA.split('\n'),
        client_certificate: CLIENT_CERT.split('\n'),
        client_key: CLIENT_KEY.split('\n'),
        control_wrap: { type: 'tls_crypt', key: STATIC_KEY.split('\n') },
      },
    });
    expect(parsed.endpoint.tls).not.toHaveProperty('remote_certificate_tls');
    expect(profile).not.toContain('explicit-exit-notify');
  });

  it('leaves the DNS option alone on a server that routes only some subnets', () => {
    load({ tunnel_all_traffic: '0' });
    expect(
      buildOpenVPNProfile('office', CLIENT, MATERIAL).profile,
    ).not.toContain('block-outside-dns');
  });

  it('names what is missing when there is no profile yet', () => {
    load();
    expect(buildOpenVPNProfile('office', CLIENT, {})).toEqual({
      missing: 'certificate',
    });
    expect(
      buildOpenVPNProfile('office', CLIENT, {
        office: MATERIAL.office,
        laptop: { openvpn_certificate: CLIENT_CERT },
      }),
    ).toEqual({ missing: 'certificate' });
    load({ listen_port: '' });
    expect(buildOpenVPNProfile('office', CLIENT, MATERIAL)).toEqual({
      missing: 'address',
    });
  });
});

describe('the tunnel subnet of a server', () => {
  it('takes the address of the server with a prefix clients fit in', () => {
    for (const value of [
      '10.8.0.1/24',
      '172.16.5.254/16',
      'fd00:8::1/64',
      'fd00::ffff:1/112',
    ])
      expect(validateTunnelSubnet(value), value).toBe(true);
    for (const value of [
      '10.8.0.0/24',
      '10.8.0.255/24',
      'fd00:8::/64',
      '10.8.0.1/31',
      '10.8.0.1/7',
      'fd00::1/48',
      '10.8.0.1',
      'lan',
    ])
      expect(validateTunnelSubnet(value), value).not.toBe(true);
  });

  it('holds one IPv4 subnet and at most one IPv6 subnet', () => {
    expect(validateTunnelSubnets(['10.8.0.1/24'])).toBe(true);
    expect(validateTunnelSubnets(['10.8.0.1/24', 'fd00:8::1/64'])).toBe(true);
    expect(validateTunnelSubnets([])).toBe('Add an IPv4 subnet');
    expect(validateTunnelSubnets(['fd00:8::1/64'])).toBe('Add an IPv4 subnet');
    expect(validateTunnelSubnets(['10.8.0.1/24', '10.9.0.1/24'])).toBe(
      'Add at most one IPv4 subnet',
    );
  });
});
