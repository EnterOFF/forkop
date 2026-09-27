import {
  FORKOP_UCI_PACKAGE,
  TAILSCALE_CONTROL_URL,
} from '../../../../constants';
import {
  parseWireGuardConfig,
  parseWireGuardInput,
  validateAmneziaSignature,
  validateWireGuardKey,
} from '../../../../helpers/parseWireGuardConfig';
import { validateTailscaleHostname } from '../../../../validators/validateTailscaleHostname';
import { validateUrlField } from '../../../../validators/validateUrl';
import { configureTextareaOption } from '../../../cbi/annotatedTextarea';
import { getChildItemIds, nextSectionId } from '../../../cbi/childItems';
import { keepUnavailableSectionChoice } from '../../../cbi/choices';
import { ButtonAddSettingsDynamicList } from '../../../cbi/dynamicList';
import {
  addDynamicListItem,
  setDynamicListItemValue,
  updateDynamicListItemLabel,
  validateUniqueDynamicListItemName,
} from '../../../cbi/listItems';
import {
  nextDynamicListName,
  normalizeDynamicListItems,
} from '../../../cbi/listValues';
import {
  renderStackedJsonSettingsModal,
  setModalOptionValue,
  showChildItemSettingsModal,
} from '../../../cbi/modal';
import { JSON_ENDPOINT_PLACEHOLDER } from '../constants';
import { tunnelKindAvailable, tunnelKindCoreFeature } from '../coreSupport';
import { missingCoreFeatureNote } from '../../../services/coreFeatures.service';
import { parseOutboundJsonObject } from '../outboundJson';
import { addOpenVPNOptions } from './openvpn';
import { refreshOutboundDetourSectionOptionValues } from '../references';
import {
  AMNEZIA_COUNT_FIELDS,
  AMNEZIA_FIELDS,
  AMNEZIA_BOOLEAN_FIELDS,
  AMNEZIA_PADDING_FIELDS,
  AMNEZIA_RANGE_FIELDS,
  AMNEZIA_SIGNATURE_FIELDS,
  ONE_SIDED_AMNEZIA_FIELDS,
  applyImportedTunnelEndpoint,
  createTunnelItem,
  defaultWireGuardPeerSettings,
  fillOneSidedAmneziaDefaults,
  materializeTunnelPeers,
  tunnelDisplayName,
  tunnelInitialSettings,
  tunnelStorageSettings,
  wireGuardPeerDisplayNameFromObject,
  wireGuardPeerFromSettings,
  wireGuardPeerListItemLabel,
  wireGuardPeerSettingsKeys,
} from './model';
import {
  amneziaFieldLabel,
  validateAmneziaRange,
  validateTunnelSettings,
  validateWireGuardListInput,
  validateWireGuardPeerValue,
  validateWireGuardPeers,
} from './validate';
import { E } from '../../../../helpers/element';

function addWireGuardPeerItemOptions(section: CBISection) {
  let o = section.option(
    form.Value,
    'address',
    _('Server address'),
    _('Peer hostname or IP address'),
  );
  o.rmempty = false;
  o.validate = function (_itemId: string, value: unknown) {
    return `${value || ''}`.trim() ? true : _('Enter a server address');
  };

  o = section.option(form.Value, 'port', _('Server port'));
  o.datatype = 'port';
  o.rmempty = false;

  o = section.option(form.Value, 'public_key', _('Public key'));
  o.rmempty = false;
  o.validate = function (_itemId: string, value: unknown) {
    const key = `${value || ''}`.trim();
    if (!key) return _('Enter a public key');
    return validateWireGuardKey(key)
      ? true
      : _('WireGuard keys must be standard base64-encoded 32-byte values');
  };

  o = section.option(
    form.Value,
    'pre_shared_key',
    _('Pre-shared key'),
    _('An extra key shared with this peer'),
  );
  o.password = true;
  o.rmempty = true;
  o.validate = function (_itemId: string, value: unknown) {
    const key = `${value || ''}`.trim();
    return !key || validateWireGuardKey(key)
      ? true
      : _('WireGuard keys must be standard base64-encoded 32-byte values');
  };

  o = section.option(
    form.DynamicList,
    'allowed_ips',
    _('Allowed IPs'),
    _('The subnets that go through this peer'),
  );
  o.rmempty = false;
  o.validate = function (_itemId: string, value: unknown) {
    return validateWireGuardListInput(value);
  };

  o = section.option(
    form.Value,
    'persistent_keepalive_interval',
    _('Persistent keepalive'),
    _(
      'Interval between packets that keep the tunnel open, in seconds. Empty means the default',
    ),
  );
  o.validate = function (_itemId: string, value: unknown) {
    return validateAmneziaRange(value);
  };
  o.rmempty = true;
}

