export function normalizeHost(host: unknown) {
  return `${host || ''}`.trim().replace(/^\[|\]$/g, '');
}

export function isIpv4(value: string) {
  return /^(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])){3}$/.test(
    value,
  );
}

export function isIpv6(value: unknown) {
  const normalized = normalizeHost(value);
  if (!normalized.includes(':')) {
    return false;
  }

  try {
    new URL(`http://[${normalized}]/`);
    return true;
  } catch (_error) {
    return false;
  }
}

function isHostname(value: unknown) {
  const hostname = normalizeHost(value);
  if (hostname.length < 1 || hostname.length > 253 || hostname.endsWith('.')) {
    return false;
  }

  return hostname
    .split('.')
    .every((part: string) =>
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(part),
    );
}

export function isHost(value: unknown) {
  const host = normalizeHost(value);
  return isIpv4(host) || isIpv6(host) || isHostname(host);
}

export function formatHostForUri(host: unknown) {
  const normalized = normalizeHost(host);
  return isIpv6(normalized) ? `[${normalized}]` : normalized;
}

export function getBrowserHost() {
  return normalizeHost(window.location.hostname || '');
}

function isPrivateOrReservedIpv4(value: string) {
  if (!isIpv4(value)) {
    return true;
  }

  const [a, b] = value.split('.').map((part: string) => parseInt(part, 10));

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 2) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
}

export function isPrivateOrReservedIp(value: string) {
  const normalized = normalizeHost(value).toLowerCase();
  if (isIpv4(normalized)) {
    return isPrivateOrReservedIpv4(normalized);
  }
  if (!isIpv6(normalized)) {
    return true;
  }

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fe80') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8')
  );
}

export function normalizeCidrOrIp(value: unknown) {
  const normalized = `${value || ''}`.trim();
  if (!normalized.includes('/') && isIpv4(normalized)) {
    return `${normalized}/32`;
  }
  if (!normalized.includes('/') && isIpv6(normalized)) {
    return `${normalized}/128`;
  }
  return normalized;
}

export function isValidCidr(item: unknown) {
  const [address, prefix, extra] = `${item}`.split('/');
  if (extra != null || prefix == null || !/^[0-9]+$/.test(prefix)) {
    return false;
  }

  const prefixNumber = parseInt(prefix, 10);
  if (isIpv4(address)) {
    return prefixNumber >= 0 && prefixNumber <= 32;
  }
  if (isIpv6(address)) {
    return prefixNumber >= 0 && prefixNumber <= 128;
  }
  return false;
}
