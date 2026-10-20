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

// btoa() takes only code points below 256, so text is UTF-8 encoded first.
export function base64Encode(value: string) {
  return btoa(unescape(encodeURIComponent(value)));
}

export function base64UrlEncode(value: string) {
  return toBase64Url(base64Encode(value));
}

// Raw bytes as they are: the text path would expand every byte above 0x7f.
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

// 18 bytes: exactly 24 base64url characters, no padding, safe in a URI userinfo.
export function generatePassword() {
  return toBase64Url(base64EncodeBytes(randomBytes(18)));
}

// Standard base64 of exactly the cipher's key length.
export function generatePresharedKey(byteLength: number) {
  return base64EncodeBytes(randomBytes(byteLength));
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

export function generateCredential(
  sectionId: string,
  protocol: string,
  field: string,
) {
  if (field === 'uuid') {
    return generateUuid();
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
