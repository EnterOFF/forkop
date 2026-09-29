import { isIPv4, isIPv6 } from '../validators/validateIp';
import { validateSubnet } from '../validators/validateSubnet';
import {
  AMNEZIA_PARAMETERS,
  amneziaJsonValue,
  amneziaTextFromConf,
  parseRange,
  parseUnsigned,
  validateAmneziaSet,
  validateAmneziaValue,
  validateWireGuardKey,
} from './wireguard';

type NativeWireGuardEndpoint = {
  type: 'wireguard';
  address: string[];
  private_key: string;
  listen_port?: number;
  mtu?: number;
  peers: Array<{
    address: string;
    port: number;
    public_key: string;
    pre_shared_key?: string;
    allowed_ips: string[];
    persistent_keepalive_interval?: number | string;
  }>;
  amnezia?: Record<string, number | string | boolean>;
};

type WireGuardConfigResult =
  | { valid: true; endpoint: NativeWireGuardEndpoint }
  | { valid: false; message: string };

type FieldValues = Record<string, string[]>;

/**
 * Interface and peer fields collected from one of the supported sources. Field
 * names are canonical, so `PrivateKey`, `private_key` and `secretKey` all land
 * in the same slot and every source shares one normalization below.
 */
type WireGuardSource = {
  iface: FieldValues;
  peers: FieldValues[];
};

type ConfigSection = {
  name: string;
  values: FieldValues;
};

type ImportedWireGuardConfig = {
  config: string;
  mtu?: string | number;
};

type AmneziaResult =
  | { valid: true; amnezia?: Record<string, number | string | boolean> }
  | { valid: false; message: string };

const MAX_AMNEZIA_CONFIG_SIZE = 1024 * 1024;
const DEFAULT_WIREGUARD_PORT = 51820;

/**
 * Share-link schemes carrying a WireGuard peer. `wireguard://` is what 3x-ui,
 * v2rayN and NekoBox emit, `wg://` is the short form 3x-ui also accepts, and
 * `awg://` / `amneziawg://` are the AmneziaWG spellings: all four use the same
 * layout, so the obfuscation fields decide whether the tunnel is AmneziaWG.
 */
const LINK_SCHEMES = ['wireguard', 'wg', 'awg', 'amneziawg'];

/**
 * A peer in a share link routes everything by default: no generator writes
 * AllowedIPs into the link, while every one of them writes `0.0.0.0/0, ::/0`
 * into the configuration file it hands out for the same peer.
 */
const LINK_ALLOWED_IPS = '0.0.0.0/0, ::/0';

/** Canonical field name -> the spellings configurations and links use for it. */
const FIELD_ALIASES: Record<string, string[]> = {
  privatekey: ['secretkey'],
  address: ['addresses', 'ip'],
  publickey: ['peerpublickey', 'pubkey'],
  presharedkey: ['psk'],
  allowedips: ['allowedip'],
  persistentkeepalive: ['persistentkeepaliveinterval', 'keepalive'],
};

const CANONICAL_FIELDS: Record<string, string> = Object.fromEntries(
  Object.entries(FIELD_ALIASES).flatMap(([canonical, aliases]) =>
    aliases.map((alias) => [alias, canonical]),
  ),
);

/** Fields that describe the peer rather than the local interface. */
const PEER_FIELDS = [
  'publickey',
  'presharedkey',
  'allowedips',
  'persistentkeepalive',
  'endpoint',
  'reserved',
];

function splitValues(values: string[] | undefined): string[] {
  return (values || [])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizePrefixes(values: string[]): string[] | null {
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.includes('/')
      ? value
      : isIPv4(value)
        ? `${value}/32`
        : isIPv6(value)
          ? `${value}/128`
          : value;
    if (!normalized.includes('/') || !validateSubnet(normalized).valid)
      return null;
    result.push(normalized);
  }
  return result;
}

/**
 * Reduces a field name to its canonical form: configuration files, panels and
 * link generators spell the same field as `AllowedIPs`, `allowed_ips` or
 * `allowed-ips`, so separators and case are dropped before the alias lookup.
 */
