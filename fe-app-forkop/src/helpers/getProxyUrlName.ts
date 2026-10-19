// The name a share link carries for its server, the way core/url.uc link_name()
// reads it: a VMess link's own "ps" name, and otherwise everything after the
// first "#", percent-decoded the way core/url.uc does. A pasted link starts out
// under this name.
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
  return marker >= 0 ? percentDecode(link.slice(marker + 1)) : '';
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

// A "%" that does not start two hex digits stays as it is, rather than losing
// the whole name the way decodeURIComponent() would.
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
