import {
  DEFAULT_PROTOCOL,
  SERVER_CERT_DIR,
  SHADOWSOCKS_METHODS,
} from './constants';
import { liveOption, option } from './formValues';

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
export const PROTOCOLS = [
  {
    id: 'mixed',
    label: 'Mixed',
    kind: 'inbound',
    securities: ['none'],
    tcp: true,
    login: true,
    optionalAuth: 'mixed_auth_enabled',
    credentials: ['password'],
    link: 'socks5',
  },
  {
    id: 'tailscale',
    label: 'Tailscale',
    kind: 'endpoint',
    securities: ['none'],
    credentials: [],
  },
  {
    id: 'vless',
    label: 'VLESS',
    kind: 'inbound',
    securities: ['reality', 'tls', 'none'],
    transport: true,
    multiplex: true,
    tcp: true,
    credentials: ['uuid', 'flow'],
    link: 'vless',
  },
  {
    id: 'vmess',
    label: 'VMess',
    kind: 'inbound',
    securities: ['tls', 'none'],
    transport: true,
    multiplex: true,
    tcp: true,
    credentials: ['uuid'],
    link: 'vmess',
  },
  {
    id: 'trojan',
    label: 'Trojan',
    kind: 'inbound',
    securities: ['tls', 'none'],
    transport: true,
    multiplex: true,
    tcp: true,
    credentials: ['password'],
    link: 'trojan',
  },
  {
    id: 'shadowsocks',
    label: 'Shadowsocks',
    kind: 'inbound',
    securities: ['none'],
    multiplex: true,
    tcp: true,
    credentials: ['password'],
    link: 'ss',
  },
  {
    id: 'hysteria2',
    label: 'Hysteria2',
    kind: 'inbound',
    securities: ['tls'],
    credentials: ['password'],
    link: 'hysteria2',
  },
  {
    id: 'tuic',
    label: 'TUIC',
    kind: 'inbound',
    securities: ['tls'],
    credentials: ['uuid', 'password'],
    link: 'tuic',
  },
  {
    id: 'anytls',
    label: 'AnyTLS',
    kind: 'inbound',
    securities: ['tls'],
    tcp: true,
    credentials: ['password'],
    link: 'anytls',
  },
  {
    id: 'naive',
    label: 'NaiveProxy',
    kind: 'inbound',
    securities: ['tls'],
    tcp: true,
    login: true,
    credentials: ['password'],
    link: 'naive',
  },
  {
    id: 'ssh',
    label: 'SSH',
    kind: 'inbound',
    securities: ['none'],
    tcp: true,
    login: true,
    credentials: ['password', 'authorized_keys'],
  },
  {
    id: 'mieru',
    label: 'Mieru',
    kind: 'inbound',
    securities: ['none'],
    tcp: true,
    login: true,
    credentials: ['password'],
    link: 'mierus',
  },
  {
    id: 'mtproto',
    label: 'MTProto',
    kind: 'inbound',
    securities: ['none'],
    tcp: true,
    credentials: ['secret'],
    link: 'mtproto',
  },
  {
    id: 'json_inbound',
    label: _('JSON inbound'),
    kind: 'json',
    securities: ['none'],
    credentials: [],
  },
];

const PROTOCOL_BY_ID = new Map(
  PROTOCOLS.map((entry: ServerProtocol) => [entry.id, entry]),
);

export function protocolSpec(protocol: unknown) {
  return PROTOCOL_BY_ID.get(`${protocol || ''}`) || null;
}

export function getProtocol(sectionId: string) {
  return liveOption(sectionId, 'protocol') || DEFAULT_PROTOCOL;
}

export function protocolLabel(protocol: string) {
  const spec = protocolSpec(protocol);
  return spec ? spec.label : `${protocol || ''}`;
}

export function protocolsWhere(
  predicate: (entry: ServerProtocol) => boolean,
): string[] {
  return PROTOCOLS.filter(predicate).map((entry: ServerProtocol) => entry.id);
}

export function protocolsWith(flag: string) {
  return protocolsWhere((entry: ServerProtocol) => !!entry[flag]);
}

export function listenerProtocols() {
  return protocolsWhere((entry: ServerProtocol) => entry.kind === 'inbound');
}

