// An OpenConnect client configuration turned into the openconnect endpoint of
// the core. One comes in any of the forms the clients keep it in: the options of
// the openconnect client as a command line or a --config file, a NetworkManager
// connection, a Cisco AnyConnect XML profile, an anyconnect:// link, an
// openfortivpn configuration, or the endpoint itself as sing-box JSON. The
// certificates and keys they name as files are taken from the files handed
// over with them.

import { checkMaterial, splitCertificateAndKey } from './material';
import type { MaterialKind } from './material';
import { decodeBase64 } from './pem';
import {
  isValidHost,
  isValidPort,
  parseHostPort,
  unbracketHost,
} from '../validators/hostPort';
import { isIPv6 } from '../validators/validateIp';

export type OpenConnectFiles = Record<string, string>;

export type OpenConnectImportResult =
  | {
      valid: true;
      endpoint: Record<string, unknown>;
      // What changes how the client behaves and was left out.
      skipped: string[];
      // The servers a profile lists besides the one imported.
      others: string[];
    }
  | { valid: false; message: string };

export const OPENCONNECT_FLAVORS = [
  'anyconnect',
  'gp',
  'fortinet',
  'pulse',
  'nc',
  'f5',
];

export const OPENCONNECT_REPORTED_OS = [
  'linux-64',
  'linux',
  'win',
  'mac-intel',
  'android',
  'apple-ios',
];

class ImportError extends Error {}

function fail(message: string): never {
  throw new ImportError(message);
}

function text(value: unknown) {
  return `${value ?? ''}`.trim();
}

function lines(value: string) {
  return value
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
}

function basename(path: string) {
  return path.split(/[\\/]/).pop()!.toLowerCase();
}

