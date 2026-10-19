// What the OpenConnect tunnel dialog holds and the endpoint it stands for. The
// tunnel is stored as the native openconnect endpoint; the dialog edits the
// part of it a router can use, and anything else a stored endpoint holds is
// carried through.

import {
  isBase32Secret,
  normalizeOpenConnectFingerprint,
  normalizeOpenConnectServer,
} from '../../../../helpers/parseOpenConnectConfig';
import { isEncryptedKey, isRouterPath } from '../../../../helpers/material';
import { normalizeOptionValues } from '../../../cbi/listValues';

type Endpoint = Record<string, unknown>;
type Tls = Record<string, unknown>;

export const TOKEN_MODES = ['totp', 'stoken', 'oidc'];

// Every top-level field and every TLS field the dialog writes. What a stored
// endpoint holds beyond these - a mobile identity, a host check, an MCA
// certificate - is kept as it was.
const MANAGED = [
  'type',
  'tag',
  'detour',
  'server',
  'flavor',
  'username',
  'password',
  'auth_group',
  'cookie',
  'token',
  'reported_os',
  'user_agent',
  'version',
  'local_hostname',
  'no_udp',
  'compression_disabled',
  'compression_mode',
  'ipv6_disabled',
  'pfs',
  'allow_insecure_crypto',
  'mtu',
  'base_mtu',
  'dpd_interval',
  'external_auth_disabled',
  'form_entries',
  'tls',
];

const MANAGED_TLS = [
  'insecure',
  'server_name',
  'peer_fingerprint',
  'system_trust_disabled',
  'certificate_authority',
  'certificate_authority_path',
  'client_certificate',
  'client_certificate_path',
  'client_key',
  'client_key_path',
  'client_key_password',
];

// The advanced fields and what each holds while it is left alone.
const ADVANCED_DEFAULTS: Record<string, unknown> = {
  openconnect_insecure: '0',
  openconnect_server_name: '',
  openconnect_no_system_trust: '0',
  openconnect_no_udp: '0',
  openconnect_reported_os: '',
  openconnect_user_agent: '',
  openconnect_version: '',
  openconnect_local_hostname: '',
  openconnect_compression: '',
  openconnect_ipv6_disabled: '0',
  openconnect_mtu: '',
  openconnect_base_mtu: '',
  openconnect_dpd: '',
  openconnect_insecure_crypto: '0',
  openconnect_pfs: '0',
  openconnect_cookie: '',
  openconnect_form_entries: [],
  openconnect_browser: '0',
};

function text(value: unknown) {
  return `${value ?? ''}`;
}

function trimmed(value: unknown) {
  return text(value).trim();
}

function list(value: unknown): string[] {
  return value == null
    ? []
    : Array.isArray(value)
      ? value.map(text)
      : [text(value)];
}

function flag(value: unknown) {
  return value === true ? '1' : '0';
}

// A PEM field of the endpoint, as the dialog shows it: the content, or the path
// the core reads it from on the router.
function material(object: Record<string, unknown>, key: string) {
  const content = list(object[key]).join('\n').trim();
  return content || trimmed(object[`${key}_path`]);
}

function setMaterial(
  object: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  const content = trimmed(value);
  if (!content) return;
  if (isRouterPath(content)) {
    object[`${key}_path`] = content;
  } else {
    object[key] = content.split(/\r?\n/).map((line) => line.trimEnd());
  }
}

// A duration of the endpoint in the seconds the dialog asks for.
function secondsValue(value: unknown) {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(trimmed(value));
  if (!match || !trimmed(value)) return trimmed(value);
  const [, hours = '0', minutes = '0', seconds = '0'] = match;
  return `${Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)}`;
}

function number(value: unknown) {
  return /^\d+$/.test(trimmed(value)) ? Number(trimmed(value)) : null;
}

interface FormEntry {
  form_id?: unknown;
  name?: unknown;
  value?: unknown;
  submission_key?: unknown;
  promote?: unknown;
}

// An answer to the login form as openconnect --form-entry writes it.
function isFormEntryLine(entry: FormEntry) {
  return (
    !!trimmed(entry.form_id) &&
    !!trimmed(entry.name) &&
    !entry.submission_key &&
    !entry.promote &&
    !/[:=]/.test(text(entry.form_id)) &&
    !text(entry.name).includes('=')
  );
}

