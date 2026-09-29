// The profile an OpenVPN client imports: every directive it needs and every
// certificate and key inline, so the one file is all a client is handed. The
// certificates are issued by the router when the settings are applied, so they
// are read from what the router holds rather than from the page's copy, which
// the apply may have overtaken.

import { getListenPort, getPublicHost } from './network';
import { normalizeHost } from './hosts';
import { option } from './formValues';
import { getServerName } from './protocols';

let callUciValues: ((config: string) => Promise<unknown>) | null = null;

export type OpenVPNMaterial = Record<string, Record<string, unknown>>;

export function loadOpenVPNMaterial(): Promise<OpenVPNMaterial> {
  callUciValues ??= rpc.declare({
    object: 'uci',
    method: 'get',
    params: ['config'],
    expect: { values: {} },
  });
  return callUciValues('forkop')
    .then((values) => (values || {}) as OpenVPNMaterial)
    .catch((error: unknown) => {
      console.warn('Failed to read the OpenVPN certificates', error);
      return {};
    });
}

export type OpenVPNProfile =
  | { profile: string; fileName: string }
  | { missing: 'address' | 'certificate' };

function text(value: unknown) {
  return `${value ?? ''}`.trim();
}

function fileName(value: string) {
  return value.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
}

export function buildOpenVPNProfile(
  sectionId: string,
  client: ServerClient,
  material: OpenVPNMaterial,
): OpenVPNProfile {
  const host = normalizeHost(getPublicHost(sectionId));
  const port = getListenPort(sectionId);
  if (!host || !port) return { missing: 'address' };

  const server = material[sectionId] || {};
  const own = material[client.id] || {};
  const ca = text(server.openvpn_certificate);
  const tlsCrypt = text(server.openvpn_tls_crypt_key);
  const certificate = text(own.openvpn_certificate);
  const key = text(own.openvpn_key);
  if (!ca || !tlsCrypt || !certificate || !key) {
    return { missing: 'certificate' };
  }

  const network =
    option(sectionId, 'openvpn_network') === 'tcp' ? 'tcp' : 'udp';
  const allTraffic = option(sectionId, 'openvpn_redirect_gateway') !== '0';
  const serverName = getServerName(sectionId);
  const lines = [
    `# ${serverName} · ${client.name}`,
    'client',
    'dev tun',
    `proto ${network}`,
    `remote ${host} ${port}`,
    'nobind',
    'persist-tun',
    'remote-cert-tls server',
    // Tells the server at once that the client has gone, so a new session of the
    // same client does not wait for the old one to time out.
    ...(network === 'udp' ? ['explicit-exit-notify'] : []),
    // The server pushes it for Windows, where it keeps DNS inside the tunnel;
    // other clients log it as an unknown option unless told it may be.
    ...(allTraffic ? ['ignore-unknown-option block-outside-dns'] : []),
    'verb 3',
    '<ca>',
    ca,
    '</ca>',
    '<cert>',
    certificate,
    '</cert>',
    '<key>',
    key,
    '</key>',
    '<tls-crypt>',
    tlsCrypt,
    '</tls-crypt>',
    '',
  ];
  return {
    profile: lines.join('\n'),
    fileName: `${fileName(`${serverName}-${client.name}`) || 'openvpn'}.ovpn`,
  };
}

export function downloadProfile(profile: string, name: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(
    new Blob([profile], { type: 'application/x-openvpn-profile' }),
  );
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
