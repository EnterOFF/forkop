import { configureTextareaOption } from '../../../cbi/annotatedTextarea';
import { parseOutboundJsonObject } from '../outboundJson';

// The native endpoint is the stored configuration. These fields edit its common
// options; everything else survives in the additional-options object.
type OpenVPNField = {
  path: string;
  label: () => string;
  choices?: string[];
  number?: boolean;
  list?: boolean;
  secret?: boolean;
  pem?: boolean;
};

const OPENVPN_FIELDS: OpenVPNField[] = [
  { path: 'server', label: () => _('Server address') },
  { path: 'server_port', label: () => _('Server port'), number: true },
  {
    path: 'network',
    label: () => _('Transport'),
    choices: ['udp', 'udp4', 'udp6', 'tcp', 'tcp4', 'tcp6'],
  },
  {
    path: 'mode',
    label: () => _('OpenVPN mode'),
    choices: ['tls', 'static_key'],
  },
  { path: 'username', label: () => _('Username') },
  { path: 'password', label: () => _('Password'), secret: true },
  { path: 'tls.server_name', label: () => _('Server certificate name') },
  { path: 'tls.certificate', label: () => _('CA certificate'), pem: true },
  {
    path: 'tls.client_certificate',
    label: () => _('Client certificate'),
    pem: true,
  },
  { path: 'tls.client_key', label: () => _('Client private key'), pem: true },
  {
    path: 'tls.peer_fingerprint',
    label: () => _('Server certificate fingerprints'),
    list: true,
  },
  {
    path: 'tls.control_wrap.type',
    label: () => _('Control channel protection'),
    choices: ['tls_auth', 'tls_crypt', 'tls_crypt_v2'],
  },
  {
    path: 'tls.control_wrap.key',
    label: () => _('Control channel key'),
    pem: true,
  },
  {
    path: 'tls.control_wrap.direction',
    label: () => _('Control channel key direction'),
    choices: ['client', 'server'],
  },
  { path: 'data_ciphers', label: () => _('Data ciphers'), list: true },
  { path: 'data_ciphers_fallback', label: () => _('Fallback data cipher') },
  { path: 'cipher', label: () => _('Cipher') },
  { path: 'auth', label: () => _('Packet authentication algorithm') },
  { path: 'mtu', label: () => _('MTU'), number: true },
  { path: 'address', label: () => _('Tunnel addresses'), list: true },
  { path: 'peer_address', label: () => _('Peer tunnel address') },
  { path: 'static_key', label: () => _('Static key'), pem: true },
  {
    path: 'key_direction',
    label: () => _('Static key direction'),
    choices: ['client', 'server'],
  },
];

function openVPNFieldKey(path: string) {
  return `openvpn_${path.replaceAll('.', '_')}`;
}

function openVPNParent(
  object: Record<string, unknown>,
  path: string,
  create = false,
) {
  const parts = path.split('.');
  const key = parts.pop()!;
  let parent = object;
  for (const part of parts) {
    if (parent[part] == null && create) parent[part] = {};
    const next = parent[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) return null;
    parent = next as Record<string, unknown>;
  }
  return { parent, key };
}

function pruneOpenVPNObjects(endpoint: Record<string, unknown>) {
  const tls = endpoint.tls as Record<string, unknown> | undefined;
  if (tls && typeof tls === 'object') {
    if (tls.control_wrap && !Object.keys(tls.control_wrap).length)
      delete tls.control_wrap;
    if (!Object.keys(tls).length) delete endpoint.tls;
  }
}

export function openVPNInitialSettings(
  endpoint: Record<string, unknown>,
): ChildSettings {
  const extra = JSON.parse(JSON.stringify(endpoint));
  delete extra.type;
  delete extra.tag;
  const settings: ChildSettings = {};
  for (const field of OPENVPN_FIELDS) {
    const slot = openVPNParent(extra, field.path);
    const value = slot?.parent[slot.key];
    settings[openVPNFieldKey(field.path)] = field.list
      ? value == null
        ? []
        : Array.isArray(value)
          ? value
          : [value]
      : Array.isArray(value)
        ? value.join('\n')
        : value == null
          ? ''
          : `${value}`;
    if (slot) delete slot.parent[slot.key];
  }
  pruneOpenVPNObjects(extra);
  settings.openvpn_extra = Object.keys(extra).length
    ? JSON.stringify(extra, null, 2)
    : '';
  return settings;
}

export function openVPNEndpoint(settings: ChildSettings) {
  const extra = `${settings.openvpn_extra || ''}`.trim();
  const endpoint = extra ? parseOutboundJsonObject(extra) : {};
  if (!endpoint || 'type' in endpoint || 'tag' in endpoint) return null;
  for (const field of OPENVPN_FIELDS) {
    const existing = openVPNParent(endpoint, field.path);
    if (existing && existing.key in existing.parent) return null;
    const input = settings[openVPNFieldKey(field.path)];
    const text =
      field.secret || field.path === 'username'
        ? `${input ?? ''}`
        : `${input ?? ''}`.trim();
    if (!text) continue;
    const slot = openVPNParent(endpoint, field.path, true);
    if (!slot) return null;
    if (field.choices && !field.choices.includes(text)) return null;
    if (
      field.number &&
      (!/^\d+$/u.test(text) || Number(text) < 1 || Number(text) > 65535)
    )
      return null;
    slot.parent[slot.key] = field.list
      ? (Array.isArray(input) ? input : [input])
          .map((value) => `${value}`.trim())
          .filter(Boolean)
      : field.number
        ? Number(text)
        : field.pem
          ? text.split(/\r?\n/u)
          : text;
  }
  pruneOpenVPNObjects(endpoint);
  return { ...endpoint, type: 'openvpn-client' };
}

export function addOpenVPNOptions(section: CBISection) {
  for (const field of OPENVPN_FIELDS) {
    const o = section.option(
      field.choices
        ? form.ListValue
        : field.pem
          ? form.TextValue
          : field.list
            ? form.DynamicList
            : form.Value,
      openVPNFieldKey(field.path),
      field.label(),
    );
    o.depends('tunnel_type', 'openvpn-client');
    o.rmempty = true;
    if (field.choices) {
      o.value('', _('Default'));
      field.choices.forEach((value) => o.value(value, value));
    }
    if (field.number) o.datatype = 'range(1,65535)';
    if (field.secret) o.password = true;
    if (field.pem) {
      o.rows = 5;
      o.textarea = true;
      configureTextareaOption(o);
    }
  }
  const extra = section.option(
    form.TextValue,
    'openvpn_extra',
    _('Additional OpenVPN options'),
    _(
      'Native JSON options for routes, reconnect timers and other advanced settings. Fields shown above must be edited in the form.',
    ),
  );
  extra.depends('tunnel_type', 'openvpn-client');
  extra.rows = 5;
  extra.textarea = true;
  extra.rmempty = true;
  extra.validate = (_id: string, value: unknown) =>
    !`${value || ''}`.trim() || parseOutboundJsonObject(value)
      ? true
      : _('Enter a valid JSON object');
  configureTextareaOption(extra);
}
