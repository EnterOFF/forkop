import { validateCoreFeature } from '../../../services/coreFeatures.service';
import { tunnelKindCoreFeature } from '../coreSupport';
import { validateWireGuardKey } from '../../../../helpers/parseWireGuardConfig';
import { validateSubnet } from '../../../../validators/validateSubnet';
import { validateTailscaleHostname } from '../../../../validators/validateTailscaleHostname';
import { validateUrl } from '../../../../validators/validateUrl';
import { isExistingChildItem } from '../../../cbi/childItems';
import { validateOpenVPNSettings } from './openvpn';
import { normalizeDynamicListItems } from '../../../cbi/listValues';
import { normalizeOptionValues } from '../../../cbi/listValues';
import {
  AMNEZIA_RANGE_FIELDS,
  ONE_SIDED_AMNEZIA_FIELDS,
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

export function validateAmneziaRange(value: unknown) {
  const normalized = `${value || ''}`.trim();
  if (!normalized) return true;
  const parts = normalized.split('-');
  if (parts.length > 2 || parts.some((part) => !/^\d+$/u.test(part))) {
    return _(
      'AmneziaWG ranges must be between 0 and 4294967295 with the start no greater than the end',
    );
  }
  const from = Number(parts[0]);
  const to = parts.length === 2 ? Number(parts[1]) : from;
  return Number.isSafeInteger(from) &&
    Number.isSafeInteger(to) &&
    from <= 0xffffffff &&
    to <= 0xffffffff &&
    from <= to
    ? true
    : _(
        'AmneziaWG ranges must be between 0 and 4294967295 with the start no greater than the end',
      );
}

export function amneziaFieldLabel(key: string) {
  switch (key) {
    case 'header_protection_key':
      return _('Header protection key');
    case 'content_padding_addition':
      return _('Additional packet padding');
    case 'rekey_after_time':
      return _('Rekey interval');
    case 'rekey_timeout':
      return _('Rekey timeout');
    case 'reject_after_time':
      return _('Data rejection timeout');
    case 'keepalive_timeout':
      return _('Keepalive timeout');
    case 'max_handshake_attempts':
      return _('Maximum handshake attempts');
    case 'random_trailers':
      return _('Random trailers');
    case 'disable_cookies':
      return _('Disable cookies');
    default:
      return key.toUpperCase();
  }
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
  if (
    `${settings.tunnel_type || ''}` === 'amneziawg' ||
    oneSidedAmneziaEnabled(`${settings.tunnel_type || ''}`, settings)
  ) {
    const rangeFields =
      kind === 'amneziawg'
        ? AMNEZIA_RANGE_FIELDS
        : AMNEZIA_RANGE_FIELDS.filter((key: string) =>
            ONE_SIDED_AMNEZIA_FIELDS.includes(key),
          );
    for (const key of rangeFields) {
      const rangeValidation = validateAmneziaRange(settings[`amnezia_${key}`]);
      if (rangeValidation !== true) {
        return rangeValidation;
      }
    }
    const headerProtectionKey =
      `${settings.amnezia_header_protection_key || ''}`.trim();
    if (
      kind === 'amneziawg' &&
      headerProtectionKey &&
      !validateWireGuardKey(headerProtectionKey)
    ) {
      return _('WireGuard keys must be standard base64-encoded 32-byte values');
    }
    if (
      kind === 'amneziawg' &&
      headerProtectionKey &&
      !/^A{43}=$/.test(headerProtectionKey) &&
      ['s1', 's2', 's3', 's4'].some(
        (key) => Number(settings[`amnezia_${key}`] || 0) < 12,
      )
    ) {
      return _(
        'Header protection requires S1, S2, S3 and S4 of at least 12 bytes',
      );
    }
  }
  if (endpoint.type === 'warp') {
    if (
      endpoint.port != null &&
      (!Number.isInteger(endpoint.port) ||
        endpoint.port < 1 ||
        endpoint.port > 65535)
    )
      return _('Enter a valid server port');
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
