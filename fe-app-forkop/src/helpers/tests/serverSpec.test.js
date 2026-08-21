import { beforeEach, describe, expect, it } from 'vitest';

import {
  createUciStub,
  loadLuciView,
  resetLuciViewCache,
} from './loadLuciView';

const CREDENTIALS = new Set([
  'uuid',
  'password',
  'secret',
  'flow',
  'authorized_keys',
]);

function load(sections = {}) {
  resetLuciViewCache();
  const uci = createUciStub(sections);
  return {
    uci,
    spec: loadLuciView('server', uci, [
      'buildMtprotoFullSecret',
      'credentialFields',
      'generateCredential',
      'getEffectiveSecurity',
      'getShadowsocksMethod',
      'isAuthenticationEnabled',
      'isShadowsocks2022',
      'normalizeMtprotoBaseSecret',
      'protocolLabel',
      'securitiesFor',
      'usesClients',
      'usesLoginName',
      'PROTOCOLS',
      'CAMOUFLAGE_SITES',
      'isHost',
      'randomItem',
      'randomPort',
    ]),
  };
}

describe('server protocol spec', () => {
  let spec;
  let uci;

  beforeEach(() => {
    ({ spec, uci } = load());
  });

  it('describes every protocol it offers', () => {
    for (const protocol of spec.PROTOCOLS.map((entry) => entry.id)) {
      expect(spec.protocolLabel(protocol), protocol).toBeTruthy();
      expect(spec.securitiesFor(protocol).length, protocol).toBeGreaterThan(0);
      for (const field of spec.credentialFields(protocol)) {
        expect(CREDENTIALS.has(field), `${protocol}.${field}`).toBe(true);
      }
    }
  });

  it('keeps Mixed first and the raw JSON inbound last', () => {
    const ids = spec.PROTOCOLS.map((entry) => entry.id);
    expect(ids[0]).toBe('mixed');
    expect(ids.at(-1)).toBe('json_inbound');
    expect(ids).not.toContain('socks');
    expect(ids).toContain('tailscale');
  });

  it('gives every login protocol a password and an account name', () => {
    for (const protocol of spec.PROTOCOLS.map((entry) => entry.id)) {
      if (!spec.usesLoginName(protocol)) continue;
      expect(spec.credentialFields(protocol), protocol).toContain('password');
    }
  });

  it('only offers clients where a protocol takes users', () => {
    expect(spec.usesClients('tailscale')).toBe(false);
    expect(spec.usesClients('json_inbound')).toBe(false);
    expect(spec.usesClients('vless')).toBe(true);
    expect(spec.usesClients('mtproto')).toBe(true);
  });

  it('falls back to a supported security mode for a stored value the protocol dropped', () => {
    uci.set('forkop', 'srv', 'protocol', 'trojan');
    uci.set('forkop', 'srv', 'security', 'reality');

    expect(spec.getEffectiveSecurity('srv')).toBe('tls');
  });

  it('offers camouflage sites as a choice and never as a default', () => {
    expect(spec.CAMOUFLAGE_SITES.length).toBeGreaterThanOrEqual(5);
    for (const site of spec.CAMOUFLAGE_SITES) {
      expect(spec.isHost(site), site).toBe(true);
    }
    expect(spec.CAMOUFLAGE_SITES).toContain(
      spec.randomItem(spec.CAMOUFLAGE_SITES),
    );
  });

  it('picks a listen port outside the range LuCI usually holds', () => {
    const port = Number(spec.randomPort());

    expect(port).toBeGreaterThanOrEqual(20000);
    expect(port).toBeLessThan(50000);
  });

  it('generates credentials the protocol can use', () => {
    expect(spec.generateCredential('srv', 'vless', 'uuid')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(spec.generateCredential('srv', 'mtproto', 'secret')).toMatch(
      /^[0-9a-f]{32}$/,
    );

    uci.set('forkop', 'srv', 'shadowsocks_method', '2022-blake3-aes-256-gcm');
    const key = spec.generateCredential('srv', 'shadowsocks', 'password');
    expect(Buffer.from(key, 'base64')).toHaveLength(32);

    uci.set('forkop', 'srv', 'shadowsocks_method', 'aes-128-gcm');
    expect(spec.isShadowsocks2022(spec.getShadowsocksMethod('srv'))).toBe(
      false,
    );
  });

  it('normalizes an MTProto secret that carries the FakeTLS host', () => {
    const full = spec.buildMtprotoFullSecret('a'.repeat(32), 'google.com');

    expect(full.startsWith('ee' + 'a'.repeat(32))).toBe(true);
    expect(spec.normalizeMtprotoBaseSecret(full)).toBe('a'.repeat(32));
    expect(spec.normalizeMtprotoBaseSecret('nonsense')).toBe('');
  });

  it('treats authentication as required unless the protocol makes it optional', () => {
    uci.set('forkop', 'srv', 'protocol', 'vless');
    expect(spec.isAuthenticationEnabled('srv')).toBe(true);

    uci.set('forkop', 'srv', 'protocol', 'mixed');
    expect(spec.isAuthenticationEnabled('srv')).toBe(true);
    uci.set('forkop', 'srv', 'mixed_auth_enabled', '0');
    expect(spec.isAuthenticationEnabled('srv')).toBe(false);
  });
});
