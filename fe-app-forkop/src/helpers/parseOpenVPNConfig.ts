// An OpenVPN client profile (.ovpn or .conf) turned into the openvpn-client
// endpoint of the core. The profile is read the way OpenVPN reads it: one
// directive per line, quoted arguments, inline <blocks>, and files it names
// taken from the files handed over with it.

import { checkOpenVPNMaterial } from './openvpnMaterial';
import type { OpenVPNMaterialKind } from './openvpnMaterial';

export type OpenVPNFiles = Record<string, string>;

export type OpenVPNImportResult =
  | {
      valid: true;
      endpoint: Record<string, unknown>;
      // The server asks for a login, whether or not the profile carries one.
      login: boolean;
      // Directives that change how OpenVPN behaves and were left out.
      skipped: string[];
    }
  | { valid: false; message: string };

interface Directive {
  name: string;
  args: string[];
  inline?: string;
  children?: Directive[];
}

export const OPENVPN_DEFAULT_PORT = 1194;

export const OPENVPN_DEFAULT_DATA_CIPHERS = [
  'AES-256-GCM',
  'AES-128-GCM',
  'CHACHA20-POLY1305',
];

// What a profile carries for the operating system of a desktop client or for
// the OpenVPN process itself: scripts, logging, privileges, the local socket,
// retries, routes and resolvers. A tunnel of the router is none of that - its
// sections decide what goes through it - so these are read and dropped.
const IGNORED = new Set([
  'auth-nocache',
  'block-ipv6',
  'block-outside-dns',
  'cd',
  'chroot',
  'client',
  'client-nat',
  'connect-retry',
  'connect-retry-max',
  'connect-timeout',
  'daemon',
  'dev-node',
  'dev-type',
  'dhcp-option',
  'disable-dco',
  'down',
  'down-pre',
  'explicit-exit-notify',
  'fast-io',
  'float',
  'group',
  'hand-window',
  'http-proxy-retry',
  'ifconfig-nowarn',
  'ignore-unknown-option',
  'inactive',
  'ip-win32',
  'ipchange',
  'key-method',
  'link-mtu',
  'local',
  'log',
  'log-append',
  'lport',
  'machine-readable-output',
  'management',
  'management-hold',
  'management-query-passwords',
  'mark',
  'mute',
  'mute-replay-warnings',
  'ncp-disable',
  'nobind',
  'persist-key',
  'persist-local-ip',
  'persist-remote-ip',
  'persist-tun',
  'ping-timer-rem',
  'providers',
  'pull',
  'pull-filter',
  'push-peer-info',
  'rcvbuf',
  'redirect-gateway',
  'redirect-private',
  'register-dns',
  'remap-usr1',
  'resolv-retry',
  'route',
  'route-delay',
  'route-gateway',
  'route-ipv6',
  'route-method',
  'route-metric',
  'route-noexec',
  'route-nopull',
  'route-pre-down',
  'route-up',
  'script-security',
  'server-poll-timeout',
  'setenv',
  'setenv-opt',
  'single-session',
  'sndbuf',
  'status',
  'status-version',
  'tls-client',
  'tls-exit',
  'tls-timeout',
  'topology',
  'tran-window',
  'tun-ipv6',
  'tun-mtu-extra',
  'txqueuelen',
  'up',
  'up-delay',
  'up-restart',
  'user',
  'verb',
  'windows-driver',
  'writepid',
]);

// Directives that change the connection and have no counterpart in the core,
// or none a router can use. The import goes on without them and says so.
const SKIPPED = new Set([
  'auth-retry',
  'crl-verify',
  'http-proxy',
  'http-proxy-option',
  'remote-cert-ku',
  'reneg-bytes',
  'reneg-pkts',
  'replay-window',
  'socks-proxy',
  'static-challenge',
  'tls-ciphersuites',
  'tls-groups',
  'tls-version-max',
  'verify-hash',
]);

const SERVER_DIRECTIVES = new Set([
  'mode',
  'server',
  'server-bridge',
  'tls-server',
  'dh',
  'client-config-dir',
  'ifconfig-pool',
]);

const OS_KEY_DIRECTIVES = new Set([
  'cryptoapicert',
  'pkcs11-id',
  'pkcs11-providers',
  'management-external-key',
  'management-external-cert',
]);

class ImportError extends Error {}

