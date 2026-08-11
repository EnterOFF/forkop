import { validateDomain } from './validateDomain';
import { isValidPort, parseHostPort, unbracketHost } from './hostPort';
import { validateIP } from './validateIp';
import { ValidationResult } from './types';

const DNS_SCHEMES = new Set(['udp', 'tcp', 'tls', 'https', 'quic', 'h3']);

export function validateDNS(value: string, ipOnly = false): ValidationResult {
  const normalized = `${value || ''}`.trim();
  if (!normalized) {
    return { valid: false, message: _('DNS server address cannot be empty') };
  }

  if (/[\s@?#]/.test(normalized)) {
    return {
      valid: false,
      message: _(
        'DNS server URI must not contain whitespace, credentials, query parameters, or fragments',
      ),
    };
  }

  const schemeMatch = normalized.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  const scheme = schemeMatch?.[1].toLowerCase() || 'udp';
  if (!DNS_SCHEMES.has(scheme)) {
    return {
      valid: false,
      message: _(
        'Unsupported DNS server protocol. Use udp://, tcp://, tls://, https://, quic://, or h3://',
      ),
    };
  }

  const endpoint = schemeMatch
    ? normalized.slice(schemeMatch[0].length)
    : normalized;
  const slash = endpoint.indexOf('/');
  const authority = slash >= 0 ? endpoint.slice(0, slash) : endpoint;
  const path = slash >= 0 ? endpoint.slice(slash) : '';
  if (path && scheme !== 'https' && scheme !== 'h3') {
    return {
      valid: false,
      message: _('DNS server paths are supported only for https:// and h3://'),
    };
  }

  const parsedHostPort = parseHostPort(authority);
  const host = parsedHostPort ? parsedHostPort.host : unbracketHost(authority);

  if (parsedHostPort && !isValidPort(parsedHostPort.port)) {
    return { valid: false, message: _('Invalid DNS server port') };
  }

  if (validateIP(host).valid) {
    return { valid: true, message: _('Valid') };
  }

  if (ipOnly) {
    return {
      valid: false,
      message: _('Bootstrap DNS server must use an IP address'),
    };
  }

  if (validateDomain(host).valid) {
    return { valid: true, message: _('Valid') };
  }

  return {
    valid: false,
    message: _(
      'Invalid DNS server format. Examples: 8.8.8.8, tls://1.1.1.1, or https://dns.example.com/dns-query',
    ),
  };
}
