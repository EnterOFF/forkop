"use strict";
"require form";
"require baseclass";
"require dom";
"require fs";
"require rpc";
"require uci";
"require ui";
"require view.forkop.main as main";
"require view.forkop.section as sectionui";

// The Servers tab: one sing-box inbound per UCI section, plus the accounts that may
// use it. Everything the tab needs lives here - the protocol table the form is built
// from, the value checks, the share links, the connection dialog and the client list.
// The client list reuses the shared child item widget from the Sections tab so both
// tabs edit child sections the same way.

const UCI_PACKAGE = main.FORKOP_UCI_PACKAGE;
const STYLE_ID = "forkop-server-styles";
const DEFAULT_PROTOCOL = "mixed";
const CLIENT_TYPE = "server_client";
const CLIENT_OWNER_OPTION = "server";
const MAX_CLIENT_NAME_LENGTH = 64;

// Servers created in this page load whose dialog has not been saved yet.
const addedServers = new Set();

// A section id stays in the config for good, so it names the type it belongs to.
// LuCI's createSID() is not that name: its "new" prefix marks a section the browser
// has not saved yet, and handing it to add() as an explicit name writes that marker
// to /etc/config/forkop forever. Every section gets an id, including the children
// nothing points at, because an anonymous one can only be addressed as @type[index]:
// libuci numbers those by position across the whole file, so the address of a client
// moves when a client of another server is removed and a stored command then edits
// the wrong section. The suffix is random rather than the lowest free number, because
// a number given back after a delete would quietly rebind a stale pointer:
// dns_detour_section and the other section references are not cleared when their
// target is removed. Each view that creates a section carries this helper, because a
// name imported across two views is undefined in a browser that cached one of them
// before an app upgrade.
const SECTION_ID_PREFIXES = {
  fallback_group: "group",
  fallback_level: "level",
  section: "section",
  section_interface: "iface",
  server: "server",
  server_client: "client",
  subscription_url: "sub",
  tunnel: "tunnel",
  tunnel_peer: "peer",
  urltest: "urltest",
};
const issuedSectionIds = new Set();

function nextSectionId(typeName) {
  const prefix = SECTION_ID_PREFIXES[typeName] || typeName;

  for (let i = 0; i < 100; i += 1) {
    const id = `${prefix}_${Math.floor(Math.random() * 0x1000000)
      .toString(16)
      .padStart(6, "0")}`;

    // A staged child reaches uci only when its parent is saved, so an id handed out
    // earlier in the same dialog is not visible through uci.get() yet.
    if (!issuedSectionIds.has(id) && !uci.get(UCI_PACKAGE, id)) {
      issuedSectionIds.add(id);
      return id;
    }
  }

  return `${prefix}_${Date.now().toString(16)}`;
}

const ROUTING_SECTION_ACTIONS = [
  "connection",
  "proxy",
  "outbound",
  "vpn",
  "byedpi",
  "zapret",
  "zapret2",
];
const TAILSCALE_DETOUR_ACTIONS = ["connection", "proxy", "outbound", "vpn"];

// Tags sing-box already uses for Forkop's own inbounds, outbounds and DNS servers.
// A server name becomes an inbound tag verbatim, so these names are refused.
//
// The Sections tab keeps the same list rather than this one importing it. A browser
// caches every view module on its own, so an upgrade can leave an old section.js next
// to a new server.js, and a name imported across the two would be undefined there -
// which takes out the validator, and with it the Save button. The contract test holds
// both copies against singbox/constants.uc instead.
const RESERVED_RUNTIME_TAGS = new Set([
  "dns-server",
  "fakeip-server",
  "bootstrap-dns-server",
  "dnsmasq-server",
  "hosts-server",
  "fakeip-dns-rule-tag",
  "fakeip-ruleset-dns-rule-tag",
  "service-fakeip-dns-rule-tag",
  "tproxy-in",
  "tproxy6-in",
  "dns-in",
  "source-dns-in",
  "system-in",
  "system6-in",
  "system-dns-in",
  "service-mixed-in",
  "direct-out",
]);

// Ports Forkop's own sing-box instance binds. A server that takes one of them stops
// the whole service instead of only failing itself.
const RESERVED_PORTS = [
  ["53", _("Forkop DNS")],
  ["1602", _("Forkop transparent proxy")],
  ["1603", _("Forkop transparent proxy")],
  ["1604", _("Forkop transparent proxy")],
  ["1605", _("Forkop transparent proxy")],
  ["4534", _("Forkop service proxy")],
  ["9090", _("sing-box Clash API")],
];

// Sites the SNI and Reality pickers draw from: reachable worldwide, TLS 1.3 with
// X25519 and HTTP/2, and not behind a CDN that rewrites the handshake.
const CAMOUFLAGE_SITES = [
  "www.microsoft.com",
  "www.apple.com",
  "swdist.apple.com",
  "www.samsung.com",
  "www.nvidia.com",
  "www.amd.com",
  "www.tesla.com",
  "dl.google.com",
  "www.bing.com",
  "www.wolframalpha.com",
];

// The ciphers a Shadowsocks listener offers, best first. The 2022 methods take a
// base64 key of an exact length; the older AEAD methods derive their key from any
// password. The default matches what the panels hand out today.
const SHADOWSOCKS_METHODS = [
  { id: "2022-blake3-aes-256-gcm", keyBytes: 32 },
  { id: "2022-blake3-aes-128-gcm", keyBytes: 16 },
  { id: "2022-blake3-chacha20-poly1305", keyBytes: 32 },
  { id: "aes-256-gcm", keyBytes: 0 },
  { id: "aes-128-gcm", keyBytes: 0 },
  { id: "chacha20-ietf-poly1305", keyBytes: 0 },
];

const TRANSPORTS = [
  ["tcp", "TCP"],
  ["ws", "WebSocket"],
  ["grpc", "gRPC"],
  ["http", "HTTP"],
  ["httpupgrade", "HTTPUpgrade"],
  ["xhttp", "XHTTP"],
];

// Listeners that leave the negotiated protocol to the configuration. The rest pin
// it themselves, so the field would only be a way to break them.
const ALPN_PROTOCOLS = ["vless", "vmess", "trojan", "anytls"];

const CLIENT_FINGERPRINTS = [
  "chrome",
  "firefox",
  "edge",
  "safari",
  "ios",
  "android",
  "random",
];

// Inbound types the raw JSON field accepts, taken from the inbound registry the
// Forkop core builds (include/registry.go). These are the names the core knows,
// not the names this tab uses: the Telegram proxy is registered as mtproxy.
const JSON_INBOUND_TYPES = new Set([
  "tun",
  "redirect",
  "tproxy",
  "direct",
  "socks",
  "http",
  "mixed",
  "shadowsocks",
  "vmess",
  "trojan",
  "naive",
  "shadowtls",
  "vless",
  "anytls",
  "mieru",
  "ssh",
  "bond",
  "failover",
  "trusttunnel",
  "hysteria",
  "tuic",
  "hysteria2",
  "mtproxy",
  "sudoku",
  "snell",
  "call",
]);

// One entry per protocol the tab can serve.
//   kind      - inbound: a sing-box inbound built from the form
//               endpoint: a sing-box endpoint (Tailscale)
//               json: a raw inbound object written by hand
//   securities- the security modes the protocol accepts, best first
//   credentials- the per client fields the protocol needs
//   login     - the client name is the account name sent on the wire, so it has to
//               stay inside the ASCII subset clients and URIs can carry
//   link      - the share link scheme, empty when the protocol has no URI format
//   tcp       - the listener carries TCP, so TCP Fast Open applies
const PROTOCOLS = [
  {
    id: "mixed",
    label: "Mixed",
    kind: "inbound",
    securities: ["none"],
    tcp: true,
    login: true,
    optionalAuth: "mixed_auth_enabled",
    credentials: ["password"],
    link: "socks5",
  },
  {
    id: "tailscale",
    label: "Tailscale",
    kind: "endpoint",
    securities: ["none"],
    credentials: [],
  },
  {
    id: "vless",
    label: "VLESS",
    kind: "inbound",
    securities: ["reality", "tls", "none"],
    transport: true,
    multiplex: true,
    tcp: true,
    credentials: ["uuid", "flow"],
    link: "vless",
  },
  {
    id: "vmess",
    label: "VMess",
    kind: "inbound",
    securities: ["tls", "none"],
    transport: true,
    multiplex: true,
    tcp: true,
    credentials: ["uuid"],
    link: "vmess",
  },
  {
    id: "trojan",
    label: "Trojan",
    kind: "inbound",
    securities: ["tls", "none"],
    transport: true,
    multiplex: true,
    tcp: true,
    credentials: ["password"],
    link: "trojan",
  },
  {
    id: "shadowsocks",
    label: "Shadowsocks",
    kind: "inbound",
    securities: ["none"],
    multiplex: true,
    tcp: true,
    credentials: ["password"],
    link: "ss",
  },
  {
    id: "hysteria2",
    label: "Hysteria2",
    kind: "inbound",
    securities: ["tls"],
    credentials: ["password"],
    link: "hysteria2",
  },
  {
    id: "tuic",
    label: "TUIC",
    kind: "inbound",
    securities: ["tls"],
    credentials: ["uuid", "password"],
    link: "tuic",
  },
  {
    id: "anytls",
    label: "AnyTLS",
    kind: "inbound",
    securities: ["tls"],
    tcp: true,
    credentials: ["password"],
    link: "anytls",
  },
  {
    id: "naive",
    label: "NaiveProxy",
    kind: "inbound",
    securities: ["tls"],
    tcp: true,
    login: true,
    credentials: ["password"],
    link: "naive",
  },
  {
    id: "ssh",
    label: "SSH",
    kind: "inbound",
    securities: ["none"],
    tcp: true,
    login: true,
    credentials: ["password", "authorized_keys"],
  },
  {
    id: "mieru",
    label: "Mieru",
    kind: "inbound",
    securities: ["none"],
    tcp: true,
    login: true,
    credentials: ["password"],
    link: "mierus",
  },
  {
    id: "mtproto",
    label: "MTProto",
    kind: "inbound",
    securities: ["none"],
    tcp: true,
    credentials: ["secret"],
    link: "mtproto",
  },
  {
    id: "json_inbound",
    label: _("JSON inbound"),
    kind: "json",
    securities: ["none"],
    credentials: [],
  },
];

const PROTOCOL_BY_ID = new Map(PROTOCOLS.map((entry) => [entry.id, entry]));

/* ------------------------------------------------------------------ helpers */

function asList(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value.filter(Boolean) : [`${value}`];
}

function option(sectionId, name) {
  return uci.get(UCI_PACKAGE, sectionId, name) || "";
}

function optionList(sectionId, name) {
  return asList(uci.get(UCI_PACKAGE, sectionId, name));
}

function protocolSpec(protocol) {
  return PROTOCOL_BY_ID.get(`${protocol || ""}`) || null;
}

// While the dialog is open a changed value is not stored yet, so the widget wins.
// Every field that depends on the protocol, on the cipher or on the authentication
// switch has to follow the selection immediately instead of after a save.
// The widget of an option, found the way LuCI finds it itself: by the id of the
// frame it renders, which every widget carries. The inner control is only named
// widget.<cbid> by some of them - a checkbox puts that in data-widget-id and gives
// its input a random id - so looking for the control found nothing for a flag and
// every reader silently fell back to the stored value. The open dialog is searched
// first, because the table behind it renders the editable columns under the same
// ids.
function widgetNode(sectionId, name) {
  const id = `cbid.${UCI_PACKAGE}.${sectionId}.${name}`;
  const modal = document.querySelector("#modal_overlay > .modal");

  return (
    (modal && modal.querySelector(`[id="${id}"]`)) ||
    document.getElementById(id)
  );
}

function liveElement(sectionId, name) {
  const node = widgetNode(sectionId, name);
  const element = node ? dom.findClassInstance(node) : null;

  return element && typeof element.getValue === "function" ? element : null;
}

function liveOption(sectionId, name) {
  const element = liveElement(sectionId, name);

  if (!element) {
    return option(sectionId, name);
  }

  const value = element.getValue();
  return value == null ? "" : `${value}`;
}

function getProtocol(sectionId) {
  return liveOption(sectionId, "protocol") || DEFAULT_PROTOCOL;
}

function protocolLabel(protocol) {
  const spec = protocolSpec(protocol);
  return spec ? spec.label : `${protocol || ""}`;
}

function protocolsWhere(predicate) {
  return PROTOCOLS.filter(predicate).map((entry) => entry.id);
}

function protocolsWith(flag) {
  return protocolsWhere((entry) => !!entry[flag]);
}

function listenerProtocols() {
  return protocolsWhere((entry) => entry.kind === "inbound");
}

function hasListener(protocol) {
  const spec = protocolSpec(protocol);
  return !!spec && spec.kind === "inbound";
}

function credentialFields(protocol) {
  const spec = protocolSpec(protocol);
  return spec ? (spec.credentials || []).slice() : [];
}

function usesClients(protocol) {
  return credentialFields(protocol).length > 0;
}

function usesLoginName(protocol) {
  const spec = protocolSpec(protocol);
  return !!spec && !!spec.login;
}

function linkScheme(protocol) {
  const spec = protocolSpec(protocol);
  return spec && spec.link ? spec.link : "";
}

function securitiesFor(protocol) {
  const spec = protocolSpec(protocol);
  return spec ? spec.securities.slice() : ["none"];
}

function defaultSecurity(protocol) {
  return securitiesFor(protocol)[0];
}

function securityLabel(security) {
  if (security === "reality") {
    return "Reality";
  }
  if (security === "tls") {
    return "TLS";
  }
  return _("None");
}

// The security a server actually runs with: a stored mode the protocol no longer
// offers falls back to its first choice instead of generating a configuration
// sing-box refuses.
function getEffectiveSecurity(sectionId) {
  const allowed = securitiesFor(getProtocol(sectionId));
  const security = liveOption(sectionId, "security");

  return allowed.includes(security) ? security : allowed[0];
}

function authFlagOption(protocol) {
  const spec = protocolSpec(protocol);
  return spec && spec.optionalAuth ? spec.optionalAuth : "";
}

function isAuthenticationEnabled(sectionId) {
  const flag = authFlagOption(getProtocol(sectionId));
  if (!flag) {
    return true;
  }

  const value = liveOption(sectionId, flag);
  return value === ""
    ? true
    : !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function getServerName(sectionId) {
  return option(sectionId, "label") || sectionId;
}

// XTLS Vision splices the payload inside the TLS record the listener already owns,
// so it needs the raw TLS stream: a transport wraps it, and a multiplexed client
// drops the flow on its own, after which the listener refuses the account with a
// flow mismatch. Offering it outside those bounds only produces accounts that
// cannot connect.
function supportsVisionFlow(sectionId) {
  if (getProtocol(sectionId) !== "vless") {
    return false;
  }
  if ((liveOption(sectionId, "transport") || "tcp") !== "tcp") {
    return false;
  }
  if (liveOption(sectionId, "multiplex_enabled") === "1") {
    return false;
  }

  return getEffectiveSecurity(sectionId) !== "none";
}

function shadowsocksKeyBytes(method) {
  const entry = SHADOWSOCKS_METHODS.find((item) => item.id === method);
  return entry ? entry.keyBytes : 0;
}

function isShadowsocks2022(method) {
  return shadowsocksKeyBytes(method) > 0;
}

function getShadowsocksMethod(sectionId) {
  return (
    liveOption(sectionId, "shadowsocks_method") || SHADOWSOCKS_METHODS[0].id
  );
}

// Forkop generates into its own directory, so a path there is a certificate it
// issued and a client has to be told to accept it. A path anywhere else is the
// user's own certificate and is assumed to be trusted.
const SERVER_CERT_DIR = "/etc/forkop/server-certs/";

function isForkopCertificatePath(path) {
  return `${path || ""}`.startsWith(SERVER_CERT_DIR);
}

/* ------------------------------------------------------------ host handling */

function normalizeHost(host) {
  return `${host || ""}`.trim().replace(/^\[|\]$/g, "");
}

function isIpv4(value) {
  return /^(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])){3}$/.test(
    value,
  );
}