export function parseFormEntry(value: unknown) {
  const match = /^([^:=]+):([^=]+)=(.*)$/.exec(trimmed(value));
  return match
    ? { form_id: match[1].trim(), name: match[2].trim(), value: match[3] }
    : null;
}

function formEntries(endpoint: Endpoint) {
  return (
    Array.isArray(endpoint.form_entries) ? endpoint.form_entries : []
  ) as FormEntry[];
}

function compressionValue(endpoint: Endpoint) {
  if (endpoint.compression_disabled === true) return 'off';
  return endpoint.compression_mode === 'all' ? 'all' : '';
}

function advancedInUse(settings: ChildSettings) {
  return Object.entries(ADVANCED_DEFAULTS).some(([key, empty]) =>
    Array.isArray(empty)
      ? normalizeOptionValues(settings[key]).length > 0
      : trimmed(settings[key]) !== trimmed(empty),
  );
}

function preservedFields(endpoint: Endpoint) {
  const preserved: Endpoint = {};
  Object.entries(endpoint).forEach(([key, value]) => {
    if (!MANAGED.includes(key)) preserved[key] = value;
  });
  const tls = (endpoint.tls || {}) as Tls;
  const preservedTls: Tls = {};
  Object.entries(tls).forEach(([key, value]) => {
    if (!MANAGED_TLS.includes(key)) preservedTls[key] = value;
  });
  if (Object.keys(preservedTls).length) preserved.tls = preservedTls;
  const token = endpoint.token as Record<string, unknown> | undefined;
  if (token && !TOKEN_MODES.includes(text(token.mode))) {
    preserved.token = token;
  }
  const entries = formEntries(endpoint).filter(
    (entry) => !isFormEntryLine(entry),
  );
  if (entries.length) preserved.form_entries = entries;
  return preserved;
}

export function openConnectInitialSettings(endpoint: Endpoint): ChildSettings {
  const tls = (endpoint.tls || {}) as Tls;
  const token = (endpoint.token || {}) as Record<string, unknown>;
  const tokenMode = TOKEN_MODES.includes(text(token.mode))
    ? text(token.mode)
    : '';
  const settings: ChildSettings = {
    openconnect_server: trimmed(endpoint.server),
    openconnect_flavor: trimmed(endpoint.flavor) || 'anyconnect',
    openconnect_username: text(endpoint.username),
    openconnect_password: text(endpoint.password),
    openconnect_auth_group: text(endpoint.auth_group),
    openconnect_certificate_enabled:
      material(tls, 'client_certificate') || material(tls, 'client_key')
        ? '1'
        : '0',
    openconnect_cert: material(tls, 'client_certificate'),
    openconnect_key: material(tls, 'client_key'),
    openconnect_key_password: text(tls.client_key_password),
    openconnect_token_mode: tokenMode,
    openconnect_token_secret: tokenMode ? text(token.secret) : '',
    openconnect_token_pin: tokenMode ? text(token.pin) : '',
    openconnect_token_password: tokenMode ? text(token.password) : '',
    openconnect_token_device_id: tokenMode ? text(token.device_id) : '',
    openconnect_ca: material(tls, 'certificate_authority'),
    openconnect_fingerprints: list(tls.peer_fingerprint),
    openconnect_insecure: flag(tls.insecure),
    openconnect_server_name: trimmed(tls.server_name),
    openconnect_no_system_trust: flag(tls.system_trust_disabled),
    openconnect_no_udp: flag(endpoint.no_udp),
    openconnect_reported_os: trimmed(endpoint.reported_os),
    openconnect_user_agent: text(endpoint.user_agent),
    openconnect_version: trimmed(endpoint.version),
    openconnect_local_hostname: trimmed(endpoint.local_hostname),
    openconnect_compression: compressionValue(endpoint),
    openconnect_ipv6_disabled: flag(endpoint.ipv6_disabled),
    openconnect_mtu: trimmed(endpoint.mtu),
    openconnect_base_mtu: trimmed(endpoint.base_mtu),
    openconnect_dpd: secondsValue(endpoint.dpd_interval),
    openconnect_insecure_crypto: flag(endpoint.allow_insecure_crypto),
    openconnect_pfs: flag(endpoint.pfs),
    openconnect_cookie: text(endpoint.cookie),
    openconnect_form_entries: formEntries(endpoint)
      .filter(isFormEntryLine)
      .map(
        (entry) =>
          `${trimmed(entry.form_id)}:${trimmed(entry.name)}=${text(entry.value)}`,
      ),
    openconnect_browser: endpoint.external_auth_disabled === true ? '0' : '1',
    openconnect_preserved: JSON.stringify(preservedFields(endpoint)),
  };
  settings.openconnect_advanced = advancedInUse(settings) ? '1' : '0';
  return settings;
}

