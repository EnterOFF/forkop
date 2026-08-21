import { describe, expect, it } from 'vitest';

import {
  createUciStub,
  loadLuciView,
  resetLuciViewCache,
} from './loadLuciView';

function load(sections = {}) {
  resetLuciViewCache();
  const uci = createUciStub(sections);
  return {
    uci,
    validate: loadLuciView('server', uci, [
      'chooseDefaultPublicHost',
      'validateAuthorizedKeys',
      'validateInboundJson',
      'validateListenPort',
      'validateShadowsocksPassword',
      'validateShortId',
      'validateTailscaleHostname',
      'validateRealityKey',
      'validateOptionalMasquerade',
    ]),
  };
}

describe('Reality short ID validation', () => {
  const { validate } = load();

  it('accepts an even number of hex digits up to eight bytes', () => {
    expect(validate.validateShortId('srv', 'ab')).toBe(true);
    expect(validate.validateShortId('srv', '0123abcd')).toBe(true);
    expect(validate.validateShortId('srv', 'a'.repeat(16))).toBe(true);
  });

  // sing-box decodes the value as hex bytes, so an odd digit count makes the
  // service refuse to start instead of only rejecting the client.
  it('rejects an odd number of hex digits', () => {
    expect(validate.validateShortId('srv', 'abc')).toMatch(/even number/);
  });

  // One value only: a share link carries exactly one, so a second could not reach
  // any client through anything Forkop hands out.
  it('rejects more than eight bytes, non-hex input and a list', () => {
    expect(validate.validateShortId('srv', 'a'.repeat(18))).toMatch(/16 hex/);
    expect(validate.validateShortId('srv', 'zz')).toMatch(/even number/);
    expect(validate.validateShortId('srv', ['ab', 'cdef'])).toMatch(
      /even number/,
    );
    expect(validate.validateShortId('srv', '')).toMatch(/required/);
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
    // Editing the server that owns the port must not report a conflict with itself.
    expect(validate.validateListenPort('first', '30000')).toBe(true);
  });

  it('rejects the ports Forkop binds itself', () => {
    const { validate } = load();

    for (const port of ['53', '1602', '4534', '9090']) {
      expect(validate.validateListenPort('srv', port), port).not.toBe(true);
    }
  });

  it('rejects a port a section already serves its mixed proxy on', () => {
    const { validate } = load({
      rule: {
        '.type': 'section',
        label: 'Netflix',
        enabled: '1',
        mixed_proxy_enabled: '1',
        mixed_proxy_port: '8080',
      },
    });

    expect(validate.validateListenPort('srv', '8080')).toMatch(/Netflix/);
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
    expect(validate.validateListenPort('srv', '0')).toMatch(/1 and 65535/);
    expect(validate.validateListenPort('srv', '70000')).toMatch(/1 and 65535/);
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

  it('rejects a tag, because Forkop names the inbound after the server', () => {
    expect(
      validate.validateInboundJson('srv', '{"type":"mixed","tag":"mine"}'),
    ).toMatch(/tag/);
  });

  it('rejects unsupported types, broken JSON and bad ports', () => {
    expect(validate.validateInboundJson('srv', '{"type":"nope"}')).toMatch(
      /no inbound of type/,
    );
    expect(validate.validateInboundJson('srv', '{')).toMatch(/Invalid JSON/);
    expect(validate.validateInboundJson('srv', '[]')).toMatch(/type field/);
    expect(
      validate.validateInboundJson('srv', '{"type":"mixed","listen_port":0}'),
    ).toMatch(/1 and 65535/);
    expect(validate.validateInboundJson('srv', '')).toMatch(/required/);
  });
});

describe('Tailscale hostname validation', () => {
  const { validate } = load();

  it('accepts a DNS label and rejects what Tailscale would rewrite', () => {
    expect(validate.validateTailscaleHostname('srv', 'forkop-home')).toBe(true);
    expect(validate.validateTailscaleHostname('srv', 'Forkop_Home')).toMatch(
      /lowercase/,
    );
    expect(validate.validateTailscaleHostname('srv', 'мой-роутер')).toMatch(
      /lowercase/,
    );
    expect(validate.validateTailscaleHostname('srv', '-home')).toMatch(
      /lowercase/,
    );
    expect(validate.validateTailscaleHostname('srv', 'a'.repeat(64))).toMatch(
      /63/,
    );
    expect(validate.validateTailscaleHostname('srv', '')).toMatch(/required/);
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
    expect(validate.validateShadowsocksPassword('srv', '')).toMatch(/required/);
  });
});

describe('authorized key validation', () => {
  const { validate } = load();

  it('accepts OpenSSH public key lines only', () => {
    expect(
      validate.validateAuthorizedKeys('srv', [
        'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 user@host',
      ]),
    ).toBe(true);
    expect(validate.validateAuthorizedKeys('srv', [])).toBe(true);
    expect(validate.validateAuthorizedKeys('srv', ['not a key'])).toMatch(
      /OpenSSH/,
    );
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
