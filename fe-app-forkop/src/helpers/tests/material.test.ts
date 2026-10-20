import { describe, expect, it } from 'vitest';

import { checkMaterial, splitCertificateAndKey } from '../material';
import {
  certificateCanSignItself,
  certificateDnsName,
  decodeBase64,
  isCertificate,
  pemBlocks,
} from '../pem';
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

// sing-box generate tls-keypair www.microsoft.com, a CA that can sign itself.
const SINGBOX_CA = `-----BEGIN CERTIFICATE-----
MIIBrjCCAVSgAwIBAgIRAPFYVPXI/4J4zHZNBicm49cwCgYIKoZIzj0EAwIwHDEa
MBgGA1UEAxMRd3d3Lm1pY3Jvc29mdC5jb20wIBcNMjYxMDIwMTQwMzExWhgPMjEy
NjEwMjAxNTAzMTFaMBwxGjAYBgNVBAMTEXd3dy5taWNyb3NvZnQuY29tMFkwEwYH
KoZIzj0CAQYIKoZIzj0DAQcDQgAEfUZ7u/Cjnul4v6s2Mem3g6Nwcu3oMTG1kW3j
yp28i4tFWVMwjXRblgt3lF7SDRk7p1V3t79cILN0MWIYN6lN56N1MHMwDgYDVR0P
AQH/BAQDAgKkMBMGA1UdJQQMMAoGCCsGAQUFBwMBMA8GA1UdEwEB/wQFMAMBAf8w
HQYDVR0OBBYEFLZCprHwnTyD6ZuLm9AbCiHxyGLFMBwGA1UdEQQVMBOCEXd3dy5t
aWNyb3NvZnQuY29tMAoGCCqGSM49BAMCA0gAMEUCIQDrjS60YrRU73phELU6CjeZ
sFUswinmQDfr8iZ4ALzRdQIgbWUFuAb4Ntcc3lywizC1aihvSr23K1P+zZfDr+5X
Tig=
-----END CERTIFICATE-----`;

// The same from an older core, whose key usage leaves out certificate signing.
const SINGBOX_OLD = `-----BEGIN CERTIFICATE-----
MIIBjDCCATKgAwIBAgIRAPtfBc7b+Py6VRrdLgDKkb8wCgYIKoZIzj0EAwIwHDEa
MBgGA1UEAxMRd3d3Lm1pY3Jvc29mdC5jb20wIBcNMjYxMDIwMTMxNzI4WhgPMjEy
NjEwMjAxNDE3MjhaMBwxGjAYBgNVBAMTEXd3dy5taWNyb3NvZnQuY29tMFkwEwYH
KoZIzj0CAQYIKoZIzj0DAQcDQgAE8mU5gEAC48K+Xfrog6fl6hABO6mGkzkw8Quq
LPxiRLNUoKgcuZJsWM2c3HiRPY+tALbu2PgP1fMOGkx/Lv3DUKNTMFEwDgYDVR0P
AQH/BAQDAgWgMBMGA1UdJQQMMAoGCCsGAQUFBwMBMAwGA1UdEwEB/wQCMAAwHAYD
VR0RBBUwE4IRd3d3Lm1pY3Jvc29mdC5jb20wCgYIKoZIzj0EAwIDSAAwRQIhAP2U
07jWHMqU40FabCCL4nORIf9B3mkpPOScpIFRJYAzAiA7gouHWoPgseQ0yVfE8byo
Tt5/vcIaqAWOi+tOwhK+rg==
-----END CERTIFICATE-----`;

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

  it('reads the DNS name sing-box issues a certificate for, past a critical extension', () => {
    expect(certificateDnsName(der(SINGBOX_CA))).toBe('www.microsoft.com');
    expect(certificateDnsName(der(SINGBOX_OLD))).toBe('www.microsoft.com');
    expect(certificateDnsName(der(CA).slice(0, 200))).toBe('');
  });

  it('tells a certificate that can be its own issuer from one whose key usage forbids it', () => {
    expect(certificateCanSignItself(der(SINGBOX_CA))).toBe(true);
    expect(certificateCanSignItself(der(SINGBOX_OLD))).toBe(false);
  });
});

describe('OpenVPN material', () => {
  it('takes certificates, a chain and every unencrypted key format the core reads', () => {
    expect(checkMaterial('certificate', CLIENT_CERT)).toBe(true);
    expect(checkMaterial('ca', `${CA}\n${CLIENT_CERT}`)).toBe(true);
    for (const key of [CLIENT_KEY, CLIENT_KEY_PKCS1, EC_KEY])
      expect(checkMaterial('key', key)).toBe(true);
  });

  it('refuses a key behind a passphrase and the wrong kind of block', () => {
    expect(checkMaterial('key', ENCRYPTED_KEY)).toMatch(/passphrase/);
    expect(checkMaterial('key', CA)).not.toBe(true);
    expect(checkMaterial('ca', CLIENT_KEY)).not.toBe(true);
    expect(checkMaterial('static', CA)).not.toBe(true);
    const damaged = CA.replace(/^(-----BEGIN CERTIFICATE-----\n)MII/, '$1MIJ');
    expect(checkMaterial('ca', damaged)).toBe('Invalid PEM certificate');
  });

  it('checks a static key by its length', () => {
    expect(checkMaterial('static', STATIC_KEY)).toBe(true);
    const short = STATIC_KEY.split('\n')
      .filter((_line, index) => index !== 3)
      .join('\n');
    expect(checkMaterial('static', short)).not.toBe(true);
  });

  it('keeps a path on the router as it is and treats empty as unset', () => {
    expect(checkMaterial('ca', '/etc/openvpn/ca.crt')).toBe(true);
    expect(checkMaterial('key', '  ')).toBe(true);
  });
});

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
