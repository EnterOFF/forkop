// PEM text and the few X.509 fields a person checks a certificate by: whose it
// is and until when it is valid.

export interface PemBlock {
  label: string;
  // The base64 body without the armour lines and without RFC 1421 headers.
  body: string;
  // Header lines such as "Proc-Type: 4,ENCRYPTED" of a legacy encrypted key.
  headers: string[];
}

export interface CertificateInfo {
  commonName: string;
  subject: string;
  notAfter: Date | null;
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

function text(bytes: Uint8Array, item: Tlv) {
  const content = bytes.slice(item.start, item.end);
  // BMPString is UTF-16; every other string type a name uses is ASCII or UTF-8.
  if (item.tag === 0x1e) {
    let result = '';
    for (let i = 0; i + 1 < content.length; i += 2) {
      result += String.fromCharCode((content[i] << 8) | content[i + 1]);
    }
    return result;
  }
  return new TextDecoder().decode(content);
}

const ATTRIBUTE_NAMES: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '1.2.840.113549.1.9.1': 'emailAddress',
};

function objectIdentifier(bytes: Uint8Array, item: Tlv) {
  const content = bytes.slice(item.start, item.end);
  if (!content.length) return '';
  const parts = [Math.floor(content[0] / 40), content[0] % 40];
  let value = 0;
  for (let i = 1; i < content.length; i += 1) {
    value = value * 128 + (content[i] & 0x7f);
    if (!(content[i] & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

function nameAttributes(bytes: Uint8Array, name: Tlv) {
  const attributes: [string, string][] = [];
  for (const rdn of children(bytes, name)) {
    for (const pair of children(bytes, rdn)) {
      const [type, value] = children(bytes, pair);
      if (!type || !value || type.tag !== 0x06) continue;
      const oid = objectIdentifier(bytes, type);
      attributes.push([ATTRIBUTE_NAMES[oid] || oid, text(bytes, value)]);
    }
  }
  return attributes;
}

function time(bytes: Uint8Array, item: Tlv): Date | null {
  const value = text(bytes, item);
  const match =
    item.tag === 0x17
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(value)
      : item.tag === 0x18
        ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(value)
        : null;
  if (!match) return null;
  let year = Number(match[1]);
  if (item.tag === 0x17) year += year < 50 ? 2000 : 1900;
  return new Date(
    Date.UTC(
      year,
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0),
    ),
  );
}

export function certificateInfo(der: Uint8Array): CertificateInfo | null {
  const certificate = readTlv(der, 0, der.length);
  if (!certificate || certificate.tag !== 0x30) return null;
  const tbs = children(der, certificate)[0];
  if (!tbs || tbs.tag !== 0x30) return null;
  const fields = children(der, tbs);
  // An explicit [0] version comes first in every v3 certificate.
  const base = fields[0]?.tag === 0xa0 ? 1 : 0;
  const validity = fields[base + 3];
  const subject = fields[base + 4];
  if (!validity || validity.tag !== 0x30 || !subject || subject.tag !== 0x30) {
    return null;
  }
  const attributes = nameAttributes(der, subject);
  const notAfter = children(der, validity)[1];
  return {
    commonName: attributes.find(([name]) => name === 'CN')?.[1] || '',
    subject: attributes.map(([name, value]) => `${name}=${value}`).join(', '),
    notAfter: notAfter ? time(der, notAfter) : null,
  };
}
