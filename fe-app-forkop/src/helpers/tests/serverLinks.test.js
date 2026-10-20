import { describe, expect, it } from 'vitest';

import { installLuciStubs } from './luciStubs';
import {
  buildClientLinks,
  loadLinkContext,
} from '../../forkop/tabs/servers/links';

const UUID = '11111111-1111-4111-8111-111111111111';

function load(server, client = {}) {
  const uci = installLuciStubs({
    srv: {
      '.type': 'server',
      label: 'Home',
      enabled: '1',
      listen: '0.0.0.0',
      listen_port: '30000',
      public_host: '203.0.113.9',
      ...server,
    },
  });
  return {
    uci,
    link: { buildClientLinks },
    client: {
      id: 'cfg1',
      enabled: true,
      name: 'phone',
      uuid: '',
      password: '',
      flow: '',
      ...client,
    },
  };
}

function query(url) {
  return Object.fromEntries(new URL(url).searchParams);
}

describe('VLESS links', () => {
  it('carries the Reality parameters clients need', () => {
    const { link, client } = load(
      {
        protocol: 'vless',
        security: 'reality',
        reality_public_key: 'public-key',
        reality_short_id: ['abcd1234'],
        tls_server_name: 'www.microsoft.com',
        client_fingerprint: 'chrome',
      },
      { uuid: UUID, flow: 'xtls-rprx-vision' },
    );

    const [{ link: url }] = link.buildClientLinks('srv', client);

    expect(url.startsWith(`vless://${UUID}@203.0.113.9:30000?`)).toBe(true);
    expect(query(url)).toMatchObject({
      security: 'reality',
      sni: 'www.microsoft.com',
      pbk: 'public-key',
      sid: 'abcd1234',
      fp: 'chrome',
      type: 'tcp',
      encryption: 'none',
      flow: 'xtls-rprx-vision',
    });
    expect(new URL(url).hash).toBe('#phone');
  });

  it('carries the default fingerprint when the server names none', () => {
    const { link, client } = load(
      {
        protocol: 'vless',
        security: 'reality',
        reality_public_key: 'public-key',
        reality_short_id: ['abcd1234'],
        tls_server_name: 'www.microsoft.com',
      },
      { uuid: UUID },
    );
    const [{ link: url }] = link.buildClientLinks('srv', client);
    expect(query(url).fp).toBe('chrome');
  });

  it('has no link while the Reality key pair is missing', () => {
    const { link, client } = load(
      { protocol: 'vless', security: 'reality' },
      { uuid: UUID },
    );

    expect(link.buildClientLinks('srv', client)).toEqual([]);
  });

  it('describes the WebSocket transport and the self-signed certificate', () => {
    const { link, client } = load(
      {
        protocol: 'vless',
        security: 'tls',
        tls_server_name: 'example.org',
        tls_alpn: ['h2', 'http/1.1'],
        transport: 'ws',
        transport_path: '/ws',
        transport_host: 'cdn.example.org',
      },
      { uuid: UUID },
    );

    const [{ link: url }] = link.buildClientLinks('srv', client);

    expect(query(url)).toMatchObject({
      security: 'tls',
      sni: 'example.org',
      alpn: 'h2,http/1.1',
      type: 'ws',
      path: '/ws',
      host: 'cdn.example.org',
      insecure: '1',
    });
  });

  it('drops the insecure flag once a real certificate is configured', () => {
    const { link, client } = load(
      {
        protocol: 'vless',
        security: 'tls',
        tls_server_name: 'example.org',
        tls_certificate_source: 'custom',
        tls_certificate: '/etc/letsencrypt/live/example.org/fullchain.pem',
      },
      { uuid: UUID },
    );

    expect(
      query(link.buildClientLinks('srv', client)[0].link).insecure,
    ).toBeUndefined();
  });
});

describe('Trojan links', () => {
  it('uses the gRPC service name key Trojan clients expect', () => {
    const { link, client } = load(
      {
        protocol: 'trojan',
        security: 'tls',
        tls_server_name: 'example.org',
        transport: 'grpc',
        transport_service_name: 'grpc-service',
      },
      { password: 'secret-password' },
    );

    const [{ link: url }] = link.buildClientLinks('srv', client);

    expect(url.startsWith('trojan://secret-password@203.0.113.9:30000?')).toBe(
      true,
    );
    expect(query(url)['grpc-service-name']).toBe('grpc-service');
  });

  it('serves a server stored without TLS over TLS', () => {
    const { link, client } = load(
      { protocol: 'trojan', security: 'none' },
      { password: 'secret-password' },
    );

    const [{ link: url }] = link.buildClientLinks('srv', client);
    expect(query(url)).toMatchObject({ security: 'tls', insecure: '1' });
  });
});

