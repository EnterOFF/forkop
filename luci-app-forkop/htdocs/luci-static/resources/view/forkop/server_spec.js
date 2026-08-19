"use strict";
"require uci";
"require baseclass";
"require view.forkop.main as main";
"require view.forkop.server_util as util";

// The single description of every server protocol Forkop can serve: which sing-box
// inbound it becomes, which listener and security options apply, what a client
// needs to connect, and which defaults a fresh server starts with. The form, the
// client editor, the validators and the link builder all read this table instead
// of repeating protocol lists.

const UCI_PACKAGE = main.FORKOP_UCI_PACKAGE;
const DEFAULT_PROTOCOL = "tailscale";

// Tags sing-box already uses for Forkop's own inbounds, outbounds and DNS servers.
// A server label becomes an inbound tag verbatim, so these names are refused.
const RESERVED_RUNTIME_TAGS = new Set([
  "dns-server",
  "fakeip-server",
  "bootstrap-dns-server",
  "dnsmasq-server",
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

// Ports Forkop's own sing-box instance binds. A server that takes one of them
// stops the whole service instead of only failing itself.
const RESERVED_PORTS = new Map([
  ["53", _("Forkop DNS")],
  ["1602", _("Forkop transparent proxy")],
  ["1603", _("Forkop transparent proxy")],
  ["1604", _("Forkop transparent proxy")],
  ["1605", _("Forkop transparent proxy")],
  ["4534", _("Forkop service proxy")],
  ["9090", _("sing-box Clash API")],
]);

const SHADOWSOCKS_METHODS = [
  { id: "2022-blake3-aes-128-gcm", keyBytes: 16 },
  { id: "2022-blake3-aes-256-gcm", keyBytes: 32 },
  { id: "2022-blake3-chacha20-poly1305", keyBytes: 32 },
  { id: "aes-128-gcm", keyBytes: 0 },
  { id: "aes-256-gcm", keyBytes: 0 },
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

const CLIENT_FINGERPRINTS = [
  "chrome",
  "firefox",
  "edge",
  "safari",
  "ios",
  "android",
  "random",
];

// kind:
//   inbound  - a sing-box inbound generated from the form
//   endpoint - a sing-box endpoint (Tailscale)
//   json     - a raw inbound object the user writes
// credentials: which client fields the protocol needs. "login" marks protocols
// where the client name is the account name a client sends, so it has to stay
// inside the ASCII subset every client and URI can carry.
const PROTOCOLS = [
  {
    id: "tailscale",
    label: "Tailscale",
    kind: "endpoint",
    summary: _(
      "Joins the router to your Tailscale network as an exit node. Needs no public address and no port forwarding.",
    ),
    securities: ["none"],
    credentials: [],
  },
  {
    id: "vless",
    label: "VLESS",
    kind: "inbound",
    summary: _(
      "Modern V2Ray protocol. With Reality it needs no domain and no certificate, and a probe sees traffic to the fake site instead.",
    ),
    securities: ["reality", "tls", "none"],
    transport: true,
    multiplex: true,
    credentials: ["uuid", "flow"],
    link: "vless",
  },
  {
    id: "vmess",
    label: "VMess",
    kind: "inbound",
    summary: _(
      "Older V2Ray protocol kept for clients that cannot do VLESS. Prefer VLESS when the client supports it.",
    ),
    securities: ["tls", "none"],
    transport: true,
    multiplex: true,
    credentials: ["uuid"],
    link: "vmess",
  },
  {
    id: "trojan",
    label: "Trojan",
    kind: "inbound",
    summary: _(
      "Indistinguishable from ordinary HTTPS while the certificate is real. Needs a domain and a certificate.",
    ),
    securities: ["tls", "none"],
    transport: true,
    multiplex: true,
    credentials: ["password"],
    link: "trojan",
  },
  {
    id: "shadowsocks",
    label: "Shadowsocks",
    kind: "inbound",
    summary: _(
      "Compact and fast, without TLS. The 2022 methods add replay protection and are the better choice for a new server.",
    ),
    securities: ["none"],
    multiplex: true,
    credentials: ["password"],
    link: "ss",
  },
  {
    id: "hysteria2",
    label: "Hysteria2",
    kind: "inbound",
    summary: _(
      "QUIC based and built for lossy links. UDP has to reach the router, and a certificate is required.",
    ),
    securities: ["tls"],
    credentials: ["password"],
    link: "hysteria2",
  },
  {
    id: "tuic",
    label: "TUIC",
    kind: "inbound",
    summary: _(
      "QUIC based with native UDP relay. UDP has to reach the router, and a certificate is required.",
    ),
    securities: ["tls"],
    credentials: ["uuid", "password"],
    link: "tuic",
  },
  {
    id: "anytls",
    label: "AnyTLS",
    kind: "inbound",
    summary: _(
      "TLS with adaptive padding that hides the packet size pattern. Needs a certificate.",
    ),
    securities: ["tls"],
    credentials: ["password"],
    link: "anytls",
  },
  {
    id: "mixed",
    label: _("SOCKS5 / HTTP"),
    kind: "inbound",
    summary: _(
      "SOCKS5 and HTTP proxy on one port, without encryption. Meant for the local network; do not expose it to the internet.",
    ),
    securities: ["none"],
    login: true,
    optionalAuth: "mixed_auth_enabled",
    credentials: ["password"],
    link: "socks5",
  },
  {
    id: "naive",
    label: "NaiveProxy",
    kind: "inbound",
    summary: _(
      "Chromium network stack over HTTP/2 or HTTP/3. Needs a certificate and the naiveproxy client.",
    ),
    securities: ["tls"],
    login: true,
    credentials: ["password"],
    link: "naive",
  },
  {
    id: "ssh",
    label: "SSH",
    kind: "inbound",
    summary: _(
      "SSH tunnel served by sing-box itself, usable from any SSH client. Independent from the router's own SSH access.",
    ),
    securities: ["none"],
    login: true,
    credentials: ["password", "authorized_keys"],
  },
  {
    id: "mieru",
    label: "Mieru",
    kind: "inbound",
    summary: _(
      "Obfuscated protocol without TLS that hides packet lengths and timing. Needs the Mieru client.",
    ),
    securities: ["none"],
    login: true,
    credentials: ["password"],
  },
  {
    id: "mtproto",
    label: "MTProto",
    kind: "inbound",
    summary: _(
      "Telegram proxy. Only Telegram traffic passes through it, and the link opens directly in the app.",
    ),
    securities: ["none"],
    credentials: ["secret"],
    link: "mtproto",
  },
  {
    id: "json_inbound",
    label: _("JSON inbound"),
    kind: "json",
    summary: _(
      "A sing-box inbound object written by hand, for inbound types this form does not cover. Forkop still applies the routing mode below.",
    ),
    securities: ["none"],
    credentials: [],
  },
];

const PROTOCOL_BY_ID = new Map(
  PROTOCOLS.map((protocol) => [protocol.id, protocol]),
);

function protocolSpec(protocol) {
  return PROTOCOL_BY_ID.get(`${protocol || ""}`) || null;
}

function protocolIds() {
  return PROTOCOLS.map((protocol) => protocol.id);
}

function protocolLabel(protocol) {
  const spec = protocolSpec(protocol);
  return spec ? spec.label : `${protocol || ""}`;
}

function protocolSummary(protocol) {
  const spec = protocolSpec(protocol);
  return spec ? spec.summary : "";
}

function getProtocol(sectionId) {
  return uci.get(UCI_PACKAGE, sectionId, "protocol") || DEFAULT_PROTOCOL;
}

function getServerName(sectionId) {
  return uci.get(UCI_PACKAGE, sectionId, "label") || sectionId;
}

// Protocols that own a listener: everything except the Tailscale endpoint and the
// raw JSON inbound, which carries its own listen fields.
function hasListener(protocol) {
  const spec = protocolSpec(protocol);
  return !!spec && spec.kind === "inbound";
}

function protocolsWithListener() {
  return PROTOCOLS.filter((protocol) => protocol.kind === "inbound").map(
    (protocol) => protocol.id,
  );
}

function protocolsWith(flag) {
  return PROTOCOLS.filter((protocol) => protocol[flag]).map(
    (protocol) => protocol.id,
  );
}

function credentialFields(protocol) {
  const spec = protocolSpec(protocol);
  return spec ? (spec.credentials || []).slice() : [];
}

// Protocols whose client name doubles as the account name sent on the wire.
function usesLoginName(protocol) {
  const spec = protocolSpec(protocol);
  return !!spec && !!spec.login;
}

// Protocols that carry clients at all. Tailscale and raw JSON inbounds do not.
function usesClients(protocol) {
  return credentialFields(protocol).length > 0;
}

function authFlagOption(protocol) {
  const spec = protocolSpec(protocol);
  return spec && spec.optionalAuth ? spec.optionalAuth : "";
}

function isAuthenticationEnabled(sectionId) {
  const option = authFlagOption(getProtocol(sectionId));
  if (!option) {
    return true;
  }

  const value =
    `${uci.get(UCI_PACKAGE, sectionId, option) ?? "1"}`.toLowerCase();
  return !["0", "false", "no", "off"].includes(value);
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

// The security a protocol actually runs with: a stored value that the protocol no
// longer offers falls back to its only sensible choice instead of generating a
// configuration sing-box refuses.
function getEffectiveSecurity(sectionId) {
  const protocol = getProtocol(sectionId);
  const allowed = securitiesFor(protocol);
  const security = uci.get(UCI_PACKAGE, sectionId, "security");

  return allowed.includes(security) ? security : allowed[0];
}

function usesTransport(protocol) {
  const spec = protocolSpec(protocol);
  return !!spec && !!spec.transport;
}

function linkScheme(protocol) {
  const spec = protocolSpec(protocol);
  return spec && spec.link ? spec.link : "";
}

function shadowsocksMethods() {
  return SHADOWSOCKS_METHODS.map((method) => method.id);
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
    uci.get(UCI_PACKAGE, sectionId, "shadowsocks_method") ||
    SHADOWSOCKS_METHODS[0].id
  );
}

function transportChoices() {
  return TRANSPORTS.map(([value, label]) => [value, label]);
}

function clientFingerprints() {
  return CLIENT_FINGERPRINTS.slice();
}

function serverSafeName(sectionId) {
  return `${sectionId || "server"}`.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function defaultTlsCertificatePath(sectionId) {
  return `/etc/forkop/server-certs/${serverSafeName(sectionId)}.crt`;
}

function defaultTlsKeyPath(sectionId) {
  return `/etc/forkop/server-certs/${serverSafeName(sectionId)}.key`;
}

// Tailscale registers the machine under this name, so it is derived from the label
// once and then left alone: re-deriving it on every rename would register a second
// machine in the admin console.
function defaultTailscaleHostname(sectionId) {
  return `forkop-${util.slugify(getServerName(sectionId), serverSafeName(sectionId))}`;
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

function getMtprotoFaketls(sectionId) {
  return uci.get(UCI_PACKAGE, sectionId, "mtproto_faketls") || "google.com";
}

function buildMtprotoFullSecret(baseSecret, faketls) {
  return `ee${baseSecret}${util.stringToHex(faketls || "google.com")}`;
}

// Generates the credential a client field expects for this protocol.
function generateCredential(sectionId, protocol, field) {
  if (field === "uuid") {
    return util.generateUuid();
  }
  if (field === "secret") {
    return util.generateMtprotoSecret();
  }
  if (field === "password") {
    if (protocol === "shadowsocks") {
      const keyBytes = shadowsocksKeyBytes(getShadowsocksMethod(sectionId));
      if (keyBytes > 0) {
        return util.generatePresharedKey(keyBytes);
      }
    }
    return util.generatePassword();
  }
  return "";
}

function setValue(sectionId, key, value) {
  uci.set(UCI_PACKAGE, sectionId, key, value);
}

function setDefault(sectionId, key, value) {
  const current = uci.get(UCI_PACKAGE, sectionId, key);
  if (current == null || current === "") {
    setValue(sectionId, key, value);
  }
}

// The one place server defaults are written. The backend only fills in what it
// alone can produce (Reality key pair, TLS material, SSH host key), so a value
// never has two competing defaults.
function applyProtocolDefaults(sectionId, protocol, forceProtocolDefaults) {
  const entry = protocolSpec(protocol) || protocolSpec(DEFAULT_PROTOCOL);

  setValue(sectionId, "protocol", entry.id);
  setDefault(sectionId, "enabled", "1");
  setDefault(sectionId, "label", sectionId);
  setDefault(sectionId, "routing_mode", "rules");

  if (
    forceProtocolDefaults ||
    !securitiesFor(entry.id).includes(
      uci.get(UCI_PACKAGE, sectionId, "security"),
    )
  ) {
    setValue(sectionId, "security", defaultSecurity(entry.id));
  }

  if (entry.kind === "json") {
    return;
  }

  if (entry.kind === "endpoint") {
    setDefault(
      sectionId,
      "tailscale_control_url",
      "https://controlplane.tailscale.com",
    );
    setDefault(
      sectionId,
      "tailscale_hostname",
      defaultTailscaleHostname(sectionId),
    );
    setDefault(sectionId, "tailscale_advertise_exit_node", "1");
    return;
  }

  setDefault(sectionId, "listen", "0.0.0.0");
  setDefault(sectionId, "listen_port", util.randomPort());
  setDefault(sectionId, "public_host", util.getBrowserHost());
  setDefault(
    sectionId,
    "tls_certificate_path",
    defaultTlsCertificatePath(sectionId),
  );
  setDefault(sectionId, "tls_key_path", defaultTlsKeyPath(sectionId));

  if (usesTransport(entry.id)) {
    if (forceProtocolDefaults) {
      setValue(sectionId, "transport", "tcp");
    } else {
      setDefault(sectionId, "transport", "tcp");
    }
  }

  if (entry.id === "vless") {
    setDefault(sectionId, "tls_server_name", "www.microsoft.com");
    setDefault(sectionId, "client_fingerprint", "chrome");
    setDefault(sectionId, "reality_handshake_server", "www.microsoft.com");
    setDefault(sectionId, "reality_handshake_server_port", "443");
    setDefault(sectionId, "reality_short_id", util.randomHex(4));
    setDefault(sectionId, "reality_max_time_difference", "1m");
  }

  if (entry.id === "shadowsocks") {
    setDefault(sectionId, "shadowsocks_method", SHADOWSOCKS_METHODS[0].id);
    if (isShadowsocks2022(getShadowsocksMethod(sectionId))) {
      setDefault(
        sectionId,
        "shadowsocks_psk",
        util.generatePresharedKey(
          shadowsocksKeyBytes(getShadowsocksMethod(sectionId)),
        ),
      );
    }
  }

  if (entry.id === "mixed") {
    setDefault(sectionId, "mixed_auth_enabled", "1");
  }

  if (entry.id === "naive") {
    setDefault(sectionId, "naive_network", "tcp");
    setDefault(sectionId, "naive_quic_congestion_control", "bbr");
  }

  if (entry.id === "mieru") {
    setDefault(sectionId, "mieru_transport", "TCP");
  }

  if (entry.id === "tuic") {
    setDefault(sectionId, "tuic_congestion_control", "cubic");
    setDefault(sectionId, "tuic_auth_timeout", "3s");
    setDefault(sectionId, "tuic_heartbeat", "10s");
  }

  if (entry.id === "hysteria2") {
    setDefault(sectionId, "hysteria2_obfs_password", util.generatePassword());
  }

  if (entry.id === "mtproto") {
    setDefault(sectionId, "mtproto_faketls", "google.com");
    setDefault(sectionId, "mtproto_domain_fronting_port", "443");
    setDefault(sectionId, "mtproto_prefer_ip", "prefer-ipv4");
    setDefault(sectionId, "mtproto_tolerate_time_skewness", "3s");
    setDefault(sectionId, "mtproto_idle_timeout", "5m");
    setDefault(sectionId, "mtproto_handshake_timeout", "10s");
  }
}

return baseclass.extend({
  DEFAULT_PROTOCOL,
  RESERVED_PORTS,
  RESERVED_RUNTIME_TAGS,
  applyProtocolDefaults,
  buildMtprotoFullSecret,
  clientFingerprints,
  credentialFields,
  defaultSecurity,
  defaultTailscaleHostname,
  defaultTlsCertificatePath,
  defaultTlsKeyPath,
  generateCredential,
  getEffectiveSecurity,
  getMtprotoFaketls,
  getProtocol,
  getServerName,
  getShadowsocksMethod,
  hasListener,
  isAuthenticationEnabled,
  isShadowsocks2022,
  linkScheme,
  normalizeMtprotoBaseSecret,
  protocolIds,
  protocolLabel,
  protocolSummary,
  protocolsWith,
  protocolsWithListener,
  securitiesFor,
  securityLabel,
  shadowsocksKeyBytes,
  shadowsocksMethods,
  transportChoices,
  usesClients,
  usesLoginName,
});