function fail(message: string): never {
  throw new ImportError(message);
}

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let quote = '';
  let active = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote) {
      if (char === quote) quote = '';
      else if (char === '\\' && quote === '"' && i + 1 < line.length) {
        i += 1;
        token += line[i];
      } else token += char;
      continue;
    }
    if (/\s/.test(char)) {
      if (active) tokens.push(token);
      token = '';
      active = false;
      continue;
    }
    if (!active && (char === '#' || char === ';')) break;
    active = true;
    if (char === '"' || char === "'") quote = char;
    else if (char === '\\' && i + 1 < line.length) {
      i += 1;
      token += line[i];
    } else token += char;
  }
  if (active) tokens.push(token);
  return tokens;
}

function readDirectives(lines: string[], closing?: string): Directive[] {
  const directives: Directive[] = [];
  while (lines.length) {
    const line = lines.shift()!;
    const trimmed = line.trim();
    if (closing && trimmed.toLowerCase() === `</${closing}>`) return directives;
    const open = /^<([A-Za-z0-9-]+)>$/.exec(trimmed);
    if (!open) {
      const tokens = tokenize(line);
      if (tokens.length) {
        directives.push({
          name: tokens[0].replace(/^--/, '').toLowerCase(),
          args: tokens.slice(1),
        });
      }
      continue;
    }
    const name = open[1].toLowerCase();
    if (name === 'connection') {
      directives.push({
        name,
        args: [],
        children: readDirectives(lines, name),
      });
      continue;
    }
    const content: string[] = [];
    let closed = false;
    while (lines.length) {
      const inner = lines.shift()!;
      if (inner.trim().toLowerCase() === `</${name}>`) {
        closed = true;
        break;
      }
      content.push(inner);
    }
    if (!closed) fail(_('The <%s> block is not closed').format(open[1]));
    directives.push({ name, args: [], inline: content.join('\n').trim() });
  }
  if (closing) fail(_('The <%s> block is not closed').format(closing));
  return directives;
}

function basename(path: string) {
  return path.split(/[\\/]/).pop()!.toLowerCase();
}

function isInlineReference(value: string | undefined) {
  return /^\[\[?inline\]?\]$/i.test(`${value || ''}`);
}

function lines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trimEnd());
}

function number(value: string | undefined, directive: string) {
  if (!/^\d+$/.test(`${value ?? ''}`)) {
    fail(_('%s needs a whole number').format(directive));
  }
  return Number(value);
}

function port(value: string | undefined, directive: string) {
  const result = number(value, directive);
  if (result < 1 || result > 65535) {
    fail(_('%s has an invalid port %s').format(directive, value));
  }
  return result;
}

function transport(value: string | undefined, directive: string) {
  const proto = `${value || ''}`.toLowerCase();
  if (/^udp[46]?$/.test(proto)) return 'udp';
  if (/^tcp[46]?(-client)?$/.test(proto)) return 'tcp';
  if (/^tcp[46]?-server$/.test(proto)) {
    fail(_('This is a server configuration, not a client profile'));
  }
  return fail(
    _('%s names an unsupported protocol %s').format(directive, value),
  );
}

// OpenVPN reads cipher and digest names in any case; the core takes them in
// the case OpenVPN prints them.
function cipherName(value: string | undefined) {
  return `${value || ''}`.toUpperCase();
}

function digestName(value: string | undefined) {
  const name = `${value || ''}`.toUpperCase().replace(/^SHA-/, 'SHA');
  return name === 'RMD160' ? 'RIPEMD160' : name;
}

function netmaskLength(mask: string | undefined) {
  const parts = `${mask || ''}`.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return -1;
  }
  const bits = parts
    .map((part) => Number(part).toString(2).padStart(8, '0'))
    .join('');
  return /^1*0*$/.test(bits) && bits.length === 32 ? bits.indexOf('0') : -1;
}

export function looksLikeOpenVPNConfig(input: string) {
  return /^\s*(client|remote|dev|proto|tls-client|<ca>|<connection>)(\s|$)/im.test(
    `${input || ''}`,
  );
}

interface Remote {
  server: string;
  port: string;
  network: string;
}

