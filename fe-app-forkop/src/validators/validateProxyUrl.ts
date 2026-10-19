import { ValidationResult } from './types';

const NATIVE_PROXY_SCHEMES = new Set([
  'anytls',
  'hysteria',
  'hysteria2',
  'hy2',
  'http2',
  'http3',
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

  // An http:// or https:// address is far more often a subscription pasted into
  // the wrong field than an HTTP proxy, and an HTTP proxy carries no UDP.
  if (match && (match[1] === 'http' || match[1] === 'https'))
    return {
      valid: false,
      message: _(
        'This is a web address: add a subscription under Subscription, and an HTTP proxy as a JSON outbound',
      ),
    };

  return {
    valid: false,
    message: _('The pasted link is not supported. Try JSON outbound.'),
  };
}
