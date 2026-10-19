import {
  FORKOP_UCI_PACKAGE,
  TAILSCALE_CONTROL_URL,
} from '../../../../constants';
import {
  parseWireGuardConfig,
  parseWireGuardInput,
} from '../../../../helpers/parseWireGuardConfig';
import {
  AMNEZIA_PARAMETERS,
  amneziaParameter,
  validateAmneziaValue,
  validateWireGuardKey,
} from '../../../../helpers/wireguard';
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
import { addOpenVPNOptions, applyImportedOpenVPN } from './openvpnForm';
import {
  addOpenConnectOptions,
  applyImportedOpenConnect,
} from './openconnectForm';
import {
  looksLikeOpenConnectConfig,
  parseOpenConnectConfig,
} from '../../../../helpers/parseOpenConnectConfig';
import { pickFiles, readMaterialFile } from '../../../cbi/material';
import { showToast } from '../../../../helpers/showToast';
import { renderFolderOpenIcon24 } from '../../../../icons';
import {
  looksLikeOpenVPNConfig,
  parseOpenVPNConfig,
} from '../../../../helpers/parseOpenVPNConfig';
import type { OpenVPNFiles } from '../../../../helpers/parseOpenVPNConfig';
import { addCascadeOptions } from '../cascade';
import {
  validateSectionChildListName,
  validateSectionChildName,
} from '../outboundNames';
import { refreshOutboundDetourSectionOptionValues } from '../references';
import {
  CASCADE_TUNNEL_KINDS,
  applyImportedTunnelEndpoint,
  createTunnelItem,
  defaultWireGuardPeerSettings,
  fillOneSidedAmneziaDefaults,
  hasOneSidedAmneziaValues,
  materializeTunnelPeers,
  tunnelDisplayName,
  tunnelInitialSettings,
  tunnelPeerForValue,
  tunnelStorageSettings,
  wireGuardPeerDisplayNameFromObject,
  wireGuardPeerFromSettings,
  wireGuardPeerListItemLabel,
  wireGuardPeerSettingsKeys,
} from './model';
import {
  validateAmneziaRange,
  validateTunnelSettings,
  validateWireGuardListInput,
  validateWireGuardPeerValue,
  validateWireGuardPeers,
} from './validate';
import { E } from '../../../../helpers/element';

// A field AmneziaWG names in its configuration is labelled with that name, and
// one whose name is a sentence gets a label of its own and the name under it,
// so a value can be copied from a server's configuration.
function amneziaFieldTitle(key: string): [string, string?] {
  const conf = amneziaParameter(key)!.conf;
  const labels: Record<string, string> = {
    header_protection_key: _('Header protection key'),
    content_padding_addition: _('Additional packet padding'),
    rekey_after_time: _('Rekey interval'),
    rekey_timeout: _('Rekey timeout'),
    reject_after_time: _('Data rejection timeout'),
    keepalive_timeout: _('Keepalive timeout'),
    max_handshake_attempts: _('Maximum handshake attempts'),
    random_trailers: _('Random trailers'),
    disable_cookies: _('Disable cookies'),
  };
  return labels[key]
    ? [labels[key], _('%s in the configuration').format(conf)]
    : [conf];
}