function canonicalField(key: string): string {
  const compact = key
    .trim()
    .toLowerCase()
    .replace(/[-_\s]/gu, '');
  return CANONICAL_FIELDS[compact] || compact;
}

function addValue(values: FieldValues, key: string, value: string): void {
  const field = canonicalField(key);
  if (!field) return;
  (values[field] ||= []).push(value);
}

function firstValue(values: FieldValues, key: string): string {
  return values[key]?.[0]?.trim() || '';
}

function parsePeerEndpoint(
  value: string,
): { address: string; port: number } | null {
  const normalized = value.trim();
  let address = '';
  let port = DEFAULT_WIREGUARD_PORT;

  if (normalized.startsWith('[')) {
    const close = normalized.indexOf(']');
    if (close < 1) return null;
    address = normalized.slice(1, close);
    if (normalized.length > close + 1) {
      if (normalized[close + 1] !== ':') return null;
      const parsed = parseUnsigned(normalized.slice(close + 2), 65535);
      if (!parsed || parsed < 1) return null;
      port = parsed;
    }
  } else {
    const separator = normalized.lastIndexOf(':');
    if (separator > 0 && normalized.indexOf(':') === separator) {
      address = normalized.slice(0, separator);
      const parsed = parseUnsigned(normalized.slice(separator + 1), 65535);
      if (!parsed || parsed < 1) return null;
      port = parsed;
    } else {
      address = normalized;
    }
  }

  return address && !address.startsWith(':') ? { address, port } : null;
}

function readSections(input: string): ConfigSection[] | null {
  const sections: ConfigSection[] = [];
  let current: ConfigSection | null = null;

  for (const rawLine of input.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    // A line ends at its first #, the way wg-quick and the WireGuard apps read
    // it: nothing a configuration holds is written with one.
    const line = rawLine.replace(/#.*$/u, '').trim();
    if (!line || line.startsWith(';')) continue;

    const header = /^\[([^\]]+)\]$/u.exec(line);
    if (header) {
      current = { name: header[1].trim().toLowerCase(), values: {} };
      sections.push(current);
      continue;
    }

    const separator = line.indexOf('=');
    if (!current || separator < 1) return null;
    const key = line.slice(0, separator).trim();
    if (!key) return null;
    addValue(current.values, key, line.slice(separator + 1).trim());
  }

  return sections;
}

/** Collects the fields of a native wg-quick / awg-quick configuration file. */
function readConfigFile(input: string): WireGuardSource | { message: string } {
  const sections = readSections(input);
  if (!sections) return { message: _('Invalid WireGuard configuration') };

  const iface = sections.find((section) => section.name === 'interface');
  const peers = sections.filter((section) => section.name === 'peer');
  if (!iface || peers.length === 0)
    return {
      message: _(
        'WireGuard configuration must contain Interface and Peer sections',
      ),
    };

  return {
    iface: iface.values,
    peers: peers.map((section) => section.values),
  };
}

function decodeLinkComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Collects the fields of a `wireguard://` style share link, or returns null when
 * the input is not one. The link is split by hand rather than through `URL`:
 * the private key sits in the userinfo and its standard base64 may contain a
 * raw `/`, which a URL parser would take for the start of the path and drop the
 * key with it. `+` stays literal for the same reason — every key would lose a
 * byte if the query were read as a form body.
 */
