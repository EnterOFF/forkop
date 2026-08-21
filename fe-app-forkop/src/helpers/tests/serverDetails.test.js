import { describe, expect, it } from 'vitest';

import {
  createUciStub,
  loadLuciView,
  resetLuciViewCache,
} from './loadLuciView';

function load(server = {}, clients = {}) {
  resetLuciViewCache();
  const uci = createUciStub({
    srv: {
      '.type': 'server',
      label: 'Home',
      enabled: '1',
      listen: '0.0.0.0',
      listen_port: '30000',
      public_host: '203.0.113.9',
      routing_mode: 'rules',
      ...server,
    },
    ...clients,
  });
  return {
    uci,
    details: loadLuciView('server', uci, [
      'renderDetailsContent',
      'linkTitle',
      'showServerDetailsModal',
      'serverFactRows',
      'listClients',
    ]),
  };
}

const CONTEXT = { certificatePinExpected: false, tlsCertificateSha256: '' };

// The dialog is built before it is shown, so anything that throws here is a button
// that does nothing at all when it is pressed.
describe('server details', () => {
  it('builds the dialog for every protocol', () => {
    const protocols = [
      'mixed',
      'vless',
      'vmess',
      'trojan',
      'shadowsocks',
      'hysteria2',
      'tuic',
      'anytls',
      'naive',
      'ssh',
      'mieru',
      'mtproto',
    ];

    for (const protocol of protocols) {
      const { details } = load(
        { protocol },
        {
          cfg1: {
            '.type': 'server_client',
            server: 'srv',
            name: 'phone',
            password: 'secret-password',
            uuid: '11111111-1111-4111-8111-111111111111',
            secret: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        },
      );

      expect(
        () =>
          details.renderDetailsContent(
            'srv',
            details.listClients('srv'),
            CONTEXT,
          ),
        protocol,
      ).not.toThrow();
    }
  });

  it('builds the dialog for a listener with no accounts', () => {
    const { details } = load({ protocol: 'mixed', mixed_auth_enabled: '0' });

    expect(() =>
      details.renderDetailsContent('srv', [], CONTEXT),
    ).not.toThrow();
  });

  // The dialog is opened with its class names as separate arguments, because LuCI
  // spreads them into classList.add() and a token with a space in it throws, which
  // leaves the button that opens the dialog doing nothing at all.
  it('opens without an invalid class token', () => {
    const { details } = load({ protocol: 'vless' });

    expect(() => details.showServerDetailsModal('srv', [])).not.toThrow();
  });

  // The summary is what a client is pointed at. Anything a link already carries -
  // the Reality identity, the certificate fingerprint - stays out of it.
  it('states what the server is and nothing the link repeats', () => {
    const { details } = load({
      protocol: 'vless',
      security: 'reality',
      tls_server_name: 'www.apple.com',
      reality_public_key: 'public-key',
      reality_short_id: ['0a1b2c3d'],
      transport: 'ws',
      multiplex_enabled: '1',
      routing_mode: 'direct',
    });
    const rows = Object.fromEntries(details.serverFactRows('srv'));

    expect(rows.Protocol).toBe('VLESS');
    expect(rows.Address).toBe('203.0.113.9:30000');
    expect(rows.Security).toBe('Reality');
    expect(rows.Transport).toBe('WebSocket');
    expect(rows.Multiplex).toBe('Enabled');

    // Everything a link already carries, and everything that is a setting of the
    // server rather than of the connection, stays out of the summary.
    for (const absent of [
      'Reality public key',
      'Reality short ID',
      'Certificate SHA-256',
      'Server name / SNI',
      'Routing mode',
    ]) {
      expect(rows[absent], absent).toBeUndefined();
    }
  });

  // A transport is part of what a client has to match, so it is stated even when it
  // is the common case, and it is spelled the way the selector spells it.
  it('states the transport of a protocol that has one', () => {
    const stream = load({ protocol: 'vless' });
    expect(
      Object.fromEntries(stream.details.serverFactRows('srv')).Transport,
    ).toBe('TCP');

    const plain = load({ protocol: 'shadowsocks' });
    expect(
      Object.fromEntries(plain.details.serverFactRows('srv')).Transport,
    ).toBeUndefined();
  });

  // A code and a link say what they belong to: the server, the account when there
  // is one, and the scheme when the listener answers more than one.
  it('names what a link belongs to', () => {
    const { details } = load({ protocol: 'mixed' });

    expect(details.linkTitle('srv', { name: 'phone' }, '')).toBe(
      'Home \u00bb Client: phone',
    );
    expect(details.linkTitle('srv', { name: 'phone' }, 'SOCKS5')).toBe(
      'Home \u00bb Client: phone (SOCKS5)',
    );
    // A listener with no account is told apart by its scheme alone.
    expect(details.linkTitle('srv', { name: '' }, 'HTTP')).toBe('Home (HTTP)');
  });
});