// The server as the core takes it: a host, a port when it is not 443, and the
// path of a group URL. The core reaches it over HTTPS only and refuses a user,
// a query and a fragment in it.
export function normalizeOpenConnectServer(
  value: unknown,
): { server: string } | { message: string } {
  let rest = text(value);
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(rest);
  if (scheme) {
    if (scheme[1].toLowerCase() !== 'https') {
      return {
        message: _(
          'The server is reached over HTTPS: use https:// or no scheme',
        ),
      };
    }
    rest = rest.slice(scheme[0].length);
  }
  if (!rest) return { message: _('Enter the server address') };
  if (/[?#]/.test(rest)) {
    return {
      message: _(
        'sing-box does not support a query in the server address, such as the secret of ocserv camouflage after ?',
      ),
    };
  }
  if (/\s/.test(rest)) {
    return { message: _('The server address cannot contain spaces') };
  }
  const slash = rest.indexOf('/');
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? '' : rest.slice(slash).replace(/\/+$/, '');
  if (authority.includes('@')) {
    return {
      message: _(
        'Put the username in its own field, not in the server address',
      ),
    };
  }
  let host = authority;
  let port = '';
  const hostPort = parseHostPort(authority);
  if (hostPort) {
    if (!isValidPort(hostPort.port)) {
      return { message: _('Invalid port %s').format(hostPort.port) };
    }
    host = hostPort.host;
    port = hostPort.port === '443' ? '' : hostPort.port;
  } else if (!isValidHost(authority)) {
    return {
      message: _(
        'Enter a host name or an IP address, with a port and a group path if the server has them: vpn.example.com:8443/staff',
      ),
    };
  }
  const bare = unbracketHost(host);
  const shown = isIPv6(bare) ? `[${bare}]` : bare;
  return { server: `${shown}${port ? `:${port}` : ''}${path}` };
}

function server(value: unknown) {
  const result = normalizeOpenConnectServer(value);
  return 'server' in result ? result.server : fail(result.message);
}

const HEX = /^[0-9a-f]+$/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// A server certificate fingerprint in a form the core checks, as openconnect
// --servercert takes it: pin-sha256 and sha256: or sha1: of the public key, or
// the SHA-1 of the whole certificate, each at least four characters of it. The
// SHA-1 a browser shows has colons between the bytes.
export function normalizeOpenConnectFingerprint(
  value: unknown,
): { fingerprint: string } | { message: string } {
  const input = text(value);
  const prefixed = /^(pin-sha256|sha256|sha1):(.*)$/i.exec(input);
  if (prefixed) {
    const prefix = prefixed[1].toLowerCase();
    const body = prefixed[2];
    if (prefix === 'pin-sha256') {
      return BASE64.test(body) && body.length >= 4 && body.length <= 44
        ? { fingerprint: `pin-sha256:${body}` }
        : { message: _('pin-sha256 needs the base64 that openconnect prints') };
    }
    const size = prefix === 'sha256' ? 64 : 40;
    return HEX.test(body) && body.length >= 4 && body.length <= size
      ? { fingerprint: `${prefix}:${body.toLowerCase()}` }
      : { message: _('%s: needs hexadecimal digits').format(prefix) };
  }
  const hex = /^([0-9a-f]{2}:)+[0-9a-f]{2}$/i.test(input)
    ? input.replace(/:/g, '')
    : input;
  if (HEX.test(hex) && hex.length === 64) {
    return {
      message: _(
        'A SHA-256 of the whole certificate is not supported: use pin-sha256 as openconnect prints it',
      ),
    };
  }
  return HEX.test(hex) && hex.length >= 4 && hex.length <= 40
    ? { fingerprint: hex.toLowerCase() }
    : {
        message: _(
          'Use pin-sha256:… as openconnect prints it, or the SHA-1 of the certificate',
        ),
      };
}

function fingerprint(value: unknown) {
  const result = normalizeOpenConnectFingerprint(value);
  return 'fingerprint' in result ? result.fingerprint : fail(result.message);
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(bytes: Uint8Array) {
  let result = '';
  let buffer = 0;
  let bits = 0;
  bytes.forEach((byte) => {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  });
  if (bits > 0) result += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return result;
}

export function isBase32Secret(value: unknown) {
  const body = text(value)
    .replace(/^base32:/i, '')
    .replace(/[\s=]/g, '');
  return body !== '' && /^[A-Z2-7]+$/i.test(body);
}

// A TOTP secret as the core reads it: base32, or an otpauth:// link for any
// other algorithm. openconnect also reads a 0x hex secret, the raw bytes of an
// unmarked one and an algorithm before it, all of which become one of these.
export function totpSecret(value: string) {
  let secret = value.trim();
  if (/^otpauth:\/\//i.test(secret)) return secret;
  if (secret.startsWith('<?xml')) {
    fail(_('PSKC token files are not supported: use the base32 secret'));
  }
  let algorithm = 'SHA1';
  const named = /^(sha1|sha256|sha512):/i.exec(secret);
  if (named) {
    algorithm = named[1].toUpperCase();
    secret = secret.slice(named[0].length);
  }
  let encoded: string;
  if (/^base32:/i.test(secret)) {
    encoded = secret.slice(7).replace(/[\s=]/g, '').toUpperCase();
    if (!/^[A-Z2-7]+$/.test(encoded)) {
      fail(_('The token secret is not valid base32'));
    }
  } else if (secret.startsWith('0x')) {
    const hex = secret.slice(2);
    if (!HEX.test(hex) || hex.length % 2) {
      fail(_('The token secret is not valid hexadecimal'));
    }
    encoded = base32(
      Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16)),
    );
  } else {
    encoded = base32(new TextEncoder().encode(secret));
  }
  return algorithm === 'SHA1'
    ? encoded
    : `otpauth://totp/Forkop?secret=${encoded}&algorithm=${algorithm}`;
}

interface Draft {
  files: OpenConnectFiles;
  endpoint: Record<string, unknown>;
  tls: Record<string, unknown>;
  skipped: Set<string>;
  others: string[];
  host: string;
  path: string;
  certificate: string;
  key: string;
  tokenMode: string;
  tokenSecret: string;
  browser: boolean;
}

function draft(files: OpenConnectFiles): Draft {
  return {
    files: Object.fromEntries(
      Object.entries(files).map(([name, content]) => [basename(name), content]),
    ),
    endpoint: { type: 'openconnect' },
    tls: {},
    skipped: new Set(),
    others: [],
    host: '',
    path: '',
    certificate: '',
    key: '',
    tokenMode: '',
    tokenSecret: '',
    browser: false,
  };
}

// The content of a file a configuration names, from the files handed over with
// it. A key kept by the operating system or a token cannot reach the router.
function fileContent(state: Draft, reference: string) {
  if (/^(pkcs11|system):/i.test(reference)) {
    fail(
      _(
        'The key of this configuration is kept by the operating system or a token and cannot be exported to the router',
      ),
    );
  }
  const name = basename(reference);
  if (/\.(p12|pfx)$/i.test(name)) {
    fail(
      _(
        'The certificate is in the PKCS#12 bundle %s. Export the certificate and the key as PEM: openssl pkcs12 -in %s -out client.pem -nodes',
      ).format(name, name),
    );
  }
  const content = state.files[name];
  if (content == null) {
    fail(
      _(
        'The profile refers to the file %s. Select it together with the profile',
      ).format(name),
    );
  }
  return content.trim();
}

function material(state: Draft, reference: string, kind: MaterialKind) {
  const content = fileContent(state, reference);
  const check = checkMaterial(kind, content);
  if (!check.valid) fail(`${basename(reference)}: ${check.message}`);
  return lines(content);
}

function seconds(value: string, option: string) {
  return `${whole(value, option)}s`;
}

function whole(value: string, option: string) {
  if (!/^\d+$/.test(value)) fail(_('%s needs a whole number').format(option));
  return Number(value);
}

function flavor(value: string) {
  const name = value.toLowerCase();
  if (name === 'array') {
    fail(_('The Array Networks protocol is not supported by sing-box'));
  }
  if (!OPENCONNECT_FLAVORS.includes(name)) {
    fail(_('Unknown OpenConnect protocol %s').format(value));
  }
  return name;
}

function formEntry(value: string) {
  const match = /^([^:=]+):([^=]+)=(.*)$/.exec(value);
  if (!match) fail(_('form-entry needs FORM:NAME=VALUE'));
  return { form_id: match[1], name: match[2], value: match[3] };
}

function pushTo(object: Record<string, unknown>, key: string, value: unknown) {
  object[key] = [...((object[key] as unknown[]) || []), value];
}

// What the openconnect client does for the desktop it runs on, or for its own
// process. A router's tunnel has no use for these, so they are read and dropped.
const IGNORED_OPTIONS = new Set([
  'authenticate',
  'background',
  'cert-expire-warning',
  'config',
  'cookie-on-stdin',
  'cookieonly',
  'csd-user',
  'dump-http-traffic',
  'gnutls-debug',
  'help',
  'interface',
  'non-inter',
  'passtos',
  'passwd-on-stdin',
  'pid-file',
  'printcookie',
  'quiet',
  'reconnect-timeout',
  'script',
  'script-tun',
  'setuid',
  'syslog',
  'timestamp',
  'verbose',
  'version',
]);

// Options that change the connection and have no counterpart in the core. The
// import goes on without them and says so.
const SKIPPED_OPTIONS = new Set([
  'csd-wrapper',
  'dtls-ciphers',
  'dtls12-ciphers',
  'gnutls-priority',
  'http-auth',
  'key-password-from-fsid',
  'libproxy',
  'no-proxy',
  'openssl-ciphers',
  'proxy',
  'proxy-auth',
  'resolve',
  'tcp-keepalive',
  'xmlconfig',
]);

// Every option of the openconnect client and whether it takes a value: 1 must,
// 2 may.
const OPTION_ARGUMENTS: Record<string, number> = {
  'allow-insecure-crypto': 0,
  authenticate: 0,
  authgroup: 1,
  background: 0,
  'base-mtu': 1,
  cafile: 1,
  'cert-expire-warning': 1,
  certificate: 1,
  compression: 1,
  config: 1,
  cookie: 1,
  'cookie-on-stdin': 0,
  cookieonly: 0,
  'csd-user': 1,
  'csd-wrapper': 1,
  deflate: 0,
  'disable-ipv6': 0,
  'dtls-ciphers': 1,
  'dtls-local-port': 1,
  'dtls12-ciphers': 1,
  'dump-http-traffic': 0,
  'external-browser': 1,
  'force-dpd': 1,
  'force-trojan': 1,
  'form-entry': 1,
  'gnutls-debug': 1,
  'gnutls-priority': 1,
  help: 0,
  'http-auth': 1,
  interface: 1,
  juniper: 0,
  'key-password': 1,
  'key-password-from-fsid': 0,
  libproxy: 0,
  'local-hostname': 1,
  'mca-certificate': 1,
  'mca-key': 1,
  'mca-key-password': 1,
  mtu: 1,
  'no-cert-check': 0,
  'no-deflate': 0,
  'no-dtls': 0,
  'no-external-auth': 0,
  'no-http-keepalive': 0,
  'no-passwd': 0,
  'no-proxy': 0,
  'no-system-trust': 0,
  'no-xmlpost': 0,
  'non-inter': 0,
  'openssl-ciphers': 1,
  os: 1,
  passtos: 0,
  'passwd-on-stdin': 0,
  pfs: 0,
  'pid-file': 1,
  printcookie: 0,
  protocol: 1,
  proxy: 1,
  'proxy-auth': 1,
  'queue-len': 1,
  quiet: 0,
  'reconnect-timeout': 1,
  resolve: 1,
  script: 1,
  'script-tun': 0,
  server: 1,
  servercert: 1,
  setuid: 1,
  sni: 1,
  sslkey: 1,
  syslog: 0,
  'tcp-keepalive': 2,
  timestamp: 0,
  'token-mode': 1,
  'token-secret': 1,
  user: 1,
  usergroup: 1,
  useragent: 1,
  verbose: 0,
  version: 0,
  'version-string': 1,
  xmlconfig: 1,
};

const SHORT_OPTIONS: Record<string, string> = {
  b: 'background',
  C: 'cookie',
  c: 'certificate',
  D: 'no-deflate',
  d: 'deflate',
  e: 'cert-expire-warning',
  F: 'form-entry',
  g: 'usergroup',
  h: 'help',
  i: 'interface',
  k: 'sslkey',
  l: 'syslog',
  m: 'mtu',
  P: 'proxy',
  p: 'key-password',
  Q: 'queue-len',
  q: 'quiet',
  S: 'script-tun',
  s: 'script',
  U: 'setuid',
  u: 'user',
  V: 'version',
  v: 'verbose',
  x: 'xmlconfig',
};

const TOKEN_MODES: Record<string, string> = {
  rsa: 'stoken',
  totp: 'totp',
  oidc: 'oidc',
};

function applyOption(state: Draft, name: string, value: string) {
  const { endpoint, tls } = state;
  if (IGNORED_OPTIONS.has(name)) return;
  if (SKIPPED_OPTIONS.has(name)) {
    state.skipped.add(name);
    return;
  }
  switch (name) {
    case 'server':
      state.host = value;
      return;
    case 'protocol':
      endpoint.flavor = flavor(value);
      return;
    case 'juniper':
      endpoint.flavor = 'nc';
      return;
    case 'user':
      endpoint.username = value;
      return;
    case 'authgroup':
      endpoint.auth_group = value;
      return;
    case 'usergroup':
      state.path = value;
      return;
    case 'cookie':
      endpoint.cookie = value;
      return;
    case 'certificate':
      state.certificate = value;
      return;
    case 'sslkey':
      state.key = value;
      return;
    case 'key-password':
      tls.client_key_password = value;
      return;
    case 'cafile':
      tls.certificate_authority = material(state, value, 'ca');
      return;
    case 'no-system-trust':
      tls.system_trust_disabled = true;
      return;
    case 'servercert':
      pushTo(tls, 'peer_fingerprint', fingerprint(value));
      return;
    case 'no-cert-check':
      tls.insecure = true;
      return;
    case 'sni':
      tls.server_name = value;
      return;
    case 'token-mode':
      if (TOKEN_MODES[value.toLowerCase()]) {
        state.tokenMode = TOKEN_MODES[value.toLowerCase()];
      } else if (['hotp', 'yubioath'].includes(value.toLowerCase())) {
        state.skipped.add(`token-mode ${value.toLowerCase()}`);
      } else {
        fail(_('Unknown token mode %s').format(value));
      }
      return;
    case 'token-secret':
      state.tokenSecret = value.startsWith('@')
        ? fileContent(state, value.slice(1))
        : value;
      return;
    case 'os':
      if (!OPENCONNECT_REPORTED_OS.includes(value)) {
        fail(_('Unknown operating system %s').format(value));
      }
      endpoint.reported_os = value;
      return;
    case 'useragent':
      endpoint.user_agent = value;
      return;
    case 'version-string':
      endpoint.version = value;
      return;
    case 'local-hostname':
      endpoint.local_hostname = value;
      return;
    case 'no-dtls':
      endpoint.no_udp = true;
      return;
    case 'dtls-local-port':
      endpoint.dtls_local_port = whole(value, name);
      return;
    case 'compression':
      if (value === 'none') endpoint.compression_disabled = true;
      else if (value === 'all') endpoint.compression_mode = 'all';
      else if (value !== 'stateless') {
        fail(_('Unknown compression mode %s').format(value));
      }
      return;
    case 'deflate':
      endpoint.compression_mode = 'all';
      return;
    case 'no-deflate':
      endpoint.compression_disabled = true;
      return;
    case 'disable-ipv6':
      endpoint.ipv6_disabled = true;
      return;
    case 'no-http-keepalive':
      endpoint.http_keepalive_disabled = true;
      return;
    case 'no-xmlpost':
      endpoint.xml_post_disabled = true;
      return;
    case 'no-external-auth':
      state.browser = false;
      return;
    case 'external-browser':
      state.browser = true;
      return;
    case 'no-passwd':
      endpoint.password_authentication_disabled = true;
      return;
    case 'pfs':
      endpoint.pfs = true;
      return;
    case 'allow-insecure-crypto':
      endpoint.allow_insecure_crypto = true;
      return;
    case 'mtu':
      endpoint.mtu = whole(value, name);
      return;
    case 'base-mtu':
      endpoint.base_mtu = whole(value, name);
      return;
    case 'force-dpd':
      endpoint.dpd_interval = seconds(value, name);
      return;
    case 'force-trojan':
      endpoint.trojan_interval = seconds(value, name);
      return;
    case 'queue-len':
      endpoint.queue_length = whole(value, name);
      return;
    case 'form-entry':
      pushTo(endpoint, 'form_entries', formEntry(value));
      return;
    case 'mca-certificate':
      tls.mca_certificate = material(state, value, 'certificate');
      return;
    case 'mca-key':
      tls.mca_key = material(state, value, 'passphrase-key');
      return;
    case 'mca-key-password':
      tls.mca_key_password = value;
      return;
    default:
      state.skipped.add(name);
  }
}

// A command line splits the way a shell splits it.
function shellWords(line: string) {
  const words: string[] = [];
  let word = '';
  let quote = '';
  let active = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote) {
      if (char === quote) quote = '';
      else if (char === '\\' && quote === '"' && i + 1 < line.length) {
        i += 1;
        word += line[i];
      } else word += char;
      continue;
    }
    if (/\s/.test(char)) {
      if (active) words.push(word);
      word = '';
      active = false;
      continue;
    }
    active = true;
    if (char === '"' || char === "'") quote = char;
    else if (char === '\\' && i + 1 < line.length) {
      i += 1;
      if (line[i] !== '\n') word += line[i];
    } else word += char;
  }
  if (active) words.push(word);
  return words;
}

