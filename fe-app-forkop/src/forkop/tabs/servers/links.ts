// The field names and encodings follow the link parser in the Forkop core
// (parser/link), so a link produced here is a link the core reads back and clients
// that follow the same conventions understand.

import {
  base64Encode,
  base64UrlEncode,
  buildMtprotoFullSecret,
  encodeQuery,
  normalizeMtprotoBaseSecret,
  normalizeSha256,
} from './credentials';
import { option, optionList } from './formValues';
import { formatHostForUri } from './hosts';
import { getListenPort, getPublicHost } from './network';
import {
  credentialFields,
  getEffectiveSecurity,
  getProtocol,
  getServerName,
  getShadowsocksMethod,
  isAuthenticationEnabled,
  isShadowsocks2022,
  linkScheme,
  usesGeneratedCertificate,
} from './protocols';

function clientLabel(sectionId: string, client: ServerClient) {
  return `${client?.name || ''}`.trim() || getServerName(sectionId);
}

function transportQuery(
  sectionId: string,
  params: Record<string, string>,
  grpcKey: string,
) {
  const transport = option(sectionId, 'transport') || 'tcp';
  params.type = transport === 'raw' ? 'tcp' : transport;

  if (transport === 'ws' || transport === 'httpupgrade') {
    params.path = option(sectionId, 'transport_path');
    params.host = option(sectionId, 'transport_host');
  } else if (transport === 'xhttp') {
    params.path = option(sectionId, 'transport_path') || '/';
    params.host = option(sectionId, 'transport_host');
    params.mode = option(sectionId, 'transport_xhttp_mode') || 'auto';
  } else if (transport === 'grpc') {
    params[grpcKey] = option(sectionId, 'transport_service_name');
  } else if (transport === 'http') {
    params.path = option(sectionId, 'transport_path');
    params.host = optionList(sectionId, 'transport_hosts').join(',');
  }

  return transport;
}

function tlsQuery(
  sectionId: string,
  params: Record<string, string>,
  includeSecurity?: boolean,
) {
  const security = getEffectiveSecurity(sectionId);

  if (security === 'none') {
    if (includeSecurity) {
      params.security = 'none';
    }
    return security;
  }

  if (includeSecurity) {
    params.security = security;
  }

  if (security === 'reality') {
    params.sni = option(sectionId, 'tls_server_name');
    params.pbk = option(sectionId, 'reality_public_key');
    params.sid = optionList(sectionId, 'reality_short_id')[0] || '';
    const fingerprint = option(sectionId, 'client_fingerprint');
    if (fingerprint) {
      params.fp = fingerprint;
    }
  } else {
    params.sni = option(sectionId, 'tls_server_name');
    if (usesGeneratedCertificate(sectionId)) {
      params.insecure = '1';
    }
  }

  const alpn = optionList(sectionId, 'tls_alpn').join(',');
  if (alpn) {
    params.alpn = alpn;
  }

  return security;
}

function shareUrl(
  scheme: string,
  sectionId: string,
  userInfo: string,
  params: Record<string, string>,
  label: string,
) {
  const host = formatHostForUri(getPublicHost(sectionId));
  const port = getListenPort(sectionId);
  const query = encodeQuery(params || {});

  return [
    scheme,
    '://',
    userInfo ? `${userInfo}@` : '',
    host,
    ':',
    port,
    query ? `?${query}` : '',
    '#',
    encodeURIComponent(label),
  ].join('');
}

function buildVlessLink(sectionId: string, client: ServerClient) {
  const params: Record<string, string> = {};
  const security = tlsQuery(sectionId, params, true);

  if (security === 'reality' && (!params.pbk || !params.sid)) {
    return '';
  }

  transportQuery(sectionId, params, 'serviceName');
  params.encryption = 'none';
  if (client.flow && client.flow !== 'none') {
    params.flow = client.flow;
  }

  return shareUrl(
    'vless',
    sectionId,
    encodeURIComponent(client.uuid),
    params,
    clientLabel(sectionId, client),
  );
}

function buildTrojanLink(sectionId: string, client: ServerClient) {
  const params: Record<string, string> = {};

  // The core refuses to represent a plaintext Trojan outbound as a share link,
  // because no client format carries it.
  if (tlsQuery(sectionId, params, true) === 'none') {
    return '';
  }

  transportQuery(sectionId, params, 'grpc-service-name');

  return shareUrl(
    'trojan',
    sectionId,
    encodeURIComponent(client.password),
    params,
    clientLabel(sectionId, client),
  );
}

