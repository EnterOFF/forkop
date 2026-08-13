import { describe, expect, it } from 'vitest';

import { getProxyUrlName } from '../getProxyUrlName';

describe('getProxyUrlName', () => {
  it('matches sing-box link tag parsing', () => {
    expect(getProxyUrlName('vless://id@example.com#Node+Plus')).toBe(
      'Node+Plus',
    );
    expect(getProxyUrlName('mierus://user@example.com#Mieru%20Node')).toBe(
      'Mieru Node',
    );
    expect(
      getProxyUrlName(
        `vmess://${btoa(JSON.stringify({ ps: 'VMess node', add: 'example.com' }))}`,
      ),
    ).toBe('VMess node');
    expect(
      getProxyUrlName(
        'vmess://{"ps":"Raw VMess","add":"example.com","path":"/ws?ed=2048#inside"}',
      ),
    ).toBe('Raw VMess');
    expect(getProxyUrlName('trojan://secret@example.com')).toBe('');
  });
});
