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

// A certificate is a sequence whose first element, the signed part, holds the
// serial, the algorithm, the issuer, the validity and the subject in order,
// after an explicit version in every v3 certificate.
export function isCertificate(der: Uint8Array) {
  const certificate = readTlv(der, 0, der.length);
  if (
    !certificate ||
    certificate.tag !== 0x30 ||
    certificate.end !== der.length
  ) {
    return false;
  }
  const signed = children(der, certificate)[0];
  if (!signed || signed.tag !== 0x30) return false;
  const fields = children(der, signed);
  const base = fields[0]?.tag === 0xa0 ? 1 : 0;
  return (
    fields[base]?.tag === 0x02 &&
    [1, 2, 3, 4].every((index) => fields[base + index]?.tag === 0x30)
  );
}
