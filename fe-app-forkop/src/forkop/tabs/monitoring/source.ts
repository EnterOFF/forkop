// Who a connection came from: the router itself, a device on the network, or a
// client of one of the servers. The cell, the device filter and the search all
// read the same description, so the filter offers exactly what the column shows.

export interface SourceConnection {
  metadata?: {
    sourceIP?: string;
    type?: string;
    user?: string;
  };
  rule?: string;
}

export interface SourceNames {
  // Device address to the name the router knows it by.
  devices: Record<string, string>;
  // Inbound tags of the servers.
  servers: Set<string>;
  // Per server tag, the user the core reports to the name of the client, where
  // the two differ: an OpenVPN client is reported by its certificate. A server
  // whose core reports no user names its clients by their source address.
  clients: Record<string, Record<string, string>>;
}

export type SourceKind = 'system' | 'device' | 'server';

export interface ConnectionSource {
  // The device filter value.
  key: string;
  kind: SourceKind;
  // The main text, and what is shown beside it muted. An address is always the
  // muted part, even when nothing names the device.
  name: string;
  detail: string;
  server: string;
  search: string;
}

const SYSTEM_SOURCE_KEY = '@system';
const SYSTEM_INBOUND_TAGS = new Set(['system-in', 'system6-in']);
const KIND_ORDER: SourceKind[] = ['system', 'device', 'server'];
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function text(value?: string | number | null): string {
  return value == null ? '' : String(value).trim();
}

function connectionInboundTag(connection: SourceConnection): string {
  const type = text(connection.metadata?.type);
  const tag = text(type.split('/').slice(1).join('/') || type);

  if (tag) {
    return tag;
  }

  return text(text(connection.rule).match(/(?:^|\s)inbound=([^\s]+)/)?.[1]);
}

// The source as plain text, where no colour can mute the detail.
export function sourceLabel(name: string, detail: string): string {
  return [name, detail].filter(Boolean).join(' · ');
}

export function describeSource(
  connection: SourceConnection,
  names: SourceNames,
): ConnectionSource {
  const ip = text(connection.metadata?.sourceIP);
  const tag = connectionInboundTag(connection);
  const search = (...values: string[]) =>
    [...values, ip, tag].filter(Boolean).join(' ');

  if (SYSTEM_INBOUND_TAGS.has(tag)) {
    const name = _('System');
    return {
      key: SYSTEM_SOURCE_KEY,
      kind: 'system',
      name,
      detail: '',
      server: '',
      search: search(name),
    };
  }

  if (names.servers.has(tag)) {
    // An inbound with several accounts reports the one that authenticated. One
    // without accounts has nothing but the address to tell its clients apart,
    // and a WireGuard server gives each client addresses of its own.
    const user = text(connection.metadata?.user);
    const byAddress = user ? '' : text(names.clients[tag]?.[ip]);
    const name = text(names.clients[tag]?.[user]) || user || byAddress || tag;
    const detail = user || byAddress ? tag : ip;
    return {
      key: JSON.stringify([tag, user, user ? '' : ip]),
      kind: 'server',
      name,
      detail,
      server: tag,
      search: search(sourceLabel(name, detail)),
    };
  }

  const name = text(names.devices[ip]);
  return {
    key: ip,
    kind: 'device',
    name,
    detail: ip,
    server: '',
    search: search(name),
  };
}

// The router first, then the devices, named ones before bare addresses, then
// the clients of each server together.
export function compareSources(a: ConnectionSource, b: ConnectionSource) {
  return (
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
    collator.compare(a.server, b.server) ||
    Number(!a.name) - Number(!b.name) ||
    collator.compare(a.name, b.name) ||
    collator.compare(a.detail, b.detail) ||
    a.key.localeCompare(b.key)
  );
}
