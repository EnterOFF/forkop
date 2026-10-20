import {
  FORKOP_UCI_PACKAGE,
  TAILSCALE_CONTROL_URL,
} from '../../../../constants';
import {
  applyChildItemSettings,
  cleanupRemovedChildItems,
  isExistingChildItem,
  materializeChildItems,
  nextSectionId,
  removeChildItemsOf,
} from '../../../cbi/childItems';
import {
  childPendingSettingsStore,
  clearChildPendingSettings,
} from '../../../cbi/itemSettings';
import { normalizeOptionValues } from '../../../cbi/listValues';
import { setModalOptionValue } from '../../../cbi/modal';
import {
  outboundJsonDisplayTag,
  parseOutboundJsonObject,
} from '../outboundJson';
import { tailscaleDetourSectionValue, tailscaleDetourTag } from '../references';
import { openVPNEndpoint, openVPNInitialSettings } from './openvpn';
import { openConnectEndpoint, openConnectInitialSettings } from './openconnect';
import { tunnelKindCoreFeature } from '../coreSupport';
import {
  coreHas,
  missingCoreFeatureNote,
} from '../../../services/coreFeatures.service';
import { E } from '../../../../helpers/element';
import {
  AMNEZIA_KEYS,
  ONE_SIDED_AMNEZIA_KEYS,
  amneziaJsonValue,
  amneziaParameter,
  generateAmneziaParameters,
} from '../../../../helpers/wireguard';

// Every field a WireGuard peer has; an imported peer carrying anything else is refused.
export function defaultWireGuardPeerSettings() {
  return {
    address: '',
    port: '',
    public_key: '',
    pre_shared_key: '',
    allowed_ips: [] as string[],
    persistent_keepalive_interval: '',
  };
}

export function wireGuardPeerSettingsKeys() {
  return Object.keys(defaultWireGuardPeerSettings());
}

export const WIREGUARD_PEER_FIELDS = new Set(wireGuardPeerSettingsKeys());

function tunnelChild(sectionId: string, tunnelId: string) {
  return (uci.sections(FORKOP_UCI_PACKAGE, 'tunnel') || []).find(
    (item) =>
      item['.name'] === `${tunnelId || ''}` &&
      item.section === `${sectionId || ''}`,
  );
}

function tunnelPeerIds(tunnelId: string) {
  return (uci.sections(FORKOP_UCI_PACKAGE, 'tunnel_peer') || [])
    .filter((item) => item.tunnel === `${tunnelId || ''}`)
    .sort((left, right) => {
      const order = (item: UciSectionObject) =>
        Number.parseInt(`${item.order || '0'}`, 10) || 0;
      return (
        order(left) - order(right) ||
        `${left['.name'] || ''}`.localeCompare(`${right['.name'] || ''}`)
      );
    })
    .map((item) => item['.name'])
    .filter(Boolean);
}

function tunnelKindLabel(kind: string, endpointType: string) {
  if (kind === 'openvpn-client') return 'OpenVPN';
  if (kind === 'openconnect') return 'OpenConnect';
  return kind === 'amneziawg'
    ? 'AmneziaWG'
    : kind === 'warp'
      ? 'WARP'
      : kind === 'tailscale'
        ? 'Tailscale'
        : kind === 'json'
          ? endpointType || _('JSON endpoint')
          : 'WireGuard';
}

// A peer is addressed only through its tunnel, so removing the tunnel takes
// its peers with it.
export function removeTunnelPeers(tunnelId: string) {
  removeChildItemsOf(tunnelId, 'tunnel_peer', 'tunnel');
}

export function tunnelDisplayName(sectionId: string, tunnelId: string) {
  const child = tunnelChild(sectionId, tunnelId);
  const kind = `${child?.kind || 'wireguard'}`.toLowerCase();
  if (kind === 'json') {
    return outboundJsonDisplayTag(child?.endpoint_json || '');
  }
  return `${child?.name || ''}`.trim();
}

export function tunnelListItemLabel(sectionId: string, tunnelId: string) {
  const child = tunnelChild(sectionId, tunnelId);
  const kind = `${child?.kind || 'wireguard'}`.toLowerCase();
  let endpointType = '';
  if (kind === 'json') {
    endpointType = parseOutboundJsonObject(child?.endpoint_json)?.type || '';
  }
  const label =
    tunnelDisplayName(sectionId, tunnelId) ||
    tunnelKindLabel(kind, `${endpointType}`.toLowerCase());
  const feature = tunnelKindCoreFeature(kind);
  return E(
    'span',
    { class: 'fkp-dynlist-label' },
    feature && !coreHas(feature)
      ? `${label} (${missingCoreFeatureNote(feature)})`
      : label,
  );
}

