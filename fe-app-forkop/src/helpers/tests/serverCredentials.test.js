import { beforeEach, describe, expect, it } from 'vitest';

import { installLuciStubs } from './luciStubs';
import { visibleClientFields } from '../../forkop/tabs/servers/clients';
import { SHADOWSOCKS_METHODS } from '../../forkop/tabs/servers/constants';
import {
  generateCredential,
  generatePassword,
  generatePresharedKey,
} from '../../forkop/tabs/servers/credentials';
import { supportsVisionFlow } from '../../forkop/tabs/servers/protocols';

function load(sections = {}) {
  return {
    uci: installLuciStubs(sections),
    spec: {
      generateCredential,
      generatePassword,
      generatePresharedKey,
      supportsVisionFlow,
      visibleClientFields,
      SHADOWSOCKS_METHODS,
    },
  };
}

describe('generated server credentials', () => {
  let spec;
  let uci;

  beforeEach(() => {
    ({ spec, uci } = load({ srv: { protocol: 'vless' } }));
  });

  it('encodes a password as the base64url of its bytes', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const password = spec.generatePassword();
      expect(password).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(Buffer.from(password, 'base64url')).toHaveLength(18);
    }
  });

  it('gives every Shadowsocks method a key of exactly the length it takes', () => {
    for (const method of spec.SHADOWSOCKS_METHODS) {
      if (!method.keyBytes) continue;
      uci.set('forkop', 'srv', 'shadowsocks_method', method.id);
      const key = spec.generateCredential('srv', 'shadowsocks', 'password');
      expect(key, method.id).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(Buffer.from(key, 'base64'), method.id).toHaveLength(
        method.keyBytes,
      );
    }
  });

  it('defaults Shadowsocks to the 256 bit 2022 cipher', () => {
    expect(spec.SHADOWSOCKS_METHODS[0].id).toBe('2022-blake3-aes-256-gcm');
  });
});

describe('XTLS Vision availability', () => {
  const cases = [
    [{ protocol: 'vless', security: 'reality', transport: 'tcp' }, true],
    [{ protocol: 'vless', security: 'tls', transport: 'tcp' }, true],
    [{ protocol: 'vless', security: 'none', transport: 'tcp' }, false],
    [{ protocol: 'vless', security: 'tls', transport: 'ws' }, false],
    [{ protocol: 'vless', security: 'tls', transport: 'grpc' }, false],
    [{ protocol: 'vless', security: 'tls', transport: 'xhttp' }, false],
    [
      {
        protocol: 'vless',
        security: 'reality',
        transport: 'tcp',
        multiplex_enabled: '1',
      },
      false,
    ],
    [{ protocol: 'vmess', security: 'tls', transport: 'tcp' }, false],
  ];

  for (const [section, expected] of cases) {
    it(`${JSON.stringify(section)} -> ${expected}`, () => {
      const { spec } = load({ srv: section });

      expect(spec.supportsVisionFlow('srv')).toBe(expected);
      expect(spec.visibleClientFields('srv').includes('flow')).toBe(expected);
    });
  }

  it('still asks for the identity of a VLESS client that cannot use Vision', () => {
    const { spec } = load({
      srv: { protocol: 'vless', security: 'tls', transport: 'ws' },
    });

    expect(spec.visibleClientFields('srv')).toEqual(['uuid']);
  });
});