function mergePreserved(endpoint: Endpoint, settings: ChildSettings) {
  let preserved: Endpoint = {};
  try {
    preserved = JSON.parse(text(settings.openconnect_preserved) || '{}');
  } catch (_error) {
    preserved = {};
  }
  const tls = {
    ...((preserved.tls || {}) as Tls),
    ...((endpoint.tls || {}) as Tls),
  };
  const entries = [...formEntries(endpoint), ...formEntries(preserved)];
  const result = { ...preserved, ...endpoint };
  if (Object.keys(tls).length) result.tls = tls;
  if (entries.length) result.form_entries = entries;
  return result;
}

// A TOTP secret is stored the way the core reads it: base32 without the spaces
// an authenticator shows it with.
function tokenSecret(mode: string, value: unknown) {
  const secret = trimmed(value);
  return mode === 'totp' && !/^otpauth:\/\//i.test(secret)
    ? secret
        .replace(/\s+/g, '')
        .toUpperCase()
        .replace(/^BASE32:/, 'base32:')
    : secret;
}

function serverValue(value: unknown) {
  const result = normalizeOpenConnectServer(value);
  return 'server' in result ? result.server : trimmed(value);
}

function fingerprintValue(value: string) {
  const result = normalizeOpenConnectFingerprint(value);
  return 'fingerprint' in result ? result.fingerprint : value.trim();
}

function applyAdvanced(endpoint: Endpoint, tls: Tls, settings: ChildSettings) {
  if (settings.openconnect_advanced !== '1') return;
  if (settings.openconnect_insecure === '1') tls.insecure = true;
  if (trimmed(settings.openconnect_server_name)) {
    tls.server_name = trimmed(settings.openconnect_server_name);
  }
  if (settings.openconnect_no_system_trust === '1') {
    tls.system_trust_disabled = true;
  }
  if (settings.openconnect_no_udp === '1') endpoint.no_udp = true;
  for (const [key, field] of [
    ['reported_os', 'openconnect_reported_os'],
    ['version', 'openconnect_version'],
    ['local_hostname', 'openconnect_local_hostname'],
  ]) {
    if (trimmed(settings[field])) endpoint[key] = trimmed(settings[field]);
  }
  if (trimmed(settings.openconnect_user_agent)) {
    endpoint.user_agent = text(settings.openconnect_user_agent);
  }
  if (settings.openconnect_compression === 'off') {
    endpoint.compression_disabled = true;
  } else if (settings.openconnect_compression === 'all') {
    endpoint.compression_mode = 'all';
  }
  if (settings.openconnect_ipv6_disabled === '1') endpoint.ipv6_disabled = true;
  const mtu = number(settings.openconnect_mtu);
  if (mtu) endpoint.mtu = mtu;
  const baseMtu = number(settings.openconnect_base_mtu);
  if (baseMtu) endpoint.base_mtu = baseMtu;
  const dpd = number(settings.openconnect_dpd);
  if (dpd) endpoint.dpd_interval = `${dpd}s`;
  if (settings.openconnect_insecure_crypto === '1') {
    endpoint.allow_insecure_crypto = true;
  }
  if (settings.openconnect_pfs === '1') endpoint.pfs = true;
  if (text(settings.openconnect_cookie)) {
    endpoint.cookie = text(settings.openconnect_cookie).trim();
  }
  const entries = normalizeOptionValues(settings.openconnect_form_entries)
    .map(parseFormEntry)
    .filter(Boolean);
  if (entries.length) endpoint.form_entries = entries;
  if (settings.openconnect_browser === '1') {
    delete endpoint.external_auth_disabled;
  }
}