interface State {
  files: OpenVPNFiles;
  blocks: Map<string, string>;
  skipped: Set<string>;
  endpoint: Record<string, unknown>;
  tls: Record<string, unknown>;
  remotes: Remote[];
  network: string;
  port: string;
  staticKey: string;
  staticDirection: string;
  keyDirection: string;
  wrap: Record<string, unknown> | null;
  wrapDirection: string;
  cipher: string;
  dataCiphers: string[] | null;
  fallback: string;
  remoteCertTls: string;
  nsCertType: string;
  login: Directive | null;
  addresses: string[];
  peerAddress: string;
  peerAddress6: string;
}

// The content a directive names: its own inline block, a block of the same name
// elsewhere in the profile, or a file handed over with it.
function material(
  state: State,
  directive: Directive,
  kind: OpenVPNMaterialKind,
) {
  let content = directive.inline;
  if (content == null) {
    const reference = directive.args[0];
    if (!reference || isInlineReference(reference)) {
      content = state.blocks.get(directive.name);
      if (content == null) {
        fail(_('The profile names no content for %s').format(directive.name));
      }
    } else {
      content = state.files[basename(reference)];
      if (content == null) {
        fail(
          _(
            'The profile refers to the file %s. Select it together with the profile',
          ).format(basename(reference)),
        );
      }
    }
  }
  const check = checkOpenVPNMaterial(kind, content.trim());
  if (!check.valid) fail(`${directive.name}: ${check.message}`);
  return content.trim();
}

// A direction written after the file name of tls-auth or secret, as in
// "tls-auth ta.key 1"; an inline block takes key-direction instead.
function inlineDirection(directive: Directive) {
  const value = directive.args[1];
  return directive.inline == null && value != null ? value : '';
}

function addRemote(state: State, directive: Directive, network: string) {
  const [server, remotePort, proto] = directive.args;
  if (!server) fail(_('remote names no server'));
  if (remotePort != null) port(remotePort, 'remote');
  state.remotes.push({
    server,
    port: remotePort || '',
    network: proto ? transport(proto, 'remote') : network,
  });
}

function readConnection(state: State, directive: Directive) {
  const before = state.remotes.length;
  let network = '';
  let connectionPort = '';
  for (const child of directive.children || []) {
    if (child.name === 'proto') network = transport(child.args[0], 'proto');
    else if (child.name === 'port' || child.name === 'rport') {
      port(child.args[0], child.name);
      connectionPort = child.args[0];
    } else if (child.name === 'remote') addRemote(state, child, '');
  }
  state.remotes.slice(before).forEach((remote) => {
    remote.port ||= connectionPort;
    remote.network ||= network;
  });
}

function readCompression(state: State, directive: Directive) {
  const { endpoint } = state;
  delete endpoint.compression;
  delete endpoint.compression_lzo;
  if (directive.name === 'comp-lzo') {
    const mode = `${directive.args[0] || 'adaptive'}`.toLowerCase();
    if (!['yes', 'no', 'adaptive'].includes(mode)) {
      fail(_('comp-lzo has an unsupported mode %s').format(directive.args[0]));
    }
    endpoint.compression_lzo = mode;
    return;
  }
  const algorithm = `${directive.args[0] || 'stub'}`.toLowerCase();
  if (algorithm === 'lzo') endpoint.compression_lzo = 'yes';
  else if (['lz4', 'lz4-v2', 'stub', 'stub-v2'].includes(algorithm)) {
    endpoint.compression = algorithm;
  } else if (algorithm !== 'migrate') {
    fail(
      _('compress has an unsupported algorithm %s').format(directive.args[0]),
    );
  }
}

