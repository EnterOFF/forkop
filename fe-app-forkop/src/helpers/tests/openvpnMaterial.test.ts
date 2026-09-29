import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkOpenVPNMaterial } from '../openvpnMaterial';
import { certificateInfo, decodeBase64, pemBlocks } from '../pem';
import {
  CA,
  CLIENT_CERT,
  CLIENT_KEY,
  CLIENT_KEY_PKCS1,
  EC_KEY,
  ENCRYPTED_KEY,
  SELF_SIGNED,
  STATIC_KEY,
} from './openvpnFixtures';

describe('certificate fields', () => {
  it('reads the common name and expiry of an RSA and a P-256 certificate', () => {
    const rsa = certificateInfo(decodeBase64(pemBlocks(CA)[0].body)!);
    expect(rsa).toMatchObject({ commonName: 'Forkop Test CA' });
    expect(rsa?.notAfter?.getUTCFullYear()).toBe(2036);

    // Past 2049 the expiry is a GeneralizedTime rather than a UTCTime.
    const ec = certificateInfo(decodeBase64(pemBlocks(SELF_SIGNED)[0].body)!);
    expect(ec).toMatchObject({ commonName: 'srvcn', subject: 'CN=srvcn' });
    expect(ec?.notAfter?.getUTCFullYear()).toBe(2126);
  });

  it('refuses what is not a certificate', () => {
    expect(certificateInfo(new Uint8Array([0x30, 0x03, 0x02, 0x01]))).toBe(
      null,
    );
    expect(decodeBase64('not base64!')).toBe(null);
  });
});

describe('OpenVPN material', () => {
  afterEach(() => vi.useRealTimers());

  it('sums a certificate up by its name and expiry', () => {
    expect(checkOpenVPNMaterial('certificate', CLIENT_CERT)).toMatchObject({
      valid: true,
      summary: expect.stringMatching(/^alice · valid until 2036-/),
      expired: false,
    });
    expect(checkOpenVPNMaterial('ca', `${CA}\n${CLIENT_CERT}`).summary).toMatch(
      /^2 certificates · /,
    );
  });

  it('marks a certificate that has expired', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2040-01-01T00:00:00Z'));
    expect(checkOpenVPNMaterial('ca', CA)).toMatchObject({
      valid: true,
      expired: true,
      summary: expect.stringContaining('expired on 2036-'),
    });
  });

  it('takes every unencrypted key format the core reads', () => {
    expect(checkOpenVPNMaterial('key', CLIENT_KEY).summary).toBe('Private key');
    expect(checkOpenVPNMaterial('key', CLIENT_KEY_PKCS1).summary).toBe(
      'RSA private key',
    );
    expect(checkOpenVPNMaterial('key', EC_KEY).summary).toBe('EC private key');
  });

  it('refuses a key behind a passphrase and the wrong kind of block', () => {
    expect(checkOpenVPNMaterial('key', ENCRYPTED_KEY)).toMatchObject({
      valid: false,
      message: expect.stringContaining('passphrase'),
    });
    expect(checkOpenVPNMaterial('key', CA).valid).toBe(false);
    expect(checkOpenVPNMaterial('ca', CLIENT_KEY).valid).toBe(false);
    expect(checkOpenVPNMaterial('static', CA).valid).toBe(false);
  });

  it('checks a static key by its length', () => {
    expect(checkOpenVPNMaterial('static', STATIC_KEY)).toMatchObject({
      valid: true,
      summary: 'OpenVPN static key, 2048 bits',
    });
    const short = STATIC_KEY.split('\n')
      .filter((_line, index) => index !== 3)
      .join('\n');
    expect(checkOpenVPNMaterial('static', short).valid).toBe(false);
  });

  it('keeps a path on the router as it is and treats empty as unset', () => {
    expect(checkOpenVPNMaterial('ca', '/etc/openvpn/ca.crt')).toMatchObject({
      valid: true,
      summary: 'File on the router: /etc/openvpn/ca.crt',
    });
    expect(checkOpenVPNMaterial('key', '  ')).toMatchObject({
      valid: true,
      summary: '',
    });
  });
});
