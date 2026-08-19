import { describe, expect, it } from 'vitest';

import {
  createUciStub,
  loadLuciView,
  resetLuciViewCache,
} from './loadLuciView';

function load(sections = {}) {
  resetLuciViewCache();
  const uci = createUciStub({
    ...sections,
    srv: { '.type': 'server', label: 'Home', enabled: '1', ...sections.srv },
  });
  return { uci, clients: loadLuciView('server_clients', uci) };
}

describe('server clients', () => {
  it('creates one client with the credentials the protocol needs', () => {
    const { uci, clients } = load({ srv: { protocol: 'vless' } });

    clients.syncClients('srv');
    const list = clients.listClients('srv');

    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Home');
    expect(list[0].enabled).toBe(true);
    expect(list[0].uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(uci.get('forkop', list[0].id, 'server')).toBe('srv');
    expect(uci.get('forkop', list[0].id, '.type')).toBe('server_client');
  });

  it('numbers additional clients instead of repeating a name', () => {
    const { clients } = load({ srv: { protocol: 'trojan' } });

    clients.syncClients('srv');
    clients.addClient('srv');
    clients.addClient('srv');

    expect(clients.listClients('srv').map((client) => client.name)).toEqual([
      'Home',
      'Home-2',
      'Home-3',
    ]);
  });

  it('transliterates the name where the protocol sends it as an account name', () => {
    const { clients } = load({
      srv: { protocol: 'mixed', label: 'Мой прокси' },
    });

    clients.syncClients('srv');

    expect(clients.listClients('srv')[0].name).toBe('moi-proksi');
  });

  it('replaces credentials the new protocol cannot use', () => {
    const { clients } = load({ srv: { protocol: 'vless' } });

    clients.syncClients('srv');
    const [before] = clients.listClients('srv');
    expect(before.uuid).toBeTruthy();

    clients.setClientOption(before.id, 'flow', 'xtls-rprx-vision');
    // Switching to a password protocol drops the UUID and issues a password.
    clients.syncClients('srv');
    let uciModel = clients.listClients('srv');
    expect(uciModel[0].flow).toBe('xtls-rprx-vision');

    const { clients: trojanClients, uci } = load({
      srv: { protocol: 'trojan' },
    });
    trojanClients.syncClients('srv');
    const clientId = trojanClients.listClients('srv')[0].id;
    uci.set('forkop', clientId, 'uuid', 'stale-uuid');
    trojanClients.syncClients('srv');

    uciModel = trojanClients.listClients('srv');
    expect(uciModel[0].password).toBeTruthy();
    expect(uciModel[0].uuid).toBe('');
  });

  it('removes every client when the protocol carries none', () => {
    const { clients, uci } = load({ srv: { protocol: 'vless' } });

    clients.syncClients('srv');
    expect(clients.listClients('srv')).toHaveLength(1);

    uci.set('forkop', 'srv', 'protocol', 'tailscale');
    clients.syncClients('srv');

    expect(clients.listClients('srv')).toHaveLength(0);
  });

  it('reports only enabled clients as able to connect', () => {
    const { clients, uci } = load({ srv: { protocol: 'trojan' } });

    clients.syncClients('srv');
    const extra = clients.addClient('srv');
    uci.set('forkop', extra, 'enabled', '0');

    expect(clients.listClients('srv')).toHaveLength(2);
    expect(clients.enabledClients('srv')).toHaveLength(1);
  });

  it('keeps clients of one server out of another', () => {
    const { clients } = load({
      srv: { protocol: 'trojan' },
      other: {
        '.type': 'server',
        protocol: 'trojan',
        label: 'Other',
        enabled: '1',
      },
    });

    clients.syncClients('srv');
    clients.syncClients('other');

    expect(clients.listClients('srv')).toHaveLength(1);
    expect(clients.listClients('other')).toHaveLength(1);
    expect(clients.listClients('srv')[0].id).not.toBe(
      clients.listClients('other')[0].id,
    );
  });

  it('rejects an empty, duplicated or over-long client name', () => {
    const { clients } = load({ srv: { protocol: 'trojan' } });

    clients.syncClients('srv');
    const first = clients.listClients('srv')[0];
    const second = clients.addClient('srv');

    expect(clients.validateClientName('srv', second, '')).toMatch(/required/);
    expect(clients.validateClientName('srv', second, first.name)).toMatch(
      /unique/,
    );
    expect(clients.validateClientName('srv', second, 'a'.repeat(65))).toMatch(
      /64/,
    );
    expect(clients.validateClientName('srv', second, 'Дом')).toBe(true);
  });

  it('requires an account-safe name where the protocol sends it on the wire', () => {
    const { clients } = load({ srv: { protocol: 'ssh' } });

    clients.syncClients('srv');
    const clientId = clients.listClients('srv')[0].id;

    expect(clients.validateClientName('srv', clientId, 'alice')).toBe(true);
    expect(clients.validateClientName('srv', clientId, 'alice smith')).toMatch(
      /account name/,
    );
    expect(clients.validateClientName('srv', clientId, 'алиса')).toMatch(
      /account name/,
    );
  });

  it('validates each credential against the protocol', () => {
    const { clients } = load({ srv: { protocol: 'mtproto' } });

    clients.syncClients('srv');

    expect(clients.validateClientField('srv', 'secret', 'a'.repeat(32))).toBe(
      true,
    );
    expect(clients.validateClientField('srv', 'secret', 'short')).toMatch(
      /32 hex/,
    );
    expect(
      clients.validateClientField('srv', 'secret', '0'.repeat(32)),
    ).toMatch(/non-zero/);
  });
});
