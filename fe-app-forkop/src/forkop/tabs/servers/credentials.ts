import { getShadowsocksMethod, shadowsocksKeyBytes } from './protocols';

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);

  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  return bytes;
}

function bytesToString(bytes: ArrayLike<number>) {
  return Array.from(bytes)
    .map((byte) => String.fromCharCode(byte))
    .join('');
}

export function randomHex(byteLength: number) {
  return Array.from(randomBytes(byteLength))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function randomItem<T>(items: T[]): T {
  return items[randomBytes(1)[0] % items.length];
}

function stringToHex(value: unknown) {
  return Array.from(unescape(encodeURIComponent(`${value || ''}`)))
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
}

// Text, so the string is UTF-8 encoded first: btoa() only takes code points below
// 256 and a label may hold anything.
export function base64Encode(value: string) {
  return btoa(unescape(encodeURIComponent(value)));
}

export function base64UrlEncode(value: string) {
  return toBase64Url(base64Encode(value));
}

// Raw bytes, so they are encoded as they are. Running them through the text path
// would UTF-8 expand every byte above 0x7f and turn a 18 byte secret into a
// password of an unpredictable length.
function base64EncodeBytes(bytes: ArrayLike<number>) {
  return btoa(bytesToString(bytes));
}

function toBase64Url(value: string) {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function generateUuid() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }

  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

// 18 bytes, so the base64url form is exactly 24 characters with no padding, and
// every character is safe in a URI userinfo field.
export function generatePassword() {
  return toBase64Url(base64EncodeBytes(randomBytes(18)));
}

// Shadowsocks 2022 keys are standard base64 of exactly the byte count the cipher
// takes, so they are generated from the key length instead of a printable password.
export function generatePresharedKey(byteLength: number) {
  return base64EncodeBytes(randomBytes(byteLength));
}

function generateMtprotoSecret() {
  const secret = randomHex(16);
  return secret === '00000000000000000000000000000000'
    ? '11111111111111111111111111111111'
    : secret;
}

export function randomPort() {
  const bytes = randomBytes(2);
  return `${20000 + (((bytes[0] << 8) | bytes[1]) % 30000)}`;
}

export function normalizeSha256(value: unknown) {
  const normalized = `${value || ''}`.trim().replace(/:/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : '';
}

export function encodeQuery(params: Record<string, string>) {
  return Object.entries(params)
    .filter(([, value]) => value != null && value !== '')
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(`${value}`)}`,
    )
    .join('&');
}

export function normalizeMtprotoBaseSecret(value: unknown) {
  const secret = `${value || ''}`.trim().toLowerCase();

  if (/^[0-9a-f]{32}$/.test(secret)) {
    return secret;
  }
  if (/^ee[0-9a-f]{32}(?:[0-9a-f]{2})+$/.test(secret)) {
    return secret.slice(2, 34);
  }

  return '';
}

export function buildMtprotoFullSecret(baseSecret: string, faketls: string) {
  return `ee${baseSecret}${stringToHex(faketls || 'google.com')}`;
}

// The credential a client field expects for the current protocol.
export function generateCredential(
  sectionId: string,
  protocol: string,
  field: string,
) {
  if (field === 'uuid') {
    return generateUuid();
  }
  if (field === 'secret') {
    return generateMtprotoSecret();
  }
  if (field === 'password') {
    const keyBytes =
      protocol === 'shadowsocks'
        ? shadowsocksKeyBytes(getShadowsocksMethod(sectionId))
        : 0;
    return keyBytes > 0 ? generatePresharedKey(keyBytes) : generatePassword();
  }
  return '';
}
