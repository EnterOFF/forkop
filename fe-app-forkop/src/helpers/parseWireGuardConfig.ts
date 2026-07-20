import { isIPv4, isIPv6 } from '../validators/validateIp';
import { validateSubnet } from '../validators/validateSubnet';

export type NativeWireGuardEndpoint = {
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
    persistent_keepalive_interval?: number;
  }>;
  amnezia?: Record<string, number | string>;
};

export type WireGuardConfigResult =
  | { valid: true; endpoint: NativeWireGuardEndpoint }
  | { valid: false; message: string };

type ConfigSection = {
  name: string;
  values: Record<string, string[]>;
};

type ImportedWireGuardConfig = {
  config: string;
  mtu?: string | number;
};

const MAX_AMNEZIA_CONFIG_SIZE = 1024 * 1024;
const DEFAULT_WIREGUARD_PORT = 51820;

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

function firstValue(section: ConfigSection, key: string): string {
  return section.values[key]?.[0]?.trim() || '';
}

function parseUnsigned(value: string, maximum: number): number | undefined {
  if (!/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : undefined;
}

/** WireGuard keys are standard padded base64 encodings of exactly 32 bytes. */
export function validateWireGuardKey(value: string): boolean {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(normalized)) return false;
  try {
    const decoded = atob(normalized);
    return decoded.length === 32 && btoa(decoded) === normalized;
  } catch {
    return false;
  }
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
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;

    const header = /^\[([^\]]+)\]$/u.exec(line);
    if (header) {
      current = { name: header[1].trim().toLowerCase(), values: {} };
      sections.push(current);
      continue;
    }

    const separator = line.indexOf('=');
    if (!current || separator < 1) return null;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!key) return null;
    (current.values[key] ||= []).push(value);
  }

  return sections;
}

function parseAmnezia(
  section: ConfigSection,
): Record<string, number | string> | undefined {
  const result: Record<string, number | string> = {};
  const integers = ['jc', 'jmin', 'jmax', 's1', 's2', 's3', 's4', 'itime'];
  const ranges = ['h1', 'h2', 'h3', 'h4'];
  const strings = ['i1', 'i2', 'i3', 'i4', 'i5', 'j1', 'j2', 'j3'];

  for (const key of integers) {
    const value = firstValue(section, key);
    if (!value) continue;
    const parsed = parseUnsigned(value, Number.MAX_SAFE_INTEGER);
    if (parsed === undefined) return undefined;
    result[key] = parsed;
  }
  for (const key of ranges) {
    const value = firstValue(section, key);
    if (!value) continue;
    const parts = value.split('-');
    if (parts.length > 2 || parts.some((part) => part === '')) return undefined;
    const from = parseUnsigned(parts[0], 0xffffffff);
    const to = parts.length === 2 ? parseUnsigned(parts[1], 0xffffffff) : from;
    if (from === undefined || to === undefined || from > to) return undefined;
    result[key] = value.includes('-') ? value : Number(value);
  }
  for (const key of strings) {
    const value = firstValue(section, key);
    if (value) result[key] = value;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function parseWireGuardConfig(input: string): WireGuardConfigResult {
  const sections = readSections(input);
  if (!sections)
    return { valid: false, message: _('Invalid WireGuard configuration') };

  const iface = sections.find((section) => section.name === 'interface');
  const peerSections = sections.filter((section) => section.name === 'peer');
  if (!iface || peerSections.length === 0)
    return {
      valid: false,
      message: _(
        'WireGuard configuration must contain Interface and Peer sections',
      ),
    };

  const addressValues = splitValues(iface.values.address);
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
  for (const section of peerSections) {
    const publicKey = firstValue(section, 'publickey');
    const remote = parsePeerEndpoint(firstValue(section, 'endpoint'));
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
    const preSharedKey = firstValue(section, 'presharedkey');
    if (preSharedKey && !validateWireGuardKey(preSharedKey))
      return {
        valid: false,
        message: _(
          'WireGuard keys must be standard base64-encoded 32-byte values',
        ),
      };
    const allowedIpValues = splitValues(section.values.allowedips);
    const allowedIps = normalizePrefixes(allowedIpValues);
    if (!allowedIps || allowedIps.length === 0)
      return {
        valid: false,
        message: allowedIps
          ? _('Every WireGuard peer needs at least one AllowedIPs subnet')
          : _('WireGuard addresses and AllowedIPs must use valid CIDR subnets'),
      };
    const keepaliveValue = firstValue(section, 'persistentkeepalive');
    if (preSharedKey) peer.pre_shared_key = preSharedKey;
    peer.allowed_ips = allowedIps;
    if (keepaliveValue) {
      const keepalive = parseUnsigned(keepaliveValue, 65535);
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
  const hasAmneziaInput = [
    'jc',
    'jmin',
    'jmax',
    's1',
    's2',
    's3',
    's4',
    'h1',
    'h2',
    'h3',
    'h4',
    'i1',
    'i2',
    'i3',
    'i4',
    'i5',
    'j1',
    'j2',
    'j3',
    'itime',
  ].some((key) => Boolean(firstValue(iface, key)));
  if (hasAmneziaInput && !amnezia)
    return { valid: false, message: _('Invalid AmneziaWG parameters') };
  if (amnezia) endpoint.amnezia = amnezia;

  return { valid: true, endpoint };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function decodeBase64Url(value: string): Uint8Array {
  const compact = value.replace(/\s+/gu, '');
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

export async function parseWireGuardInput(
  input: string,
): Promise<WireGuardConfigResult> {
  const value = input.trim();
  if (!value.startsWith('vpn://')) return parseWireGuardConfig(value);

  try {
    const packed = decodeBase64Url(value.slice('vpn://'.length));
    const decoded = await uncompressQtData(packed);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
    if (/^\s*\[Interface\](?:\r?\n|$)/u.test(text))
      return parseWireGuardConfig(text);

    const imported = extractAmneziaWireGuardConfig(JSON.parse(text));
    const result = parseWireGuardConfig(imported.config);
    if (result.valid && result.endpoint.mtu === undefined && imported.mtu) {
      const mtu = parseUnsigned(`${imported.mtu}`, 65535);
      if (mtu && mtu > 0) result.endpoint.mtu = mtu;
    }
    return result;
  } catch {
    return {
      valid: false,
      message: _('Invalid or unsupported Amnezia VPN link'),
    };
  }
}
