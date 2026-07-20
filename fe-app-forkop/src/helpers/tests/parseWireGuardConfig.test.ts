import { describe, expect, it } from 'vitest';
import {
  parseWireGuardConfig,
  parseWireGuardInput,
} from '../parseWireGuardConfig';

const PRIVATE_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const PUBLIC_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
const SECOND_PUBLIC_KEY = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=';
const PRESHARED_KEY = 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=';

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

  it('preserves AmneziaWG 2.0 fields in native endpoint format', () => {
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
      j1: '<c>',
      itime: 500,
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
});
