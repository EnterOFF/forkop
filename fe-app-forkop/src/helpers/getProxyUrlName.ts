export function getProxyUrlName(url: string) {
  try {
    if (url.startsWith('vmess://')) {
      const source = url.slice('vmess://'.length);
      const encoded = source.startsWith('{')
        ? source
        : source.split(/[@?#]/, 1)[0];
      const payload = encoded.startsWith('{')
        ? encoded
        : new TextDecoder().decode(
            Uint8Array.from(
              atob(
                encoded
                  .replace(/-/g, '+')
                  .replace(/_/g, '/')
                  .padEnd(Math.ceil(encoded.length / 4) * 4, '='),
              ),
              (character) => character.charCodeAt(0),
            ),
          );
      const name = JSON.parse(payload)?.ps;
      if (typeof name === 'string' && name) return name;
    }

    const [_link, hash] = url.split('#');

    if (!hash) {
      return '';
    }

    return decodeURIComponent(hash);
  } catch {
    return '';
  }
}
