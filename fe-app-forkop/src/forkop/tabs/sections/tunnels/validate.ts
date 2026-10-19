import { validateCoreFeature } from '../../../services/coreFeatures.service';
import { tunnelKindCoreFeature } from '../coreSupport';
import { validateSubnet } from '../../../../validators/validateSubnet';
import { isIPv4, isIPv6 } from '../../../../validators/validateIp';
import { validateTailscaleHostname } from '../../../../validators/validateTailscaleHostname';
import { validateUrl } from '../../../../validators/validateUrl';
import { isExistingChildItem } from '../../../cbi/childItems';
import { validateOpenVPNSettings } from './openvpn';
import { validateOpenConnectSettings } from './openconnect';
import { normalizeDynamicListItems } from '../../../cbi/listValues';
import { normalizeOptionValues } from '../../../cbi/listValues';
import {
  AMNEZIA_KEYS,
  ONE_SIDED_AMNEZIA_KEYS,
  parseRange,
  parseUnsigned,
  validateAmneziaSet,
  validateAmneziaValue,
  validateWireGuardKey,
} from '../../../../helpers/wireguard';
import {
  WIREGUARD_PEER_FIELDS,
  oneSidedAmneziaEnabled,
  tunnelDisplayName,
  tunnelEndpointFromSettings,
  tunnelInitialSettings,
  tunnelPeerForValue,
} from './model';

function validateWireGuardPeer(peer: WireGuardPeerObject | null) {
  if (
    !peer ||
    typeof peer !== 'object' ||
    Array.isArray(peer) ||
    typeof peer.address !== 'string' ||
    !peer.address.trim() ||
    typeof peer.public_key !== 'string' ||
    !peer.public_key.trim() ||
    typeof peer.port !== 'number' ||
    !Number.isInteger(peer.port) ||
    peer.port < 1 ||
    peer.port > 65535
  ) {
    return _(
      'Every WireGuard peer needs string address/public key and a numeric port',
    );
  }

  if (!validateWireGuardKey(peer.public_key)) {
    return _('WireGuard keys must be standard base64-encoded 32-byte values');
  }

  if (
    Object.keys(peer).some((key: string) => !WIREGUARD_PEER_FIELDS.has(key))
  ) {
    return _('WireGuard peer contains unsupported fields');
  }

  if (
    peer.pre_shared_key != null &&
    (typeof peer.pre_shared_key !== 'string' || !peer.pre_shared_key.trim())
  ) {
    return _('WireGuard peer fields must use native sing-box JSON types');
  }

  if (
    typeof peer.pre_shared_key === 'string' &&
    peer.pre_shared_key.trim() &&
    !validateWireGuardKey(peer.pre_shared_key)
  ) {
    return _('WireGuard keys must be standard base64-encoded 32-byte values');
  }

  const allowedIps = Array.isArray(peer.allowed_ips)
    ? peer.allowed_ips
    : peer.allowed_ips != null
      ? [peer.allowed_ips]
      : [];
  if (allowedIps.length === 0) {
    return _('Every WireGuard peer needs at least one AllowedIPs subnet');
  }
  if (
    allowedIps.some(
      (allowedIp: string) => validateWireGuardPrefix(allowedIp) !== true,
    )
  ) {
    return _('WireGuard peer allowed_ips must contain valid CIDR subnets');
  }

  if (
    peer.persistent_keepalive_interval != null &&
    (typeof peer.persistent_keepalive_interval === 'string'
      ? validateAmneziaRange(peer.persistent_keepalive_interval) !== true
      : typeof peer.persistent_keepalive_interval !== 'number' ||
        !Number.isInteger(peer.persistent_keepalive_interval) ||
        peer.persistent_keepalive_interval < 0 ||
        peer.persistent_keepalive_interval > 0xffffffff)
  ) {
    return _('WireGuard peer fields must use native sing-box JSON types');
  }
  return true;
}

export function validateWireGuardPeerValue(
  value: unknown,
  tunnelId: string,
  option: CBIOption,
) {
  const peer = tunnelPeerForValue(tunnelId, value, option);
  return peer
    ? validateWireGuardPeer(peer)
    : _('Open peer settings and complete the configuration');
}

export function validateWireGuardPeers(
  values: unknown,
  tunnelId?: string,
  option?: CBIOption,
) {
  const peers = L.toArray(values).filter((value: unknown) =>
    `${value || ''}`.trim(),
  );
  if (peers.length === 0) {
    return _('Add at least one WireGuard peer');
  }
  for (const value of peers) {
    const validation = validateWireGuardPeerValue(
      value,
      `${tunnelId ?? ''}`,
      option!,
    );
    if (validation !== true) return validation;
  }
  return true;
}

function validateWireGuardPrefix(value: unknown) {
  if (typeof value !== 'string') {
    return _('Use an IP address with a CIDR prefix');
  }
  const address = `${value || ''}`.trim();
  if (!address.includes('/')) {
    return _('Use an IP address with a CIDR prefix');
  }
  const validation = validateSubnet(address);
  return validation.valid ? true : validation.message;
}

export function validateWireGuardListInput(value: unknown) {
  if (Array.isArray(value)) {
    const values = normalizeOptionValues(value);
    return values.every((item) => validateWireGuardPrefix(item) === true)
      ? true
      : validateWireGuardPrefix(
          values.find((item) => validateWireGuardPrefix(item) !== true) || '',
        );
  }
  return `${value || ''}`.trim() ? validateWireGuardPrefix(value) : true;
}

