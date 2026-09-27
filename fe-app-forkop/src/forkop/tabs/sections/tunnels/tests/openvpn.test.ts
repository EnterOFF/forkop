import { describe, expect, it } from 'vitest';
import { openVPNEndpoint, openVPNInitialSettings } from '../openvpn';

describe('OpenVPN form', () => {
  it('round trips credentials, certificates and unmodelled native options', () => {
    const endpoint = {
      type: 'openvpn-client',
      server: 'vpn.example',
      server_port: 1194,
      network: 'udp',
      username: ' alice ',
      password: ' secret ',
      mtu: 1400,
      data_ciphers: ['AES-256-GCM', 'AES-128-GCM'],
      tls: {
        server_name: 'vpn.example',
        certificate: ['CA'],
        client_certificate: ['CERT'],
        client_key: ['KEY'],
        version_min: '1.2',
        certificate_profile: 'preferred',
        control_wrap: { type: 'tls_crypt', key: ['CONTROL'] },
      },
      pull_filters: [{ action: 'ignore', text: 'redirect-gateway' }],
      ping_restart: '30s',
      udp_mapping: 'endpoint-independent',
    };
    const settings = openVPNInitialSettings(endpoint);
    expect(openVPNEndpoint(settings)).toEqual(endpoint);
    settings.openvpn_server = 'new.example';
    expect(openVPNEndpoint(settings)).toEqual({
      ...endpoint,
      server: 'new.example',
    });
    expect(endpoint.server).toBe('vpn.example');
  });

  it('round trips static-key and certificate-path configurations', () => {
    for (const endpoint of [
      {
        type: 'openvpn-client',
        mode: 'static_key',
        server: 'vpn.example',
        address: ['10.0.0.2/30'],
        peer_address: '10.0.0.1',
        static_key: ['KEY'],
        key_direction: 'client',
      },
      {
        type: 'openvpn-client',
        servers: [{ server: 'vpn.example', server_port: 443, network: 'tcp' }],
        tls: {
          certificate_path: '/etc/ca.pem',
          client_key_path: '/etc/key.pem',
          client_certificate_path: '/etc/cert.pem',
        },
      },
    ])
      expect(openVPNEndpoint(openVPNInitialSettings(endpoint))).toEqual(
        endpoint,
      );
  });

  it('rejects invalid ports, enums and ambiguous duplicate options', () => {
    for (const settings of [
      { openvpn_server_port: '65536' },
      { openvpn_server_port: '-1' },
      { openvpn_network: 'sctp' },
      { openvpn_extra: '[]' },
      { openvpn_extra: '{"server":"hidden.example"}' },
      { openvpn_extra: '{"type":"openvpn-server"}' },
      { openvpn_extra: '{"tls":{"server_name":"hidden"}}' },
      {
        openvpn_extra: '{"tls":false}',
        openvpn_tls_server_name: 'vpn.example',
      },
    ])
      expect(openVPNEndpoint(settings)).toBeNull();
  });
});
