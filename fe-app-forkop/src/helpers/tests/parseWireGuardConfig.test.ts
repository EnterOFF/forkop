import { describe, expect, it } from 'vitest';
import {
  parseWireGuardConfig,
  parseWireGuardInput,
} from '../parseWireGuardConfig';

const PRIVATE_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const PUBLIC_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
const SECOND_PUBLIC_KEY = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=';
const PRESHARED_KEY = 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=';
// Standard base64 keys carry `/` and `+`, which a URL parser and a form-body
// query parser respectively destroy.
const SLASH_KEY = '//////////////////////////////////////////8=';
const PLUS_KEY = '+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/s=';

function base64Url(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '');
}

async function amneziaLink(value: unknown): Promise<string> {
  const source = new TextEncoder().encode(JSON.stringify(value));
  const compressed = new Uint8Array(
    await new Response(
      new Blob([Uint8Array.from(source)])
        .stream()
        .pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  );
  const packed = new Uint8Array(4 + compressed.length);
  new DataView(packed.buffer).setUint32(0, source.length);
  packed.set(compressed, 4);
  return `vpn://${base64Url(packed)}`;
}

describe('parseWireGuardConfig', () => {
  it('imports a standard client with multiple addresses and peers', () => {
    const result = parseWireGuardConfig(`
[Interface]
 PrivateKey = ${PRIVATE_KEY}
Address = 10.0.0.2/32, fd00::2/128
MTU = 1280

[Peer]
 PublicKey = ${PUBLIC_KEY}
 PresharedKey = ${PRESHARED_KEY}
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25

[Peer]
 PublicKey = ${SECOND_PUBLIC_KEY}
Endpoint = [2001:db8::1]:443
AllowedIPs = 192.0.2.0/24
`);

    expect(result).toEqual({
      valid: true,
      endpoint: {
        type: 'wireguard',
        address: ['10.0.0.2/32', 'fd00::2/128'],
        private_key: PRIVATE_KEY,
        mtu: 1280,
        peers: [
          {
            address: 'vpn.example.com',
            port: 51820,
            public_key: PUBLIC_KEY,
            pre_shared_key: PRESHARED_KEY,
            allowed_ips: ['0.0.0.0/0', '::/0'],
            persistent_keepalive_interval: 25,
          },
          {
            address: '2001:db8::1',
            port: 443,
            public_key: SECOND_PUBLIC_KEY,
            allowed_ips: ['192.0.2.0/24'],
          },
        ],
      },
    });
  });

  it('imports current AmneziaWG fields and ignores legacy fields', () => {
    const result = parseWireGuardConfig(`
[Interface]
 PrivateKey = ${PRIVATE_KEY}
Address = 10.0.0.2/32
Jc = 5
Jmin = 10
Jmax = 50
S1 = 64
H1 = 100-200
I1 = <b 0x01>
J1 = <c>
ITime = 500
HeaderProtectionKey = ${PRIVATE_KEY}
ContentPaddingAddition = 1-2
RekeyAfterTime = 5
[Peer]
 PublicKey = ${PUBLIC_KEY}
Endpoint = vpn.example.com:443
AllowedIPs = 0.0.0.0/0
`);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.endpoint.amnezia).toEqual({
      jc: 5,
      jmin: 10,
      jmax: 50,
      s1: 64,
      h1: '100-200',
      i1: '<b 0x01>',
      header_protection_key: PRIVATE_KEY,
      content_padding_addition: '1-2',
      rekey_after_time: 5,
    });
  });

  it('uses WireGuard default port when an endpoint omits it', () => {
    const result = parseWireGuardConfig(`[Interface]
PrivateKey = ${PRIVATE_KEY}
Address = 10.0.0.2/32
[Peer]
PublicKey = ${PUBLIC_KEY}
Endpoint = vpn.example.com
AllowedIPs = 0.0.0.0/0`);

    expect(result).toMatchObject({
      valid: true,
      endpoint: { peers: [{ address: 'vpn.example.com', port: 51820 }] },
    });
  });

  it('normalizes bare interface and AllowedIPs addresses for sing-box', () => {
    const result = parseWireGuardConfig(`[Interface]
PrivateKey = ${PRIVATE_KEY}
Address = 10.0.0.2, fd00::2
[Peer]
PublicKey = ${PUBLIC_KEY}
Endpoint = vpn.example.com:51820
AllowedIPs = 192.0.2.1, 2001:db8::1`);

    expect(result).toMatchObject({
      valid: true,
      endpoint: {
        address: ['10.0.0.2/32', 'fd00::2/128'],
        peers: [{ allowed_ips: ['192.0.2.1/32', '2001:db8::1/128'] }],
      },
    });
  });

  // wg-quick and the WireGuard apps cut a line at its first #, and read a
  // keepalive of off as none.
  it('reads a configuration the way wg-quick does', () => {
    const result = parseWireGuardConfig(`[Interface]
PrivateKey = ${PRIVATE_KEY} # the laptop
Address = 10.0.0.2/32 #, 10.0.0.3/32
Jc = 4 # junk
[Peer] # home
PublicKey = ${PUBLIC_KEY}
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = off`);

    expect(result).toEqual({
      valid: true,
      endpoint: {
        type: 'wireguard',
        address: ['10.0.0.2/32'],
        private_key: PRIVATE_KEY,
        peers: [
          {
            address: 'vpn.example.com',
            port: 51820,
            public_key: PUBLIC_KEY,
            allowed_ips: ['0.0.0.0/0'],
          },
        ],
        amnezia: { jc: 4 },
      },
    });
  });

  it('rejects invalid interface and AllowedIPs prefixes', () => {
    expect(
      parseWireGuardConfig(`[Interface]
PrivateKey = ${PRIVATE_KEY}
Address = 10.0.0.2/99
[Peer]
PublicKey = ${PUBLIC_KEY}
Endpoint = vpn.example.com:51820`).valid,
    ).toBe(false);
    expect(
      parseWireGuardConfig(`[Interface]
PrivateKey = ${PRIVATE_KEY}
Address = 10.0.0.2/32
[Peer]
PublicKey = ${PUBLIC_KEY}
Endpoint = vpn.example.com:51820
AllowedIPs = not-a-subnet`).valid,
    ).toBe(false);
  });

  it('rejects incomplete client configs', () => {
    expect(parseWireGuardConfig('[Interface]\nAddress=10.0.0.2/32').valid).toBe(
      false,
    );
    expect(
      parseWireGuardConfig(
        '[Interface]\nPrivateKey=x\nAddress=10.0.0.2/32\n[Peer]\nPublicKey=y',
      ).valid,
    ).toBe(false);
  });

  it('rejects peers without AllowedIPs or with invalid WireGuard keys', () => {
    const missingAllowedIps = parseWireGuardConfig(`[Interface]
PrivateKey = ${PRIVATE_KEY}
Address = 10.0.0.2/32
[Peer]
PublicKey = ${PUBLIC_KEY}
Endpoint = vpn.example.com:51820`);
    expect(missingAllowedIps.valid).toBe(false);
    expect(
      parseWireGuardConfig(`[Interface]
PrivateKey = invalid
Address = 10.0.0.2/32
[Peer]
PublicKey = ${PUBLIC_KEY}
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0`).valid,
    ).toBe(false);
    expect(
      parseWireGuardConfig(`[Interface]
PrivateKey = ${PRIVATE_KEY}
Address = 10.0.0.2/32
[Peer]
PublicKey = invalid
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0`).valid,
    ).toBe(false);
    expect(
      parseWireGuardConfig(`[Interface]
PrivateKey = ${PRIVATE_KEY}
Address = 10.0.0.2/32
[Peer]
PublicKey = ${PUBLIC_KEY}
PresharedKey = invalid
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0`).valid,
    ).toBe(false);
  });

  it('rejects AmneziaWG ranges outside uint32 and descending ranges', () => {
    for (const range of ['4294967296', '200-100']) {
      const result = parseWireGuardConfig(`[Interface]
PrivateKey = ${PRIVATE_KEY}
Address = 10.0.0.2/32
H1 = ${range}
[Peer]
PublicKey = ${PUBLIC_KEY}
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0`);
      expect(result.valid).toBe(false);
    }
  });

  it('imports an official qCompress Amnezia AWG 2 link', async () => {
    const link = await amneziaLink({
      defaultContainer: 'amnezia-awg2',
      dns1: '1.1.1.1',
      dns2: '1.0.0.1',
      containers: [
        {
          container: 'amnezia-awg2',
          awg: {
            protocol_version: '2',
            last_config: JSON.stringify({
              mtu: '1380',
              config: `[Interface]
Address = 10.8.1.2/32
DNS = $PRIMARY_DNS, $SECONDARY_DNS
PrivateKey = ${PRIVATE_KEY}
Jc = 5
Jmin = 10
Jmax = 50
S1 = 64
H1 = 100-200
I1 = <b 0x01>
I2 =
I3 =
[Peer]
PublicKey = ${PUBLIC_KEY}
PresharedKey = ${PRESHARED_KEY}
AllowedIPs = 0.0.0.0/0
Endpoint = vpn.example.com:443
PersistentKeepalive = 25`,
            }),
          },
        },
      ],
    });

    const result = await parseWireGuardInput(link);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.endpoint).toMatchObject({
      address: ['10.8.1.2/32'],
      private_key: PRIVATE_KEY,
      mtu: 1380,
      amnezia: {
        jc: 5,
        jmin: 10,
        jmax: 50,
        s1: 64,
        h1: '100-200',
        i1: '<b 0x01>',
      },
      peers: [
        {
          address: 'vpn.example.com',
          port: 443,
          public_key: PUBLIC_KEY,
          pre_shared_key: PRESHARED_KEY,
          allowed_ips: ['0.0.0.0/0'],
          persistent_keepalive_interval: 25,
        },
      ],
    });
  });

  it('imports an AmneziaWG 3.1 profile with random trailers and disabled cookies', async () => {
    const link = await amneziaLink({
      defaultContainer: 'amnezia-awg2',
      containers: [
        {
          container: 'amnezia-awg2',
          awg: {
            protocol_version: '3.1',
            last_config: JSON.stringify({
              config: `[Interface]\nAddress = 10.8.1.2/32\nPrivateKey = ${PRIVATE_KEY}\nS1 = 12\nS2 = 12\nS3 = 12\nS4 = 12\nH1 = 1\nH2 = 2\nH3 = 3\nH4 = 4\nHeaderProtectionKey = ${PUBLIC_KEY}\nRandomTrailers = on\nDisableCookies = on\n[Peer]\nPublicKey = ${PUBLIC_KEY}\nEndpoint = vpn.example.com:443\nAllowedIPs = 0.0.0.0/0`,
            }),
          },
        },
      ],
    });

    expect(await parseWireGuardInput(link)).toMatchObject({
      valid: true,
      endpoint: { amnezia: { random_trailers: true, disable_cookies: true } },
    });
    expect(link).toContain('_');
    expect(await parseWireGuardInput(link.replace(/_/gu, '\\_'))).toMatchObject(
      {
        valid: true,
        endpoint: { amnezia: { random_trailers: true, disable_cookies: true } },
      },
    );
  });

  it('accepts the uncompressed base64url fallback used by Amnezia', async () => {
    const config = `[Interface]
PrivateKey = ${PRIVATE_KEY}
Address = 10.0.0.2/32
[Peer]
PublicKey = ${PUBLIC_KEY}
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0`;
    const result = await parseWireGuardInput(
      `vpn://${base64Url(new TextEncoder().encode(config))}`,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects malformed and non-WireGuard Amnezia links', async () => {
    expect((await parseWireGuardInput('vpn://not-base64!')).valid).toBe(false);
    expect(
      (
        await parseWireGuardInput(
          await amneziaLink({
            defaultContainer: 'amnezia-xray',
            containers: [{ container: 'amnezia-xray', xray: {} }],
          }),
        )
      ).valid,
    ).toBe(false);
  });

  it('imports an Amnezia profile pasted as plain JSON', async () => {
    const result = await parseWireGuardInput(
      JSON.stringify({
        defaultContainer: 'amnezia-awg',
        containers: [
          {
            container: 'amnezia-awg',
            awg: {
              last_config: JSON.stringify({
                mtu: 1280,
                config: `[Interface]
Address = 10.8.1.2/32
PrivateKey = ${PRIVATE_KEY}
Jc = 4
[Peer]
PublicKey = ${PUBLIC_KEY}
Endpoint = vpn.example.com:443
AllowedIPs = 0.0.0.0/0`,
              }),
            },
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      valid: true,
      endpoint: { mtu: 1280, amnezia: { jc: 4 } },
    });
  });

  it('imports a wireguard:// share link and routes everything by default', () => {
    const result = parseWireGuardConfig(
      `wireguard://${encodeURIComponent(PRIVATE_KEY)}@3x.example.com:25397` +
        `?publickey=${encodeURIComponent(PUBLIC_KEY)}` +
        `&address=10.0.0.2%2F32&mtu=1420#-1`,
    );

    expect(result).toEqual({
      valid: true,
      endpoint: {
        type: 'wireguard',
        address: ['10.0.0.2/32'],
        private_key: PRIVATE_KEY,
        mtu: 1420,
        peers: [
          {
            address: '3x.example.com',
            port: 25397,
            public_key: PUBLIC_KEY,
            allowed_ips: ['0.0.0.0/0', '::/0'],
          },
        ],
      },
    });
  });

  it('accepts the link aliases, spellings and AmneziaWG parameters', () => {
    const result = parseWireGuardConfig(
      `awg://${PLUS_KEY}@[2001:db8::1]:443?peer_public_key=${encodeURIComponent(
        PUBLIC_KEY,
      )}&ip=10.0.0.2&allowed_ips=0.0.0.0%2F0&psk=${encodeURIComponent(
        PRESHARED_KEY,
      )}&keepalive=25-35&listen_port=51821&jc=4&s1=64&h1=100-200` +
        `&i1=%3Cb%200x01%3E&max_handshake_attempts=15-20&dns=1.1.1.1`,
    );

    expect(result).toEqual({
      valid: true,
      endpoint: {
        type: 'wireguard',
        address: ['10.0.0.2/32'],
        private_key: PLUS_KEY,
        listen_port: 51821,
        peers: [
          {
            address: '2001:db8::1',
            port: 443,
            public_key: PUBLIC_KEY,
            pre_shared_key: PRESHARED_KEY,
            allowed_ips: ['0.0.0.0/0'],
            persistent_keepalive_interval: '25-35',
          },
        ],
        amnezia: {
          jc: 4,
          s1: 64,
          h1: '100-200',
          i1: '<b 0x01>',
          max_handshake_attempts: '15-20',
        },
      },
    });
  });

  it('keeps a private key that is not percent-encoded in the link', () => {
    for (const scheme of ['wg', 'amneziawg']) {
      const result = parseWireGuardConfig(
        `${scheme}://${SLASH_KEY}@vpn.example.com:51820/?publickey=${PUBLIC_KEY}&address=10.0.0.2/32`,
      );
      expect(result).toMatchObject({
        valid: true,
        endpoint: {
          private_key: SLASH_KEY,
          peers: [{ public_key: PUBLIC_KEY }],
        },
      });
    }
  });

  it('rejects links the core cannot honour', () => {
    const link = (query: string) =>
      parseWireGuardConfig(
        `wireguard://${encodeURIComponent(
          PRIVATE_KEY,
        )}@vpn.example.com:51820?publickey=${encodeURIComponent(
          PUBLIC_KEY,
        )}&address=10.0.0.2%2F32&${query}`,
      );

    expect(link('reserved=0,0,0').valid).toBe(true);
    expect(link('reserved=113,45,67').valid).toBe(false);
    expect(link('randomtrailers=on').valid).toBe(true);
    expect(link('randomtrailers=off').valid).toBe(true);
    expect(link('randomtrailers=maybe').valid).toBe(false);
    expect(parseWireGuardConfig('vless://not-a-tunnel').valid).toBe(false);
  });

  it('rejects AmneziaWG values the core would refuse at runtime', () => {
    const config = (fields: string) => `[Interface]
PrivateKey = ${PRIVATE_KEY}
Address = 10.0.0.2/32
${fields}
[Peer]
PublicKey = ${PUBLIC_KEY}
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0`;

    expect(parseWireGuardConfig(config('S1 = 65536')).valid).toBe(false);
    expect(parseWireGuardConfig(config('S1 = 65535')).valid).toBe(true);
    expect(parseWireGuardConfig(config('Jc = 4294967296')).valid).toBe(false);
    expect(parseWireGuardConfig(config('I1 = deadbeef')).valid).toBe(false);
    expect(parseWireGuardConfig(config('I1 = <zz 1>')).valid).toBe(false);
    expect(parseWireGuardConfig(config('I1 = <b 0x01')).valid).toBe(false);
    expect(parseWireGuardConfig(config(`HeaderProtectionKey = ff`)).valid).toBe(
      false,
    );
    expect(parseWireGuardConfig(config('H1 = 2'))).toEqual({
      valid: false,
      message: 'H1-H4 must not overlap',
    });
    expect(parseWireGuardConfig(config('Jmin = 60\nJmax = 10'))).toEqual({
      valid: false,
      message: 'Jmin is greater than Jmax',
    });
  });

  it('imports a current AmneziaWG server profile with empty AWG 3 fields', () => {
    const result = parseWireGuardConfig(`[Interface]
Address = 10.8.1.2/32
DNS = 1.1.1.1, 1.0.0.1
PrivateKey = ${PRIVATE_KEY}
Jc = 4
Jmin = 40
Jmax = 70
S1 = 0
S2 = 0
S3 = 0
S4 = 0
H1 = 1
H2 = 2
H3 = 3
H4 = 4
I1 = <r 2><b 0x8580>
I2 =
I3 =
I4 =
I5 =
HeaderProtectionKey =
ContentPaddingAddition =
RekeyAfterTime =
RekeyTimeout =
RejectAfterTime =
KeepaliveTimeout =
MaxHandshakeAttempts =
RandomTrailers =
DisableCookies = on

[Peer]
PublicKey = ${PUBLIC_KEY}
PresharedKey = ${PRESHARED_KEY}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = vpn.example.com:41185
PersistentKeepalive = 25-35
AdvancedSecurity = on`);

    expect(result).toMatchObject({
      valid: true,
      endpoint: {
        amnezia: { jc: 4, s4: 0, h4: 4, i1: '<r 2><b 0x8580>' },
        peers: [{ persistent_keepalive_interval: '25-35' }],
      },
    });
    if (!result.valid) return;
    expect(result.endpoint.amnezia?.header_protection_key).toBeUndefined();
  });

  it('accepts a configuration that needs AmneziaWG random trailers', () => {
    expect(
      parseWireGuardConfig(`[Interface]
PrivateKey = ${PRIVATE_KEY}
Address = 10.0.0.2/32
Jc = 4
RandomTrailers = on
[Peer]
PublicKey = ${PUBLIC_KEY}
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0`).valid,
    ).toBe(true);
  });
});