describe('VMess links', () => {
  it('encodes the payload the way the core generator does', () => {
    const { link, client } = load(
      {
        protocol: 'vmess',
        security: 'tls',
        tls_server_name: 'example.org',
        transport: 'ws',
        transport_path: '/ws',
      },
      { uuid: UUID },
    );

    const [{ link: url }] = link.buildClientLinks('srv', client);
    expect(url.startsWith('vmess://')).toBe(true);

    const payload = JSON.parse(
      Buffer.from(url.slice('vmess://'.length), 'base64').toString('utf8'),
    );
    expect(payload).toMatchObject({
      v: '2',
      ps: 'phone',
      add: '203.0.113.9',
      port: '30000',
      id: UUID,
      aid: '0',
      net: 'ws',
      path: '/ws',
      tls: 'tls',
      sni: 'example.org',
      insecure: '1',
    });
  });
});

describe('Shadowsocks links', () => {
  it('joins the server and client keys for a 2022 method', () => {
    const serverKey = Buffer.alloc(16, 1).toString('base64');
    const clientKey = Buffer.alloc(16, 2).toString('base64');
    const { link, client } = load(
      {
        protocol: 'shadowsocks',
        shadowsocks_method: '2022-blake3-aes-128-gcm',
        shadowsocks_psk: serverKey,
      },
      { password: clientKey },
    );

    const [{ link: url }] = link.buildClientLinks('srv', client);
    const userInfo = url.slice('ss://'.length, url.indexOf('@'));

    expect(Buffer.from(userInfo, 'base64url').toString('utf8')).toBe(
      `2022-blake3-aes-128-gcm:${serverKey}:${clientKey}`,
    );
  });

  it('uses the client password alone for the older AEAD methods', () => {
    const { link, client } = load(
      { protocol: 'shadowsocks', shadowsocks_method: 'aes-128-gcm' },
      { password: 'plain-password' },
    );

    const [{ link: url }] = link.buildClientLinks('srv', client);
    const userInfo = url.slice('ss://'.length, url.indexOf('@'));

    expect(Buffer.from(userInfo, 'base64url').toString('utf8')).toBe(
      'aes-128-gcm:plain-password',
    );
  });
});

describe('SOCKS5 / HTTP links', () => {
  it('publishes both schemes with credentials', () => {
    const { link, client } = load(
      { protocol: 'mixed', mixed_auth_enabled: '1' },
      { name: 'alice', password: 'p@ss word' },
    );

    expect(link.buildClientLinks('srv', client)).toEqual([
      {
        title: 'SOCKS5',
        link: 'socks5://alice:p%40ss%20word@203.0.113.9:30000#alice',
      },
      {
        title: 'HTTP',
        link: 'http://alice:p%40ss%20word@203.0.113.9:30000#alice',
      },
    ]);
  });

  it('omits credentials once authentication is disabled', () => {
    const { link, client } = load(
      { protocol: 'mixed', mixed_auth_enabled: '0' },
      { name: 'alice', password: '' },
    );

    expect(link.buildClientLinks('srv', client)).toEqual([
      { title: 'SOCKS5', link: 'socks5://203.0.113.9:30000#alice' },
      { title: 'HTTP', link: 'http://203.0.113.9:30000#alice' },
    ]);
  });
});

