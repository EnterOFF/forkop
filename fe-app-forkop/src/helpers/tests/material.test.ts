import { describe, expect, it } from 'vitest';

import { checkMaterial, splitCertificateAndKey } from '../material';
import { decodeBase64, isCertificate, pemBlocks } from '../pem';
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

const der = (pem: string) => decodeBase64(pemBlocks(pem)[0].body)!;

describe('certificate structure', () => {
  it('recognises an RSA certificate and a P-256 one as sing-box issues it', () => {
    expect(isCertificate(der(CA))).toBe(true);
    expect(isCertificate(der(SELF_SIGNED))).toBe(true);
  });

  it('refuses a key, a cut certificate and what is not base64', () => {
    expect(isCertificate(der(CLIENT_KEY))).toBe(false);
    expect(isCertificate(der(CA).slice(0, 200))).toBe(false);
    expect(isCertificate(new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x00]))).toBe(
      false,
    );
    expect(decodeBase64('not base64!')).toBe(null);
  });
});

describe('OpenVPN material', () => {
  it('takes certificates, a chain and every unencrypted key format the core reads', () => {
    expect(checkMaterial('certificate', CLIENT_CERT).valid).toBe(true);
    expect(checkMaterial('ca', `${CA}\n${CLIENT_CERT}`).valid).toBe(true);
    for (const key of [CLIENT_KEY, CLIENT_KEY_PKCS1, EC_KEY])
      expect(checkMaterial('key', key).valid).toBe(true);
  });

  it('refuses a key behind a passphrase and the wrong kind of block', () => {
    expect(checkMaterial('key', ENCRYPTED_KEY)).toEqual({
      valid: false,
      message: expect.stringContaining('passphrase'),
    });
    expect(checkMaterial('key', CA).valid).toBe(false);
    expect(checkMaterial('ca', CLIENT_KEY).valid).toBe(false);
    expect(checkMaterial('static', CA).valid).toBe(false);
    const damaged = CA.replace(/^(-----BEGIN CERTIFICATE-----\n)MII/, '$1MIJ');
    expect(checkMaterial('ca', damaged).message).toBe(
      'The certificate is damaged',
    );
  });

  it('checks a static key by its length', () => {
    expect(checkMaterial('static', STATIC_KEY).valid).toBe(true);
    const short = STATIC_KEY.split('\n')
      .filter((_line, index) => index !== 3)
      .join('\n');
    expect(checkMaterial('static', short).valid).toBe(false);
  });

  it('keeps a path on the router as it is and treats empty as unset', () => {
    expect(checkMaterial('ca', '/etc/openvpn/ca.crt').valid).toBe(true);
    expect(checkMaterial('key', '  ').valid).toBe(true);
  });
});

// openssl req -x509 -keyout x.pem -out x.pem, HAProxy and sing-box generate
// tls-keypair all put the key and the certificate into one file.
describe('a file with a certificate and its key', () => {
  it('splits into the certificates and the one key', () => {
    expect(
      splitCertificateAndKey(`${CLIENT_KEY}\n${CLIENT_CERT}\n${CA}`),
    ).toEqual({
      certificate: `${CLIENT_CERT}\n${CA}`,
      key: CLIENT_KEY,
    });
    expect(splitCertificateAndKey(`${CLIENT_CERT}\r\n${EC_KEY}`)).toEqual({
      certificate: CLIENT_CERT,
      key: EC_KEY,
    });
  });

  it('is no pair without both halves or with two keys', () => {
    expect(splitCertificateAndKey(CLIENT_CERT)).toBe(null);
    expect(splitCertificateAndKey(CLIENT_KEY)).toBe(null);
    expect(
      splitCertificateAndKey(`${CLIENT_CERT}\n${CLIENT_KEY}\n${EC_KEY}`),
    ).toBe(null);
  });
});