function readShareLink(input: string): WireGuardSource | null {
  const link = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/su.exec(input);
  if (!link || !LINK_SCHEMES.includes(link[1].toLowerCase())) return null;

  let rest = link[2];
  const fragment = rest.indexOf('#');
  if (fragment >= 0) rest = rest.slice(0, fragment);
  const search = rest.indexOf('?');
  const query = search >= 0 ? rest.slice(search + 1) : '';
  let authority = search >= 0 ? rest.slice(0, search) : rest;

  const userinfo = authority.lastIndexOf('@');
  const iface: FieldValues = {};
  const peer: FieldValues = {};
  if (userinfo >= 0) {
    addValue(
      iface,
      'privatekey',
      decodeLinkComponent(authority.slice(0, userinfo)),
    );
    authority = authority.slice(userinfo + 1);
  }
  const path = authority.indexOf('/');
  if (path >= 0) authority = authority.slice(0, path);
  if (authority) addValue(peer, 'endpoint', decodeLinkComponent(authority));

  for (const pair of query.split('&')) {
    if (!pair) continue;
    const separator = pair.indexOf('=');
    const key = canonicalField(
      decodeLinkComponent(separator < 0 ? pair : pair.slice(0, separator)),
    );
    const value =
      separator < 0
        ? ''
        : decodeLinkComponent(pair.slice(separator + 1)).trim();
    if (!key || !value) continue;
    addValue(PEER_FIELDS.includes(key) ? peer : iface, key, value);
  }

  if (!peer.allowedips) addValue(peer, 'allowedips', LINK_ALLOWED_IPS);

  return { iface, peers: [peer] };
}

/**
 * Rejects fields the core cannot execute. `reserved` carries the Cloudflare
 * WARP client id that the edge routes on.
 * No endpoint in the core carries that field, so a link that needs it cannot
 * be honoured. Forkop's own Cloudflare WARP tunnel reaches the service without
 * those bytes, which is what such a link should become.
 *
 * Fields that only weaken obfuscation or mean nothing to a userspace peer are
 * dropped on purpose and stay silent: `DNS`, `Table`, `FwMark`, `SaveConfig`
 * and the `PreUp`/`PostUp`/`PreDown`/`PostDown` hooks are wg-quick host
 * plumbing, `AdvancedSecurity` is a server-side per-peer switch,
 * `J1`-`J3`/`Itime` are the junk train AmneziaWG 1.5
 * dropped as redundant in favour of `I1`-`I5`.
 */
function rejectUnsupportedFields(source: WireGuardSource): string {
  for (const values of [source.iface, ...source.peers]) {
    const reserved = splitValues(values.reserved);
    if (reserved.some((byte) => parseUnsigned(byte, 255) !== 0))
      return _(
        'Cloudflare WARP reserved bytes are not supported here. Add a Cloudflare WARP tunnel instead',
      );
  }

  return '';
}

function parseAmnezia(iface: FieldValues): AmneziaResult {
  const amnezia: Record<string, number | string | boolean> = {};
  const texts: Record<string, string> = {};

  for (const { key, conf, kind } of AMNEZIA_PARAMETERS) {
    const value = firstValue(iface, conf.toLowerCase());
    if (!value) continue;
    const text = amneziaTextFromConf(key, value);
    if (text === null)
      return { valid: false, message: _('Invalid AmneziaWG parameters') };
    const validation = validateAmneziaValue(key, text);
    if (validation !== true) return { valid: false, message: validation };
    texts[key] = text;
    if (kind !== 'flag' || text === '1')
      amnezia[key] = amneziaJsonValue(key, text);
  }

  const combination = validateAmneziaSet(texts);
  if (combination !== true) return { valid: false, message: combination };

  return {
    valid: true,
    amnezia: Object.keys(amnezia).length > 0 ? amnezia : undefined,
  };
}

