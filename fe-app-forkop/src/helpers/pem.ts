export interface PemBlock {
  label: string;
  // The base64 body without the armour lines and without RFC 1421 headers.
  body: string;
  // Header lines such as "Proc-Type: 4,ENCRYPTED" of a legacy encrypted key.
  headers: string[];
}

const BEGIN = /^-----BEGIN ([A-Za-z0-9 #-]+)-----$/;

export function pemBlocks(text: string): PemBlock[] {
  const blocks: PemBlock[] = [];
  let current: PemBlock | null = null;

  for (const raw of `${text || ''}`.split(/\r?\n/)) {
    const line = raw.trim();
    if (!current) {
      const begin = BEGIN.exec(line);
      if (begin) current = { label: begin[1], body: '', headers: [] };
      continue;
    }
    if (line === `-----END ${current.label}-----`) {
      blocks.push(current);
      current = null;
    } else if (/^[A-Za-z-]+:/.test(line)) {
      current.headers.push(line);
    } else {
      current.body += line;
    }
  }
  return blocks;
}

export function decodeBase64(body: string): Uint8Array | null {
  const text = `${body || ''}`.replace(/\s+/g, '');
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 !== 0) {
    return null;
  }
  try {
    const binary = atob(text);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch (_error) {
    return null;
  }
}

interface Tlv {
  tag: number;
  start: number;
  end: number;
}

function readTlv(bytes: Uint8Array, offset: number, limit: number): Tlv | null {
  if (offset + 2 > limit) return null;
  const tag = bytes[offset];
  let length = bytes[offset + 1];
  let start = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4 || start + count > limit) return null;
    length = 0;
    for (let i = 0; i < count; i += 1) length = length * 256 + bytes[start + i];
    start += count;
  }
  const end = start + length;
  return end <= limit ? { tag, start, end } : null;
}

function children(bytes: Uint8Array, parent: Tlv): Tlv[] {
  const result: Tlv[] = [];
  for (let offset = parent.start; offset < parent.end; ) {
    const item = readTlv(bytes, offset, parent.end);
    if (!item) return [];
    result.push(item);
    offset = item.end;
  }
  return result;
}

// The fields of the signed part of a certificate, or null when it is none.
function signedFields(der: Uint8Array) {
  const certificate = readTlv(der, 0, der.length);
  if (
    !certificate ||
    certificate.tag !== 0x30 ||
    certificate.end !== der.length
  ) {
    return null;
  }
  const signed = children(der, certificate)[0];
  return signed && signed.tag === 0x30 ? children(der, signed) : null;
}

// A certificate is a sequence whose first element, the signed part, holds the
// serial, the algorithm, the issuer, the validity and the subject in order,
// after an explicit version in every v3 certificate.
export function isCertificate(der: Uint8Array) {
  const fields = signedFields(der);
  if (!fields) return false;
  const base = fields[0]?.tag === 0xa0 ? 1 : 0;
  return (
    fields[base]?.tag === 0x02 &&
    [1, 2, 3, 4].every((index) => fields[base + index]?.tag === 0x30)
  );
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

// The value of the extension with the given OID, in the explicit [3] of the
// signed part, or null.
function extensionValue(der: Uint8Array, oid: string) {
  const extensions = (signedFields(der) || []).find(
    (field) => field.tag === 0xa3,
  );
  const list = extensions && children(der, extensions)[0];
  for (const extension of list ? children(der, list) : []) {
    const parts = children(der, extension);
    const value = parts[parts.length - 1];
    if (
      parts[0]?.tag === 0x06 &&
      hex(der.subarray(parts[0].start, parts[0].end)) === oid &&
      value?.tag === 0x04
    ) {
      return readTlv(der, value.start, value.end);
    }
  }
  return null;
}

// The first DNS name of the subject alternative names, the name clients check
// the certificate against, or ''.
export function certificateDnsName(der: Uint8Array) {
  const names = extensionValue(der, '551d11');
  const name = names && children(der, names).find((item) => item.tag === 0x82);
  return name ? String.fromCharCode(...der.subarray(name.start, name.end)) : '';
}

// OpenSSL and BoringSSL take a certificate as an issuer, of itself too, only
// without a key usage or with keyCertSign, bit 5 of the bit string.
export function certificateCanSignItself(der: Uint8Array) {
  const usage = extensionValue(der, '551d0f');
  if (!usage) return true;
  return (
    usage.tag === 0x03 &&
    usage.end - usage.start > 1 &&
    (der[usage.start + 1] & 0x04) !== 0
  );
}