function showWireGuardPeerSettingsModal(
  tunnelId: string,
  itemValue: unknown,
  option: CBIOption,
  widget: CBIWidget,
  itemNode: Element | null,
  context: ChildItemModalContext = {},
) {
  const peerId = context.adding
    ? nextSectionId('tunnel_peer')
    : `${itemValue || ''}`;
  return showChildItemSettingsModal(tunnelId, peerId, option, {
    typeName: 'tunnel_peer',
    ownerOption: 'tunnel',
    keys: wireGuardPeerSettingsKeys(),
    defaults: defaultWireGuardPeerSettings(),
    addOptions: addWireGuardPeerItemOptions,
    title: () => _('WireGuard peer settings'),
    afterSave: (
      itemId: string,
      _inputValue: unknown,
      settings: ChildSettings,
      existing: boolean,
    ) => {
      const displayName = wireGuardPeerDisplayNameFromObject(
        wireGuardPeerFromSettings(settings),
      );
      if (!existing && context.adding) {
        addDynamicListItem(widget, itemId, displayName);
        return;
      }
      updateDynamicListItemLabel(itemNode, displayName);
    },
  });
}

function showTunnelImportModal(
  parentMap: CBIMap,
  fields: ImportedTunnelFields,
) {
  const data = { settings: { configuration: '' } };
  const map = new form.JSONMap(data);
  const itemSection = map.section(form.NamedSection, 'settings');
  itemSection.anonymous = true;
  itemSection.addremove = false;

  const configuration = itemSection.option(
    form.TextValue,
    'configuration',
    _('Configuration'),
  );
  configuration.rows = 12;
  configuration.wrap = 'off';
  configuration.textarea = true;
  configuration.rmempty = false;
  let failedInput = '';
  let importError = '';
  configuration.validate = function (_itemId: string, value: unknown) {
    const input = `${value || ''}`.trim();
    if (importError && input === failedInput) {
      return importError;
    }
    importError = '';
    failedInput = '';
    if (!input) {
      return _('Paste a configuration, a wireguard:// link or a vpn:// link');
    }
    // A vpn:// link and an Amnezia profile carry a compressed or nested
    // payload that only the import step decodes; a configuration file and a
    // share link are checked while the user types.
    if (/^vpn:\/\//iu.test(input) || input.startsWith('{')) {
      return true;
    }
    const parsed = parseWireGuardConfig(input);
    return parsed && parsed.valid === true
      ? true
      : parsed?.message || _('Invalid WireGuard configuration');
  };
  configureTextareaOption(configuration);

  return renderStackedJsonSettingsModal(
    _('Import configuration'),
    map,
    async (settings: ChildSettings) => {
      const parsed = await parseWireGuardInput(
        `${settings.configuration || ''}`,
      );
      if (!parsed || parsed.valid !== true) {
        failedInput = `${settings.configuration || ''}`.trim();
        importError = parsed?.message || _('Invalid WireGuard configuration');
        if (typeof configuration.triggerValidation === 'function') {
          configuration.triggerValidation('settings');
        }
        throw new TypeError(importError);
      }
      applyImportedTunnelEndpoint(parentMap, fields, parsed.endpoint);
    },
    { singleField: true, saveLabel: _('Import') },
  );
}