function isIpv6(value) {
  const normalized = normalizeHost(value);
  if (!normalized.includes(":")) {
    return false;
  }

  try {
    new URL(`http://[${normalized}]/`);
    return true;
  } catch (_error) {
    return false;
  }
}

function isHostname(value) {
  const hostname = normalizeHost(value);
  if (hostname.length < 1 || hostname.length > 253 || hostname.endsWith(".")) {
    return false;
  }

  return hostname
    .split(".")
    .every((part) =>
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(part),
    );
}

function isHost(value) {
  const host = normalizeHost(value);
  return isIpv4(host) || isIpv6(host) || isHostname(host);
}

function formatHostForUri(host) {
  const normalized = normalizeHost(host);
  return isIpv6(normalized) ? `[${normalized}]` : normalized;
}

function getBrowserHost() {
  return normalizeHost(window.location.hostname || "");
}

function isPrivateOrReservedIpv4(value) {
  if (!isIpv4(value)) {
    return true;
  }

  const [a, b] = value.split(".").map((part) => parseInt(part, 10));

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 2) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
}

function isPrivateOrReservedIp(value) {
  const normalized = normalizeHost(value).toLowerCase();
  if (isIpv4(normalized)) {
    return isPrivateOrReservedIpv4(normalized);
  }
  if (!isIpv6(normalized)) {
    return true;
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fe80") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8")
  );
}

/* ------------------------------------------------------ value transformation */

function randomBytes(length) {
  const bytes = new Uint8Array(length);

  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  return bytes;
}

function bytesToString(bytes) {
  return Array.from(bytes)
    .map((byte) => String.fromCharCode(byte))
    .join("");
}

