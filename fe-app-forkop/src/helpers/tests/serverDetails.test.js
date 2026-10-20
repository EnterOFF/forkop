import { describe, expect, it } from 'vitest';

import { installLuciStubs } from './luciStubs';
import { listClients } from '../../forkop/tabs/servers/clients';
import {
  linkCaption,
  renderDetailsContent,
  showQrModal,
  showServerDetailsModal,
} from '../../forkop/tabs/servers/details';

function load(server = {}, clients = {}) {
  const uci = installLuciStubs({
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
    details: {
      renderDetailsContent,
      linkCaption,
      showQrModal,
      showServerDetailsModal,
      listClients,
    },
  };
}

const CONTEXT = { tlsCertificateSha256: '' };

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
      'mieru',
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

  it('opens without an invalid class token', () => {
    const { details } = load({ protocol: 'vless' });

    expect(() => details.showServerDetailsModal('srv', [])).not.toThrow();
    expect(() =>
      details.showQrModal({ name: 'phone', details: 'Home' }, 'vless://x'),
    ).not.toThrow();
  });

  it('opens the code straight away for a server with one link', () => {
    const client = (name) => ({
      '.type': 'server_client',
      server: 'srv',
      name,
      uuid: '11111111-1111-4111-8111-111111111111',
    });
    const opened = (clients) => {
      const { details } = load({ protocol: 'vmess' }, clients);
      const titles = [];
      globalThis.ui.showModal = (title) => titles.push(title);
      details.showServerDetailsModal('srv', details.listClients('srv'));
      return titles;
    };

    expect(opened({ c1: client('phone') })).toEqual(['QR code']);
    expect(opened({ c1: client('phone'), c2: client('laptop') })).toEqual([
      'Server details: Home',
    ]);
  });

  it('names what a code belongs to', () => {
    const { details } = load({ protocol: 'mixed' });

    expect(details.linkCaption('srv', { name: 'phone' }, '')).toEqual({
      name: 'phone',
      details: 'Home',
    });
    expect(details.linkCaption('srv', { name: 'phone' }, 'SOCKS5')).toEqual({
      name: 'phone',
      details: 'Home \u00b7 SOCKS5',
    });
    expect(details.linkCaption('srv', { name: '' }, 'HTTP')).toEqual({
      name: 'Home',
      details: 'HTTP',
    });
  });
});