// Tailscale reaches its coordination server through a section of its own choosing, and a JSON
// endpoint names its own detour.
export const CASCADE_TUNNEL_KINDS = [
  'wireguard',
  'amneziawg',
  'warp',
  'openvpn-client',
  'openconnect',
];

// The kinds whose server declares names of its own and a DNS that answers them.
export const SERVER_DNS_TUNNEL_KINDS = [
  'openconnect',
  'openvpn-client',
  'tailscale',
];

// The kinds stored as the native endpoint the dialog builds.
const NATIVE_ENDPOINT_KINDS = ['openvpn-client', 'openconnect'];

// What a tunnel's kind option names; anything else, and none, is WireGuard.
const STORED_KINDS = [
  'openvpn-client',
  'openconnect',
  'json',
  'warp',
  'amneziawg',
  'tailscale',
];

export function tunnelInitialSettings(
  value: unknown,
  sectionId: string,
): ChildSettings {
  const tunnel = (tunnelChild(sectionId, `${value || ''}`) ||
    {}) as UciSectionObject;
  const endpoint = (
    ['json', ...NATIVE_ENDPOINT_KINDS].includes(`${tunnel.kind || ''}`)
      ? parseOutboundJsonObject(tunnel.endpoint_json) || {}
      : {}
  ) as Record<string, unknown>;
  const kind = STORED_KINDS.includes(`${tunnel.kind || ''}`)
    ? `${tunnel.kind}`
    : 'wireguard';
  const amneziaEnabled =
    (kind === 'wireguard' || kind === 'warp') &&
    ONE_SIDED_AMNEZIA_KEYS.some((key: string) =>
      setsAmneziaParameter(key, tunnel[`amnezia_${key}`]),
    );
  const tailscaleDetour = `${tunnel.tailscale_detour_section || ''}`.trim();
  const settings: ChildSettings = {
    ...(kind === 'openvpn-client' ? openVPNInitialSettings(endpoint) : {}),
    ...(kind === 'openconnect' ? openConnectInitialSettings(endpoint) : {}),
    name: kind === 'json' ? `${endpoint.tag || ''}` : `${tunnel.name || ''}`,
    tunnel_type: kind,
    amnezia_enabled: amneziaEnabled ? '1' : '0',
    address: normalizeOptionValues(tunnel.address),
    private_key: `${tunnel.private_key || ''}`,
    listen_port: tunnel.listen_port ? `${tunnel.listen_port}` : '',
    mtu: tunnel.mtu ? `${tunnel.mtu}` : '',
    peer_ids: tunnelPeerIds(`${value || ''}`),
    warp_keepalive: tunnel.warp_keepalive ? `${tunnel.warp_keepalive}` : '',
    warp_address: `${tunnel.warp_address || ''}`,
    warp_port: `${tunnel.warp_port || ''}`,
    warp_profile_id: `${tunnel.warp_profile_id || ''}`,
    warp_auth_token: `${tunnel.warp_profile_auth_token || ''}`,
    warp_private_key: `${tunnel.warp_profile_private_key || ''}`,
    warp_license_key: `${tunnel.warp_profile_license_key || ''}`,
    tailscale_auth_key: `${tunnel.tailscale_auth_key || ''}`,
    tailscale_hostname: `${tunnel.tailscale_hostname || ''}`,
    tailscale_control_url: `${tunnel.tailscale_control_url || TAILSCALE_CONTROL_URL}`,
    tailscale_accept_routes: tunnel.tailscale_accept_routes === '0' ? '0' : '1',
    tailscale_exit_node: `${tunnel.tailscale_exit_node || ''}`,
    accept_server_dns: tunnel.accept_server_dns === '0' ? '0' : '1',
    tailscale_detour_enabled: tailscaleDetour ? '1' : '0',
    tailscale_detour_section: tailscaleDetourSectionValue(
      tailscaleDetour,
      sectionId,
    ),
    detour_section: `${tunnel.detour_section || ''}`,
    endpoint_json: kind === 'json' ? `${tunnel.endpoint_json || ''}` : '',
  };

  AMNEZIA_KEYS.forEach((key: string) => {
    settings[`amnezia_${key}`] =
      tunnel[`amnezia_${key}`] != null ? `${tunnel[`amnezia_${key}`]}` : '';
  });
  return settings;
}

