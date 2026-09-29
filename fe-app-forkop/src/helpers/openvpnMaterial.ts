// The certificates and keys an OpenVPN profile carries, checked the way the
// core reads them.

import { decodeBase64, isCertificate, pemBlocks } from './pem';

export type OpenVPNMaterialKind =
  | 'ca'
  | 'certificate'
  | 'key'
  | 'static'
  | 'crypt-v2';

export interface OpenVPNMaterialCheck {
  valid: boolean;
  message: string;
}

const PRIVATE_KEY_LABELS = ['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY'];

const VALID = { valid: true, message: '' };

// A path the core opens on the router, as a migrated configuration may hold.
export function isRouterPath(value: string) {
  return /^\/[^\n]*$/.test(value.trim());
}

function invalid(message: string): OpenVPNMaterialCheck {
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

function keyCheck(text: string) {
  const blocks = pemBlocks(text);
  if (
    blocks.some(
      (block) =>
        block.label === 'ENCRYPTED PRIVATE KEY' ||
        block.headers.some((header) => /ENCRYPTED/.test(header)),
    )
  ) {
    return invalid(
      _(
        'The key is protected by a passphrase. Remove it first: openssl pkey -in key.pem -out key-plain.pem',
      ),
    );
  }
  const keys = blocks.filter((block) =>
    PRIVATE_KEY_LABELS.includes(block.label),
  );
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

export function checkOpenVPNMaterial(
  kind: OpenVPNMaterialKind,
  value: unknown,
): OpenVPNMaterialCheck {
  const text = `${value ?? ''}`.trim();
  if (!text || isRouterPath(text)) return VALID;
  switch (kind) {
    case 'ca':
    case 'certificate':
      return certificatesCheck(text);
    case 'key':
      return keyCheck(text);
    case 'static':
      return staticKeyCheck(text);
    default:
      return cryptV2Check(text);
  }
}