function randomHex(byteLength) {
  return Array.from(randomBytes(byteLength))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomItem(items) {
  return items[randomBytes(1)[0] % items.length];
}

function stringToHex(value) {
  return Array.from(unescape(encodeURIComponent(`${value || ""}`)))
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
}

// Text, so the string is UTF-8 encoded first: btoa() only takes code points below
// 256 and a label may hold anything.
function base64Encode(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

function base64UrlEncode(value) {
  return toBase64Url(base64Encode(value));
}

// Raw bytes, so they are encoded as they are. Running them through the text path
// would UTF-8 expand every byte above 0x7f and turn a 18 byte secret into a
// password of an unpredictable length.
function base64EncodeBytes(bytes) {
  return btoa(bytesToString(bytes));
}

function toBase64Url(value) {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generateUuid() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }

  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

// 18 bytes, so the base64url form is exactly 24 characters with no padding, and
// every character is safe in a URI userinfo field.
function generatePassword() {
  return toBase64Url(base64EncodeBytes(randomBytes(18)));
}

// Shadowsocks 2022 keys are standard base64 of exactly the byte count the cipher
// takes, so they are generated from the key length instead of a printable password.
function generatePresharedKey(byteLength) {
  return base64EncodeBytes(randomBytes(byteLength));
}

function generateMtprotoSecret() {
  const secret = randomHex(16);
  return secret === "00000000000000000000000000000000"
    ? "11111111111111111111111111111111"
    : secret;
}

function randomPort() {
  const bytes = randomBytes(2);
  return `${20000 + (((bytes[0] << 8) | bytes[1]) % 30000)}`;
}

function normalizeSha256(value) {
  const normalized = `${value || ""}`.trim().replace(/:/g, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : "";
}

function encodeQuery(params) {
  return Object.entries(params)
    .filter(([, value]) => value != null && value !== "")
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(`${value}`)}`,
    )
    .join("&");
}

function normalizeMtprotoBaseSecret(value) {
  const secret = `${value || ""}`.trim().toLowerCase();

  if (/^[0-9a-f]{32}$/.test(secret)) {
    return secret;
  }
  if (/^ee[0-9a-f]{32}(?:[0-9a-f]{2})+$/.test(secret)) {
    return secret.slice(2, 34);
  }

  return "";
}

function buildMtprotoFullSecret(baseSecret, faketls) {
  return `ee${baseSecret}${stringToHex(faketls || "google.com")}`;
}

// The credential a client field expects for the current protocol.
function generateCredential(sectionId, protocol, field) {
  if (field === "uuid") {
    return generateUuid();
  }
  if (field === "secret") {
    return generateMtprotoSecret();
  }
  if (field === "password") {
    const keyBytes =
      protocol === "shadowsocks"
        ? shadowsocksKeyBytes(getShadowsocksMethod(sectionId))
        : 0;
    return keyBytes > 0 ? generatePresharedKey(keyBytes) : generatePassword();
  }
  return "";
}

/* ------------------------------------------------------------- QR encoder */

// Byte mode at error correction level L: one segment, the smallest version that fits
// the link, and mask 0 - the checkerboard - written into the format bits so any
// decoder undoes it. Choosing among the eight masks by penalty score would only make
// a code marginally easier to read, and a link is base64 and URL text, which the
// checkerboard already breaks up.
const QR_EC_CODEWORDS_PER_BLOCK_LOW = [
  -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28,
  28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  30, 30,
];
const QR_NUM_ERROR_CORRECTION_BLOCKS_LOW = [
  -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10,
  12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
];

function qrGetBit(value, index) {
  return ((value >>> index) & 1) !== 0;
}

function qrAppendBits(buffer, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) {
    buffer.push(qrGetBit(value, i));
  }
}

function qrRawDataModules(version) {
  let result = (16 * version + 128) * version + 64;

  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) {
      result -= 36;
    }
  }

  return result;
}

function qrRawCodewords(version) {
  return Math.floor(qrRawDataModules(version) / 8);
}

function qrDataCodewords(version) {
  return (
    qrRawCodewords(version) -
    QR_EC_CODEWORDS_PER_BLOCK_LOW[version] *
      QR_NUM_ERROR_CORRECTION_BLOCKS_LOW[version]
  );
}

function qrEncodeText(text) {
  return Array.from(new TextEncoder().encode(text));
}

function qrBuildDataCodewords(bytes, version) {
  const capacity = qrDataCodewords(version);
  const bits = [];
  const countBits = version <= 9 ? 8 : 16;

  qrAppendBits(bits, 4, 4);
  qrAppendBits(bits, bytes.length, countBits);
  bytes.forEach((value) => qrAppendBits(bits, value, 8));
  qrAppendBits(bits, 0, Math.min(4, capacity * 8 - bits.length));

  while (bits.length % 8 !== 0) {
    bits.push(false);
  }

  const result = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) {
      value = (value << 1) | (bits[i + j] ? 1 : 0);
    }
    result.push(value);
  }

  for (let pad = 0xec; result.length < capacity; pad ^= 0xfd) {
    result.push(pad);
  }

  return result;
}

function qrMultiply(x, y) {
  let z = 0;

  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }

  return z;
}

function qrReedSolomonDivisor(degree) {
  const result = Array(degree).fill(0);
  result[degree - 1] = 1;

  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = qrMultiply(result[j], root);
      if (j + 1 < degree) {
        result[j] ^= result[j + 1];
      }
    }
    root = qrMultiply(root, 2);
  }

  return result;
}

function qrReedSolomonRemainder(data, divisor) {
  const result = Array(divisor.length).fill(0);

  data.forEach((value) => {
    const factor = value ^ result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i += 1) {
      result[i] ^= qrMultiply(divisor[i], factor);
    }
  });

  return result;
}

function qrAddErrorCorrection(data, version) {
  const numBlocks = QR_NUM_ERROR_CORRECTION_BLOCKS_LOW[version];
  const blockEccLen = QR_EC_CODEWORDS_PER_BLOCK_LOW[version];
  const rawCodewords = qrRawCodewords(version);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockDataLen = Math.floor(rawCodewords / numBlocks) - blockEccLen;
  const divisor = qrReedSolomonDivisor(blockEccLen);
  const blocks = [];

  for (let i = 0, offset = 0; i < numBlocks; i += 1) {
    const dataLen = shortBlockDataLen + (i < numShortBlocks ? 0 : 1);
    const blockData = data.slice(offset, offset + dataLen);
    offset += dataLen;
    blocks.push({
      data: blockData,
      ecc: qrReedSolomonRemainder(blockData, divisor),
    });
  }

  const result = [];
  const maxDataLen = Math.max(...blocks.map((block) => block.data.length));

  for (let i = 0; i < maxDataLen; i += 1) {
    blocks.forEach((block) => {
      if (i < block.data.length) {
        result.push(block.data[i]);
      }
    });
  }

  for (let i = 0; i < blockEccLen; i += 1) {
    blocks.forEach((block) => result.push(block.ecc[i]));
  }

  return result;
}

function qrAlignmentPatternPositions(version) {
  if (version === 1) {
    return [];
  }

  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  const step =
    version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];

  for (let pos = size - 7; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }

  return result;
}

function qrMakeMatrix(version, dataCodewords) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () =>
    Array(size).fill(false),
  );

  function setFunction(x, y, dark) {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  }

  function drawFinder(cx, cy) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) {
          continue;
        }
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  function drawAlignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        setFunction(
          cx + dx,
          cy + dy,
          Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
        );
      }
    }
  }

  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  for (let i = 8; i < size - 8; i += 1) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }

  const alignPositions = qrAlignmentPatternPositions(version);
  alignPositions.forEach((x) => {
    alignPositions.forEach((y) => {
      const overlapsFinder =
        (x === 6 && y === 6) ||
        (x === 6 && y === size - 7) ||
        (x === size - 7 && y === 6);
      if (!overlapsFinder) {
        drawAlignment(x, y);
      }
    });
  });

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i += 1) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const bit = qrGetBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(a, b, bit);
      setFunction(b, a, bit);
    }
  }

  function drawFormatBits(mask) {
    const formatData = (1 << 3) | mask;
    let rem = formatData;

    for (let i = 0; i < 10; i += 1) {
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    }

    const formatBits = ((formatData << 10) | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i += 1) {
      setFunction(8, i, qrGetBit(formatBits, i));
    }
    setFunction(8, 7, qrGetBit(formatBits, 6));
    setFunction(8, 8, qrGetBit(formatBits, 7));
    setFunction(7, 8, qrGetBit(formatBits, 8));
    for (let i = 9; i < 15; i += 1) {
      setFunction(14 - i, 8, qrGetBit(formatBits, i));
    }
    for (let i = 0; i < 8; i += 1) {
      setFunction(size - 1 - i, 8, qrGetBit(formatBits, i));
    }
    for (let i = 8; i < 15; i += 1) {
      setFunction(8, size - 15 + i, qrGetBit(formatBits, i));
    }
    setFunction(8, size - 8, true);
  }

  drawFormatBits(0);

  const codewords = qrAddErrorCorrection(dataCodewords, version);
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right = 5;
    }
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
          modules[y][x] = qrGetBit(
            codewords[Math.floor(bitIndex / 8)],
            7 - (bitIndex % 8),
          );
          bitIndex += 1;
        }
      }
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!isFunction[y][x] && (x + y) % 2 === 0) {
        modules[y][x] = !modules[y][x];
      }
    }
  }

  drawFormatBits(0);

  return modules;
}

function qrSvgDataUri(text) {
  const bytes = qrEncodeText(text);
  let version = 1;

  for (; version <= 40; version += 1) {
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= qrDataCodewords(version) * 8) {
      break;
    }
  }

  if (version > 40) {
    return "";
  }

  const matrix = qrMakeMatrix(version, qrBuildDataCodewords(bytes, version));
  const border = 2;
  const size = matrix.length;
  const viewSize = size + border * 2;
  const path = [];

  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) {
        path.push(`M${x + border},${y + border}h1v1h-1z`);
      }
    });
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h${viewSize}v${viewSize}H0z"/><path fill="#000" d="${path.join(" ")}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/* --------------------------------------------------------------- validation */

// Every check follows what sing-box itself accepts, so a form that validates
// produces a configuration the service can start with. A field is required here
// only when the core has no default for it.

const callNetworkInterfaceDump = rpc.declare({
  object: "network.interface",
  method: "dump",
  expect: { interface: [] },
});

let defaultPublicHostPromise = null;
let defaultPublicHostCache = null;
let systemPortsPromise = null;
let systemPortsCache = null;

function isEmptyValue(value) {
  return (
    value == null ||
    value === "" ||
    (Array.isArray(value) &&
      value.filter((item) => item != null && item !== "").length === 0)
  );
}

function valueList(value) {
  return (Array.isArray(value) ? value : [value]).filter(
    (item) => item != null && item !== "",
  );
}

function hasControlCharacters(value) {
  return Array.from(value).some((char) => {
    const code = char.codePointAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function validateRequired(_sectionId, value) {
  return isEmptyValue(value) ? _("This field is required") : true;
}

function validateRequiredText(_sectionId, value) {
  if (isEmptyValue(value)) {
    return _("This field is required");
  }

  return hasControlCharacters(`${value}`)
    ? _("Value must not contain control characters")
    : true;
}

function validatePort(_sectionId, value) {
  const port = parseInt(value, 10);
  return /^[0-9]+$/.test(`${value}`) && port >= 1 && port <= 65535
    ? true
    : _("Port must be between 1 and 65535");
}

function validateUuid(_sectionId, value) {
  return /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(
    `${value || ""}`,
  )
    ? true
    : _("Use a valid UUID");
}

function validateHost(_sectionId, value) {
  return isHost(value) ? true : _("Use a domain name or IP address");
}

function validateOptionalHost(_sectionId, value) {
  return isEmptyValue(value) || isHost(value)
    ? true
    : _("Use a domain name or IP address");
}

function validateListenAddress(_sectionId, value) {
  const address = normalizeHost(value);
  return address === "0.0.0.0" ||
    address === "::" ||
    isIpv4(address) ||
    isIpv6(address)
    ? true
    : _("Use an IP address, 0.0.0.0 for all IPv4, or :: for all addresses");
}

function validateFilePath(_sectionId, value) {
  const path = `${value || ""}`;

  if (isEmptyValue(path)) {
    return _("This field is required");
  }

  const validation = main.validatePath(path);
  return validation.valid && path !== "/" && !path.endsWith("/")
    ? true
    : _("Specify a file path");
}

// Both halves are required, and they cannot be the same file.
function validateTlsPathPair(sectionId, value, otherName) {
  const required = validateRequiredText(sectionId, value);
  if (required !== true) {
    return required;
  }

  const result = validateFilePath(sectionId, value);
  if (result !== true) {
    return result;
  }

  return `${value}` === liveOption(sectionId, otherName)
    ? _("The certificate and the key must be different files")
    : true;
}

function validateTlsCertificatePath(sectionId, value) {
  return validateTlsPathPair(sectionId, value, "tls_key_path");
}

function validateTlsKeyPath(sectionId, value) {
  return validateTlsPathPair(sectionId, value, "tls_certificate_path");
}

function validateHttpUrl(_sectionId, value) {
  try {
    const url = new URL(`${value || ""}`);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      isHost(url.hostname)
      ? true
      : _("Use an HTTP or HTTPS URL");
  } catch (_error) {
    return _("Use an HTTP or HTTPS URL");
  }
}

// Hysteria2 accepts a masquerade target as a URL: https:// reverse proxies a real
// site, file:// serves a directory.
function validateOptionalMasquerade(_sectionId, value) {
  if (isEmptyValue(value)) {
    return true;
  }

  const target = `${value}`.trim();
  if (target.startsWith("file://")) {
    return target.length > "file://".length
      ? true
      : _("Specify a directory after file://");
  }

  return validateHttpUrl(null, target) === true
    ? true
    : _("Use an https:// URL to proxy a site or file:// to serve a directory");
}

// Forkop names the inbound after the server, so singbox/servers.uc overwrites
// whatever tag the pasted object carries. Pasting a whole inbound from somewhere
// else is the point of this field, and a tag is part of what gets pasted.
function validateInboundJson(_sectionId, value) {
  if (isEmptyValue(value)) {
    return _("This field is required");
  }

  let parsed;
  try {
    parsed = JSON.parse(`${value}`);
  } catch (_error) {
    return _("Invalid JSON format");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof parsed.type !== "string" ||
    !parsed.type
  ) {
    return _("The object must have a type field");
  }

  const type = parsed.type.trim();
  if (parsed.type !== type || !JSON_INBOUND_TYPES.has(type)) {
    return _("sing-box has no inbound of type %s").format(type);
  }

  if (parsed.listen_port != null) {
    const port = validatePort(null, `${parsed.listen_port}`);
    if (port !== true) {
      return port;
    }
  }

  return true;
}

function isDuration(value) {
  return /^([0-9]+(ns|us|ms|s|m|h))+$/.test(`${value || ""}`);
}

function validateOptionalDuration(_sectionId, value) {
  return isEmptyValue(value) || isDuration(value)
    ? true
    : _("Use a duration like 30s, 5m, or 1h30m");
}

function validateOptionalPositiveInteger(_sectionId, value) {
  return isEmptyValue(value) || /^[1-9][0-9]*$/.test(`${value}`)
    ? true
    : _("Use a positive integer");
}

function validateTransportPath(_sectionId, value) {
  return isEmptyValue(value) || `${value}`.startsWith("/")
    ? true
    : _("The path must start with /");
}

function validateOptionalHostList(_sectionId, value) {
  return valueList(value).some((item) => !isHost(item))
    ? _("Use a domain name or IP address")
    : true;
}

function validateGrpcServiceName(_sectionId, value) {
  return isEmptyValue(value) || /^[A-Za-z0-9_.-]+$/.test(`${value}`)
    ? true
    : _("Use letters, digits, dots, underscores, or hyphens");
}

function normalizeCidrOrIp(value) {
  const normalized = `${value || ""}`.trim();
  if (!normalized.includes("/") && isIpv4(normalized)) {
    return `${normalized}/32`;
  }
  if (!normalized.includes("/") && isIpv6(normalized)) {
    return `${normalized}/128`;
  }
  return normalized;
}

function isValidCidr(item) {
  const [address, prefix, extra] = `${item}`.split("/");
  if (extra != null || prefix == null || !/^[0-9]+$/.test(prefix)) {
    return false;
  }

  const prefixNumber = parseInt(prefix, 10);
  if (isIpv4(address)) {
    return prefixNumber >= 0 && prefixNumber <= 32;
  }
  if (isIpv6(address)) {
    return prefixNumber >= 0 && prefixNumber <= 128;
  }
  return false;
}

function validateOptionalCidrOrIp(_sectionId, value) {
  if (isEmptyValue(value)) {
    return true;
  }

  return valueList(value).some((item) => !isValidCidr(normalizeCidrOrIp(item)))
    ? _("Use a subnet like 192.168.1.0/24 or an address like 192.168.1.10")
    : true;
}

// sing-box decodes every short ID as hex bytes, so an odd digit count is refused at
// start-up and eight bytes is the hard limit. The form rejects exactly the same
// values instead of letting the service die on apply.
// One value. sing-box takes a list so a batch of clients can be revoked on its own,
// but a share link carries exactly one, so a second value could not reach any client
// through anything Forkop hands out. The core still gets a list of one.
function validateShortId(sectionId, value) {
  const required = validateRequiredText(sectionId, value);
  if (required !== true) {
    return required;
  }

  const id = `${value}`.trim();
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(id)) {
    return _("Use an even number of hex digits, for example 0a1b2c3d");
  }

  return id.length > 16
    ? _("A short ID holds at most 16 hex digits")
    : true;
}

function validateRealityKey(_sectionId, value) {
  if (isEmptyValue(value)) {
    return _("Generate a key pair with the button next to the field");
  }

  return /^[A-Za-z0-9_-]{43}$/.test(`${value}`.trim())
    ? true
    : _("A Reality key is 43 base64url characters");
}

function validateMtprotoSecret(_sectionId, value) {
  const secret = normalizeMtprotoBaseSecret(value);

  if (!secret) {
    return _("Use 32 hex characters");
  }

  return secret === "00000000000000000000000000000000"
    ? _("Use a non-zero secret")
    : true;
}

function validateSecurity(sectionId, value) {
  const protocol = getProtocol(sectionId);
  const selected = value || defaultSecurity(protocol);

  return securitiesFor(protocol).includes(selected)
    ? true
    : _("This protocol does not support the selected security mode");
}

// Tailscale reduces the host name to a DNS label, so anything it would rewrite is
// refused here instead of quietly registering a differently named machine.
function validateTailscaleHostname(_sectionId, value) {
  const hostname = `${value || ""}`.trim();

  if (!hostname) {
    return _("This field is required");
  }
  if (hostname.length > 63) {
    return _("A host name holds at most 63 characters");
  }

  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(hostname)
    ? true
    : _("Use lowercase letters, digits and hyphens");
}

function validateShadowsocksPassword(sectionId, value) {
  const required = validateRequiredText(sectionId, value);
  if (required !== true) {
    return required;
  }

  const keyBytes = shadowsocksKeyBytes(getShadowsocksMethod(sectionId));
  if (keyBytes === 0) {
    return true;
  }

  let decoded = null;
  try {
    decoded = atob(`${value}`.trim());
  } catch (_error) {
    decoded = null;
  }

  return decoded != null && decoded.length === keyBytes
    ? true
    : _("This method needs a base64 key of %d bytes").format(keyBytes);
}

function validateAuthorizedKeys(_sectionId, value) {
  return valueList(value).some(
    (item) =>
      !/^(ssh|ecdsa|sk-ssh|sk-ecdsa)[A-Za-z0-9@.-]*\s+[A-Za-z0-9+/=]+(\s.*)?$/.test(
        `${item}`.trim(),
      ),
  )
    ? _("Use an OpenSSH public key line")
    : true;
}

// Ports another Forkop server, another Forkop inbound or a router service already
// listens on. sing-box refuses to start on a taken port, and the runtime check in
// Diagnostics only reports it after the fact.
function occupiedPorts(currentSectionId) {
  const owners = new Map();

  const claim = (port, owner) => {
    const normalized = `${port || ""}`.trim();
    if (!/^[0-9]+$/.test(normalized) || owners.has(normalized)) {
      return;
    }
    owners.set(normalized, owner);
  };

  RESERVED_PORTS.forEach(([port, owner]) => claim(port, owner));

  (uci.sections(UCI_PACKAGE, "server") || []).forEach((server) => {
    if (server[".name"] === currentSectionId || server.enabled === "0") {
      return;
    }
    if (!hasListener(server.protocol || DEFAULT_PROTOCOL)) {
      return;
    }
    claim(
      server.listen_port,
      _("server %s").format(server.label || server[".name"]),
    );
  });

  (systemPortsCache || []).forEach((entry) => claim(entry.port, entry.owner));

  return owners;
}

function validateListenPort(sectionId, value) {
  const result = validatePort(sectionId, value);
  if (result !== true) {
    return result;
  }

  const owner = occupiedPorts(sectionId).get(`${value}`.trim());
  return owner ? _("Port %s is already used by %s").format(value, owner) : true;
}

// Ports taken by services outside Forkop's own configuration, read once per page so
// the port check can name uhttpd or dropbear instead of only failing on apply.
function loadSystemPorts() {
  if (systemPortsCache != null) {
    return Promise.resolve(systemPortsCache);
  }
  if (systemPortsPromise) {
    return systemPortsPromise;
  }

  systemPortsPromise = Promise.all([
    uci.load("uhttpd").catch(() => null),
    uci.load("dropbear").catch(() => null),
  ])
    .then(() => {
      const entries = [];
      const addListen = (value, owner) => {
        asList(value).forEach((item) => {
          const port = `${item}`.trim().split(":").pop();
          if (/^[0-9]+$/.test(port)) {
            entries.push({ port, owner });
          }
        });
      };

      (uci.sections("uhttpd") || []).forEach((section) => {
        addListen(section.listen_http, _("LuCI web interface"));
        addListen(section.listen_https, _("LuCI web interface"));
      });
      (uci.sections("dropbear") || []).forEach((section) => {
        if (section.enable !== "0") {
          addListen(section.Port || "22", _("router SSH"));
        }
      });

      systemPortsCache = entries;
      return systemPortsCache;
    })
    .catch(() => {
      systemPortsCache = [];
      return systemPortsCache;
    })
    .finally(() => {
      systemPortsPromise = null;
    });

  return systemPortsPromise;
}

function getInterfaceIpAddresses(networkInterface) {
  return ["ipv4-address", "ipv6-address"]
    .map((key) =>
      networkInterface &&
      typeof networkInterface === "object" &&
      Array.isArray(networkInterface[key])
        ? networkInterface[key]
        : [],
    )
    .flat()
    .map((address) =>
      normalizeHost(
        address && typeof address === "object" ? address.address : address,
      ),
    )
    .filter((address) => isIpv4(address) || isIpv6(address));
}

// The address clients should dial: a routable address when the router has one, the
// LAN address otherwise, because that is still the useful answer behind NAT.
function chooseDefaultPublicHost(networkInterfaces) {
  const upInterfaces = (
    Array.isArray(networkInterfaces) ? networkInterfaces : []
  ).filter(
    (networkInterface) => networkInterface && networkInterface.up !== false,
  );
  const publicIp = upInterfaces
    .flatMap(getInterfaceIpAddresses)
    .find((ip) => !isPrivateOrReservedIp(ip));

  if (publicIp) {
    return publicIp;
  }

  const lanInterface =
    upInterfaces.find((networkInterface) => {
      const name = `${networkInterface.interface || ""}`;
      const device = `${networkInterface.device || networkInterface.l3_device || ""}`;
      return name === "lan" || device === "br-lan";
    }) || {};
  const lanIp = getInterfaceIpAddresses(lanInterface).find(
    (ip) => ip !== "::1" && !ip.startsWith("127."),
  );

  if (lanIp) {
    return lanIp;
  }

  return (
    upInterfaces
      .flatMap(getInterfaceIpAddresses)
      .find((ip) => ip !== "::1" && !ip.startsWith("127.")) || getBrowserHost()
  );
}

function loadDefaultPublicHost() {
  if (defaultPublicHostCache != null) {
    return Promise.resolve(defaultPublicHostCache);
  }
  if (defaultPublicHostPromise) {
    return defaultPublicHostPromise;
  }

  defaultPublicHostPromise = callNetworkInterfaceDump()
    .then((networkInterfaces) => {
      defaultPublicHostCache = chooseDefaultPublicHost(networkInterfaces);
      return defaultPublicHostCache;
    })
    .catch(() => getBrowserHost())
    .finally(() => {
      defaultPublicHostPromise = null;
    });

  return defaultPublicHostPromise;
}

function preloadServerModalData() {
  return Promise.all([
    loadDefaultPublicHost().catch(() => null),
    loadSystemPorts().catch(() => null),
  ]);
}

/* -------------------------------------------------------------- share links */

// The field names and encodings follow the link parser in the Forkop core
// (parser/link), so a link produced here is a link the core reads back and clients
// that follow the same conventions understand.

function getPublicHost(sectionId) {
  return option(sectionId, "public_host") || getBrowserHost();
}

function getListenPort(sectionId) {
  return option(sectionId, "listen_port");
}

function clientLabel(sectionId, client) {
  return `${client?.name || ""}`.trim() || getServerName(sectionId);
}

// A server that keeps Forkop's own certificate path serves a self-signed
// certificate, so its links have to tell the client to accept it.
function usesGeneratedCertificate(sectionId) {
  const path = option(sectionId, "tls_certificate_path");
  return !path || isForkopCertificatePath(path);
}

function transportQuery(sectionId, params, grpcKey) {
  const transport = option(sectionId, "transport") || "tcp";
  params.type = transport === "raw" ? "tcp" : transport;

  if (transport === "ws" || transport === "httpupgrade") {
    params.path = option(sectionId, "transport_path");
    params.host = option(sectionId, "transport_host");
  } else if (transport === "xhttp") {
    params.path = option(sectionId, "transport_path") || "/";
    params.host = option(sectionId, "transport_host");
    params.mode = option(sectionId, "transport_xhttp_mode") || "auto";
  } else if (transport === "grpc") {
    params[grpcKey] = option(sectionId, "transport_service_name");
  } else if (transport === "http") {
    params.path = option(sectionId, "transport_path");
    params.host = optionList(sectionId, "transport_hosts").join(",");
  }

  return transport;
}

function tlsQuery(sectionId, params, includeSecurity) {
  const security = getEffectiveSecurity(sectionId);

  if (security === "none") {
    if (includeSecurity) {
      params.security = "none";
    }
    return security;
  }

  if (includeSecurity) {
    params.security = security;
  }

  if (security === "reality") {
    params.sni = option(sectionId, "tls_server_name");
    params.pbk = option(sectionId, "reality_public_key");
    params.sid = optionList(sectionId, "reality_short_id")[0] || "";
    const fingerprint = option(sectionId, "client_fingerprint");
    if (fingerprint) {
      params.fp = fingerprint;
    }
  } else {
    params.sni = option(sectionId, "tls_server_name");
    if (usesGeneratedCertificate(sectionId)) {
      params.insecure = "1";
    }
  }

  const alpn = optionList(sectionId, "tls_alpn").join(",");
  if (alpn) {
    params.alpn = alpn;
  }

  return security;
}

function shareUrl(scheme, sectionId, userInfo, params, label) {
  const host = formatHostForUri(getPublicHost(sectionId));
  const port = getListenPort(sectionId);
  const query = encodeQuery(params || {});

  return [
    scheme,
    "://",
    userInfo ? `${userInfo}@` : "",
    host,
    ":",
    port,
    query ? `?${query}` : "",
    "#",
    encodeURIComponent(label),
  ].join("");
}

function buildVlessLink(sectionId, client) {
  const params = {};
  const security = tlsQuery(sectionId, params, true);

  if (security === "reality" && (!params.pbk || !params.sid)) {
    return "";
  }

  transportQuery(sectionId, params, "serviceName");
  params.encryption = "none";
  if (client.flow && client.flow !== "none") {
    params.flow = client.flow;
  }

  return shareUrl(
    "vless",
    sectionId,
    encodeURIComponent(client.uuid),
    params,
    clientLabel(sectionId, client),
  );
}

function buildTrojanLink(sectionId, client) {
  const params = {};

  // The core refuses to represent a plaintext Trojan outbound as a share link,
  // because no client format carries it.
  if (tlsQuery(sectionId, params, true) === "none") {
    return "";
  }

  transportQuery(sectionId, params, "grpc-service-name");

  return shareUrl(
    "trojan",
    sectionId,
    encodeURIComponent(client.password),
    params,
    clientLabel(sectionId, client),
  );
}

function buildVmessLink(sectionId, client) {
  const params = {};
  const security = tlsQuery(sectionId, params, false);
  const transportParams = {};
  transportQuery(sectionId, transportParams, "serviceName");
  const payload = {
    v: "2",
    ps: clientLabel(sectionId, client),
    add: getPublicHost(sectionId),
    port: getListenPort(sectionId),
    id: client.uuid,
    aid: "0",
    scy: "auto",
    // The transport as the query already spells it, so the one place that maps a
    // stored raw onto tcp stays one place.
    net: transportParams.type,
    type: "none",
    host: transportParams.host || "",
    path: transportParams.path || transportParams.serviceName || "",
    tls: security === "tls" ? "tls" : "",
    sni: security === "tls" ? params.sni || "" : "",
    alpn: security === "tls" ? params.alpn || "" : "",
  };

  if (params.insecure) {
    payload.insecure = "1";
  }

  // Unpadded standard base64, the encoding the core generator emits.
  return `vmess://${base64Encode(JSON.stringify(payload)).replace(/=+$/, "")}`;
}

function buildShadowsocksLink(sectionId, client) {
  const method = getShadowsocksMethod(sectionId);
  // A 2022 server holds one pre-shared key and every client adds its own, so the
  // client password is the two keys joined the way the ciphers expect them.
  const password = isShadowsocks2022(method)
    ? `${option(sectionId, "shadowsocks_psk")}:${client.password}`
    : client.password;

  return shareUrl(
    "ss",
    sectionId,
    base64UrlEncode(`${method}:${password}`),
    {},
    clientLabel(sectionId, client),
  );
}

function buildMixedLinks(sectionId, client) {
  const userInfo = isAuthenticationEnabled(sectionId)
    ? `${encodeURIComponent(client.name)}:${encodeURIComponent(client.password)}`
    : "";
  const label = clientLabel(sectionId, client);

  return [
    {
      title: _("SOCKS5"),
      link: shareUrl("socks5", sectionId, userInfo, {}, label),
    },
    {
      title: _("HTTP"),
      link: shareUrl("http", sectionId, userInfo, {}, label),
    },
  ];
}

function buildHysteria2Link(sectionId, client, context = {}) {
  const params = {};
  tlsQuery(sectionId, params, false);

  const certificatePin = normalizeSha256(context.tlsCertificateSha256);
  if (certificatePin) {
    params.pinSHA256 = certificatePin;
  }

  if (option(sectionId, "hysteria2_obfs_type") === "salamander") {
    params.obfs = "salamander";
    params["obfs-password"] = option(sectionId, "hysteria2_obfs_password");
  }

  const upMbps = option(sectionId, "hysteria2_up_mbps");
  const downMbps = option(sectionId, "hysteria2_down_mbps");
  if (upMbps) {
    params.up = upMbps;
  }
  if (downMbps) {
    params.down = downMbps;
  }

  return shareUrl(
    "hysteria2",
    sectionId,
    encodeURIComponent(client.password),
    params,
    clientLabel(sectionId, client),
  );
}

function buildTuicLink(sectionId, client) {
  const params = {};
  tlsQuery(sectionId, params, false);

  const congestion = option(sectionId, "tuic_congestion_control");
  if (congestion && congestion !== "cubic") {
    params.congestion_control = congestion;
  }
  const heartbeat = option(sectionId, "tuic_heartbeat");
  if (heartbeat) {
    params.heartbeat_interval = heartbeat;
  }
  if (option(sectionId, "tuic_zero_rtt_handshake") === "1") {
    params.zero_rtt_handshake = "true";
  }

  return shareUrl(
    "tuic",
    sectionId,
    `${encodeURIComponent(client.uuid)}:${encodeURIComponent(client.password)}`,
    params,
    clientLabel(sectionId, client),
  );
}

function buildAnytlsLink(sectionId, client) {
  const params = {};
  tlsQuery(sectionId, params, false);

  return shareUrl(
    "anytls",
    sectionId,
    encodeURIComponent(client.password),
    params,
    clientLabel(sectionId, client),
  );
}

function buildNaiveLink(sectionId, client) {
  const params = {};
  tlsQuery(sectionId, params, false);

  // naive+quic marks the HTTP/3 listener, naive+https the HTTP/2 one.
  const scheme =
    option(sectionId, "naive_network") === "udp" ? "naive+quic" : "naive+https";

  return shareUrl(
    scheme,
    sectionId,
    `${encodeURIComponent(client.name)}:${encodeURIComponent(client.password)}`,
    params,
    clientLabel(sectionId, client),
  );
}

function buildMtprotoLink(sectionId, client) {
  const secret = normalizeMtprotoBaseSecret(client.secret);
  if (!secret) {
    return "";
  }

  const query = encodeQuery({
    server: getPublicHost(sectionId),
    port: getListenPort(sectionId),
    secret: buildMtprotoFullSecret(
      secret,
      option(sectionId, "mtproto_faketls"),
    ),
  });

  return `https://t.me/proxy?${query}`;
}

function hasRequiredCredentials(sectionId, client) {
  return credentialFields(getProtocol(sectionId))
    .filter((field) => field !== "flow" && field !== "authorized_keys")
    .every((field) => {
      if (field === "password" && !isAuthenticationEnabled(sectionId)) {
        return true;
      }
      return !!client[field];
    });
}

// The Mieru link is the format of the Mieru project: the port and its transport
// live in the query rather than in the authority, and a profile name is required,
// which the server name stands in for.
function buildMieruLink(sectionId, client) {
  const label = clientLabel(sectionId, client);
  const query = encodeQuery({
    profile: getServerName(sectionId),
    port: getListenPort(sectionId),
    protocol: option(sectionId, "mieru_transport") || "TCP",
  });

  return [
    "mierus://",
    `${encodeURIComponent(client.name)}:${encodeURIComponent(client.password)}@`,
    formatHostForUri(getPublicHost(sectionId)),
    `?${query}`,
    "#",
    encodeURIComponent(label),
  ].join("");
}

// Every link a client can be handed, as title and link pairs. Most protocols
// produce one; the Mixed listener produces one per scheme it answers.
function buildClientLinks(sectionId, client, context = {}) {
  const protocol = getProtocol(sectionId);

  // Only protocols the table gives a scheme have a share link at all. SSH is the
  // one that has none, which is why its rows carry no details button either: what a
  // client of an SSH server needs is the address, the account and its password, and
  // the form shows all three.
  if (
    !client ||
    !linkScheme(protocol) ||
    !getPublicHost(sectionId) ||
    !getListenPort(sectionId) ||
    !hasRequiredCredentials(sectionId, client)
  ) {
    return [];
  }

  const single = (link) => (link ? [{ title: _("Link"), link }] : []);

  switch (protocol) {
    case "vless":
      return single(buildVlessLink(sectionId, client));
    case "vmess":
      return single(buildVmessLink(sectionId, client));
    case "trojan":
      return single(buildTrojanLink(sectionId, client));
    case "shadowsocks":
      return single(buildShadowsocksLink(sectionId, client));
    case "mixed":
      return buildMixedLinks(sectionId, client);
    case "hysteria2":
      return single(buildHysteria2Link(sectionId, client, context));
    case "tuic":
      return single(buildTuicLink(sectionId, client));
    case "anytls":
      return single(buildAnytlsLink(sectionId, client));
    case "naive":
      return single(buildNaiveLink(sectionId, client));
    case "mieru":
      return single(buildMieruLink(sectionId, client));
    case "mtproto":
      return single(buildMtprotoLink(sectionId, client));
    default:
      return [];
  }
}

function normalizeSha256Response(response) {
  if ((response.code ?? 0) !== 0 || !response.stdout) {
    throw new Error(response.stderr || response.stdout || "");
  }

  const data = JSON.parse(response.stdout);
  if (!data.success) {
    throw new Error(data.message || "");
  }

  return normalizeSha256(data.sha256);
}

// Hysteria2 clients pin the certificate instead of trusting it, so the fingerprint
// of Forkop's generated certificate is read from the router.
function loadLinkContext(sectionId) {
  const certificatePinExpected =
    getProtocol(sectionId) === "hysteria2" &&
    usesGeneratedCertificate(sectionId);

  if (!certificatePinExpected) {
    return Promise.resolve({ tlsCertificateSha256: "" });
  }

  return fs
    .exec("/usr/bin/forkop", ["get_tls_certificate_sha256", sectionId])
    .then(normalizeSha256Response)
    .catch((error) => {
      console.warn(
        error?.message || "Failed to read generated TLS certificate pin",
        error,
      );
      return "";
    })
    .then((tlsCertificateSha256) => ({ tlsCertificateSha256 }));
}

/* ---------------------------------------------------------------- icons, DOM */

function svgEl(tag, attrs = {}, children = []) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value != null) {
      element.setAttribute(key, `${value}`);
    }
  });
  (Array.isArray(children) ? children : [children])
    .filter(Boolean)
    .forEach((child) => element.appendChild(child));
  return element;
}