// The client run as a command, alone or after a pipe that feeds it a password.
const COMMAND_LINE = /(^|\|)\s*(sudo\s+(-\S+\s+)*)?(\S*\/)?openconnect(\s|$)/;

const SHELL_OPERATORS = new Set(['|', '||', '&&', ';', '&']);

function readCommandLine(state: Draft, input: string) {
  const words = shellWords(input.replace(/\\\r?\n/g, ' '));
  const start = words.findIndex((word) => /(^|\/)openconnect$/.test(word));
  const end = words.findIndex(
    (word, index) => index > start && SHELL_OPERATORS.has(word),
  );
  const args = words.slice(start + 1, end < 0 ? undefined : end);
  let positional = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (positional || !arg.startsWith('-') || arg === '-') {
      state.host = arg;
      continue;
    }
    if (arg === '--') {
      positional = true;
      continue;
    }
    let name: string;
    let value: string | undefined;
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      name = equals < 0 ? arg.slice(2) : arg.slice(2, equals);
      value = equals < 0 ? undefined : arg.slice(equals + 1);
      if (!(name in OPTION_ARGUMENTS))
        fail(_('Unknown option --%s').format(name));
    } else {
      name = SHORT_OPTIONS[arg[1]];
      if (!name) fail(_('Unknown option %s').format(arg.slice(0, 2)));
      if (arg.length > 2) value = arg.slice(2);
    }
    if (OPTION_ARGUMENTS[name] === 1 && value == null) {
      if (i + 1 >= args.length) fail(_('Option %s needs a value').format(arg));
      i += 1;
      value = args[i];
    }
    applyOption(state, name, value ?? '');
  }
}

