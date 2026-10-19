import { describe, expect, it } from 'vitest';

import {
  looksLikeOpenVPNConfig,
  parseOpenVPNConfig,
} from '../parseOpenVPNConfig';
import {
  CA,
  CLIENT_CERT,
  CLIENT_KEY,
  ENCRYPTED_KEY,
  SELF_SIGNED,
  STATIC_KEY,
} from './openvpnFixtures';

const lines = (value: string) => value.split('\n');

function parsed(input: string, files = {}) {
  const result = parseOpenVPNConfig(input, files);
  if (!result.valid) throw new Error(result.message);
  return result;
}

function refused(input: string, files = {}) {
  const result = parseOpenVPNConfig(input, files);
  if (result.valid) throw new Error('the profile was accepted');
  return result.message;
}

describe('OpenVPN profile import', () => {
  it('reads an openvpn-install profile with everything inline', () => {
    const result = parsed(`client
proto udp
explicit-exit-notify
remote vpn.example.com 1194
dev tun
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
verify-x509-name server_Xl8GzQ name
auth SHA256
auth-nocache
cipher AES-128-GCM
tls-client
tls-version-min 1.2
tls-cipher TLS-ECDHE-ECDSA-WITH-AES-128-GCM-SHA256
ignore-unknown-option block-outside-dns
setenv opt block-outside-dns # Prevent Windows 10 DNS leak
verb 3
<ca>
${CA}
</ca>
<cert>
${CLIENT_CERT}
</cert>
<key>
${CLIENT_KEY}
</key>
<tls-crypt>
${STATIC_KEY}
</tls-crypt>
`);
    expect(result.skipped).toEqual([]);
    expect(result.login).toBe(false);
    expect(result.endpoint).toEqual({
      type: 'openvpn-client',
      server: 'vpn.example.com',
      server_port: 1194,
      network: 'udp',
      auth: 'SHA256',
      data_ciphers_fallback: 'AES-128-GCM',
      tls: {
        server_name: 'server_Xl8GzQ',
        server_name_type: 'name',
        version_min: '1.2',
        cipher: 'TLS-ECDHE-ECDSA-WITH-AES-128-GCM-SHA256',
        certificate: lines(CA),
        client_certificate: lines(CLIENT_CERT),
        client_key: lines(CLIENT_KEY),
        control_wrap: { type: 'tls_crypt', key: lines(STATIC_KEY) },
      },
    });
  });

  it('reads a provider profile with a login, tls-auth and old ciphers', () => {
    const result = parsed(`client
dev tun
proto tcp
remote 185.1.2.3 443
remote 185.1.2.4 443
remote-random
resolv-retry infinite
remote-cert-tls server
auth-user-pass
cipher AES-256-CBC
auth SHA512
comp-lzo no
reneg-sec 0
ping 15
ping-restart 0
tun-mtu 1500
fragment 1300
mssfix 1450
key-direction 1
<ca>
${CA}
</ca>
<tls-auth>
${STATIC_KEY}
</tls-auth>
`);
    expect(result.login).toBe(true);
    expect(result.endpoint).toEqual({
      type: 'openvpn-client',
      servers: [
        { server: '185.1.2.3', server_port: 443 },
        { server: '185.1.2.4', server_port: 443 },
      ],
      network: 'tcp',
      remote_random: true,
      auth: 'SHA512',
      compression_lzo: 'no',
      renegotiate_disabled: true,
      ping_interval: '15s',
      ping_restart_disabled: true,
      mtu: 1500,
      mss_fix: 1450,
      data_ciphers: [
        'AES-256-GCM',
        'AES-128-GCM',
        'CHACHA20-POLY1305',
        'AES-256-CBC',
      ],
      data_ciphers_fallback: 'AES-256-CBC',
      tls: {
        certificate: lines(CA),
        control_wrap: {
          type: 'tls_auth',
          key: lines(STATIC_KEY),
          direction: 'client',
        },
      },
    });
  });

  it('keeps a protocol per server and reads <connection> blocks', () => {
    const access = parsed(`client
dev tun
remote vpn.example.com 1194 udp
remote vpn.example.com 443 tcp
<ca>
${CA}
</ca>
`);
    expect(access.endpoint.servers).toEqual([
      { server: 'vpn.example.com', server_port: 1194 },
      { server: 'vpn.example.com', server_port: 443, network: 'tcp' },
    ]);
    expect(access.endpoint.network).toBe('udp');

    const blocks = parsed(`client
dev tun
<connection>
remote a.example.com 1194
proto udp
</connection>
<connection>
remote b.example.com
port 8443
proto tcp-client
</connection>
<ca>
${CA}
</ca>
`);
    expect(blocks.endpoint.servers).toEqual([
      { server: 'a.example.com', server_port: 1194 },
      { server: 'b.example.com', server_port: 8443, network: 'tcp' },
    ]);
  });

  it('takes the files a profile names from the files handed over with it', () => {
    const profile = `client
dev tun
remote vpn.example.com
ca "C:\\\\Program Files\\\\OpenVPN\\\\config\\\\ca.crt"
cert keys/alice.crt
key keys/alice.key
tls-auth ta.key 1
auth-user-pass login.txt
`;
    const result = parsed(profile, {
      'CA.CRT': CA,
      'alice.crt': CLIENT_CERT,
      'alice.key': CLIENT_KEY,
      'ta.key': STATIC_KEY,
      'login.txt': 'alice\nsecret\n',
    });
    expect(result.endpoint).toMatchObject({
      server: 'vpn.example.com',
      server_port: 1194,
      username: 'alice',
      password: 'secret',
      tls: {
        certificate: lines(CA),
        client_certificate: lines(CLIENT_CERT),
        client_key: lines(CLIENT_KEY),
        control_wrap: { type: 'tls_auth', direction: 'client' },
      },
    });

    expect(
      refused(profile, { 'ca.crt': CA, 'alice.crt': CLIENT_CERT }),
    ).toContain('alice.key');
  });

  it('asks for the login a profile does not carry', () => {
    const result = parsed(`client
dev tun
remote vpn.example.com 1194
auth-user-pass credentials.txt
<ca>
${CA}
</ca>
`);
    expect(result.login).toBe(true);
    expect(result.endpoint.username).toBeUndefined();
  });

  it('checks the server purpose only when the profile asks for it', () => {
    const base = `client\ndev tun\nremote vpn.example.com 1194\n<ca>\n${SELF_SIGNED}\n</ca>\n`;
    expect(parsed(base).endpoint.tls).toMatchObject({
      remote_certificate_tls: 'none',
    });
    expect(
      parsed(`${base}remote-cert-tls server\n`).endpoint.tls,
    ).not.toHaveProperty('remote_certificate_tls');
    expect(parsed(`${base}ns-cert-type server\n`).endpoint.tls).toMatchObject({
      remote_certificate_tls: 'none',
      ns_certificate_type: 'server',
    });
  });

  it('reads a static key profile', () => {
    const result = parsed(
      `dev tun
proto udp
remote 203.0.113.1 1194
ifconfig 10.8.0.2 10.8.0.1
secret static.key 1
cipher aes-256-cbc
`,
      { 'static.key': STATIC_KEY },
    );
    expect(result.endpoint).toEqual({
      type: 'openvpn-client',
      server: '203.0.113.1',
      server_port: 1194,
      network: 'udp',
      mode: 'static_key',
      static_key: lines(STATIC_KEY),
      key_direction: 'client',
      cipher: 'AES-256-CBC',
      address: ['10.8.0.2/32'],
      peer_address: '10.8.0.1',
    });
  });

  it('reports what it could not carry over', () => {
    const result = parsed(`client
dev tun
remote vpn.example.com 1194
http-proxy 10.0.0.1 3128
tls-groups X25519
some-future-option 1
<ca>
${CA}
</ca>
`);
    expect(result.skipped).toEqual([
      'http-proxy',
      'some-future-option',
      'tls-groups',
    ]);
  });

  it('turns compression that sends compressed data into an allowed one', () => {
    const profile = (line: string) =>
      `client\ndev tun\nremote a 1194\n${line}\n<ca>\n${CA}\n</ca>\n`;
    expect(parsed(profile('comp-lzo')).endpoint).toMatchObject({
      compression_lzo: 'adaptive',
      allow_compression: 'asym',
    });
    expect(parsed(profile('compress')).endpoint).toMatchObject({
      compression: 'stub',
    });
    expect(parsed(profile('compress')).endpoint).not.toHaveProperty(
      'allow_compression',
    );
    expect(parsed(profile('compress lz4-v2')).endpoint).toMatchObject({
      compression: 'lz4-v2',
      allow_compression: 'asym',
    });
  });

  it('refuses what a tunnel of the router cannot run', () => {
    const tail = `remote vpn.example.com 1194\n<ca>\n${CA}\n</ca>\n`;
    expect(refused(`client\ndev tap\n${tail}`)).toContain('TAP');
    expect(refused(`client\ndev tun\npkcs12 me.p12\n${tail}`)).toContain(
      'PKCS#12',
    );
    expect(
      refused(`port 1194\nproto udp\ndev tun\nserver 10.8.0.0 255.255.255.0\n`),
    ).toContain('server configuration');
    expect(
      refused(`client\ndev tun\n${tail}<key>\n${ENCRYPTED_KEY}\n</key>\n`),
    ).toContain('passphrase');
    expect(refused(`client\ndev tun\nremote a 1194\n`)).toContain(
      'CA certificate',
    );
    expect(refused(`client\ndev tun\n<ca>\n${CA}\n</ca>\n`)).toContain(
      'No remote directive',
    );
    expect(refused(`client\ndev tun\nremote a 1194\n<ca>\n${CA}\n`)).toContain(
      'not closed',
    );
    expect(refused('[Interface]\nPrivateKey = x\n')).toBe(
      'This is not an OpenVPN profile',
    );
  });

  it('recognises a profile before it is complete', () => {
    expect(looksLikeOpenVPNConfig('client\nremote a')).toBe(true);
    expect(looksLikeOpenVPNConfig('  remote vpn.example.com 1194')).toBe(true);
    expect(looksLikeOpenVPNConfig('[Interface]\nAddress = 10.0.0.2/32')).toBe(
      false,
    );
  });
});
