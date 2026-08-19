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
  return { uci, spec: loadLuciView('server_spec', uci) };
}

describe('server protocol spec', () => {
  let spec;
  let uci;

  beforeEach(() => {
    ({ spec, uci } = load());
  });

  it('describes every protocol it offers', () => {
    for (const protocol of spec.protocolIds()) {
      expect(spec.protocolLabel(protocol), protocol).toBeTruthy();
      expect(spec.protocolSummary(protocol), protocol).toBeTruthy();
      expect(spec.securitiesFor(protocol).length, protocol).toBeGreaterThan(0);
      for (const field of spec.credentialFields(protocol)) {
        expect(CREDENTIALS.has(field), `${protocol}.${field}`).toBe(true);
      }
    }
  });

  it('keeps Tailscale first and the raw JSON inbound last', () => {
    const ids = spec.protocolIds();
    expect(ids[0]).toBe('tailscale');
    expect(ids.at(-1)).toBe('json_inbound');
    expect(ids).not.toContain('socks');
    expect(ids).toContain('mixed');
  });

  it('gives every login protocol a password and an account name', () => {
    for (const protocol of spec.protocolIds()) {
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

  it('writes the defaults a fresh listener needs exactly once', () => {
    spec.applyProtocolDefaults('srv', 'vless', true);

    expect(uci.get('forkop', 'srv', 'protocol')).toBe('vless');
    expect(uci.get('forkop', 'srv', 'security')).toBe('reality');
    expect(uci.get('forkop', 'srv', 'listen')).toBe('0.0.0.0');
    expect(uci.get('forkop', 'srv', 'transport')).toBe('tcp');
    expect(uci.get('forkop', 'srv', 'reality_short_id')).toMatch(
      /^[0-9a-f]{8}$/,
    );
    // A random high port keeps a new server away from 443, where LuCI often is.
    const port = Number(uci.get('forkop', 'srv', 'listen_port'));
    expect(port).toBeGreaterThanOrEqual(20000);
    expect(port).toBeLessThan(50000);

    const previousPort = uci.get('forkop', 'srv', 'listen_port');
    spec.applyProtocolDefaults('srv', 'vless', false);
    expect(uci.get('forkop', 'srv', 'listen_port')).toBe(previousPort);
  });

  it('resets the security mode when the protocol changes', () => {
    spec.applyProtocolDefaults('srv', 'vless', true);
    spec.applyProtocolDefaults('srv', 'shadowsocks', true);

    expect(uci.get('forkop', 'srv', 'security')).toBe('none');
    expect(uci.get('forkop', 'srv', 'shadowsocks_method')).toBe(
      '2022-blake3-aes-128-gcm',
    );
    expect(uci.get('forkop', 'srv', 'shadowsocks_psk')).toMatch(
      /^[A-Za-z0-9+/]{21}[A-Za-z0-9+/=]{3}$/,
    );
  });

  it('derives the Tailscale hostname from the label as a DNS label', () => {
    uci.set('forkop', 'srv', 'label', 'Мой сервер');

    expect(spec.defaultTailscaleHostname('srv')).toBe('forkop-moi-server');
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