function readDirective(state: State, directive: Directive) {
  const { name, args } = directive;
  const { endpoint, tls } = state;
  if (IGNORED.has(name)) return;
  if (SKIPPED.has(name)) {
    state.skipped.add(name);
    return;
  }
  if (SERVER_DIRECTIVES.has(name)) {
    fail(_('This is a server configuration, not a client profile'));
  }
  if (OS_KEY_DIRECTIVES.has(name)) {
    fail(
      _(
        'The key of this profile is kept by the operating system or a token and cannot be exported to the router',
      ),
    );
  }
  switch (name) {
    case 'dev':
      if (/^tap/i.test(args[0] || '')) {
        fail(
          _(
            'The profile uses a TAP (layer 2) device. Only TUN profiles are supported',
          ),
        );
      }
      return;
    case 'proto':
      state.network = transport(args[0], name);
      return;
    case 'port':
    case 'rport':
      port(args[0], name);
      state.port = args[0];
      return;
    case 'remote':
      addRemote(state, directive, '');
      return;
    case 'connection':
      readConnection(state, directive);
      return;
    case 'remote-random':
      endpoint.remote_random = true;
      return;
    case 'ca':
      tls.certificate = lines(material(state, directive, 'ca'));
      return;
    case 'cert':
      tls.client_certificate = lines(material(state, directive, 'certificate'));
      return;
    case 'extra-certs':
      tls.extra_certificates = lines(material(state, directive, 'certificate'));
      return;
    case 'key':
      tls.client_key = lines(material(state, directive, 'key'));
      return;
    case 'pkcs12':
      fail(
        _(
          'The profile keeps its certificate in a PKCS#12 bundle. Export the certificate and the key as PEM files',
        ),
      );
      return;
    case 'askpass':
      fail(
        _(
          'The key is protected by a passphrase. Remove it first: openssl pkey -in key.pem -out key-plain.pem',
        ),
      );
      return;
    case 'tls-auth':
      state.wrap = {
        type: 'tls_auth',
        key: lines(material(state, directive, 'static')),
      };
      state.wrapDirection = inlineDirection(directive);
      return;
    case 'tls-crypt':
      state.wrap = {
        type: 'tls_crypt',
        key: lines(material(state, directive, 'static')),
      };
      return;
    case 'tls-crypt-v2':
      state.wrap = {
        type: 'tls_crypt_v2',
        key: lines(material(state, directive, 'crypt-v2')),
      };
      return;
    case 'secret':
      state.staticKey = material(state, directive, 'static');
      state.staticDirection = inlineDirection(directive);
      return;
    case 'key-direction':
      state.keyDirection = args[0] || '';
      return;
    case 'auth-user-pass':
      state.login = directive;
      return;
    case 'verify-x509-name': {
      if (!args[0]) fail(_('verify-x509-name names no certificate name'));
      const type = `${args[1] || 'subject'}`.toLowerCase();
      if (!['subject', 'name', 'name-prefix'].includes(type)) {
        fail(_('verify-x509-name has an unsupported type %s').format(args[1]));
      }
      tls.server_name = args[0];
      tls.server_name_type = type;
      return;
    }
    case 'remote-cert-tls':
      state.remoteCertTls = `${args[0] || ''}`.toLowerCase();
      return;
    case 'remote-cert-eku':
      // The name OpenSSL prints, its short form and its OID all mean the check
      // remote-cert-tls server makes.
      if (
        /^(TLS Web Server Authentication|serverAuth|1\.3\.6\.1\.5\.5\.7\.3\.1)$/i.test(
          args.join(' '),
        )
      ) {
        state.remoteCertTls = 'server';
      } else {
        state.skipped.add(name);
      }
      return;
    case 'ns-cert-type':
      state.nsCertType = `${args[0] || ''}`.toLowerCase();
      return;
    case 'peer-fingerprint': {
      const fingerprints = `${directive.inline ?? args.join(' ')}`
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map((value) => value.replace(/:/g, '').toLowerCase());
      if (
        !fingerprints.length ||
        fingerprints.some((value) => !/^[0-9a-f]{64}$/.test(value))
      ) {
        fail(_('peer-fingerprint needs SHA-256 fingerprints'));
      }
      tls.peer_fingerprint = fingerprints;
      return;
    }
    case 'tls-version-min':
      tls.version_min = args[0];
      return;
    case 'tls-cert-profile':
      tls.certificate_profile = `${args[0] || ''}`.toLowerCase();
      return;
    case 'tls-cipher':
      tls.cipher = args[0];
      return;
    case 'cipher':
      state.cipher = cipherName(args[0]);
      return;
    case 'data-ciphers':
    case 'ncp-ciphers':
      state.dataCiphers = `${args[0] || ''}`
        .split(':')
        .filter(Boolean)
        .map(cipherName);
      return;
    case 'data-ciphers-fallback':
      state.fallback = cipherName(args[0]);
      return;
    case 'auth':
      endpoint.auth = digestName(args[0]);
      return;
    case 'comp-lzo':
    case 'compress':
      readCompression(state, directive);
      return;
    case 'allow-compression':
      endpoint.allow_compression = `${args[0] || ''}`.toLowerCase();
      return;
    case 'tun-mtu':
      endpoint.mtu = number(args[0], name);
      return;
    case 'fragment':
      endpoint.fragment = number(args[0], name);
      return;
    case 'mssfix':
      if (args[0] != null) {
        const value = number(args[0], name);
        if (value === 0) endpoint.mss_fix_disabled = true;
        else endpoint.mss_fix = value;
      }
      return;
    case 'ping':
      endpoint.ping_interval = number(args[0], name);
      return;
    case 'ping-restart':
      endpoint.ping_restart = number(args[0], name);
      return;
    case 'keepalive':
      endpoint.ping_interval = number(args[0], name);
      endpoint.ping_restart = number(args[1], name);
      return;
    case 'reneg-sec':
      endpoint.renegotiate_interval = number(args[0], name);
      return;
    case 'ifconfig': {
      const length = netmaskLength(args[1]);
      if (!args[0] || !args[1]) fail(_('ifconfig needs two addresses'));
      if (length >= 0 && length < 31) {
        state.addresses.push(`${args[0]}/${length}`);
      } else {
        state.addresses.push(`${args[0]}/32`);
        state.peerAddress = args[1];
      }
      return;
    }
    case 'ifconfig-ipv6':
      if (!args[0]) fail(_('ifconfig-ipv6 needs an address'));
      state.addresses.push(args[0].includes('/') ? args[0] : `${args[0]}/128`);
      state.peerAddress6 = args[1] || '';
      return;
    default:
      state.skipped.add(name);
      return;
  }
}