// Lucide outlines at the size and stroke the rest of Forkop already uses.
const ICON_PATHS = {
  generate: [
    ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }],
    ["path", { d: "M3 3v5h5" }],
  ],
  copy: [
    ["rect", { x: "9", y: "9", width: "13", height: "13", rx: "2", ry: "2" }],
    ["path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" }],
  ],
  qr: [
    ["rect", { x: "3", y: "3", width: "7", height: "7", rx: "1" }],
    ["rect", { x: "14", y: "3", width: "7", height: "7", rx: "1" }],
    ["rect", { x: "3", y: "14", width: "7", height: "7", rx: "1" }],
    ["path", { d: "M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1" }],
  ],
};

function iconSvg(name) {
  return svgEl(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: "16",
      height: "16",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    ICON_PATHS[name].map(([tag, attrs]) => svgEl(tag, attrs)),
  );
}

function copyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (error) {
    console.warn("Failed to copy the client link", error);
  }

  document.body.removeChild(textarea);
  return copied;
}

/* ------------------------------------------------------ server details dialog */

const DETAILS_STYLE_ID = "forkop-server-details-styles";

function injectDetailsStyles() {
  if (document.getElementById(DETAILS_STYLE_ID)) {
    return;
  }

  document.head.appendChild(
    E(
      "style",
      { id: DETAILS_STYLE_ID },
      [
        // The summary is the same dl/dt/dd the URLTest and Fallback details build, not
        // a grid of spans dressed to look like one. Half of how those labels read comes
        // from the theme through the tag - dl dt is bold at line-height 18px - so
        // copying their class rules onto other elements could never match them.
        // The width comes from the same place too: all three are opened without
        // cbi-modal, which is what the theme widens to a settings form.
        ".fkp-details{box-sizing:border-box;width:min(760px,calc(100vw - 56px));max-width:100%;padding-top:10px}",
        // The one deviation, and it is deliberate: their first column has a 120px
        // floor because their labels are long enough to fill it, and mine are short
        // enough that the floor pushed every value a third of the way across the
        // dialog. max-content puts the value 16px after the longest label.
        ".fkp-details__clients{display:grid;gap:14px;min-inline-size:0}",
        ".fkp-details__client{display:grid;gap:6px;min-width:0}",
        ".fkp-details__name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".fkp-details__link{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:stretch;min-inline-size:0}",
        ".fkp-details__value{inline-size:100% !important;max-inline-size:100% !important;min-inline-size:0;box-sizing:border-box;margin:0 !important;float:none !important;font-family:monospace;font-size:12px}",
        ".fkp-details__action{display:inline-flex;align-items:center;justify-content:center;inline-size:2.5em !important;min-inline-size:0;padding:0 !important;margin:0 !important;float:none !important;line-height:1}",
        ".fkp-details__empty{color:var(--text-color-medium,#666)}",
        // The theme aligns a modal button row with .modal > .button-row and pushes a
        // lone button left with .modal > .button-row > button:first-of-type. A bare
        // class loses to both, so the override extends the same selectors instead.
        ".modal > .button-row.fkp-details-actions{justify-content:flex-end;gap:0.5em}",
        ".modal > .button-row.fkp-details-actions > button:first-of-type{margin-right:0}",
        ".fkp-qr{display:grid;justify-items:center;gap:14px;min-inline-size:0}",
        ".fkp-qr__code{display:block;inline-size:14rem;block-size:14rem;max-inline-size:100%;image-rendering:pixelated;background:#fff;padding:10px;box-sizing:content-box;border:1px solid var(--border-color-low,rgba(128,128,128,0.2))}",
        ".fkp-qr__link{inline-size:100%;box-sizing:border-box;padding:8px 10px;background:rgba(128,128,128,0.06);border:1px solid var(--border-color-low,rgba(128,128,128,0.2));font-family:monospace;font-size:11px;line-height:1.5;word-break:break-all;color:var(--text-color-medium,#666)}",
      ].join("\n"),
    ),
  );
}

// A copy control stays a copy control: the toast says what happened, and swapping
// the icon for a tick is not something the rest of the app does.
function renderCopyButton(value) {
  const label = _("Copy");
  const button = E(
    "button",
    {
      class: "btn cbi-button cbi-button-neutral fkp-details__action",
      type: "button",
      title: label,
      "aria-label": label,
    },
    iconSvg("copy"),
  );

  button.addEventListener("click", (ev) => {
    ev.preventDefault();
    const copied = copyText(value);
    main.showToast(
      copied ? _("Copied") : _("Failed to copy!"),
      copied ? "success" : "error",
    );
  });

  return button;
}

function renderCloseRow() {
  return E("div", { class: "button-row fkp-details-actions" }, [
    E(
      "button",
      {
        class: "btn cbi-button cbi-button-neutral",
        type: "button",
        click: () => ui.hideModal(),
      },
      _("Close"),
    ),
  ]);
}

// The code is shown when it is asked for, at a size a phone can read, with the link
// it carries written out underneath so it is clear what is being scanned.
function showQrModal(title, link) {
  injectDetailsStyles();

  ui.showModal(`${_("QR code")}: ${title}`, [
    E("div", { class: "fkp-qr" }, [
      E("img", {
        class: "fkp-qr__code",
        src: qrSvgDataUri(link),
        alt: _("QR code"),
      }),
      E("div", { class: "fkp-qr__link" }, link),
    ]),
    renderCloseRow(),
  ]);
}

function renderQrButton(title, link) {
  const label = _("Show a QR code");
  return E(
    "button",
    {
      class: "btn cbi-button cbi-button-neutral fkp-details__action",
      type: "button",
      title: label,
      "aria-label": label,
      click: (ev) => {
        ev.preventDefault();
        showQrModal(title, link);
      },
    },
    iconSvg("qr"),
  );
}

// What a code or a link belongs to. An account is named the way the stacked settings
// dialogs name a child item; a listener that has no account is named by its scheme,
// because that is the only thing telling its two links apart.
function linkTitle(sectionId, client, scheme) {
  const server = getServerName(sectionId);
  const name = `${client?.name || ""}`.trim();

  if (!name) {
    return scheme ? `${server} (${scheme})` : server;
  }

  const title = `${server} \u00bb ${_("Client")}: ${name}`;
  return scheme ? `${title} (${scheme})` : title;
}

function renderLinkRow(value, qrTitle) {
  const input = E("input", {
    type: "text",
    class: "cbi-input-text fkp-details__value",
    readonly: "readonly",
    spellcheck: "false",
    value,
  });
  input.addEventListener("focus", () => input.select());

  return E("div", { class: "fkp-details__link" }, [
    input,
    renderQrButton(qrTitle, value),
    renderCopyButton(value),
  ]);
}

