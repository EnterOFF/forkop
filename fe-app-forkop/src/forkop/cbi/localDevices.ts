// The local device picker: a dynamic list whose dropdown offers the devices the
// router knows about, by name rather than by address.
//
// The choices are expensive - host hints, DHCP leases, the interface dump and
// the static hosts, four calls - so they are fetched once per page and only when
// something actually needs them: either a stored value already names a device, or
// the user opened the dropdown.

import { validateIP } from '../../validators/validateIp';
import { normalizeOptionValues } from './listValues';

const callHostHints = rpc.declare({
  object: 'luci-rpc',
  method: 'getHostHints',
  expect: { '': {} },
});
const callDHCPLeases = rpc.declare({
  object: 'luci-rpc',
  method: 'getDHCPLeases',
  expect: { '': {} },
});
const callNetworkInterfaceDump = rpc.declare({
  object: 'network.interface',
  method: 'dump',
  expect: { interface: [] },
});

// The router itself, as an entry in the device list.
export const SYSTEM_DEVICE_VALUE = '@system';

// Device address to display name.
type DeviceChoices = Record<string, string>;

let localDeviceChoicesCache: DeviceChoices | null = null;
let localDeviceChoicesPromise: Promise<DeviceChoices> | null = null;

function normalizeLocalDeviceName(name: unknown): string {
  return `${name || ''}`.trim().replace(/\.lan$/i, '');
}

function addLocalDeviceChoice(
  choices: DeviceChoices,
  ip: unknown,
  name: unknown,
): void {
  const normalizedIp = `${ip || ''}`.trim();
  const normalizedName = normalizeLocalDeviceName(name);

  if (!normalizedIp || !normalizedName) {
    return;
  }

  if (!validateIP(normalizedIp).valid) {
    return;
  }

  choices[normalizedIp] =
    normalizedName.toLowerCase() === 'system'
      ? '%s (%s)'.format(normalizedName, normalizedIp)
      : normalizedName;
}

function addRouterIp(routerIps: Record<string, boolean>, ip: unknown): void {
  const normalizedIp = `${ip || ''}`.trim();

  if (!normalizedIp || !validateIP(normalizedIp).valid) {
    return;
  }

  routerIps[normalizedIp] = true;
}

// The router's own addresses, which are offered as System rather than as
// separate entries.
function buildRouterIpMap(networkInterfaces: unknown): Record<string, boolean> {
  const routerIps: Record<string, boolean> = {};

  if (!Array.isArray(networkInterfaces)) {
    return routerIps;
  }

  networkInterfaces.forEach((networkInterface) => {
    const ipAddresses: unknown[] = [];
    const ipv4Addresses =
      networkInterface &&
      typeof networkInterface === 'object' &&
      Array.isArray(networkInterface['ipv4-address'])
        ? networkInterface['ipv4-address']
        : [];
    const ipv6Addresses =
      networkInterface &&
      typeof networkInterface === 'object' &&
      Array.isArray(networkInterface['ipv6-address'])
        ? networkInterface['ipv6-address']
        : [];

    ipAddresses.push(...ipv4Addresses, ...ipv6Addresses);
    ipAddresses.forEach((address) => {
      addRouterIp(
        routerIps,
        address && typeof address === 'object'
          ? (address as { address?: unknown }).address
          : address,
      );
    });
  });

  return routerIps;
}

function buildLocalDeviceChoices(
  hostHints: unknown,
  dhcpLeases: unknown,
  networkInterfaces: unknown,
  staticHosts: unknown,
): DeviceChoices {
  const choices: DeviceChoices = {};
  const routerIps = buildRouterIpMap(networkInterfaces);

  if (hostHints && typeof hostHints === 'object') {
    Object.values(hostHints).forEach((hint) => {
      if (!hint || typeof hint !== 'object') {
        return;
      }

      [
        ...normalizeOptionValues(hint.ipaddrs),
        ...normalizeOptionValues(hint.ipv4),
        ...normalizeOptionValues(hint.ipv6),
      ].forEach((ip) => {
        addLocalDeviceChoice(choices, ip, hint.name);
      });
    });
  }

  if (
    dhcpLeases &&
    typeof dhcpLeases === 'object' &&
    Array.isArray((dhcpLeases as { dhcp_leases?: unknown }).dhcp_leases)
  ) {
    (dhcpLeases as { dhcp_leases: unknown[] }).dhcp_leases.forEach((lease) => {
      if (!lease || typeof lease !== 'object') {
        return;
      }

      const entry = lease as { ipaddr?: unknown; hostname?: unknown };
      addLocalDeviceChoice(choices, entry.ipaddr, entry.hostname);
    });
  }

  if (Array.isArray(staticHosts)) {
    staticHosts.forEach((host) => {
      if (!host || typeof host !== 'object') {
        return;
      }

      normalizeOptionValues(host.ip).forEach((ip) => {
        addLocalDeviceChoice(choices, ip, host.name);
      });
    });
  }

  Object.keys(routerIps).forEach((ip) => {
    delete choices[ip];
  });
  choices[SYSTEM_DEVICE_VALUE] = _('System');

  return choices;
}