// A --config file holds one option per line, without the dashes, its value after
// a space or an equals sign; a line starting with # is a comment.
function configOption(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const match = /^([a-z0-9-]+)(?:[ \t]*=?[ \t]*(.*))?$/.exec(trimmed);
  if (!match || !(match[1] in OPTION_ARGUMENTS)) return undefined;
  return { name: match[1], value: `${match[2] ?? ''}` };
}

function readConfigFile(state: Draft, input: string) {
  input.split(/\r?\n/).forEach((line) => {
    const option = configOption(line);
    if (option === undefined) {
      fail(_('Unknown option %s').format(line.trim().split(/[\s=]/)[0]));
    }
    if (option) applyOption(state, option.name, option.value);
  });
}

function looksLikeConfigFile(input: string) {
  const options = input
    .split(/\r?\n/)
    .map(configOption)
    .filter((option) => option !== null);
  return (
    options.length > 0 &&
    options.every((option) => option !== undefined) &&
    options.some((option) =>
      [
        'server',
        'protocol',
        'user',
        'authgroup',
        'usergroup',
        'servercert',
        'cafile',
        'certificate',
        'token-mode',
      ].includes(option!.name),
    )
  );
}

// An INI file: its sections, each a map of its keys.
function iniSections(input: string) {
  const sections: Record<string, Record<string, string>> = {};
  let current: Record<string, string> | null = null;
  input.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) return;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = sections[header[1].trim().toLowerCase()] ||= {};
      return;
    }
    const equals = line.indexOf('=');
    if (current && equals > 0) {
      current[line.slice(0, equals).trim()] = line.slice(equals + 1).trim();
    }
  });
  return sections;
}

