import { domainToUnicode } from '../../../helpers/domainToUnicode';

// An address bar drops the default ports of HTTP and HTTPS, and most of the
// list is web traffic. Any other port says what a connection is for - 5222 for
// a messenger, 853 for DNS over TLS - so it stays.
const WEB_PORTS = new Set(['80', '443']);

function normalize(value?: string | number | null): string {
  return value == null ? '' : String(value).trim();
}

export function formatEndpoint(
  address?: string,
  port?: string | number,
): string {
  const normalizedAddress = domainToUnicode(normalize(address));
  const normalizedPort = normalize(port);

  if (!normalizedAddress) {
    return '-';
  }

  if (!normalizedPort || WEB_PORTS.has(normalizedPort)) {
    return normalizedAddress;
  }

  if (normalizedAddress.includes(':') && !normalizedAddress.startsWith('[')) {
    return `[${normalizedAddress}]:${normalizedPort}`;
  }

  return `${normalizedAddress}:${normalizedPort}`;
}
