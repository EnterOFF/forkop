import { describe, expect, it } from 'vitest';
import {
  formatMaskedSingBoxConfig,
  maskGlobalCheckText,
  maskSingBoxConfigValue,
} from '../helpers/maskDiagnostics';

describe('diagnostic masking', () => {
  it('hides native VPN credentials and certificate material', () => {
    for (const key of [
      'psk',
      'userkey',
      'static_key',
      'key',
      'client_key',
      'certificate',
      'client_certificate',
      'peer_fingerprint',
      'cookie',
      'token',
    ]) {
      expect(
        maskSingBoxConfigValue({
          endpoints: [{ tls: { [key]: ['sensitive'] } }],
        }),
      ).toEqual({ endpoints: [{ tls: { [key]: 'MASKED' } }] });
    }
    expect(
      maskGlobalCheckText("option native_api_secret 'sensitive'"),
    ).not.toContain('sensitive');
  });
  it('masks sensitive sing-box keys without mutating the original config', () => {
    const config = {
      outbounds: [
        {
          type: 'vless',
          tag: 'proxy',
          server: 'example.com',
          server_port: 443,
          uuid: 'client-id',
          tls: {
            enabled: true,
            server_name: 'example.com',
          },
        },
      ],
      route: {
        rules: [{ domain_suffix: ['example.org'], outbound: 'proxy' }],
      },
    };

    expect(maskSingBoxConfigValue(config)).toEqual({
      outbounds: [
        {
          type: 'vless',
          tag: 'proxy',
          server: 'MASKED',
          server_port: 'MASKED',
          uuid: 'MASKED',
          tls: {
            enabled: true,
            server_name: 'MASKED',
          },
        },
      ],
      route: {
        rules: [{ domain_suffix: 'MASKED', outbound: 'proxy' }],
      },
    });
    expect(config.outbounds[0].server).toBe('example.com');
  });

  it('formats masked sing-box config from a raw JSON string', () => {
    const masked = formatMaskedSingBoxConfig(
      '{"inbounds":[{"listen":"127.0.0.1","listen_port":2080}]}',
    );

    expect(masked).toContain('"listen": "MASKED"');
    expect(masked).toContain('"listen_port": "MASKED"');
  });

  it('masks sensitive global check UCI values while keeping visible structure stable', () => {
    const raw = [
      "config section 'main'",
      "\toption proxy_string 'vless://secret@example.com:443'",
      "\toption hwid 'device-secret'",
      "\tlist domain 'example.com'",
      "\toption outbound_json '{",
      '  "server": "example.com",',
      "}'",
      "config interface 'lan'",
      "\toption ipaddr '192.168.1.1'",
      "\toption netmask '255.255.255.0'",
      "config interface 'wan'",
      "\toption username 'provider-user'",
      "\toption password 'provider-password'",
      "config subscription_url 'sub1'",
      "\toption url 'https://user:password@example.com/subscription?token=secret'",
      "\tlist header 'Authorization: Bearer header-secret'",
      "config interface 'wireguard_wan'",
      "\toption private_key 'wireguard-private-secret'",
      '',
    ].join('\n');

    const masked = maskGlobalCheckText(raw);

    expect(masked.split('\n')).toHaveLength(raw.split('\n').length);
    expect(masked).not.toContain('vless://secret');
    expect(masked).not.toContain('device-secret');
    expect(masked).not.toContain('example.com",');
    expect(masked).not.toContain('192.168.1.1');
    expect(masked).not.toContain('provider-password');
    expect(masked).not.toContain('token=secret');
    expect(masked).not.toContain('header-secret');
    expect(masked).not.toContain('wireguard-private-secret');
    expect(masked).toContain("option proxy_string 'MASKED'");
    expect(masked).toContain("option ipaddr 'MASKED'");
    expect(masked).toContain("option url 'MASKED'");
    expect(masked).toContain("list header 'MASKED'");
    expect(masked).toContain("option private_key 'MASKED'");
  });

  it('masks every credential a WireGuard, AmneziaWG or WARP tunnel can carry', () => {
    const raw = [
      "config tunnel 'tun_warp'",
      "\toption kind 'warp'",
      "\toption warp_profile_id 'warp-device-id'",
      "\toption warp_profile_auth_token 'warp-auth-token'",
      "\toption warp_profile_private_key 'warp-private-key'",
      "\toption warp_profile_license_key 'warp-license-key'",
      "\toption amnezia_jc '4'",
      "config tunnel 'tun_awg'",
      "\tlist address '10.8.1.9/32'",
      "\toption private_key 'awg-private-key'",
      "\toption mtu '1280'",
      "config tunnel_peer 'tp_awg'",
      "\toption address 'peer.example.com'",
      "\toption port '47132'",
      "\toption public_key 'peer-public-key'",
      "\toption pre_shared_key 'peer-preshared-key'",
      "\tlist allowed_ips '0.0.0.0/0'",
      "\toption persistent_keepalive_interval '25'",
      "config tunnel 'tun_json'",
      "\toption endpoint_json '{",
      '\t"private_key": "json-leaked"',
      "}'",
      '',
    ].join('\n');

    const masked = maskGlobalCheckText(raw);

    for (const secret of [
      'warp-device-id',
      'warp-auth-token',
      'warp-private-key',
      'warp-license-key',
      '10.8.1.9/32',
      'awg-private-key',
      'peer.example.com',
      '47132',
      'peer-public-key',
      'peer-preshared-key',
      '0.0.0.0/0',
      'json-leaked',
    ]) {
      expect(masked).not.toContain(secret);
    }

    expect(masked).toContain("option kind 'warp'");
    expect(masked).toContain("option amnezia_jc '4'");
    expect(masked).toContain("option mtu '1280'");
    expect(masked).toContain("option persistent_keepalive_interval '25'");
  });

  it('masks tunnel and WARP keys in a generated sing-box config', () => {
    const config = {
      endpoints: [
        {
          type: 'wireguard',
          tag: 'proxy/awg',
          address: ['10.8.1.9/32'],
          private_key: 'awg-private-key',
          mtu: 1280,
          peers: [
            {
              address: 'peer.example.com',
              port: 47132,
              public_key: 'peer-public-key',
              allowed_ips: ['0.0.0.0/0'],
              pre_shared_key: 'peer-preshared-key',
              persistent_keepalive_interval: 25,
            },
          ],
        },
        {
          type: 'warp',
          tag: 'proxy/warp',
          profile: {
            id: 'warp-device-id',
            auth_token: 'warp-auth-token',
            private_key: 'warp-private-key',
            recreate: true,
          },
        },
      ],
      outbounds: [
        { type: 'parser', tag: 'proxy/node', link: 'vless://uuid@example.com' },
      ],
    };

    const masked = formatMaskedSingBoxConfig(config);

    for (const secret of [
      '10.8.1.9/32',
      'awg-private-key',
      'peer.example.com',
      '47132',
      'peer-public-key',
      '0.0.0.0/0',
      'peer-preshared-key',
      'warp-device-id',
      'warp-auth-token',
      'warp-private-key',
      'vless://uuid@example.com',
    ]) {
      expect(masked).not.toContain(secret);
    }

    expect(masked).toContain('"mtu": 1280');
    expect(masked).toContain('"persistent_keepalive_interval": 25');
    expect(masked).toContain('"tag": "proxy/warp"');
    expect(masked).toContain('"recreate": true');
  });
});
