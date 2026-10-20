// Checked the way the core reads them.

import { decodeBase64, isCertificate, pemBlocks } from './pem';
import type { PemBlock } from './pem';
import type { Check } from '../validators/types';

// A passphrase key is a private key that may be encrypted, for a client that
// takes the passphrase with it.
export type MaterialKind =
  | 'ca'
  | 'certificate'
  | 'key'
  | 'passphrase-key'
  | 'static'
  | 'crypt-v2';

const PRIVATE_KEY_LABELS = ['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY'];

// A path the core opens on the router, as a migrated configuration may hold.
export function isRouterPath(value: string) {
  return /^\/[^\n]*$/.test(value.trim());
}

// null when the text holds only one of the two, or several keys.
export function splitCertificateAndKey(text: string) {
  const blocks = Array.from(
    `${text || ''}`.matchAll(
      /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g,
    ),
  );
  const certificates = blocks
    .filter((block) => block[1] === 'CERTIFICATE')
    .map((block) => block[0].replace(/\r/g, ''));
  const keys = blocks
    .filter((block) =>
      [...PRIVATE_KEY_LABELS, 'ENCRYPTED PRIVATE KEY'].includes(block[1]),
    )
    .map((block) => block[0].replace(/\r/g, ''));
  return certificates.length && keys.length === 1
    ? { certificate: certificates.join('\n'), key: keys[0] }
    : null;
}

function certificatesCheck(text: string) {
  const blocks = pemBlocks(text).filter(
    (block) => block.label === 'CERTIFICATE',
  );
  return blocks.length &&
    blocks.every((block) => {
      const der = decodeBase64(block.body);
      return der && isCertificate(der);
    })
    ? true
    : _('Invalid PEM certificate');
}

function isEncrypted(block: PemBlock) {
  return (
    block.label === 'ENCRYPTED PRIVATE KEY' ||
    block.headers.some((header) => /ENCRYPTED/.test(header))
  );
}

export function isEncryptedKey(value: unknown) {
  return pemBlocks(`${value ?? ''}`).some(isEncrypted);
}

function keyCheck(text: string, passphrase: boolean) {
  const blocks = pemBlocks(text);
  if (!passphrase && blocks.some(isEncrypted)) {
    return _(
      'Remove the key passphrase: openssl pkey -in key.pem -out plain.pem',
    );
  }
  const labels = passphrase
    ? [...PRIVATE_KEY_LABELS, 'ENCRYPTED PRIVATE KEY']
    : PRIVATE_KEY_LABELS;
  const keys = blocks.filter((block) => labels.includes(block.label));
  return keys.length === 1 && decodeBase64(keys[0].body)
    ? true
    : _('Invalid PEM private key');
}

function staticKeyCheck(text: string) {
  const block = pemBlocks(text).find(
    (item) => item.label === 'OpenVPN Static key V1',
  );
  return block && /^[0-9a-fA-F]{512}$/.test(block.body)
    ? true
    : _('Invalid OpenVPN static key');
}

function cryptV2Check(text: string) {
  const block = pemBlocks(text).find(
    (item) => item.label === 'OpenVPN tls-crypt-v2 client key',
  );
  return block && decodeBase64(block.body)
    ? true
    : _('Invalid tls-crypt-v2 key');
}

export function checkMaterial(kind: MaterialKind, value: unknown): Check {
  const text = `${value ?? ''}`.trim();
  if (!text || isRouterPath(text)) return true;
  switch (kind) {
    case 'ca':
    case 'certificate':
      return certificatesCheck(text);
    case 'key':
    case 'passphrase-key':
      return keyCheck(text, kind === 'passphrase-key');
    case 'static':
      return staticKeyCheck(text);
    default:
      return cryptV2Check(text);
  }
}