function isYes(value: string | undefined) {
  return /^(yes|true|1)$/i.test(`${value || ''}`);
}

// A file NetworkManager names as a path on the computer it ran on, or that a
// keyfile embeds as a file:// URI.
function nmFile(value: string | undefined) {
  const path = text(value).replace(/^file:\/\//, '');
  return path && path !== '(null)' ? path : '';
}

const NM_TOKEN_MODES: Record<string, string> = {
  totp: 'totp',
  manual: 'stoken',
};

// The data and the secrets of a NetworkManager openconnect connection, whether
// a keyfile of /etc/NetworkManager/system-connections ([vpn], [vpn-secrets]) or
// the plugin's own export ([openconnect]).
function readNetworkManager(state: Draft, input: string) {
  const sections = iniSections(input);
  const exported = sections.openconnect;
  const data: Record<string, string> = exported
    ? {
        gateway: exported.Host,
        cacert: exported.CACert,
        protocol: exported.Protocol,
        proxy: exported.Proxy,
        useragent: exported.UserAgent,
        csd_wrapper: exported.CSDWrapper,
        reported_os: exported.ReportedOS,
        usercert: exported.UserCertificate,
        userkey: exported.PrivateKey,
        mcacert: exported.MachineCertificate,
        mcakey: exported.MachinePrivateKey,
        disable_udp: exported.DisableUDP,
        stoken_source: exported.StokenSource,
        stoken_string: exported.StokenString,
        pem_passphrase_fsid: exported.FSID,
      }
    : sections.vpn || {};
  const secrets = sections['vpn-secrets'] || {};
  const { endpoint, tls } = state;

  state.host = text(data.gateway);
  if (!state.host) fail(_('The connection names no gateway'));
  const xml = secrets.xmlconfig ? decodeBase64(secrets.xmlconfig) : null;
  if (xml && !/[.:/]/.test(state.host)) {
    const entry = hostEntries(new TextDecoder().decode(xml)).find(
      (item) => item.name === state.host,
    );
    if (entry) {
      state.host = entry.address;
      state.path = entry.group;
    }
  }
  if (data.protocol) endpoint.flavor = flavor(data.protocol);
  if (nmFile(data.cacert)) {
    tls.certificate_authority = material(state, nmFile(data.cacert), 'ca');
  }
  state.certificate = nmFile(data.usercert);
  state.key = nmFile(data.userkey);
  if (nmFile(data.mcacert)) {
    tls.mca_certificate = material(state, nmFile(data.mcacert), 'certificate');
  }
  if (nmFile(data.mcakey)) {
    tls.mca_key = material(state, nmFile(data.mcakey), 'passphrase-key');
  }
  if (data.useragent) endpoint.user_agent = data.useragent;
  if (data.reported_os) {
    if (!OPENCONNECT_REPORTED_OS.includes(data.reported_os)) {
      fail(_('Unknown operating system %s').format(data.reported_os));
    }
    endpoint.reported_os = data.reported_os;
  }
  if (/^\d+$/.test(text(data.mtu))) endpoint.mtu = Number(data.mtu);
  if (isYes(data.disable_udp)) endpoint.no_udp = true;
  if (data.proxy) state.skipped.add('proxy');
  if (data.csd_wrapper) state.skipped.add('csd_wrapper');
  if (isYes(data.pem_passphrase_fsid)) state.skipped.add('pem_passphrase_fsid');

  const source = text(data.stoken_source);
  if (NM_TOKEN_MODES[source]) {
    state.tokenMode = NM_TOKEN_MODES[source];
    state.tokenSecret = text(secrets.stoken_string || data.stoken_string);
  } else if (source && source !== 'disabled') {
    state.skipped.add(`stoken_source ${source}`);
  }

  if (secrets.gwcert)
    pushTo(tls, 'peer_fingerprint', fingerprint(secrets.gwcert));
  if (secrets.key_pass) tls.client_key_password = secrets.key_pass;
  if (secrets.mca_key_pass) tls.mca_key_password = secrets.mca_key_pass;
  Object.entries(secrets).forEach(([key, value]) => {
    const field = /^form:([^:]+):(.+)$/.exec(key);
    if (!field || !value) return;
    const name = field[2].toLowerCase();
    if (name === 'username') endpoint.username = value;
    else if (name === 'password') endpoint.password = value;
    else if (name === 'group_list') endpoint.auth_group = value;
    else
      pushTo(endpoint, 'form_entries', {
        form_id: field[1],
        name: field[2],
        value,
      });
  });
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function xmlText(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, name: string) =>
      name.startsWith('#x') || name.startsWith('#X')
        ? String.fromCodePoint(parseInt(name.slice(2), 16))
        : name.startsWith('#')
          ? String.fromCodePoint(Number(name.slice(1)))
          : (XML_ENTITIES[name.toLowerCase()] ?? entity),
    )
    .trim();
}

