import { describe, expect, it } from 'vitest';

import {
  createUciStub,
  loadLuciView,
  resetLuciViewCache,
} from './loadLuciView';

const UUID = '11111111-1111-4111-8111-111111111111';

function load(sections = {}) {
  resetLuciViewCache();
  const uci = createUciStub({
    ...sections,
    srv: { '.type': 'server', label: 'Home', enabled: '1', ...sections.srv },
  });
  return {
    uci,
    clients: loadLuciView('server', uci, [
      'clientSections',
      'listClients',
      'listedClientNames',
      'nextClientName',
      'pruneClientCredentials',
      'validateClientCredential',
      'validateClientName',
      'validateClientsOnSave',
      'visibleClientFields',
    ]),
  };
}

function client(id, owner, values = {}) {
  return {
    [id]: {
      '.type': 'server_client',
      server: owner,
      ...values,
    },
  };
}

describe('server client names', () => {
  // A client is a device, not a second label for the server, and the name travels
  // through clients and URIs that only keep ASCII.
  it('numbers clients instead of following the server name', () => {
    const { clients } = load({
      srv: { protocol: 'trojan' },
      ...client('one', 'srv', { name: 'client-1' }),
    });

    expect(clients.nextClientName(clients.listedClientNames('srv', null))).toBe(
      'client-2',
    );
  });

  it('uses the same pattern where the name goes on the wire', () => {
    const { clients } = load({ srv: { protocol: 'ssh' } });

    expect(clients.nextClientName(clients.listedClientNames('srv', null))).toBe(
      'client-1',
    );
  });

  // One past the count of the list as it stands, the way a new section is named.
  it('numbers one past the list', () => {
    const { clients } = load({ srv: { protocol: 'trojan' } });

    expect(clients.nextClientName([])).toBe('client-1');
    expect(clients.nextClientName(['client-1', 'client-3'])).toBe('client-3');
  });

  // The stored sections still hold the client the list no longer shows, so the
  // names have to come from the widget while the dialog is open.
  it('reads the names from the list as it stands', () => {
    const { clients } = load({
      srv: { protocol: 'trojan' },
      ...client('one', 'srv', { name: 'client-1' }),
      ...client('two', 'srv', { name: 'client-2' }),
    });
    const listOption = {
      formvalue: () => ['one'],
      inputValueForItem: (_sectionId, value) =>
        value === 'one' ? 'client-1' : value,
    };

    expect(clients.listedClientNames('srv', listOption)).toEqual(['client-1']);
    expect(
      clients.nextClientName(clients.listedClientNames('srv', listOption)),
    ).toBe('client-2');
    expect(clients.listedClientNames('srv', null)).toEqual([
      'client-1',
      'client-2',
    ]);
  });

  it('rejects an empty, over-long or unprintable name', () => {
    const { clients } = load({ srv: { protocol: 'trojan' } });

    expect(clients.validateClientName('srv', '')).toMatch(/required/);
    expect(clients.validateClientName('srv', 'a'.repeat(65))).toMatch(/64/);
    expect(clients.validateClientName('srv', 'Дом')).toBe(true);
    expect(
      clients.validateClientName('srv', `a${String.fromCharCode(7)}b`),
    ).toMatch(/control/);
  });

  it('requires an account-safe name where the protocol sends it on the wire', () => {
    const { clients } = load({ srv: { protocol: 'ssh' } });

    expect(clients.validateClientName('srv', 'alice')).toBe(true);
    expect(clients.validateClientName('srv', 'alice smith')).toMatch(
      /letters, digits/,
    );
    expect(clients.validateClientName('srv', 'алиса')).toMatch(
      /letters, digits/,
    );
  });
});