export function loadLocalDeviceChoices(): Promise<DeviceChoices> {
  if (localDeviceChoicesCache) {
    return Promise.resolve(localDeviceChoicesCache);
  }

  if (localDeviceChoicesPromise) {
    return localDeviceChoicesPromise;
  }

  localDeviceChoicesPromise = Promise.all([
    callHostHints().catch(() => ({})),
    callDHCPLeases().catch(() => ({})),
    callNetworkInterfaceDump().catch(() => []),
    uci
      .load('dhcp')
      .then(() => uci.sections('dhcp', 'host'))
      .catch(() => []),
  ])
    .then(([hostHints, dhcpLeases, networkInterfaces, staticHosts]) => {
      localDeviceChoicesCache = buildLocalDeviceChoices(
        hostHints,
        dhcpLeases,
        networkInterfaces,
        staticHosts,
      );
      return localDeviceChoicesCache;
    })
    .finally(() => {
      localDeviceChoicesPromise = null;
    });

  return localDeviceChoicesPromise;
}

function sortLocalDeviceChoiceValues(choices: DeviceChoices): string[] {
  return Object.keys(choices).sort((a, b) => {
    if (a === SYSTEM_DEVICE_VALUE || b === SYSTEM_DEVICE_VALUE) {
      return a === SYSTEM_DEVICE_VALUE ? -1 : 1;
    }
    const byName = `${choices[a]}`.localeCompare(`${choices[b]}`);
    return byName || a.localeCompare(b);
  });
}

// True when at least one stored value is something the device list can put a
// name to, which is the only reason to fetch the host hints.
function namesALocalDevice(values: unknown): boolean {
  return normalizeOptionValues(values).some(
    (value) => value === SYSTEM_DEVICE_VALUE || validateIP(value).valid,
  );
}

export function createLocalDeviceDynamicListWidget(
  option: CBIOption,
  section_id: string,
  cfgvalue: unknown,
): Promise<HTMLElement> {
  const values = normalizeOptionValues(
    cfgvalue != null ? cfgvalue : option.default,
  );
  const shouldResolveExistingLabels = namesALocalDevice(values);

  return (
    shouldResolveExistingLabels
      ? loadLocalDeviceChoices()
      : Promise.resolve({} as DeviceChoices)
  ).then((initialChoices) => {
    const choices = localDeviceChoicesCache || initialChoices || {};
    const widget = new ui.DynamicList(values, choices, {
      id: option.cbid(section_id),
      sort: sortLocalDeviceChoiceValues(choices),
      optional: option.optional || option.rmempty,
      datatype: option.datatype,
      placeholder: option.placeholder,
      validate: option.validate.bind(option, section_id),
      disabled: option.readonly != null ? option.readonly : option.map.readonly,
    });
    const node = widget.render();
    const onWidgetReady = option.onDeviceWidgetReady;
    const onListChange = option.onDeviceListChange;
    if (typeof onWidgetReady === 'function') {
      onWidgetReady(section_id, widget);
    }
    if (typeof onListChange === 'function') {
      node.addEventListener('cbi-dynlist-change', () => {
        onListChange(section_id, widget.getValue());
      });
    }
    let choicesLoaded = Boolean(localDeviceChoicesCache);
    let choicesLoading = false;

    const loadChoices = () => {
      if (choicesLoaded || choicesLoading) {
        return;
      }

      choicesLoading = true;
      loadLocalDeviceChoices()
        .then((loadedChoices) => {
          widget.clearChoices();
          widget.addChoices(
            sortLocalDeviceChoiceValues(loadedChoices),
            loadedChoices,
          );
          choicesLoaded = true;
        })
        .finally(() => {
          choicesLoading = false;
        });
    };

    const maybeLoadChoices = (ev: Event) => {
      const target = ev.target;
      if (
        target &&
        typeof (target as Element).closest === 'function' &&
        (target as Element).closest('.cbi-dropdown')
      ) {
        loadChoices();
      }
    };

    node.addEventListener('mousedown', maybeLoadChoices, true);
    node.addEventListener('focusin', maybeLoadChoices, true);

    return node;
  });
}