function xmlElement(body: string, name: string) {
  const match = new RegExp(
    `<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`,
  ).exec(body);
  return match ? xmlText(match[1]) : '';
}

interface HostEntry {
  name: string;
  address: string;
  group: string;
  ipsec: boolean;
}

// The servers of an AnyConnect profile: its HostEntry elements, whose
// UserGroup is the path openconnect puts after the address.
function hostEntries(xml: string): HostEntry[] {
  const body = xml.replace(/<!--[\s\S]*?-->/g, '');
  return Array.from(
    body.matchAll(
      /<(?:[\w-]+:)?HostEntry\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?HostEntry>/g,
    ),
  ).map((entry) => ({
    name: xmlElement(entry[1], 'HostName'),
    address: xmlElement(entry[1], 'HostAddress'),
    group: xmlElement(entry[1], 'UserGroup'),
    ipsec: /^ipsec$/i.test(xmlElement(entry[1], 'PrimaryProtocol')),
  }));
}

function readAnyConnectProfile(state: Draft, input: string) {
  const entries = hostEntries(input).filter((entry) => entry.address);
  const usable = entries.filter((entry) => !entry.ipsec);
  if (!entries.length) fail(_('The profile lists no server'));
  if (!usable.length) {
    fail(
      _('The profile connects over IPsec, which OpenConnect does not speak'),
    );
  }
  const [first, ...rest] = usable;
  state.host = first.address;
  state.path = first.group;
  state.others = rest.map((entry) => entry.name || entry.address);
  state.endpoint.flavor = 'anyconnect';
}

