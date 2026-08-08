import { ValidationResult } from './types';

const NATIVE_PROXY_SCHEMES = new Set([
  'hysteria',
  'hysteria2',
  'hy2',
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
    message: _(
      'Use a native sing-box link: vless://, vmess://, ss://, trojan://, socks://, tuic://, hysteria://, hysteria2://, hy2://, naive+https://, naive+quic://, mieru://, or mierus://',
    ),
  };
}
