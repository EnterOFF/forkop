// The certificates and keys an OpenVPN profile carries, checked the way the
// core reads them and summed up in a line a person can check them by.

import { certificateInfo, decodeBase64, pemBlocks } from './pem';

export type OpenVPNMaterialKind =
  | 'ca'
  | 'certificate'
  | 'key'
  | 'static'
  | 'crypt-v2';

export interface OpenVPNMaterialCheck {
  valid: boolean;
  message: string;
  summary: string;
  expired?: boolean;
}

const PRIVATE_KEY_LABELS: Record<string, string> = {
  'PRIVATE KEY': '',
  'RSA PRIVATE KEY': 'RSA',
  'EC PRIVATE KEY': 'EC',
};

// A path the core opens on the router, as a migrated configuration may hold.
export function isRouterPath(value: string) {
  return /^\/[^\n]*$/.test(value.trim());
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function invalid(message: string): OpenVPNMaterialCheck {
  return { valid: false, message, summary: '' };
}

function certificatesCheck(text: string, kind: OpenVPNMaterialKind) {
  const blocks = pemBlocks(text).filter(
    (block) => block.label === 'CERTIFICATE',
  );
  if (!blocks.length) {
    return invalid(_('Paste a PEM certificate or load it from a file'));
  }
  const infos = [];
  for (const block of blocks) {
    const der = decodeBase64(block.body);
    const info = der ? certificateInfo(der) : null;
    if (!info) return invalid(_('The certificate is damaged'));
    infos.push(info);
  }
  // A CA file may hold the whole chain; the certificate a client presents is
  // the first one of its file.
  const shown =
    kind === 'ca'
      ? infos.reduce((soonest, info) =>
          info.notAfter &&
          (!soonest.notAfter || info.notAfter < soonest.notAfter)
            ? info
            : soonest,
        )
      : infos[0];
  const name = shown.commonName || shown.subject || _('no name');
  const expired = !!shown.notAfter && shown.notAfter.getTime() < Date.now();
  const validity = shown.notAfter
    ? (expired ? _('expired on %s') : _('valid until %s')).format(
        isoDate(shown.notAfter),
      )
    : '';
  const count =
    infos.length > 1 ? _('%d certificates').format(infos.length) : '';
  return {
    valid: true,
    message: '',
    summary: [count, name, validity].filter(Boolean).join(' · '),
    expired,
  };
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
  const keys = blocks.filter((block) => block.label in PRIVATE_KEY_LABELS);
  if (keys.length !== 1 || !decodeBase64(keys[0].body)) {
    return invalid(_('Paste a PEM private key or load it from a file'));
  }
  const type = PRIVATE_KEY_LABELS[keys[0].label];
  return {
    valid: true,
    message: '',
    summary: type ? _('%s private key').format(type) : _('Private key'),
  };
}

function staticKeyCheck(text: string) {
  const block = pemBlocks(text).find(
    (item) => item.label === 'OpenVPN Static key V1',
  );
  if (!block || !/^[0-9a-fA-F]{512}$/.test(block.body)) {
    return invalid(_('Paste an OpenVPN static key or load it from a file'));
  }
  return {
    valid: true,
    message: '',
    summary: _('OpenVPN static key, 2048 bits'),
  };
}

function cryptV2Check(text: string) {
  const block = pemBlocks(text).find(
    (item) => item.label === 'OpenVPN tls-crypt-v2 client key',
  );
  if (!block || !decodeBase64(block.body)) {
    return invalid(
      _('Paste an OpenVPN tls-crypt-v2 client key or load it from a file'),
    );
  }
  return { valid: true, message: '', summary: _('tls-crypt-v2 client key') };
}

export function checkOpenVPNMaterial(
  kind: OpenVPNMaterialKind,
  value: unknown,
): OpenVPNMaterialCheck {
  const text = `${value ?? ''}`.trim();
  if (!text) return { valid: true, message: '', summary: '' };
  if (isRouterPath(text)) {
    return {
      valid: true,
      message: '',
      summary: _('File on the router: %s').format(text),
    };
  }
  switch (kind) {
    case 'ca':
    case 'certificate':
      return certificatesCheck(text, kind);
    case 'key':
      return keyCheck(text);
    case 'static':
      return staticKeyCheck(text);
    default:
      return cryptV2Check(text);
  }
}
