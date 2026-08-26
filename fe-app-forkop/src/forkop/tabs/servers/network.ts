import { FORKOP_UCI_PACKAGE } from '../../../constants';
import { DEFAULT_PROTOCOL, RESERVED_PORTS } from './constants';
import { asList, option } from './formValues';
import {
  getBrowserHost,
  isIpv4,
  isIpv6,
  isPrivateOrReservedIp,
  normalizeHost,
} from './hosts';
import { hasListener } from './protocols';

const callNetworkInterfaceDump = rpc.declare({
  object: 'network.interface',
  method: 'dump',
  expect: { interface: [] },
});

let defaultPublicHostPromise: Promise<string> | null = null;

let defaultPublicHostCache: string | null = null;

// A port the router already listens on, and what is listening.
interface SystemPort {
  port: string;
  owner: string;
}

let systemPortsPromise: Promise<SystemPort[]> | null = null;

let systemPortsCache: SystemPort[] | null = null;

// Ports another Forkop server, another Forkop inbound or a router service already
// listens on. sing-box refuses to start on a taken port, and the runtime check in
// Diagnostics only reports it after the fact.
export function occupiedPorts(currentSectionId: string) {
  const owners = new Map<string, string>();

  const claim = (port: unknown, owner: string) => {
    const normalized = `${port || ''}`.trim();
    if (!/^[0-9]+$/.test(normalized) || owners.has(normalized)) {
      return;
    }
    owners.set(normalized, owner);
  };

  RESERVED_PORTS.forEach(([port, owner]) => claim(port, owner));

  (uci.sections(FORKOP_UCI_PACKAGE, 'server') || []).forEach((server) => {
    if (server['.name'] === currentSectionId || server.enabled === '0') {
      return;
    }
    if (!hasListener(`${server.protocol || DEFAULT_PROTOCOL}`)) {
      return;
    }
    claim(
      server.listen_port,
      _('server %s').format(server.label || server['.name']),
    );
  });

  (systemPortsCache || []).forEach((entry) => claim(entry.port, entry.owner));

  return owners;
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
    uci.load('uhttpd').catch(() => null),
    uci.load('dropbear').catch(() => null),
  ])
    .then(() => {
      const entries: SystemPort[] = [];
      const addListen = (value: unknown, owner: string) => {
        asList(value).forEach((item) => {
          const port = `${item}`.trim().split(':').pop() ?? '';
          if (/^[0-9]+$/.test(port)) {
            entries.push({ port, owner });
          }
        });
      };

      (uci.sections('uhttpd') || []).forEach((section) => {
        addListen(section.listen_http, _('LuCI web interface'));
        addListen(section.listen_https, _('LuCI web interface'));
      });
      (uci.sections('dropbear') || []).forEach((section) => {
        if (section.enable !== '0') {
          addListen(section.Port || '22', _('router SSH'));
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

function getInterfaceIpAddresses(networkInterface: unknown) {
  const addresses = (networkInterface || {}) as Record<string, unknown>;
  return ['ipv4-address', 'ipv6-address']
    .map((key: string) =>
      Array.isArray(addresses[key]) ? (addresses[key] as unknown[]) : [],
    )
    .flat()
    .map((address) =>
      normalizeHost(
        address && typeof address === 'object'
          ? (address as { address?: unknown }).address
          : address,
      ),
    )
    .filter((address) => isIpv4(address) || isIpv6(address));
}

// The address clients should dial: a routable address when the router has one, the
// LAN address otherwise, because that is still the useful answer behind NAT.
export function chooseDefaultPublicHost(networkInterfaces: unknown) {
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
      const name = `${networkInterface.interface || ''}`;
      const device = `${networkInterface.device || networkInterface.l3_device || ''}`;
      return name === 'lan' || device === 'br-lan';
    }) || {};
  const lanIp = getInterfaceIpAddresses(lanInterface).find(
    (ip) => ip !== '::1' && !ip.startsWith('127.'),
  );

  if (lanIp) {
    return lanIp;
  }

  return (
    upInterfaces
      .flatMap(getInterfaceIpAddresses)
      .find((ip) => ip !== '::1' && !ip.startsWith('127.')) || getBrowserHost()
  );
}

export function loadDefaultPublicHost() {
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

export function preloadServerModalData() {
  return Promise.all([
    loadDefaultPublicHost().catch(() => null),
    loadSystemPorts().catch(() => null),
  ]);
}

export function getPublicHost(sectionId: string) {
  return option(sectionId, 'public_host') || getBrowserHost();
}

export function getListenPort(sectionId: string) {
  return option(sectionId, 'listen_port');
}
