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
      'listClients',
    ]),
  };
}

const CONTEXT = { tlsCertificateSha256: '' };

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
