import { describe, expect, it } from 'vitest';

import { installLuciStubs } from '../../../../helpers/tests/luciStubs';

installLuciStubs({
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
});

const { validateListenPort } = await import('../validators');
const { listenTransports } = await import('../protocols');

describe('the listen port of a server', () => {
  it('may share a port with a server on the other transport', () => {
    expect(validateListenPort('hysteria', '443')).toBe(true);
    expect(validateListenPort('vless', '443')).toBe(true);
    expect(validateListenPort('mieru', '8443')).toContain('already used');
  });

  it('may not share one with a server on the same transport, however the number is written', () => {
    expect(validateListenPort('naive', '0443')).toContain('already used');
    expect(validateListenPort('vless', '9443')).toBe(true);
    expect(validateListenPort('hysteria', '9443')).toContain('already used');
  });

  it('takes the transports singbox/servers.uc says the protocol takes', () => {
    expect(listenTransports('hysteria2', '')).toEqual(['udp']);
    expect(listenTransports('shadowsocks', '')).toEqual(['tcp', 'udp']);
    expect(listenTransports('naive', 'tcp_udp')).toEqual(['tcp', 'udp']);
    expect(listenTransports('mieru', 'UDP')).toEqual(['udp']);
    expect(listenTransports('vless', '')).toEqual(['tcp']);
  });
});