// The transports a listener of this protocol takes, as singbox/servers.uc reads
// them: a port can be shared by two servers when one takes TCP and the other UDP.
export function listenTransports(protocol: string, network: string) {
  const value = `${network || ''}`.toLowerCase();
  if (protocol === 'hysteria2' || protocol === 'tuic') return ['udp'];
  if (
    protocol === 'shadowsocks' ||
    (protocol === 'naive' && value === 'tcp_udp')
  )
    return ['tcp', 'udp'];
  if ((protocol === 'naive' || protocol === 'mieru') && value === 'udp')
    return ['udp'];
  return ['tcp'];
}

export function transportOption(protocol: string) {
  return protocol === 'naive'
    ? 'naive_network'
    : protocol === 'mieru'
      ? 'mieru_transport'
      : '';
}

export function hasListener(protocol: string) {
  const spec = protocolSpec(protocol);
  return !!spec && spec.kind === 'inbound';
}

export function credentialFields(protocol: string) {
  const spec = protocolSpec(protocol);
  return spec ? (spec.credentials || []).slice() : [];
}

export function usesClients(protocol: string) {
  return credentialFields(protocol).length > 0;
}

export function usesLoginName(protocol: string) {
  const spec = protocolSpec(protocol);
  return !!spec && !!spec.login;
}

export function linkScheme(protocol: string) {
  const spec = protocolSpec(protocol);
  return spec && spec.link ? spec.link : '';
}

export function securitiesFor(protocol: unknown) {
  const spec = protocolSpec(protocol);
  return spec ? spec.securities.slice() : ['none'];
}

export function defaultSecurity(protocol: unknown) {
  return securitiesFor(protocol)[0];
}

export function securityLabel(security: string) {
  if (security === 'reality') {
    return 'Reality';
  }
  if (security === 'tls') {
    return 'TLS';
  }
  return _('None');
}

// The security a server actually runs with: a stored mode the protocol no longer
// offers falls back to its first choice instead of generating a configuration
// sing-box refuses.
export function getEffectiveSecurity(sectionId: string) {
  const allowed = securitiesFor(getProtocol(sectionId));
  const security = liveOption(sectionId, 'security');

  return allowed.includes(security) ? security : allowed[0];
}

function authFlagOption(protocol: string) {
  const spec = protocolSpec(protocol);
  return spec && spec.optionalAuth ? spec.optionalAuth : '';
}

export function isAuthenticationEnabled(sectionId: string) {
  const flag = authFlagOption(getProtocol(sectionId));
  if (!flag) {
    return true;
  }

  const value = liveOption(sectionId, flag);
  return value === ''
    ? true
    : !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

export function getServerName(sectionId: string) {
  return option(sectionId, 'label') || sectionId;
}

// XTLS Vision splices the payload inside the TLS record the listener already owns,
// so it needs the raw TLS stream: a transport wraps it, and a multiplexed client
// drops the flow on its own, after which the listener refuses the account with a
// flow mismatch. Offering it outside those bounds only produces accounts that
// cannot connect.
export function supportsVisionFlow(sectionId: string) {
  if (getProtocol(sectionId) !== 'vless') {
    return false;
  }
  if ((liveOption(sectionId, 'transport') || 'tcp') !== 'tcp') {
    return false;
  }
  if (liveOption(sectionId, 'multiplex_enabled') === '1') {
    return false;
  }

  return getEffectiveSecurity(sectionId) !== 'none';
}

export function shadowsocksKeyBytes(method: string) {
  const entry = SHADOWSOCKS_METHODS.find((item) => item.id === method);
  return entry ? entry.keyBytes : 0;
}

export function isShadowsocks2022(method: string) {
  return shadowsocksKeyBytes(method) > 0;
}

export function getShadowsocksMethod(sectionId: string) {
  return (
    liveOption(sectionId, 'shadowsocks_method') || SHADOWSOCKS_METHODS[0].id
  );
}

function isForkopCertificatePath(path: unknown) {
  return `${path || ''}`.startsWith(SERVER_CERT_DIR);
}

// A server that keeps Forkop's own certificate path serves a self-signed
// certificate, so its links have to tell the client to accept it.
export function usesGeneratedCertificate(sectionId: string) {
  const path = option(sectionId, 'tls_certificate_path');
  return !path || isForkopCertificatePath(path);
}