function tunnelSettingsKeys() {
  return [
    'name',
    'kind',
    'address',
    'private_key',
    'listen_port',
    'mtu',
    'warp_keepalive',
    'warp_address',
    'warp_port',
    'warp_profile_id',
    'warp_profile_auth_token',
    'warp_profile_private_key',
    'warp_profile_license_key',
    'tailscale_auth_key',
    'tailscale_hostname',
    'tailscale_control_url',
    'tailscale_accept_routes',
    'tailscale_exit_node',
    'tailscale_detour_section',
    'accept_server_dns',
    'detour_section',
    'endpoint_json',
    ...AMNEZIA_KEYS.map((key: string) => `amnezia_${key}`),
  ];
}

// A switched-off flag is how the dialog holds a parameter it leaves out.
function setsAmneziaParameter(key: string, value: unknown) {
  const text = `${value ?? ''}`.trim();
  return amneziaParameter(key)?.kind === 'flag' ? text === '1' : text !== '';
}

// The endpoints taking the one-sided class gate it behind the obfuscation switch.
export function oneSidedAmneziaEnabled(kind: string, settings: ChildSettings) {
  return (
    (kind === 'wireguard' || kind === 'warp') &&
    `${settings.amnezia_enabled || ''}` === '1'
  );
}

// The stored value too: a field the switch hides has no widget yet, and formvalue answers null.
function dialogValue(map: CBIMap, option: CBIOption) {
  return `${
    option.formvalue('settings') ??
    map.data.get(map.config, 'settings', option.option) ??
    ''
  }`.trim();
}

// A tunnel that stops being AmneziaWG keeps obfuscating only when it has something to send.
export function hasOneSidedAmneziaValues(
  map: CBIMap,
  amneziaOptions: Record<string, CBIOption>,
) {
  return ONE_SIDED_AMNEZIA_KEYS.some(
    (key: string) =>
      !!amneziaOptions[key] &&
      setsAmneziaParameter(key, dialogValue(map, amneziaOptions[key])),
  );
}

// Draws a fresh set and replaces every parameter the tunnel sends.
export function fillGeneratedOneSidedAmnezia(
  map: CBIMap,
  amneziaOptions: Record<string, CBIOption>,
) {
  const generated = generateAmneziaParameters();
  ONE_SIDED_AMNEZIA_KEYS.forEach((key: string) => {
    if (amneziaOptions[key]) {
      setModalOptionValue(map, amneziaOptions[key], generated[key]);
    }
  });
}

export function tunnelStorageSettings(settings: ChildSettings) {
  const kind = `${settings.tunnel_type || 'wireguard'}`;
  const storedAmneziaFields =
    kind === 'amneziawg'
      ? AMNEZIA_KEYS
      : oneSidedAmneziaEnabled(kind, settings)
        ? ONE_SIDED_AMNEZIA_KEYS
        : [];
  const result: Record<string, unknown> = {
    kind,
    name: kind === 'json' ? '' : `${settings.name || ''}`.trim(),
    address: normalizeOptionValues(settings.address),
    private_key: `${settings.private_key || ''}`.trim(),
    listen_port: `${settings.listen_port || ''}`.trim(),
    mtu: `${settings.mtu || ''}`.trim(),
    warp_keepalive: `${settings.warp_keepalive || ''}`.trim(),
    warp_address: `${settings.warp_address || ''}`.trim(),
    warp_port: `${settings.warp_port || ''}`.trim(),
    warp_profile_id: `${settings.warp_profile_id || ''}`.trim(),
    warp_profile_auth_token: `${settings.warp_auth_token || ''}`.trim(),
    warp_profile_private_key: `${settings.warp_private_key || ''}`.trim(),
    warp_profile_license_key: `${settings.warp_license_key || ''}`.trim(),
    tailscale_auth_key: `${settings.tailscale_auth_key || ''}`.trim(),
    tailscale_hostname: `${settings.tailscale_hostname || ''}`.trim(),
    tailscale_control_url: `${settings.tailscale_control_url || ''}`.trim(),
    // These two have defaults, so they need the kind gate or a WireGuard tunnel stores options it
    // never showed.
    tailscale_accept_routes:
      kind === 'tailscale' ? `${settings.tailscale_accept_routes || '1'}` : '',
    accept_server_dns: SERVER_DNS_TUNNEL_KINDS.includes(kind)
      ? `${settings.accept_server_dns || '1'}`
      : '',
    tailscale_exit_node: `${settings.tailscale_exit_node || ''}`.trim(),
    tailscale_detour_section:
      `${settings.tailscale_detour_enabled || ''}` === '1'
        ? `${settings.tailscale_detour_section || ''}`.trim()
        : '',
    // The dialog drops the section with its switch, so a section still held means the switch is on.
    detour_section: CASCADE_TUNNEL_KINDS.includes(kind)
      ? `${settings.detour_section || ''}`.trim()
      : '',
    endpoint_json: NATIVE_ENDPOINT_KINDS.includes(kind)
      ? JSON.stringify(tunnelEndpointFromSettings(settings))
      : kind === 'json'
        ? `${settings.endpoint_json || ''}`.trim()
        : '',
  };

  AMNEZIA_KEYS.forEach((key: string) => {
    result[`amnezia_${key}`] = storedAmneziaFields.includes(key)
      ? `${settings[`amnezia_${key}`] || ''}`.trim()
      : '';
  });
  return result;
}

