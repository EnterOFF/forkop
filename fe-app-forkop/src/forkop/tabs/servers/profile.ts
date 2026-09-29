// The profile an OpenVPN client imports: every directive it needs and every
// certificate and key inline, so the one file is all a client is handed. The
// certificates are the ones the router issued when the settings were applied.

import { getListenPort, getPublicHost } from './network';
import { normalizeHost } from './hosts';
import { option } from './formValues';
import type { IssuedMaterial } from './issued';
import { getServerName } from './protocols';

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
  material: IssuedMaterial,
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
