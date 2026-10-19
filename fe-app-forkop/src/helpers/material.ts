// The certificates and keys an OpenVPN profile or a TLS server carries, checked
// the way the core reads them.

import { decodeBase64, isCertificate, pemBlocks } from './pem';
import type { PemBlock } from './pem';

// A passphrase key is a private key that may be encrypted, for a client that
// takes the passphrase with it.
export type MaterialKind =
  | 'ca'
  | 'certificate'
  | 'key'
  | 'passphrase-key'
  | 'static'
  | 'crypt-v2';

export interface MaterialCheck {
  valid: boolean;
  message: string;
}

const PRIVATE_KEY_LABELS = ['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY'];

const VALID = { valid: true, message: '' };

// A path the core opens on the router, as a migrated configuration may hold.
export function isRouterPath(value: string) {
  return /^\/[^\n]*$/.test(value.trim());
}

// The certificates and the private key of a text that holds both, each as PEM
// text of its own, or null when it holds only one of the two or several keys.
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

function invalid(message: string): MaterialCheck {
  return { valid: false, message };
}

function certificatesCheck(text: string) {
  const blocks = pemBlocks(text).filter(
    (block) => block.label === 'CERTIFICATE',
  );
  if (!blocks.length) {
    return invalid(_('Paste a PEM certificate or load it from a file'));
  }
  return blocks.every((block) => {
    const der = decodeBase64(block.body);
    return der && isCertificate(der);
  })
    ? VALID
    : invalid(_('The certificate is damaged'));
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
    return invalid(
      _(
        'The key is protected by a passphrase. Remove it first: openssl pkey -in key.pem -out key-plain.pem',
      ),
    );
  }
  const labels = passphrase
    ? [...PRIVATE_KEY_LABELS, 'ENCRYPTED PRIVATE KEY']
    : PRIVATE_KEY_LABELS;
  const keys = blocks.filter((block) => labels.includes(block.label));
  return keys.length === 1 && decodeBase64(keys[0].body)
    ? VALID
    : invalid(_('Paste a PEM private key or load it from a file'));
}

function staticKeyCheck(text: string) {
  const block = pemBlocks(text).find(
    (item) => item.label === 'OpenVPN Static key V1',
  );
  return block && /^[0-9a-fA-F]{512}$/.test(block.body)
    ? VALID
    : invalid(_('Paste an OpenVPN static key or load it from a file'));
}

function cryptV2Check(text: string) {
  const block = pemBlocks(text).find(
    (item) => item.label === 'OpenVPN tls-crypt-v2 client key',
  );
  return block && decodeBase64(block.body)
    ? VALID
    : invalid(
        _('Paste an OpenVPN tls-crypt-v2 client key or load it from a file'),
      );
}

export function checkMaterial(
  kind: MaterialKind,
  value: unknown,
): MaterialCheck {
  const text = `${value ?? ''}`.trim();
  if (!text || isRouterPath(text)) return VALID;
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
