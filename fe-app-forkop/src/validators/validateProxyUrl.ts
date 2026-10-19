import { Check } from './types';

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

export function validateProxyUrl(url: string): Check {
  const match = /^([a-z0-9+]+):\/\/(\S+)$/u.exec(url.trim());
  return match && NATIVE_PROXY_SCHEMES.has(match[1])
    ? true
    : _('Unsupported link');
}