function addWireGuardPeerItemOptions(section: CBISection) {
  let o = section.option(form.Value, 'address', _('Server address'));
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

  o = section.option(form.Value, 'pre_shared_key', _('Pre-shared key'));
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
      'Seconds between the packets that keep the tunnel open, or a range such as 25-35. Empty: none',
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
  const peer = context.adding
    ? null
    : tunnelPeerForValue(tunnelId, peerId, option);
  const peerName = peer?.address
    ? wireGuardPeerDisplayNameFromObject(peer)
    : '';
  return showChildItemSettingsModal(tunnelId, peerId, option, {
    typeName: 'tunnel_peer',
    ownerOption: 'tunnel',
    keys: wireGuardPeerSettingsKeys(),
    defaults: defaultWireGuardPeerSettings(),
    addOptions: addWireGuardPeerItemOptions,
    title: () =>
      peerName
        ? _('WireGuard peer: %s').format(peerName)
        : _('WireGuard peer settings'),
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

// What was pasted or loaded: what the WireGuard import reads - a configuration
// file, a share link, a vpn:// link or an Amnezia profile -, an OpenConnect
// configuration in any of its forms, or an OpenVPN profile.
function importedFormat(input: string) {
  if (/^\{[\s\S]*"type"\s*:\s*"openconnect"/u.test(input)) {
    return 'openconnect';
  }
  if (
    /^(vpn|wireguard|wg|awg|amneziawg):\/\//iu.test(input) ||
    input.startsWith('{') ||
    /^\s*\[(Interface|Peer)\]\s*$/imu.test(input)
  ) {
    return 'wireguard';
  }
  if (looksLikeOpenConnectConfig(input)) return 'openconnect';
  return looksLikeOpenVPNConfig(input) ? 'openvpn' : '';
}

const CONFIGURATION_FILE = /\.(ovpn|conf|xml|nmconnection)$/iu;

function readFiles(files: File[]) {
  return Promise.all(
    files.map((file) =>
      file.arrayBuffer().then((buffer) => ({
        name: file.name,
        content: readMaterialFile(new Uint8Array(buffer)),
      })),
    ),
  );
}

function showTunnelImportModal(
  parentMap: CBIMap,
  fields: ImportedTunnelFields,
  openvpn: Record<string, CBIOption>,
  openconnect: Record<string, CBIOption>,
) {
  const data = { settings: { configuration: '' } };
  const map = new form.JSONMap(data);
  const itemSection = map.section(form.NamedSection, 'settings');
  itemSection.anonymous = true;
  itemSection.addremove = false;
  // The certificates and keys a profile names as files of their own, from every
  // selection so far: they may come after the profile itself.
  const attachments: OpenVPNFiles = {};

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
      return _(
        'Paste a WireGuard, OpenVPN or OpenConnect configuration, or a wireguard://, vpn:// or anyconnect:// link',
      );
    }
    const format = importedFormat(input);
    if (format === 'openvpn') {
      const parsed = parseOpenVPNConfig(input, attachments);
      return parsed.valid ? true : parsed.message;
    }
    if (format === 'openconnect') {
      const parsed = parseOpenConnectConfig(input, attachments);
      return parsed.valid ? true : parsed.message;
    }
    if (!format) {
      return _(
        'This is neither a WireGuard, an OpenVPN nor an OpenConnect configuration',
      );
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

  // The mark on the field shows its reason only on hover, and a missing file is
  // what the user has to act on.
  const refuse = (input: string, message: string): never => {
    failedInput = input;
    importError = message;
    configuration.triggerValidation('settings');
    showToast(message, 'error');
    throw new TypeError(importError);
  };

  return renderStackedJsonSettingsModal(
    _('Import configuration'),
    map,
    async (settings: ChildSettings) => {
      const input = `${settings.configuration || ''}`.trim();
      if (importedFormat(input) === 'openconnect') {
        const parsed = parseOpenConnectConfig(input, attachments);
        if (!parsed.valid) refuse(input, parsed.message);
        else {
          setModalOptionValue(parentMap, fields.type, 'openconnect');
          parentMap.checkDepends();
          applyImportedOpenConnect(parentMap, openconnect, parsed);
          if (parsed.others.length) {
            showToast(
              _('Imported the first server. The profile also lists: %s').format(
                parsed.others.join(', '),
              ),
              'success',
              8000,
            );
          }
          if (parsed.skipped.length) {
            showToast(
              _('Imported. Not carried over: %s').format(
                parsed.skipped.join(', '),
              ),
              'success',
              6000,
            );
          }
        }
        return;
      }
      if (importedFormat(input) === 'openvpn') {
        const parsed = parseOpenVPNConfig(input, attachments);
        if (!parsed.valid) refuse(input, parsed.message);
        else {
          setModalOptionValue(parentMap, fields.type, 'openvpn-client');
          parentMap.checkDepends();
          applyImportedOpenVPN(parentMap, openvpn, parsed);
          if (parsed.skipped.length) {
            showToast(
              _('Imported. Not carried over: %s').format(
                parsed.skipped.join(', '),
              ),
              'success',
              6000,
            );
          }
        }
        return;
      }
      const parsed = await parseWireGuardInput(input);
      if (!parsed || parsed.valid !== true) {
        refuse(input, parsed?.message || _('Invalid WireGuard configuration'));
        return;
      }
      applyImportedTunnelEndpoint(parentMap, fields, parsed.endpoint);
    },
    {
      singleField: true,
      saveLabel: _('Import'),
      // The configuration file goes into the field and is imported at once; the
      // files it names can be selected with it or after it.
      secondaryAction: {
        label: _('From a file…'),
        icon: renderFolderOpenIcon24,
        run: (save) =>
          pickFiles(true, (selected) =>
            readFiles(selected).then((files) => {
              if (!files.length) return;
              const found =
                files.find((file) => CONFIGURATION_FILE.test(file.name)) ||
                files.find((file) => importedFormat(file.content.trim()));
              files
                .filter((file) => file !== found)
                .forEach((file) => (attachments[file.name] = file.content));
              const field = configuration.getUIElement('settings');
              if (found) field?.setValue(found.content.trim());
              const input = `${field?.getValue() ?? ''}`.trim();
              const result = configuration.validate('settings', input);
              configuration.triggerValidation('settings');
              if (result === true) return save();
              showToast(
                input
                  ? result
                  : _(
                      'Select the configuration file: .ovpn, .conf, .xml or .nmconnection',
                    ),
                'error',
              );
            }),
          ),
      },
    },
  );
}

const TUNNEL_KINDS = [
  ['wireguard', 'WireGuard'],
  ['amneziawg', 'AmneziaWG'],
  ['warp', 'Cloudflare WARP'],
  ['tailscale', 'Tailscale'],
  ['openvpn-client', 'OpenVPN'],
  ['openconnect', 'OpenConnect'],
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
      ? validateSectionChildListName(
          section_id,
          'tunnel',
          widget,
          itemNode,
          value,
        )
      : _('Enter a tunnel name');
  };
  [
    'wireguard',
    'amneziawg',
    'warp',
    'tailscale',
    'openvpn-client',
    'openconnect',
  ].forEach((kind: string) => o.depends('tunnel_type', kind));

  const importButton = itemSection.option(
    form.Button,
    '_import_config',
    _('Import configuration'),
  );
  importButton.inputtitle = _('Import');
  importButton.inputstyle = 'apply';
  importButton.depends('tunnel_type', 'wireguard');
  importButton.depends('tunnel_type', 'amneziawg');
  importButton.depends('tunnel_type', 'openvpn-client');
  importButton.depends('tunnel_type', 'openconnect');

  const warpGenerateButton = itemSection.option(
    form.Button,
    '_generate_warp_profile',
    _('WARP profile'),
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
      ? validateSectionChildName(section_id, 'tunnel', endpoint.tag)
      : _('JSON endpoint must contain a non-empty tag');
  };
  configureTextareaOption(endpointJsonOption);

  const openvpnOptions = addOpenVPNOptions(itemSection);
  const openconnectOptions = addOpenConnectOptions(itemSection);

  o = itemSection.option(
    form.Value,
    'warp_address',
    _('WARP server address'),
    _('Empty: the one the profile names'),
  );
  o.depends('tunnel_type', 'warp');
  o.rmempty = true;
  o.datatype = 'host';
  o = itemSection.option(
    form.Value,
    'warp_port',
    _('WARP server port'),
    _('Empty: the one the profile names'),
  );
  o.depends('tunnel_type', 'warp');
  o.rmempty = true;
  o.datatype = 'port';

  const addressOption = itemSection.option(
    form.DynamicList,
    'address',
    _('Tunnel addresses'),
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
    _('Empty: a random port'),
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
    return showTunnelImportModal(
      map,
      {
        type: typeOption,
        address: addressOption,
        privateKey: privateKeyOption,
        listenPort: listenPortOption,
        mtu: mtuOption,
        peers: peersOption,
        tunnelId,
        amneziaEnabled: amneziaEnabledOption,
        amnezia: amneziaOptions,
      },
      openvpnOptions,
      openconnectOptions,
    );
  };

  o = itemSection.option(
    form.Value,
    'warp_keepalive',
    _('Persistent keepalive'),
    _(
      'Seconds between the packets that keep the tunnel open, or a range such as 25-35. Empty: none',
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

  addCascadeOptions(
    itemSection,
    () => section_id,
    _('Connect to the tunnel server through another section'),
    CASCADE_TUNNEL_KINDS.map((kind) => ({ tunnel_type: kind })),
  );

  const amneziaEnabledOption = itemSection.option(
    form.Flag,
    'amnezia_enabled',
    _('Traffic obfuscation'),
    _(
      'AmneziaWG junk and signature packets before every handshake, which any WireGuard server ignores',
    ),
  );
  amneziaEnabledOption.default = '0';
  amneziaEnabledOption.rmempty = false;
  amneziaEnabledOption.depends('tunnel_type', 'wireguard');
  amneziaEnabledOption.depends('tunnel_type', 'warp');
  amneziaEnabledOption.onchange = function (
    _event: Event,
    _sectionId: string,
    value: unknown,
  ) {
    if (value === '1') {
      fillOneSidedAmneziaDefaults(map, amneziaOptions);
    }
  };

  AMNEZIA_PARAMETERS.forEach(({ key, kind, oneSided }) => {
    const option = itemSection.option(
      kind === 'flag' ? form.Flag : form.Value,
      `amnezia_${key}`,
      ...amneziaFieldTitle(key),
    );
    if (kind === 'flag') {
      option.default = '0';
    } else {
      option.validate = function (_itemId: string, value: unknown) {
        return validateAmneziaValue(key, value);
      };
    }
    option.rmempty = true;
    option.retain = true;
    option.depends('tunnel_type', 'amneziawg');
    if (oneSided) {
      option.depends({ tunnel_type: 'wireguard', amnezia_enabled: '1' });
      option.depends({ tunnel_type: 'warp', amnezia_enabled: '1' });
    }
    amneziaOptions[key] = option;
  });

  typeOption.onchange = function (
    _event: Event,
    _sectionId: string,
    value: unknown,
  ) {
    if (
      previousTunnelType === 'amneziawg' &&
      (value === 'wireguard' || value === 'warp')
    ) {
      setModalOptionValue(
        map,
        amneziaEnabledOption,
        hasOneSidedAmneziaValues(map, amneziaOptions) ? '1' : '0',
      );
    }
    previousTunnelType = `${value ?? ''}`;
    map.checkDepends();
  };

  const tunnelName = context.adding
    ? ''
    : tunnelDisplayName(section_id, tunnelId);
  return renderStackedJsonSettingsModal(
    tunnelName ? _('Tunnel: %s').format(tunnelName) : _('Tunnel settings'),
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
