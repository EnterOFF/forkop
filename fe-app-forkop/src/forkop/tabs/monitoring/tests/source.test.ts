import { describe, expect, it } from 'vitest';

import {
  compareSources,
  describeSource,
  SourceConnection,
  sourceLabel,
} from '../source';

const NAMES = {
  devices: {
    '192.168.1.140': 'POCO-F7',
    '192.168.1.121': 'Redmi-Note-12-Pro-5G',
  },
  servers: new Set([
    'Server #2',
    'Server #10',
    'Home/Work',
    'Open',
    'Office',
    'Home',
  ]),
  clients: {
    Office: { cfg0a1b2c: 'Laptop' },
    Home: { '10.8.0.2': 'Phone', 'fd00:8::2': 'Phone' },
  },
};

function connection(
  type: string,
  sourceIP: string,
  user = '',
): SourceConnection {
  return { metadata: { type, sourceIP, user } };
}

const describe_ = (value: SourceConnection) => describeSource(value, NAMES);
const label = (value: SourceConnection) => {
  const source = describe_(value);
  return sourceLabel(source.name, source.detail);
};

describe('the source of a Monitoring connection', () => {
  it('names a device the router knows and keeps its address beside it', () => {
    expect(describe_(connection('tproxy/tproxy-in', '192.168.1.140'))).toEqual(
      expect.objectContaining({
        key: '192.168.1.140',
        name: 'POCO-F7',
        detail: '192.168.1.140',
      }),
    );
  });

  it('has only the address of a device nothing names', () => {
    expect(describe_(connection('tproxy/tproxy-in', '192.168.1.101'))).toEqual(
      expect.objectContaining({ name: '', detail: '192.168.1.101' }),
    );
  });

  it('names a client of a server by its account and then the server', () => {
    const source = describe_(
      connection('vless/Server #2', '203.0.113.9', 'user-k7m3p'),
    );

    expect(sourceLabel(source.name, source.detail)).toBe(
      'user-k7m3p · Server #2',
    );
    expect(source.search).toContain('203.0.113.9');
  });

  it('names a client of an OpenVPN server as the client was named', () => {
    const source = describe_(
      connection('openvpn-server/Office', '10.8.0.2', 'cfg0a1b2c'),
    );

    expect(sourceLabel(source.name, source.detail)).toBe('Laptop · Office');
    expect(source.search).toContain('10.8.0.2');
    expect(label(connection('openvpn-server/Office', '10.8.0.3', 'gone'))).toBe(
      'gone · Office',
    );
  });

  it('names a client of a WireGuard server by its tunnel address', () => {
    const source = describe_(connection('amneziawg/Home', 'fd00:8::2'));
    expect(sourceLabel(source.name, source.detail)).toBe('Phone · Home');
    expect(source.search).toContain('fd00:8::2');
    expect(label(connection('wireguard/Home', '10.8.0.9'))).toBe(
      'Home · 10.8.0.9',
    );
  });

  it('tells the clients of a server without accounts apart by address', () => {
    expect(label(connection('socks/Open', '203.0.113.9'))).toBe(
      'Open · 203.0.113.9',
    );
  });

  it('calls the router itself System', () => {
    expect(label(connection('direct/system-in', '127.0.0.1'))).toBe('System');
    expect(label({ rule: 'inbound=system6-in => route(direct-out)' })).toBe(
      'System',
    );
  });

  it('finds a server whose name holds a slash', () => {
    expect(label(connection('vless/Home/Work', '203.0.113.9', 'alice'))).toBe(
      'alice · Home/Work',
    );
  });

  it('keeps a device apart from the server client on the same address', () => {
    const lan = describe_(connection('tproxy/tproxy-in', '192.168.1.121'));
    const client = describe_(
      connection('vless/Server #2', '192.168.1.121', 'client-1'),
    );

    expect(lan.key).not.toBe(client.key);
    expect(sourceLabel(lan.name, lan.detail)).toBe(
      'Redmi-Note-12-Pro-5G · 192.168.1.121',
    );
    expect(sourceLabel(client.name, client.detail)).toBe(
      'client-1 · Server #2',
    );
  });

  it('keeps one account apart on every server and every address together', () => {
    const [here, there, roaming] = [
      connection('vless/Server #2', '203.0.113.9', 'alice'),
      connection('trojan/Server #10', '203.0.113.9', 'alice'),
      connection('vless/Server #2', '198.51.100.7', 'alice'),
    ].map((value) => describe_(value).key);

    expect(here).not.toBe(there);
    expect(here).toBe(roaming);
  });

  it('lists the router, then devices, then the clients of each server', () => {
    const sources = [
      connection('vless/Server #10', '203.0.113.9', 'alice'),
      connection('vless/Server #2', '203.0.113.9', 'user-k7m3p'),
      connection('tproxy/tproxy-in', '192.168.1.20'),
      connection('tproxy/tproxy-in', '192.168.1.101'),
      connection('vless/Server #2', '203.0.113.9', 'mom-phone'),
      connection('tproxy/tproxy-in', '192.168.1.140'),
      connection('direct/system-in', '127.0.0.1'),
    ].map(describe_);

    expect(
      sources
        .sort(compareSources)
        .map((source) => sourceLabel(source.name, source.detail)),
    ).toEqual([
      'System',
      'POCO-F7 · 192.168.1.140',
      '192.168.1.20',
      '192.168.1.101',
      'mom-phone · Server #2',
      'user-k7m3p · Server #2',
      'alice · Server #10',
    ]);
  });
});
