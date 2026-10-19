// What WireGuard and AmneziaWG mean the same thing by wherever the page meets
// them: a key, and the AmneziaWG parameters, one row each - the key sing-box
// reads, the name an awg-quick configuration gives it, how its value is written,
// and whether a peer speaking plain WireGuard can ignore it. The tunnel dialog,
// the configuration import and the server profiles all read this one table, and
// singbox/amnezia.uc is held to it through tests/fixtures/page_contract.json.

export type AmneziaKind =
  | 'count'
  | 'padding'
  | 'range'
  | 'signature'
  | 'key'
  | 'flag';

export interface AmneziaParameter {
  key: string;
  conf: string;
  kind: AmneziaKind;
  // Obfuscation one side adds on its own: junk and signature packets any peer
  // drops as unknown UDP, content padding trimmed away with the rest of the
  // plaintext, and local timings. The rest describes the wire both ends read,
  // except DisableCookies, which only changes what a server under load answers
  // and so does nothing for a tunnel.
  oneSided: boolean;
}

const row = (
  key: string,
  conf: string,
  kind: AmneziaKind,
  oneSided: boolean,
): AmneziaParameter => ({ key, conf, kind, oneSided });

export const AMNEZIA_PARAMETERS: AmneziaParameter[] = [
  row('jc', 'Jc', 'count', true),
  row('jmin', 'Jmin', 'count', true),
  row('jmax', 'Jmax', 'count', true),
  row('s1', 'S1', 'padding', false),
  row('s2', 'S2', 'padding', false),
  row('s3', 'S3', 'padding', false),
  row('s4', 'S4', 'padding', false),
  row('h1', 'H1', 'range', false),
  row('h2', 'H2', 'range', false),
  row('h3', 'H3', 'range', false),
  row('h4', 'H4', 'range', false),
  row('i1', 'I1', 'signature', true),
  row('i2', 'I2', 'signature', true),
  row('i3', 'I3', 'signature', true),
  row('i4', 'I4', 'signature', true),
  row('i5', 'I5', 'signature', true),
  row('header_protection_key', 'HeaderProtectionKey', 'key', false),
  row('content_padding_addition', 'ContentPaddingAddition', 'range', true),
  row('rekey_after_time', 'RekeyAfterTime', 'range', true),
  row('rekey_timeout', 'RekeyTimeout', 'range', true),
  row('reject_after_time', 'RejectAfterTime', 'range', true),
  row('keepalive_timeout', 'KeepaliveTimeout', 'range', true),
  row('max_handshake_attempts', 'MaxHandshakeAttempts', 'range', true),
  row('random_trailers', 'RandomTrailers', 'flag', false),
  row('disable_cookies', 'DisableCookies', 'flag', false),
];

export const AMNEZIA_KEYS = AMNEZIA_PARAMETERS.map(({ key }) => key);

export const ONE_SIDED_AMNEZIA_KEYS = AMNEZIA_PARAMETERS.filter(
  ({ oneSided }) => oneSided,
).map(({ key }) => key);

const BY_KEY = new Map(AMNEZIA_PARAMETERS.map((entry) => [entry.key, entry]));

export function amneziaParameter(key: string) {
  return BY_KEY.get(key);
}