/** Turns the fields of any supported source into a sing-box endpoint. */
function buildEndpoint(source: WireGuardSource): WireGuardConfigResult {
  const unsupported = rejectUnsupportedFields(source);
  if (unsupported) return { valid: false, message: unsupported };

  const { iface } = source;
  const addressValues = splitValues(iface.address);
  const address = normalizePrefixes(addressValues);
  const privateKey = firstValue(iface, 'privatekey');
  if (addressValues.length === 0 || !privateKey)
    return {
      valid: false,
      message: _('WireGuard address and private key are required'),
    };
  if (!validateWireGuardKey(privateKey))
    return {
      valid: false,
      message: _(
        'WireGuard keys must be standard base64-encoded 32-byte values',
      ),
    };
  if (!address)
    return {
      valid: false,
      message: _(
        'WireGuard addresses and AllowedIPs must use valid CIDR subnets',
      ),
    };

  const peers: NativeWireGuardEndpoint['peers'] = [];
  for (const values of source.peers) {
    const publicKey = firstValue(values, 'publickey');
    const remote = parsePeerEndpoint(firstValue(values, 'endpoint'));
    if (!publicKey || !remote)
      return {
        valid: false,
        message: _('Every WireGuard peer needs a public key and endpoint'),
      };
    if (!validateWireGuardKey(publicKey))
      return {
        valid: false,
        message: _(
          'WireGuard keys must be standard base64-encoded 32-byte values',
        ),
      };

    const peer: NativeWireGuardEndpoint['peers'][number] = {
      address: remote.address,
      port: remote.port,
      public_key: publicKey,
      allowed_ips: [],
    };
    const preSharedKey = firstValue(values, 'presharedkey');
    if (preSharedKey && !validateWireGuardKey(preSharedKey))
      return {
        valid: false,
        message: _(
          'WireGuard keys must be standard base64-encoded 32-byte values',
        ),
      };
    const allowedIps = normalizePrefixes(splitValues(values.allowedips));
    if (!allowedIps || allowedIps.length === 0)
      return {
        valid: false,
        message: allowedIps
          ? _('Every WireGuard peer needs at least one AllowedIPs subnet')
          : _('WireGuard addresses and AllowedIPs must use valid CIDR subnets'),
      };
    const keepaliveValue = firstValue(values, 'persistentkeepalive');
    if (preSharedKey) peer.pre_shared_key = preSharedKey;
    peer.allowed_ips = allowedIps;
    if (keepaliveValue && keepaliveValue.toLowerCase() !== 'off') {
      const keepalive = parseRange(keepaliveValue, 0xffffffff);
      if (keepalive === undefined)
        return {
          valid: false,
          message: _('Invalid WireGuard persistent keepalive'),
        };
      peer.persistent_keepalive_interval = keepalive;
    }
    peers.push(peer);
  }

  const endpoint: NativeWireGuardEndpoint = {
    type: 'wireguard',
    address,
    private_key: privateKey,
    peers,
  };
  const listenPortValue = firstValue(iface, 'listenport');
  const mtuValue = firstValue(iface, 'mtu');
  if (listenPortValue) {
    const listenPort = parseUnsigned(listenPortValue, 65535);
    if (listenPort === undefined || listenPort === 0)
      return { valid: false, message: _('Invalid WireGuard listen port') };
    endpoint.listen_port = listenPort;
  }
  if (mtuValue) {
    const mtu = parseUnsigned(mtuValue, 65535);
    if (mtu === undefined || mtu === 0)
      return { valid: false, message: _('Invalid WireGuard MTU') };
    endpoint.mtu = mtu;
  }

  const amnezia = parseAmnezia(iface);
  if (!amnezia.valid) return { valid: false, message: amnezia.message };
  if (amnezia.amnezia) endpoint.amnezia = amnezia.amnezia;

  return { valid: true, endpoint };
}

/**
 * Parses a native WireGuard/AmneziaWG configuration file or a `wireguard://`
 * style share link. Both reach the same normalization, so a link and the
 * configuration file for the same peer import to the same endpoint.
 */
export function parseWireGuardConfig(input: string): WireGuardConfigResult {
  const value = `${input || ''}`.trim();
  const link = readShareLink(value);
  if (link) return buildEndpoint(link);

  const source = readConfigFile(value);
  return 'message' in source
    ? { valid: false, message: source.message }
    : buildEndpoint(source);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function decodeBase64Url(value: string): Uint8Array {
  const compact = value.replace(/\\_/gu, '_').replace(/\s+/gu, '');
  if (
    compact.length === 0 ||
    compact.length > MAX_AMNEZIA_CONFIG_SIZE * 2 ||
    !/^[A-Za-z0-9_-]+={0,2}$/u.test(compact)
  )
    throw new Error('invalid base64url');

  const unpadded = compact.replace(/=+$/u, '');
  if (unpadded.length % 4 === 1) throw new Error('invalid base64url length');
  const binary = atob(
    unpadded.replace(/-/gu, '+').replace(/_/gu, '/') +
      '='.repeat((4 - (unpadded.length % 4)) % 4),
  );
  if (binary.length > MAX_AMNEZIA_CONFIG_SIZE)
    throw new Error('encoded config is too large');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function uncompressQtData(data: Uint8Array): Promise<Uint8Array> {
  if (data.length < 6) return data;
  const expectedSize = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ).getUint32(0);
  if (
    data[4] !== 0x78 ||
    ((data[4] << 8) | data[5]) % 31 !== 0 ||
    expectedSize === 0 ||
    expectedSize > MAX_AMNEZIA_CONFIG_SIZE
  )
    return data;

  const compressed = Uint8Array.from(data.subarray(4));
  const reader = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader();
  const output = new Uint8Array(expectedSize);
  let offset = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.length > output.length) {
      await reader.cancel();
      throw new Error('uncompressed config is too large');
    }
    output.set(value, offset);
    offset += value.length;
  }
  if (offset !== expectedSize) throw new Error('invalid uncompressed size');
  return output;
}