function buildVmessLink(sectionId: string, client: ServerClient) {
  const params: Record<string, string> = {};
  const security = tlsQuery(sectionId, params, false);
  const transportParams: Record<string, string> = {};
  transportQuery(sectionId, transportParams, 'serviceName');
  const payload: Record<string, string> = {
    v: '2',
    ps: clientLabel(sectionId, client),
    add: getPublicHost(sectionId),
    port: getListenPort(sectionId),
    id: client.uuid,
    aid: '0',
    scy: 'auto',
    // The transport as the query already spells it, so the one place that maps a
    // stored raw onto tcp stays one place.
    net: transportParams.type,
    type: 'none',
    host: transportParams.host || '',
    path: transportParams.path || transportParams.serviceName || '',
    tls: security === 'tls' ? 'tls' : '',
    sni: security === 'tls' ? params.sni || '' : '',
    alpn: security === 'tls' ? params.alpn || '' : '',
  };

  if (params.insecure) {
    payload.insecure = '1';
  }

  // Unpadded standard base64, the encoding the core generator emits.
  return `vmess://${base64Encode(JSON.stringify(payload)).replace(/=+$/, '')}`;
}

function buildShadowsocksLink(sectionId: string, client: ServerClient) {
  const method = getShadowsocksMethod(sectionId);
  // A 2022 server holds one pre-shared key and every client adds its own, so the
  // client password is the two keys joined the way the ciphers expect them.
  const password = isShadowsocks2022(method)
    ? `${option(sectionId, 'shadowsocks_psk')}:${client.password}`
    : client.password;

  return shareUrl(
    'ss',
    sectionId,
    base64UrlEncode(`${method}:${password}`),
    {},
    clientLabel(sectionId, client),
  );
}

function buildMixedLinks(sectionId: string, client: ServerClient) {
  const userInfo = isAuthenticationEnabled(sectionId)
    ? `${encodeURIComponent(client.name)}:${encodeURIComponent(client.password)}`
    : '';
  const label = clientLabel(sectionId, client);

  return [
    {
      title: _('SOCKS5'),
      link: shareUrl('socks5', sectionId, userInfo, {}, label),
    },
    {
      title: _('HTTP'),
      link: shareUrl('http', sectionId, userInfo, {}, label),
    },
  ];
}

function buildHysteria2Link(
  sectionId: string,
  client: ServerClient,
  context: ShareLinkContext = {},
) {
  const params: Record<string, string> = {};
  tlsQuery(sectionId, params, false);

  const certificatePin = normalizeSha256(context.tlsCertificateSha256);
  if (certificatePin) {
    params.pinSHA256 = certificatePin;
  }

  if (option(sectionId, 'hysteria2_obfs_type') === 'salamander') {
    params.obfs = 'salamander';
    params['obfs-password'] = option(sectionId, 'hysteria2_obfs_password');
  }

  const upMbps = option(sectionId, 'hysteria2_up_mbps');
  const downMbps = option(sectionId, 'hysteria2_down_mbps');
  if (upMbps) {
    params.up = upMbps;
  }
  if (downMbps) {
    params.down = downMbps;
  }

  return shareUrl(
    'hysteria2',
    sectionId,
    encodeURIComponent(client.password),
    params,
    clientLabel(sectionId, client),
  );
}

function buildTuicLink(sectionId: string, client: ServerClient) {
  const params: Record<string, string> = {};
  tlsQuery(sectionId, params, false);

  const congestion = option(sectionId, 'tuic_congestion_control');
  if (congestion && congestion !== 'cubic') {
    params.congestion_control = congestion;
  }
  const heartbeat = option(sectionId, 'tuic_heartbeat');
  if (heartbeat) {
    params.heartbeat_interval = heartbeat;
  }
  if (option(sectionId, 'tuic_zero_rtt_handshake') === '1') {
    params.zero_rtt_handshake = 'true';
  }

  return shareUrl(
    'tuic',
    sectionId,
    `${encodeURIComponent(client.uuid)}:${encodeURIComponent(client.password)}`,
    params,
    clientLabel(sectionId, client),
  );
}

function buildAnytlsLink(sectionId: string, client: ServerClient) {
  const params: Record<string, string> = {};
  tlsQuery(sectionId, params, false);

  return shareUrl(
    'anytls',
    sectionId,
    encodeURIComponent(client.password),
    params,
    clientLabel(sectionId, client),
  );
}