function randomInt(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// A fresh AmneziaWG 3.1 parameter set, drawn the way 3x-ui draws one for every
// inbound, so that no two servers share the fingerprint a fixed set would give
// them all. The paddings start at the 12 bytes header protection needs, and S1
// and S2 never differ by the 56 bytes that would give the two handshake
// packets one size. Each header comes from a quarter of its own above the
// WireGuard message types and below what Amnezia's Windows client accepts.
// The timings stay around WireGuard's own, every rekey 30 seconds before the
// earliest rejection, and the content padding stays within 64 bytes, as the
// junk on a full data packet has to.
export function generateAmneziaParameters(): Record<string, string> {
  const jmin = randomInt(40, 89);
  const s1 = randomInt(15, 150);
  let s2 = randomInt(15, 150);
  while (s1 + 56 === s2) s2 = randomInt(15, 150);
  const band = Math.floor((2147483647 - 5 + 1) / 4);
  const [h1, h2, h3, h4] = [0, 1, 2, 3].map(
    (index) => `${randomInt(5 + index * band, 4 + (index + 1) * band)}`,
  );
  const padding = randomInt(8, 24);
  const rekey = randomInt(100, 120);
  const lastRekey = rekey + randomInt(10, 40);
  const reject = lastRekey + randomInt(30, 60);
  const retry = randomInt(3, 6);
  const keepalive = randomInt(8, 12);
  const attempts = randomInt(15, 25);
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return {
    jc: `${randomInt(3, 6)}`,
    jmin: `${jmin}`,
    jmax: `${jmin + randomInt(50, 250)}`,
    s1: `${s1}`,
    s2: `${s2}`,
    s3: `${randomInt(12, 55)}`,
    s4: `${randomInt(12, 27)}`,
    h1,
    h2,
    h3,
    h4,
    i1: `<r ${randomInt(32, 256)}>`,
    i2: '',
    i3: '',
    i4: '',
    i5: '',
    header_protection_key: btoa(String.fromCharCode(...key)),
    content_padding_addition: `${padding}-${padding + randomInt(8, 40)}`,
    rekey_after_time: `${rekey}-${lastRekey}`,
    rekey_timeout: `${retry}-${retry + randomInt(1, 4)}`,
    reject_after_time: `${reject}-${reject + randomInt(30, 90)}`,
    keepalive_timeout: `${keepalive}-${keepalive + randomInt(2, 8)}`,
    max_handshake_attempts: `${attempts}-${attempts + randomInt(5, 25)}`,
    random_trailers: '1',
    disable_cookies: '1',
  };
}

const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

// Tags the core accepts inside a Custom Protocol Signature.
const SIGNATURE_TAGS = ['b', 'c', 't', 'r', 'rc', 'rd', 'd', 'ds', 'dz'];

export function parseUnsigned(
  value: string,
  maximum: number,
): number | undefined {
  if (!/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : undefined;
}

// A single value or a lo-hi range of them, the way AmneziaWG writes a range.
export function parseRange(
  value: string,
  maximum = UINT32_MAX,
): number | string | undefined {
  const parts = value.split('-');
  if (parts.length > 2 || parts.some((part) => part === '')) return undefined;
  const from = parseUnsigned(parts[0], maximum);
  const to = parts.length === 2 ? parseUnsigned(parts[1], maximum) : from;
  if (from === undefined || to === undefined || from > to) return undefined;
  return parts.length === 2 ? value : from;
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

/**
 * AmneziaWG I1-I5 hold a Custom Protocol Signature: a chain of `<tag value>`
 * packets such as `<b 0xdeadbeef><c><r 4>`. The core refuses an unknown tag and
 * silently sends nothing for a signature without any tag, so a plain hex blob
 * is rejected here instead of turning into obfuscation that never happens.
 */
export function validateAmneziaSignature(value: string): boolean {
  let rest = value.trim();
  let tags = 0;

  while (rest.length > 0) {
    const start = rest.indexOf('<');
    if (start < 0) break;
    const end = rest.indexOf('>', start);
    if (end < 0) return false;
    const [tag] = rest
      .slice(start + 1, end)
      .trim()
      .split(/\s+/u);
    if (!SIGNATURE_TAGS.includes(tag)) return false;
    tags += 1;
    rest = rest.slice(end + 1);
  }

  return tags > 0;
}

function keyMessage() {
  return _('WireGuard keys must be standard base64-encoded 32-byte values');
}

// Whether a value of the parameter, as the dialog and UCI hold it, is one the
// core accepts; an empty value leaves the parameter out and always is.
export function validateAmneziaValue(key: string, value: unknown) {
  const text = `${value ?? ''}`.trim();
  const entry = amneziaParameter(key);
  if (!text || !entry) return true;
  switch (entry.kind) {
    case 'count':
      return parseUnsigned(text, UINT32_MAX) !== undefined
        ? true
        : _('Use a whole number from 0 to 4294967295');
    case 'padding':
      return parseUnsigned(text, UINT16_MAX) !== undefined
        ? true
        : _('Use a whole number from 0 to 65535');
    case 'range':
      return parseRange(text) !== undefined
        ? true
        : _(
            'AmneziaWG ranges must be between 0 and 4294967295 with the start no greater than the end',
          );
    case 'signature':
      return validateAmneziaSignature(text)
        ? true
        : _(
            'AmneziaWG I1-I5 must be Custom Protocol Signature tags such as <b 0xdeadbeef><r 4>',
          );
    case 'key':
      return validateWireGuardKey(text) ? true : keyMessage();
    default:
      return text === '0' || text === '1' ? true : _('Use 0 or 1');
  }
}

function rangeBounds(value: string) {
  const parts = value.split('-').map(Number);
  return [parts[0], parts[parts.length - 1]];
}

// What the parameters have to hold together, beyond each value. The device
// refuses padding too short to carry the header protection nonce (the all-zero
// key turns protection off) and headers that overlap, a header it is not given
// being the WireGuard type number it keeps; sing-box's check passes both and
// the whole service fails to start. A junk minimum above the maximum is a size
// stock AmneziaWG cannot draw.
export function validateAmneziaSet(values: Record<string, unknown>) {
  const text = (key: string) => `${values[key] ?? ''}`.trim();

  const protectionKey = text('header_protection_key');
  if (
    protectionKey &&
    !/^A{43}=$/u.test(protectionKey) &&
    ['s1', 's2', 's3', 's4'].some((key) => Number(text(key) || 0) < 12)
  ) {
    return _(
      'Header protection requires S1, S2, S3 and S4 of at least 12 bytes',
    );
  }

  const headers = ['h1', 'h2', 'h3', 'h4'];
  if (headers.some((key) => text(key))) {
    const bounds = headers.map((key, index) =>
      rangeBounds(text(key) || `${index + 1}`),
    );
    const overlap = bounds.some(([from, to], index) =>
      bounds
        .slice(index + 1)
        .some(([otherFrom, otherTo]) => from <= otherTo && otherFrom <= to),
    );
    if (overlap) return _('H1, H2, H3 and H4 must not overlap');
  }

  if (Number(text('jmin') || 0) > Number(text('jmax') || 0)) {
    return _('Jmin must not be greater than Jmax');
  }
  return true;
}

// The value sing-box reads for a parameter given as the dialog holds it.
export function amneziaJsonValue(key: string, value: unknown) {
  const text = `${value ?? ''}`.trim();
  switch (amneziaParameter(key)?.kind) {
    case 'flag':
      return text === '1';
    case 'signature':
    case 'key':
      return text;
    case 'range':
      return text.includes('-') ? text : Number(text);
    default:
      return Number(text);
  }
}

const CONF_TRUE = ['on', 'true', '1', 'yes'];
const CONF_FALSE = ['off', 'false', '0', 'no'];

// A value of a configuration file as the dialog holds it, or null when the file
// writes a flag nothing reads.
export function amneziaTextFromConf(key: string, value: string) {
  if (amneziaParameter(key)?.kind !== 'flag') return value.trim();
  const flag = value.trim().toLowerCase();
  return CONF_TRUE.includes(flag)
    ? '1'
    : CONF_FALSE.includes(flag)
      ? '0'
      : null;
}

// The line of an awg-quick configuration that carries a parameter.
export function amneziaConfLine(key: string, value: unknown) {
  const entry = amneziaParameter(key)!;
  const text = `${value ?? ''}`.trim();
  return `${entry.conf} = ${entry.kind === 'flag' ? (text === '1' ? 'on' : 'off') : text}`;
}
