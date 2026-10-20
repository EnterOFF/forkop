import { describe, expect, it } from 'vitest';

import { installLuciStubs } from './luciStubs';
import { chooseDefaultPublicHost } from '../../forkop/tabs/servers/network';
import {
  validateInboundJson,
  validateListenAddress,
  validateListenPort,
  validateOptionalMasquerade,
  validateRealityKey,
  validateShadowsocksPassword,
  validateShortId,
} from '../../forkop/tabs/servers/validators';

function load(sections = {}) {
  return {
    uci: installLuciStubs(sections),
    validate: {
      chooseDefaultPublicHost,
      validateInboundJson,
      validateListenAddress,
      validateListenPort,
      validateShadowsocksPassword,
      validateShortId,
      validateRealityKey,
      validateOptionalMasquerade,
    },
  };
}

describe('Reality short ID validation', () => {
  const { validate } = load();

  it('accepts an even number of hex digits up to eight bytes', () => {
    expect(validate.validateShortId('srv', 'ab')).toBe(true);
    expect(validate.validateShortId('srv', '0123abcd')).toBe(true);
    expect(validate.validateShortId('srv', 'a'.repeat(16))).toBe(true);
  });

  it('rejects an odd number of hex digits', () => {
    expect(validate.validateShortId('srv', 'abc')).toMatch(/even number/);
  });

  it('rejects more than eight bytes, non-hex input and a list', () => {
    expect(validate.validateShortId('srv', 'a'.repeat(18))).toMatch(/up to 16/);
    expect(validate.validateShortId('srv', 'zz')).toMatch(/even number/);
    expect(validate.validateShortId('srv', ['ab', 'cdef'])).toMatch(
      /even number/,
    );
    expect(validate.validateShortId('srv', '')).toBe('Required');
  });
});

describe('listen port validation', () => {
  it('rejects a port another server already listens on', () => {
    const { validate } = load({
      first: {
        '.type': 'server',
        protocol: 'vless',
        label: 'Home',
        enabled: '1',
        listen_port: '30000',
      },
      second: { '.type': 'server', protocol: 'trojan', enabled: '1' },
    });

    expect(validate.validateListenPort('second', '30000')).toMatch(/Home/);
    expect(validate.validateListenPort('second', '30001')).toBe(true);
    expect(validate.validateListenPort('first', '30000')).toBe(true);
  });

  it('rejects the ports Forkop binds itself', () => {
    const { validate } = load();

    for (const port of ['53', '1602', '4536', '9090']) {
      expect(validate.validateListenPort('srv', port), port).not.toBe(true);
    }
  });

  it('ignores disabled servers and out-of-range ports', () => {
    const { validate } = load({
      off: {
        '.type': 'server',
        protocol: 'vless',
        enabled: '0',
        listen_port: '30000',
      },
    });

    expect(validate.validateListenPort('srv', '30000')).toBe(true);
    expect(validate.validateListenPort('srv', '0')).toBe('Invalid port');
    expect(validate.validateListenPort('srv', '70000')).toBe('Invalid port');
  });
});

describe('raw inbound JSON validation', () => {
  const { validate } = load();

  it('accepts a supported inbound object', () => {
    expect(
      validate.validateInboundJson(
        'srv',
        '{"type":"shadowtls","listen_port":8443}',
      ),
    ).toBe(true);
  });

  it('accepts a tag, which Forkop overwrites with the server name', () => {
    expect(
      validate.validateInboundJson('srv', '{"type":"mixed","tag":"mine"}'),
    ).toBe(true);
  });

  it.each([
    '{"type":"a-type-from-a-newer-core"}',
    '{"listen_port":0}',
    '{"type":"mixed","listen_port":"1080"}',
  ])('leaves the contents of %s to sing-box', (value) => {
    expect(validate.validateInboundJson('srv', value)).toBe(true);
  });

  it('rejects what is not a JSON object', () => {
    expect(validate.validateInboundJson('srv', '{')).toMatch(/Invalid JSON/);
    expect(validate.validateInboundJson('srv', '[]')).toMatch(/JSON object/);
    expect(validate.validateInboundJson('srv', '"mixed"')).toMatch(
      /JSON object/,
    );
    expect(validate.validateInboundJson('srv', '')).toBe('Required');
  });
});

describe('listen address validation', () => {
  const { validate } = load();

  it('takes a bare address and refuses one in brackets', () => {
    for (const address of ['::', '0.0.0.0', '192.168.1.1', 'fd00::1'])
      expect(validate.validateListenAddress('srv', address), address).toBe(
        true,
      );
    for (const address of ['[::]', '[fd00::1]', 'router.lan'])
      expect(validate.validateListenAddress('srv', address), address).not.toBe(
        true,
      );
  });
});

describe('Shadowsocks key validation', () => {
  it('requires a base64 key of the exact cipher length for a 2022 method', () => {
    const { validate } = load({
      srv: {
        '.type': 'server',
        protocol: 'shadowsocks',
        shadowsocks_method: '2022-blake3-aes-128-gcm',
      },
    });

    const key16 = Buffer.alloc(16, 7).toString('base64');
    const key32 = Buffer.alloc(32, 7).toString('base64');

    expect(validate.validateShadowsocksPassword('srv', key16)).toBe(true);
    expect(validate.validateShadowsocksPassword('srv', key32)).toMatch(
      /16 bytes/,
    );
    expect(
      validate.validateShadowsocksPassword('srv', 'plain-password'),
    ).toMatch(/16 bytes/);
    expect(
      validate.validateShadowsocksPassword('srv', key16.replace(/=+$/, '')),
    ).toMatch(/16 bytes/);
  });

  it('accepts any password for the older AEAD methods', () => {
    const { validate } = load({
      srv: {
        '.type': 'server',
        protocol: 'shadowsocks',
        shadowsocks_method: 'aes-128-gcm',
      },
    });

    expect(validate.validateShadowsocksPassword('srv', 'plain-password')).toBe(
      true,
    );
    expect(validate.validateShadowsocksPassword('srv', '')).toBe('Required');
  });
});

describe('public host detection', () => {
  const { validate } = load();

  it('prefers a routable address over the LAN address', () => {
    expect(
      validate.chooseDefaultPublicHost([
        {
          interface: 'lan',
          up: true,
          'ipv4-address': [{ address: '192.168.1.1' }],
        },
        {
          interface: 'wan',
          up: true,
          'ipv4-address': [{ address: '203.0.113.9' }],
        },
        {
          interface: 'wan6',
          up: true,
          'ipv4-address': [{ address: '77.88.8.8' }],
        },
      ]),
    ).toBe('77.88.8.8');
  });

  it('falls back to the LAN address when no address is routable', () => {
    expect(
      validate.chooseDefaultPublicHost([
        {
          interface: 'lan',
          up: true,
          'ipv4-address': [{ address: '192.168.1.1' }],
        },
      ]),
    ).toBe('192.168.1.1');
  });
});
