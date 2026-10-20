import { describe, expect, it } from 'vitest';

import { installLuciStubs } from '../../../../helpers/tests/luciStubs';

installLuciStubs({
  settings: { '.type': 'settings' },
  vless: {
    '.type': 'server',
    protocol: 'vless',
    listen_port: '443',
    label: 'VLESS',
  },
  naive: {
    '.type': 'server',
    protocol: 'naive',
    naive_network: 'tcp_udp',
    listen_port: '8443',
  },
  hysteria: { '.type': 'server', protocol: 'hysteria2', listen_port: '443' },
  mieru: {
    '.type': 'server',
    protocol: 'mieru',
    mieru_transport: 'UDP',
    listen_port: '9443',
  },
  xhttp3: {
    '.type': 'server',
    protocol: 'vless',
    security: 'tls',
    transport: 'xhttp',
    tls_alpn: ['h3'],
    listen_port: '7443',
  },
  xhttp2: {
    '.type': 'server',
    protocol: 'vless',
    security: 'tls',
    transport: 'xhttp',
    tls_alpn: ['h3', 'h2'],
    listen_port: '7443',
  },
});

const { validateListenPort } = await import('../validators');
const { listenTransports, serverListenTransports } = await import(
  '../protocols'
);

describe('the listen port of a server', () => {
  it('may share a port with a server on the other transport', () => {
    expect(validateListenPort('hysteria', '443')).toBe(true);
    expect(validateListenPort('vless', '443')).toBe(true);
    expect(validateListenPort('mieru', '8443')).toContain('Port taken by');
  });

  it('may not share one with a server on the same transport, however the number is written', () => {
    expect(validateListenPort('naive', '0443')).toContain('Port taken by');
    expect(validateListenPort('vless', '9443')).toBe(true);
    expect(validateListenPort('hysteria', '9443')).toContain('Port taken by');
  });

  it('takes the transports singbox/servers.uc says the protocol takes', () => {
    expect(listenTransports('hysteria2', '')).toEqual(['udp']);
    expect(listenTransports('shadowsocks', '')).toEqual(['tcp', 'udp']);
    expect(listenTransports('naive', 'tcp_udp')).toEqual(['tcp', 'udp']);
    expect(listenTransports('mieru', 'UDP')).toEqual(['udp']);
    expect(listenTransports('vless', '')).toEqual(['tcp']);
  });

  it('takes UDP for XHTTP over HTTP/3, which TLS offering h3 alone picks', () => {
    const server = (values: Record<string, unknown>) => (name: string) =>
      values[name];
    const xhttp = { security: 'tls', transport: 'xhttp', tls_alpn: ['h3'] };

    expect(serverListenTransports('vless', server(xhttp))).toEqual(['udp']);
    expect(serverListenTransports('trojan', server(xhttp))).toEqual(['udp']);
    expect(
      serverListenTransports('vless', server({ ...xhttp, tls_alpn: 'h3,h2' })),
    ).toEqual(['tcp']);
    expect(
      serverListenTransports('vless', server({ ...xhttp, security: 'none' })),
    ).toEqual(['tcp']);
    expect(
      serverListenTransports('vless', server({ ...xhttp, transport: 'ws' })),
    ).toEqual(['tcp']);
    expect(
      serverListenTransports('naive', server({ naive_network: 'udp' })),
    ).toEqual(['udp']);
    expect(validateListenPort('xhttp2', '7443')).toBe(true);
    expect(validateListenPort('hysteria', '7443')).toContain('Port taken by');
  });
});
