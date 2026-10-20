// Everything inline, so one file is all a client is handed.

import {
  AMNEZIA_KEYS,
  amneziaConfLine,
  amneziaParameter,
} from '../../../helpers/wireguard';
import { getListenPort, getPublicHost } from './network';
import { formatHostForUri, normalizeHost } from './hosts';
import { asList, option, optionList } from './formValues';
import type { IssuedMaterial } from './issued';
import { getProtocol, getServerName } from './protocols';
import { subnetContains, subnetOf } from './form/tunnel';

export type ClientProfile =
  | { profile: string; fileName: string; type: string }
  | { missing: 'address' | 'certificate' | 'keys' };

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
): ClientProfile {
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
  const allTraffic = option(sectionId, 'tunnel_all_traffic') !== '0';
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
    type: 'application/x-openvpn-profile',
  };
}

// WireGuard apps name the tunnel after the file and take only names of up to 15 such characters,
// an interface name's length.
function tunnelName(serverName: string, clientName: string, protocol: string) {
  const clean = (value: string) =>
    value.replace(/[^A-Za-z0-9_=+.-]+/g, '-').replace(/^-+|-+$/g, '');
  const both = [clean(serverName), clean(clientName)].filter(Boolean).join('-');
  const name =
    both.length <= 15
      ? both
      : clean(clientName).slice(0, 15).replace(/-+$/, '');
  return name || protocol;
}

// Every server parameter, in the order and spelling of the Amnezia client's own profiles. The MTU
// leaves room for padding over mobile networks, and the keepalive is a range, as AmneziaWG 3 writes it.
function amneziaLines(server: Record<string, unknown>) {
  return AMNEZIA_KEYS.filter((key: string) => {
    const value = text(server[`amnezia_${key}`]);
    return amneziaParameter(key)!.kind === 'flag' ? value === '1' : !!value;
  }).map((key: string) => amneziaConfLine(key, server[`amnezia_${key}`]));
}

export function buildWireGuardProfile(
  sectionId: string,
  client: ServerClient,
  material: IssuedMaterial,
): ClientProfile {
  const host = normalizeHost(getPublicHost(sectionId));
  const port = getListenPort(sectionId);
  if (!host || !port) return { missing: 'address' };

  const protocol = getProtocol(sectionId);
  const amnezia = protocol === 'amneziawg';
  const server = material[sectionId] || {};
  const own = material[client.id] || {};
  const serverKey = text(server.wireguard_public_key);
  const privateKey = text(own.wireguard_private_key);
  const preSharedKey = text(own.wireguard_pre_shared_key);
  const subnets = optionList(sectionId, 'tunnel_address');
  const addresses = asList(own.wireguard_address).map(text);
  // An address from before the subnet changed is one the router will move on
  // the next apply.
  const current =
    addresses.length === subnets.length &&
    subnets.every((subnet) =>
      addresses.some((address) => subnetContains(subnet, address)),
    );
  if (!serverKey || !privateKey || !preSharedKey || !current) {
    return { missing: 'keys' };
  }

  const allTraffic = option(sectionId, 'tunnel_all_traffic') !== '0';
  const allowed = allTraffic
    ? ['0.0.0.0/0', '::/0']
    : [...optionList(sectionId, 'tunnel_routes'), ...subnets.map(subnetOf)];
  const serverName = getServerName(sectionId);
  const lines = [
    '[Interface]',
    `PrivateKey = ${privateKey}`,
    `Address = ${addresses.join(', ')}`,
    `DNS = ${subnets.map((subnet) => subnet.split('/')[0]).join(', ')}`,
    ...(amnezia ? ['MTU = 1280', ...amneziaLines(server)] : []),
    '',
    '[Peer]',
    `PublicKey = ${serverKey}`,
    `PresharedKey = ${preSharedKey}`,
    `AllowedIPs = ${allowed.join(', ')}`,
    `Endpoint = ${formatHostForUri(host)}:${port}`,
    `PersistentKeepalive = ${amnezia ? '25-35' : '25'}`,
    '',
  ];
  return {
    profile: lines.join('\n'),
    fileName: `${tunnelName(serverName, client.name, protocol)}.conf`,
    type: 'text/plain',
  };
}

export function buildClientProfile(
  sectionId: string,
  client: ServerClient,
  material: IssuedMaterial,
) {
  return getProtocol(sectionId) === 'openvpn'
    ? buildOpenVPNProfile(sectionId, client, material)
    : buildWireGuardProfile(sectionId, client, material);
}

export function downloadProfile(profile: string, name: string, type: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([profile], { type }));
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
