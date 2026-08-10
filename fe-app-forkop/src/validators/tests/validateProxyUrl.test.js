import { describe, it, expect } from 'vitest';
import { validateProxyUrl } from '../validateProxyUrl';

const validUrls = [
  ['shadowsocks', 'ss://YWVzLTI1Ni1nY206cGFzcw@example.com:8388'],
  [
    'vless',
    'vless://94792286-7bbe-4f33-8b36-18d1bbf70723@example.com:443?type=tcp&encryption=none&security=none',
  ],
  [
    'vmess',
    `vmess://${Buffer.from(
      JSON.stringify({
        v: '2',
        ps: 'Example VMess',
        add: 'example.com',
        port: '443',
        id: '94792286-7bbe-4f33-8b36-18d1bbf70723',
        aid: '0',
        scy: 'auto',
        net: 'ws',
        type: 'none',
        host: 'example.com',
        path: '/ws',
        tls: 'tls',
        sni: 'example.com',
      }),
    ).toString('base64')}`,
  ],
  ['trojan', 'trojan://password@example.com:443'],
  ['socks', 'socks://127.0.0.1:1080'],
  ['socks4', 'socks4://127.0.0.1:1080'],
  ['socks4a', 'socks4a://example.com:1080'],
  ['socks5', 'socks5://user:pass@example.com:1080'],
  ['tuic', 'tuic://uuid:password@example.com:443'],
  ['hysteria', 'hysteria://example.com:443?auth=secret'],
  ['hysteria2', 'hysteria2://password@example.com:443'],
  ['hy2', 'hy2://password@example.com:443'],
  ['naive HTTPS', 'naive+https://user:password@example.com:443'],
  ['naive QUIC', 'naive+quic://user:password@example.com:443'],
  [
    'mieru simple',
    'mierus://user:password@example.com?profile=default&port=443&protocol=TCP',
  ],
  ['mieru standard', 'mieru://opaque-native-payload'],
  [
    'mKCP transport delegated to core',
    'vless://uuid@example.com:443?type=kcp&headerType=wechat-video&seed=secret',
  ],
];

describe('validateProxyUrl', () => {
  describe.each(validUrls)('Valid proxy URL: %s', (_desc, url) => {
    it(`returns valid=true for "${url}"`, () => {
      const res = validateProxyUrl(url);
      expect(res.valid).toBe(true);
    });
  });

  it('trims surrounding whitespace before dispatching', () => {
    const res = validateProxyUrl('  socks5://user:pass@example.com:1080  ');

    expect(res.valid).toBe(true);
  });

  it('returns a clear error for unsupported protocols', () => {
    const res = validateProxyUrl('wireguard://example.com');

    expect(res.valid).toBe(false);
    expect(res.message).toBe(
      'The pasted link is not supported. Try JSON outbound.',
    );
  });

  it('rejects native HTTP proxy URLs', () => {
    const res = validateProxyUrl('https://user:pass@example.com:443');

    expect(res.valid).toBe(false);
    expect(res.message).not.toContain('http://');
  });

  it('leaves protocol-specific validation to sing-box-forkop', () => {
    expect(validateProxyUrl('vmess://opaque-native-payload').valid).toBe(true);
  });

  it('rejects whitespace and empty payloads before they reach the core', () => {
    expect(validateProxyUrl('vless://').valid).toBe(false);
    expect(validateProxyUrl('vless://uuid @example.com:443').valid).toBe(false);
  });
});
