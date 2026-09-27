// Every check follows what sing-box itself accepts, so a form that validates
// produces a configuration the service can start with. A field is required here
// only when the core has no default for it.

import { validatePath } from '../../../validators/validatePath';
import { JSON_INBOUND_TYPES } from './constants';
import { normalizeMtprotoBaseSecret } from './credentials';
import {
  hasControlCharacters,
  isEmptyValue,
  liveOption,
  valueList,
} from './formValues';
import {
  isHost,
  isIpv4,
  isIpv6,
  isValidCidr,
  normalizeCidrOrIp,
  normalizeHost,
} from './hosts';
import { occupiedPorts } from './network';
import {
  defaultSecurity,
  getProtocol,
  getShadowsocksMethod,
  listenTransports,
  securitiesFor,
  shadowsocksKeyBytes,
  transportOption,
} from './protocols';

export function validateRequired(_sectionId: string, value: string) {
  return isEmptyValue(value) ? _('This field is required') : true;
}

export function validateRequiredText(_sectionId: string, value: string) {
  if (isEmptyValue(value)) {
    return _('This field is required');
  }

  return hasControlCharacters(`${value}`)
    ? _('Value must not contain control characters')
    : true;
}

function validatePort(_sectionId: string | null, value: string) {
  const port = parseInt(value, 10);
  return /^[0-9]+$/.test(`${value}`) && port >= 1 && port <= 65535
    ? true
    : _('Port must be between 1 and 65535');
}

export function validateUuid(_sectionId: string, value: string) {
  return /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(
    `${value || ''}`,
  )
    ? true
    : _('Use a valid UUID');
}

export function validateHost(_sectionId: string, value: string) {
  return isHost(value) ? true : _('Use a domain name or IP address');
}

export function validateOptionalHost(_sectionId: string, value: string) {
  return isEmptyValue(value) || isHost(value)
    ? true
    : _('Use a domain name or IP address');
}

export function validateListenAddress(_sectionId: string, value: string) {
  const address = normalizeHost(value);
  return address === '0.0.0.0' ||
    address === '::' ||
    isIpv4(address) ||
    isIpv6(address)
    ? true
    : _('Use an IP address, 0.0.0.0 for all IPv4, or :: for all addresses');
}

export function validateFilePath(_sectionId: string, value: string) {
  const path = `${value || ''}`;

  if (isEmptyValue(path)) {
    return _('This field is required');
  }

  const validation = validatePath(path);
  return validation.valid && path !== '/' && !path.endsWith('/')
    ? true
    : _('Specify a file path');
}

// Both halves are required, and they cannot be the same file.
function validateTlsPathPair(
  sectionId: string,
  value: string,
  otherName: string,
) {
  const required = validateRequiredText(sectionId, value);
  if (required !== true) {
    return required;
  }

  const result = validateFilePath(sectionId, value);
  if (result !== true) {
    return result;
  }

  return `${value}` === liveOption(sectionId, otherName)
    ? _('The certificate and the key must be different files')
    : true;
}

export function validateTlsCertificatePath(sectionId: string, value: string) {
  return validateTlsPathPair(sectionId, value, 'tls_key_path');
}

export function validateTlsKeyPath(sectionId: string, value: string) {
  return validateTlsPathPair(sectionId, value, 'tls_certificate_path');
}

function validateHttpUrl(_sectionId: string | null, value: string) {
  try {
    const url = new URL(`${value || ''}`);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      isHost(url.hostname)
      ? true
      : _('Use an HTTP or HTTPS URL');
  } catch (_error) {
    return _('Use an HTTP or HTTPS URL');
  }
}

// Hysteria2 accepts a masquerade target as a URL: https:// reverse proxies a real
// site, file:// serves a directory.
export function validateOptionalMasquerade(_sectionId: string, value: string) {
  if (isEmptyValue(value)) {
    return true;
  }

  const target = `${value}`.trim();
  if (target.startsWith('file://')) {
    return target.length > 'file://'.length
      ? true
      : _('Specify a directory after file://');
  }

  return validateHttpUrl(null, target) === true
    ? true
    : _('Use an https:// URL to proxy a site or file:// to serve a directory');
}

// Forkop names the inbound after the server, so singbox/servers.uc overwrites
// whatever tag the pasted object carries. Pasting a whole inbound from somewhere
// else is the point of this field, and a tag is part of what gets pasted.
export function validateInboundJson(_sectionId: string, value: string) {
  if (isEmptyValue(value)) {
    return _('This field is required');
  }

  let parsed;
  try {
    parsed = JSON.parse(`${value}`);
  } catch (_error) {
    return _('Invalid JSON format');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    typeof parsed.type !== 'string' ||
    !parsed.type
  ) {
    return _('The object must have a type field');
  }

  const type = parsed.type.trim();
  if (parsed.type !== type || !JSON_INBOUND_TYPES.has(type)) {
    return _('sing-box has no inbound of type %s').format(type);
  }

  if (parsed.listen_port != null) {
    const port = validatePort(null, `${parsed.listen_port}`);
    if (port !== true) {
      return port;
    }
  }

  return true;
}