describe('server client sections', () => {
  it('keeps clients of one server out of another', () => {
    const { clients } = load({
      srv: { protocol: 'trojan' },
      other: {
        '.type': 'server',
        protocol: 'trojan',
        label: 'Other',
        enabled: '1',
      },
      ...client('mine', 'srv', { name: 'Client #1', password: 'a' }),
      ...client('theirs', 'other', { name: 'Client #1', password: 'b' }),
    });

    expect(clients.listClients('srv').map((entry) => entry.id)).toEqual([
      'mine',
    ]);
    expect(clients.listClients('other').map((entry) => entry.id)).toEqual([
      'theirs',
    ]);
  });

  // sing-box lists the users an inbound accepts and has no field to disable one, so
  // every client of a server is an account that can connect.
  it('reports every client of a server', () => {
    const { clients } = load({
      srv: { protocol: 'trojan' },
      ...client('one', 'srv', { name: 'Client #1', password: 'a' }),
      ...client('two', 'srv', { name: 'Client #2', password: 'b' }),
    });

    expect(clients.listClients('srv').map((entry) => entry.name)).toEqual([
      'Client #1',
      'Client #2',
    ]);
    expect(clients.listClients('srv')[0].enabled).toBeUndefined();
  });

  it('drops credentials the protocol stopped using', () => {
    const { uci, clients } = load({
      srv: { protocol: 'trojan' },
      ...client('one', 'srv', {
        name: 'Client #1',
        password: 'secret',
        uuid: UUID,
        flow: 'xtls-rprx-vision',
      }),
    });

    clients.pruneClientCredentials('srv');

    expect(uci.get('forkop', 'one', 'password')).toBe('secret');
    expect(uci.get('forkop', 'one', 'uuid')).toBe(null);
    expect(uci.get('forkop', 'one', 'flow')).toBe(null);
  });

  it('hides the password while mixed authentication is disabled', () => {
    const { clients } = load({
      srv: { protocol: 'mixed', mixed_auth_enabled: '0' },
    });

    expect(clients.visibleClientFields('srv')).toEqual([]);
  });
});

describe('server client credentials', () => {
  it('validates each credential against the protocol', () => {
    const { clients } = load({ srv: { protocol: 'mtproto' } });

    expect(
      clients.validateClientCredential('srv', 'secret', 'a'.repeat(32)),
    ).toBe(true);
    expect(clients.validateClientCredential('srv', 'secret', 'short')).toMatch(
      /32 hex/,
    );
    expect(
      clients.validateClientCredential('srv', 'secret', '0'.repeat(32)),
    ).toMatch(/non-zero/);
  });

  it('checks a UUID and an OpenSSH key line', () => {
    const { clients } = load({ srv: { protocol: 'vless' } });

    expect(clients.validateClientCredential('srv', 'uuid', UUID)).toBe(true);
    expect(clients.validateClientCredential('srv', 'uuid', 'nope')).toMatch(
      /UUID/,
    );
    expect(
      clients.validateClientCredential('srv', 'authorized_keys', [
        'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5',
      ]),
    ).toBe(true);
    expect(
      clients.validateClientCredential('srv', 'authorized_keys', ['nope']),
    ).toMatch(/OpenSSH/);
  });
});

describe('saving the client list', () => {
  it('asks for at least one client', () => {
    const { clients } = load({ srv: { protocol: 'trojan' } });

    expect(clients.validateClientsOnSave('srv', [])).toMatch(/at least one/);
  });

  it('reports a client whose credential is missing', () => {
    const { clients } = load({
      srv: { protocol: 'trojan' },
      ...client('one', 'srv', { name: 'Client #1' }),
    });

    expect(clients.validateClientsOnSave('srv', ['one'])).toMatch(
      /Client #1: /,
    );
  });

  it('reports two clients with the same name', () => {
    const { clients } = load({
      srv: { protocol: 'trojan' },
      ...client('one', 'srv', { name: 'Client #1', password: 'a' }),
      ...client('two', 'srv', { name: 'Client #1', password: 'b' }),
    });

    expect(clients.validateClientsOnSave('srv', ['one', 'two'])).toMatch(
      /unique/,
    );
  });

  it('accepts a complete list', () => {
    const { clients } = load({
      srv: { protocol: 'trojan' },
      ...client('one', 'srv', { name: 'Client #1', password: 'a' }),
      ...client('two', 'srv', { name: 'Client #2', password: 'b' }),
    });

    expect(clients.validateClientsOnSave('srv', ['one', 'two'])).toBe(true);
  });
});