export function createTunnelItem(
  sectionId: string,
  tunnelId: string,
  settings: ChildSettings,
) {
  const itemId = isExistingChildItem(sectionId, tunnelId, 'tunnel', 'section')
    ? tunnelId
    : uci.add(FORKOP_UCI_PACKAGE, 'tunnel', tunnelId) || tunnelId;
  if (uci.get(FORKOP_UCI_PACKAGE, itemId, 'section') !== sectionId) {
    uci.set(FORKOP_UCI_PACKAGE, itemId, 'section', sectionId);
  }
  // The dialog owns every key, so unfilled ones are cleared; naming them all leaves unchanged values
  // alone, so a save that changed nothing writes nothing.
  const target: Record<string, unknown> = {};
  tunnelSettingsKeys().forEach((key: string) => {
    target[key] = Object.prototype.hasOwnProperty.call(settings, key)
      ? settings[key]
      : '';
  });
  applyChildItemSettings(itemId, target);
  return itemId;
}

export function materializeTunnelPeers(
  tunnelId: string,
  values: unknown,
  option: CBIOption,
) {
  const store = childPendingSettingsStore(option, tunnelId);
  const { itemIds } = materializeChildItems(
    tunnelId,
    {
      typeName: 'tunnel_peer',
      ownerOption: 'tunnel',
      createId: (value: unknown) => `${value || ''}`.trim(),
      stagedSettings: (value: unknown) => store[`${value || ''}`] || null,
    },
    values,
  );
  itemIds.forEach((itemId: string, index: number) => {
    uci.set(FORKOP_UCI_PACKAGE, itemId, 'order', `${index}`);
  });
  cleanupRemovedChildItems(tunnelId, 'tunnel_peer', itemIds, 'tunnel');
  clearChildPendingSettings(option, tunnelId);
  return itemIds;
}

function tunnelPeerFromChild(peerId: string) {
  const peer = (uci.sections(FORKOP_UCI_PACKAGE, 'tunnel_peer') || []).find(
    (item) => item['.name'] === `${peerId || ''}`,
  );
  if (!peer) {
    return null;
  }

  const result: Record<string, unknown> = {
    address: `${peer.address || ''}`.trim(),
    port: Number(peer.port),
    public_key: `${peer.public_key || ''}`.trim(),
    allowed_ips: normalizeOptionValues(peer.allowed_ips),
  };
  if (`${peer.pre_shared_key || ''}`.trim()) {
    result.pre_shared_key = `${peer.pre_shared_key}`.trim();
  }
  if (`${peer.persistent_keepalive_interval || ''}`.trim()) {
    const value = `${peer.persistent_keepalive_interval}`.trim();
    result.persistent_keepalive_interval = value.includes('-')
      ? value
      : Number(value);
  }
  return result;
}

