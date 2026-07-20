const COPYABLE_PROXY_URI_RE =
  /^(vless|vmess|trojan|ss|hysteria|hysteria2|hy2|tuic|socks|socks4|socks4a|socks5):\/\//i;

export function isCopyableProxyLink(link?: string) {
  return COPYABLE_PROXY_URI_RE.test((link || '').trim());
}