// Why a client has no link: a credential the link needs, or the address it points
// at, is still missing.
function missingLinkReason(sectionId, client) {
  if (!hasRequiredCredentials(sectionId, client)) {
    return _("Fill in the credentials of this client to get a link.");
  }
  if (!getPublicHost(sectionId) || !getListenPort(sectionId)) {
    return _("Set the public host and the port to get a link.");
  }
  return _("A link cannot be built from these settings.");
}

function renderClientDetails(sectionId, client, context) {
  const links = buildClientLinks(sectionId, client, context);
  const name = `${client?.name || ""}`.trim();
  const body = [];

  // A listener that asks for nothing has no account to name, and repeating the name
  // of the server there would say nothing.
  if (name) {
    body.push(E("div", { class: "fkp-details__name" }, name));
  }

  if (links.length) {
    links.forEach((entry) =>
      body.push(
        renderLinkRow(
          entry.link,
          linkTitle(sectionId, client, links.length > 1 ? entry.title : ""),
        ),
      ),
    );
  } else {
    body.push(
      E(
        "div",
        { class: "fkp-details__empty" },
        missingLinkReason(sectionId, client),
      ),
    );
  }

  return E("div", { class: "fkp-details__client" }, body);
}

// A Mixed listener without authentication has no accounts, and its link needs
// none: it is the address and nothing else.
function anonymousClient() {
  return {
    id: "",
    name: "",
    uuid: "",
    password: "",
    secret: "",
    flow: "",
    authorized_keys: [],
  };
}

// The dialog hands out what a client is given and nothing else: an account, its
// link, and the buttons to copy or scan it. Everything else it used to state was
// already in the link.
function renderDetailsContent(sectionId, clients, context) {
  const children = [];

  const entries = clients.length
    ? clients
    : isAuthenticationEnabled(sectionId)
      ? []
      : [anonymousClient()];

  if (!entries.length) {
    children.push(
      E(
        "div",
        { class: "fkp-details__empty" },
        _("Add a client to this server to get a link."),
      ),
    );
  } else {
    // No heading over the accounts: each one is announced by its own name, and a
    // listener without accounts has nothing to announce.
    children.push(
      E(
        "div",
        { class: "fkp-details__clients" },
        entries.map((client) =>
          renderClientDetails(sectionId, client, context),
        ),
      ),
    );
  }

  return E("div", { class: "fkp-details" }, children);
}

function showServerDetailsModal(sectionId, clients) {
  injectDetailsStyles();

  // Everything but the certificate fingerprint is already known, so the dialog
  // opens filled in and the Hysteria2 links gain their pin a moment later.
  let content = renderDetailsContent(sectionId, clients, {
    tlsCertificateSha256: "",
  });

  ui.showModal(
    _("Server details: %s").format(getServerName(sectionId)),
    [content, renderCloseRow()],
  );

  return loadLinkContext(sectionId).then((context) => {
    if (!content.parentNode) {
      return;
    }
    const refreshed = renderDetailsContent(sectionId, clients, context);
    content.replaceWith(refreshed);
    content = refreshed;
  });
}
/* -------------------------------------------------------------------- clients */

// A client is the account a server accepts. sing-box takes a list of users on every
// protocol served here, so each client is its own UCI section with its own name and
// credentials. The list is edited with the same child item widget the Sections tab
// uses for interfaces, URLTests and tunnels.

const CLIENT_KEYS = [
  "name",
  "uuid",
  "password",
  "secret",
  "flow",
  "authorized_keys",
  "routing_override",
  "routing_mode",
  "routing_section",
];

// The same modes the server has. Rules costs a clone of the shared rule set for
// that account, but only when the server itself does not already clone it.
const CLIENT_ROUTING_MODES = [
  ["rules", _("Rules")],
  ["direct", _("Direct")],
  ["section", _("Section")],
];

function clientSections(sectionId) {
  return (uci.sections(UCI_PACKAGE, CLIENT_TYPE) || []).filter(
    (section) => `${section[CLIENT_OWNER_OPTION] || ""}` === `${sectionId}`,
  );
}

function readClient(section) {
  return {
    id: section[".name"],
    name: `${section.name || ""}`,
    uuid: `${section.uuid || ""}`,
    password: `${section.password || ""}`,
    secret: `${section.secret || ""}`,
    flow: `${section.flow || ""}`,
    authorized_keys: asList(section.authorized_keys),
  };
}

function listClients(sectionId) {
  return clientSections(sectionId).map(readClient);
}

// Numbered names that do not follow the server name: a client is a device, not a
// second label for the server. One past the count, the way a new section is named.
function nextClientName(taken) {
  return "client-%d".format(taken.length + 1);
}

function clientNameLabel(protocol) {
  return usesLoginName(protocol) ? _("User name") : _("Name");
}

function validateClientName(sectionId, value) {
  const name = `${value || ""}`.trim();

  if (!name) {
    return _("This field is required");
  }
  if (name.length > MAX_CLIENT_NAME_LENGTH) {
    return _("A name holds at most %d characters").format(
      MAX_CLIENT_NAME_LENGTH,
    );
  }

  if (usesLoginName(getProtocol(sectionId))) {
    return /^[A-Za-z0-9._-]+$/.test(name)
      ? true
      : _("Use letters, digits, dots, underscores, or hyphens");
  }

  return hasControlCharacters(name)
    ? _("Value must not contain control characters")
    : true;
}

function validateClientCredential(sectionId, field, value) {
  if (field === "uuid") {
    return validateUuid(sectionId, value);
  }
  if (field === "secret") {
    return validateMtprotoSecret(sectionId, value);
  }
  if (field === "password") {
    return getProtocol(sectionId) === "shadowsocks"
      ? validateShadowsocksPassword(sectionId, value)
      : validateRequiredText(sectionId, value);
  }
  if (field === "authorized_keys") {
    return validateAuthorizedKeys(sectionId, value);
  }
  return true;
}

// Credential fields the protocol asks a client for. The password disappears when
// authentication is switched off, because then nobody sends one, and the flow
// disappears where the listener cannot carry it.
function visibleClientFields(sectionId) {
  const protocol = getProtocol(sectionId);

  return credentialFields(protocol).filter((field) => {
    if (field === "password") {
      return isAuthenticationEnabled(sectionId);
    }
    if (field === "flow") {
      return supportsVisionFlow(sectionId);
    }
    return true;
  });
}

function clientCredentialLabel(sectionId, field) {
  if (field === "uuid") {
    return _("UUID");
  }
  if (field === "secret") {
    return _("Secret");
  }
  if (field === "flow") {
    return _("Flow");
  }
  if (field === "authorized_keys") {
    return _("SSH public keys");
  }

  return getProtocol(sectionId) === "shadowsocks" &&
    isShadowsocks2022(getShadowsocksMethod(sectionId))
    ? _("Key")
    : _("Password");
}

function clientSettingsDefaults(sectionId, inputValue, existing, listOption) {
  const protocol = getProtocol(sectionId);
  const defaults = {};

  if (existing) {
    return defaults;
  }

  // Adding a client is an explicit action, so a fresh client starts with credentials
  // it can actually connect with; nothing is generated behind the user's back.
  defaults.name =
    `${inputValue || ""}`.trim() ||
    nextClientName(listedClientNames(sectionId, listOption));
  visibleClientFields(sectionId).forEach((field) => {
    if (field === "flow" || field === "authorized_keys") {
      return;
    }
    defaults[field] = generateCredential(sectionId, protocol, field);
  });

  return defaults;
}

// The names the list shows right now, the way the Sections tab numbers a server
// group. A removal that has not been saved yet gives its name back and a draft
// that was taken out stops holding one, which reading the stored sections and the
// staged drafts instead could not tell.
function listedClientNames(sectionId, listOption) {
  let current = null;

  if (listOption && typeof listOption.formvalue === "function") {
    try {
      current = listOption.formvalue(sectionId);
    } catch (_error) {
      // The widget is not mounted; the stored sections are all there is.
    }
  }

  if (current == null) {
    return clientSections(sectionId).map((section) => section.name || "");
  }

  return valueList(current).map((value) =>
    typeof listOption.inputValueForItem === "function"
      ? listOption.inputValueForItem(sectionId, value)
      : `${value}`,
  );
}

function addClientCredentialOptions(sectionId, itemSection) {
  const protocol = getProtocol(sectionId);

  visibleClientFields(sectionId).forEach((field) => {
    if (field === "flow") {
      const flow = itemSection.option(
        form.ListValue,
        "flow",
        clientCredentialLabel(sectionId, field),
      );
      flow.value("", _("None"));
      flow.value("xtls-rprx-vision", "xtls-rprx-vision");
      flow.rmempty = true;
      return;
    }

    if (field === "authorized_keys") {
      const keys = itemSection.option(
        form.DynamicList,
        "authorized_keys",
        clientCredentialLabel(sectionId, field),
      );
      keys.rmempty = true;
      keys.validate = (_id, value) =>
        validateClientCredential(sectionId, "authorized_keys", value);
      return;
    }

    const credential = itemSection.option(
      form.Value,
      field,
      clientCredentialLabel(sectionId, field),
    );
    credential.rmempty = false;
    credential.password = field !== "uuid";
    credential.validate = (_id, value) =>
      validateClientCredential(sectionId, field, value);
    addGenerateButton(credential, () =>
      generateCredential(sectionId, protocol, field),
    );
  });
}

function addClientOptions(sectionId, itemSection, helpers) {
  const protocol = getProtocol(sectionId);

  const name = itemSection.option(
    form.Value,
    "name",
    clientNameLabel(protocol),
  );
  name.rmempty = false;
  name.placeholder = "client-1";
  name.validate = function (_id, value) {
    const result = validateClientName(sectionId, value);
    if (result !== true) {
      return result;
    }
    return typeof helpers.validateName === "function"
      ? helpers.validateName(value)
      : true;
  };

  addClientCredentialOptions(sectionId, itemSection);
  addClientRoutingOptions(sectionId, itemSection);
}

// Rules for a client are generated before the rule of its server, so an override
// wins over the server wide mode without touching it.
function addClientRoutingOptions(sectionId, itemSection) {
  if (!hasListener(getProtocol(sectionId))) {
    return;
  }

  const override = itemSection.option(
    form.Flag,
    "routing_override",
    _("Override routing"),
    _("Route this client on its own path instead of the rest of the server"),
  );
  override.default = "0";
  override.rmempty = true;

  const mode = itemSection.option(
    form.ListValue,
    "routing_mode",
    _("Routing mode"),
  );
  CLIENT_ROUTING_MODES.forEach(([value, label]) => mode.value(value, label));
  mode.default = "rules";
  mode.rmempty = false;
  mode.depends("routing_override", "1");

  const target = itemSection.option(
    form.ListValue,
    "routing_section",
    _("Routing section"),
    _("Required. Where the traffic of this client leaves"),
  );
  routingSectionChoices().forEach(([value, label]) => target.value(value, label));
  target.rmempty = false;
  target.depends({ routing_override: "1", routing_mode: "section" });
  target.validate = (_id, value) =>
    value ? true : _("Select a section");
}

function showClientSettingsModal(
  sectionId,
  itemValue,
  listOption,
  widget,
  itemNode,
  context = {},
) {
  return sectionui.showChildItemSettingsModal(
    sectionId,
    itemValue,
    listOption,
    {
      typeName: CLIENT_TYPE,
      ownerOption: CLIENT_OWNER_OPTION,
      valueOption: "name",
      keys: CLIENT_KEYS,
      itemNode,
      defaults: (inputValue, existing) =>
        clientSettingsDefaults(sectionId, inputValue, existing, listOption),
      addOptions: (itemSection, helpers) =>
        addClientOptions(sectionId, itemSection, helpers),
      validateName: sectionui.validateUniqueDynamicListItemName.bind(
        null,
        widget,
        itemNode,
      ),
      title: (name) =>
        `${name || ""}`.trim() ? _("Client: %s").format(name) : _("Client"),
      afterSave: (itemId, inputValue, _settings, existing) => {
        if (existing) {
          sectionui.updateDynamicListItemLabel(itemNode, inputValue);
          return;
        }
        if (context.adding) {
          sectionui.addDynamicListItem(widget, inputValue);
        } else {
          sectionui.updateDynamicListItemLabel(itemNode, inputValue);
        }
      },
    },
  );
}

// Everything that has to hold before a server with clients can be saved. The list
// widget turns the message into the field error LuCI shows next to the option.
function validateClientsOnSave(sectionId, values, listOption) {
  const items = (Array.isArray(values) ? values : [values]).filter(Boolean);

  if (!items.length) {
    return _("Add at least one client");
  }

  const store =
    sectionui.childPendingSettingsStore(listOption, sectionId) || {};
  const seen = new Set();
  for (const value of items) {
    const existing = sectionui.isExistingChildItem(
      sectionId,
      value,
      CLIENT_TYPE,
      CLIENT_OWNER_OPTION,
    );
    const settings = existing
      ? readClient(uci.get(UCI_PACKAGE, value) || {})
      : Object.assign({ name: value }, store[value] || {});
    const name = `${settings.name || value || ""}`.trim();

    const nameResult = validateClientName(sectionId, name);
    if (nameResult !== true) {
      return `${name || value}: ${nameResult}`;
    }

    if (seen.has(name.toLowerCase())) {
      return _("Client names must be unique");
    }
    seen.add(name.toLowerCase());

    for (const field of visibleClientFields(sectionId)) {
      if (field === "flow" || field === "authorized_keys") {
        continue;
      }
      const result = validateClientCredential(
        sectionId,
        field,
        settings[field] || "",
      );
      if (result !== true) {
        return `${name}: ${result}`;
      }
    }
  }

  return true;
}

// A client list problem has no input of its own to mark, so the message goes under
// the field the way LuCI reports an invalid value, and never into a dialog banner.
// Credentials the protocol no longer uses are dropped when the protocol changes: a
// stale password would keep showing up in diagnostics and in the config signature.
const CLIENT_ROUTING_KEYS = [
  "routing_override",
  "routing_mode",
  "routing_section",
];

function pruneClientCredentials(sectionId) {
  const keep = new Set(visibleClientFields(sectionId));

  clientSections(sectionId).forEach((section) => {
    const stale = CLIENT_KEYS.filter(
      (key) =>
        key !== "name" &&
        !keep.has(key) &&
        !CLIENT_ROUTING_KEYS.includes(key),
    );
    if (section.routing_override !== "1") {
      stale.push(...CLIENT_ROUTING_KEYS);
    }
    if (section.routing_mode !== "section") {
      stale.push("routing_section");
    }

    stale.forEach((key) => {
      if (section[key] != null) {
        uci.unset(UCI_PACKAGE, section[".name"], key);
      }
    });
  });
}

// Emptying the client list goes through the option LuCI owns: the widget holds
// child section ids, and what load() returned has to be forgotten as well, or the
// save would compare the two, find them equal and skip the write. Nothing is
// removed here - the option does that when the dialog is saved, so a dialog that
// is dismissed leaves the stored clients alone.
function clearClientList(mapRef, sectionId) {
  const found = mapRef ? mapRef.lookupOption("clients", sectionId) : null;
  const listOption = found ? found[0] : null;

  if (!listOption) {
    return;
  }

  if (typeof listOption.clearStagedChildSettings === "function") {
    listOption.clearStagedChildSettings(sectionId);
  }

  const element = listOption.getUIElement(sectionId);
  if (element) {
    element.setValue([]);
  }

  listOption.cfgvalue(sectionId, []);
}

function removeServerClients(sectionId) {
  sectionui.cleanupRemovedChildItems(
    sectionId,
    CLIENT_TYPE,
    [],
    CLIENT_OWNER_OPTION,
  );
}

/* ------------------------------------------------------------------- widgets */

function injectServerStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  document.head.appendChild(
    E(
      "style",
      { id: STYLE_ID },
      [
        // The generate button sits in the same grid the child item list uses, so it
        // lines up with the input instead of floating next to it.
        ".fkp-generate-row{--fkp-generate-gap:0.5em;--fkp-generate-size:2.5em;column-gap:var(--fkp-generate-gap);display:inline-grid;grid-template-columns:minmax(0,1fr) auto;max-inline-size:100%}",
        ".fkp-generate-row > :first-child{grid-column:1;min-inline-size:0}",
        ".fkp-generate-row > .fkp-generate{align-items:center;align-self:stretch;box-sizing:border-box;display:inline-flex;grid-column:2;inline-size:var(--fkp-generate-size) !important;justify-content:center;line-height:1;margin:0 !important;min-block-size:0;min-inline-size:0;padding:0 !important;float:none !important;user-select:none}",
        ".fkp-generate-row--rows > .fkp-generate{align-self:start;block-size:var(--fkp-generate-row-size,auto)}",
        ".fkp-generate-row > .fkp-generate > svg{display:block}",
        `#cbi-${UCI_PACKAGE}-server > h3:nth-child(1){display:none}`,
        `#cbi-${UCI_PACKAGE}-server > .cbi-section-remove{margin-bottom:-32px}`,
        `#cbi-${UCI_PACKAGE}-server .cbi-section-actions > div{display:inline-flex;align-items:center;gap:4px}`,
        `#cbi-${UCI_PACKAGE}-server .cbi-section-actions{text-align:right}`,
        ".fkp-server-info{box-sizing:border-box;vertical-align:middle}",
        ".fkp-server-info__glyph{display:inline-block;line-height:1;transform:scale(1.55);transform-origin:center}",
      ].join("\n"),
    ),
  );
}

// The resize handle drags a textarea below the rows it asked for, and the example
// inside stops fitting. The height those rows actually render at becomes its
// floor: measured rather than computed from rows, because the padding and border
// a theme adds are part of that height and no line arithmetic gets them right.
// A field built for a dialog has no size until that dialog is on the page, which
// happens several frames later, so the first size it is given is what is taken.
function pinTextareaHeight(textarea) {
  if (typeof ResizeObserver !== "function") {
    return;
  }

  const observer = new ResizeObserver(() => {
    const height = textarea.getBoundingClientRect().height;
    if (height > 0) {
      observer.disconnect();
      textarea.style.minHeight = `${height}px`;
    }
  });

  observer.observe(textarea);
}

function configureTextareaOption(optionRef, options = {}) {
  const renderWidget = optionRef.renderWidget;

  optionRef.renderWidget = function (sectionId, optionIndex, cfgvalue) {
    const node = renderWidget.call(this, sectionId, optionIndex, cfgvalue);
    const textarea =
      node && typeof node.querySelector === "function"
        ? node.querySelector("textarea")
        : node;

    if (textarea) {
      [
        ["spellcheck", "false"],
        ["autocomplete", "off"],
        ["autocorrect", "off"],
        ["autocapitalize", "off"],
        ["data-gramm", "false"],
        ["data-gramm_editor", "false"],
        ["data-enable-grammarly", "false"],
      ].forEach(([name, value]) => textarea.setAttribute(name, value));
      textarea.style.resize = "vertical";
      textarea.style.maxWidth = "100%";
      if (options.pinHeight) {
        pinTextareaHeight(textarea);
      }
    }

    return node;
  };
}

function widgetElement(node) {
  const instance = dom.findClassInstance(node);
  return instance && typeof instance.setValue === "function" ? instance : null;
}

function controlOf(node) {
  if (!node) {
    return null;
  }
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName)) {
    return node;
  }
  return typeof node.querySelector === "function"
    ? node.querySelector("input:not([type='hidden']), select, textarea")
    : null;
}

// Fills a field with a freshly generated value. Nothing is generated until the
// button is pressed, so an untouched field stays empty and the validator asks for it.
function addGenerateButton(optionRef, generate, title) {
  const renderWidget = optionRef.renderWidget;

  optionRef.renderWidget = function (sectionId, optionIndex, cfgvalue) {
    const node = renderWidget.call(this, sectionId, optionIndex, cfgvalue);
    const label = title || _("Generate");
    const readonly = this.readonly != null ? this.readonly : this.map.readonly;
    const button = E(
      "button",
      {
        class: "btn cbi-button cbi-button-neutral fkp-generate",
        type: "button",
        title: label,
        "aria-label": label,
        disabled: readonly ? "" : null,
      },
      iconSvg("generate"),
    );

    button.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      if (readonly) {
        return;
      }

      const element = widgetElement(node);
      const next = generate(sectionId, element ? element.getValue() : null);

      if (next == null) {
        return;
      }
      if (element) {
        element.setValue(next);
        // A field keeps the invalid mark until it is checked again, so a generated
        // value is validated the same way a typed one is.
        if (typeof element.triggerValidation === "function") {
          element.triggerValidation();
        }
      }
      controlOf(node)?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // A list grows row by row, so its button keeps the height of one row the way the
    // child item list does. A single control simply stretches to its own height.
    const rows = !!node.querySelector?.(".add-item");
    const row = E(
      "div",
      {
        class: rows
          ? "fkp-generate-row fkp-generate-row--rows"
          : "fkp-generate-row",
      },
      [node, button],
    );

    if (rows) {
      const measure = () => {
        const height = controlOf(node)?.offsetHeight || 0;
        if (height > 0) {
          button.style.setProperty("--fkp-generate-row-size", `${height}px`);
        }
      };

      if (typeof ResizeObserver === "function") {
        new ResizeObserver(measure).observe(node);
      } else {
        window.setTimeout(measure, 0);
      }
    }

    return row;
  };
}

function getSelectWidget(sectionId, name) {
  const node = widgetNode(sectionId, name);

  if (!node) {
    return null;
  }
  if (node.tagName === "SELECT") {
    return node;
  }

  return typeof node.querySelector === "function"
    ? node.querySelector("select")
    : null;
}