const TUNNEL_KINDS = [
  ['wireguard', 'WireGuard'],
  ['amneziawg', 'AmneziaWG'],
  ['warp', 'Cloudflare WARP'],
  ['tailscale', 'Tailscale'],
  ['openvpn-client', 'OpenVPN'],
  ['json', _('JSON endpoint')],
];

export function tunnelKindsDescription() {
  return _('Available: %s').format(
    TUNNEL_KINDS.filter(([kind]) => tunnelKindAvailable(kind))
      .map(([, label]) => label)
      .join(', '),
  );
}

export function showTunnelSettingsModal(
  section_id: string,
  itemValue: unknown,
  option: CBIOption,
  widget: CBIWidget,
  itemNode: Element | null,
  context: ChildItemModalContext = {},
) {
  const tunnelId = context.adding
    ? nextSectionId('tunnel')
    : `${itemValue || ''}`.trim();
  if (!tunnelId) {
    return null;
  }

  const data = { settings: tunnelInitialSettings(tunnelId, section_id) };
  if (context.adding) {
    // A new tunnel starts as the first kind the installed core can run.
    data.settings.tunnel_type = TUNNEL_KINDS.find(([kind]) =>
      tunnelKindAvailable(kind),
    )![0];
    data.settings.name = nextDynamicListName(
      option,
      section_id,
      getChildItemIds(section_id, 'tunnel'),
      'Tunnel',
    );
  }
  const map = new form.JSONMap(data);
  const itemSection = map.section(form.NamedSection, 'settings');
  itemSection.anonymous = true;
  itemSection.addremove = false;

  const typeOption = itemSection.option(
    form.ListValue,
    'tunnel_type',
    _('Tunnel type'),
  );
  let previousTunnelType = `${data.settings.tunnel_type || 'wireguard'}`;
  // A kind the installed core lacks is offered only to the tunnel that already
  // is one, marked, so its save is refused by name rather than switched.
  TUNNEL_KINDS.forEach(([kind, label]) => {
    if (tunnelKindAvailable(kind)) {
      typeOption.value(kind, label);
    } else if (kind === previousTunnelType) {
      typeOption.value(
        kind,
        `${label} (${missingCoreFeatureNote(tunnelKindCoreFeature(kind))})`,
      );
    }
  });
  typeOption.default = 'wireguard';
  typeOption.rmempty = false;

  let o = itemSection.option(form.Value, 'name', _('Tunnel name'));
  o.rmempty = false;
  o.validate = function (_itemId: string, value: unknown) {
    return `${value || ''}`.trim()
      ? validateUniqueDynamicListItemName(widget, itemNode, value)
      : _('Enter a tunnel name');
  };
  ['wireguard', 'amneziawg', 'warp', 'tailscale', 'openvpn-client'].forEach(
    (kind: string) => o.depends('tunnel_type', kind),
  );

  const importButton = itemSection.option(
    form.Button,
    '_import_config',
    _('Import configuration'),
    _('Fill the fields from an existing configuration'),
  );
  importButton.inputtitle = _('Import');
  importButton.inputstyle = 'apply';
  importButton.depends('tunnel_type', 'wireguard');
  importButton.depends('tunnel_type', 'amneziawg');

  const warpGenerateButton = itemSection.option(
    form.Button,
    '_generate_warp_profile',
    _('WARP profile'),
    _('Registers a device and fills the fields below'),
  );
  warpGenerateButton.inputtitle = _('Generate profile');
  warpGenerateButton.inputstyle = 'apply';
  warpGenerateButton.depends('tunnel_type', 'warp');

  const tailscaleAuthKeyOption = itemSection.option(
    form.Value,
    'tailscale_auth_key',
    _('Authorization key'),
    _('A key from the Tailscale console'),
  );
  tailscaleAuthKeyOption.password = true;
  tailscaleAuthKeyOption.rmempty = false;
  tailscaleAuthKeyOption.depends('tunnel_type', 'tailscale');
  tailscaleAuthKeyOption.retain = true;

  const tailscaleHostnameOption = itemSection.option(
    form.Value,
    'tailscale_hostname',
    _('Device name'),
    _('The name this device appears under in the Tailscale console'),
  );
  tailscaleHostnameOption.rmempty = false;
  tailscaleHostnameOption.validate = function (
    _itemId: string,
    value: unknown,
  ) {
    return validateTailscaleHostname(value);
  };
  tailscaleHostnameOption.depends('tunnel_type', 'tailscale');

  const tailscaleControlUrlOption = itemSection.option(
    form.Value,
    'tailscale_control_url',
    _('Coordination server'),
    _(
      'Address of the coordination server. Change it if you use a custom server',
    ),
  );
  tailscaleControlUrlOption.default = TAILSCALE_CONTROL_URL;
  tailscaleControlUrlOption.rmempty = false;
  tailscaleControlUrlOption.depends('tunnel_type', 'tailscale');
  tailscaleControlUrlOption.validate = function (
    _itemId: string,
    value: unknown,
  ) {
    return validateUrlField(value);
  };

  const tailscaleDetourEnabledOption = itemSection.option(
    form.Flag,
    'tailscale_detour_enabled',
    _('Coordination server through a section'),
    _('Reach the coordination server through a section instead of the WAN'),
  );
  tailscaleDetourEnabledOption.default = '0';
  tailscaleDetourEnabledOption.rmempty = false;
  tailscaleDetourEnabledOption.depends('tunnel_type', 'tailscale');

  const tailscaleDetourSectionOption = itemSection.option(
    form.ListValue,
    'tailscale_detour_section',
    _('Coordination server through'),
    _('Required. The section that carries the control-plane traffic'),
  );
  refreshOutboundDetourSectionOptionValues(
    tailscaleDetourSectionOption,
    section_id,
  );
  keepUnavailableSectionChoice(
    tailscaleDetourSectionOption,
    data.settings.tailscale_detour_section,
  );
  tailscaleDetourSectionOption.rmempty = false;
  tailscaleDetourSectionOption.depends({
    tunnel_type: 'tailscale',
    tailscale_detour_enabled: '1',
  });
  tailscaleDetourSectionOption.validate = function (
    _itemId: string,
    value: unknown,
  ) {
    if (!value) {
      return _('Select a section');
    }
    return value === section_id
      ? _('Current section cannot be used as its own transit section')
      : true;
  };

  const tailscaleAcceptRoutesOption = itemSection.option(
    form.Flag,
    'tailscale_accept_routes',
    _('Accept routes'),
    _('Use subnets other devices share'),
  );
  tailscaleAcceptRoutesOption.default = '1';
  tailscaleAcceptRoutesOption.rmempty = false;
  tailscaleAcceptRoutesOption.depends('tunnel_type', 'tailscale');

  const tailscaleExitNodeOption = itemSection.option(
    form.Value,
    'tailscale_exit_node',
    _('Exit node'),
    _(
      'IP address or name of the device internet traffic leaves through. Without one, only tailnet devices and the subnets they share are reachable',
    ),
  );
  tailscaleExitNodeOption.rmempty = true;
  tailscaleExitNodeOption.depends('tunnel_type', 'tailscale');

  const endpointJsonOption = itemSection.option(
    form.TextValue,
    'endpoint_json',
    _('JSON endpoint'),
  );
  endpointJsonOption.placeholder = JSON_ENDPOINT_PLACEHOLDER;
  endpointJsonOption.rows = 12;
  endpointJsonOption.wrap = 'soft';
  endpointJsonOption.textarea = true;
  endpointJsonOption.rmempty = false;
  endpointJsonOption.depends('tunnel_type', 'json');
  endpointJsonOption.validate = function (_itemId: string, value: unknown) {
    const endpoint = parseOutboundJsonObject(value);
    if (!endpoint) {
      return _('Enter a valid JSON endpoint object');
    }
    return typeof endpoint.tag === 'string' && endpoint.tag.trim()
      ? true
      : _('JSON endpoint must contain a non-empty tag');
  };
  configureTextareaOption(endpointJsonOption);

  addOpenVPNOptions(itemSection);

  o = itemSection.option(
    form.Value,
    'warp_address',
    _('WARP server address'),
    _('Override the WARP peer IP address or hostname'),
  );
  o.depends('tunnel_type', 'warp');
  o.rmempty = true;
  o.datatype = 'host';
  o = itemSection.option(form.Value, 'warp_port', _('WARP server port'));
  o.depends('tunnel_type', 'warp');
  o.rmempty = true;
  o.datatype = 'port';

  const addressOption = itemSection.option(
    form.DynamicList,
    'address',
    _('Tunnel addresses'),
    _('Interface IPv4 or IPv6 addresses in CIDR format'),
  );
  addressOption.rmempty = false;
  addressOption.depends('tunnel_type', 'wireguard');
  addressOption.depends('tunnel_type', 'amneziawg');
  addressOption.validate = function (_itemId: string, value: unknown) {
    return validateWireGuardListInput(value);
  };

  const privateKeyOption = itemSection.option(
    form.Value,
    'private_key',
    _('Private key'),
  );
  privateKeyOption.password = true;
  privateKeyOption.rmempty = false;
  privateKeyOption.depends('tunnel_type', 'wireguard');
  privateKeyOption.depends('tunnel_type', 'amneziawg');
  privateKeyOption.validate = function (_itemId: string, value: unknown) {
    const key = `${value || ''}`.trim();
    if (!key) return _('Enter a private key');
    return validateWireGuardKey(key)
      ? true
      : _('WireGuard keys must be standard base64-encoded 32-byte values');
  };

  const listenPortOption = itemSection.option(
    form.Value,
    'listen_port',
    _('Listen port'),
    _('Local UDP port. Empty means the default'),
  );
  listenPortOption.datatype = 'port';
  listenPortOption.rmempty = true;
  listenPortOption.depends('tunnel_type', 'wireguard');
  listenPortOption.depends('tunnel_type', 'amneziawg');

  const mtuOption = itemSection.option(form.Value, 'mtu', 'MTU');
  // What transport/wireguard in the core falls back to when the endpoint carries
  // no MTU of its own.
  mtuOption.placeholder = '1408';
  mtuOption.datatype = 'range(1,65535)';
  mtuOption.rmempty = true;
  mtuOption.depends('tunnel_type', 'wireguard');
  mtuOption.depends('tunnel_type', 'amneziawg');

  const peersOption = itemSection.option(
    ButtonAddSettingsDynamicList,
    'peer_ids',
    _('Peers'),
    _('Required. Remote nodes to connect to'),
  );
  peersOption.rmempty = false;
  peersOption.depends('tunnel_type', 'wireguard');
  peersOption.depends('tunnel_type', 'amneziawg');
  peersOption.addButtonLabel = _('+ Add peer');
  peersOption.ownerOption = 'tunnel';
  peersOption.childOwnerId = () => tunnelId;
  peersOption.createId = (value: unknown) => `${value || ''}`.trim();
  peersOption.renderItemSettingsModal = showWireGuardPeerSettingsModal;
  peersOption.renderListItemLabel = function (ownerId: string, value: unknown) {
    return wireGuardPeerListItemLabel(ownerId, value, this);
  };
  peersOption.validateItemsOnSave = function (
    _ownerId: string,
    values: unknown,
  ) {
    return validateWireGuardPeers(values, tunnelId, this);
  };
  peersOption.validate = function (_itemId: string, value: unknown) {
    if (!`${value || ''}`.trim()) {
      const current =
        typeof this.formvalue === 'function' ? this.formvalue(_itemId) : [];
      return normalizeDynamicListItems(current).length > 0
        ? true
        : _('Add at least one WireGuard peer');
    }
    return validateWireGuardPeerValue(value, tunnelId, this);
  };

  const amneziaOptions: Record<string, CBIOption> = {};
  importButton.onclick = function () {
    return showTunnelImportModal(map, {
      type: typeOption,
      address: addressOption,
      privateKey: privateKeyOption,
      listenPort: listenPortOption,
      mtu: mtuOption,
      peers: peersOption,
      tunnelId,
      wireguardJunk: wireguardJunkOption,
      amnezia: amneziaOptions,
    });
  };

  o = itemSection.option(
    form.Value,
    'warp_keepalive',
    _('Persistent keepalive'),
    _(
      'Interval between packets that keep the tunnel open, in seconds. Empty means the default',
    ),
  );
  o.validate = function (_itemId: string, value: unknown) {
    return validateAmneziaRange(value);
  };
  o.rmempty = true;
  o.depends('tunnel_type', 'warp');

  const warpProfileIdOption = itemSection.option(
    form.Value,
    'warp_profile_id',
    _('Profile ID'),
  );
  warpProfileIdOption.rmempty = false;
  warpProfileIdOption.depends('tunnel_type', 'warp');

  const warpAuthTokenOption = itemSection.option(
    form.Value,
    'warp_auth_token',
    _('Auth token'),
  );
  warpAuthTokenOption.password = true;
  warpAuthTokenOption.rmempty = false;
  warpAuthTokenOption.depends('tunnel_type', 'warp');

  const warpPrivateKeyOption = itemSection.option(
    form.Value,
    'warp_private_key',
    _('Private key'),
  );
  warpPrivateKeyOption.password = true;
  warpPrivateKeyOption.rmempty = false;
  warpPrivateKeyOption.depends('tunnel_type', 'warp');

  const warpLicenseKeyOption = itemSection.option(
    form.Value,
    'warp_license_key',
    _('License key'),
    _('Applies WARP+ to the profile account'),
  );
  warpLicenseKeyOption.password = true;
  warpLicenseKeyOption.rmempty = true;
  warpLicenseKeyOption.depends('tunnel_type', 'warp');

  // A refused generation is written to the log with its reason, and the log
  // raises it as an alert of its own; only a call that never reached the
  // router is this handler's to report.
  warpGenerateButton.onclick = function () {
    return fs
      .exec('/usr/bin/forkop', ['generate_warp_profile'])
      .then((response) => {
        if ((response.code ?? 0) !== 0) {
          return;
        }
        const profile = JSON.parse(response.stdout) as Record<string, unknown>;
        setModalOptionValue(map, warpProfileIdOption, profile.id);
        setModalOptionValue(map, warpAuthTokenOption, profile.auth_token);
        setModalOptionValue(map, warpPrivateKeyOption, profile.private_key);
      })
      .catch((error: unknown) =>
        ui.addNotification(
          _('Forkop Error'),
          E('p', {}, error instanceof Error ? error.message : String(error)),
          'error',
        ),
      );
  };

  const warpJunkOption = itemSection.option(
    form.Flag,
    'warp_junk_enabled',
    _('Traffic obfuscation'),
    _('Masks traffic with the Amnezia mechanism to make it harder to identify'),
  );
  warpJunkOption.default = '0';
  warpJunkOption.rmempty = false;
  warpJunkOption.depends('tunnel_type', 'warp');
  warpJunkOption.onchange = function (
    _event: Event,
    _sectionId: string,
    value: unknown,
  ) {
    if (value === '1') {
      fillOneSidedAmneziaDefaults(map, amneziaOptions);
    }
  };

  const wireguardJunkOption = itemSection.option(
    form.Flag,
    'wireguard_junk_enabled',
    _('Traffic obfuscation'),
    _('Masks traffic with the Amnezia mechanism to make it harder to identify'),
  );
  wireguardJunkOption.default = '0';
  wireguardJunkOption.rmempty = false;
  wireguardJunkOption.depends('tunnel_type', 'wireguard');
  wireguardJunkOption.onchange = function (
    _event: Event,
    _sectionId: string,
    value: unknown,
  ) {
    if (value === '1') {
      fillOneSidedAmneziaDefaults(map, amneziaOptions);
    }
  };

  AMNEZIA_FIELDS.forEach((key: string) => {
    const option = itemSection.option(
      AMNEZIA_BOOLEAN_FIELDS.includes(key) ? form.Flag : form.Value,
      `amnezia_${key}`,
      amneziaFieldLabel(key),
    );
    if (AMNEZIA_COUNT_FIELDS.includes(key)) {
      option.datatype = 'and(uinteger,range(0,4294967295))';
    }
    if (AMNEZIA_PADDING_FIELDS.includes(key)) {
      option.datatype = 'and(uinteger,range(0,65535))';
    }
    if (AMNEZIA_RANGE_FIELDS.includes(key)) {
      option.validate = function (_itemId: string, value: unknown) {
        return validateAmneziaRange(value);
      };
    }
    if (AMNEZIA_BOOLEAN_FIELDS.includes(key)) option.default = '0';
    option.rmempty = true;
    option.retain = true;
    option.depends('tunnel_type', 'amneziawg');
    if (ONE_SIDED_AMNEZIA_FIELDS.includes(key)) {
      option.depends({ tunnel_type: 'warp', warp_junk_enabled: '1' });
      option.depends({
        tunnel_type: 'wireguard',
        wireguard_junk_enabled: '1',
      });
    }
    if (key === 'header_protection_key') {
      option.validate = function (_itemId: string, value: unknown) {
        const normalized = `${value || ''}`.trim();
        return !normalized || validateWireGuardKey(normalized)
          ? true
          : _('WireGuard keys must be standard base64-encoded 32-byte values');
      };
    }
    if (AMNEZIA_SIGNATURE_FIELDS.includes(key)) {
      option.validate = function (_itemId: string, value: unknown) {
        const normalized = `${value || ''}`.trim();
        return !normalized || validateAmneziaSignature(normalized)
          ? true
          : _(
              'AmneziaWG I1-I5 must be Custom Protocol Signature tags such as <b 0xdeadbeef><r 4>',
            );
      };
    }
    amneziaOptions[key] = option;
  });

  typeOption.onchange = function (
    _event: Event,
    _sectionId: string,
    value: unknown,
  ) {
    if (previousTunnelType === 'amneziawg') {
      if (value === 'warp') {
        setModalOptionValue(map, warpJunkOption, '1');
      } else if (value === 'wireguard') {
        setModalOptionValue(map, wireguardJunkOption, '1');
      }
    }
    previousTunnelType = `${value ?? ''}`;
    map.checkDepends();
  };

  return renderStackedJsonSettingsModal(
    _('Tunnel settings'),
    map,
    (settings: ChildSettings) => {
      const validation = validateTunnelSettings(
        settings,
        tunnelId,
        peersOption,
      );
      if (validation !== true) {
        throw new TypeError(validation);
      }
      const storage = tunnelStorageSettings(settings);
      const itemIds = L.toArray(settings.peer_ids).filter(Boolean);
      const itemId = createTunnelItem(section_id, tunnelId, storage);
      if (
        settings.tunnel_type === 'wireguard' ||
        settings.tunnel_type === 'amneziawg'
      ) {
        materializeTunnelPeers(tunnelId, itemIds, peersOption);
      } else {
        materializeTunnelPeers(tunnelId, [], peersOption);
      }
      if (context.adding) {
        uci.set(FORKOP_UCI_PACKAGE, itemId, 'section', section_id);
        addDynamicListItem(
          widget,
          itemId,
          tunnelDisplayName(section_id, itemId),
        );
        return;
      }
      setDynamicListItemValue(itemNode, itemId);
      updateDynamicListItemLabel(
        itemNode,
        tunnelDisplayName(section_id, itemId),
      );
      if (widget && widget.node) {
        widget.dispatchCbiDynlistChange(widget.node, itemId);
      }
    },
  );
}
