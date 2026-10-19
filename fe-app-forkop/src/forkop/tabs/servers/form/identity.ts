import {
  FORKOP_UCI_PACKAGE,
  RESERVED_RUNTIME_TAGS,
  TAILSCALE_CONTROL_URL,
} from '../../../../constants';
import { validateTailscaleHostname } from '../../../../validators/validateTailscaleHostname';
import { validateUrlField } from '../../../../validators/validateUrl';
import { configureTextareaOption } from '../../../cbi/annotatedTextarea';
import {
  keepUnavailableSectionChoice,
  validateSectionChoice,
} from '../../../cbi/choices';
import { message } from '../../../../validators/messages';
import {
  GRID_KIND_COLUMN_WIDTH,
  GRID_SWITCH_COLUMN_WIDTH,
} from '../../../cbi/grid';
import {
  coreHas,
  missingCoreFeatureNote,
  validateCoreFeature,
} from '../../../services/coreFeatures.service';
import { clearClientList } from '../clients';
import { DEFAULT_PROTOCOL } from '../constants';
import { addGenerateButton, autofill, syncSecurityChoices } from '../controls';
import { randomPort } from '../credentials';
import { option } from '../formValues';
import { loadDefaultPublicHost } from '../network';
import {
  PROTOCOLS,
  getProtocol,
  listenerProtocols,
  protocolLabel,
  protocolCoreFeature,
  protocolSpec,
  serverMissingCoreFeature,
} from '../protocols';
import { routingSectionChoices } from '../routing';
import {
  validateHost,
  validateInboundJson,
  validateListenAddress,
  validateListenPort,
  validateOptionalCidrOrIp,
  validateRequired,
  validateRequiredText,
} from '../validators';

export function addIdentityOptions(section: CBISection) {
  // Both declared columns come from the Sections tab, which is the same grid
  // one tab over: a name, a switch, one column naming what the row is, and the
  // row actions. A width of its own here moved every column on the page when
  // the user switched tabs, because whatever these two do not take goes to the
  // name column beside them.
  let o = section.option(form.Flag, 'enabled', _('Enable'));
  o.default = '1';
  o.rmempty = false;
  o.editable = true;
  o.width = GRID_SWITCH_COLUMN_WIDTH;

  o = section.option(form.DummyValue, '_protocol_display', _('Protocol'));
  o.modalonly = false;
  o.textvalue = (sectionId: string) => {
    const label = protocolLabel(getProtocol(sectionId));
    const missing = serverMissingCoreFeature(sectionId);
    return missing ? `${label} (${missingCoreFeatureNote(missing)})` : label;
  };
  o.cfgvalue = o.textvalue;
  o.width = GRID_KIND_COLUMN_WIDTH;

  o = section.option(form.Value, 'label', _('Server name'));
  o.modalonly = true;
  o.validate = function (sectionId: string, value: string) {
    const required = validateRequiredText(sectionId, value);
    if (required !== true) {
      return required;
    }

    const name = `${value}`.trim();
    if (name.includes('/')) {
      return message.slashInName();
    }
    if (RESERVED_RUNTIME_TAGS.has(name)) {
      return message.reservedName();
    }

    return [
      ...(uci.sections(FORKOP_UCI_PACKAGE, 'server') || []),
      ...(uci.sections(FORKOP_UCI_PACKAGE, 'section') || []),
    ].some(
      (item) =>
        item['.name'] !== sectionId &&
        `${item.label || item['.name'] || ''}`.trim() === name,
    )
      ? message.nameTaken()
      : true;
  };

  o = section.option(form.ListValue, 'protocol', _('Protocol'));
  // A protocol the installed core lacks is offered only to the server that
  // already has it, marked, so a save neither loses it nor passes it.
  o.load = function (sectionId: string) {
    const current = option(sectionId, 'protocol') || DEFAULT_PROTOCOL;
    this.keylist = [];
    this.vallist = [];
    PROTOCOLS.forEach((entry) => {
      const feature = protocolCoreFeature(entry.id);
      if (!feature || coreHas(feature)) {
        this.value(entry.id, entry.label);
      } else if (entry.id === current) {
        this.value(
          entry.id,
          `${entry.label} (${missingCoreFeatureNote(feature)})`,
        );
      }
    });
    return current;
  };
  o.default = DEFAULT_PROTOCOL;
  o.rmempty = false;
  o.modalonly = true;
  o.validate = (sectionId: string, value: string) => {
    const required = validateRequired(sectionId, value);
    return required === true
      ? validateCoreFeature(protocolCoreFeature(value))
      : required;
  };
  o.onchange = function (_ev, sectionId: string, value: unknown) {
    syncSecurityChoices(sectionId, value, true);
    // A client of the previous protocol holds credentials the new one cannot use,
    // and a half converted account only fails on save. The list starts over.
    clearClientList(this.map, sectionId);
  };
}

