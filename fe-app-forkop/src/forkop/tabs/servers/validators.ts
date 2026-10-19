// Every check follows what sing-box itself accepts, so a form that validates
// produces a configuration the service can start with. A field is required here
// only when the core has no default for it.

import { isRouterPath } from '../../../helpers/material';
import { decodeBase64 } from '../../../helpers/pem';
import { validateCoreFeature } from '../../services/coreFeatures.service';
import { message } from '../../../validators/messages';
import { wholeNumberField } from '../../../validators/fields';
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
} from './hosts';
import { occupiedPorts } from './network';
import {
  defaultSecurity,
  getProtocol,
  getShadowsocksMethod,
  listenTransports,
  securitiesFor,
  securityCoreFeature,
  shadowsocksKeyBytes,
  transportOption,
} from './protocols';

export function validateRequired(_sectionId: string, value: string) {
  return isEmptyValue(value) ? message.required() : true;
}

export function validateRequiredText(_sectionId: string, value: string) {
  if (isEmptyValue(value)) {
    return message.required();
  }

  return hasControlCharacters(`${value}`)
    ? message.noControlCharacters()
    : true;
}

function validatePort(_sectionId: string | null, value: string) {
  const port = parseInt(value, 10);
  if (isEmptyValue(value)) {
    return message.required();
  }
  return /^[0-9]+$/.test(`${value}`) && port >= 1 && port <= 65535
    ? true
    : message.invalidPort();
}

export function validateUuid(_sectionId: string, value: string) {
  return /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(
    `${value || ''}`,
  )
    ? true
    : message.invalidUuid();
}

export function validateHost(_sectionId: string, value: string) {
  if (isEmptyValue(value)) {
    return message.required();
  }
  return isHost(value) ? true : message.invalidHost();
}

export function validateOptionalHost(_sectionId: string, value: string) {
  return isEmptyValue(value) || isHost(value) ? true : message.invalidHost();
}

// The address is stored as it is typed and the core reads it as a bare IP, so
// the brackets a URL puts around IPv6 are not taken off here.
export function validateListenAddress(_sectionId: string, value: string) {
  const address = `${value || ''}`.trim();
  if (!address) {
    return message.required();
  }
  return !/[[\]]/.test(address) &&
    (address === '0.0.0.0' ||
      address === '::' ||
      isIpv4(address) ||
      isIpv6(address))
    ? true
    : message.invalidIp();
}

// A key read from the file the certificate is read from is refused by the core.
export function validateKeyFile(sectionId: string, value: string) {
  const key = `${value || ''}`.trim();
  return isRouterPath(key) &&
    key === liveOption(sectionId, 'tls_certificate').trim()
    ? _('Same file as the certificate')
    : true;
}

function validateHttpUrl(_sectionId: string | null, value: string) {
  try {
    const url = new URL(`${value || ''}`);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      isHost(url.hostname)
      ? true
      : message.invalidUrl();
  } catch (_error) {
    return message.invalidUrl();
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
    return target.length > 'file://'.length ? true : _('Format: file:///www');
  }

  return validateHttpUrl(null, target) === true
    ? true
    : _('Only https://, http:// or file://');
}

// The inbound goes to sing-box as pasted, and sing-box judges what it holds.
// Forkop names it after the server, so singbox/servers.uc overwrites whatever
// tag the pasted object carries.
export function validateInboundJson(_sectionId: string, value: string) {
  if (isEmptyValue(value)) {
    return message.required();
  }

  let parsed;
  try {
    parsed = JSON.parse(`${value}`);
  } catch (_error) {
    return message.invalidJson();
  }

  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? true
    : message.invalidJson();
}

export const validateOptionalPositiveInteger = wholeNumberField(1);

export function validateTransportPath(_sectionId: string, value: string) {
  return isEmptyValue(value) || `${value}`.startsWith('/')
    ? true
    : _('Path must start with /');
}

export function validateGrpcServiceName(_sectionId: string, value: string) {
  return isEmptyValue(value) || /^[A-Za-z0-9_.-]+$/.test(`${value}`)
    ? true
    : message.nameCharacters();
}

export function validateOptionalCidrOrIp(_sectionId: string, value: string) {
  if (isEmptyValue(value)) {
    return true;
  }

  return valueList(value).some((item) => !isValidCidr(normalizeCidrOrIp(item)))
    ? message.invalidIpOrSubnet()
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
  return /^(?:[0-9a-fA-F]{2})+$/.test(id) && id.length <= 16
    ? true
    : _('An even number of hex digits, up to 16');
}

export function validateRealityKey(_sectionId: string, value: string) {
  if (isEmptyValue(value)) {
    return message.required();
  }

  return /^[A-Za-z0-9_-]{43}$/.test(`${value}`.trim())
    ? true
    : message.invalidKey();
}

export function validateSecurity(sectionId: string, value: string) {
  const protocol = getProtocol(sectionId);
  const selected = value || defaultSecurity(protocol);

  if (!securitiesFor(protocol).includes(selected)) {
    return _('Not supported by this protocol');
  }
  return validateCoreFeature(securityCoreFeature(selected));
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

  // Padded standard base64, the way the core decodes it: atob would also take
  // a key without its padding, which the core refuses.
  const decoded = decodeBase64(`${value}`.trim());
  return decoded != null && decoded.length === keyBytes
    ? true
    : _('Needs a base64 key of %d bytes').format(keyBytes);
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
  return owner ? _('Port taken by %s').format(owner) : true;
}