function buildNaiveLink(sectionId: string, client: ServerClient) {
  const params: Record<string, string> = {};
  tlsQuery(sectionId, params, false);

  // naive+quic marks the HTTP/3 listener, naive+https the HTTP/2 one.
  const scheme =
    option(sectionId, 'naive_network') === 'udp' ? 'naive+quic' : 'naive+https';

  return shareUrl(
    scheme,
    sectionId,
    `${encodeURIComponent(client.name)}:${encodeURIComponent(client.password)}`,
    params,
    clientLabel(sectionId, client),
  );
}

function buildMtprotoLink(sectionId: string, client: ServerClient) {
  const secret = normalizeMtprotoBaseSecret(client.secret);
  if (!secret) {
    return '';
  }

  const query = encodeQuery({
    server: getPublicHost(sectionId),
    port: getListenPort(sectionId),
    secret: buildMtprotoFullSecret(
      secret,
      option(sectionId, 'mtproto_faketls'),
    ),
  });

  return `https://t.me/proxy?${query}`;
}

export function hasRequiredCredentials(
  sectionId: string,
  client: ServerClient,
) {
  return credentialFields(getProtocol(sectionId))
    .filter((field: string) => field !== 'flow' && field !== 'authorized_keys')
    .every((field: string) => {
      if (field === 'password' && !isAuthenticationEnabled(sectionId)) {
        return true;
      }
      return !!client[field as keyof ServerClient];
    });
}

// The Mieru link is the format of the Mieru project: the port and its transport
// live in the query rather than in the authority, and a profile name is required,
// which the server name stands in for.
function buildMieruLink(sectionId: string, client: ServerClient) {
  const label = clientLabel(sectionId, client);
  const query = encodeQuery({
    profile: getServerName(sectionId),
    port: getListenPort(sectionId),
    protocol: option(sectionId, 'mieru_transport') || 'TCP',
  });

  return [
    'mierus://',
    `${encodeURIComponent(client.name)}:${encodeURIComponent(client.password)}@`,
    formatHostForUri(getPublicHost(sectionId)),
    `?${query}`,
    '#',
    encodeURIComponent(label),
  ].join('');
}

// Every link a client can be handed, as title and link pairs. Most protocols
// produce one; the Mixed listener produces one per scheme it answers.
export function buildClientLinks(
  sectionId: string,
  client: ServerClient,
  context: ShareLinkContext = {},
) {
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

  const single = (link: string) => (link ? [{ title: _('Link'), link }] : []);

  switch (protocol) {
    case 'vless':
      return single(buildVlessLink(sectionId, client));
    case 'vmess':
      return single(buildVmessLink(sectionId, client));
    case 'trojan':
      return single(buildTrojanLink(sectionId, client));
    case 'shadowsocks':
      return single(buildShadowsocksLink(sectionId, client));
    case 'mixed':
      return buildMixedLinks(sectionId, client);
    case 'hysteria2':
      return single(buildHysteria2Link(sectionId, client, context));
    case 'tuic':
      return single(buildTuicLink(sectionId, client));
    case 'anytls':
      return single(buildAnytlsLink(sectionId, client));
    case 'naive':
      return single(buildNaiveLink(sectionId, client));
    case 'mieru':
      return single(buildMieruLink(sectionId, client));
    case 'mtproto':
      return single(buildMtprotoLink(sectionId, client));
    default:
      return [];
  }
}

function normalizeSha256Response(response: {
  code?: number;
  stdout?: string;
  stderr?: string;
}) {
  if ((response.code ?? 0) !== 0 || !response.stdout) {
    throw new Error(response.stderr || response.stdout || '');
  }

  const data = JSON.parse(response.stdout);
  if (!data.success) {
    throw new Error(data.message || '');
  }

  return normalizeSha256(data.sha256);
}

// Hysteria2 clients pin the certificate instead of trusting it, so the fingerprint
// of Forkop's generated certificate is read from the router.
export function loadLinkContext(sectionId: string) {
  const certificatePinExpected =
    getProtocol(sectionId) === 'hysteria2' &&
    usesGeneratedCertificate(sectionId);

  if (!certificatePinExpected) {
    return Promise.resolve({ tlsCertificateSha256: '' });
  }

  return fs
    .exec('/usr/bin/forkop', ['get_tls_certificate_sha256', sectionId])
    .then(normalizeSha256Response)
    .catch((error) => {
      console.warn(
        error?.message || 'Failed to read generated TLS certificate pin',
        error,
      );
      return '';
    })
    .then((tlsCertificateSha256) => ({ tlsCertificateSha256 }));
}