// The security modes depend on the protocol and LuCI cannot express that with
// depends(), so the choices are rebuilt whenever the protocol changes.
// The protocol change handler runs before the new value reaches the form, so the
// protocol is handed over instead of being read back.
function syncSecurityChoices(sectionId, protocol, reset) {
  const allowed = securitiesFor(protocol || getProtocol(sectionId));
  const select = getSelectWidget(sectionId, "security");
  const stored = select ? select.value : option(sectionId, "security");
  // A protocol change starts from that protocol's own best mode. Carrying the
  // previous value over would leave VLESS on None just because None is allowed.
  const next = !reset && allowed.includes(stored) ? stored : allowed[0];

  if (!select) {
    if (stored !== next) {
      uci.set(UCI_PACKAGE, sectionId, "security", next);
    }
    return;
  }

  select.replaceChildren(
    ...allowed.map((security) =>
      E(
        "option",
        { value: security, selected: security === next ? "" : null },
        securityLabel(security),
      ),
    ),
  );
  select.value = next;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

// A camouflage host is picked once per dialog, so the SNI a link carries and the
// FakeTLS host of the same server keep the domain the dialog offered rather than
// each rolling their own.
const camouflageChoice = new Map();

function camouflageSite(sectionId, reroll) {
  if (reroll || !camouflageChoice.has(sectionId)) {
    camouflageChoice.set(sectionId, randomItem(CAMOUFLAGE_SITES));
  }
  return camouflageChoice.get(sectionId);
}

// Puts a value into another field of the open dialog. The widget wins over the
// stored value while the dialog is open, so the value goes there and is checked
// right away; without a mounted widget the write goes to the configuration.
function applyFieldValue(sectionId, name, value) {
  const node = widgetNode(sectionId, name);
  const element = node ? widgetElement(node) : null;

  if (!element) {
    uci.set(UCI_PACKAGE, sectionId, name, value);
    return;
  }

  element.setValue(value);
  if (typeof element.triggerValidation === "function") {
    element.triggerValidation();
  }
  controlOf(node)?.dispatchEvent(new Event("change", { bubbles: true }));
}

// One key pair per dialog: the two fields are loaded separately but have to hold
// halves of the same pair.
const pendingKeypairs = new Map();

function realityKeypair(sectionId) {
  if (getEffectiveSecurity(sectionId) !== "reality") {
    return Promise.resolve(null);
  }

  if (!pendingKeypairs.has(sectionId)) {
    pendingKeypairs.set(
      sectionId,
      generateRealityKeypair(sectionId).finally(() =>
        window.setTimeout(() => pendingKeypairs.delete(sectionId), 0),
      ),
    );
  }
  return pendingKeypairs.get(sectionId);
}

function generateRealityKeypair(sectionId) {
  return fs
    .exec("/usr/bin/forkop", ["generate_reality_keypair"])
    .then((response) => {
      if ((response.code ?? 0) !== 0 || !response.stdout) {
        throw new Error(response.stderr || response.stdout || "");
      }

      const data = JSON.parse(response.stdout);
      if (!data.success || !data.private_key || !data.public_key) {
        throw new Error(data.message || "");
      }

      return data;
    })
    .catch((error) => {
      console.warn(error?.message || "Failed to generate a Reality key pair");
      main.showToast(_("Could not generate a Reality key pair"), "error");
      return null;
    });
}

// The subject a client checks, taken from the dialog as it stands: the SNI when
// there is one, otherwise the address the links carry, otherwise the name of the
// server. The section id is never it.
function certificateSubject(sectionId) {
  return (
    liveOption(sectionId, "tls_server_name") ||
    liveOption(sectionId, "public_host") ||
    liveOption(sectionId, "label") ||
    sectionId
  );
}

// Writing files happens when a button is pressed, not while the service starts, and
// the path that was written becomes the value of the field instead of a convention
// only Forkop knows. The certificate and the SSH host key are both issued this way.
function addIssueButton(optionRef, label, request, offered) {
  const renderWidget = optionRef.renderWidget;

  optionRef.renderWidget = function (sectionId, optionIndex, cfgvalue) {
    const node = renderWidget.call(this, sectionId, optionIndex, cfgvalue);
    const readonly = this.readonly != null ? this.readonly : this.map.readonly;
    const button = E(
      "button",
      {
        class: "btn cbi-button cbi-button-neutral fkp-generate",
        type: "button",
        title: label,
        "aria-label": label,
        disabled: readonly ? "" : null,
      },
      iconSvg("generate"),
    );

    button.addEventListener("click", (ev) => {
      ev.preventDefault();

      if (readonly) {
        return;
      }

      button.disabled = true;
      request(sectionId, node)
        .catch((error) => {
          console.warn(error?.message || "Failed to issue the file");
        })
        .finally(() => {
          button.disabled = readonly ? true : false;
        });
    });

    const row = E("div", { class: "fkp-generate-row" }, [node, button]);
    if (typeof offered === "function") {
      showIssueButton(row, offered(getProtocol(sectionId)));
    }

    return row;
  };
}

// The button is built once, with whatever protocol the dialog held at that moment,
// and a later protocol change only shows and hides the fields - LuCI does not build
// them again. So the button is shown and hidden the same way instead of being decided
// at render time: a server that started as Mixed and became NaiveProxy kept a button
// an existing NaiveProxy server never had.
//
// Inline, because the rule that lays the button out inside the row is a class
// selector and would win over [hidden]; the column goes with it, or its gap stays
// behind an input that now fills the row.
function showIssueButton(row, shown) {
  const button = row.querySelector(".fkp-generate");
  if (!button) {
    return;
  }

  button.style.display = shown ? "" : "none";
  row.style.gridTemplateColumns = shown ? "" : "minmax(0,1fr)";
}

// The certificate Forkop issues is self-signed, and a NaiveProxy client verifies it
// the way a browser does, so pressing the button there would only build a listener no
// client reaches. The two path fields stay, for a certificate of your own.
function offersCertificateButton(protocol) {
  return protocol !== "naive";
}

function syncCertificateButton(sectionId, protocol) {
  const node = widgetNode(sectionId, "tls_certificate_path");
  if (node && node.parentNode) {
    showIssueButton(node.parentNode, offersCertificateButton(protocol));
  }
}

function issueRequest(verb, args, onResult) {
  return fs.exec("/usr/bin/forkop", [verb, ...args]).then((response) => {
    if ((response.code ?? 0) !== 0 || !response.stdout) {
      throw new Error(response.stderr || response.stdout || "");
    }
    const data = JSON.parse(response.stdout);
    if (!data.success) {
      throw new Error(data.message || "");
    }
    onResult(data);
  });
}

function addCertificateButton(optionRef) {
  addIssueButton(
    optionRef,
    _("Generate a certificate"),
    (sectionId) =>
      issueRequest(
        "generate_server_certificate",
        // The section id, not the display name: a name has to be sanitised to be a
        // file name, and two servers named in Cyrillic would sanitise to the same one.
        [certificateSubject(sectionId), sectionId],
        (data) => {
          if (!data.certificate_path || !data.key_path) {
            throw new Error("");
          }
          applyFieldValue(sectionId, "tls_certificate_path", data.certificate_path);
          applyFieldValue(sectionId, "tls_key_path", data.key_path);
          main.showToast(_("Certificate generated"), "success");
        },
      ).catch((error) => {
        main.showToast(_("Could not generate a certificate"), "error");
        throw error;
      }),
    offersCertificateButton,
  );
}

// One key. An SSH server can hold several so that an old client finds an algorithm
// it knows, but AddHostKey replaces a key of the same type instead of adding it, and
// Forkop only issues ed25519 - so a second generated key would silently take the
// place of the first. Every client that reaches a proxy inbound has known ed25519
// for a decade; a second algorithm belongs in a JSON inbound.
function addSshHostKeyButton(optionRef) {
  addIssueButton(optionRef, _("Generate a host key"), (sectionId) =>
    issueRequest(
      "generate_ssh_host_key",
      [sectionId],
      (data) => {
        if (!data.key_path) {
          throw new Error("");
        }
        applyFieldValue(sectionId, "ssh_host_key_path", data.key_path);
        main.showToast(_("Host key generated"), "success");
      },
    ).catch((error) => {
      main.showToast(_("Could not generate a host key"), "error");
      throw error;
    }),
  );
}

function addRealityKeypairButton(optionRef) {
  const renderWidget = optionRef.renderWidget;

  optionRef.renderWidget = function (sectionId, optionIndex, cfgvalue) {
    const node = renderWidget.call(this, sectionId, optionIndex, cfgvalue);
    const label = _("Generate a key pair");
    const readonly = this.readonly != null ? this.readonly : this.map.readonly;
    const button = E(
      "button",
      {
        class: "btn cbi-button cbi-button-neutral fkp-generate",
        type: "button",
        title: label,
        "aria-label": label,
        disabled: readonly ? "" : null,
      },
      iconSvg("generate"),
    );

    button.addEventListener("click", (ev) => {
      ev.preventDefault();

      if (readonly) {
        return;
      }

      generateRealityKeypair(sectionId).then((pair) => {
        if (!pair) {
          return;
        }
        [
          ["reality_private_key", pair.private_key],
          ["reality_public_key", pair.public_key],
        ].forEach(([name, value]) =>
          applyFieldValue(sectionId, name, value),
        );
      });
    });

    return E("div", { class: "fkp-generate-row" }, [node, button]);
  };
}

/* ---------------------------------------------------------- section behaviour */

function isRoutingSectionAction(action) {
  return ROUTING_SECTION_ACTIONS.indexOf(`${action || ""}`) !== -1;
}

// Sections a server may hand its traffic to, as value and label pairs.
function routingSectionChoices() {
  return (uci.sections(UCI_PACKAGE, "section") || [])
    .filter(
      (section) =>
        section[".name"] &&
        section.enabled !== "0" &&
        isRoutingSectionAction(section.action),
    )
    .map((section) => [section[".name"], section.label || section[".name"]]);
}

function loadRoutingSectionChoices(optionRef) {
  optionRef.keylist = [];
  optionRef.vallist = [];
  routingSectionChoices().forEach(([value, label]) =>
    optionRef.value(value, label),
  );

  return Promise.resolve();
}

function tailscaleDetourTargets(currentSectionId) {
  return (uci.sections(UCI_PACKAGE, "section") || []).filter(
    (section) =>
      section[".name"] &&
      section[".name"] !== currentSectionId &&
      section.enabled !== "0" &&
      TAILSCALE_DETOUR_ACTIONS.includes(section.action || ""),
  );
}

function loadServerTableOptions(sectionRef) {
  const tasks = [];

  sectionRef.cfgsections().forEach((sectionId) => {
    sectionRef.children.forEach((child) => {
      if (child.disable || child.modalonly) {
        return;
      }
      tasks.push(
        Promise.resolve(child.load.call(child, sectionId)).then((value) =>
          child.cfgvalue(sectionId, value),
        ),
      );
    });
  });

  return Promise.all(tasks);
}

// The word on a row action button. LuCI's own catalog owns the "Edit" msgid and
// translates it as "Редактировать", which is too long for a table cell beside the
// other actions, and Forkop ships no English catalog - so a msgid is also the
// English text. Hence a Forkop msgid, which carries the short Russian word, and the
// English word written out here for when the catalog hands that msgid straight back.
// Changing the msgid means changing the string it is compared against.
//
// The Sections tab shows the same button. Its rows are configured from forkop.js,
// which already builds this tab through this module, so it takes the label from here
// instead of keeping a second copy of the comparison.
function getRuleEditButtonText() {
  const label = _("Edit rule action");

  return label === "Edit rule action" ? "Edit" : label;
}

function renderServerRowActions(sectionRef, sectionId) {
  const editLabel = getRuleEditButtonText();
  const detailsLabel = _("Server details");
  const tdEl = E(
    "td",
    { class: "td cbi-section-table-cell nowrap cbi-section-actions" },
    E("div"),
  );
  const actionsEl = tdEl.lastElementChild;

  // Only a server whose accounts can be handed a link has anything to show: SSH has
  // no share link format, and Tailscale and a JSON inbound have no accounts at all.
  if (usesClients(getProtocol(sectionId)) && linkScheme(getProtocol(sectionId))) {
    dom.append(
      actionsEl,
      E(
        "button",
        {
          class: "cbi-button center fkp-server-info",
          title: detailsLabel,
          "aria-label": detailsLabel,
          style: "display:inline-block;",
          click: (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            showServerDetailsModal(sectionId, listClients(sectionId));
          },
        },
        E("span", { class: "fkp-server-info__glyph" }, "ⓘ"),
      ),
    );
  }

  dom.append(
    actionsEl,
    E(
      "button",
      {
        title: editLabel,
        class: "btn cbi-button cbi-button-edit",
        click: ui.createHandlerFn(
          sectionRef,
          "renderMoreOptionsModal",
          sectionId,
        ),
      },
      editLabel,
    ),
  );

  if (sectionRef.addremove) {
    dom.append(
      actionsEl,
      E(
        "button",
        {
          title: _("Delete"),
          class: "btn cbi-button cbi-button-remove",
          click: ui.createHandlerFn(sectionRef, "handleRemove", sectionId),
          disabled: sectionRef.map.readonly || null,
        },
        _("Delete"),
      ),
    );
  }

  return tdEl;
}

function configureServerSection(sectionRef) {
  sectionRef.sortable = false;
  sectionRef.nodescriptions = true;
  sectionRef.load = function () {
    // The table renders only non-modal fields; the cloned Add/Edit modal loads the
    // rest when the user opens it. The router's own addresses and the ports other
    // services hold are read once here, so the port check can name the owner.
    return Promise.all([
      preloadServerModalData(),
      loadServerTableOptions(this),
    ]);
  };

  sectionRef.handleAdd = function () {
    const sectionId = this.addLabeledSection();
    const mapNode = this.getPreviousModalMap();
    const prevMap = mapNode ? dom.findClassInstance(mapNode) : this.map;

    prevMap.addedSection = sectionId;
    // The section exists from the moment Add is pressed, and a dialog that is never
    // finished leaves it behind. Nothing writes the switch until the dialog is
    // saved, and a server without one counts as disabled, so an unfinished server
    // is inert: the validator and the generator skip it. The dialog still shows
    // the switch on, because that is what saving it writes.
    addedServers.add(sectionId);
    uci.set(UCI_PACKAGE, sectionId, "protocol", DEFAULT_PROTOCOL);
    uci.set(
      UCI_PACKAGE,
      sectionId,
      "security",
      defaultSecurity(DEFAULT_PROTOCOL),
    );

    return this.renderMoreOptionsModal(sectionId);
  };

  // Removing a server takes its clients with it, otherwise they stay behind as
  // sections pointing at a server that no longer exists.
  sectionRef.handleRemove = function (sectionId, ev) {
    removeServerClients(sectionId);

    return form.GridSection.prototype.handleRemove.call(this, sectionId, ev);
  };

  sectionRef.handleModalSave = function (modalMap, ev) {
    const mapNode = this.getActiveModalMap();
    const activeMap = dom.findClassInstance(mapNode);
    const sectionId = modalMap?.section || activeMap.section;

    return activeMap
      .parse()
      .then(() => {
        addedServers.delete(sectionId);

        return form.GridSection.prototype.handleModalSave.call(
          this,
          modalMap,
          ev,
        );
      })
      // A rejected check already marks its own field and the dialog stays open,
      // but that first pass wrote every field that did pass, the switch among
      // them. A server that never got through its checks goes back to disabled,
      // so leaving the page with the dialog open cannot stop the service.
      .catch(() => {
        if (addedServers.has(sectionId)) {
          uci.unset(UCI_PACKAGE, sectionId, "enabled");
        }

        return null;
      });
  };

  sectionRef.renderRowActions = function (sectionId) {
    return renderServerRowActions(this, sectionId);
  };
}

/* ---------------------------------------------------------------------- form */

// A value the dialog fills in by itself. LuCI keeps whatever load() returned as
// the stored value of an option, so an untouched autofilled field compares equal
// on save and would never reach the configuration: a fresh server ended up with
// no port, no public host and no Reality identity, and the service then refused
// the whole configuration. forcewrite makes the save write it.
function autofill(option, loader) {
  option.forcewrite = true;
  option.load = loader;
}

function addIdentityOptions(section) {
  let o = section.option(form.Flag, "enabled", _("Enable"));
  o.default = "1";
  o.rmempty = false;
  o.editable = true;
  o.width = "6rem";

  o = section.option(form.DummyValue, "_protocol_display", _("Protocol"));
  o.modalonly = false;
  o.textvalue = (sectionId) => protocolLabel(getProtocol(sectionId));
  o.cfgvalue = o.textvalue;
  o.width = "9rem";

  o = section.option(
    form.Value,
    "label",
    _("Server name"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = function (sectionId, value) {
    const required = validateRequiredText(sectionId, value);
    if (required !== true) {
      return required;
    }

    const name = `${value}`.trim();
    if (name.includes("/")) {
      return _("The name must not contain /");
    }
    if (RESERVED_RUNTIME_TAGS.has(name)) {
      return _("This name is reserved by Forkop");
    }

    return [
      ...(uci.sections(UCI_PACKAGE, "server") || []),
      ...(uci.sections(UCI_PACKAGE, "section") || []),
    ].some(
      (item) =>
        item[".name"] !== sectionId &&
        `${item.label || item[".name"] || ""}`.trim() === name,
    )
      ? _("This name is already taken")
      : true;
  };

  o = section.option(
    form.ListValue,
    "protocol",
    _("Protocol"),
  );
  PROTOCOLS.forEach((entry) => o.value(entry.id, entry.label));
  o.default = DEFAULT_PROTOCOL;
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validateRequired;
  o.onchange = function (_ev, sectionId, value) {
    syncSecurityChoices(sectionId, value, true);
    syncCertificateButton(sectionId, value);
    // A client of the previous protocol holds credentials the new one cannot use,
    // and a half converted account only fails on save. The list starts over.
    clearClientList(this.map, sectionId);
  };
}

function addTailscaleOptions(section) {
  const onTailscale = (o) => o.depends("protocol", "tailscale");

  let o = section.option(
    form.Value,
    "tailscale_auth_key",
    _("Authorization key"),
    _("A key from the Tailscale console"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.password = true;
  o.validate = validateRequired;
  onTailscale(o);

  o = section.option(
    form.Value,
    "tailscale_hostname",
    _("Device name"),
    _("The name this device appears under in the Tailscale console"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validateTailscaleHostname;
  onTailscale(o);

  o = section.option(
    form.DynamicList,
    "tailscale_advertise_routes",
    _("Advertise routes"),
    _("Local subnets the rest of the network may reach through this router"),
  );
  o.placeholder = "192.168.1.0/24";
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalCidrOrIp;
  onTailscale(o);

  o = section.option(
    form.Flag,
    "tailscale_accept_routes",
    _("Accept routes"),
    _("Use subnets other devices share"),
  );
  o.default = "0";
  o.rmempty = true;
  o.modalonly = true;
  onTailscale(o);

  o = section.option(
    form.Flag,
    "tailscale_ephemeral",
    _("Ephemeral node"),
    _("Remove the node from the network once it goes offline"),
  );
  o.default = "0";
  o.rmempty = true;
  o.modalonly = true;
  onTailscale(o);

  o = section.option(
    form.Value,
    "tailscale_control_url",
    _("Coordination server"),
    _(
      "Address of the coordination server. Change it if you use a custom server",
    ),
  );
  o.default = "https://controlplane.tailscale.com";
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validateHttpUrl;
  onTailscale(o);

  o = section.option(
    form.Flag,
    "tailscale_detour_enabled",
    _("Coordination server through a section"),
    _("Reach the coordination server through a section instead of the WAN"),
  );
  o.default = "0";
  o.rmempty = false;
  o.modalonly = true;
  onTailscale(o);

  o = section.option(
    form.ListValue,
    "tailscale_detour_section",
    _("Coordination server through"),
    _("Required. The section that carries the control-plane traffic"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.depends({ protocol: "tailscale", tailscale_detour_enabled: "1" });
  o.load = function (sectionId) {
    this.keylist = [];
    this.vallist = [];
    tailscaleDetourTargets(sectionId).forEach((target) =>
      this.value(target[".name"], target.label || target[".name"]),
    );
    return option(sectionId, "tailscale_detour_section");
  };
  o.validate = function (sectionId, value) {
    if (!value) {
      return _("Select a section");
    }
    if (value === sectionId) {
      return _("A server cannot use itself");
    }
    return tailscaleDetourTargets(sectionId).some(
      (target) => target[".name"] === value,
    )
      ? true
      : _("Select a section");
  };
}

// Shown greyed out in the JSON inbound editor: the smallest inbound
// validateInboundJson accepts. The tag is left out because Forkop writes the
// server name over it.
const JSON_INBOUND_PLACEHOLDER = [
  "{",
  '  "type": "mixed",',
  '  "listen": "0.0.0.0",',
  '  "listen_port": 1080',
  "}",
].join("\n");

function addJsonInboundOptions(section) {
  const o = section.option(
    form.TextValue,
    "inbound_json",
    _("JSON Inbound"),
  );
  o.depends("protocol", "json_inbound");
  o.placeholder = JSON_INBOUND_PLACEHOLDER;
  o.rows = 10;
  o.wrap = "soft";
  o.textarea = true;
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validateInboundJson;
  // Its own copy, for the same reason the reserved tag list is not imported: a
  // browser can hold an old section.js next to this file.
  configureTextareaOption(o, { pinHeight: true });
}

function addListenerOptions(section) {
  const onListener = (o) =>
    listenerProtocols().forEach((protocol) => o.depends("protocol", protocol));

  let o = section.option(
    form.Value,
    "listen",
    _("Listen address"),
  );
  o.placeholder = "0.0.0.0";
  o.default = "0.0.0.0";
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validateListenAddress;
  onListener(o);

  o = section.option(
    form.Value,
    "listen_port",
    _("Listen port"),
  );
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validateListenPort;
  autofill(o, (sectionId) => option(sectionId, "listen_port") || randomPort());
  onListener(o);
  addGenerateButton(o, () => randomPort(), _("Pick a free port"));

  o = section.option(
    form.Value,
    "public_host",
    _("Public address"),
    _("The address the connection links point at"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validateHost;
  onListener(o);
  autofill(o, function (sectionId) {
    const stored = option(sectionId, "public_host");
    return stored ? stored : loadDefaultPublicHost().then((host) => host || "");
  });

  // Without this the listener answers only on the LAN: the WAN zone of an OpenWrt
  // firewall rejects everything it was not told to accept, so a server made to be
  // dialled from outside would silently never be reached.
  o = section.option(
    form.Flag,
    "open_firewall",
    _("Open the port"),
    _("Allows incoming connections to this port from the internet"),
  );
  o.default = "1";
  o.rmempty = false;
  o.modalonly = true;
  onListener(o);
}

function addShadowsocksOptions(section) {
  let o = section.option(
    form.ListValue,
    "shadowsocks_method",
    _("Method"),
    );
  SHADOWSOCKS_METHODS.forEach((method) => o.value(method.id, method.id));
  o.default = SHADOWSOCKS_METHODS[0].id;
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validateRequired;
  o.depends("protocol", "shadowsocks");

  o = section.option(
    form.Value,
    "shadowsocks_psk",
    _("Server key"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.password = true;
  o.validate = validateShadowsocksPassword;
  SHADOWSOCKS_METHODS.filter((method) => method.keyBytes > 0).forEach(
    (method) =>
      o.depends({ protocol: "shadowsocks", shadowsocks_method: method.id }),
  );
  autofill(
    o,
    (sectionId) =>
      option(sectionId, "shadowsocks_psk") ||
      generatePresharedKey(
        shadowsocksKeyBytes(getShadowsocksMethod(sectionId)) || 32,
      ),
  );
  addGenerateButton(o, (sectionId) =>
    generatePresharedKey(
      shadowsocksKeyBytes(getShadowsocksMethod(sectionId)) || 32,
    ),
  );
}

function addMixedOptions(section) {
  const o = section.option(
    form.Flag,
    "mixed_auth_enabled",
    _("Authentication"),
    _("Require a login and password to connect to the server"),
  );
  // On by default: a listener that asks for nothing is an open proxy, and the port
  // is opened in the firewall by default too.
  o.default = "1";
  o.rmempty = false;
  o.modalonly = true;
  o.depends("protocol", "mixed");
  // An inbound with no users accepts everybody, so the accounts of a Mixed server
  // are removed with the switch instead of lingering as credentials nobody sends.
  o.onchange = function (_ev, sectionId, value) {
    if (String(value) !== "1") {
      clearClientList(this.map, sectionId);
    }
  };
}

function addHysteria2Options(section) {
  const onHysteria2 = (o) => o.depends("protocol", "hysteria2");

  let o = section.option(
    form.ListValue,
    "hysteria2_obfs_type",
    _("Obfuscation"),
  );
  o.value("", _("None"));
  o.value("salamander", "salamander");
  o.default = "";
  o.rmempty = true;
  o.modalonly = true;
  onHysteria2(o);

  o = section.option(
    form.Value,
    "hysteria2_obfs_password",
    _("Obfuscation password"),
    _("Required. Every client has to send the same value"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.password = true;
  o.validate = validateRequiredText;
  autofill(
    o,
    (sectionId) =>
      option(sectionId, "hysteria2_obfs_password") || generatePassword(),
  );
  o.depends({ protocol: "hysteria2", hysteria2_obfs_type: "salamander" });
  addGenerateButton(o, () => generatePassword());

  o = section.option(
    form.Value,
    "hysteria2_up_mbps",
    _("Upload, Mbps"),
  );
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalPositiveInteger;
  onHysteria2(o);

  o = section.option(
    form.Value,
    "hysteria2_down_mbps",
    _("Download, Mbps"),
  );
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalPositiveInteger;
  onHysteria2(o);

  o = section.option(
    form.Flag,
    "hysteria2_ignore_client_bandwidth",
    _("Ignore client bandwidth"),
  );
  o.default = "0";
  o.rmempty = true;
  o.modalonly = true;
  onHysteria2(o);

  o = section.option(
    form.Value,
    "hysteria2_masquerade",
    _("Masquerade"),
    );
  o.placeholder = "https://example.com";
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalMasquerade;
  onHysteria2(o);
}

function addTuicOptions(section) {
  const onTuic = (o) => o.depends("protocol", "tuic");

  let o = section.option(
    form.ListValue,
    "tuic_congestion_control",
    _("Congestion control"),
  );
  ["cubic", "new_reno", "bbr"].forEach((value) => o.value(value, value));
  o.default = "cubic";
  o.rmempty = false;
  o.modalonly = true;
  onTuic(o);

  o = section.option(
    form.Value,
    "tuic_heartbeat",
    _("Heartbeat"),
  );
  o.placeholder = "10s";
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalDuration;
  onTuic(o);

  o = section.option(
    form.Flag,
    "tuic_zero_rtt_handshake",
    _("0-RTT handshake"),
    );
  o.default = "0";
  o.rmempty = true;
  o.modalonly = true;
  onTuic(o);
}

function addProtocolOptions(section) {
  let o = section.option(
    form.ListValue,
    "naive_network",
    _("Network"),
  );
  o.value("tcp", "TCP (HTTP/2)");
  o.value("udp", "UDP (HTTP/3)");
  o.value("tcp_udp", _("TCP and UDP"));
  o.default = "tcp";
  o.rmempty = false;
  o.modalonly = true;
  o.depends("protocol", "naive");

  o = section.option(
    form.Value,
    "ssh_host_key_path",
    _("SSH host key path"),
    _("Required. Create a new key with the button"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = function (sectionId, value) {
    const required = validateRequiredText(sectionId, value);
    return required === true ? validateFilePath(sectionId, value) : required;
  };
  o.depends("protocol", "ssh");
  addSshHostKeyButton(o);

  o = section.option(
    form.ListValue,
    "mieru_transport",
    _("Transport"),
  );
  o.value("TCP", "TCP");
  o.value("UDP", "UDP");
  o.default = "TCP";
  o.rmempty = false;
  o.modalonly = true;
  o.depends("protocol", "mieru");
}

// One field. The proxy has no secret without a camouflage host - it is the second
// half of what the client sends - and everything else mtg takes has a working
// default: concurrency, the preferred address family, the fronting target and the
// three timeouts. A deployment that has to change one of them writes a JSON
// inbound; a router owner never does.
function addMtprotoOptions(section) {
  const o = section.option(
    form.Value,
    "mtproto_faketls",
    _("FakeTLS host"),
    _("The domain a client sends in the TLS handshake"),
  );
  o.placeholder = "google.com";
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validateHost;
  autofill(
    o,
    (sectionId) => option(sectionId, "mtproto_faketls") || camouflageSite(sectionId),
  );
  o.depends("protocol", "mtproto");
  addGenerateButton(
    o,
    (sectionId) => camouflageSite(sectionId, true),
    _("Pick a domain"),
  );
}

function addSecurityOptions(section) {
  const streamProtocols = protocolsWith("transport");
  const tlsOnlyProtocols = protocolsWhere(
    (entry) => entry.securities.length === 1 && entry.securities[0] === "tls",
  );
  const onTls = (o) => {
    streamProtocols.forEach((protocol) =>
      o.depends({ protocol, security: "tls" }),
    );
    tlsOnlyProtocols.forEach((protocol) => o.depends("protocol", protocol));
  };
  const onReality = (o) =>
    o.depends({ protocol: "vless", security: "reality" });

  let o = section.option(
    form.ListValue,
    "security",
    _("Security"),
  );
  o.value("reality", "Reality");
  o.value("tls", "TLS");
  o.value("none", _("None"));
  o.rmempty = false;
  o.modalonly = true;
  // The backend keeps this option saying which mode the protocol actually runs
  // with, including for the protocols that have no field here. Without retain the
  // dialog would delete it on every save of such a server and the next apply
  // would write it back, reporting a change nobody made, for ever.
  o.retain = true;
  [...streamProtocols, ...tlsOnlyProtocols].forEach((protocol) =>
    o.depends("protocol", protocol),
  );
  o.validate = validateSecurity;
  {
    const renderWidget = o.renderWidget;
    o.renderWidget = function (sectionId, optionIndex, cfgvalue) {
      const node = renderWidget.call(this, sectionId, optionIndex, cfgvalue);
      window.setTimeout(() => syncSecurityChoices(sectionId), 0);
      return node;
    };
  }

  o = section.option(
    form.Value,
    "tls_server_name",
    _("SNI"),
    _("The domain a client sends in the TLS handshake"),
  );
  o.placeholder = "example.com";
  o.modalonly = true;
  o.rmempty = true;
  o.validate = function (sectionId, value) {
    if (isEmptyValue(value)) {
      return getEffectiveSecurity(sectionId) === "reality"
        ? _("Reality needs an SNI")
        : true;
    }
    return validateHost(sectionId, value);
  };
  autofill(
    o,
    (sectionId) => option(sectionId, "tls_server_name") || camouflageSite(sectionId),
  );
  onTls(o);
  onReality(o);
  addGenerateButton(
    o,
    (sectionId) => camouflageSite(sectionId, true),
    _("Pick a domain"),
  );

  // Only where the listener leaves the choice open. Hysteria2 negotiates h3 and
  // NaiveProxy h2 on their own - both replace an empty list and fight a filled one -
  // and a TUIC client never looks at it.
  o = section.option(
    form.MultiValue,
    "tls_alpn",
    _("ALPN"),
  );
  ["h3", "h2", "http/1.1"].forEach((value) => o.value(value, value));
  o.create = false;
  o.rmempty = true;
  o.modalonly = true;
  ALPN_PROTOCOLS.forEach((protocol) =>
    protocolSpec(protocol).securities.includes("none")
      ? o.depends({ protocol, security: "tls" })
      : o.depends("protocol", protocol),
  );
  onReality(o);

  o = section.option(
    form.Value,
    "tls_certificate_path",
    _("Certificate path"),
    _("A certificate issued for this address"),
  );
  addCertificateButton(o);
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validateTlsCertificatePath;
  onTls(o);

  o = section.option(
    form.Value,
    "tls_key_path",
    _("Key path"),
    _("The private key of the certificate"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validateTlsKeyPath;
  onTls(o);

  o = section.option(
    form.Value,
    "reality_private_key",
    _("Reality private key"),
    _("Required. Generate a pair with the button"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.password = true;
  o.validate = validateRealityKey;
  autofill(
    o,
    (sectionId) =>
      option(sectionId, "reality_private_key") ||
      realityKeypair(sectionId).then((pair) => (pair ? pair.private_key : "")),
  );
  onReality(o);
  addRealityKeypairButton(o);

  o = section.option(
    form.Value,
    "reality_public_key",
    _("Reality public key"),
    _("Filled in together with the private key"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validateRealityKey;
  autofill(
    o,
    (sectionId) =>
      option(sectionId, "reality_public_key") ||
      realityKeypair(sectionId).then((pair) => (pair ? pair.public_key : "")),
  );
  onReality(o);

  o = section.option(
    form.Value,
    "reality_short_id",
    _("Reality short ID"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validateShortId;
  autofill(
    o,
    // A configuration written before this was one field keeps its first value.
    (sectionId) =>
      optionList(sectionId, "reality_short_id")[0] || randomHex(4),
  );
  onReality(o);
  addGenerateButton(o, () => randomHex(4));

  o = section.option(
    form.ListValue,
    "client_fingerprint",
    _("Client fingerprint"),
    );
  o.value("", _("Not set"));
  CLIENT_FINGERPRINTS.forEach((value) => o.value(value, value));
  o.default = "chrome";
  o.rmempty = true;
  o.modalonly = true;
  onReality(o);
}

function addTransportOptions(section) {
  const streamProtocols = protocolsWith("transport");
  const onTransport = (o, transport) =>
    streamProtocols.forEach((protocol) => o.depends({ protocol, transport }));

  let o = section.option(
    form.ListValue,
    "transport",
    _("Transport"),
  );
  TRANSPORTS.forEach(([value, label]) => o.value(value, label));
  o.default = "tcp";
  o.rmempty = false;
  o.modalonly = true;
  streamProtocols.forEach((protocol) => o.depends("protocol", protocol));

  o = section.option(
    form.Value,
    "transport_path",
    _("Transport path"),
  );
  o.placeholder = "/ws";
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateTransportPath;
  ["ws", "http", "httpupgrade", "xhttp"].forEach((transport) =>
    onTransport(o, transport),
  );

  o = section.option(
    form.Value,
    "transport_host",
    _("Transport host"),
  );
  o.placeholder = "example.com";
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalHost;
  ["ws", "httpupgrade", "xhttp"].forEach((transport) =>
    onTransport(o, transport),
  );

  o = section.option(
    form.DynamicList,
    "transport_hosts",
    _("HTTP hosts"),
  );
  o.placeholder = "example.com";
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalHostList;
  onTransport(o, "http");

  o = section.option(
    form.Value,
    "transport_service_name",
    _("gRPC service"),
  );
  o.placeholder = "grpc";
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateGrpcServiceName;
  onTransport(o, "grpc");

  o = section.option(
    form.ListValue,
    "transport_xhttp_mode",
    _("XHTTP mode"),
  );
  ["auto", "packet-up", "stream-up", "stream-one"].forEach((value) =>
    o.value(value, value),
  );
  o.default = "auto";
  o.rmempty = false;
  o.modalonly = true;
  onTransport(o, "xhttp");
}

function addTuningOptions(section) {
  const o = section.option(form.Flag, "tcp_fast_open", _("TCP Fast Open"));
  o.default = "0";
  o.rmempty = true;
  o.modalonly = true;
  protocolsWith("tcp").forEach((protocol) => o.depends("protocol", protocol));
}

function addMultiplexOptions(section) {
  const multiplexProtocols = protocolsWith("multiplex");
  const onMultiplex = (o, extra) =>
    multiplexProtocols.forEach((protocol) =>
      o.depends(Object.assign({ protocol }, extra || {})),
    );

  let o = section.option(
    form.Flag,
    "multiplex_enabled",
    _("Multiplex"),
  );
  o.default = "0";
  o.rmempty = true;
  o.modalonly = true;
  onMultiplex(o);

  o = section.option(
    form.Flag,
    "multiplex_padding",
    _("Padding"),
  );
  o.default = "0";
  o.rmempty = true;
  o.modalonly = true;
  onMultiplex(o, { multiplex_enabled: "1" });

}

function addClientListOption(section) {
  const o = section.option(
    sectionui.ButtonAddSettingsDynamicList,
    "clients",
    _("Clients"),
    _("Required. The clients that may connect"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.addButtonLabel = _("+ Add client");
  o.childType = CLIENT_TYPE;
  o.ownerOption = CLIENT_OWNER_OPTION;
  o.childValueOption = "name";
  o.createId = () => nextSectionId(CLIENT_TYPE);
  // A Mixed inbound only has accounts while it asks for them; every other
  // protocol always does.
  protocolsWhere((entry) => usesClients(entry.id)).forEach((protocol) =>
    protocol === "mixed"
      ? o.depends({ protocol, mixed_auth_enabled: "1" })
      : o.depends("protocol", protocol),
  );
  // Without this the list shows the child section id of every stored client: the
  // widget item carries the id as its value and falls back to it for the label.
  o.renderListItemLabel = function (sectionId, value) {
    return this.inputValueForItem(sectionId, value);
  };
  o.renderItemSettingsModal = showClientSettingsModal;
  o.hasItemSettings = (_sectionId, value) => `${value || ""}`.trim().length > 0;
  o.inputValueForItem = function (sectionId, value) {
    const name = sectionui.childItemInputValue(
      sectionId,
      value,
      CLIENT_TYPE,
      "name",
      CLIENT_OWNER_OPTION,
    );
    const store = sectionui.childPendingSettingsStore(this, sectionId);
    return store && store[name] && store[name].name ? store[name].name : name;
  };
  o.stagedChildSettings = function (sectionId, value) {
    const name = this.inputValueForItem(sectionId, value);
    const store = sectionui.childPendingSettingsStore(this, sectionId);
    return store && store[name] ? Object.assign({}, store[name]) : null;
  };
  o.clearStagedChildSettings = function (sectionId) {
    if (this.pendingChildSettings) {
      delete this.pendingChildSettings[sectionId];
    }
  };
  // Credentials the protocol stopped using are dropped once the list is written, so
  // switching protocol never leaves a stale password behind.
  o.afterMaterializeChildItems = function (sectionId) {
    pruneClientCredentials(sectionId);
  };
  // An empty list is reported by the option's own check, the way the Sections tab
  // asks for at least one server group; the per client checks run on save.
  o.validate = function (sectionId, value) {
    if (`${value || ""}`.trim()) {
      return true;
    }

    const current =
      typeof this.formvalue === "function" ? this.formvalue(sectionId) : [];
    return (Array.isArray(current) ? current : [current]).filter(Boolean).length
      ? true
      : _("Add at least one client");
  };
  o.validateItemsOnSave = function (sectionId, values) {
    return validateClientsOnSave(sectionId, values, this);
  };
}

function addRoutingOptions(section) {
  let o = section.option(
    form.ListValue,
    "routing_mode",
    _("Routing mode"),
    _("Where to send the traffic from this server"),
  );
  o.value("rules", _("Rules"));
  o.value("direct", _("Direct"));
  o.value("section", _("Section"));
  o.default = "rules";
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validateRequired;

  o = section.option(
    form.ListValue,
    "routing_section",
    _("Routing section"),
    _("Required. Where the traffic of this server leaves"),
  );
  o.depends("routing_mode", "section");
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validateRequired;
  o.cfgvalue = (sectionId) => option(sectionId, "routing_section");
  o.load = function () {
    return loadRoutingSectionChoices(this);
  };
}

function createServerContent(section) {
  injectServerStyles();

  // Reading order: what the server is, who may connect, where their traffic goes,
  // then how it is protected and carried. The cipher and the authentication switch
  // come before the client list, because they decide what a client needs.
  addIdentityOptions(section);
  addTailscaleOptions(section);
  addJsonInboundOptions(section);
  addListenerOptions(section);
  addShadowsocksOptions(section);
  addMixedOptions(section);
  addClientListOption(section);
  addRoutingOptions(section);
  addSecurityOptions(section);
  addTransportOptions(section);
  addTuningOptions(section);
  addMultiplexOptions(section);
  addHysteria2Options(section);
  addTuicOptions(section);
  addProtocolOptions(section);
  addMtprotoOptions(section);
}

return baseclass.extend({
  configureServerSection,
  createServerContent,
  getRuleEditButtonText,
});