function seconds(value: unknown) {
  return `${value}s`;
}

function finishServers(state: State) {
  const { endpoint } = state;
  const networks = state.remotes.map(
    (remote) => remote.network || state.network,
  );
  endpoint.network = networks[0];
  const servers = state.remotes.map((remote, index) => {
    const entry: Record<string, unknown> = {
      server: remote.server,
      server_port: port(remote.port || state.port, 'remote'),
    };
    if (networks[index] !== networks[0]) entry.network = networks[index];
    return entry;
  });
  if (servers.length === 1) Object.assign(endpoint, servers[0]);
  else endpoint.servers = servers;
  if (networks[0] === 'tcp') delete endpoint.fragment;
}

function finishTimers(state: State) {
  const { endpoint } = state;
  if (endpoint.ping_interval != null) {
    endpoint.ping_interval = seconds(endpoint.ping_interval);
  }
  if (endpoint.ping_restart === 0) {
    delete endpoint.ping_restart;
    endpoint.ping_restart_disabled = true;
  } else if (endpoint.ping_restart != null) {
    endpoint.ping_restart = seconds(endpoint.ping_restart);
  }
  if (endpoint.renegotiate_interval === 0) {
    delete endpoint.renegotiate_interval;
    endpoint.renegotiate_disabled = true;
  } else if (endpoint.renegotiate_interval != null) {
    endpoint.renegotiate_interval = seconds(endpoint.renegotiate_interval);
  }
}

function keyDirectionName(value: string) {
  return value === '0' ? 'server' : value === '1' ? 'client' : '';
}

function finishStaticKey(state: State) {
  const { endpoint } = state;
  endpoint.mode = 'static_key';
  endpoint.static_key = lines(state.staticKey);
  const direction = keyDirectionName(
    state.staticDirection || state.keyDirection,
  );
  if (direction) endpoint.key_direction = direction;
  endpoint.cipher = state.cipher || 'BF-CBC';
  if (/-(GCM|POLY1305)$/.test(`${endpoint.cipher}`)) {
    fail(_('A static key profile needs a CBC cipher'));
  }
  if (!state.addresses.length) {
    fail(_('A static key profile needs its tunnel addresses (ifconfig)'));
  }
  endpoint.address = state.addresses;
  if (state.peerAddress) endpoint.peer_address = state.peerAddress;
  if (state.peerAddress6) endpoint.peer_address_ipv6 = state.peerAddress6;
  for (const key of [
    'compression',
    'compression_lzo',
    'allow_compression',
    'renegotiate_interval',
    'renegotiate_disabled',
  ]) {
    delete endpoint[key];
  }
}

