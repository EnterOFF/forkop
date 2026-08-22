import { describe, expect, it } from 'vitest';

import {
  createUciStub,
  loadLuciView,
  resetLuciViewCache,
} from './loadLuciView';

const UUID = '11111111-1111-4111-8111-111111111111';

function load(server, client = {}) {
  resetLuciViewCache();
  const uci = createUciStub({
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
    link: loadLuciView('server', uci, ['buildClientLinks']),
    client: {
      id: 'cfg1',
      enabled: true,
      name: 'phone',
      uuid: '',
      password: '',
      secret: '',
      flow: '',
      authorized_keys: [],
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
      // Forkop's own certificate is self-signed, so verification has to be off.
      insecure: '1',
    });
  });

  it('drops the insecure flag once a real certificate is configured', () => {
    const { link, client } = load(
      {
        protocol: 'vless',
        security: 'tls',
        tls_server_name: 'example.org',
        tls_certificate_path: '/etc/letsencrypt/live/example.org/fullchain.pem',
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

  it('has no link without TLS, because no client format carries it', () => {
    const { link, client } = load(
      { protocol: 'trojan', security: 'none' },
      { password: 'secret-password' },
    );

    expect(link.buildClientLinks('srv', client)).toEqual([]);
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
      // sing-box has no MD5 authenticated VMess, so alterId is always zero.
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
  it('pins the generated Hysteria2 certificate and reports the bandwidth', () => {
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
      up: '100',
      down: '200',
    });
  });

  it('puts the UUID and the password in the TUIC user info', () => {
    const { link, client } = load(
      {
        protocol: 'tuic',
        security: 'tls',
        tls_server_name: 'example.org',
        tuic_congestion_control: 'bbr',
        tuic_heartbeat: '10s',
        tuic_zero_rtt_handshake: '1',
      },
      { uuid: UUID, password: 'secret-password' },
    );

    const [{ link: url }] = link.buildClientLinks('srv', client);

    expect(
      url.startsWith(`tuic://${UUID}:secret-password@203.0.113.9:30000?`),
    ).toBe(true);
    expect(query(url)).toMatchObject({
      congestion_control: 'bbr',
      heartbeat_interval: '10s',
      zero_rtt_handshake: 'true',
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

  // Every other listener here hands out a link that tells the client to accept the
  // self signed certificate Forkop issued. A NaiveProxy client cannot be told that:
  // the naive outbound of the core refuses tls.insecure outright and its link parser
  // does not even read the parameter, so promising it would be a lie.
  it('does not tell a naive client to skip the certificate check', () => {
    const { link, client } = load(
      {
        protocol: 'naive',
        security: 'tls',
        tls_server_name: 'example.org',
        tls_certificate_path: '/etc/forkop/server-certs/srv.crt',
        tls_key_path: '/etc/forkop/server-certs/srv.key',
      },
      { name: 'alice', password: 'secret-password' },
    );

    const [{ link: url }] = link.buildClientLinks('srv', client);

    expect(query(url).insecure).toBeUndefined();
    expect(query(url).sni).toBe('example.org');
  });

  // And the same certificate on any other listener still carries the flag, so the
  // exception above is the exception and not a dropped feature.
  it('still tells a trojan client to accept the generated certificate', () => {
    const { link, client } = load(
      {
        protocol: 'trojan',
        security: 'tls',
        tls_server_name: 'example.org',
        tls_certificate_path: '/etc/forkop/server-certs/srv.crt',
        tls_key_path: '/etc/forkop/server-certs/srv.key',
      },
      { password: 'secret-password' },
    );

    expect(query(link.buildClientLinks('srv', client)[0].link).insecure).toBe(
      '1',
    );
  });

  it('builds a Telegram proxy link that carries the FakeTLS host', () => {
    const { link, client } = load(
      { protocol: 'mtproto', mtproto_faketls: 'google.com' },
      { secret: 'a'.repeat(32) },
    );

    const [{ link: url }] = link.buildClientLinks('srv', client);
    const params = query(url);

    expect(url.startsWith('https://t.me/proxy?')).toBe(true);
    expect(params.server).toBe('203.0.113.9');
    expect(params.port).toBe('30000');
    expect(params.secret.startsWith(`ee${'a'.repeat(32)}`)).toBe(true);
    expect(Buffer.from(params.secret.slice(34), 'hex').toString('utf8')).toBe(
      'google.com',
    );
  });

  // The mieru project has its own URL format and the core parses it, so a client
  // of a mieru server gets a link like everybody else. The ports live in the query
  // instead of the authority, and a profile name is required.
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
    const { link, client } = load(
      { protocol: 'ssh' },
      { name: 'alice', password: 'secret-password' },
    );
    expect(link.buildClientLinks('srv', client)).toEqual([]);
  });

  // A Mixed listener that asks for nothing still has an address, and both of its
  // schemes carry it without an account.
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