export function validateOptionalPositiveInteger(
  _sectionId: string,
  value: string,
) {
  return isEmptyValue(value) || /^[1-9][0-9]*$/.test(`${value}`)
    ? true
    : _('Use a positive integer');
}

export function validateTransportPath(_sectionId: string, value: string) {
  return isEmptyValue(value) || `${value}`.startsWith('/')
    ? true
    : _('The path must start with /');
}

export function validateOptionalHostList(_sectionId: string, value: string) {
  return valueList(value).some((item) => !isHost(item))
    ? _('Use a domain name or IP address')
    : true;
}

export function validateGrpcServiceName(_sectionId: string, value: string) {
  return isEmptyValue(value) || /^[A-Za-z0-9_.-]+$/.test(`${value}`)
    ? true
    : _('Use letters, digits, dots, underscores, or hyphens');
}

export function validateOptionalCidrOrIp(_sectionId: string, value: string) {
  if (isEmptyValue(value)) {
    return true;
  }

  return valueList(value).some((item) => !isValidCidr(normalizeCidrOrIp(item)))
    ? _('Use a subnet like 192.168.1.0/24 or an address like 192.168.1.10')
    : true;
}

// sing-box decodes every short ID as hex bytes, so an odd digit count is refused at
// start-up and eight bytes is the hard limit. The form rejects exactly the same
// values instead of letting the service die on apply.
// One value. sing-box takes a list so a batch of clients can be revoked on its own,
// but a share link carries exactly one, so a second value could not reach any client
// through anything Forkop hands out. The core still gets a list of one.
export function validateShortId(sectionId: string, value: string) {
  const required = validateRequiredText(sectionId, value);
  if (required !== true) {
    return required;
  }

  const id = `${value}`.trim();
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(id)) {
    return _('Use an even number of hex digits, for example 0a1b2c3d');
  }

  return id.length > 16 ? _('A short ID holds at most 16 hex digits') : true;
}

export function validateRealityKey(_sectionId: string, value: string) {
  if (isEmptyValue(value)) {
    return _('Generate a key pair with the button next to the field');
  }

  return /^[A-Za-z0-9_-]{43}$/.test(`${value}`.trim())
    ? true
    : _('A Reality key is 43 base64url characters');
}

export function validateMtprotoSecret(_sectionId: string, value: string) {
  const secret = normalizeMtprotoBaseSecret(value);

  if (!secret) {
    return _('Use 32 hex characters');
  }

  return secret === '00000000000000000000000000000000'
    ? _('Use a non-zero secret')
    : true;
}

export function validateSecurity(sectionId: string, value: string) {
  const protocol = getProtocol(sectionId);
  const selected = value || defaultSecurity(protocol);

  return securitiesFor(protocol).includes(selected)
    ? true
    : _('This protocol does not support the selected security mode');
}

export function validateShadowsocksPassword(sectionId: string, value: string) {
  const required = validateRequiredText(sectionId, value);
  if (required !== true) {
    return required;
  }

  const keyBytes = shadowsocksKeyBytes(getShadowsocksMethod(sectionId));
  if (keyBytes === 0) {
    return true;
  }

  let decoded = null;
  try {
    decoded = atob(`${value}`.trim());
  } catch (_error) {
    decoded = null;
  }

  return decoded != null && decoded.length === keyBytes
    ? true
    : _('This method needs a base64 key of %d bytes').format(keyBytes);
}

export function validateAuthorizedKeys(_sectionId: string, value: string) {
  return valueList(value).some(
    (item) =>
      !/^(ssh|ecdsa|sk-ssh|sk-ecdsa)[A-Za-z0-9@.-]*\s+[A-Za-z0-9+/=]+(\s.*)?$/.test(
        `${item}`.trim(),
      ),
  )
    ? _('Use an OpenSSH public key line')
    : true;
}

export function validateListenPort(sectionId: string, value: string) {
  const result = validatePort(sectionId, value);
  if (result !== true) {
    return result;
  }

  const protocol = getProtocol(sectionId);
  const network = transportOption(protocol);
  const owners = occupiedPorts(sectionId);
  const owner = listenTransports(
    protocol,
    network ? liveOption(sectionId, network) : '',
  )
    .map((transport) => owners.get(`${transport}/${Number(`${value}`.trim())}`))
    .find(Boolean);
  return owner ? _('Port %s is already used by %s').format(value, owner) : true;
}