// anyconnect://create and anyconnect://connect, the links Cisco Secure Client
// takes. Only the server, the login and the group concern a router.
function readAnyConnectLink(state: Draft, input: string) {
  const match = /^anyconnect:(?:\/\/)?(\w+)\/?\??(.*)$/i.exec(input.trim());
  const action = `${match?.[1] || ''}`.toLowerCase();
  if (!match || !['create', 'connect'].includes(action)) {
    fail(
      _(
        'Only anyconnect://create and anyconnect://connect links carry a server',
      ),
    );
  }
  const query = new URLSearchParams(match[2]);
  if (/^ipsec$/i.test(query.get('protocol') || '')) {
    fail(_('The link connects over IPsec, which OpenConnect does not speak'));
  }
  state.host = text(query.get('host'));
  if (!state.host) fail(_('The link names no host'));
  state.endpoint.flavor = 'anyconnect';
  const username = text(query.get('prefill_username'));
  const password = query.get('prefill_password') ?? '';
  const group = text(query.get('prefill_group_list'));
  if (username) state.endpoint.username = username;
  if (password) state.endpoint.password = password;
  if (group) state.endpoint.auth_group = group;
  if (query.get('prefill_secondary_username')) {
    state.skipped.add('prefill_secondary_username');
  }
}

// What openfortivpn reads besides the server and the login, and has no use on
// a router: routes, resolvers, pppd and its own process.
const OPENFORTIVPN_IGNORED = new Set([
  'half-internet-routes',
  'persistent',
  'pppd-accept-remote',
  'pppd-call',
  'pppd-ifname',
  'pppd-ipparam',
  'pppd-log',
  'pppd-no-peerdns',
  'pppd-plugin',
  'pppd-use-peerdns',
  'set-dns',
  'set-routes',
  'use-resolvconf',
  'use-syslog',
]);

function readOpenFortiVPN(state: Draft, input: string) {
  const values: Record<string, string> = {};
  input.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const equals = line.indexOf('=');
    if (equals > 0) {
      values[line.slice(0, equals).trim().toLowerCase()] = line
        .slice(equals + 1)
        .trim();
    }
  });
  const { endpoint, tls } = state;
  endpoint.flavor = 'fortinet';
  if (!values.host) fail(_('The configuration names no host'));
  state.host = values.port ? `${values.host}:${values.port}` : values.host;
  if (values.realm) state.path = values.realm;
  Object.entries(values).forEach(([key, value]) => {
    if (OPENFORTIVPN_IGNORED.has(key)) return;
    switch (key) {
      case 'host':
      case 'port':
      case 'realm':
        return;
      case 'username':
        endpoint.username = value;
        return;
      case 'password':
        endpoint.password = value;
        return;
      case 'ca-file':
        tls.certificate_authority = material(state, value, 'ca');
        return;
      case 'user-cert':
        state.certificate = value;
        return;
      case 'user-key':
        state.key = value;
        return;
      case 'user-agent':
        endpoint.user_agent = value;
        return;
      case 'insecure-ssl':
        if (isYes(value)) endpoint.allow_insecure_crypto = true;
        return;
      case 'saml-login':
        state.browser = true;
        return;
      default:
        state.skipped.add(key);
    }
  });
}