// Empty, or a whole number from minimum to 65535, as LuCI's port and range
// datatypes on the dialog's fields take it.
function isOptionalUint16(value: unknown, minimum: number) {
  const text = `${value ?? ''}`.trim();
  const parsed = parseUnsigned(text, 65535);
  return !text || (parsed !== undefined && parsed >= minimum);
}

// What LuCI's host datatype takes besides an address.
function isHostname(value: string) {
  return (
    value.length <= 253 &&
    /^[A-Za-z0-9_]([A-Za-z0-9_-]*[A-Za-z0-9_])?(\.[A-Za-z0-9_]([A-Za-z0-9_-]*[A-Za-z0-9_])?)*$/u.test(
      value,
    )
  );
}

export function validateAmneziaRange(value: unknown) {
  const normalized = `${value || ''}`.trim();
  return !normalized || parseRange(normalized) !== undefined
    ? true
    : _(
        'AmneziaWG ranges must be between 0 and 4294967295 with the start no greater than the end',
      );
}

export function validateTunnelSettings(
  settings: ChildSettings,
  tunnelId?: string,
  peerOption?: CBIOption,
) {
  const kind = `${settings.tunnel_type || ''}`;
  const core = validateCoreFeature(tunnelKindCoreFeature(kind));
  if (core !== true) {
    return core;
  }
  const name = `${settings.name || ''}`.trim();
  if (kind !== 'json' && !name) {
    return _('Enter a tunnel name');
  }
  if (kind === 'openvpn-client') {
    return validateOpenVPNSettings(settings);
  }
  if (kind === 'openconnect') {
    return validateOpenConnectSettings(settings);
  }
  const endpoint = tunnelEndpointFromSettings(settings, tunnelId, peerOption);
  if (!endpoint) {
    return kind === 'json'
      ? _('Enter a valid JSON endpoint object')
      : _('Open peer settings and complete the configuration');
  }
  if (kind === 'json') {
    if (typeof endpoint.tag !== 'string' || !endpoint.tag.trim()) {
      return _('JSON endpoint must contain a non-empty tag');
    }
    return true;
  }
  if (endpoint.type === 'tailscale') {
    if (!endpoint.auth_key) return _('Enter a Tailscale auth key');
    if (!endpoint.hostname) return _('Enter a Tailscale hostname');
    const hostname = validateTailscaleHostname(endpoint.hostname);
    if (hostname !== true) return hostname;
    if (!validateUrl(endpoint.control_url || '').valid) {
      return _('Enter a valid Tailscale control URL');
    }
    if (
      `${settings.tailscale_detour_enabled || ''}` === '1' &&
      !endpoint.detour
    ) {
      return _('Select a section');
    }
    return true;
  }
  if (kind === 'amneziawg' || oneSidedAmneziaEnabled(kind, settings)) {
    const keys = kind === 'amneziawg' ? AMNEZIA_KEYS : ONE_SIDED_AMNEZIA_KEYS;
    const values: Record<string, unknown> = {};
    for (const key of keys) {
      const value = settings[`amnezia_${key}`];
      const validation = validateAmneziaValue(key, value);
      if (validation !== true) return validation;
      values[key] = value;
    }
    const combination = validateAmneziaSet(values);
    if (combination !== true) return combination;
  }
  if (endpoint.type === 'warp') {
    const address = `${settings.warp_address || ''}`.trim();
    if (address && !isIPv4(address) && !isIPv6(address) && !isHostname(address))
      return _('Enter a valid server address');
    if (!isOptionalUint16(settings.warp_port, 0))
      return _('Enter a valid server port');
    const keepalive = validateAmneziaRange(settings.warp_keepalive);
    if (keepalive !== true) return keepalive;
    const profileValues = [
      endpoint.profile?.id,
      endpoint.profile?.auth_token,
      endpoint.profile?.private_key,
    ].filter(Boolean);
    if (profileValues.length !== 3) {
      return _(
        'Register a Cloudflare WARP device and fill the profile fields.',
      );
    }
    return true;
  }
  if (!isOptionalUint16(settings.listen_port, 0)) {
    return _('Enter a valid listen port');
  }
  if (!isOptionalUint16(settings.mtu, 1)) {
    return _('Enter an MTU from 1 to 65535');
  }
  if (!endpoint.private_key || endpoint.address.length === 0) {
    return _('WireGuard address and private key are required');
  }
  if (!validateWireGuardKey(endpoint.private_key)) {
    return _('WireGuard keys must be standard base64-encoded 32-byte values');
  }
  for (const address of endpoint.address) {
    const addressValidation = validateWireGuardPrefix(address);
    if (addressValidation !== true) {
      return addressValidation;
    }
  }
  if (endpoint.peers.length === 0) {
    return _('Add at least one WireGuard peer');
  }
  const peersValidation = validateWireGuardPeers(
    settings.peer_ids,
    tunnelId,
    peerOption,
  );
  if (peersValidation !== true) {
    return peersValidation;
  }
  if (
    `${settings.tunnel_type || ''}` === 'amneziawg' &&
    Object.keys(endpoint.amnezia || {}).length === 0
  ) {
    return _('Enter at least one AmneziaWG parameter');
  }
  return true;
}

export function validateTunnelItemsBeforeSave(
  section_id: string,
  values: unknown,
) {
  for (const value of normalizeDynamicListItems(values)) {
    const tunnelId = `${value || ''}`.trim();
    if (!isExistingChildItem(section_id, tunnelId, 'tunnel')) {
      return _('Open tunnel settings and complete the configuration');
    }
    const validation = validateTunnelSettings(
      tunnelInitialSettings(tunnelId, section_id),
    );
    if (validation !== true) {
      return `${tunnelDisplayName(section_id, tunnelId) || _('Tunnel')}: ${validation}`;
    }
  }
  return true;
}