function extractAmneziaWireGuardConfig(
  value: unknown,
): ImportedWireGuardConfig {
  if (!isRecord(value) || !Array.isArray(value.containers))
    throw new Error('missing containers');

  const containers = value.containers.filter(isRecord);
  const defaultContainer =
    typeof value.defaultContainer === 'string' ? value.defaultContainer : '';
  const selected =
    containers.find(
      (container) =>
        container.container === defaultContainer &&
        (isRecord(container.awg) || isRecord(container.wireguard)),
    ) ||
    containers.find(
      (container) => isRecord(container.awg) || isRecord(container.wireguard),
    );
  if (!selected) throw new Error('missing WireGuard container');

  const protocol = isRecord(selected.awg)
    ? selected.awg
    : isRecord(selected.wireguard)
      ? selected.wireguard
      : null;
  if (!protocol) throw new Error('missing WireGuard protocol');

  const lastConfig =
    typeof protocol.last_config === 'string'
      ? JSON.parse(protocol.last_config)
      : protocol.last_config;
  if (!isRecord(lastConfig) || typeof lastConfig.config !== 'string')
    throw new Error('missing WireGuard config');

  const dns1 = typeof value.dns1 === 'string' ? value.dns1 : '';
  const dns2 = typeof value.dns2 === 'string' ? value.dns2 : '';
  return {
    config: lastConfig.config
      .split('$PRIMARY_DNS')
      .join(dns1)
      .split('$SECONDARY_DNS')
      .join(dns2),
    mtu:
      typeof lastConfig.mtu === 'string' || typeof lastConfig.mtu === 'number'
        ? lastConfig.mtu
        : undefined,
  };
}

function importAmneziaProfile(profile: unknown): WireGuardConfigResult {
  const imported = extractAmneziaWireGuardConfig(profile);
  const result = parseWireGuardConfig(imported.config);
  if (result.valid && result.endpoint.mtu === undefined && imported.mtu) {
    const mtu = parseUnsigned(`${imported.mtu}`, 65535);
    if (mtu && mtu > 0) result.endpoint.mtu = mtu;
  }
  return result;
}

/**
 * Parses everything the import dialog accepts: a native configuration file, a
 * `wireguard://` style share link, an Amnezia `vpn://` link and the Amnezia
 * profile JSON that link carries, which the client also exports on its own.
 */
export async function parseWireGuardInput(
  input: string,
): Promise<WireGuardConfigResult> {
  const value = input.trim();
  const isAmneziaLink = value.slice(0, 6).toLowerCase() === 'vpn://';
  if (!isAmneziaLink && !value.startsWith('{'))
    return parseWireGuardConfig(value);

  try {
    if (!isAmneziaLink) return importAmneziaProfile(JSON.parse(value));

    const packed = decodeBase64Url(value.slice('vpn://'.length));
    const decoded = await uncompressQtData(packed);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
    if (/^\s*\[Interface\](?:\r?\n|$)/u.test(text))
      return parseWireGuardConfig(text);

    return importAmneziaProfile(JSON.parse(text));
  } catch {
    return {
      valid: false,
      message: _('Invalid or unsupported Amnezia VPN link'),
    };
  }
}
