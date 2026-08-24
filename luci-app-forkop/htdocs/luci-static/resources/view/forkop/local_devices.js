"use strict";
"require baseclass";
"require rpc";
"require uci";
"require ui";
"require view.forkop.main as main";

const callHostHints = rpc.declare({
  object: "luci-rpc",
  method: "getHostHints",
  expect: { "": {} },
});
const callDHCPLeases = rpc.declare({
  object: "luci-rpc",
  method: "getDHCPLeases",
  expect: { "": {} },
});
const callNetworkInterfaceDump = rpc.declare({
  object: "network.interface",
  method: "dump",
  expect: { interface: [] },
});
const SYSTEM_DEVICE_VALUE = "@system";

let localDeviceChoicesCache = null;
let localDeviceChoicesPromise = null;

function normalizeOptionValues(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .filter(Boolean)
      .map((item) => `${item}`.trim())
      .filter(Boolean);
  }

  return `${value}`
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeLocalDeviceName(name) {
  return `${name || ""}`.trim().replace(/\.lan$/i, "");
}

function addLocalDeviceChoice(choices, ip, name) {
  const normalizedIp = `${ip || ""}`.trim();
  const normalizedName = normalizeLocalDeviceName(name);

  if (!normalizedIp || !normalizedName) {
    return;
  }

  if (!main.validateIP(normalizedIp).valid) {
    return;
  }

  choices[normalizedIp] =
    normalizedName.toLowerCase() === "system"
      ? "%s (%s)".format(normalizedName, normalizedIp)
      : normalizedName;
}

function addRouterIp(routerIps, ip) {
  const normalizedIp = `${ip || ""}`.trim();

  if (!normalizedIp || !main.validateIP(normalizedIp).valid) {
    return;
  }

  routerIps[normalizedIp] = true;
}

function buildRouterIpMap(networkInterfaces) {
  const routerIps = {};

  if (!Array.isArray(networkInterfaces)) {
    return routerIps;
  }

  networkInterfaces.forEach((networkInterface) => {
    const ipAddresses = [];
    const ipv4Addresses =
      networkInterface &&
      typeof networkInterface === "object" &&
      Array.isArray(networkInterface["ipv4-address"])
        ? networkInterface["ipv4-address"]
        : [];
    const ipv6Addresses =
      networkInterface &&
      typeof networkInterface === "object" &&
      Array.isArray(networkInterface["ipv6-address"])
        ? networkInterface["ipv6-address"]
        : [];

    ipAddresses.push(...ipv4Addresses, ...ipv6Addresses);
    ipAddresses.forEach((address) => {
      addRouterIp(
        routerIps,
        address && typeof address === "object" ? address.address : address,
      );
    });
  });

  return routerIps;
}

function buildLocalDeviceChoices(
  hostHints,
  dhcpLeases,
  networkInterfaces,
  staticHosts,
) {
  const choices = {};
  const routerIps = buildRouterIpMap(networkInterfaces);

  if (hostHints && typeof hostHints === "object") {
    Object.values(hostHints).forEach((hint) => {
      if (!hint || typeof hint !== "object") {
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

  if (dhcpLeases && Array.isArray(dhcpLeases.dhcp_leases)) {
    dhcpLeases.dhcp_leases.forEach((lease) => {
      if (!lease || typeof lease !== "object") {
        return;
      }

      addLocalDeviceChoice(choices, lease.ipaddr, lease.hostname);
    });
  }

  if (Array.isArray(staticHosts)) {
    staticHosts.forEach((host) => {
      if (!host || typeof host !== "object") {
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
  choices[SYSTEM_DEVICE_VALUE] = "System";

  return choices;
}

function loadLocalDeviceChoices() {
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
      .load("dhcp")
      .then(() => uci.sections("dhcp", "host"))
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

function sortLocalDeviceChoiceValues(choices) {
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
function namesALocalDevice(values) {
  return normalizeOptionValues(values).some(
    (value) => value === SYSTEM_DEVICE_VALUE || main.validateIP(value).valid,
  );
}

// The System entry stands for the router itself; an option whose meaning makes
// no sense for the router asks for choices without it.
function widgetChoices(option, choices) {
  if (option.excludeSystemDevice !== true) {
    return choices;
  }
  const filtered = Object.assign({}, choices);
  delete filtered[SYSTEM_DEVICE_VALUE];
  return filtered;
}

function createLocalDeviceDynamicListWidget(option, section_id, cfgvalue) {
  const values = normalizeOptionValues(
    cfgvalue != null ? cfgvalue : option.default,
  );
  const shouldResolveExistingLabels = namesALocalDevice(values);

  return (
    shouldResolveExistingLabels ? loadLocalDeviceChoices() : Promise.resolve({})
  ).then((initialChoices) => {
    const choices = widgetChoices(
      option,
      localDeviceChoicesCache || initialChoices || {},
    );
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
    if (typeof option.onDeviceWidgetReady === "function") {
      option.onDeviceWidgetReady(section_id, widget);
    }
    if (typeof option.onDeviceListChange === "function") {
      node.addEventListener("cbi-dynlist-change", () => {
        option.onDeviceListChange(section_id, widget.getValue());
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
          const visibleChoices = widgetChoices(option, loadedChoices);
          widget.clearChoices();
          widget.addChoices(
            sortLocalDeviceChoiceValues(visibleChoices),
            visibleChoices,
          );
          choicesLoaded = true;
        })
        .finally(() => {
          choicesLoading = false;
        });
    };

    const maybeLoadChoices = (ev) => {
      if (
        ev.target &&
        typeof ev.target.closest === "function" &&
        ev.target.closest(".cbi-dropdown")
      ) {
        loadChoices();
      }
    };

    node.addEventListener("mousedown", maybeLoadChoices, true);
    node.addEventListener("focusin", maybeLoadChoices, true);

    return node;
  });
}

const EntryPoint = {
  SYSTEM_DEVICE_VALUE,
  createLocalDeviceDynamicListWidget,
  loadLocalDeviceChoices,
  normalizeOptionValues,
};

return baseclass.extend(EntryPoint);
