// Read the way core/url.uc link_name() reads it: a VMess link's "ps", otherwise everything after
// the first "#", percent-decoded alike. A TrustTunnel link without a "#" names itself in its
// payload, which only the page reads: no released link is a TrustTunnel one.
export function getProxyUrlName(url: string) {
  const link = `${url ?? ''}`;
  const scheme = link.includes('://')
    ? link.slice(0, link.indexOf('://')).toLowerCase()
    : '';
  if (scheme === 'vmess') {
    const name = vmessName(link.slice('vmess://'.length));
    if (name) {
      return name;
    }
  }

  const marker = link.indexOf('#');
  if (marker >= 0) {
    return percentDecode(link.slice(marker + 1));
  }
  return scheme === 'tt' ? trustTunnelName(link.slice('tt://'.length)) : '';
}

// The name field (0x0C) of the tag-length-value payload, base64url after "tt://?", that
// TrustTunnel's DEEP_LINK.md defines; tags and lengths are QUIC variable-length integers.
function trustTunnelName(source: string) {
  const encoded = source
    .replace(/^\?/, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  let payload: Uint8Array;
  try {
    payload = Uint8Array.from(
      atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')),
      (character) => character.charCodeAt(0),
    );
  } catch {
    return '';
  }

  let name = '';
  for (let offset = 0; offset < payload.length; ) {
    const field = readVarint(payload, offset);
    const size = field && readVarint(payload, field.next);
    if (!size || size.next + size.value > payload.length) {
      return '';
    }
    if (field.value === 0x0c) {
      name = new TextDecoder().decode(
        payload.subarray(size.next, size.next + size.value),
      );
    }
    offset = size.next + size.value;
  }
  return name;
}

function readVarint(bytes: Uint8Array, offset: number) {
  if (offset >= bytes.length) {
    return null;
  }
  const length = 1 << (bytes[offset] >> 6);
  if (offset + length > bytes.length) {
    return null;
  }
  let value = bytes[offset] & 0x3f;
  for (let index = 1; index < length; index++) {
    value = value * 256 + bytes[offset + index];
  }
  return { value, next: offset + length };
}

function vmessName(source: string) {
  let payload = source;
  if (!payload.startsWith('{')) {
    const encoded = payload
      .split(/[@?#]/, 1)[0]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    try {
      payload = new TextDecoder().decode(
        Uint8Array.from(
          atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')),
          (character) => character.charCodeAt(0),
        ),
      );
    } catch {
      return '';
    }
  }

  try {
    const name = JSON.parse(payload)?.ps;
    return name ? `${name}` : '';
  } catch {
    return '';
  }
}

// A "%" not followed by two hex digits stays, instead of losing the whole name as
// decodeURIComponent() would.
function percentDecode(value: string) {
  const bytes: number[] = [];
  const encoder = new TextEncoder();

  for (let i = 0; i < value.length; ) {
    const hex = value.slice(i + 1, i + 3);
    if (value[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 3;
      continue;
    }
    const character = String.fromCodePoint(value.codePointAt(i)!);
    bytes.push(...encoder.encode(character));
    i += character.length;
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}
