import { ValidationResult } from './types';
import { asciiHostname, validAsciiDomain } from './validateDomain';
import { isIPv4, isIPv6 } from './validateIp';

export interface StaticHostsRecord {
  address: string;
  domains: string[];
}

export function staticHostsLines(text: string): string[] {
  return `${text || ''}`
    .split('\n')
    .map((line) =>
      line
        .replace(/\r/g, '')
        .replace(/[ \t]*(?:\/\/|#).*$/, '')
        .trim(),
    )
    .filter(Boolean);
}

export function parseStaticHosts(text: string): StaticHostsRecord[] {
  const records: StaticHostsRecord[] = [];

  for (const line of staticHostsLines(text)) {
    const [address, ...domains] = line.split(/[ \t]+/).filter(Boolean);
    records.push({ address: address || '', domains });
  }

  return records;
}

export function staticHostsDomainCount(text: string): number {
  const domains = new Set<string>();

  for (const record of parseStaticHosts(text)) {
    for (const domain of record.domains) {
      domains.add(domain.toLowerCase());
    }
  }

  return domains.size;
}

export function validateStaticHosts(text: string): ValidationResult {
  for (const record of parseStaticHosts(text)) {
    if (!record.domains.length) {
      return {
        valid: false,
        message: _(
          'Each line needs an address followed by at least one domain',
        ),
      };
    }

    if (!isIPv4(record.address) && !isIPv6(record.address)) {
      return {
        valid: false,
        message: `${_('Invalid IP address')}: ${record.address}`,
      };
    }

    for (const domain of record.domains) {
      const ascii = asciiHostname(domain.toLowerCase());

      if (!ascii || !validAsciiDomain(ascii, false)) {
        return {
          valid: false,
          message: `${_('Invalid domain address')}: ${domain}`,
        };
      }
    }
  }

  return { valid: true, message: _('Valid') };
}