export function tunnelPeerForValue(
  tunnelId: string,
  value: unknown,
  option: CBIOption,
) {
  const peerValue = `${value || ''}`;
  const saved = tunnelPeerFromChild(peerValue);
  if (saved) {
    return saved;
  }

  const staged = option?.pendingChildSettings?.[tunnelId]?.[peerValue];
  return staged ? wireGuardPeerFromSettings(staged) : null;
}

export function tunnelEndpointFromSettings(
  settings: ChildSettings,
  tunnelId?: string,
  peerOption?: CBIOption,
) {
  const kind = `${settings.tunnel_type || ''}`;
  if (kind === 'openvpn-client') return openVPNEndpoint(settings);
  if (kind === 'openconnect') return openConnectEndpoint(settings);
  if (kind === 'json') {
    return parseOutboundJsonObject(settings.endpoint_json);
  }
  if (kind === 'tailscale') {
    const endpoint: Record<string, unknown> = {
      type: 'tailscale',
      auth_key: `${settings.tailscale_auth_key || ''}`.trim(),
      hostname: `${settings.tailscale_hostname || ''}`.trim(),
      control_url:
        `${settings.tailscale_control_url || TAILSCALE_CONTROL_URL}`.trim(),
      accept_routes: `${settings.tailscale_accept_routes || ''}` === '1',
    };
    const exitNode = `${settings.tailscale_exit_node || ''}`.trim();
    if (exitNode) {
      endpoint.exit_node = exitNode;
      endpoint.exit_node_allow_lan_access = true;
    }
    if (`${settings.tailscale_detour_enabled || ''}` === '1') {
      const detour = tailscaleDetourTag(
        `${settings.tailscale_detour_section || ''}`,
      );
      if (detour) {
        endpoint.detour = detour;
      }
    }
    return endpoint;
  }
  if (kind === 'warp') {
    const endpoint: Record<string, unknown> = { type: 'warp' };
    if (`${settings.warp_address || ''}`.trim())
      endpoint.address = `${settings.warp_address}`.trim();
    if (`${settings.warp_port || ''}`.trim())
      endpoint.port = Number(settings.warp_port);
    if (`${settings.warp_keepalive || ''}`.trim()) {
      const value = `${settings.warp_keepalive}`.trim();
      endpoint.persistent_keepalive_interval = value.includes('-')
        ? value
        : Number(value);
    }
    const profile: Record<string, unknown> = {};
    if (`${settings.warp_profile_id || ''}`.trim()) {
      profile.id = `${settings.warp_profile_id}`.trim();
    }
    if (`${settings.warp_auth_token || ''}`.trim()) {
      profile.auth_token = `${settings.warp_auth_token}`.trim();
    }
    if (`${settings.warp_private_key || ''}`.trim()) {
      profile.private_key = `${settings.warp_private_key}`.trim();
    }
    if (`${settings.warp_license_key || ''}`.trim()) {
      profile.license_key = `${settings.warp_license_key}`.trim();
    }
    if (Object.keys(profile).length > 0) {
      endpoint.profile = profile;
    }
    if (oneSidedAmneziaEnabled(kind, settings)) {
      const amnezia = tunnelAmneziaSettings(settings, ONE_SIDED_AMNEZIA_KEYS);
      if (Object.keys(amnezia).length > 0) {
        endpoint.amnezia = amnezia;
      }
    }
    return endpoint;
  }

  const peers = L.toArray(settings.peer_ids)
    .map((value: unknown) =>
      tunnelPeerForValue(`${tunnelId ?? ''}`, value, peerOption!),
    )
    .filter(Boolean);
  if (peers.length !== L.toArray(settings.peer_ids).filter(Boolean).length)
    return null;

  const endpoint: Record<string, unknown> = {
    type: kind,
    address: normalizeOptionValues(settings.address),
    private_key: `${settings.private_key || ''}`.trim(),
    peers,
  };
  if (`${settings.listen_port || ''}`.trim()) {
    endpoint.listen_port = Number(settings.listen_port);
  }
  if (`${settings.mtu || ''}`.trim()) {
    endpoint.mtu = Number(settings.mtu);
  }

  if (kind === 'amneziawg') {
    endpoint.amnezia = tunnelAmneziaSettings(settings);
  } else if (oneSidedAmneziaEnabled(kind, settings)) {
    const amnezia = tunnelAmneziaSettings(settings, ONE_SIDED_AMNEZIA_KEYS);
    if (Object.keys(amnezia).length > 0) {
      endpoint.amnezia = amnezia;
    }
  }

  return endpoint;
}