export function openConnectEndpoint(settings: ChildSettings): Endpoint {
  const flavor = trimmed(settings.openconnect_flavor) || 'anyconnect';
  const endpoint: Endpoint = {
    type: 'openconnect',
    server: serverValue(settings.openconnect_server),
    flavor,
    external_auth_disabled: true,
  };
  const tls: Tls = {};
  if (trimmed(settings.openconnect_username)) {
    endpoint.username = trimmed(settings.openconnect_username);
  }
  if (text(settings.openconnect_password)) {
    endpoint.password = text(settings.openconnect_password);
  }
  if (trimmed(settings.openconnect_auth_group)) {
    endpoint.auth_group = trimmed(settings.openconnect_auth_group);
  }
  const mode = trimmed(settings.openconnect_token_mode);
  if (TOKEN_MODES.includes(mode)) {
    const token: Record<string, unknown> = {
      mode,
      secret: tokenSecret(mode, settings.openconnect_token_secret),
    };
    if (mode === 'stoken') {
      for (const [key, field] of [
        ['pin', 'openconnect_token_pin'],
        ['password', 'openconnect_token_password'],
        ['device_id', 'openconnect_token_device_id'],
      ]) {
        if (trimmed(settings[field])) token[key] = trimmed(settings[field]);
      }
    }
    endpoint.token = token;
  }
  if (settings.openconnect_certificate_enabled === '1') {
    setMaterial(tls, 'client_certificate', settings.openconnect_cert);
    setMaterial(tls, 'client_key', settings.openconnect_key);
    if (text(settings.openconnect_key_password)) {
      tls.client_key_password = text(settings.openconnect_key_password);
    }
  }
  setMaterial(tls, 'certificate_authority', settings.openconnect_ca);
  const fingerprints = normalizeOptionValues(
    settings.openconnect_fingerprints,
  ).map(fingerprintValue);
  if (fingerprints.length) tls.peer_fingerprint = fingerprints;
  applyAdvanced(endpoint, tls, settings);
  if (Object.keys(tls).length) endpoint.tls = tls;
  return mergePreserved(endpoint, settings);
}

export function validateOpenConnectServer(value: unknown) {
  const result = normalizeOpenConnectServer(value);
  return 'server' in result ? true : result.message;
}

export function validateOpenConnectFingerprint(value: unknown) {
  if (!trimmed(value)) return true;
  const result = normalizeOpenConnectFingerprint(value);
  return 'fingerprint' in result ? true : result.message;
}

export function validateTokenSecret(mode: unknown, value: unknown) {
  const secret = trimmed(value);
  if (!secret) {
    return mode === 'oidc'
      ? _('Enter the access token')
      : _('Enter the secret of the token');
  }
  if (mode !== 'totp') return true;
  if (/^otpauth:\/\//i.test(secret)) {
    return /^otpauth:\/\/totp\//i.test(secret) && /[?&]secret=/i.test(secret)
      ? true
      : _('The otpauth:// link must be of the totp type and carry a secret');
  }
  return isBase32Secret(secret)
    ? true
    : _('Enter the base32 secret or the otpauth:// link of the QR code');
}

export function validateFormEntry(value: unknown) {
  return !trimmed(value) || parseFormEntry(value)
    ? true
    : _('Write it as FORM:NAME=VALUE, as openconnect --form-entry takes it');
}

export function validateOpenConnectSettings(settings: ChildSettings) {
  const server = validateOpenConnectServer(settings.openconnect_server);
  if (server !== true) return server;
  const mode = trimmed(settings.openconnect_token_mode);
  if (mode) {
    const secret = validateTokenSecret(mode, settings.openconnect_token_secret);
    if (secret !== true) return secret;
  }
  const certificate = settings.openconnect_certificate_enabled === '1';
  if (certificate) {
    if (
      !trimmed(settings.openconnect_cert) ||
      !trimmed(settings.openconnect_key)
    ) {
      return _('The client certificate and its key go together: add both');
    }
    if (
      isEncryptedKey(settings.openconnect_key) &&
      !text(settings.openconnect_key_password)
    ) {
      return _('The client key is protected by a passphrase: enter it');
    }
  }
  for (const value of normalizeOptionValues(
    settings.openconnect_fingerprints,
  )) {
    const result = validateOpenConnectFingerprint(value);
    if (result !== true) return `${value}: ${result}`;
  }
  const advanced = settings.openconnect_advanced === '1';
  if (advanced) {
    for (const value of normalizeOptionValues(
      settings.openconnect_form_entries,
    )) {
      const result = validateFormEntry(value);
      if (result !== true) return `${value}: ${result}`;
    }
  }
  if (
    !trimmed(settings.openconnect_username) &&
    !certificate &&
    mode !== 'oidc' &&
    !(advanced && trimmed(settings.openconnect_cookie)) &&
    !(advanced && settings.openconnect_browser === '1')
  ) {
    return _(
      'Add how the router signs in: a username, a client certificate or a session cookie',
    );
  }
  return true;
}