describe('QUIC protocol links', () => {
  it('pins the self-signed Hysteria2 certificate and leaves the bandwidth out', () => {
    const { link, client } = load(
      {
        protocol: 'hysteria2',
        security: 'tls',
        tls_server_name: 'example.org',
        hysteria2_obfs_type: 'salamander',
        hysteria2_obfs_password: 'obfs-password',
        hysteria2_up_mbps: '100',
        hysteria2_down_mbps: '200',
      },
      { password: 'secret-password' },
    );
    const pin = '0'.repeat(64);

    const [{ link: url }] = link.buildClientLinks('srv', client, {
      tlsCertificateSha256: pin,
    });

    expect(
      url.startsWith('hysteria2://secret-password@203.0.113.9:30000?'),
    ).toBe(true);
    expect(query(url)).toMatchObject({
      sni: 'example.org',
      insecure: '1',
      pinSHA256: pin,
      obfs: 'salamander',
      'obfs-password': 'obfs-password',
    });
    expect(query(url).up).toBeUndefined();
    expect(query(url).down).toBeUndefined();
  });

  it('pins the certificate the router issued with the fingerprint it wrote', async () => {
    load({ protocol: 'hysteria2', security: 'tls' });
    globalThis.rpc = {
      declare: () => () =>
        Promise.resolve({ srv: { tls_self_signed_sha256: 'AB'.repeat(32) } }),
    };
    expect(await loadLinkContext('srv')).toEqual({
      tlsCertificateSha256: 'ab'.repeat(32),
    });

    load({
      protocol: 'hysteria2',
      tls_certificate_source: 'custom',
      tls_certificate: '/etc/ssl/acme/example.org.fullchain.crt',
    });
    expect(await loadLinkContext('srv')).toEqual({ tlsCertificateSha256: '' });
  });

  it('puts the UUID and the password in the TUIC user info', () => {
    const { link, client } = load(
      {
        protocol: 'tuic',
        security: 'tls',
        tls_server_name: 'example.org',
        tuic_congestion_control: 'bbr',
      },
      { uuid: UUID, password: 'secret-password' },
    );

    const [{ link: url }] = link.buildClientLinks('srv', client);

    expect(
      url.startsWith(`tuic://${UUID}:secret-password@203.0.113.9:30000?`),
    ).toBe(true);
    expect(query(url)).toEqual({
      sni: 'example.org',
      insecure: '1',
      congestion_control: 'bbr',
    });
  });

  it('builds an AnyTLS link from the password', () => {
    const { link, client } = load(
      { protocol: 'anytls', security: 'tls', tls_server_name: 'example.org' },
      { password: 'secret-password' },
    );

    const [{ link: url }] = link.buildClientLinks('srv', client);

    expect(url.startsWith('anytls://secret-password@203.0.113.9:30000?')).toBe(
      true,
    );
    expect(query(url).sni).toBe('example.org');
  });
});

describe('other protocol links', () => {
  it('marks the naive scheme after the listener network', () => {
    const tcp = load(
      {
        protocol: 'naive',
        security: 'tls',
        tls_server_name: 'example.org',
        naive_network: 'tcp',
      },
      { name: 'alice', password: 'secret-password' },
    );
    expect(tcp.link.buildClientLinks('srv', tcp.client)[0].link).toContain(
      'naive+https://alice:secret-password@',
    );

    const quic = load(
      {
        protocol: 'naive',
        security: 'tls',
        tls_server_name: 'example.org',
        naive_network: 'udp',
      },
      { name: 'alice', password: 'secret-password' },
    );
    expect(quic.link.buildClientLinks('srv', quic.client)[0].link).toContain(
      'naive+quic://alice:secret-password@',
    );
  });

  it('tells a client to accept the self-signed certificate', () => {
    for (const [protocol, insecure] of [
      ['trojan', '1'],
      ['anytls', '1'],
      ['naive', undefined],
    ]) {
      const { link, client } = load(
        { protocol, security: 'tls', tls_server_name: 'example.org' },
        { name: 'alice', password: 'secret-password' },
      );

      expect(
        query(link.buildClientLinks('srv', client)[0].link).insecure,
        protocol,
      ).toBe(insecure);
    }
  });

  it('builds a mieru link in the format the core parses', () => {
    const { link, client } = load(
      { protocol: 'mieru', mieru_transport: 'UDP' },
      { name: 'alice', password: 'secret-password' },
    );
    const [entry] = link.buildClientLinks('srv', client);
    const url = new URL(entry.link);

    expect(url.protocol).toBe('mierus:');
    expect(url.username).toBe('alice');
    expect(url.password).toBe('secret-password');
    expect(url.hostname).toBe('203.0.113.9');
    expect(url.port).toBe('');
    expect(query(entry.link)).toMatchObject({
      profile: 'Home',
      port: '30000',
      protocol: 'UDP',
    });
  });

  it('has no link for protocols without a share URI', () => {
    const { link, client } = load({ protocol: 'openvpn' }, { name: 'alice' });
    expect(link.buildClientLinks('srv', client)).toEqual([]);
  });

  it('builds anonymous links for a listener without authentication', () => {
    const { link, client } = load({
      protocol: 'mixed',
      mixed_auth_enabled: '0',
    });
    const links = link.buildClientLinks('srv', { ...client, name: '' });

    expect(links.map((entry) => entry.link.split('#')[0])).toEqual([
      'socks5://203.0.113.9:30000',
      'http://203.0.113.9:30000',
    ]);
  });

  it('has no link without a credential, a host or a port', () => {
    const missingPassword = load({ protocol: 'trojan', security: 'tls' });
    expect(
      missingPassword.link.buildClientLinks('srv', missingPassword.client),
    ).toEqual([]);

    const missingPort = load(
      { protocol: 'trojan', security: 'tls', listen_port: '' },
      { password: 'secret-password' },
    );
    expect(
      missingPort.link.buildClientLinks('srv', missingPort.client),
    ).toEqual([]);
  });
});