function tunnelAmneziaSettings(settings: ChildSettings, fields = AMNEZIA_KEYS) {
  const amnezia: Record<string, unknown> = {};
  fields.forEach((key: string) => {
    const value = `${settings[`amnezia_${key}`] || ''}`.trim();
    if (!value) return;
    amnezia[key] = amneziaJsonValue(key, value);
  });
  return amnezia;
}

export function wireGuardPeerFromSettings(settings: ChildSettings) {
  const peer: Record<string, unknown> = {
    address: `${settings.address || ''}`.trim(),
    port: Number(settings.port),
    public_key: `${settings.public_key || ''}`.trim(),
    allowed_ips: normalizeOptionValues(settings.allowed_ips),
  };
  if (`${settings.pre_shared_key || ''}`.trim()) {
    peer.pre_shared_key = `${settings.pre_shared_key}`.trim();
  }
  if (`${settings.persistent_keepalive_interval || ''}`.trim()) {
    const value = `${settings.persistent_keepalive_interval}`.trim();
    peer.persistent_keepalive_interval = value.includes('-')
      ? value
      : Number(value);
  }
  return peer;
}

export function wireGuardPeerListItemLabel(
  tunnelId: string,
  value: unknown,
  option: CBIOption,
) {
  const peer = tunnelPeerForValue(tunnelId, value, option);
  return E(
    'span',
    { class: 'fkp-dynlist-label' },
    wireGuardPeerDisplayNameFromObject(peer),
  );
}

export function applyImportedTunnelEndpoint(
  map: CBIMap,
  fields: ImportedTunnelFields,
  endpoint: Record<string, unknown>,
) {
  // A parameter both ends must agree on means an AmneziaWG peer; only one-sided ones mean WireGuard
  // with obfuscation, which any server accepts.
  const importedAmnezia = (endpoint.amnezia || {}) as Record<string, unknown>;
  const amneziaKeys = Object.keys(importedAmnezia);
  const twoSided = amneziaKeys.some(
    (key: string) => !ONE_SIDED_AMNEZIA_KEYS.includes(key),
  );
  setModalOptionValue(map, fields.type, twoSided ? 'amneziawg' : 'wireguard');
  setModalOptionValue(
    map,
    fields.amneziaEnabled,
    !twoSided && amneziaKeys.length > 0 ? '1' : '0',
  );
  setModalOptionValue(map, fields.address, endpoint.address || []);
  setModalOptionValue(map, fields.privateKey, endpoint.private_key || '');
  setModalOptionValue(map, fields.listenPort, endpoint.listen_port || '');
  setModalOptionValue(map, fields.mtu, endpoint.mtu || '');
  const peerStore = childPendingSettingsStore(fields.peers, fields.tunnelId);
  const peerIds = ((endpoint.peers || []) as WireGuardPeerObject[]).map(
    (peer) => {
      const id = nextSectionId('tunnel_peer');
      peerStore[id] = {
        address: `${peer.address || ''}`.trim(),
        port: peer.port != null ? `${peer.port}` : '',
        public_key: `${peer.public_key || ''}`.trim(),
        pre_shared_key: `${peer.pre_shared_key || ''}`.trim(),
        allowed_ips: normalizeOptionValues(peer.allowed_ips),
        persistent_keepalive_interval:
          peer.persistent_keepalive_interval != null
            ? `${peer.persistent_keepalive_interval}`
            : '',
      };
      return id;
    },
  );
  setModalOptionValue(map, fields.peers, peerIds);
  AMNEZIA_KEYS.forEach((key: string) => {
    setModalOptionValue(
      map,
      fields.amnezia[key],
      typeof importedAmnezia[key] === 'boolean'
        ? importedAmnezia[key]
          ? '1'
          : '0'
        : `${importedAmnezia[key] ?? ''}`,
    );
  });
  map.checkDepends();
}

export function wireGuardPeerDisplayNameFromObject(
  peer: WireGuardPeerObject | null | undefined,
) {
  if (!peer) {
    return _('WireGuard peer');
  }
  const address = `${peer.address || ''}`.trim();
  const port = Number(peer.port);
  return address && Number.isInteger(port)
    ? `${address}:${port}`
    : address || _('WireGuard peer');
}
