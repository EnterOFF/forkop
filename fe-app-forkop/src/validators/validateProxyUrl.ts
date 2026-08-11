import { ValidationResult } from './types';

const NATIVE_PROXY_SCHEMES = new Set([
  'hysteria',
  'hysteria2',
  'hy2',
  'http',
  'http2',
  'http3',
  'https',
  'mieru',
  'mierus',
  'naive+https',
  'naive+quic',
  'socks',
  'socks4',
  'socks4a',
  'socks5',
  'ss',
  'trojan',
  'tuic',
  'vless',
  'vmess',
]);

export function validateProxyUrl(url: string): ValidationResult {
  const trimmedUrl = url.trim();
  const match = /^([a-z0-9+]+):\/\/(\S+)$/u.exec(trimmedUrl);
  if (match && NATIVE_PROXY_SCHEMES.has(match[1]))
    return { valid: true, message: _('Valid') };

  return {
    valid: false,
    message: _('The pasted link is not supported. Try JSON outbound.'),
  };
}