export function addTailscaleOptions(section: CBISection) {
  const onTailscale = (o: CBIOption) => o.depends('protocol', 'tailscale');

  let o = section.option(
    form.Value,
    'tailscale_auth_key',
    _('Authorization key'),
  );
  o.modalonly = true;
  o.password = true;
  o.validate = validateRequired;
  onTailscale(o);

  o = section.option(
    form.Value,
    'tailscale_hostname',
    _('Device name'),
    _(
      'The router is offered in the Tailscale console as an exit node under this name, and carries traffic once approved',
    ),
  );
  o.modalonly = true;
  o.validate = (_sectionId: string, value: string) =>
    validateTailscaleHostname(value);
  onTailscale(o);

  o = section.option(
    form.DynamicList,
    'tailscale_advertise_routes',
    _('Advertise routes'),
  );
  o.placeholder = '192.168.1.0/24';
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalCidrOrIp;
  onTailscale(o);

  o = section.option(form.Flag, 'tailscale_accept_routes', _('Accept routes'));
  o.default = '0';
  o.rmempty = true;
  o.modalonly = true;
  onTailscale(o);

  o = section.option(form.Flag, 'tailscale_ephemeral', _('Ephemeral node'));
  o.default = '0';
  o.rmempty = true;
  o.modalonly = true;
  onTailscale(o);

  o = section.option(
    form.Value,
    'tailscale_control_url',
    _('Coordination server'),
  );
  o.default = TAILSCALE_CONTROL_URL;
  o.modalonly = true;
  o.validate = (_sectionId: string, value: string) => validateUrlField(value);
  onTailscale(o);

  o = section.option(
    form.Flag,
    'tailscale_detour_enabled',
    _('Coordination server through a section'),
  );
  o.default = '0';
  o.rmempty = false;
  o.modalonly = true;
  onTailscale(o);

  o = section.option(
    form.ListValue,
    'tailscale_detour_section',
    _('Coordination server through'),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.depends({ protocol: 'tailscale', tailscale_detour_enabled: '1' });
  o.load = function (sectionId: string) {
    this.keylist = [];
    this.vallist = [];
    routingSectionChoices().forEach(([value, label]) =>
      this.value(value, label),
    );
    const value = option(sectionId, 'tailscale_detour_section');
    keepUnavailableSectionChoice(this, value);
    return value;
  };
  o.validate = function (_sectionId: string, value: string) {
    return validateSectionChoice(this, value);
  };
}

// Shown greyed out in the JSON inbound editor: the smallest inbound
// validateInboundJson accepts. The tag is left out because Forkop writes the
// server name over it.
export const JSON_INBOUND_PLACEHOLDER = [
  '{',
  '  "type": "mixed",',
  '  "listen": "::",',
  '  "listen_port": 1080',
  '}',
].join('\n');

export function addJsonInboundOptions(section: CBISection) {
  const o = section.option(form.TextValue, 'inbound_json', _('JSON Inbound'));
  o.depends('protocol', 'json_inbound');
  o.placeholder = JSON_INBOUND_PLACEHOLDER;
  o.rows = 10;
  o.wrap = 'soft';
  o.textarea = true;
  o.modalonly = true;
  o.validate = validateInboundJson;
  configureTextareaOption(o);
}

export function addListenerOptions(section: CBISection) {
  const onListener = (o: CBIOption) =>
    listenerProtocols().forEach((protocol: string) =>
      o.depends('protocol', protocol),
    );

  let o = section.option(form.Value, 'listen', _('Listen address'));
  o.placeholder = '::';
  o.default = '::';
  o.modalonly = true;
  o.validate = validateListenAddress;
  listenerProtocols()
    .filter((protocol: string) => !protocolSpec(protocol)?.anyAddress)
    .forEach((protocol: string) => o.depends('protocol', protocol));

  o = section.option(form.Value, 'listen_port', _('Listen port'));
  o.modalonly = true;
  o.validate = validateListenPort;
  autofill(
    o,
    (sectionId: string) => option(sectionId, 'listen_port') || randomPort(),
  );
  onListener(o);
  addGenerateButton(o, () => randomPort(), _('Pick a free port'));

  o = section.option(
    form.Value,
    'public_host',
    _('Public address'),
    _('The address links and profiles point at'),
  );
  o.modalonly = true;
  o.validate = validateHost;
  onListener(o);
  autofill(o, function (sectionId: string) {
    const stored = option(sectionId, 'public_host');
    return stored
      ? stored
      : loadDefaultPublicHost().then((host: string) => host || '');
  });

  // Without this the listener answers only on the LAN: the WAN zone of an OpenWrt
  // firewall rejects everything it was not told to accept, so a server made to be
  // dialled from outside would silently never be reached.
  o = section.option(
    form.Flag,
    'open_firewall',
    _('Open the port'),
    _(
      "Opens the port in the router's firewall to connections from the internet",
    ),
  );
  o.default = '1';
  o.rmempty = false;
  o.modalonly = true;
  onListener(o);
}
