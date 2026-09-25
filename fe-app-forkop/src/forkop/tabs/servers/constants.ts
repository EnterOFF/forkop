export const STYLE_ID = 'forkop-server-styles';

export const DEFAULT_PROTOCOL = 'mixed';

export const CLIENT_TYPE = 'server_client';

export const CLIENT_OWNER_OPTION = 'server';

export const MAX_CLIENT_NAME_LENGTH = 64;

// Servers created in this page load whose dialog has not been saved yet.
export const addedServers = new Set();

// Ports Forkop's own sing-box instance binds. A server that takes one of them stops
// the whole service instead of only failing itself.
export const RESERVED_PORTS = [
  ['53', _('Forkop DNS')],
  ['1602', _('Forkop transparent proxy')],
  ['1603', _('Forkop transparent proxy')],
  ['1604', _('Forkop transparent proxy')],
  ['1605', _('Forkop transparent proxy')],
  ['4534', _('Forkop service proxy')],
  ['9090', _('sing-box Clash API')],
];

// Sites the SNI and Reality pickers draw from: reachable worldwide, TLS 1.3 with
// X25519 and HTTP/2, and not behind a CDN that rewrites the handshake.
export const CAMOUFLAGE_SITES = [
  'www.microsoft.com',
  'www.apple.com',
  'swdist.apple.com',
  'www.samsung.com',
  'www.nvidia.com',
  'www.amd.com',
  'www.tesla.com',
  'dl.google.com',
  'www.bing.com',
  'www.wolframalpha.com',
];

// The ciphers a Shadowsocks listener offers, best first. The 2022 methods take a
// base64 key of an exact length; the older AEAD methods derive their key from any
// password. The default matches what the panels hand out today.
export const SHADOWSOCKS_METHODS = [
  { id: '2022-blake3-aes-256-gcm', keyBytes: 32 },
  { id: '2022-blake3-aes-128-gcm', keyBytes: 16 },
  { id: '2022-blake3-chacha20-poly1305', keyBytes: 32 },
  { id: 'aes-256-gcm', keyBytes: 0 },
  { id: 'aes-128-gcm', keyBytes: 0 },
  { id: 'chacha20-ietf-poly1305', keyBytes: 0 },
];

export const TRANSPORTS = [
  ['tcp', 'TCP'],
  ['ws', 'WebSocket'],
  ['grpc', 'gRPC'],
  ['http', 'HTTP'],
  ['httpupgrade', 'HTTPUpgrade'],
  ['xhttp', 'XHTTP'],
];

// Listeners that leave the negotiated protocol to the configuration. The rest pin
// it themselves, so the field would only be a way to break them.
export const ALPN_PROTOCOLS = ['vless', 'vmess', 'trojan', 'anytls'];

export const CLIENT_FINGERPRINTS = [
  'chrome',
  'firefox',
  'edge',
  'safari',
  'ios',
  'android',
  'random',
];

// Inbound types the raw JSON field accepts, taken from the inbound registry the
// Forkop core builds (include/registry.go). These are the names the core knows,
// not the names this tab uses: the Telegram proxy is registered as mtproxy.
export const JSON_INBOUND_TYPES = new Set([
  'tun',
  'redirect',
  'tproxy',
  'direct',
  'socks',
  'http',
  'mixed',
  'shadowsocks',
  'vmess',
  'trojan',
  'naive',
  'shadowtls',
  'vless',
  'anytls',
  'mieru',
  'ssh',
  'bond',
  'failover',
  'trusttunnel',
  'hysteria',
  'tuic',
  'hysteria2',
  'mtproxy',
  'sudoku',
  'snell',
  'call',
  'cloudflared',
]);

// Forkop generates into its own directory, so a path there is a certificate it
// issued and a client has to be told to accept it. A path anywhere else is the
// user's own certificate and is assumed to be trusted.
export const SERVER_CERT_DIR = '/etc/forkop/server-certs/';

export const CLIENT_KEYS = [
  'name',
  'uuid',
  'password',
  'secret',
  'flow',
  'authorized_keys',
  'routing_override',
  'routing_mode',
  'routing_section',
];

// The same modes the server has. Rules costs a clone of the shared rule set for
// that account, but only when the server itself does not already clone it.
export const CLIENT_ROUTING_MODES = [
  ['rules', _('Rules')],
  ['direct', _('Direct')],
  ['section', _('Section')],
];

// A client list problem has no input of its own to mark, so the message goes under
// the field the way LuCI reports an invalid value, and never into a dialog banner.
// Credentials the protocol no longer uses are dropped when the protocol changes: a
// stale password would keep showing up in diagnostics and in the config signature.
export const CLIENT_ROUTING_KEYS = [
  'routing_override',
  'routing_mode',
  'routing_section',
];