function finishTls(state: State) {
  const { endpoint, tls } = state;
  if (!tls.certificate && !tls.peer_fingerprint) {
    fail(_('The profile has no CA certificate (ca) to check the server by'));
  }
  if (!tls.client_certificate !== !tls.client_key) {
    fail(
      tls.client_certificate
        ? _('The profile has a client certificate but no key for it')
        : _('The profile has a client key but no certificate for it'),
    );
  }
  if (tls.extra_certificates) {
    tls.client_certificate = [
      ...((tls.client_certificate as string[]) || []),
      ...(tls.extra_certificates as string[]),
    ];
    delete tls.extra_certificates;
  }
  if (state.wrap) {
    if (state.wrap.type === 'tls_auth') {
      const direction = keyDirectionName(
        state.wrapDirection || state.keyDirection,
      );
      if (direction) state.wrap.direction = direction;
    }
    tls.control_wrap = state.wrap;
  }
  // OpenVPN checks what the server certificate was issued for only when asked
  // to; the core checks it unless told not to.
  if (state.remoteCertTls !== 'server') {
    tls.remote_certificate_tls = 'none';
    if (state.nsCertType === 'server') tls.ns_certificate_type = 'server';
  }
  endpoint.tls = tls;

  // OpenVPN 2.5 and later negotiate from data-ciphers, add a cipher that is
  // not there, and fall back to it for a server that cannot negotiate.
  const fallback = state.fallback || state.cipher;
  const ciphers = state.dataCiphers || OPENVPN_DEFAULT_DATA_CIPHERS;
  if (state.cipher && !ciphers.includes(state.cipher)) {
    endpoint.data_ciphers = [...ciphers, state.cipher];
  } else if (state.dataCiphers) {
    endpoint.data_ciphers = state.dataCiphers;
  }
  if (fallback) endpoint.data_ciphers_fallback = fallback;

  // A server that compresses what it sends has to be let: the core accepts only
  // the framing of compression unless told otherwise.
  if (
    !endpoint.allow_compression &&
    (['yes', 'adaptive'].includes(`${endpoint.compression_lzo}`) ||
      ['lz4', 'lz4-v2'].includes(`${endpoint.compression}`))
  ) {
    endpoint.allow_compression = 'asym';
  }

  const login = state.login;
  if (login) {
    const reference = login.args[0];
    const content =
      login.inline ??
      (reference && !isInlineReference(reference)
        ? state.files[basename(reference)]
        : state.blocks.get('auth-user-pass'));
    const [username = '', password = ''] = `${content || ''}`.split(/\r?\n/);
    if (username) endpoint.username = username;
    if (password) endpoint.password = password;
  }
}

function buildEndpoint(input: string, files: OpenVPNFiles) {
  const directives = readDirectives(`${input || ''}`.split(/\r?\n/));
  const state: State = {
    files: Object.fromEntries(
      Object.entries(files).map(([name, content]) => [basename(name), content]),
    ),
    blocks: new Map(
      directives
        .filter((directive) => directive.inline != null)
        .map((directive) => [directive.name, directive.inline!]),
    ),
    skipped: new Set(),
    endpoint: { type: 'openvpn-client' },
    tls: {},
    remotes: [],
    network: 'udp',
    port: `${OPENVPN_DEFAULT_PORT}`,
    staticKey: '',
    staticDirection: '',
    keyDirection: '',
    wrap: null,
    wrapDirection: '',
    cipher: '',
    dataCiphers: null,
    fallback: '',
    remoteCertTls: '',
    nsCertType: '',
    login: null,
    addresses: [],
    peerAddress: '',
    peerAddress6: '',
  };

  directives.forEach((directive) => readDirective(state, directive));

  if (!state.remotes.length) {
    fail(
      looksLikeOpenVPNConfig(input)
        ? _('The profile names no server: it has no remote directive')
        : _('This is not an OpenVPN profile'),
    );
  }
  finishServers(state);
  finishTimers(state);
  if (state.staticKey) finishStaticKey(state);
  else finishTls(state);

  return {
    endpoint: state.endpoint,
    login: !state.staticKey && !!state.login,
    skipped: [...state.skipped].sort(),
  };
}

export function parseOpenVPNConfig(
  input: string,
  files: OpenVPNFiles = {},
): OpenVPNImportResult {
  try {
    return { valid: true, ...buildEndpoint(input, files) };
  } catch (error) {
    if (error instanceof ImportError) {
      return { valid: false, message: error.message };
    }
    throw error;
  }
}