function readJson(state: Draft, input: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (_error) {
    fail(_('This is not valid JSON'));
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).type !== 'openconnect'
  ) {
    fail(_('This JSON is not an openconnect endpoint'));
  }
  const endpoint = { ...(parsed as Record<string, unknown>) };
  delete endpoint.tag;
  if (endpoint.detour != null) {
    delete endpoint.detour;
    state.skipped.add('detour');
  }
  state.endpoint = endpoint;
  state.tls = { ...((endpoint.tls as Record<string, unknown>) || {}) };
  state.host = text(endpoint.server);
  state.browser = endpoint.external_auth_disabled !== true;
}

type Format =
  | 'command'
  | 'config'
  | 'networkmanager'
  | 'profile'
  | 'link'
  | 'openfortivpn'
  | 'json';

function format(input: string): Format | '' {
  const trimmed = input.trim();
  if (/^anyconnect:/i.test(trimmed)) return 'link';
  if (/^\{[\s\S]*"type"\s*:\s*"openconnect"/.test(trimmed)) return 'json';
  if (/<(?:[\w-]+:)?(AnyConnectProfile|ServerList)\b/.test(trimmed)) {
    return 'profile';
  }
  if (
    /^\s*\[openconnect\]\s*$/im.test(trimmed) ||
    /^\s*service-type\s*=\s*org\.freedesktop\.NetworkManager\.openconnect\s*$/im.test(
      trimmed,
    )
  ) {
    return 'networkmanager';
  }
  if (COMMAND_LINE.test(trimmed)) return 'command';
  if (/^\s*host\s*=/im.test(trimmed)) return 'openfortivpn';
  return looksLikeConfigFile(trimmed) ? 'config' : '';
}

export function looksLikeOpenConnectConfig(input: string) {
  return format(`${input || ''}`) !== '';
}

// The client certificate and its key, from a file each or from one file that
// holds both, as openconnect takes them.
function finishCertificate(state: Draft) {
  if (!state.certificate && !state.key) return;
  if (!state.certificate) {
    fail(_('The configuration has a client key but no certificate for it'));
  }
  const content = fileContent(state, state.certificate);
  const both = state.key ? null : splitCertificateAndKey(content);
  const certificate = both ? both.certificate : content;
  const key = both ? both.key : state.key ? fileContent(state, state.key) : '';
  if (!key) {
    fail(
      _(
        'The configuration has a client certificate but no key for it. Select the key file together with it',
      ),
    );
  }
  for (const [value, kind] of [
    [certificate, 'certificate'],
    [key, 'passphrase-key'],
  ] as const) {
    const check = checkMaterial(kind, value);
    if (!check.valid) fail(check.message);
  }
  state.tls.client_certificate = lines(certificate);
  state.tls.client_key = lines(key);
}

function finishToken(state: Draft) {
  if (!state.tokenMode) return;
  if (!state.tokenSecret) {
    state.skipped.add('token-mode');
    return;
  }
  state.endpoint.token = {
    mode: state.tokenMode,
    secret:
      state.tokenMode === 'totp'
        ? totpSecret(state.tokenSecret)
        : state.tokenSecret,
  };
}

function buildEndpoint(input: string, files: OpenConnectFiles) {
  const state = draft(files);
  const kind = format(input);
  switch (kind) {
    case 'command':
      readCommandLine(state, input);
      break;
    case 'config':
      readConfigFile(state, input);
      break;
    case 'networkmanager':
      readNetworkManager(state, input);
      break;
    case 'profile':
      readAnyConnectProfile(state, input);
      break;
    case 'link':
      readAnyConnectLink(state, input);
      break;
    case 'openfortivpn':
      readOpenFortiVPN(state, input);
      break;
    case 'json':
      readJson(state, input);
      break;
    default:
      fail(_('This is not an OpenConnect configuration'));
  }
  if (!state.host) fail(_('The configuration names no server'));
  const { endpoint } = state;
  const path = state.path.replace(/^\/+/, '');
  endpoint.server = server(
    path ? `${state.host.replace(/\/+$/, '')}/${path}` : state.host,
  );
  endpoint.flavor ||= 'anyconnect';
  if (kind !== 'json') {
    finishCertificate(state);
    finishToken(state);
  }
  if (!state.browser) endpoint.external_auth_disabled = true;
  if (Object.keys(state.tls).length) endpoint.tls = state.tls;
  return {
    endpoint,
    skipped: [...state.skipped].sort(),
    others: state.others,
  };
}

export function parseOpenConnectConfig(
  input: string,
  files: OpenConnectFiles = {},
): OpenConnectImportResult {
  try {
    return { valid: true, ...buildEndpoint(`${input || ''}`, files) };
  } catch (error) {
    if (error instanceof ImportError) {
      return { valid: false, message: error.message };
    }
    throw error;
  }
}
