"use strict";
"require form";
"require baseclass";
"require fs";
"require network";
"require ui";
"require uci";
"require view.forkop.local_devices as localDevices";
"require view.forkop.main as main";

const UCI_PACKAGE = main.FORKOP_UCI_PACKAGE;
const ACTION_PROVIDERS_AVAILABILITY_EVENT =
  main.FORKOP_ACTION_PROVIDERS_AVAILABILITY_EVENT ||
  "forkop:action-providers-availability";
const RULE_SET_ITEM_SETTINGS_KEY = "rule_set_settings";
const ROUTING_ACTIONS = [
  "connection",
  "proxy",
  "outbound",
  "vpn",
  "bypass",
  "block",
  "zapret",
  "zapret2",
  "byedpi",
];
const JSON_ENDPOINT_TYPES = new Set([
  "vpn-server",
  "vpn-client",
  "wireguard",
  "warp",
  "tailscale",
]);
const CONNECTIONS_BLOCKED_INTERFACES = [
  "br-lan",
  "eth0",
  "eth1",
  "wan",
  "phy0-ap0",
  "phy1-ap0",
  "pppoe-wan",
  "lan",
];
let defaultSubscriptionHeaderLines = [];
let defaultSubscriptionHeadersPromise = null;

function loadDefaultSubscriptionHeaders() {
  if (defaultSubscriptionHeadersPromise) {
    return defaultSubscriptionHeadersPromise;
  }

  defaultSubscriptionHeadersPromise = fs
    .exec("/usr/bin/forkop", ["get_subscription_default_headers"])
    .then((response) => {
      if (response.code) {
        throw new Error(_("Failed to load default subscription headers"));
      }

      const parsed = JSON.parse(response.stdout || "[]");
      if (!Array.isArray(parsed)) {
        throw new Error(_("Failed to load default subscription headers"));
      }

      defaultSubscriptionHeaderLines = parsed
        .map((value) => `${value || ""}`.trim())
        .filter(Boolean);
      return defaultSubscriptionHeaderLines.slice();
    })
    .catch((error) => {
      defaultSubscriptionHeadersPromise = null;
      throw error;
    });

  return defaultSubscriptionHeadersPromise;
}

function valuesToText(values) {
  if (!values) {
    return "";
  }

  if (Array.isArray(values)) {
    return values.filter(Boolean).join("\n");
  }

  return values ? `${values}` : "";
}

const normalizeOptionValues = localDevices.normalizeOptionValues;

function getUciSectionName(section) {
  return section && section[".name"] ? section[".name"] : "";
}

function getUciSectionLabel(section) {
  return (section && section.label) || getUciSectionName(section);
}

function isOutboundDetourTargetSection(section, currentSectionId) {
  const sectionName = getUciSectionName(section);
  const action = (section && section.action) || "";

  return (
    sectionName &&
    sectionName !== currentSectionId &&
    section.enabled !== "0" &&
    ["connection", "proxy", "outbound", "vpn"].includes(action)
  );
}

function getOutboundDetourTargetSections(currentSectionId) {
  return (uci.sections(UCI_PACKAGE, "section") || []).filter((section) =>
    isOutboundDetourTargetSection(section, currentSectionId),
  );
}

function getDefaultOutboundDetourSection(currentSectionId) {
  const targetSections = getOutboundDetourTargetSections(currentSectionId);

  return targetSections.length ? getUciSectionName(targetSections[0]) : "";
}

function refreshOutboundDetourSectionOptionValues(option, sectionId) {
  option.keylist = [];
  option.vallist = [];

  getOutboundDetourTargetSections(sectionId).forEach((targetSection) => {
    option.value(
      getUciSectionName(targetSection),
      getUciSectionLabel(targetSection),
    );
  });
}

function tailscaleDetourSectionValue(detour, currentSectionId) {
  detour = `${detour || ""}`.trim();
  if (!detour) {
    return "";
  }

  const target = getOutboundDetourTargetSections(currentSectionId).find(
    (section) =>
      main.getOutboundTagBySection(getUciSectionName(section)) === detour,
  );
  return target ? getUciSectionName(target) : detour;
}

function tailscaleDetourTag(sectionId) {
  sectionId = `${sectionId || ""}`.trim();
  if (!sectionId) {
    return "";
  }

  const target = (uci.sections(UCI_PACKAGE, "section") || []).find(
    (section) => getUciSectionName(section) === sectionId,
  );
  return target ? main.getOutboundTagBySection(sectionId) : sectionId;
}

function isDnsDetourTargetSection(section, currentSectionId) {
  const sectionName = getUciSectionName(section);
  const action = (section && section.action) || "";

  if (
    !sectionName ||
    sectionName === currentSectionId ||
    section.enabled === "0"
  ) {
    return false;
  }

  if (["connection", "proxy", "outbound", "vpn"].includes(action)) {
    return true;
  }
  if (action === "zapret") {
    return isZapretInstalledForUi();
  }
  if (action === "zapret2") {
    return isZapret2InstalledForUi();
  }
  return action === "byedpi" && isByedpiInstalledForUi();
}

function refreshDnsDetourSectionOptionValues(option, sectionId) {
  option.keylist = [];
  option.vallist = [];

  (uci.sections(UCI_PACKAGE, "section") || [])
    .filter((section) => isDnsDetourTargetSection(section, sectionId))
    .forEach((targetSection) => {
      option.value(
        getUciSectionName(targetSection),
        getUciSectionLabel(targetSection),
      );
    });
}

function dependsOnRoutingAction(option) {
  ROUTING_ACTIONS.forEach((action) => option.depends("action", action));
  return option;
}

function dependsOnRuleConditions(option) {
  const routingConditions = [
    "domain",
    "ip_cidr",
    "community_lists",
    "rule_set",
    "ports",
  ];
  ROUTING_ACTIONS.forEach((action) =>
    routingConditions.forEach((condition) =>
      option.depends({ action, [condition]: /\S/ }),
    ),
  );
  ["domain", "community_lists", "rule_set"].forEach((condition) =>
    option.depends({ action: "dns", [condition]: /\S/ }),
  );
  return option;
}

const ZAPRET_LEGACY_DEFAULT_NFQWS_OPT =
  "--filter-tcp=80 <HOSTLIST> --dpi-desync=fake,fakedsplit --dpi-desync-autottl=2 --dpi-desync-fooling=badsum --new --filter-tcp=443 --hostlist=/opt/zapret/ipset/zapret-hosts-google.txt --dpi-desync=fake,multidisorder --dpi-desync-split-pos=1,midsld --dpi-desync-repeats=11 --dpi-desync-fooling=badsum --dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com --new --filter-udp=443 --hostlist=/opt/zapret/ipset/zapret-hosts-google.txt --dpi-desync=fake --dpi-desync-repeats=11 --dpi-desync-fake-quic=/opt/zapret/files/fake/quic_initial_www_google_com.bin --new --filter-udp=443 <HOSTLIST_NOAUTO> --dpi-desync=fake --dpi-desync-repeats=11 --new --filter-tcp=443 <HOSTLIST> --dpi-desync=multidisorder --dpi-desync-split-pos=1,sniext+1,host+1,midsld-2,midsld,midsld+2,endhost-1";

const ZAPRET_DEFAULT_NFQWS_OPT =
  "--filter-tcp=80 --dpi-desync=fake,fakedsplit --dpi-desync-autottl=2 --dpi-desync-fooling=badsum --new --filter-tcp=443 --dpi-desync=fake,multidisorder --dpi-desync-split-pos=1,midsld --dpi-desync-repeats=11 --dpi-desync-fooling=badsum --dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com --new --filter-udp=443 --dpi-desync=fake --dpi-desync-repeats=11 --dpi-desync-fake-quic=/opt/zapret/files/fake/quic_initial_www_google_com.bin";

const ZAPRET2_DEFAULT_NFQWS2_OPT =
  "--filter-tcp=80 --filter-l7=http --payload=http_req --lua-desync=fake:blob=fake_default_http:tcp_md5 --lua-desync=multisplit:pos=method+2 --new --filter-tcp=443 --filter-l7=tls --payload=tls_client_hello --lua-desync=fake:blob=fake_default_tls:tcp_md5:tcp_seq=-10000 --lua-desync=multidisorder:pos=1,midsld --new --filter-udp=443 --filter-l7=quic --payload=quic_initial --lua-desync=fake:blob=fake_default_quic:repeats=6";

const BYEDPI_DEFAULT_CMD_OPTS = "-o 2 --auto=t,r,a,s -d 2";
const ANNOTATED_TEXTAREA_STYLE_ID = "fkp-annotated-textarea-styles";
const CONNECTIONS_DYNLIST_STYLE_ID = "fkp-connections-dynlist-styles";
const NFQWS_REMOTE_VALIDATION_DEBOUNCE_MS = 500;
const NFQWS_VALIDATION_COMMAND = "/usr/bin/forkop";
const nfqwsRemoteValidationCache = new Map();
const nfqwsRemoteValidationInflight = new Map();
const nfqws2RemoteValidationCache = new Map();
const nfqws2RemoteValidationInflight = new Map();
const byedpiRemoteValidationCache = new Map();
const byedpiRemoteValidationInflight = new Map();
const BYEDPI_LONG_VALUE_OPTIONS = new Set([
  "--max-conn",
  "--conn-ip",
  "--buf-size",
  "--debug",
  "--def-ttl",
  "--auto",
  "--auto-mode",
  "--cache-ttl",
  "--cache-dump",
  "--timeout",
  "--proto",
  "--hosts",
  "--ipset",
  "--pf",
  "--round",
  "--split",
  "--disorder",
  "--oob",
  "--disoob",
  "--fake",
  "--fake-sni",
  "--ttl",
  "--fake-offset",
  "--fake-data",
  "--fake-tls-mod",
  "--oob-data",
  "--mod-http",
  "--tlsrec",
  "--tlsminor",
  "--udp-fake",
]);
const BYEDPI_LONG_FLAG_OPTIONS = new Set([
  "--md5sig",
  "--tfo",
  "--drop-sack",
  "--no-domain",
  "--no-udp",
]);
const BYEDPI_SHORT_VALUE_OPTIONS = new Set([
  "-c",
  "-I",
  "-b",
  "-x",
  "-g",
  "-A",
  "-L",
  "-u",
  "-y",
  "-T",
  "-K",
  "-H",
  "-j",
  "-V",
  "-R",
  "-s",
  "-d",
  "-o",
  "-q",
  "-f",
  "-n",
  "-t",
  "-O",
  "-l",
  "-Q",
  "-e",
  "-M",
  "-r",
  "-m",
  "-a",
]);
const BYEDPI_SHORT_FLAG_OPTIONS = new Set(["-N", "-U", "-F", "-S", "-Y"]);
const NFQWS_OPTIONAL_ARG_OPTIONS = new Set([
  "--comment",
  "--ctrack-disable",
  "--debug",
  "--dpi-desync-any-protocol",
  "--dpi-desync-autottl",
  "--dpi-desync-autottl6",
  "--dpi-desync-skip-nosni",
  "--dpi-desync-tcp-flags-set",
  "--dpi-desync-tcp-flags-unset",
  "--dup-autottl",
  "--dup-autottl6",
  "--dup-replace",
  "--dup-tcp-flags-set",
  "--dup-tcp-flags-unset",
  "--ipcache-hostname",
  "--orig-autottl",
  "--orig-autottl6",
  "--orig-tcp-flags-set",
  "--orig-tcp-flags-unset",
  "--synack-split",
]);
const NFQWS_NO_ARG_OPTIONS = new Set([
  "--bind-fix4",
  "--bind-fix6",
  "--daemon",
  "--domcase",
  "--dry-run",
  "--hostcase",
  "--hostnospace",
  "--methodeol",
  "--new",
  "--skip",
  "--version",
]);
const NFQWS_REQUIRED_ARG_OPTIONS = new Set([
  "--ctrack-timeouts",
  "--dpi-desync",
  "--dpi-desync-badack-increment",
  "--dpi-desync-badseq-increment",
  "--dpi-desync-cutoff",
  "--dpi-desync-fake-dht",
  "--dpi-desync-fake-discord",
  "--dpi-desync-fake-http",
  "--dpi-desync-fake-quic",
  "--dpi-desync-fake-stun",
  "--dpi-desync-fake-syndata",
  "--dpi-desync-fake-tcp-mod",
  "--dpi-desync-fake-tls",
  "--dpi-desync-fake-tls-mod",
  "--dpi-desync-fake-unknown",
  "--dpi-desync-fake-unknown-udp",
  "--dpi-desync-fake-wireguard",
  "--dpi-desync-fakedsplit-mod",
  "--dpi-desync-fakedsplit-pattern",
  "--dpi-desync-fooling",
  "--dpi-desync-fwmark",
  "--dpi-desync-hostfakesplit-midhost",
  "--dpi-desync-hostfakesplit-mod",
  "--dpi-desync-ipfrag-pos-tcp",
  "--dpi-desync-ipfrag-pos-udp",
  "--dpi-desync-repeats",
  "--dpi-desync-split-http-req",
  "--dpi-desync-split-pos",
  "--dpi-desync-split-seqovl",
  "--dpi-desync-split-seqovl-pattern",
  "--dpi-desync-split-tls",
  "--dpi-desync-start",
  "--dpi-desync-ts-increment",
  "--dpi-desync-ttl",
  "--dpi-desync-ttl6",
  "--dpi-desync-udplen-increment",
  "--dpi-desync-udplen-pattern",
  "--dup",
  "--dup-badack-increment",
  "--dup-badseq-increment",
  "--dup-cutoff",
  "--dup-fooling",
  "--dup-ip-id",
  "--dup-start",
  "--dup-ts-increment",
  "--dup-ttl",
  "--dup-ttl6",
  "--filter-l3",
  "--filter-l7",
  "--filter-tcp",
  "--filter-udp",
  "--hostlist",
  "--hostlist-auto",
  "--hostlist-auto-debug",
  "--hostlist-auto-fail-threshold",
  "--hostlist-auto-fail-time",
  "--hostlist-auto-retrans-threshold",
  "--hostlist-domains",
  "--hostlist-exclude",
  "--hostlist-exclude-domains",
  "--hostspell",
  "--ip-id",
  "--ipcache-lifetime",
  "--ipset",
  "--ipset-exclude",
  "--ipset-exclude-ip",
  "--ipset-ip",
  "--orig-mod-cutoff",
  "--orig-mod-start",
  "--orig-ttl",
  "--orig-ttl6",
  "--pidfile",
  "--qnum",
  "--uid",
  "--user",
  "--wsize",
  "--wssize",
  "--wssize-cutoff",
  "--wssize-forced-cutoff",
]);
const NFQWS2_OPTIONAL_ARG_OPTIONS = new Set([
  "--chdir",
  "--comment",
  "--ctrack-disable",
  "--debug",
  "--hostlist-auto-retrans-reset",
  "--intercept",
  "--ipcache-hostname",
  "--new",
  "--payload-disable",
  "--reasm-disable",
  "--server",
  "--template",
  "--writeable",
]);
const NFQWS2_NO_ARG_OPTIONS = new Set([
  "--bind-fix4",
  "--bind-fix6",
  "--daemon",
  "--dry-run",
  "--skip",
  "--version",
]);
const NFQWS2_REQUIRED_ARG_OPTIONS = new Set([
  "--blob",
  "--cookie",
  "--ctrack-timeouts",
  "--filter-l3",
  "--filter-l7",
  "--filter-tcp",
  "--filter-udp",
  "--fwmark",
  "--fuzz",
  "--hostlist",
  "--hostlist-auto",
  "--hostlist-auto-debug",
  "--hostlist-auto-fail-threshold",
  "--hostlist-auto-fail-time",
  "--hostlist-auto-retrans-threshold",
  "--hostlist-domains",
  "--hostlist-exclude",
  "--hostlist-exclude-domains",
  "--import",
  "--in-range",
  "--ipcache-lifetime",
  "--ipset",
  "--ipset-exclude",
  "--ipset-exclude-ip",
  "--ipset-ip",
  "--lua-gc",
  "--lua-init",
  "--lua-desync",
  "--name",
  "--out-range",
  "--payload",
  "--pidfile",
  "--qnum",
  "--uid",
  "--user",
]);
const actionProvidersAvailabilityState = {
  loaded: false,
  zapretInstalled: false,
  zapret2Installed: false,
  byedpiInstalled: false,
};
let actionProvidersAvailabilityPromise = null;
let actionProvidersAvailabilityLoader = null;
const outboundNameChoicesCache = new Map();
const outboundNameChoicesInflight = new Map();
const subscriptionOutboundNameChoicesCache = new Map();
const subscriptionOutboundNameChoicesInflight = new Map();
const outboundNameSourceOptions = new Map();
const dashboardFilterChoiceRefreshers = new Map();
const sharedChildPendingSettings = new Map();

function updateActionProvidersAvailabilityState(nextState) {
  if (!nextState) {
    return;
  }

  actionProvidersAvailabilityState.loaded = true;

  if (typeof nextState.zapretInstalled !== "undefined") {
    actionProvidersAvailabilityState.zapretInstalled = Boolean(
      nextState.zapretInstalled,
    );
  }

  if (typeof nextState.zapret2Installed !== "undefined") {
    actionProvidersAvailabilityState.zapret2Installed = Boolean(
      nextState.zapret2Installed,
    );
  }

  if (typeof nextState.byedpiInstalled !== "undefined") {
    actionProvidersAvailabilityState.byedpiInstalled = Boolean(
      nextState.byedpiInstalled,
    );
  }

  actionProvidersAvailabilityPromise = null;
}

function updateActionProvidersAvailabilityFromSystemInfo(systemInfo) {
  if (!systemInfo || !systemInfo.providerInfoLoaded) {
    return;
  }

  updateActionProvidersAvailabilityState({
    zapretInstalled: Boolean(systemInfo.zapret_installed),
    zapret2Installed: Boolean(systemInfo.zapret2_installed),
    byedpiInstalled: Boolean(systemInfo.byedpi_installed),
  });
}

function setActionProvidersAvailabilityLoader(loader) {
  actionProvidersAvailabilityLoader =
    typeof loader === "function" ? loader : null;
}

if (typeof window !== "undefined") {
  window.addEventListener(ACTION_PROVIDERS_AVAILABILITY_EVENT, (event) => {
    updateActionProvidersAvailabilityState(event.detail);
  });
}

if (main.store && typeof main.store.subscribe === "function") {
  main.store.subscribe((next, _prev, diff) => {
    if (!diff || diff.diagnosticsSystemInfo) {
      updateActionProvidersAvailabilityFromSystemInfo(
        next.diagnosticsSystemInfo,
      );
    }
  });
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function safeRuntimeSectionName(section_id) {
  return /^[A-Za-z0-9_-]+$/.test(`${section_id || ""}`);
}

function nativeProviderOutboundNames(providerTags, value) {
  const providers = plainObject(plainObject(value).providers);
  const seen = new Set();
  const result = [];

  (Array.isArray(providerTags) ? providerTags : []).forEach((providerTag) => {
    providerTag = `${providerTag || ""}`.trim();
    const provider = plainObject(providers[providerTag]);
    const runtimePrefix = `${providerTag}/`;

    (Array.isArray(provider.proxies) ? provider.proxies : []).forEach(
      (proxy) => {
        proxy = plainObject(proxy);
        const type = `${proxy.type || ""}`.toLowerCase();
        if (["selector", "urltest", "fallback"].includes(type)) {
          return;
        }

        let name = `${proxy.name || ""}`.trim();
        if (name.startsWith(runtimePrefix)) {
          name = name.slice(runtimePrefix.length);
        }
        if (name && !seen.has(name)) {
          seen.add(name);
          result.push(name);
        }
      },
    );
  });

  return result;
}

function loadNativeProviderOutboundNames(providerTags) {
  if (!Array.isArray(providerTags) || !providerTags.length) {
    return Promise.resolve([]);
  }

  return fs
    .exec("/usr/bin/forkop", ["clash_api", "get_proxy_providers"])
    .then((response) => {
      const value = JSON.parse(response.stdout || "{}");
      if (
        (response.code ?? 0) !== 0 ||
        !value.providers ||
        typeof value.providers !== "object" ||
        Array.isArray(value.providers)
      ) {
        throw new Error("Native provider lookup failed");
      }
      return nativeProviderOutboundNames(providerTags, value);
    })
    .catch(() => null);
}

function subscriptionSourceOutboundName(name, prefixNodes, nodePrefix) {
  name = `${name || ""}`.trim();
  nodePrefix = `${nodePrefix || ""}`.trim();
  const enabled = prefixNodes === true || `${prefixNodes || ""}` === "1";
  const prefix = `${nodePrefix} `;

  return enabled && nodePrefix && name.startsWith(prefix)
    ? name.slice(prefix.length)
    : name;
}

function readOutboundChoiceState(section_id) {
  if (!safeRuntimeSectionName(section_id)) {
    return Promise.resolve(null);
  }

  return Promise.resolve({
    providerTags: getChildItemIds(section_id, "subscription_url").map(
      (_itemId, index) => `${section_id}-subscription-${index + 1}-provider`,
    ),
  });
}

function loadOutboundNameChoices(section_id) {
  if (outboundNameChoicesCache.has(section_id)) {
    return Promise.resolve(outboundNameChoicesCache.get(section_id));
  }

  if (outboundNameChoicesInflight.has(section_id)) {
    return outboundNameChoicesInflight.get(section_id);
  }

  const task = readOutboundChoiceState(section_id)
    .then((state) =>
      state
        ? loadNativeProviderOutboundNames(
            state.providerTags.filter((providerTag) =>
              /-subscription-\d+-provider$/.test(`${providerTag || ""}`),
            ),
          )
        : null,
    )
    .then((names) => {
      if (names == null) {
        return [];
      }
      const choices = names
        .map((name) => `${name || ""}`.trim())
        .filter(Boolean)
        .filter((name, index, values) => values.indexOf(name) === index)
        .sort((a, b) => a.localeCompare(b));

      outboundNameChoicesCache.set(section_id, choices);
      refreshDashboardFilterChoiceWidgets(section_id);

      return choices;
    })
    .catch(() => [])
    .finally(() => {
      outboundNameChoicesInflight.delete(section_id);
    });

  outboundNameChoicesInflight.set(section_id, task);

  return task;
}

function subscriptionProviderIndex(section_id, itemId) {
  return getChildItemIds(section_id, "subscription_url").indexOf(
    `${itemId || ""}`,
  );
}

function loadSubscriptionOutboundNameChoices(section_id, itemId) {
  const cacheKey = `${section_id}:${itemId}`;
  if (subscriptionOutboundNameChoicesCache.has(cacheKey)) {
    return Promise.resolve(subscriptionOutboundNameChoicesCache.get(cacheKey));
  }
  if (subscriptionOutboundNameChoicesInflight.has(cacheKey)) {
    return subscriptionOutboundNameChoicesInflight.get(cacheKey);
  }

  const providerIndex = subscriptionProviderIndex(section_id, itemId);
  if (providerIndex < 0) {
    return Promise.resolve([]);
  }

  const task = readOutboundChoiceState(section_id)
    .then((state) =>
      state
        ? loadNativeProviderOutboundNames([state.providerTags[providerIndex]])
        : null,
    )
    .then((names) => {
      if (names == null) {
        return [];
      }
      subscriptionOutboundNameChoicesCache.set(cacheKey, names);
      refreshDashboardFilterChoiceWidgets(section_id);
      return names;
    })
    .catch(() => [])
    .finally(() => {
      subscriptionOutboundNameChoicesInflight.delete(cacheKey);
    });

  subscriptionOutboundNameChoicesInflight.set(cacheKey, task);
  return task;
}

function normalizeDynamicListItems(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => `${item || ""}`.trim())
      .filter((item) => item.length);
  }

  const normalized = `${value}`.trim();
  return normalized.length ? [normalized] : [];
}

function nextDynamicListName(option, formSectionId, savedItems, prefix) {
  let current = null;
  if (option && typeof option.formvalue === "function") {
    try {
      current = option.formvalue(formSectionId);
    } catch (_error) {
      // The widget is not mounted; use the saved child sections below.
    }
  }

  const items = normalizeDynamicListItems(
    current == null ? savedItems : current,
  );
  return `${prefix} #${items.length + 1}`;
}

function uniqueDynamicListItems(value) {
  const seen = new Set();
  const result = [];

  normalizeDynamicListItems(value).forEach((item) => {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  });

  return result;
}

function readItemSettingsMap(section_id, settingsKey) {
  const raw = uci.get(UCI_PACKAGE, section_id, settingsKey);

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(`${raw}`);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (_error) {
    return {};
  }
}

function compactItemSettings(values) {
  const result = {};

  Object.entries(values || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    if (Array.isArray(value)) {
      const items = value
        .map((item) => `${item || ""}`.trim())
        .filter((item) => item.length);

      if (items.length) {
        result[key] = items;
      }
      return;
    }

    result[key] = `${value}`;
  });

  return result;
}

function writeItemSettingsMap(section_id, settingsKey, map) {
  const result = {};

  Object.entries(map || {}).forEach(([item, settings]) => {
    const compact = compactItemSettings(settings);
    if (item && Object.keys(compact).length) {
      result[item] = compact;
    }
  });

  if (Object.keys(result).length) {
    uci.set(UCI_PACKAGE, section_id, settingsKey, JSON.stringify(result));
  } else {
    uci.unset(UCI_PACKAGE, section_id, settingsKey);
  }
}

function cleanupListItemSettings(section_id, settingsKey, values) {
  if (!settingsKey) {
    return;
  }

  const keep = new Set(normalizeDynamicListItems(values));
  const map = readItemSettingsMap(section_id, settingsKey);
  let changed = false;

  Object.keys(map).forEach((item) => {
    if (!keep.has(item)) {
      delete map[item];
      changed = true;
    }
  });

  if (changed) {
    writeItemSettingsMap(section_id, settingsKey, map);
  }
}

function itemSettingsFlag(settings, key, defaultValue) {
  const value = settings ? settings[key] : null;

  if (value === undefined || value === null || value === "") {
    return Boolean(defaultValue);
  }

  return value === true || `${value}` === "1";
}

function ensureConnectionsDynamicListStyles() {
  if (document.getElementById(CONNECTIONS_DYNLIST_STYLE_ID)) {
    return;
  }

  document.head.appendChild(
    E(
      "style",
      { id: CONNECTIONS_DYNLIST_STYLE_ID },
      `
.fkp-connections-dynlist {
  --fkp-dynlist-action-gap: 0.5em;
  --fkp-dynlist-action-size: 2.5em;
  column-gap: var(--fkp-dynlist-action-gap);
  display: inline-grid;
  grid-template-columns: minmax(0, 1fr) auto;
}

.fkp-connections-dynlist > .item {
  grid-column: 1;
  min-inline-size: 0;
}

.fkp-connections-dynlist > .fkp-dynlist-settings {
  align-items: center;
  align-self: start;
  block-size: var(--fkp-dynlist-row-size, auto);
  box-sizing: border-box;
  display: inline-flex;
  grid-column: 2;
  inline-size: var(--fkp-dynlist-action-size) !important;
  justify-content: center;
  line-height: 1;
  margin: 0;
  margin-block-start: var(--fkp-dynlist-row-offset, 0px);
  min-block-size: 0;
  min-inline-size: 0;
  padding: 0;
  user-select: none;
}

.fkp-connections-dynlist > .add-item {
  grid-column: 1 / -1;
}

.fkp-connections-dynlist > .add-item > .cbi-dropdown {
  width: 100%;
}

.fkp-interface-dynlist-label {
  align-items: center;
  display: inline-flex;
  gap: 0.25em;
  max-width: 100%;
  vertical-align: middle;
}

.fkp-interface-dynlist-label > img {
  flex: 0 0 auto;
  height: 1.35em;
  width: auto;
}

.fkp-interface-dynlist-label > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

body.modal-overlay-active > #modal_overlay > .modal.cbi-modal > .cbi-map.flash {
  animation: none !important;
}

`,
    ),
  );
}

function findDynamicListItemByValue(dl, value) {
  const stringValue = `${value}`;
  const items = dl.querySelectorAll(".item");

  for (let i = 0; i < items.length; i += 1) {
    const hidden = items[i].querySelector('input[type="hidden"]');
    if (
      hidden &&
      hidden.parentNode === items[i] &&
      hidden.value === stringValue
    ) {
      return items[i];
    }
  }

  return null;
}

function dynamicListItemCurrentValue(item, fallback) {
  const hidden = item ? item.querySelector('input[type="hidden"]') : null;
  return hidden && hidden.parentNode === item ? hidden.value : fallback;
}

function dynamicListItemValues(dl) {
  return Array.from(dl.querySelectorAll(".item"))
    .map((item) => {
      const hidden = item.querySelector('input[type="hidden"]');
      return hidden && hidden.parentNode === item ? hidden.value : null;
    })
    .filter((value) => value != null);
}

function updateDynamicListItemLabel(item, label) {
  const labelNode = item ? item.querySelector(".fkp-dynlist-label") : null;
  if (labelNode) {
    labelNode.textContent = `${label || ""}`;
  }
}

function addDynamicListItem(widget, value, text) {
  if (!widget || !widget.node) {
    return null;
  }

  const normalized = `${value || ""}`.trim();
  if (!normalized) {
    return null;
  }

  if (
    typeof widget.options.hasEquivalentValue === "function" &&
    widget.options.hasEquivalentValue(normalized, widget.node)
  ) {
    widget.dispatchCbiDynlistChange(widget.node, normalized);
    return null;
  }

  widget.addItem(widget.node, normalized, text || null, false);
  widget.dispatchCbiDynlistChange(widget.node, normalized);
  updateButtonAddDynamicListLayout(widget.node, widget.options.addButtonLabel);

  return findDynamicListItemByValue(widget.node, normalized);
}

function updateButtonAddDynamicListLayout(dl, label) {
  const addButton = dl
    ? dl.querySelector(".add-item > .fkp-button-add-control") ||
      dl.querySelector(".add-item > .cbi-button-add")
    : null;
  if (!addButton) {
    return;
  }

  if (!addButton.classList.contains("fkp-button-add-control")) {
    addButton.className = "cbi-dropdown fkp-button-add-control";
    addButton.replaceChildren(
      E(
        "ul",
        { tabindex: "-1" },
        E("li", { placeholder: "", selected: "", display: "0" }),
      ),
      E("span", { "aria-hidden": "true" }, "\u200b"),
    );
  }

  const buttonLabel = label || "+";
  addButton.querySelector("li").textContent = buttonLabel;
  addButton.setAttribute("role", "button");
  addButton.setAttribute("tabindex", "0");
  addButton.setAttribute("aria-label", buttonLabel);
  addButton.setAttribute(
    "aria-disabled",
    dl.hasAttribute("disabled") ? "true" : "false",
  );
}

function setDynamicListItemValue(item, value) {
  const hidden = item ? item.querySelector('input[type="hidden"]') : null;
  if (hidden && hidden.parentNode === item) {
    hidden.value = `${value || ""}`;
  }
}

function parseOutboundJsonObject(value) {
  try {
    const parsed = JSON.parse(`${value || ""}`);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch (_error) {
    return null;
  }
}

function outboundJsonDisplayTag(value) {
  const parsed = parseOutboundJsonObject(value);
  const tag = parsed && typeof parsed.tag === "string" ? parsed.tag.trim() : "";
  return tag || "";
}

function outboundJsonListItemLabel(value) {
  return E(
    "span",
    { class: "fkp-dynlist-label" },
    outboundJsonDisplayTag(value) || _("JSON outbound"),
  );
}

const AMNEZIA_INTEGER_FIELDS = [
  "jc",
  "jmin",
  "jmax",
  "s1",
  "s2",
  "s3",
  "s4",
];
const AMNEZIA_RANGE_FIELDS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "content_padding_addition",
  "rekey_after_time",
  "rekey_timeout",
  "reject_after_time",
  "keepalive_timeout",
  "max_handshake_attempts",
];
const AMNEZIA_STRING_FIELDS = [
  "i1",
  "i2",
  "i3",
  "i4",
  "i5",
  "header_protection_key",
];
const AMNEZIA_FIELDS = [
  "jc",
  "jmin",
  "jmax",
  "s1",
  "s2",
  "s3",
  "s4",
  "h1",
  "h2",
  "h3",
  "h4",
  "i1",
  "i2",
  "i3",
  "i4",
  "i5",
  "header_protection_key",
  "content_padding_addition",
  "rekey_after_time",
  "rekey_timeout",
  "reject_after_time",
  "keepalive_timeout",
  "max_handshake_attempts",
];
const WARP_JUNK_FIELDS = [
  "jc",
  "jmin",
  "jmax",
  "i1",
  "i2",
  "i3",
  "i4",
  "i5",
  "content_padding_addition",
  "rekey_after_time",
  "rekey_timeout",
  "reject_after_time",
  "keepalive_timeout",
  "max_handshake_attempts",
];
const WIREGUARD_PEER_FIELDS = new Set([
  "address",
  "port",
  "public_key",
  "pre_shared_key",
  "allowed_ips",
  "persistent_keepalive_interval",
]);

function tunnelChild(sectionId, tunnelId) {
  return (uci.sections(UCI_PACKAGE, "tunnel") || []).find(
    (item) =>
      item[".name"] === `${tunnelId || ""}` &&
      item.section === `${sectionId || ""}`,
  );
}

function tunnelPeerIds(tunnelId) {
  return (uci.sections(UCI_PACKAGE, "tunnel_peer") || [])
    .filter((item) => item.tunnel === `${tunnelId || ""}`)
    .sort((left, right) => {
      const order = (item) => Number.parseInt(item.order || "0", 10) || 0;
      return (
        order(left) - order(right) ||
        `${left[".name"] || ""}`.localeCompare(`${right[".name"] || ""}`)
      );
    })
    .map((item) => item[".name"])
    .filter(Boolean);
}

function tunnelKindLabel(kind, endpointType) {
  return kind === "amneziawg"
    ? "AmneziaWG"
    : kind === "warp"
      ? "WARP"
      : kind === "tailscale"
        ? "Tailscale"
        : kind === "json"
          ? endpointType || "JSON endpoint"
          : "WireGuard";
}

function tunnelDisplayName(sectionId, tunnelId) {
  const child = tunnelChild(sectionId, tunnelId);
  const kind = `${child?.kind || "wireguard"}`.toLowerCase();
  if (kind === "json") {
    return outboundJsonDisplayTag(child?.endpoint_json || "");
  }
  return `${child?.name || ""}`.trim();
}

function tunnelListItemLabel(sectionId, tunnelId) {
  const child = tunnelChild(sectionId, tunnelId);
  const kind = `${child?.kind || "wireguard"}`.toLowerCase();
  let endpointType = "";
  if (kind === "json") {
    endpointType = parseOutboundJsonObject(child?.endpoint_json)?.type || "";
  }
  return E(
    "span",
    { class: "fkp-dynlist-label" },
    tunnelDisplayName(sectionId, tunnelId) ||
      tunnelKindLabel(kind, `${endpointType}`.toLowerCase()),
  );
}

function cleanFormSectionData(sectionData) {
  const result = {};

  Object.entries(sectionData || {}).forEach(([key, value]) => {
    if (!key || key.charAt(0) === ".") {
      return;
    }

    result[key] = Array.isArray(value) ? value.slice() : value;
  });

  return result;
}

const SettingsUIDynamicList = ui.DynamicList.extend({
  render() {
    ensureConnectionsDynamicListStyles();
    this.settingsButtonResizeObserver?.disconnect();
    this.settingsButtonResizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver((entries) => {
            entries.forEach((entry) => {
              this.syncSettingsButtonSize(entry.target);
            });
          })
        : null;

    const node = ui.DynamicList.prototype.render.apply(this, arguments);
    node.classList.add("fkp-connections-dynlist");
    node.addEventListener("cbi-dynlist-change", () => {
      this.syncSettingsButtons(node);
    });
    return node;
  },

  syncSettingsButtonSize(item) {
    const button = item && item.fkpDynamicListSettingsButton;
    const height = item && item.clientHeight;
    if (button && height > 0) {
      button.style.setProperty("--fkp-dynlist-row-size", `${height}px`);
      button.style.setProperty(
        "--fkp-dynlist-row-offset",
        `${item.clientTop}px`,
      );
    }
  },

  syncSettingsButtons(dl) {
    Array.from(dl.children).forEach((item) => {
      const button = item.fkpDynamicListSettingsButton;
      if (
        item.classList.contains("item") &&
        button &&
        button.parentNode === dl &&
        item.nextElementSibling !== button
      ) {
        item.after(button);
      }
    });
  },

  addItem(dl, value, text, flash) {
    if (
      flash &&
      typeof this.options.hasEquivalentValue === "function" &&
      this.options.hasEquivalentValue(value, dl)
    ) {
      this.dispatchCbiDynlistChange(dl, value);
      return;
    }

    const itemText =
      typeof this.options.itemLabel === "function"
        ? this.options.itemLabel(value, text)
        : text;

    ui.DynamicList.prototype.addItem.call(this, dl, value, itemText, flash);

    const item = findDynamicListItemByValue(dl, value);
    const hasSettings =
      typeof this.options.hasSettings === "function"
        ? this.options.hasSettings(value)
        : true;

    if (!item || item.fkpDynamicListSettingsButton || !hasSettings) {
      return;
    }

    const settingsButton = E(
      "button",
      {
        type: "button",
        class: "btn cbi-button cbi-button-neutral fkp-dynlist-settings",
        "aria-label": _("Settings"),
        disabled: this.options.disabled ? "" : null,
        click: (event) => {
          event.preventDefault();
          event.stopPropagation();

          if (this.options.disabled) {
            return;
          }

          if (typeof this.options.settingsHandler === "function") {
            this.options.settingsHandler(
              dynamicListItemCurrentValue(item, value),
              item,
              this,
              {},
            );
          }
        },
      },
      "\u2699",
    );
    item.fkpDynamicListSettingsButton = settingsButton;
    item.after(settingsButton);
    this.settingsButtonResizeObserver?.observe(item);
    this.syncSettingsButtonSize(item);
  },

  removeItem(dl, item) {
    const settingsButton = item && item.fkpDynamicListSettingsButton;
    this.settingsButtonResizeObserver?.unobserve(item);
    if (settingsButton && settingsButton.parentNode === dl) {
      settingsButton.remove();
    }

    return ui.DynamicList.prototype.removeItem.apply(this, arguments);
  },

  handleClick(event) {
    if (event.target.closest(".fkp-dynlist-settings")) {
      return;
    }

    return ui.DynamicList.prototype.handleClick.apply(this, arguments);
  },

  handleKeydown(event) {
    const dl = event.currentTarget;
    const item = event.target.closest(".item");
    const isBackspace = event.key === "Backspace" || event.keyCode === 8;
    const isDelete = event.key === "Delete" || event.keyCode === 46;

    if (
      !this.options.disabled &&
      item &&
      item.parentNode === dl &&
      (isBackspace || isDelete)
    ) {
      const items = Array.from(dl.children).filter((node) =>
        node.classList.contains("item"),
      );
      const index = items.indexOf(item);
      const nextItem = items[index + (isBackspace ? -1 : 1)];

      if (nextItem) {
        nextItem.focus();
      } else if (isDelete) {
        dl.querySelector(".add-item > *")?.focus();
      }

      this.removeItem(dl, item);
      event.preventDefault();
      return;
    }

    return ui.DynamicList.prototype.handleKeydown.apply(this, arguments);
  },
});

const ButtonAddSettingsUIDynamicList = SettingsUIDynamicList.extend({
  render() {
    const node = SettingsUIDynamicList.prototype.render.apply(this, arguments);
    node.classList.add("fkp-button-add-dynlist");

    const input = node.querySelector('.add-item > input[type="text"]');
    input?.remove();

    updateButtonAddDynamicListLayout(node, this.options.addButtonLabel);

    node.addEventListener("cbi-dynlist-change", () => {
      updateButtonAddDynamicListLayout(node, this.options.addButtonLabel);
    });

    return node;
  },

  addButtonItem() {
    if (typeof this.options.settingsHandler === "function") {
      this.options.settingsHandler("", null, this, { adding: true });
    }
  },

  handleClick(event) {
    if (
      !this.options.disabled &&
      event.target.closest(".add-item > .fkp-button-add-control")
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.addButtonItem(event.currentTarget);
      return;
    }

    return SettingsUIDynamicList.prototype.handleClick.apply(this, arguments);
  },

  handleKeydown(event) {
    if (
      !this.options.disabled &&
      event.target.closest(".add-item > .fkp-button-add-control") &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.addButtonItem(event.currentTarget);
      return;
    }

    return ui.DynamicList.prototype.handleKeydown.apply(this, arguments);
  },
});

const SettingsDynamicList = form.DynamicList.extend({
  childOwner(section_id) {
    return typeof this.childOwnerId === "function"
      ? `${this.childOwnerId(section_id) || ""}`.trim()
      : section_id;
  },

  parentSection(section_id) {
    return typeof this.parentSectionId === "function"
      ? `${this.parentSectionId(section_id) || ""}`.trim()
      : section_id;
  },

  load(section_id) {
    if (this.childType) {
      return getChildItemIds(
        this.childOwner(section_id),
        this.childType,
        this.ownerOption,
      );
    }

    return form.DynamicList.prototype.load.apply(this, arguments);
  },

  renderWidget(section_id, _option_index, cfgvalue) {
    const value = cfgvalue != null ? cfgvalue : this.default;
    const choices = this.transformChoices();
    const WidgetClass = this.buttonAdd
      ? ButtonAddSettingsUIDynamicList
      : SettingsUIDynamicList;
    const widget = new WidgetClass(L.toArray(value), choices, {
      id: this.cbid(section_id),
      sort: this.keylist,
      allowduplicates: this.allowduplicates,
      optional: this.optional || this.rmempty,
      datatype: this.datatype,
      placeholder: this.placeholder,
      validate: L.bind(this.validate, this, section_id),
      disabled: this.readonly != null ? this.readonly : this.map.readonly,
      addButtonLabel:
        typeof this.addButtonLabel === "function"
          ? this.addButtonLabel(section_id)
          : this.addButtonLabel,
      settingsHandler: (itemValue, _item, widget, context) => {
        if (typeof this.renderItemSettingsModal === "function") {
          const ownerId = this.childOwner(section_id);
          this.renderItemSettingsModal(
            ownerId,
            `${itemValue}`,
            this,
            widget,
            _item,
            Object.assign({}, context || {}, {
              parentSectionId: this.parentSection(section_id),
              ownerId,
            }),
          );
        }
      },
      itemLabel: (itemValue, text) => {
        if (typeof this.renderListItemLabel === "function") {
          return this.renderListItemLabel(
            this.childOwner(section_id),
            `${itemValue}`,
            text,
          );
        }

        return text;
      },
      hasSettings: (itemValue) => {
        if (typeof this.hasItemSettings === "function") {
          return this.hasItemSettings(
            this.childOwner(section_id),
            `${itemValue}`,
          );
        }

        if (this.childType) {
          return isExistingChildItem(
            this.childOwner(section_id),
            `${itemValue}`,
            this.childType,
            this.ownerOption,
          );
        }

        return true;
      },
      hasEquivalentValue: (itemValue, dl) => {
        const inputValueForItem = (value) => {
          const ownerId = this.childOwner(section_id);

          if (typeof this.inputValueForItem === "function") {
            return `${this.inputValueForItem(ownerId, `${value || ""}`) || ""}`.trim();
          }

          if (this.childType && this.childValueOption) {
            return childItemInputValue(
              ownerId,
              `${value || ""}`,
              this.childType,
              this.childValueOption,
              this.ownerOption,
            );
          }

          return `${value || ""}`.trim();
        };
        const normalized = inputValueForItem(itemValue);

        return Boolean(
          normalized &&
            dynamicListItemValues(dl).some(
              (existingValue) =>
                inputValueForItem(existingValue) === normalized,
            ),
        );
      },
    });

    const node = widget.render();
    if (typeof this.onListChange === "function") {
      node.addEventListener("cbi-dynlist-change", () => {
        this.onListChange(section_id);
      });
    }

    return node;
  },

  parse(section_id) {
    if (
      this.isActive(section_id) &&
      typeof this.validateItemsOnSave === "function"
    ) {
      const result = this.validateItemsOnSave(
        this.childType ? this.childOwner(section_id) : section_id,
        this.formvalue(section_id),
        this,
        section_id,
      );
      if (result !== true) {
        const title = this.stripTags(this.title).trim();
        return Promise.reject(
          new TypeError(
            `${_('Option "%s" contains an invalid input value.').format(title || this.option)} ${result}`,
          ),
        );
      }
    }

    return form.DynamicList.prototype.parse.apply(this, arguments);
  },

  write(section_id, value) {
    if (this.childType) {
      const ownerId = this.childOwner(section_id);
      const itemIds = materializeChildItems(
        ownerId,
        {
          typeName: this.childType,
          valueOption: this.childValueOption,
          ownerOption: this.ownerOption,
          createId: this.createId,
          defaults: this.childDefaults,
          stagedSettings:
            typeof this.stagedChildSettings === "function"
              ? (itemValue, itemId, created) =>
                  this.stagedChildSettings(ownerId, itemValue, itemId, created)
              : null,
        },
        value,
      );
      cleanupRemovedChildItems(
        ownerId,
        this.childType,
        itemIds,
        this.ownerOption,
      );
      if (typeof this.afterMaterializeChildItems === "function") {
        this.afterMaterializeChildItems(ownerId, itemIds);
      }
      uci.unset(UCI_PACKAGE, section_id, this.option);
      cleanupListItemSettings(ownerId, this.settingsKey, itemIds);
      if (typeof this.clearStagedChildSettings === "function") {
        this.clearStagedChildSettings(ownerId);
      }
      return;
    }

    const result = form.DynamicList.prototype.write.apply(this, arguments);
    cleanupListItemSettings(section_id, this.settingsKey, value);
    return result;
  },

  remove(section_id) {
    if (this.childType) {
      cleanupRemovedChildItems(
        this.childOwner(section_id),
        this.childType,
        [],
        this.ownerOption,
      );
      uci.unset(UCI_PACKAGE, section_id, this.option);
      return;
    }

    if (this.settingsKey) {
      uci.unset(UCI_PACKAGE, section_id, this.settingsKey);
    }

    return form.DynamicList.prototype.remove.apply(this, arguments);
  },
});

const ButtonAddSettingsDynamicList = SettingsDynamicList.extend({
  buttonAdd: true,
});

function configureLiveDynamicListChoices(
  option,
  getChoices,
  getRefreshSectionId = (section_id) => section_id,
) {
  option.renderWidget = function (section_id, _option_index, cfgvalue) {
    const refreshSectionId =
      `${getRefreshSectionId(section_id) || section_id}`.trim();
    const values = L.toArray(cfgvalue != null ? cfgvalue : this.default);
    const choices = getChoices(section_id);
    const labels = {};
    choices.forEach((choice) => {
      labels[choice.value] = choice.label;
    });
    refreshOptionChoices(this, choices);
    let choiceSignature = JSON.stringify(
      choices.map((choice) => [choice.value, choice.label]),
    );
    // form.DynamicList passes null when there are no choices, which permanently
    // renders a plain input. An empty object keeps the stock combobox alive so
    // later live choices can be added without reopening the modal.
    const widget = new ui.DynamicList(values, labels, {
      id: this.cbid(section_id),
      sort: this.keylist,
      allowduplicates: this.allowduplicates,
      optional: this.optional || this.rmempty,
      datatype: this.datatype,
      placeholder: this.placeholder,
      validate: L.bind(this.validate, this, section_id),
      disabled: this.readonly != null ? this.readonly : this.map.readonly,
    });
    const node = widget.render();
    const refreshChoices = () => {
      if (!node.isConnected) {
        return false;
      }

      const currentChoices = getChoices(section_id);
      const currentLabels = {};
      currentChoices.forEach((choice) => {
        currentLabels[choice.value] = choice.label;
      });
      const currentSignature = JSON.stringify(
        currentChoices.map((choice) => [choice.value, choice.label]),
      );

      if (currentSignature === choiceSignature) {
        return;
      }
      choiceSignature = currentSignature;

      refreshOptionChoices(this, currentChoices);
      widget.choices = currentLabels;
      widget.clearChoices();
      widget.addChoices(
        currentChoices.map((choice) => choice.value),
        currentLabels,
      );
      return true;
    };
    const refreshBeforeOpening = (event) => {
      if (event.target && event.target.closest(".add-item")) {
        refreshChoices();
      }
    };
    node.addEventListener("mousedown", refreshBeforeOpening, true);
    node.addEventListener("focusin", refreshBeforeOpening, true);

    if (!dashboardFilterChoiceRefreshers.has(refreshSectionId)) {
      dashboardFilterChoiceRefreshers.set(refreshSectionId, new Set());
    }
    dashboardFilterChoiceRefreshers.get(refreshSectionId).add(refreshChoices);

    return node;
  };
}

function outboundNameChoiceItems(names, normalizeChoice) {
  const seen = new Set();
  const result = [];
  const append = (name) => {
    let value = `${name || ""}`.trim();
    if (typeof normalizeChoice === "function") {
      value = `${normalizeChoice(value) || ""}`.trim();
    }
    if (!value || seen.has(value)) {
      return;
    }

    seen.add(value);
    result.push({ value, label: value });
  };

  names.forEach(append);

  return result.sort((a, b) => a.label.localeCompare(b.label));
}

function currentOutboundNameChoices(section_id, normalizeChoice) {
  if (!outboundNameChoicesCache.has(section_id)) {
    loadOutboundNameChoices(section_id);
  }

  return outboundNameChoiceItems(
    [
      ...(outboundNameChoicesCache.get(section_id) || []),
      ...currentDraftOutboundNames(section_id),
    ],
    normalizeChoice,
  );
}

function currentSubscriptionOutboundNameChoices(
  section_id,
  itemId,
  normalizeChoice,
) {
  const cacheKey = `${section_id}:${itemId}`;
  if (!subscriptionOutboundNameChoicesCache.has(cacheKey)) {
    loadSubscriptionOutboundNameChoices(section_id, itemId);
  }

  return outboundNameChoiceItems(
    subscriptionOutboundNameChoicesCache.get(cacheKey) || [],
    normalizeChoice,
  );
}

function currentSourceOptionValues(section_id, optionName) {
  const liveValues = currentLiveDynamicListValues(section_id, optionName);
  if (liveValues != null) {
    return liveValues;
  }

  const option = outboundNameSourceOptions.get(optionName);

  if (option && typeof option.formvalue === "function") {
    try {
      const value = option.formvalue(section_id);
      if (value != null) {
        return normalizeDynamicListItems(value);
      }
    } catch (_error) {
      // Fall back to the LuCI UCI cache when the section widget is not mounted.
    }
  }

  return getConfigListValues(section_id, optionName);
}

function currentLiveDynamicListValues(section_id, optionName) {
  if (typeof document === "undefined") {
    return null;
  }

  const option = outboundNameSourceOptions.get(optionName);
  const trackedWidget = option?.liveDynamicListNodes?.get(section_id);
  let widget;

  if (trackedWidget) {
    if (trackedWidget.isConnected === false) {
      return null;
    }
    widget = trackedWidget;
  } else {
    widget = document.getElementById(
      `cbid.${UCI_PACKAGE}.${section_id}.${optionName}`,
    );
  }

  if (!widget) {
    return null;
  }

  const values = Array.from(
    widget.querySelectorAll('.item > input[type="hidden"]'),
  )
    .map((input) => `${input.value || ""}`.trim())
    .filter(Boolean);
  const pendingInput = widget.querySelector('.add-item > input[type="text"]');
  const pendingValue = `${(pendingInput && pendingInput.value) || ""}`.trim();

  if (
    pendingValue &&
    !pendingInput.classList.contains("cbi-input-invalid") &&
    !values.includes(pendingValue)
  ) {
    values.push(pendingValue);
  }

  return values;
}

function currentDraftOutboundNames(section_id) {
  const names = [];

  currentSourceOptionValues(section_id, "selector_proxy_links").forEach(
    (value, index) => {
      const name = main.getProxyUrlName(`${value || ""}`);
      names.push(name || `${section_id}-${index + 1}-out`);
    },
  );
  currentSourceOptionValues(section_id, "interfaces").forEach((itemId) => {
    const interfaceName = childItemInputValue(
      section_id,
      itemId,
      "section_interface",
      "name",
    ).trim();
    const option = outboundNameSourceOptions.get("interfaces");
    const staged = childPendingSettingsStore(option, section_id)[interfaceName];
    const displayName = `${
      staged?.display_name ||
      (isExistingChildItem(section_id, itemId, "section_interface")
        ? uci.get(UCI_PACKAGE, itemId, "display_name")
        : "") ||
      interfaceName
    }`.trim();
    if (displayName) {
      names.push(displayName);
    }
  });
  currentSourceOptionValues(section_id, "outbound_jsons").forEach((value) => {
    const outbound = parseOutboundJsonObject(value);
    const type = `${outbound?.type || ""}`.trim().toLowerCase();
    const tag = outboundJsonDisplayTag(value);
    if (
      tag &&
      !["selector", "urltest", "fallback", "dns", "block"].includes(type)
    ) {
      names.push(tag);
    }
  });
  currentSourceOptionValues(section_id, "tunnels").forEach((value) => {
    const name = tunnelDisplayName(section_id, value);
    if (name) {
      names.push(name);
    }
  });

  return names;
}

function refreshDashboardFilterChoiceWidgets(section_id) {
  const refreshers = dashboardFilterChoiceRefreshers.get(section_id);
  if (!refreshers) {
    return;
  }

  refreshers.forEach((refresh) => {
    if (refresh() === false) {
      refreshers.delete(refresh);
    }
  });

  if (refreshers.size === 0) {
    dashboardFilterChoiceRefreshers.delete(section_id);
  }
}

function isDownloadThroughTargetSection(section, currentSectionId) {
  const sectionName = getUciSectionName(section);
  const action = (section && section.action) || "";

  if (
    !sectionName ||
    sectionName === currentSectionId ||
    section.enabled === "0"
  ) {
    return false;
  }

  if (["connection", "proxy", "outbound", "vpn"].includes(action)) {
    return true;
  }

  if (action === "zapret") {
    return isZapretInstalledForUi();
  }

  if (action === "zapret2") {
    return isZapret2InstalledForUi();
  }

  if (action === "byedpi") {
    return isByedpiInstalledForUi();
  }

  return false;
}

function subscriptionDownloadTargetChoices(section_id) {
  return (uci.sections(UCI_PACKAGE, "section") || [])
    .filter((section) => isDownloadThroughTargetSection(section, section_id))
    .map((section) => ({
      value: getUciSectionName(section),
      label: getUciSectionLabel(section),
    }));
}

function dnsTypeChoices() {
  return [
    { value: "doh", label: _("DNS over HTTPS (DoH)") },
    { value: "dot", label: _("DNS over TLS (DoT)") },
    { value: "udp", label: "UDP" },
  ];
}

function isConnectionNetworkInterfaceAllowed(deviceName, device) {
  if (CONNECTIONS_BLOCKED_INTERFACES.includes(deviceName)) {
    return false;
  }

  if (!device) {
    return true;
  }

  const type = device.getType();
  const isWireless =
    type === "wifi" || type === "wireless" || type.indexOf("wlan") >= 0;

  return !isWireless;
}

function renderNetworkInterfaceChoice(device) {
  const name = device.getName();
  const type = device.getType();

  return E([
    E("img", {
      title: device.getI18n(),
      src: L.resource(
        "icons/%s%s.svg".format(type, device.isUp() ? "" : "_disabled"),
      ),
    }),
    E("span", { class: "hide-open" }, [name]),
    E("span", { class: "hide-close" }, [device.getI18n()]),
  ]);
}

function renderNetworkInterfaceListItem(device, fallbackName) {
  const name = device ? device.getName() : fallbackName;
  const type = device ? device.getType() : "ethernet";
  const up = device ? device.isUp() : false;

  return E("span", { class: "fkp-interface-dynlist-label" }, [
    E("img", {
      title: device ? device.getI18n() : _("Network Interface"),
      src: L.resource("icons/%s%s.svg".format(type, up ? "" : "_disabled")),
    }),
    E("span", {}, [name]),
  ]);
}

function refreshNetworkInterfaceOptionValues(option) {
  option.keylist = [];
  option.vallist = [];
  option.interfaceDeviceMap = {};

  (option.devices || []).forEach((device) => {
    const name = device.getName();
    const type = device.getType();

    if (
      name === "lo" ||
      type === "alias" ||
      !isConnectionNetworkInterfaceAllowed(name, device)
    ) {
      return;
    }

    option.value(name, renderNetworkInterfaceChoice(device));
    option.interfaceDeviceMap[name] = device;
  });
}

const InterfaceSettingsDynamicList = SettingsDynamicList.extend({
  load(section_id) {
    return network.getDevices().then(
      L.bind(function (devices) {
        this.devices = devices || [];
        refreshNetworkInterfaceOptionValues(this);

        return this.super("load", section_id);
      }, this),
    );
  },

  renderListItemLabel(section_id, value, text) {
    value = childItemInputValue(section_id, value, "section_interface", "name");

    return renderNetworkInterfaceListItem(
      this.interfaceDeviceMap ? this.interfaceDeviceMap[value] : null,
      value || text,
    );
  },
});

function syncServerFilterFields(sharedFields, sourceMode, itemId) {
  const sourceFields = sharedFields[sourceMode];
  if (!sourceFields) {
    return;
  }

  Object.entries(sourceFields).forEach(([storageKey, sourceField]) => {
    const sourceElement = sourceField.getUIElement(itemId);
    if (!sourceElement || typeof sourceElement.getValue !== "function") {
      return;
    }
    Object.values(sharedFields).forEach((fields) => {
      const targetElement = fields[storageKey]?.getUIElement(itemId);
      if (targetElement && typeof targetElement.setValue === "function") {
        targetElement.setValue(sourceElement.getValue());
      }
    });
  });
}

function addServerFilterOptions(
  itemSection,
  parentSectionForItem,
  options = {},
) {
  const modes = Array.isArray(options.modes) ? options.modes : [];
  let o = itemSection.option(
    form.ListValue,
    "server_filter_mode",
    options.modeLabel,
    options.modeDescription,
  );
  modes.forEach((mode) => o.value(mode.value, mode.label));
  o.default = options.defaultMode || "all";
  o.rmempty = false;

  const modeOption = o;
  const sharedFields = {};
  [
    [
      "include_outbounds",
      "include_outbounds",
      _("Include servers"),
      options.includeServersDescription,
      null,
      ["include"],
    ],
    [
      "include_regex",
      "include_regex",
      _("Include by pattern"),
      options.includeRegexDescription,
      validateRegex,
      ["include"],
    ],
    [
      "_blacklist_exclude_outbounds",
      "exclude_outbounds",
      _("Exclude servers"),
      options.blacklistExcludeServersDescription,
      null,
      ["exclude"],
    ],
    [
      "_blacklist_exclude_regex",
      "exclude_regex",
      _("Exclude by pattern"),
      options.blacklistExcludeRegexDescription,
      validateRegex,
      ["exclude"],
    ],
    [
      "_whitelist_exclude_outbounds",
      "exclude_outbounds",
      _("Exclude servers"),
      options.whitelistExcludeServersDescription,
      null,
      ["include"],
    ],
    [
      "_whitelist_exclude_regex",
      "exclude_regex",
      _("Exclude by pattern"),
      options.whitelistExcludeRegexDescription,
      validateRegex,
      ["include"],
    ],
  ].forEach(
    ([key, storageKey, label, description, validator, visibleModes]) => {
      const field = itemSection.option(
        storageKey.endsWith("_outbounds") ? form.DynamicList : form.Value,
        key,
        label,
        description,
      );
      visibleModes.forEach((mode) => field.depends("server_filter_mode", mode));
      field.rmempty = true;
      if (key !== storageKey) {
        field.ucioption = storageKey;
        field.retain = true;
        const mode = visibleModes[0];
        if (!sharedFields[mode]) {
          sharedFields[mode] = {};
        }
        sharedFields[mode][storageKey] = field;
      }
      if (storageKey.endsWith("_outbounds")) {
        const choicesForItem = (option, itemId) => {
          const sectionId = parentSectionForItem(itemId);
          const normalizeChoice =
            typeof options.normalizeOutboundChoice === "function"
              ? (name) => options.normalizeOutboundChoice(option, itemId, name)
              : null;
          return typeof options.ownerId === "function"
            ? currentSubscriptionOutboundNameChoices(
                sectionId,
                options.ownerId(),
                normalizeChoice,
              )
            : currentOutboundNameChoices(sectionId, normalizeChoice);
        };
        field.load = function (itemId) {
          const sectionId = parentSectionForItem(itemId);
          const values = normalizeOptionValues(
            optionMapValue(this, itemId, storageKey),
          );
          if (typeof options.ownerId === "function") {
            loadSubscriptionOutboundNameChoices(sectionId, options.ownerId());
          } else {
            loadOutboundNameChoices(sectionId);
          }
          refreshOptionChoices(this, choicesForItem(this, itemId));
          return values;
        };
        field.placeholder = _("-- Select --");
        configureLiveDynamicListChoices(field, (itemId) =>
          choicesForItem(field, itemId),
          parentSectionForItem,
        );
      }
      if (validator) {
        field.validate = function (_itemId, value) {
          return validator(null, value);
        };
      }
    },
  );

  let activeMode =
    optionMapValue(modeOption, "settings", "server_filter_mode") ||
    modeOption.default;
  modeOption.onchange = function (_event, itemId, value) {
    syncServerFilterFields(sharedFields, activeMode, itemId);
    activeMode = value;
  };
}

function urlTestUrlChoices() {
  return Array.isArray(main.LATENCY_TEST_URL_OPTIONS)
    ? main.LATENCY_TEST_URL_OPTIONS
    : [main.DEFAULT_LATENCY_TEST_URL || "https://www.gstatic.com/generate_204"];
}

function validateUrlTestTolerance(value) {
  if (!value || `${value}`.length === 0) {
    return _("Must be a number in the range of 0 - 10000");
  }

  const normalized = `${value}`;
  const parsed = parseFloat(normalized);
  if (
    /^[0-9]+$/.test(normalized) &&
    !isNaN(parsed) &&
    isFinite(parsed) &&
    parsed >= 0 &&
    parsed <= 10000
  ) {
    return true;
  }

  return _("Must be a number in the range of 0 - 10000");
}

function validateUrlTestUrl(value) {
  const validation = main.validateUrl(`${value || ""}`.trim());
  return validation.valid ? true : validation.message;
}

function validateFallbackMaxFailedTimes(value) {
  const normalized = `${value || ""}`.trim();
  const parsed = Number(normalized);
  return /^[1-9][0-9]*$/.test(normalized) &&
    Number.isSafeInteger(parsed) &&
    parsed <= 2147483647
    ? true
    : _("Use a positive integer");
}

function validateFallbackExpectedStatus(value) {
  const normalized = `${value || ""}`.trim();
  if (!normalized || normalized === "*") {
    return true;
  }

  const parts = normalized.replaceAll(",", "/").split("/");
  if (parts.length > 28) {
    return _("Use *, status codes, or ranges such as 204/200-299");
  }
  for (const part of parts) {
    if (!part.trim()) {
      continue;
    }
    const bounds = part.split("-");
    if (
      bounds.length > 2 ||
      bounds.some((bound) => {
        const code = bound.trim().replace(/[\[\] ]/g, "");
        return !/^[0-9]+$/.test(code) || Number(code) > 65535;
      })
    ) {
      return _("Use *, status codes, or ranges such as 204/200-299");
    }
  }
  return true;
}

function optionMapValue(option, section_id, key) {
  const value =
    option && option.map && option.map.data
      ? option.map.data.get(option.map.config, section_id, key)
      : uci.get(UCI_PACKAGE, section_id, key);

  return value == null ? "" : value;
}

function subscriptionUrlSettingsKeys() {
  return [
    "subscription_update_enabled",
    "subscription_update_interval",
    "download_via_proxy_enabled",
    "download_via_proxy_section",
    "user_agent",
    "header",
    "show_dashboard_metadata",
    "prefix_nodes",
    "node_prefix",
    "server_filter_mode",
    "include_outbounds",
    "include_regex",
    "exclude_outbounds",
    "exclude_regex",
  ];
}

function defaultSubscriptionUrlSettings(headers = []) {
  return {
    subscription_update_enabled: "1",
    subscription_update_interval: "1h",
    download_via_proxy_enabled: "0",
    download_via_proxy_section: "",
    user_agent: "sing-box",
    header: Array.isArray(headers) ? headers.slice() : [],
    show_dashboard_metadata: "1",
    prefix_nodes: "0",
    node_prefix: "",
    server_filter_mode: "all",
  };
}

function subscriptionHeaderValues(value) {
  if (Array.isArray(value)) {
    return value.map((item) => `${item || ""}`).filter(Boolean);
  }
  return value ? [`${value}`] : [];
}

function parseSubscriptionHeader(value) {
  value = `${value || ""}`;
  const separator = value.indexOf(":");
  return separator < 0
    ? { name: value.trim(), value: "" }
    : {
        name: value.slice(0, separator).trim(),
        value: value.slice(separator + 1).trim(),
      };
}

function subscriptionHeaderRows(value) {
  return subscriptionHeaderValues(value).map((line, index) => ({
    ".name": `header_${index}`,
    ".type": "header",
    ...parseSubscriptionHeader(line),
  }));
}

function validateSubscriptionHeaderName(_sectionId, value) {
  value = `${value || ""}`.trim();
  if (!value) {
    return _("Enter a header name");
  }
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)
    ? true
    : _("Header name contains invalid characters");
}

function validateSubscriptionHeaderValue(_sectionId, value) {
  return /[\r\n\0]/.test(`${value || ""}`)
    ? _("Header value must stay on one line")
    : true;
}

function subscriptionHeaderLines(map) {
  return map.data.sections(map.config, "header").map((row) => {
    const name = `${row.name || ""}`.trim();
    const value = `${row.value || ""}`.trim();
    return `${name}:${value ? ` ${value}` : ""}`;
  });
}

function syncSubscriptionHeaderRows(section) {
  const configName = section.uciconfig ?? section.map.config;

  section.cfgsections().forEach((sectionId) => {
    section.children.forEach((option) => {
      if (!option.editable || option.modalonly) {
        return;
      }

      const value = option.formvalue(sectionId);
      if (value == null) {
        section.map.data.unset(configName, sectionId, option.option);
      } else {
        section.map.data.set(configName, sectionId, option.option, value);
      }
    });
  });
}

function refreshSubscriptionHeaderRows(section) {
  return section.map.load().then(() => section.map.reset());
}

function nextSubscriptionHeaderRowId(section) {
  const configName = section.uciconfig ?? section.map.config;
  let sectionId;

  do {
    sectionId = `header_${section.nextHeaderRowIndex}`;
    section.nextHeaderRowIndex += 1;
  } while (section.map.data.get(configName, sectionId) != null);

  return sectionId;
}

function addSubscriptionHeaderRow(section) {
  syncSubscriptionHeaderRows(section);
  section.map.data.add(
    section.uciconfig ?? section.map.config,
    section.sectiontype,
    nextSubscriptionHeaderRowId(section),
  );
  return refreshSubscriptionHeaderRows(section);
}

function removeSubscriptionHeaderRow(section, sectionId) {
  syncSubscriptionHeaderRows(section);
  section.map.data.remove(section.uciconfig ?? section.map.config, sectionId);
  return refreshSubscriptionHeaderRows(section);
}

function showSubscriptionHeadersModal(parentMap, itemId) {
  const data = {
    header: subscriptionHeaderRows(
      parentMap.data.get(parentMap.config, itemId, "header"),
    ),
  };
  const map = new form.JSONMap(data);
  const headers = map.section(
    form.GridSection,
    "header",
    _("Subscription headers"),
  );
  headers.anonymous = true;
  headers.addremove = true;
  headers.sortable = false;
  headers.rowcolors = true;
  headers.nodescriptions = true;
  headers.hidetitle = true;
  headers.addbtntitle = _("Add header");
  headers.nextHeaderRowIndex = data.header.length;
  headers.handleAdd = function () {
    return addSubscriptionHeaderRow(this);
  };
  headers.handleRemove = function (sectionId) {
    return removeSubscriptionHeaderRow(this, sectionId);
  };
  headers.renderRowActions = function (sectionId) {
    return form.TableSection.prototype.renderRowActions.call(this, sectionId);
  };

  let o = headers.option(form.Value, "name", _("Header name"));
  o.editable = true;
  o.rmempty = false;
  o.validate = validateSubscriptionHeaderName;

  o = headers.option(form.Value, "value", _("Header value"));
  o.editable = true;
  o.rmempty = true;
  o.validate = validateSubscriptionHeaderValue;

  return renderStackedJsonSettingsModal(_("Subscription headers"), map, () => {
    parentMap.data.set(
      parentMap.config,
      itemId,
      "header",
      subscriptionHeaderLines(map),
    );
  });
}

function interfaceSettingsKeys() {
  return [
    "display_name",
    "domain_resolver_enabled",
    "domain_resolver_dns_type",
    "domain_resolver_dns_server",
  ];
}

function defaultInterfaceSettings(displayName = "") {
  return {
    display_name: displayName,
    domain_resolver_enabled: "0",
    domain_resolver_dns_type: "udp",
    domain_resolver_dns_server: "8.8.8.8",
  };
}

function subscriptionUserAgentChoices() {
  return [
    "sing-box",
    "Happ",
    "v2rayN",
    "v2rayNG",
    "v2RayTun",
    "Incy",
    "Hiddify",
    "HiddifyNext",
    "Clash",
    "Clash.Meta",
    "ClashMetaForAndroid",
    "Mihomo",
    "NekoBox",
    "Karing",
    "Husi",
  ];
}

function urlTestSettingsKeys() {
  return [
    "name",
    "check_interval",
    "tolerance",
    "testing_url",
    "idle_timeout",
    "interrupt_exist_connections",
    "hide_dashboard_members",
    "server_filter_mode",
    "include_outbounds",
    "include_regex",
    "exclude_outbounds",
    "exclude_regex",
  ];
}

function defaultUrlTestSettings(name) {
  return {
    name: `${name || ""}`,
    check_interval: "3m",
    tolerance: "50",
    testing_url: "https://www.gstatic.com/generate_204",
    idle_timeout: "30m",
    interrupt_exist_connections: "1",
    hide_dashboard_members: "0",
    server_filter_mode: "all",
  };
}

function urlTestChildDefaults() {
  return {
    check_interval: "3m",
    tolerance: "50",
    testing_url: "https://www.gstatic.com/generate_204",
    idle_timeout: "30m",
    interrupt_exist_connections: "1",
    hide_dashboard_members: "0",
    server_filter_mode: "all",
  };
}

function fallbackGroupSettingsKeys() {
  return [
    "name",
    "health_check_url",
    "health_check_interval",
    "health_check_timeout",
    "max_failed_times",
    "expected_status",
    "idle_timeout",
    "interrupt_exist_connections",
    "hide_dashboard_members",
  ];
}

function defaultFallbackGroupSettings(name = "") {
  return {
    name,
    health_check_url: "https://www.gstatic.com/generate_204",
    health_check_interval: "5m",
    health_check_timeout: "5s",
    max_failed_times: "5",
    expected_status: "*",
    idle_timeout: "5m",
    interrupt_exist_connections: "1",
    hide_dashboard_members: "0",
  };
}

function fallbackGroupChildDefaults() {
  return {
    health_check_url: "https://www.gstatic.com/generate_204",
    health_check_interval: "5m",
    health_check_timeout: "5s",
    max_failed_times: "5",
    expected_status: "*",
    idle_timeout: "5m",
    interrupt_exist_connections: "1",
    hide_dashboard_members: "0",
  };
}

function fallbackLevelSettingsKeys() {
  return [
    "name",
    "order",
    "server_filter_mode",
    "include_outbounds",
    "include_regex",
    "exclude_outbounds",
    "exclude_regex",
  ];
}

function defaultFallbackLevelSettings() {
  return {
    name: "",
    order: "0",
    server_filter_mode: "include",
  };
}

function randomFallbackGroupId() {
  for (let i = 0; i < 100; i += 1) {
    const value = Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, "0");
    const id = `pg_${value}`;

    if (!uci.get(UCI_PACKAGE, id)) {
      return id;
    }
  }

  return `pg_${Date.now().toString(16)}`;
}

function addSubscriptionUrlItemOptions(itemSection, options = {}) {
  const parentSectionForItem =
    typeof options.parentSectionId === "function"
      ? options.parentSectionId
      : parentSectionIdForItem;

  let o = itemSection.option(
    form.Flag,
    "subscription_update_enabled",
    _("Subscription auto update"),
    _("Update this subscription automatically"),
  );
  o.default = "1";
  o.rmempty = false;

  o = itemSection.option(
    form.Value,
    "subscription_update_interval",
    _("Subscription update interval"),
    _("Use sing-box duration format like 1d, 12h or 30m"),
  );
  o.depends("subscription_update_enabled", "1");
  o.placeholder = "1h";
  o.validate = function (itemId, value) {
    return optionMapValue(this, itemId, "subscription_update_enabled") === "1"
      ? validateRequiredSingBoxDuration(value)
      : validateOptionalSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Flag,
    "download_via_proxy_enabled",
    _("Download subscription through a section"),
    _("Download subscriptions via the selected section"),
  );
  o.default = "0";
  o.rmempty = false;

  o = itemSection.option(
    form.ListValue,
    "download_via_proxy_section",
    _("Download through"),
  );
  o.depends("download_via_proxy_enabled", "1");
  o.load = function (itemId) {
    const sectionId = parentSectionForItem(itemId);
    refreshOptionChoices(this, subscriptionDownloadTargetChoices(sectionId));
    return optionMapValue(this, itemId, "download_via_proxy_section") || "";
  };
  o.validate = function (itemId, value) {
    const sectionId = parentSectionForItem(itemId);
    if (optionMapValue(this, itemId, "download_via_proxy_enabled") !== "1") {
      return true;
    }
    if (!value) {
      return _("Select a section for downloading this subscription");
    }
    if (value === sectionId) {
      return _("Current section cannot download its own subscription");
    }
    return true;
  };

  o = itemSection.option(
    form.Value,
    "user_agent",
    _("User-Agent"),
    _("Select a common client profile or enter a custom User-Agent"),
  );
  o.default = "sing-box";
  o.placeholder = _("-- Select --");
  o.rmempty = false;
  subscriptionUserAgentChoices().forEach((choice) => o.value(choice));
  o.load = function (itemId) {
    return optionMapValue(this, itemId, "user_agent") || "sing-box";
  };
  o.validate = function (_itemId, value) {
    return `${value || ""}`.trim() ? true : _("Select or enter a User-Agent");
  };

  o = itemSection.option(
    form.Button,
    "_subscription_headers",
    _("Subscription headers"),
    _("Configure headers sent with this subscription request."),
  );
  o.inputtitle = _("Edit headers");
  o.inputstyle = "edit";
  o.onclick = function () {
    return showSubscriptionHeadersModal(itemSection.map, "settings");
  };

  o = itemSection.option(
    form.Flag,
    "show_dashboard_metadata",
    _("Show metadata on dashboard"),
    _("Show subscription metadata for this source on the dashboard"),
  );
  o.default = "1";
  o.rmempty = false;

  o = itemSection.option(
    form.Flag,
    "prefix_nodes",
    _("Add prefix to nodes"),
    _(
      "Automatically add text to the name of each server from this subscription for convenient filtering.",
    ),
  );
  o.default = "0";
  o.rmempty = false;

  o = itemSection.option(form.Value, "node_prefix", _("Prefix text"));
  o.depends("prefix_nodes", "1");
  o.rmempty = false;

  addServerFilterOptions(itemSection, parentSectionForItem, {
    ownerId: options.ownerId,
    modeLabel: _("Subscription server filter"),
    modeDescription: _(
      "Determines which servers will be imported from this subscription.",
    ),
    modes: [
      { value: "all", label: _("All servers") },
      { value: "exclude", label: _("Blacklist") },
      { value: "include", label: _("Whitelist") },
    ],
    includeServersDescription: _(
      "Only the selected servers will be added from the subscription.",
    ),
    includeRegexDescription: _(
      "Add servers whose names match the regular expression.",
    ),
    blacklistExcludeServersDescription: _(
      "Servers that should not be added from the subscription.",
    ),
    blacklistExcludeRegexDescription: _(
      "Exclude servers from the subscription using a regular expression.",
    ),
    whitelistExcludeServersDescription: _(
      "Optional. Remove specific servers from the selection above.",
    ),
    whitelistExcludeRegexDescription: _(
      "Optional. Exclude servers from the selection above using a regular expression.",
    ),
    normalizeOutboundChoice: (option, itemId, name) =>
      subscriptionSourceOutboundName(
        name,
        optionMapValue(option, itemId, "prefix_nodes"),
        optionMapValue(option, itemId, "node_prefix"),
      ),
  });
}

function addInterfaceItemOptions(itemSection) {
  let o = itemSection.option(
    form.Value,
    "display_name",
    _("Display name"),
    _("Name displayed on the dashboard"),
  );
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return `${value || ""}`.trim() ? true : _("Enter a display name");
  };

  o = itemSection.option(
    form.Flag,
    "domain_resolver_enabled",
    _("Domain Resolver"),
    _("Enable built-in DNS resolver for domains handled by this section"),
  );
  o.default = "0";
  o.rmempty = false;

  o = itemSection.option(
    form.ListValue,
    "domain_resolver_dns_type",
    _("DNS protocol"),
    _("DNS protocol used by the resolver"),
  );
  o.depends("domain_resolver_enabled", "1");
  dnsTypeChoices().forEach((choice) => o.value(choice.value, choice.label));
  o.default = "udp";

  o = itemSection.option(
    form.Value,
    "domain_resolver_dns_server",
    _("DNS server"),
    _("DNS server used by the resolver"),
  );
  o.depends("domain_resolver_enabled", "1");
  o.default = "8.8.8.8";
  o.validate = function (itemId, value) {
    if (optionMapValue(this, itemId, "domain_resolver_enabled") !== "1") {
      return true;
    }
    const validation = main.validateDNS(value);
    return validation.valid ? true : validation.message;
  };
}

function addUrlTestItemOptions(itemSection, options = {}) {
  const parentSectionForItem =
    typeof options.parentSectionId === "function"
      ? options.parentSectionId
      : parentSectionIdForItem;

  let o = itemSection.option(
    form.Value,
    "name",
    _("Display name"),
    _("Name displayed on the dashboard"),
  );
  o.rmempty = false;
  o.load = function (itemId) {
    return (
      optionMapValue(this, itemId, "name") ||
      optionMapValue(this, itemId, "display_name") ||
      ""
    );
  };
  o.validate = function (_itemId, value) {
    return `${value || ""}`.trim()
      ? (options.validateName?.(value) ?? true)
      : _("Enter a display name");
  };

  o = itemSection.option(
    form.Value,
    "check_interval",
    _("Check interval"),
    _("Use sing-box duration format like 1d, 12h or 30m"),
  );
  o.default = "3m";
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateRequiredSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Value,
    "tolerance",
    _("Tolerance"),
    _(
      "Minimum latency difference in milliseconds that triggers switching to a faster server.",
    ),
  );
  o.default = "50";
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateUrlTestTolerance(value);
  };

  o = itemSection.option(
    form.Value,
    "testing_url",
    _("Check URL"),
    _("URL used to test server latency"),
  );
  o.default = "https://www.gstatic.com/generate_204";
  o.rmempty = false;
  urlTestUrlChoices().forEach((value) => o.value(value));
  o.validate = function (_itemId, value) {
    return validateUrlTestUrl(value);
  };

  o = itemSection.option(
    form.Value,
    "idle_timeout",
    _("Idle timeout"),
    _(
      "Stop health checks when the group is not used. Use sing-box duration format like 1d, 12h or 30m.",
    ),
  );
  o.default = "30m";
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateRequiredSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Flag,
    "interrupt_exist_connections",
    _("Interrupt connections"),
    _("Interrupt connections when URLTest switches the selected server"),
  );
  o.default = "1";
  o.rmempty = false;

  o = itemSection.option(
    form.Flag,
    "hide_dashboard_members",
    _("Hide group servers"),
    _("Hide servers included in this group from the dashboard."),
  );
  o.default = "0";
  o.rmempty = false;

  addServerFilterOptions(itemSection, parentSectionForItem, {
    modeLabel: _("URLTest group filter"),
    modeDescription: _(
      "Determines which servers will be included in the URLTest group",
    ),
    modes: [
      { value: "all", label: _("All servers") },
      { value: "exclude", label: _("Blacklist") },
      { value: "include", label: _("Whitelist") },
    ],
    includeServersDescription: _(
      "Only the selected servers will be added to the URLTest group.",
    ),
    includeRegexDescription: _(
      "Add servers whose names match the regular expression.",
    ),
    blacklistExcludeServersDescription: _(
      "Servers that should not be added to the URLTest group.",
    ),
    blacklistExcludeRegexDescription: _(
      "Exclude servers from the URLTest group using a regular expression.",
    ),
    whitelistExcludeServersDescription: _(
      "Optional. Remove specific servers from the selection above.",
    ),
    whitelistExcludeRegexDescription: _(
      "Optional. Exclude servers from the selection above using a regular expression.",
    ),
  });
}

function fallbackLevelSettingsForValidation(groupId, levelId, option) {
  const store = childPendingSettingsStore(option, groupId);

  if (isExistingChildItem(groupId, levelId, "fallback_level", "group")) {
    return readChildSettings(
      levelId,
      fallbackLevelSettingsKeys(),
      defaultFallbackLevelSettings(),
    );
  }

  return Object.assign({}, store[levelId] || {});
}

function validateFallbackLevelItemsBeforeSave(groupId, values, option) {
  const normalizedValues = normalizeDynamicListItems(values);
  if (!normalizedValues.length) {
    return _("Add at least one Fallback level");
  }

  for (const value of normalizedValues) {
    const levelId = `${value || ""}`;
    const settings = fallbackLevelSettingsForValidation(
      groupId,
      levelId,
      option,
    );

    if (!`${settings.name || ""}`.trim()) {
      return _("Enter a level name");
    }
  }

  return true;
}

function addFallbackLevelItemOptions(itemSection, options = {}) {
  const parentSectionForItem =
    typeof options.parentSectionId === "function"
      ? options.parentSectionId
      : parentSectionIdForItem;

  let o = itemSection.option(
    form.Value,
    "name",
    _("Level name"),
    _("Name shown in the fallback level list"),
  );
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return `${value || ""}`.trim() ? true : _("Enter a level name");
  };

  addServerFilterOptions(itemSection, parentSectionForItem, {
    modeLabel: _("Level server filter"),
    modeDescription: _(
      "Determines where traffic will be sent at this priority level if servers from higher levels stop responding",
    ),
    modes: [
      { value: "all", label: _("All remaining servers") },
      { value: "exclude", label: _("Blacklist") },
      { value: "include", label: _("Whitelist") },
      { value: "direct", label: _("Direct") },
    ],
    defaultMode: "include",
    includeServersDescription: _(
      "Only the selected servers will be added to this priority level.",
    ),
    includeRegexDescription: _(
      "Add servers whose names match the regular expression.",
    ),
    blacklistExcludeServersDescription: _(
      "Servers that should not be added to this priority level.",
    ),
    blacklistExcludeRegexDescription: _(
      "Exclude servers from this level using a regular expression.",
    ),
    whitelistExcludeServersDescription: _(
      "Optional. Remove specific servers from the selection above.",
    ),
    whitelistExcludeRegexDescription: _(
      "Optional. Exclude servers from the selection above using a regular expression.",
    ),
  });
}

function addFallbackGroupItemOptions(itemSection, options = {}) {
  const parentSectionForGroup =
    typeof options.parentSectionId === "function"
      ? options.parentSectionId
      : parentSectionIdForItem;
  const ownerId =
    typeof options.ownerId === "function" ? options.ownerId : () => "";

  let o = itemSection.option(
    form.Value,
    "name",
    _("Display name"),
    _("Name displayed on the dashboard"),
  );
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return `${value || ""}`.trim()
      ? (options.validateName?.(value) ?? true)
      : _("Enter a display name");
  };

  o = itemSection.option(
    form.Value,
    "health_check_url",
    _("Check URL"),
    _("URL used to check whether each server is available"),
  );
  o.default = "https://www.gstatic.com/generate_204";
  o.rmempty = false;
  urlTestUrlChoices().forEach((value) => o.value(value));
  o.validate = function (_itemId, value) {
    return validateUrlTestUrl(value);
  };

  o = itemSection.option(
    form.Value,
    "health_check_interval",
    _("Check interval"),
    _("How often to check availability of the selected server"),
  );
  o.default = "5m";
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateRequiredSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Value,
    "health_check_timeout",
    _("Availability timeout"),
    _(
      "Maximum time allowed for one server health check",
    ),
  );
  o.default = "5s";
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateRequiredSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Value,
    "max_failed_times",
    _("Maximum failed attempts"),
    _(
      "Number of connection failures after which an immediate health check starts.",
    ),
  );
  o.default = "5";
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateFallbackMaxFailedTimes(value);
  };

  o = itemSection.option(
    form.Value,
    "expected_status",
    _("Expected status"),
    _(
      "HTTP status codes that count as a successful health check. Use * for any response, or values and ranges such as 204/200-299.",
    ),
  );
  o.default = "*";
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateFallbackExpectedStatus(value);
  };

  o = itemSection.option(
    form.Value,
    "idle_timeout",
    _("Idle timeout"),
    _("Stop health checks when the group is not used"),
  );
  o.default = "5m";
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateRequiredSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Flag,
    "interrupt_exist_connections",
    _("Interrupt connections"),
    _("Interrupt existing connections when Fallback switches servers"),
  );
  o.default = "1";
  o.rmempty = false;

  o = itemSection.option(
    form.Flag,
    "hide_dashboard_members",
    _("Hide group servers"),
    _("Hide servers included in this group from the dashboard."),
  );
  o.default = "0";
  o.rmempty = false;

  o = itemSection.option(
    ButtonAddSettingsDynamicList,
    "fallback_level",
    _("Fallback levels"),
    _("Required. Levels are tried from top to bottom until one succeeds"),
  );
  o.rmempty = false;
  o.modalonly = true;
  o.addButtonLabel = _("+ Add servers");
  o.childType = "fallback_level";
  o.ownerOption = "group";
  o.childOwnerId = ownerId;
  o.parentSectionId = parentSectionForGroup;
  o.childValueOption = "name";
  o.childDefaults = defaultFallbackLevelSettings();
  o.renderItemSettingsModal = showFallbackLevelSettingsModal;
  o.validateItemsOnSave = function (groupId, values) {
    return validateFallbackLevelItemsBeforeSave(groupId, values, this);
  };
  o.validate = function (groupId, value) {
    if (!`${value || ""}`.trim()) {
      const current =
        typeof this.formvalue === "function" ? this.formvalue(groupId) : [];
      return normalizeDynamicListItems(current).length
        ? true
        : _("Add at least one Fallback level");
    }
    return true;
  };
  o.hasItemSettings = function (groupId, value) {
    const normalized = `${value || ""}`.trim();

    if (isExistingChildItem(groupId, normalized, "fallback_level", "group")) {
      return true;
    }

    return normalized.length > 0;
  };
  o.inputValueForItem = function (groupId, value) {
    const inputValue = childItemInputValue(
      groupId,
      value,
      "fallback_level",
      "name",
      "group",
    );
    const store = childPendingSettingsStore(this, groupId);
    return store[inputValue] && store[inputValue].name
      ? store[inputValue].name
      : inputValue;
  };
  o.stagedChildSettings = function (groupId, value) {
    const id = childItemInputValue(
      groupId,
      value,
      "fallback_level",
      "name",
      "group",
    );
    const store = childPendingSettingsStore(this, groupId);
    return store[id] ? Object.assign({}, store[id]) : null;
  };
  o.clearStagedChildSettings = function (groupId) {
    if (this.pendingChildSettings) {
      delete this.pendingChildSettings[groupId];
    }
  };
  o.afterMaterializeChildItems = function (_groupId, itemIds) {
    itemIds.forEach((itemId, index) => {
      uci.set(UCI_PACKAGE, itemId, "order", `${index}`);
    });
  };
  o.renderListItemLabel = function (groupId, itemId) {
    return E(
      "span",
      { class: "fkp-dynlist-label" },
      this.inputValueForItem(groupId, itemId),
    );
  };
}

function settingValueEquals(left, right) {
  const normalize = (value) => {
    if (Array.isArray(value)) {
      return JSON.stringify(value.map((item) => `${item || ""}`));
    }

    return value === undefined || value === null ? "" : `${value}`;
  };

  return normalize(left) === normalize(right);
}

function readChildSettings(itemId, keys, defaults) {
  const result = Object.assign({}, defaults || {});

  keys.forEach((key) => {
    const value = uci.get(UCI_PACKAGE, itemId, key);
    if (value !== null && value !== undefined) {
      result[key] = Array.isArray(value) ? value.slice() : value;
    }
  });

  return result;
}

function changedSettings(base, next, keys) {
  const result = {};

  keys.forEach((key) => {
    if (!settingValueEquals(base ? base[key] : null, next ? next[key] : null)) {
      result[key] = next ? next[key] : null;
    }
  });

  return result;
}

function hasChangedSettings(settings) {
  return Object.keys(settings || {}).length > 0;
}

function childPendingSettingsStore(option, section_id) {
  if (option.sharedPendingSettingsKey) {
    const key = `${option.sharedPendingSettingsKey}:${section_id}`;
    if (!sharedChildPendingSettings.has(key)) {
      sharedChildPendingSettings.set(key, {});
    }
    return sharedChildPendingSettings.get(key);
  }

  if (!option.pendingChildSettings) {
    option.pendingChildSettings = {};
  }

  if (!option.pendingChildSettings[section_id]) {
    option.pendingChildSettings[section_id] = {};
  }

  return option.pendingChildSettings[section_id];
}

function pendingChildSettings(option, section_id, value, defaults) {
  value = `${value || ""}`.trim();
  const store = childPendingSettingsStore(option, section_id);

  if (!store[value]) {
    store[value] = Object.assign({}, defaults || {});
  }

  return store[value];
}

function clearChildPendingSettings(option, section_id) {
  if (option.sharedPendingSettingsKey) {
    sharedChildPendingSettings.delete(
      `${option.sharedPendingSettingsKey}:${section_id}`,
    );
    return;
  }

  if (option.pendingChildSettings) {
    delete option.pendingChildSettings[section_id];
  }
}

function renderStackedJsonSettingsModal(title, map, onSave) {
  const modal = document.querySelector("#modal_overlay > .modal.cbi-modal");
  const activeMap = modal ? modal.querySelector(".cbi-map:not(.hidden)") : null;
  const buttonRow = modal ? modal.querySelector("div.button-row") : null;
  const heading = modal ? modal.querySelector("h4") : null;

  if (!modal || !activeMap || !buttonRow || !heading) {
    return Promise.resolve();
  }

  return map.render().then((nodes) => {
    const titleNode = E("span", title ? ` » ${title}` : "");
    const originalButtonClass = buttonRow.getAttribute("class") || "";
    const originalButtonNodes = Array.from(buttonRow.childNodes);
    let closed = false;
    let saveButton;

    const restoreButtonRow = () => {
      buttonRow.textContent = "";
      originalButtonNodes.forEach((node) => buttonRow.appendChild(node));
      buttonRow.setAttribute("class", originalButtonClass);
    };

    const close = () => {
      if (closed) {
        return;
      }

      closed = true;

      if (nodes.parentNode) {
        nodes.parentNode.removeChild(nodes);
      }
      if (titleNode.parentNode) {
        titleNode.parentNode.removeChild(titleNode);
      }

      activeMap.classList.remove("hidden");
      restoreButtonRow();
    };

    const save = () => {
      if (saveButton) {
        saveButton.disabled = true;
      }

      return map
        .parse()
        .then(() =>
          Promise.resolve(
            onSave(cleanFormSectionData(map.data.get(map.config, "settings"))),
          ),
        )
        .then(close)
        .catch(() => {
          if (saveButton) {
            saveButton.disabled = false;
          }
        });
    };

    buttonRow.textContent = "";
    buttonRow.append(
      E(
        "button",
        {
          class: "btn cbi-button",
          click: close,
        },
        _("Close"),
      ),
      " ",
      (saveButton = E(
        "button",
        {
          class: "btn cbi-button cbi-button-positive important",
          click: save,
        },
        _("Save"),
      )),
    );

    heading.appendChild(titleNode);
    activeMap.classList.add("hidden");
    activeMap.parentNode.insertBefore(nodes, activeMap.nextElementSibling);
  });
}

function showChildItemSettingsModal(section_id, itemValue, option, settings) {
  const value = `${itemValue || ""}`.trim();
  const existing = isExistingChildItem(
    section_id,
    value,
    settings.typeName,
    settings.ownerOption,
  );
  const inputValue = childItemInputValue(
    section_id,
    value,
    settings.typeName,
    settings.valueOption,
    settings.ownerOption,
  );
  const defaults =
    typeof settings.defaults === "function"
      ? settings.defaults(inputValue, existing)
      : Object.assign({}, settings.defaults || {});
  const initialSettings = existing
    ? readChildSettings(value, settings.keys, defaults)
    : Object.assign(
        {},
        pendingChildSettings(option, section_id, inputValue, defaults),
      );
  const data = {
    settings: Object.assign({}, initialSettings),
  };
  const map = new form.JSONMap(data);
  const itemSection = map.section(form.NamedSection, "settings");
  itemSection.anonymous = true;
  itemSection.addremove = false;
  settings.addOptions(itemSection, {
    parentSectionId: () => section_id,
    ownerId: () => value || section_id,
    validateName: settings.validateName,
  });

  return renderStackedJsonSettingsModal(
    settings.title(inputValue),
    map,
    (nextSettings) => {
      if (existing) {
        const diff = changedSettings(
          initialSettings,
          nextSettings,
          settings.keys,
        );
        if (hasChangedSettings(diff)) {
          applyChildItemSettings(value, diff);
        }
        if (typeof settings.afterSave === "function") {
          settings.afterSave(value, inputValue, nextSettings, existing);
        }
        return;
      }

      const nextInputValue =
        `${nextSettings[settings.valueOption] || inputValue || ""}`.trim();
      const store = childPendingSettingsStore(option, section_id);
      if (nextInputValue !== inputValue) {
        delete store[inputValue];
      }
      store[nextInputValue] = nextSettings;
      if (typeof settings.afterSave === "function") {
        settings.afterSave(value, nextInputValue, nextSettings, existing);
      }
    },
  );
}

function ruleSetIncludesSubnets(section_id, value) {
  const settings = readItemSettingsMap(section_id, RULE_SET_ITEM_SETTINGS_KEY);
  const itemSettings = settings && settings[value];

  if (
    itemSettings &&
    typeof itemSettings === "object" &&
    itemSettings.include_subnets != null
  ) {
    return itemSettingsFlag(itemSettings, "include_subnets", false);
  }

  return getConfigListValues(section_id, "rule_set_with_subnets").includes(
    value,
  );
}

function showSubscriptionUrlSettingsModal(_section_id, itemValue, option) {
  return loadDefaultSubscriptionHeaders().then((headers) =>
    showChildItemSettingsModal(_section_id, itemValue, option, {
      typeName: "subscription_url",
      valueOption: "url",
      keys: subscriptionUrlSettingsKeys(),
      defaults: (_inputValue, existing) =>
        defaultSubscriptionUrlSettings(existing ? [] : headers),
      addOptions: addSubscriptionUrlItemOptions,
      title: () => _("Subscription URL settings"),
    }),
  );
}

function showInterfaceSettingsModal(_section_id, itemValue, option) {
  option.sharedPendingSettingsKey = "interfaces";
  return showChildItemSettingsModal(_section_id, itemValue, option, {
    typeName: "section_interface",
    valueOption: "name",
    keys: interfaceSettingsKeys(),
    defaults: (inputValue) => defaultInterfaceSettings(inputValue),
    addOptions: addInterfaceItemOptions,
    title: () => _("Network interface settings"),
    afterSave: () => refreshDashboardFilterChoiceWidgets(_section_id),
  });
}

function showUrlTestSettingsModal(
  _section_id,
  itemValue,
  option,
  widget,
  itemNode,
  context = {},
) {
  const defaultName = context.adding
    ? nextDynamicListName(
        option,
        _section_id,
        getChildItemIds(_section_id, "urltest"),
        "URLTest",
      )
    : "";
  return showChildItemSettingsModal(_section_id, itemValue, option, {
    typeName: "urltest",
    valueOption: "name",
    keys: urlTestSettingsKeys(),
    defaults: () => defaultUrlTestSettings(defaultName),
    addOptions: addUrlTestItemOptions,
    validateName: validateUniqueDynamicListItemName.bind(
      null,
      widget,
      itemNode,
    ),
    title: (name) => {
      const normalized = `${name || ""}`.trim();
      return !normalized || /^urltest-[a-z0-9]+-\d+$/.test(normalized)
        ? _("URLTest settings")
        : `${_("URLTest settings")}: ${normalized}`;
    },
    afterSave: (itemId, inputValue, settings, existing) => {
      const displayName = `${settings.name || inputValue || ""}`.trim();

      if (existing) {
        uci.unset(UCI_PACKAGE, itemId, "id");
        uci.unset(UCI_PACKAGE, itemId, "display_name");
        updateDynamicListItemLabel(itemNode, displayName);
        return;
      }

      if (context.adding) {
        addDynamicListItem(widget, displayName, displayName);
      } else {
        updateDynamicListItemLabel(itemNode, displayName);
      }
    },
  });
}

function showFallbackLevelSettingsModal(
  groupId,
  itemValue,
  option,
  widget,
  itemNode,
  context = {},
) {
  const defaults = defaultFallbackLevelSettings();
  if (context.adding) {
    defaults.name = nextDynamicListName(
      option,
      "settings",
      getChildItemIds(groupId, "fallback_level", "group"),
      "Group",
    );
  }

  return showChildItemSettingsModal(groupId, itemValue, option, {
    typeName: "fallback_level",
    ownerOption: "group",
    valueOption: "name",
    keys: fallbackLevelSettingsKeys(),
    defaults,
    addOptions: (itemSection) =>
      addFallbackLevelItemOptions(itemSection, {
        parentSectionId: () => context.parentSectionId || "",
      }),
    title: (name) => {
      const normalized = `${name || ""}`.trim();
      return normalized
        ? `${_("Fallback level settings")}: ${normalized}`
        : _("Fallback level settings");
    },
    afterSave: (itemId, inputValue, settings, existing) => {
      const displayName = `${settings.name || inputValue || ""}`.trim();

      if (existing) {
        updateDynamicListItemLabel(itemNode, displayName);
        return;
      }

      if (context.adding) {
        addDynamicListItem(widget, displayName, displayName);
      } else {
        updateDynamicListItemLabel(itemNode, displayName);
      }
    },
  });
}

function createFallbackGroupItem(section_id, groupId, settings) {
  const created = uci.add(UCI_PACKAGE, "fallback_group", groupId) || groupId;

  uci.set(UCI_PACKAGE, created, "section", section_id);
  Object.entries(fallbackGroupChildDefaults()).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      uci.set(UCI_PACKAGE, created, key, `${value}`);
    }
  });
  applyChildItemSettings(created, settings);

  return created;
}

function showFallbackGroupSettingsModal(
  section_id,
  itemValue,
  option,
  widget,
  itemNode,
  context = {},
) {
  const groupId = context.adding
    ? randomFallbackGroupId()
    : `${itemValue || ""}`.trim();

  if (!groupId) {
    return null;
  }

  const defaultName = context.adding
    ? nextDynamicListName(
        option,
        section_id,
        getChildItemIds(section_id, "fallback_group"),
        "Fallback",
      )
    : "";

  return showChildItemSettingsModal(section_id, groupId, option, {
    typeName: "fallback_group",
    valueOption: "name",
    keys: fallbackGroupSettingsKeys(),
    defaults: defaultFallbackGroupSettings(defaultName),
    addOptions: addFallbackGroupItemOptions,
    validateName: validateUniqueDynamicListItemName.bind(
      null,
      widget,
      itemNode,
    ),
    title: (name) => {
      if (context.adding) {
        return _("Fallback settings");
      }

      const normalized = `${name || ""}`.trim();
      return normalized
        ? `${_("Fallback settings")}: ${normalized}`
        : _("Fallback settings");
    },
    afterSave: (itemId, inputValue, settings, existing) => {
      const displayName = `${settings.name || inputValue || ""}`.trim();

      if (!existing) {
        const created = createFallbackGroupItem(section_id, groupId, settings);
        const store = childPendingSettingsStore(option, section_id);
        delete store[groupId];
        delete store[inputValue];
        delete store[displayName];
        addDynamicListItem(widget, created, displayName);
        return;
      }

      updateDynamicListItemLabel(itemNode, displayName);
    },
  });
}

function validateUrlTestItemsBeforeSave(section_id, values, option) {
  const store = childPendingSettingsStore(option, section_id);

  for (const value of normalizeDynamicListItems(values)) {
    const itemId = `${value || ""}`;
    let name = "";

    if (isExistingChildItem(section_id, itemId, "urltest")) {
      name =
        uci.get(UCI_PACKAGE, itemId, "name") ||
        uci.get(UCI_PACKAGE, itemId, "display_name") ||
        "";
    } else if (store[itemId]) {
      name = store[itemId].name || "";
    }

    if (!`${name || ""}`.trim()) {
      return _("Enter a display name");
    }
  }

  return true;
}

function validateFallbackGroupItemsBeforeSave(section_id, values) {
  for (const value of normalizeDynamicListItems(values)) {
    const groupId = `${value || ""}`.trim();

    if (!isExistingChildItem(section_id, groupId, "fallback_group")) {
      return _("Open Fallback settings and enter a display name");
    }

    if (!`${uci.get(UCI_PACKAGE, groupId, "name") || ""}`.trim()) {
      return _("Enter a display name");
    }
  }

  return true;
}

function tunnelInitialSettings(value, sectionId) {
  const tunnel = tunnelChild(sectionId, value) || {};
  const endpoint =
    `${tunnel.kind || ""}` === "json"
      ? parseOutboundJsonObject(tunnel.endpoint_json) || {}
      : {};
  const endpointType = `${endpoint.type || ""}`.toLowerCase();
  const kind =
    tunnel.kind === "json"
      ? "json"
      : tunnel.kind === "warp" || endpointType === "warp"
        ? "warp"
        : tunnel.kind === "amneziawg" || endpoint.amnezia
          ? "amneziawg"
          : tunnel.kind === "tailscale" || endpointType === "tailscale"
            ? "tailscale"
            : "wireguard";
  const warpJunkEnabled =
    kind === "warp" &&
    WARP_JUNK_FIELDS.some((key) => tunnel[`amnezia_${key}`] != null);
  const tailscaleDetour = `${tunnel.tailscale_detour_section || ""}`.trim();
  const settings = {
    name: kind === "json" ? `${endpoint.tag || ""}` : `${tunnel.name || ""}`,
    tunnel_type: kind,
    warp_junk_enabled: warpJunkEnabled ? "1" : "0",
    address: normalizeOptionValues(tunnel.address),
    private_key: `${tunnel.private_key || ""}`,
    listen_port: tunnel.listen_port ? `${tunnel.listen_port}` : "",
    mtu: tunnel.mtu ? `${tunnel.mtu}` : "",
    peer_ids: tunnelPeerIds(value),
    warp_keepalive: tunnel.warp_keepalive ? `${tunnel.warp_keepalive}` : "",
    warp_profile_id: `${tunnel.warp_profile_id || ""}`,
    warp_auth_token: `${tunnel.warp_profile_auth_token || ""}`,
    warp_private_key: `${tunnel.warp_profile_private_key || ""}`,
    tailscale_auth_key: `${tunnel.tailscale_auth_key || ""}`,
    tailscale_hostname: `${tunnel.tailscale_hostname || ""}`,
    tailscale_control_url: `${tunnel.tailscale_control_url || "https://controlplane.tailscale.com"}`,
    tailscale_accept_routes: tunnel.tailscale_accept_routes === "0" ? "0" : "1",
    tailscale_exit_node: `${tunnel.tailscale_exit_node || ""}`,
    tailscale_detour_enabled: tailscaleDetour ? "1" : "0",
    tailscale_detour_section: tailscaleDetourSectionValue(
      tailscaleDetour,
      sectionId,
    ),
    endpoint_json: kind === "json" ? `${tunnel.endpoint_json || ""}` : "",
  };

  [
    ...AMNEZIA_INTEGER_FIELDS,
    ...AMNEZIA_RANGE_FIELDS,
    ...AMNEZIA_STRING_FIELDS,
  ].forEach((key) => {
    settings[`amnezia_${key}`] =
      tunnel[`amnezia_${key}`] != null ? `${tunnel[`amnezia_${key}`]}` : "";
  });
  return settings;
}

function tunnelSettingsKeys() {
  return [
    "name",
    "kind",
    "address",
    "private_key",
    "listen_port",
    "mtu",
    "warp_keepalive",
    "warp_profile_id",
    "warp_profile_auth_token",
    "warp_profile_private_key",
    "warp_junk_enabled",
    "tailscale_auth_key",
    "tailscale_hostname",
    "tailscale_control_url",
    "tailscale_accept_routes",
    "tailscale_exit_node",
    "tailscale_detour_section",
    "endpoint_json",
    ...AMNEZIA_INTEGER_FIELDS.map((key) => `amnezia_${key}`),
    ...AMNEZIA_RANGE_FIELDS.map((key) => `amnezia_${key}`),
    ...AMNEZIA_STRING_FIELDS.map((key) => `amnezia_${key}`),
  ];
}

function tunnelStorageSettings(settings) {
  const kind = `${settings.tunnel_type || "wireguard"}`;
  const storedAmneziaFields =
    kind === "amneziawg"
      ? AMNEZIA_FIELDS
      : kind === "warp" && `${settings.warp_junk_enabled || ""}` === "1"
        ? WARP_JUNK_FIELDS
        : [];
  const result = {
    kind,
    name: kind === "json" ? "" : `${settings.name || ""}`.trim(),
    address: normalizeOptionValues(settings.address),
    private_key: `${settings.private_key || ""}`.trim(),
    listen_port: `${settings.listen_port || ""}`.trim(),
    mtu: `${settings.mtu || ""}`.trim(),
    warp_keepalive: `${settings.warp_keepalive || ""}`.trim(),
    warp_profile_id: `${settings.warp_profile_id || ""}`.trim(),
    warp_profile_auth_token: `${settings.warp_auth_token || ""}`.trim(),
    warp_profile_private_key: `${settings.warp_private_key || ""}`.trim(),
    tailscale_auth_key: `${settings.tailscale_auth_key || ""}`.trim(),
    tailscale_hostname: `${settings.tailscale_hostname || ""}`.trim(),
    tailscale_control_url: `${settings.tailscale_control_url || ""}`.trim(),
    tailscale_accept_routes: `${settings.tailscale_accept_routes || "1"}`,
    tailscale_exit_node: `${settings.tailscale_exit_node || ""}`.trim(),
    tailscale_detour_section:
      `${settings.tailscale_detour_enabled || ""}` === "1"
        ? `${settings.tailscale_detour_section || ""}`.trim()
        : "",
    endpoint_json:
      kind === "json" ? `${settings.endpoint_json || ""}`.trim() : "",
  };

  [
    ...AMNEZIA_INTEGER_FIELDS,
    ...AMNEZIA_RANGE_FIELDS,
    ...AMNEZIA_STRING_FIELDS,
  ].forEach((key) => {
    result[`amnezia_${key}`] = storedAmneziaFields.includes(key)
      ? `${settings[`amnezia_${key}`] || ""}`.trim()
      : "";
  });
  return result;
}

function randomTunnelId() {
  for (let i = 0; i < 100; i += 1) {
    const id = `tun_${Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, "0")}`;
    if (!uci.get(UCI_PACKAGE, id)) {
      return id;
    }
  }

  return `tun_${Date.now().toString(16)}`;
}

function createTunnelItem(sectionId, tunnelId, settings) {
  const itemId = isExistingChildItem(sectionId, tunnelId, "tunnel", "section")
    ? tunnelId
    : uci.add(UCI_PACKAGE, "tunnel", tunnelId) || tunnelId;
  uci.set(UCI_PACKAGE, itemId, "section", sectionId);
  tunnelSettingsKeys().forEach((key) => uci.unset(UCI_PACKAGE, itemId, key));
  applyChildItemSettings(itemId, settings);
  return itemId;
}

function materializeTunnelPeers(tunnelId, values, option) {
  const store = childPendingSettingsStore(option, tunnelId);
  const itemIds = materializeChildItems(
    tunnelId,
    {
      typeName: "tunnel_peer",
      ownerOption: "tunnel",
      createId: (value) => `${value || ""}`.trim(),
      stagedSettings: (value) => store[`${value || ""}`] || null,
    },
    values,
  );
  itemIds.forEach((itemId, index) => {
    uci.set(UCI_PACKAGE, itemId, "order", `${index}`);
  });
  cleanupRemovedChildItems(tunnelId, "tunnel_peer", itemIds, "tunnel");
  delete option.pendingChildSettings[tunnelId];
  return itemIds;
}

function setModalOptionValue(map, option, value) {
  map.data.set(map.config, "settings", option.option, value);
  const element =
    typeof option.getUIElement === "function"
      ? option.getUIElement("settings")
      : null;
  if (element && typeof element.setValue === "function") {
    element.setValue(value);
    element.triggerValidation();
  }
}

function tunnelPeerFromChild(peerId) {
  const peer = (uci.sections(UCI_PACKAGE, "tunnel_peer") || []).find(
    (item) => item[".name"] === `${peerId || ""}`,
  );
  if (!peer) {
    return null;
  }

  const result = {
    address: `${peer.address || ""}`.trim(),
    port: Number(peer.port),
    public_key: `${peer.public_key || ""}`.trim(),
    allowed_ips: normalizeOptionValues(peer.allowed_ips),
  };
  if (`${peer.pre_shared_key || ""}`.trim()) {
    result.pre_shared_key = `${peer.pre_shared_key}`.trim();
  }
  if (`${peer.persistent_keepalive_interval || ""}`.trim()) {
    const value = `${peer.persistent_keepalive_interval}`.trim();
    result.persistent_keepalive_interval = value.includes("-")
      ? value
      : Number(value);
  }
  return result;
}

function tunnelPeerForValue(tunnelId, value, option) {
  const saved = tunnelPeerFromChild(value);
  if (saved) {
    return saved;
  }

  const staged = option?.pendingChildSettings?.[tunnelId]?.[value];
  return staged ? wireGuardPeerFromSettings(staged) : null;
}

function tunnelEndpointFromSettings(settings, tunnelId, peerOption) {
  const kind = `${settings.tunnel_type || ""}`;
  if (kind === "json") {
    return parseOutboundJsonObject(settings.endpoint_json);
  }
  if (kind === "tailscale") {
    const endpoint = {
      type: "tailscale",
      auth_key: `${settings.tailscale_auth_key || ""}`.trim(),
      hostname: `${settings.tailscale_hostname || ""}`.trim(),
      control_url:
        `${settings.tailscale_control_url || "https://controlplane.tailscale.com"}`.trim(),
      accept_routes: `${settings.tailscale_accept_routes || ""}` === "1",
      exit_node: `${settings.tailscale_exit_node || ""}`.trim(),
      exit_node_allow_lan_access: true,
    };
    if (`${settings.tailscale_detour_enabled || ""}` === "1") {
      const detour = tailscaleDetourTag(settings.tailscale_detour_section);
      if (detour) {
        endpoint.detour = detour;
      }
    }
    return endpoint;
  }
  if (kind === "warp") {
    const endpoint = { type: "warp" };
    if (`${settings.warp_keepalive || ""}`.trim()) {
      const value = `${settings.warp_keepalive}`.trim();
      endpoint.persistent_keepalive_interval = value.includes("-")
        ? value
        : Number(value);
    }
    const profile = {};
    if (`${settings.warp_profile_id || ""}`.trim()) {
      profile.id = `${settings.warp_profile_id}`.trim();
    }
    if (`${settings.warp_auth_token || ""}`.trim()) {
      profile.auth_token = `${settings.warp_auth_token}`.trim();
    }
    if (`${settings.warp_private_key || ""}`.trim()) {
      profile.private_key = `${settings.warp_private_key}`.trim();
    }
    if (Object.keys(profile).length > 0) {
      // A user-supplied profile must win over sing-box's cached WARP config.
      // The core uses this native flag to recreate the endpoint from the
      // current credentials instead of silently reusing stale cache data.
      profile.recreate = true;
      endpoint.profile = profile;
    }
    if (`${settings.warp_junk_enabled || ""}` === "1") {
      const amnezia = tunnelAmneziaSettings(settings, WARP_JUNK_FIELDS);
      if (Object.keys(amnezia).length > 0) {
        endpoint.amnezia = amnezia;
      }
    }
    return endpoint;
  }

  const peers = L.toArray(settings.peer_ids)
    .map((value) => tunnelPeerForValue(tunnelId, value, peerOption))
    .filter(Boolean);
  if (peers.length !== L.toArray(settings.peer_ids).filter(Boolean).length)
    return null;

  const endpoint = {
    type: "wireguard",
    address: normalizeOptionValues(settings.address),
    private_key: `${settings.private_key || ""}`.trim(),
    peers,
  };
  if (`${settings.listen_port || ""}`.trim()) {
    endpoint.listen_port = Number(settings.listen_port);
  }
  if (`${settings.mtu || ""}`.trim()) {
    endpoint.mtu = Number(settings.mtu);
  }

  if (kind === "amneziawg") {
    endpoint.amnezia = tunnelAmneziaSettings(settings);
  }

  return endpoint;
}

function tunnelAmneziaSettings(settings, fields = AMNEZIA_FIELDS) {
  const amnezia = {};
  fields.forEach((key) => {
    const value = `${settings[`amnezia_${key}`] || ""}`.trim();
    if (!value) return;
    amnezia[key] = AMNEZIA_STRING_FIELDS.includes(key)
      ? value
      : AMNEZIA_RANGE_FIELDS.includes(key) && value.includes("-")
        ? value
        : Number(value);
  });
  return amnezia;
}

function wireGuardPeerFromSettings(settings) {
  const peer = {
    address: `${settings.address || ""}`.trim(),
    port: Number(settings.port),
    public_key: `${settings.public_key || ""}`.trim(),
    allowed_ips: normalizeOptionValues(settings.allowed_ips),
  };
  if (`${settings.pre_shared_key || ""}`.trim()) {
    peer.pre_shared_key = `${settings.pre_shared_key}`.trim();
  }
  if (`${settings.persistent_keepalive_interval || ""}`.trim()) {
    const value = `${settings.persistent_keepalive_interval}`.trim();
    peer.persistent_keepalive_interval = value.includes("-")
      ? value
      : Number(value);
  }
  return peer;
}

function wireGuardPeerListItemLabel(tunnelId, value, option) {
  const peer = tunnelPeerForValue(tunnelId, value, option);
  return E(
    "span",
    { class: "fkp-dynlist-label" },
    wireGuardPeerDisplayNameFromObject(peer),
  );
}

function validateWireGuardPeer(peer) {
  if (
    !peer ||
    typeof peer !== "object" ||
    Array.isArray(peer) ||
    typeof peer.address !== "string" ||
    !peer.address.trim() ||
    typeof peer.public_key !== "string" ||
    !peer.public_key.trim() ||
    typeof peer.port !== "number" ||
    !Number.isInteger(peer.port) ||
    peer.port < 1 ||
    peer.port > 65535
  ) {
    return _(
      "Every WireGuard peer needs string address/public key and a numeric port",
    );
  }

  if (!main.validateWireGuardKey(peer.public_key)) {
    return _("WireGuard keys must be standard base64-encoded 32-byte values");
  }

  if (Object.keys(peer).some((key) => !WIREGUARD_PEER_FIELDS.has(key))) {
    return _("WireGuard peer contains unsupported fields");
  }

  if (
    peer.pre_shared_key != null &&
    (typeof peer.pre_shared_key !== "string" || !peer.pre_shared_key.trim())
  ) {
    return _("WireGuard peer fields must use native sing-box JSON types");
  }

  if (
    typeof peer.pre_shared_key === "string" &&
    peer.pre_shared_key.trim() &&
    !main.validateWireGuardKey(peer.pre_shared_key)
  ) {
    return _("WireGuard keys must be standard base64-encoded 32-byte values");
  }

  const allowedIps = Array.isArray(peer.allowed_ips)
    ? peer.allowed_ips
    : peer.allowed_ips != null
      ? [peer.allowed_ips]
      : [];
  if (allowedIps.length === 0) {
    return _("Every WireGuard peer needs at least one AllowedIPs subnet");
  }
  if (
    allowedIps.some((allowedIp) => validateWireGuardPrefix(allowedIp) !== true)
  ) {
    return _("WireGuard peer allowed_ips must contain valid CIDR subnets");
  }

  if (
    peer.persistent_keepalive_interval != null &&
    (typeof peer.persistent_keepalive_interval === "string"
      ? validateAmneziaRange(peer.persistent_keepalive_interval) !== true
      : typeof peer.persistent_keepalive_interval !== "number" ||
        !Number.isInteger(peer.persistent_keepalive_interval) ||
        peer.persistent_keepalive_interval < 0 ||
        peer.persistent_keepalive_interval > 0xffffffff)
  ) {
    return _("WireGuard peer fields must use native sing-box JSON types");
  }
  return true;
}

function validateWireGuardPeerValue(value, tunnelId, option) {
  const peer = tunnelPeerForValue(tunnelId, value, option);
  return peer
    ? validateWireGuardPeer(peer)
    : _("Open peer settings and complete the configuration");
}

function validateWireGuardPeers(values, tunnelId, option) {
  const peers = L.toArray(values).filter((value) => `${value || ""}`.trim());
  if (peers.length === 0) {
    return _("Add at least one WireGuard peer");
  }
  for (const value of peers) {
    const validation = validateWireGuardPeerValue(value, tunnelId, option);
    if (validation !== true) return validation;
  }
  return true;
}

function validateWireGuardPrefix(value) {
  if (typeof value !== "string") {
    return _("Use an IP address with a CIDR prefix");
  }
  const address = `${value || ""}`.trim();
  if (!address.includes("/")) {
    return _("Use an IP address with a CIDR prefix");
  }
  const validation = main.validateSubnet(address);
  return validation.valid ? true : validation.message;
}

function validateWireGuardListInput(value) {
  if (Array.isArray(value)) {
    const values = normalizeOptionValues(value);
    return values.every((item) => validateWireGuardPrefix(item) === true)
      ? true
      : validateWireGuardPrefix(
          values.find((item) => validateWireGuardPrefix(item) !== true) || "",
        );
  }
  return `${value || ""}`.trim() ? validateWireGuardPrefix(value) : true;
}

function validateAmneziaRange(value) {
  const normalized = `${value || ""}`.trim();
  if (!normalized) return true;
  const parts = normalized.split("-");
  if (parts.length > 2 || parts.some((part) => !/^\d+$/u.test(part))) {
    return _(
      "AmneziaWG ranges must be between 0 and 4294967295 with the start no greater than the end",
    );
  }
  const from = Number(parts[0]);
  const to = parts.length === 2 ? Number(parts[1]) : from;
  return Number.isSafeInteger(from) &&
    Number.isSafeInteger(to) &&
    from <= 0xffffffff &&
    to <= 0xffffffff &&
    from <= to
    ? true
    : _(
        "AmneziaWG ranges must be between 0 and 4294967295 with the start no greater than the end",
      );
}

function amneziaFieldLabel(key) {
  switch (key) {
    case "header_protection_key":
      return _("Header protection key");
    case "content_padding_addition":
      return _("Additional packet padding");
    case "rekey_after_time":
      return _("Rekey interval");
    case "rekey_timeout":
      return _("Rekey timeout");
    case "reject_after_time":
      return _("Data rejection timeout");
    case "keepalive_timeout":
      return _("Keepalive timeout");
    case "max_handshake_attempts":
      return _("Maximum handshake attempts");
    default:
      return key.toUpperCase();
  }
}

function validateTunnelSettings(settings, tunnelId, peerOption) {
  const kind = `${settings.tunnel_type || ""}`;
  const name = `${settings.name || ""}`.trim();
  if (kind !== "json" && !name) {
    return _("Enter a tunnel name");
  }
  const endpoint = tunnelEndpointFromSettings(settings, tunnelId, peerOption);
  if (!endpoint) {
    return kind === "json"
      ? _("Enter a valid JSON endpoint object")
      : _("Open peer settings and complete the configuration");
  }
  if (kind === "json") {
    if (typeof endpoint.type !== "string" || !endpoint.type.trim()) {
      return _("JSON endpoint must contain a non-empty type");
    }
    if (
      endpoint.type !== endpoint.type.trim() ||
      !JSON_ENDPOINT_TYPES.has(endpoint.type.trim())
    ) {
      return _("Unsupported JSON endpoint type");
    }
    if (typeof endpoint.tag !== "string" || !endpoint.tag.trim()) {
      return _("JSON endpoint must contain a non-empty tag");
    }
    return true;
  }
  if (endpoint.type === "tailscale") {
    if (!endpoint.auth_key) return _("Enter a Tailscale auth key");
    if (!endpoint.hostname) return _("Enter a Tailscale hostname");
    if (!endpoint.exit_node) return _("Enter a Tailscale exit node");
    if (!main.validateUrl(endpoint.control_url || "").valid) {
      return _("Enter a valid Tailscale control URL");
    }
    if (
      `${settings.tailscale_detour_enabled || ""}` === "1" &&
      !endpoint.detour
    ) {
      return _("Select a section");
    }
    return true;
  }
  if (
    `${settings.tunnel_type || ""}` === "amneziawg" ||
    (`${settings.tunnel_type || ""}` === "warp" &&
      `${settings.warp_junk_enabled || ""}` === "1")
  ) {
    const rangeFields =
      kind === "warp"
        ? AMNEZIA_RANGE_FIELDS.filter((key) => WARP_JUNK_FIELDS.includes(key))
        : AMNEZIA_RANGE_FIELDS;
    for (const key of rangeFields) {
      const rangeValidation = validateAmneziaRange(settings[`amnezia_${key}`]);
      if (rangeValidation !== true) {
        return rangeValidation;
      }
    }
    const headerProtectionKey =
      `${settings.amnezia_header_protection_key || ""}`.trim();
    if (
      kind === "amneziawg" &&
      headerProtectionKey &&
      !main.validateWireGuardKey(headerProtectionKey)
    ) {
      return _("WireGuard keys must be standard base64-encoded 32-byte values");
    }
  }
  if (endpoint.type === "warp") {
    const profileValues = [
      endpoint.profile?.id,
      endpoint.profile?.auth_token,
      endpoint.profile?.private_key,
    ].filter(Boolean);
    if (profileValues.length !== 3) {
      return _(
        "Register a Cloudflare WARP device and fill the profile fields.",
      );
    }
    return true;
  }
  if (!endpoint.private_key || endpoint.address.length === 0) {
    return _("WireGuard address and private key are required");
  }
  if (!main.validateWireGuardKey(endpoint.private_key)) {
    return _("WireGuard keys must be standard base64-encoded 32-byte values");
  }
  for (const address of endpoint.address) {
    const addressValidation = validateWireGuardPrefix(address);
    if (addressValidation !== true) {
      return addressValidation;
    }
  }
  if (endpoint.peers.length === 0) {
    return _("Add at least one WireGuard peer");
  }
  const peersValidation = validateWireGuardPeers(
    settings.peer_ids,
    tunnelId,
    peerOption,
  );
  if (peersValidation !== true) {
    return peersValidation;
  }
  if (
    `${settings.tunnel_type || ""}` === "amneziawg" &&
    Object.keys(endpoint.amnezia || {}).length === 0
  ) {
    return _("Enter at least one AmneziaWG parameter");
  }
  return true;
}

function applyImportedTunnelEndpoint(map, fields, endpoint) {
  setModalOptionValue(
    map,
    fields.type,
    endpoint.amnezia ? "amneziawg" : "wireguard",
  );
  setModalOptionValue(map, fields.address, endpoint.address || []);
  setModalOptionValue(map, fields.privateKey, endpoint.private_key || "");
  setModalOptionValue(map, fields.listenPort, endpoint.listen_port || "");
  setModalOptionValue(map, fields.mtu, endpoint.mtu || "");
  const peerStore = childPendingSettingsStore(fields.peers, fields.tunnelId);
  const peerIds = (endpoint.peers || []).map((peer) => {
    const id = randomTunnelPeerId();
    peerStore[id] = {
      address: `${peer.address || ""}`.trim(),
      port: peer.port != null ? `${peer.port}` : "",
      public_key: `${peer.public_key || ""}`.trim(),
      pre_shared_key: `${peer.pre_shared_key || ""}`.trim(),
      allowed_ips: normalizeOptionValues(peer.allowed_ips),
      persistent_keepalive_interval:
        peer.persistent_keepalive_interval != null
          ? `${peer.persistent_keepalive_interval}`
          : "",
    };
    return id;
  });
  setModalOptionValue(map, fields.peers, peerIds);
  [
    ...AMNEZIA_INTEGER_FIELDS,
    ...AMNEZIA_RANGE_FIELDS,
    ...AMNEZIA_STRING_FIELDS,
  ].forEach((key) => {
    setModalOptionValue(
      map,
      fields.amnezia[key],
      endpoint.amnezia && endpoint.amnezia[key] != null
        ? `${endpoint.amnezia[key]}`
        : "",
    );
  });
  map.checkDepends();
}

function wireGuardPeerSettingsKeys() {
  return [
    "address",
    "port",
    "public_key",
    "pre_shared_key",
    "allowed_ips",
    "persistent_keepalive_interval",
  ];
}

function defaultWireGuardPeerSettings() {
  return {
    address: "",
    port: "",
    public_key: "",
    pre_shared_key: "",
    allowed_ips: [],
    persistent_keepalive_interval: "",
  };
}

function wireGuardPeerDisplayNameFromObject(peer) {
  if (!peer) {
    return _("WireGuard peer");
  }
  const address = `${peer.address || ""}`.trim();
  const port = Number(peer.port);
  return address && Number.isInteger(port)
    ? `${address}:${port}`
    : address || _("WireGuard peer");
}

function randomTunnelPeerId() {
  return `tp_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

function addWireGuardPeerItemOptions(section) {
  let o = section.option(
    form.Value,
    "address",
    _("Server address"),
    _("WireGuard peer hostname or IP address."),
  );
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return `${value || ""}`.trim() ? true : _("Enter a server address");
  };

  o = section.option(form.Value, "port", _("Server port"));
  o.datatype = "port";
  o.rmempty = false;

  o = section.option(form.Value, "public_key", _("Public key"));
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    const key = `${value || ""}`.trim();
    if (!key) return _("Enter a public key");
    return main.validateWireGuardKey(key)
      ? true
      : _("WireGuard keys must be standard base64-encoded 32-byte values");
  };

  o = section.option(
    form.Value,
    "pre_shared_key",
    _("Pre-shared key"),
    _("Optional additional WireGuard key shared with this peer."),
  );
  o.password = true;
  o.rmempty = true;
  o.validate = function (_itemId, value) {
    const key = `${value || ""}`.trim();
    return !key || main.validateWireGuardKey(key)
      ? true
      : _("WireGuard keys must be standard base64-encoded 32-byte values");
  };

  o = section.option(
    form.DynamicList,
    "allowed_ips",
    _("Allowed IPs"),
    _("Traffic prefixes routed through this peer."),
  );
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateWireGuardListInput(value);
  };

  o = section.option(
    form.Value,
    "persistent_keepalive_interval",
    _("Persistent keepalive"),
    _(
      "Time in seconds between packets sent to keep the tunnel open. Leave empty to use the default value.",
    ),
  );
  o.validate = function (_itemId, value) {
    return validateAmneziaRange(value);
  };
  o.rmempty = true;
}

function showWireGuardPeerSettingsModal(
  tunnelId,
  itemValue,
  option,
  widget,
  itemNode,
  context = {},
) {
  const peerId = context.adding ? randomTunnelPeerId() : `${itemValue || ""}`;
  return showChildItemSettingsModal(tunnelId, peerId, option, {
    typeName: "tunnel_peer",
    ownerOption: "tunnel",
    keys: wireGuardPeerSettingsKeys(),
    defaults: defaultWireGuardPeerSettings(),
    addOptions: addWireGuardPeerItemOptions,
    title: () => _("WireGuard peer settings"),
    afterSave: (itemId, _inputValue, settings, existing) => {
      const displayName = wireGuardPeerDisplayNameFromObject(
        wireGuardPeerFromSettings(settings),
      );
      if (!existing && context.adding) {
        addDynamicListItem(widget, itemId, displayName);
        return;
      }
      updateDynamicListItemLabel(itemNode, displayName);
    },
  });
}

function showTunnelImportModal(parentMap, fields) {
  const data = { settings: { configuration: "" } };
  const map = new form.JSONMap(data);
  const itemSection = map.section(form.NamedSection, "settings");
  itemSection.anonymous = true;
  itemSection.addremove = false;

  const configuration = itemSection.option(
    form.TextValue,
    "configuration",
    _("Configuration"),
    _(
      "Paste a WireGuard or AmneziaWG configuration or a link in vpn:// format.",
    ),
  );
  configuration.rows = 12;
  configuration.wrap = "off";
  configuration.textarea = true;
  configuration.rmempty = false;
  let failedInput = "";
  let importError = "";
  configuration.validate = function (_itemId, value) {
    const input = `${value || ""}`.trim();
    if (importError && input === failedInput) {
      return importError;
    }
    importError = "";
    failedInput = "";
    if (!input) {
      return _("Paste a configuration or vpn:// link");
    }
    if (input.startsWith("vpn://")) {
      return true;
    }
    const parsed = main.parseWireGuardConfig(input);
    return parsed && parsed.valid === true
      ? true
      : parsed?.message || _("Invalid WireGuard configuration");
  };
  configureTextareaOption(configuration);

  return renderStackedJsonSettingsModal(
    _("Import configuration"),
    map,
    async (settings) => {
      const parser = main.parseWireGuardInput || main.parseWireGuardConfig;
      const parsed = await Promise.resolve(
        parser(`${settings.configuration || ""}`),
      );
      if (!parsed || parsed.valid !== true) {
        failedInput = `${settings.configuration || ""}`.trim();
        importError = parsed?.message || _("Invalid WireGuard configuration");
        if (typeof configuration.triggerValidation === "function") {
          configuration.triggerValidation("settings");
        }
        throw new TypeError(importError);
      }
      applyImportedTunnelEndpoint(parentMap, fields, parsed.endpoint);
    },
  );
}

function showTunnelSettingsModal(
  section_id,
  itemValue,
  option,
  widget,
  itemNode,
  context = {},
) {
  const tunnelId = context.adding
    ? randomTunnelId()
    : `${itemValue || ""}`.trim();
  if (!tunnelId) {
    return null;
  }

  const data = { settings: tunnelInitialSettings(tunnelId, section_id) };
  if (context.adding) {
    data.settings.name = nextDynamicListName(
      option,
      section_id,
      getChildItemIds(section_id, "tunnel"),
      "Tunnel",
    );
  }
  const map = new form.JSONMap(data);
  const itemSection = map.section(form.NamedSection, "settings");
  itemSection.anonymous = true;
  itemSection.addremove = false;

  const typeOption = itemSection.option(
    form.ListValue,
    "tunnel_type",
    _("Tunnel type"),
  );
  typeOption.value("wireguard", "WireGuard");
  typeOption.value("amneziawg", "AmneziaWG");
  typeOption.value("warp", "Cloudflare WARP");
  typeOption.value("tailscale", "Tailscale");
  typeOption.value("json", "JSON endpoint");
  typeOption.default = "wireguard";
  typeOption.rmempty = false;
  let previousTunnelType = `${data.settings.tunnel_type || "wireguard"}`;

  let o = itemSection.option(
    form.Value,
    "name",
    _("Tunnel name"),
    _("Name displayed on the dashboard"),
  );
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return `${value || ""}`.trim()
      ? validateUniqueDynamicListItemName(widget, itemNode, value)
      : _("Enter a tunnel name");
  };
  ["wireguard", "amneziawg", "warp", "tailscale"].forEach((kind) =>
    o.depends("tunnel_type", kind),
  );

  const importButton = itemSection.option(
    form.Button,
    "_import_config",
    _("Import configuration"),
    _("Import all available tunnel parameters from a client configuration."),
  );
  importButton.inputtitle = _("Import");
  importButton.inputstyle = "apply";
  importButton.depends("tunnel_type", "wireguard");
  importButton.depends("tunnel_type", "amneziawg");

  const warpGenerateButton = itemSection.option(
    form.Button,
    "_generate_warp_profile",
    _("WARP profile"),
    _("Automatically register a device and fill the required fields."),
  );
  warpGenerateButton.inputtitle = _("Generate profile");
  warpGenerateButton.inputstyle = "apply";
  warpGenerateButton.depends("tunnel_type", "warp");

  const tailscaleAuthKeyOption = itemSection.option(
    form.Value,
    "tailscale_auth_key",
    _("Tailscale auth key"),
    _("Auth Key from the Tailscale admin console"),
  );
  tailscaleAuthKeyOption.password = true;
  tailscaleAuthKeyOption.rmempty = false;
  tailscaleAuthKeyOption.depends("tunnel_type", "tailscale");

  const tailscaleHostnameOption = itemSection.option(
    form.Value,
    "tailscale_hostname",
    _("Tailscale hostname"),
    _("Name shown in the Tailscale admin console."),
  );
  tailscaleHostnameOption.rmempty = false;
  tailscaleHostnameOption.depends("tunnel_type", "tailscale");

  const tailscaleControlUrlOption = itemSection.option(
    form.Value,
    "tailscale_control_url",
    _("Tailscale control URL"),
    _(
      "Address of the coordination server. Change it if you use a custom server.",
    ),
  );
  tailscaleControlUrlOption.default = "https://controlplane.tailscale.com";
  tailscaleControlUrlOption.rmempty = false;
  tailscaleControlUrlOption.depends("tunnel_type", "tailscale");
  tailscaleControlUrlOption.validate = function (_itemId, value) {
    const validation = main.validateUrl(`${value || ""}`.trim());
    return validation.valid ? true : validation.message;
  };

  const tailscaleDetourEnabledOption = itemSection.option(
    form.Flag,
    "tailscale_detour_enabled",
    _("Control plane through section"),
    _("Connect to the coordination server through a section"),
  );
  tailscaleDetourEnabledOption.default = "0";
  tailscaleDetourEnabledOption.rmempty = false;
  tailscaleDetourEnabledOption.depends("tunnel_type", "tailscale");

  const tailscaleDetourSectionOption = itemSection.option(
    form.ListValue,
    "tailscale_detour_section",
    _("Control plane through"),
  );
  refreshOutboundDetourSectionOptionValues(
    tailscaleDetourSectionOption,
    section_id,
  );
  tailscaleDetourSectionOption.rmempty = false;
  tailscaleDetourSectionOption.depends({
    tunnel_type: "tailscale",
    tailscale_detour_enabled: "1",
  });
  tailscaleDetourSectionOption.validate = function (_itemId, value) {
    if (!value) {
      return _("Select a section");
    }
    return value === section_id
      ? _("Current section cannot be used as its own transit section")
      : true;
  };

  const tailscaleAcceptRoutesOption = itemSection.option(
    form.Flag,
    "tailscale_accept_routes",
    _("Accept routes"),
    _("Accept subnets advertised by other devices in your Tailscale network."),
  );
  tailscaleAcceptRoutesOption.default = "1";
  tailscaleAcceptRoutesOption.rmempty = false;
  tailscaleAcceptRoutesOption.depends("tunnel_type", "tailscale");

  const tailscaleExitNodeOption = itemSection.option(
    form.Value,
    "tailscale_exit_node",
    _("Exit node"),
    _(
      "IP address or device name in Tailscale through which traffic is forwarded.",
    ),
  );
  tailscaleExitNodeOption.rmempty = false;
  tailscaleExitNodeOption.depends("tunnel_type", "tailscale");

  const endpointJsonOption = itemSection.option(
    form.TextValue,
    "endpoint_json",
    _("JSON endpoint"),
    _("Enter a complete sing-box endpoint object."),
  );
  endpointJsonOption.rows = 12;
  endpointJsonOption.wrap = "soft";
  endpointJsonOption.textarea = true;
  endpointJsonOption.rmempty = false;
  endpointJsonOption.depends("tunnel_type", "json");
  endpointJsonOption.validate = function (_itemId, value) {
    const endpoint = parseOutboundJsonObject(value);
    if (
      !endpoint ||
      typeof endpoint.type !== "string" ||
      !endpoint.type.trim()
    ) {
      return _("JSON endpoint must contain a non-empty type");
    }
    if (
      endpoint.type !== endpoint.type.trim() ||
      !JSON_ENDPOINT_TYPES.has(endpoint.type.trim())
    ) {
      return _("Unsupported JSON endpoint type");
    }
    return typeof endpoint.tag === "string" && endpoint.tag.trim()
      ? true
      : _("JSON endpoint must contain a non-empty tag");
  };
  configureTextareaOption(endpointJsonOption);

  const addressOption = itemSection.option(
    form.DynamicList,
    "address",
    _("Tunnel addresses"),
    _("Interface IPv4 or IPv6 addresses in CIDR format."),
  );
  addressOption.rmempty = false;
  addressOption.depends("tunnel_type", "wireguard");
  addressOption.depends("tunnel_type", "amneziawg");
  addressOption.validate = function (_itemId, value) {
    return validateWireGuardListInput(value);
  };

  const privateKeyOption = itemSection.option(
    form.Value,
    "private_key",
    _("Private key"),
    _("Private key of the local WireGuard interface."),
  );
  privateKeyOption.password = true;
  privateKeyOption.rmempty = false;
  privateKeyOption.depends("tunnel_type", "wireguard");
  privateKeyOption.depends("tunnel_type", "amneziawg");
  privateKeyOption.validate = function (_itemId, value) {
    const key = `${value || ""}`.trim();
    if (!key) return _("Enter a private key");
    return main.validateWireGuardKey(key)
      ? true
      : _("WireGuard keys must be standard base64-encoded 32-byte values");
  };

  const listenPortOption = itemSection.option(
    form.Value,
    "listen_port",
    _("Listen port"),
    _("Optional local UDP port. Leave empty to use the default value."),
  );
  listenPortOption.datatype = "port";
  listenPortOption.rmempty = true;
  listenPortOption.depends("tunnel_type", "wireguard");
  listenPortOption.depends("tunnel_type", "amneziawg");

  const mtuOption = itemSection.option(
    form.Value,
    "mtu",
    "MTU",
    _(
      "Maximum packet size for this tunnel. Leave empty to use the default value.",
    ),
  );
  mtuOption.datatype = "range(1,65535)";
  mtuOption.rmempty = true;
  mtuOption.depends("tunnel_type", "wireguard");
  mtuOption.depends("tunnel_type", "amneziawg");

  const peersOption = itemSection.option(
    ButtonAddSettingsDynamicList,
    "peer_ids",
    _("Peers"),
    _("Required. List of remote nodes to connect."),
  );
  peersOption.rmempty = false;
  peersOption.depends("tunnel_type", "wireguard");
  peersOption.depends("tunnel_type", "amneziawg");
  peersOption.addButtonLabel = _("+ Add peer");
  peersOption.ownerOption = "tunnel";
  peersOption.childOwnerId = () => tunnelId;
  peersOption.createId = (value) => `${value || ""}`.trim();
  peersOption.renderItemSettingsModal = showWireGuardPeerSettingsModal;
  peersOption.renderListItemLabel = function (ownerId, value) {
    return wireGuardPeerListItemLabel(ownerId, value, this);
  };
  peersOption.validateItemsOnSave = function (_ownerId, values) {
    return validateWireGuardPeers(values, tunnelId, this);
  };
  peersOption.validate = function (_itemId, value) {
    if (!`${value || ""}`.trim()) {
      const current =
        typeof this.formvalue === "function" ? this.formvalue(_itemId) : [];
      return normalizeDynamicListItems(current).length > 0
        ? true
        : _("Add at least one WireGuard peer");
    }
    return validateWireGuardPeerValue(value, tunnelId, this);
  };

  const amneziaOptions = {};
  importButton.onclick = function () {
    return showTunnelImportModal(map, {
      type: typeOption,
      address: addressOption,
      privateKey: privateKeyOption,
      listenPort: listenPortOption,
      mtu: mtuOption,
      peers: peersOption,
      tunnelId,
      amnezia: amneziaOptions,
    });
  };

  o = itemSection.option(
    form.Value,
    "warp_keepalive",
    _("Persistent keepalive"),
    _(
      "Time in seconds between packets sent to keep the tunnel open. Leave empty to use the default value.",
    ),
  );
  o.validate = function (_itemId, value) {
    return validateAmneziaRange(value);
  };
  o.rmempty = true;
  o.depends("tunnel_type", "warp");

  const warpProfileIdOption = itemSection.option(
    form.Value,
    "warp_profile_id",
    _("WARP profile ID"),
  );
  warpProfileIdOption.rmempty = false;
  warpProfileIdOption.depends("tunnel_type", "warp");

  const warpAuthTokenOption = itemSection.option(
    form.Value,
    "warp_auth_token",
    _("WARP auth token"),
  );
  warpAuthTokenOption.password = true;
  warpAuthTokenOption.rmempty = false;
  warpAuthTokenOption.depends("tunnel_type", "warp");

  const warpPrivateKeyOption = itemSection.option(
    form.Value,
    "warp_private_key",
    _("WARP private key"),
  );
  warpPrivateKeyOption.password = true;
  warpPrivateKeyOption.rmempty = false;
  warpPrivateKeyOption.depends("tunnel_type", "warp");

  warpGenerateButton.onclick = function () {
    const showError = () =>
      ui.addNotification(
        _("Forkop Error"),
        E("p", {}, ["Failed to generate WARP profile."]),
        "error",
      );

    return fs
      .exec("/usr/bin/forkop", ["generate_warp_profile"])
      .then((response) => {
        let profile = {};
        try {
          profile = JSON.parse(response.stdout || "{}");
        } catch (_error) {
          // The response is validated below.
        }
        if (
          (response.code ?? 0) !== 0 ||
          !profile.id ||
          !profile.auth_token ||
          !profile.private_key
        ) {
          showError();
          return;
        }
        setModalOptionValue(map, warpProfileIdOption, profile.id);
        setModalOptionValue(map, warpAuthTokenOption, profile.auth_token);
        setModalOptionValue(map, warpPrivateKeyOption, profile.private_key);
      })
      .catch(showError);
  };

  const warpJunkOption = itemSection.option(
    form.Flag,
    "warp_junk_enabled",
    _("Traffic obfuscation"),
    _(
      "Adds traffic masking using the Amnezia mechanism to make it harder to identify.",
    ),
  );
  warpJunkOption.default = "0";
  warpJunkOption.rmempty = false;
  warpJunkOption.depends("tunnel_type", "warp");

  AMNEZIA_FIELDS.forEach((key) => {
    const option = itemSection.option(
      form.Value,
      `amnezia_${key}`,
      amneziaFieldLabel(key),
    );
    if (AMNEZIA_INTEGER_FIELDS.includes(key)) {
      option.datatype = "uinteger";
    }
    if (AMNEZIA_RANGE_FIELDS.includes(key)) {
      option.validate = function (_itemId, value) {
        return validateAmneziaRange(value);
      };
    }
    option.rmempty = true;
    option.retain = true;
    option.depends("tunnel_type", "amneziawg");
    if (WARP_JUNK_FIELDS.includes(key)) {
      option.depends({ tunnel_type: "warp", warp_junk_enabled: "1" });
    }
    if (key === "header_protection_key") {
      option.validate = function (_itemId, value) {
        const normalized = `${value || ""}`.trim();
        return !normalized || main.validateWireGuardKey(normalized)
          ? true
          : _(
              "WireGuard keys must be standard base64-encoded 32-byte values",
            );
      };
    }
    amneziaOptions[key] = option;
  });

  typeOption.onchange = function (_event, _sectionId, value) {
    if (value === "warp" && previousTunnelType === "amneziawg") {
      setModalOptionValue(map, warpJunkOption, "1");
    }
    previousTunnelType = value;
    map.checkDepends();
  };

  return renderStackedJsonSettingsModal(
    _("Tunnel settings"),
    map,
    (settings) => {
      const validation = validateTunnelSettings(
        settings,
        tunnelId,
        peersOption,
      );
      if (validation !== true) {
        throw new TypeError(validation);
      }
      const storage = tunnelStorageSettings(settings);
      const itemIds = L.toArray(settings.peer_ids).filter(Boolean);
      const itemId = createTunnelItem(section_id, tunnelId, storage);
      if (
        settings.tunnel_type === "wireguard" ||
        settings.tunnel_type === "amneziawg"
      ) {
        materializeTunnelPeers(tunnelId, itemIds, peersOption);
      } else {
        materializeTunnelPeers(tunnelId, [], peersOption);
      }
      if (context.adding) {
        uci.set(UCI_PACKAGE, itemId, "section", section_id);
        addDynamicListItem(
          widget,
          itemId,
          tunnelDisplayName(section_id, itemId),
        );
        return;
      }
      setDynamicListItemValue(itemNode, itemId);
      updateDynamicListItemLabel(
        itemNode,
        tunnelDisplayName(section_id, itemId),
      );
      if (widget && widget.node) {
        widget.dispatchCbiDynlistChange(widget.node, itemId);
      }
    },
  );
}

function validateTunnelItemsBeforeSave(section_id, values) {
  for (const value of normalizeDynamicListItems(values)) {
    const tunnelId = `${value || ""}`.trim();
    if (!isExistingChildItem(section_id, tunnelId, "tunnel")) {
      return _("Open tunnel settings and complete the configuration");
    }
    const validation = validateTunnelSettings(
      tunnelInitialSettings(tunnelId, section_id),
    );
    if (validation !== true) {
      return `${tunnelDisplayName(section_id, tunnelId) || _("Tunnel")}: ${validation}`;
    }
  }
  return true;
}

function showOutboundJsonSettingsModal(
  _section_id,
  itemValue,
  _option,
  widget,
  itemNode,
  context = {},
) {
  const data = {
    settings: {
      outbound_json: `${itemValue || ""}`,
    },
  };
  const map = new form.JSONMap(data);
  const itemSection = map.section(form.NamedSection, "settings");
  itemSection.anonymous = true;
  itemSection.addremove = false;

  const jsonOption = itemSection.option(
    form.TextValue,
    "outbound_json",
    _("JSON outbound"),
    _("Enter a complete sing-box outbound object"),
  );
  jsonOption.rows = 12;
  jsonOption.wrap = "soft";
  jsonOption.textarea = true;
  jsonOption.modalonly = true;
  jsonOption.rmempty = false;
  jsonOption.validate = function (_itemId, value) {
    const usedTags =
      widget && widget.node
        ? Array.from(widget.node.querySelectorAll(".item"))
            .filter((item) => item !== itemNode)
            .map((item) =>
              outboundJsonDisplayTag(dynamicListItemCurrentValue(item, "")),
            )
            .filter(Boolean)
        : [];
    const validation = main.validateOutboundJson(`${value || ""}`, usedTags);
    return validation.valid ? true : validation.message;
  };
  configureTextareaOption(jsonOption);

  return renderStackedJsonSettingsModal(
    _("JSON outbound settings"),
    map,
    (settings) => {
      const value = `${settings.outbound_json || ""}`.trim();
      if (context.adding) {
        addDynamicListItem(widget, value);
        return;
      }

      setDynamicListItemValue(itemNode, value);
      updateDynamicListItemLabel(itemNode, outboundJsonDisplayTag(value));
      if (widget && widget.node) {
        widget.dispatchCbiDynlistChange(widget.node, value);
      }
    },
  );
}

function validateOutboundJsonItemsBeforeSave(_section_id, values) {
  const items = Array.isArray(values) ? values : values ? [values] : [];
  const tags = [];

  for (const value of items) {
    const validation = main.validateOutboundJson(`${value || ""}`, tags);
    if (!validation.valid) {
      const tag = outboundJsonDisplayTag(value);
      return tag ? `${tag}: ${validation.message}` : validation.message;
    }

    const tag = outboundJsonDisplayTag(value);
    tags.push(tag);
  }

  return true;
}

function showRuleSetSettingsModal(section_id, itemValue, option, widget) {
  const data = {
    settings: {
      include_subnets: ruleSetIncludesSubnets(section_id, itemValue)
        ? "1"
        : "0",
    },
  };
  const map = new form.JSONMap(data);
  const section = map.section(form.NamedSection, "settings");
  section.anonymous = true;
  section.addremove = false;

  const includeSubnets = section.option(
    form.Flag,
    "include_subnets",
    _("Include IP addresses and subnets"),
    _("Subnets from the list will be extracted and added to nftables"),
  );
  includeSubnets.default = "0";
  includeSubnets.rmempty = false;

  return renderStackedJsonSettingsModal(
    _("Rule set settings"),
    map,
    (settings) => {
      const value = settings.include_subnets === "1";
      const refs = uniqueDynamicListItems(
        widget && typeof widget.getValue === "function"
          ? widget.getValue()
          : getCustomRulesetReferences(section_id),
      );
      const subnets = new Set(
        getConfigListValues(section_id, "rule_set_with_subnets").filter((ref) =>
          refs.includes(ref),
        ),
      );

      if (value) {
        subnets.add(itemValue);
      } else {
        subnets.delete(itemValue);
      }

      writeListOption(
        section_id,
        "rule_set",
        refs.filter((ref) => !subnets.has(ref)),
      );
      writeListOption(section_id, "rule_set_with_subnets", [...subnets]);
      if (option && typeof option.getUIElement === "function") {
        option.getUIElement(section_id).setValue(refs);
      }
    },
  );
}

function ensureActionProvidersAvailabilityLoaded() {
  if (actionProvidersAvailabilityState.loaded) {
    return Promise.resolve(actionProvidersAvailabilityState);
  }

  if (actionProvidersAvailabilityPromise) {
    return actionProvidersAvailabilityPromise;
  }

  if (actionProvidersAvailabilityLoader) {
    actionProvidersAvailabilityPromise = actionProvidersAvailabilityLoader()
      .then((capabilities) => {
        updateActionProvidersAvailabilityState({
          zapretInstalled: Boolean(capabilities?.zapretInstalled),
          zapret2Installed: Boolean(capabilities?.zapret2Installed),
          byedpiInstalled: Boolean(capabilities?.byedpiInstalled),
        });
        return actionProvidersAvailabilityState;
      })
      .catch(() => {
        actionProvidersAvailabilityLoader = null;
        actionProvidersAvailabilityPromise = null;
        return ensureActionProvidersAvailabilityLoaded();
      })
      .finally(() => {
        actionProvidersAvailabilityPromise = null;
      });

    return actionProvidersAvailabilityPromise;
  }

  actionProvidersAvailabilityPromise = Promise.allSettled([
    main.ForkopShellMethods.checkZapretRuntime(),
    main.ForkopShellMethods.checkZapret2Runtime(),
    main.ForkopShellMethods.checkByedpiRuntime(),
  ])
    .then(([zapretResult, zapret2Result, byedpiResult]) => {
      const zapret =
        zapretResult && zapretResult.status === "fulfilled"
          ? zapretResult.value
          : null;
      const zapret2 =
        zapret2Result && zapret2Result.status === "fulfilled"
          ? zapret2Result.value
          : null;
      const byedpi =
        byedpiResult && byedpiResult.status === "fulfilled"
          ? byedpiResult.value
          : null;

      actionProvidersAvailabilityState.loaded = true;
      actionProvidersAvailabilityState.zapretInstalled = Boolean(
        zapret && zapret.success && zapret.data && zapret.data.zapret_installed,
      );
      actionProvidersAvailabilityState.zapret2Installed = Boolean(
        zapret2 &&
          zapret2.success &&
          zapret2.data &&
          zapret2.data.zapret2_installed,
      );
      actionProvidersAvailabilityState.byedpiInstalled = Boolean(
        byedpi && byedpi.success && byedpi.data && byedpi.data.byedpi_installed,
      );
      return actionProvidersAvailabilityState;
    })
    .catch(() => {
      actionProvidersAvailabilityState.loaded = true;
      actionProvidersAvailabilityState.zapretInstalled = false;
      actionProvidersAvailabilityState.zapret2Installed = false;
      actionProvidersAvailabilityState.byedpiInstalled = false;
      return actionProvidersAvailabilityState;
    })
    .finally(() => {
      actionProvidersAvailabilityPromise = null;
    });

  return actionProvidersAvailabilityPromise;
}

function isZapretInstalledForUi() {
  return actionProvidersAvailabilityState.zapretInstalled;
}

function isZapret2InstalledForUi() {
  return actionProvidersAvailabilityState.zapret2Installed;
}

function isByedpiInstalledForUi() {
  return actionProvidersAvailabilityState.byedpiInstalled;
}

function getRuleConfiguredAction(section_id) {
  const action = uci.get(UCI_PACKAGE, section_id, "action");
  return action ? `${action}` : null;
}

function getRuleResolvedAction(section_id) {
  return getRuleConfiguredAction(section_id) || "connection";
}

function getActionOptionLabel(action) {
  switch (`${action}`) {
    case "block":
      return "Block";
    case "bypass":
      return "Bypass";
    case "connection":
      return "Connection";
    case "dns":
      return "DNS";
    case "vpn":
      return "VPN";
    case "zapret":
      return "Zapret";
    case "zapret2":
      return "Zapret2";
    case "byedpi":
      return "ByeDPI";
    case "outbound":
      return _("JSON outbound");
    case "proxy":
    default:
      return "Proxy";
  }
}

function getRuleActionDisplayValue(section_id) {
  const action = getRuleResolvedAction(section_id);

  if (action === "zapret") {
    return "Zapret";
  }

  if (action === "zapret2") {
    return "Zapret2";
  }

  if (action === "byedpi") {
    return "ByeDPI";
  }

  return getActionOptionLabel(action);
}

function getRuleActionDisplayMarkup(section_id) {
  return getRuleActionDisplayValue(section_id);
}

function populateActionOptionValues(option) {
  delete option.keylist;
  delete option.vallist;

  option.value("connection", getActionOptionLabel("connection"));
  option.value("bypass", "Bypass");
  option.value("block", "Block");
  option.value("dns", "DNS");
  if (isZapretInstalledForUi()) {
    option.value("zapret", getActionOptionLabel("zapret"));
  }
  if (isZapret2InstalledForUi()) {
    option.value("zapret2", getActionOptionLabel("zapret2"));
  }
  if (isByedpiInstalledForUi()) {
    option.value("byedpi", getActionOptionLabel("byedpi"));
  }
}

function getConfigListValues(section_id, key) {
  return normalizeOptionValues(uci.get(UCI_PACKAGE, section_id, key));
}

function stringArraysEqual(left, right) {
  left = normalizeDynamicListItems(left);
  right = normalizeDynamicListItems(right);

  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function writeListOption(section_id, key, values) {
  const normalized = normalizeOptionValues(values);

  if (stringArraysEqual(getConfigListValues(section_id, key), normalized)) {
    return;
  }

  if (normalized.length) {
    uci.set(UCI_PACKAGE, section_id, key, normalized);
  } else {
    uci.unset(UCI_PACKAGE, section_id, key);
  }
}

function makeDeviceOptionsExclusive(firstOption, secondOption) {
  let changing = false;
  const firstWidgets = {};
  const secondWidgets = {};

  function removeMatches(section_id, value, otherWidgets) {
    if (changing) {
      return;
    }

    const selected = new Set(normalizeOptionValues(value));
    if (!selected.size) {
      return;
    }

    const widget = otherWidgets[section_id];
    if (!widget) {
      return;
    }

    const current = normalizeOptionValues(widget.getValue());
    const filtered = current.filter((item) => !selected.has(item));
    if (stringArraysEqual(current, filtered)) {
      return;
    }

    changing = true;
    try {
      widget.setValue(filtered);
    } finally {
      changing = false;
    }
  }

  firstOption.onDeviceWidgetReady = function (section_id, widget) {
    firstWidgets[section_id] = widget;
  };
  secondOption.onDeviceWidgetReady = function (section_id, widget) {
    secondWidgets[section_id] = widget;
  };
  firstOption.onDeviceListChange = function (section_id, value) {
    removeMatches(section_id, value, secondWidgets);
  };
  secondOption.onDeviceListChange = function (section_id, value) {
    removeMatches(section_id, value, firstWidgets);
  };
}

function childOwnerOption(ownerOption) {
  return ownerOption || "section";
}

function childItemOrder(item) {
  const value = item ? item.order : null;
  const parsed = Number.parseInt(value == null ? "0" : `${value}`, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getChildItemIds(section_id, typeName, ownerOption) {
  const ownerKey = childOwnerOption(ownerOption);
  const items = uci
    .sections(UCI_PACKAGE, typeName)
    .filter((item) => item[ownerKey] === section_id);

  if (["fallback_level", "tunnel", "tunnel_peer"].includes(typeName)) {
    items.sort((a, b) => {
      const orderDiff = childItemOrder(a) - childItemOrder(b);
      if (orderDiff !== 0) {
        return orderDiff;
      }

      return `${a[".name"] || ""}`.localeCompare(`${b[".name"] || ""}`);
    });
  }

  return items.map((item) => item[".name"]).filter(Boolean);
}

function childItemValue(itemId, valueOption, fallback) {
  if (!valueOption) {
    return itemId;
  }

  const value = uci.get(UCI_PACKAGE, itemId, valueOption);
  return value == null || value === "" ? fallback || itemId : `${value}`;
}

function childItemInputValue(
  section_id,
  value,
  typeName,
  valueOption,
  ownerOption,
) {
  const itemId = `${value || ""}`;

  if (isExistingChildItem(section_id, itemId, typeName, ownerOption)) {
    return childItemValue(itemId, valueOption, itemId);
  }

  return itemId;
}

function isExistingChildItem(section_id, itemId, typeName, ownerOption) {
  const ownerKey = childOwnerOption(ownerOption);

  return Boolean(
    itemId &&
      uci.get(UCI_PACKAGE, itemId, ".type") === typeName &&
      uci.get(UCI_PACKAGE, itemId, ownerKey) === section_id,
  );
}

function findChildItemForInput(section_id, options, inputValue) {
  const rawValue = `${inputValue || ""}`.trim();

  if (
    isExistingChildItem(
      section_id,
      rawValue,
      options.typeName,
      options.ownerOption,
    )
  ) {
    return rawValue;
  }

  if (options.valueOption) {
    return getChildItemIds(
      section_id,
      options.typeName,
      options.ownerOption,
    ).find(
      (itemId) =>
        childItemValue(itemId, options.valueOption, itemId) === rawValue,
    );
  }

  return null;
}

function createChildItem(section_id, options, inputValue) {
  const rawValue = `${inputValue || ""}`.trim();
  const existing = findChildItemForInput(section_id, options, rawValue);

  if (existing) {
    return {
      value: existing,
      text: options.valueOption
        ? childItemValue(existing, options.valueOption, existing)
        : existing,
      created: false,
    };
  }

  const requestedId =
    typeof options.createId === "function"
      ? `${options.createId(rawValue, section_id) || ""}`.trim()
      : "";
  const itemId =
    (requestedId && uci.add(UCI_PACKAGE, options.typeName, requestedId)) ||
    requestedId ||
    uci.add(UCI_PACKAGE, options.typeName);

  uci.set(
    UCI_PACKAGE,
    itemId,
    childOwnerOption(options.ownerOption),
    section_id,
  );

  if (options.valueOption) {
    uci.set(UCI_PACKAGE, itemId, options.valueOption, rawValue);
  }

  if (options.defaults && typeof options.defaults === "object") {
    Object.entries(options.defaults).forEach(([key, value]) => {
      value =
        typeof value === "function"
          ? value(rawValue, section_id, itemId)
          : value;
      if (value !== undefined && value !== null && value !== "") {
        uci.set(
          UCI_PACKAGE,
          itemId,
          key,
          Array.isArray(value)
            ? value.map((item) => `${item || ""}`).filter(Boolean)
            : `${value}`,
        );
      }
    });
  }

  return {
    value: itemId,
    text: options.valueOption ? rawValue : itemId,
    created: true,
  };
}

function applyChildItemSettings(itemId, settings) {
  Object.entries(settings || {}).forEach(([key, value]) => {
    if (!key || key.charAt(0) === ".") {
      return;
    }

    if (value === undefined || value === null || value === "") {
      uci.unset(UCI_PACKAGE, itemId, key);
    } else if (Array.isArray(value)) {
      const values = value
        .map((item) => `${item || ""}`.trim())
        .filter((item) => item.length);
      if (values.length) {
        uci.set(UCI_PACKAGE, itemId, key, values);
      } else {
        uci.unset(UCI_PACKAGE, itemId, key);
      }
    } else {
      uci.set(UCI_PACKAGE, itemId, key, `${value}`);
    }
  });
}

function materializeChildItems(section_id, options, inputValue) {
  const result = [];
  const seen = new Set();

  normalizeDynamicListItems(inputValue).forEach((value) => {
    const createdItem = createChildItem(section_id, options, value);
    const itemId = createdItem.value;
    const stagedSettings =
      createdItem.created && typeof options.stagedSettings === "function"
        ? options.stagedSettings(value, itemId, createdItem.created)
        : null;

    if (stagedSettings) {
      applyChildItemSettings(itemId, stagedSettings);
    }

    if (itemId && !seen.has(itemId)) {
      seen.add(itemId);
      result.push(itemId);
    }
  });

  return result;
}

function cleanupFallbackLevelsForGroup(groupId) {
  getChildItemIds(groupId, "fallback_level", "group").forEach((levelId) => {
    uci.remove(UCI_PACKAGE, levelId);
  });
}

function cleanupTunnelPeers(tunnelId) {
  getChildItemIds(tunnelId, "tunnel_peer", "tunnel").forEach((peerId) => {
    uci.remove(UCI_PACKAGE, peerId);
  });
}

function cleanupRemovedChildItems(
  section_id,
  typeName,
  keepValues,
  ownerOption,
) {
  const keep = new Set(normalizeDynamicListItems(keepValues));

  getChildItemIds(section_id, typeName, ownerOption).forEach((itemId) => {
    if (!keep.has(itemId)) {
      if (typeName === "fallback_group") {
        cleanupFallbackLevelsForGroup(itemId);
      } else if (typeName === "tunnel") {
        cleanupTunnelPeers(itemId);
      }
      uci.remove(UCI_PACKAGE, itemId);
    }
  });
}

function parentSectionIdForItem(itemId) {
  return uci.get(UCI_PACKAGE, itemId, "section") || "";
}

function refreshOptionChoices(option, choices) {
  delete option.keylist;
  delete option.vallist;

  (choices || []).forEach((choice) => {
    if (typeof choice === "object") {
      option.value(choice.value, choice.label);
    } else {
      option.value(choice);
    }
  });
}

function validateRegex(_section_id, value) {
  if (!value || !value.length) {
    return true;
  }

  try {
    new RegExp(value);
    return true;
  } catch (_error) {
    return _("Invalid regular expression");
  }
}

function validateKeyword(_section_id, value) {
  if (!value || !value.length) {
    return true;
  }

  if (/[,\s]/.test(value)) {
    return _("Keyword must not contain spaces or commas");
  }

  return true;
}

function isSingBoxDuration(value) {
  return /^(?=.*[1-9])([0-9]+(?:\.[0-9]+)?(?:ns|us|ms|s|m|h|d))+$/.test(value);
}

function validateOptionalSingBoxDuration(value) {
  const normalized = value ? `${value}`.trim() : "";

  if (!normalized.length) {
    return true;
  }

  if (isSingBoxDuration(normalized)) {
    return true;
  }

  return _("Use sing-box duration format like 1d, 12h or 30m");
}

function validateRequiredSingBoxDuration(value) {
  const normalized = value ? `${value}`.trim() : "";

  if (!normalized.length) {
    return _("Use sing-box duration format like 1d, 12h or 30m");
  }

  if (isSingBoxDuration(normalized)) {
    return true;
  }

  return _("Use sing-box duration format like 1d, 12h or 30m");
}

function parseSubscriptionUrlEntry(value) {
  const normalized = value ? `${value}`.trim() : "";

  if (!normalized.length) {
    return { valid: true, url: "" };
  }

  if (normalized.includes("|")) {
    return {
      valid: false,
      message: _("Configure User-Agent in the item settings"),
    };
  }

  return { valid: true, url: normalized };
}

function validateSubscriptionUrlEntry(_section_id, value) {
  if (!value || value.length === 0) {
    return true;
  }

  const parsed = parseSubscriptionUrlEntry(value);
  if (!parsed.valid) {
    return parsed.message;
  }

  const validation = main.validateUrl(parsed.url);
  return validation.valid ? true : validation.message;
}

function getValidationHeaderText() {
  return _("Validation errors:");
}

function getDuplicateValueText() {
  return _("Duplicate value");
}

function escapeHtml(value) {
  return `${value}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ensureAnnotatedTextareaStyles() {
  if (
    typeof document === "undefined" ||
    !document.head ||
    document.getElementById(ANNOTATED_TEXTAREA_STYLE_ID)
  ) {
    return;
  }

  document.head.insertAdjacentHTML(
    "beforeend",
    `<style id="${ANNOTATED_TEXTAREA_STYLE_ID}">
      .fkp-annotated-textarea {
        position: relative;
      }

      .fkp-annotated-textarea > textarea {
        position: relative;
        z-index: 1;
        background: transparent !important;
      }

      .fkp-annotated-textarea__overlay {
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        overflow: hidden;
        box-sizing: border-box;
        color: transparent;
        white-space: pre-wrap;
        word-break: break-word;
        overflow-wrap: break-word;
      }

      .fkp-annotated-textarea__invalid {
        color: transparent;
        text-decoration-line: underline;
        text-decoration-style: wavy;
        text-decoration-color: var(--error-color-medium, #d44);
        text-decoration-thickness: 1.5px;
        text-underline-offset: 2px;
        text-decoration-skip-ink: none;
      }
    </style>`,
  );
}

function applyTextareaInputAttributes(textarea) {
  textarea.setAttribute("spellcheck", "false");
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("autocorrect", "off");
  textarea.setAttribute("autocapitalize", "off");
  textarea.setAttribute("data-gramm", "false");
  textarea.setAttribute("data-gramm_editor", "false");
  textarea.setAttribute("data-enable-grammarly", "false");
  textarea.style.resize = "vertical";
  textarea.style.maxWidth = "100%";

  const getRowsMinHeight = () => {
    const rows = Number.parseInt(textarea.getAttribute("rows") || "0", 10);
    if (!rows || typeof window === "undefined") {
      return 0;
    }

    const style = window.getComputedStyle(textarea);
    const fontSize = Number.parseFloat(style.fontSize) || 16;
    const lineHeight =
      Number.parseFloat(style.lineHeight) || Math.ceil(fontSize * 1.2);
    const verticalPadding =
      (Number.parseFloat(style.paddingTop) || 0) +
      (Number.parseFloat(style.paddingBottom) || 0);
    const verticalBorder =
      (Number.parseFloat(style.borderTopWidth) || 0) +
      (Number.parseFloat(style.borderBottomWidth) || 0);

    return Math.ceil(rows * lineHeight + verticalPadding + verticalBorder);
  };

  const applyMinHeight = () => {
    const storedMinHeight = Number.parseFloat(
      textarea.getAttribute("data-fkp-default-min-height") || "0",
    );
    const nextMinHeight = Math.max(
      storedMinHeight,
      textarea.offsetHeight,
      getRowsMinHeight(),
    );

    if (nextMinHeight > 0) {
      if (storedMinHeight <= 0) {
        textarea.setAttribute(
          "data-fkp-default-min-height",
          `${nextMinHeight}`,
        );
      }

      textarea.style.minHeight = `${nextMinHeight}px`;
      return true;
    }

    return false;
  };

  if (
    !applyMinHeight() &&
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    window.requestAnimationFrame(() => {
      if (!applyMinHeight()) {
        window.setTimeout(applyMinHeight, 0);
      }
    });
  }

  textarea.addEventListener("focus", applyMinHeight);
  textarea.addEventListener("pointerdown", applyMinHeight);
}

function syncAnnotatedTextareaOverlay(textarea, wrapper, overlay) {
  if (
    typeof window === "undefined" ||
    !textarea ||
    !wrapper ||
    !overlay ||
    typeof window.getComputedStyle !== "function"
  ) {
    return;
  }

  const style = window.getComputedStyle(textarea);

  wrapper.style.backgroundColor = style.backgroundColor;
  wrapper.style.borderRadius = style.borderRadius;

  overlay.style.font = style.font;
  overlay.style.lineHeight = style.lineHeight;
  overlay.style.letterSpacing = style.letterSpacing;
  overlay.style.paddingTop = style.paddingTop;
  overlay.style.paddingRight = style.paddingRight;
  overlay.style.paddingBottom = style.paddingBottom;
  overlay.style.paddingLeft = style.paddingLeft;
  overlay.style.borderTopWidth = style.borderTopWidth;
  overlay.style.borderRightWidth = style.borderRightWidth;
  overlay.style.borderBottomWidth = style.borderBottomWidth;
  overlay.style.borderLeftWidth = style.borderLeftWidth;
  overlay.style.borderStyle = "solid";
  overlay.style.borderColor = "transparent";
  overlay.style.textAlign = style.textAlign;
  overlay.style.direction = style.direction;
  overlay.style.tabSize = style.tabSize;
  overlay.style.textIndent = style.textIndent;
  overlay.style.textTransform = style.textTransform;
  overlay.style.boxSizing = style.boxSizing;
  overlay.style.scrollPaddingTop = style.scrollPaddingTop;

  overlay.scrollTop = textarea.scrollTop;
  overlay.scrollLeft = textarea.scrollLeft;
}

function createAnnotationKey(annotation) {
  return `${annotation.start}:${annotation.end}`;
}

function addAnnotationIssue(annotationMap, annotation, message) {
  const key = createAnnotationKey(annotation);
  const existing = annotationMap.get(key);
  if (existing) {
    if (!existing.messages.includes(message)) {
      existing.messages.push(message);
    }
    return;
  }

  annotationMap.set(key, {
    start: annotation.start,
    end: annotation.end,
    messages: [message],
  });
}

function finalizeAnnotations(annotationMap) {
  return Array.from(annotationMap.values())
    .map((annotation) => ({
      start: annotation.start,
      end: annotation.end,
      message: annotation.messages.join("; "),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function renderAnnotatedTextareaOverlay(value, annotations) {
  const text = value ? `${value}` : "";
  const normalizedAnnotations = Array.isArray(annotations) ? annotations : [];

  if (!text.length) {
    return "&#8203;";
  }

  if (!normalizedAnnotations.length) {
    return `${escapeHtml(text)}${text.endsWith("\n") ? "\n " : ""}`;
  }

  let cursor = 0;
  let html = "";

  normalizedAnnotations.forEach((annotation) => {
    if (
      annotation.start < cursor ||
      annotation.start >= annotation.end ||
      annotation.start < 0
    ) {
      return;
    }

    html += escapeHtml(text.slice(cursor, annotation.start));
    html += `<span class="fkp-annotated-textarea__invalid">${escapeHtml(
      text.slice(annotation.start, annotation.end),
    )}</span>`;
    cursor = annotation.end;
  });

  html += escapeHtml(text.slice(cursor));

  if (text.endsWith("\n")) {
    html += "\n ";
  }

  return html;
}

function attachAnnotatedTextarea(textarea, analyzer) {
  if (!textarea || typeof analyzer !== "function") {
    return;
  }

  ensureAnnotatedTextareaStyles();

  if (textarea.__forkopAnnotatedTextareaController) {
    textarea.__forkopAnnotatedTextareaController.analyzer = analyzer;
    textarea.__forkopAnnotatedTextareaController.update();
    return;
  }

  const wrapper = textarea.parentNode;
  if (!wrapper) {
    return;
  }

  wrapper.classList.add("fkp-annotated-textarea");

  const overlay = document.createElement("div");
  overlay.className = "fkp-annotated-textarea__overlay";
  overlay.setAttribute("aria-hidden", "true");
  wrapper.insertBefore(overlay, textarea.nextSibling);

  const controller = {
    analyzer,
    textarea,
    wrapper,
    overlay,
    update() {
      const analysis = this.analyzer(this.textarea.value);
      this.overlay.innerHTML = renderAnnotatedTextareaOverlay(
        this.textarea.value,
        analysis.annotations,
      );
      syncAnnotatedTextareaOverlay(this.textarea, this.wrapper, this.overlay);
    },
  };

  textarea.__forkopAnnotatedTextareaController = controller;

  const updateAnnotatedTextarea = () => controller.update();
  textarea.addEventListener("input", updateAnnotatedTextarea);
  textarea.addEventListener("change", updateAnnotatedTextarea);
  textarea.addEventListener("scroll", updateAnnotatedTextarea, {
    passive: true,
  });
  textarea.addEventListener("keyup", updateAnnotatedTextarea);

  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(() => controller.update());
    resizeObserver.observe(textarea);
    controller.resizeObserver = resizeObserver;
  }

  controller.update();
}

function refreshAnnotatedTextareaValidation(option, section_id, textarea) {
  if (option && typeof option.triggerValidation === "function") {
    option.triggerValidation(section_id);
  }

  if (
    textarea &&
    textarea.__forkopAnnotatedTextareaController &&
    typeof textarea.__forkopAnnotatedTextareaController.update === "function"
  ) {
    textarea.__forkopAnnotatedTextareaController.update();
  }
}

function attachNfqwsRemoteValidation(option, section_id, textarea) {
  if (!textarea || textarea.__forkopNfqwsRemoteValidationAttached) {
    return;
  }

  textarea.__forkopNfqwsRemoteValidationAttached = true;
  textarea.__forkopNfqwsRemoteValidationRequestId = 0;
  textarea.__forkopNfqwsRemoteValidationTimer = null;

  const runValidation = () => {
    const value = textarea.value;
    const localAnalysis = buildNfqwsLocalAnalysis(value);
    if (!localAnalysis.valid) {
      refreshAnnotatedTextareaValidation(option, section_id, textarea);
      return;
    }

    const requestId =
      (textarea.__forkopNfqwsRemoteValidationRequestId || 0) + 1;
    textarea.__forkopNfqwsRemoteValidationRequestId = requestId;

    validateNfqwsStrategyRemotely(value).then(() => {
      if (textarea.__forkopNfqwsRemoteValidationRequestId !== requestId) {
        return;
      }

      refreshAnnotatedTextareaValidation(option, section_id, textarea);
    });
  };

  const scheduleValidation = (delay = NFQWS_REMOTE_VALIDATION_DEBOUNCE_MS) => {
    if (textarea.__forkopNfqwsRemoteValidationTimer) {
      window.clearTimeout(textarea.__forkopNfqwsRemoteValidationTimer);
    }

    textarea.__forkopNfqwsRemoteValidationTimer = window.setTimeout(() => {
      textarea.__forkopNfqwsRemoteValidationTimer = null;
      runValidation();
    }, delay);
  };

  textarea.addEventListener("input", () => scheduleValidation());
  textarea.addEventListener("change", () => scheduleValidation(0));
  textarea.addEventListener("blur", () => scheduleValidation(0));

  scheduleValidation(0);
}

function attachNfqws2RemoteValidation(option, section_id, textarea) {
  if (!textarea || textarea.__forkopNfqws2RemoteValidationAttached) {
    return;
  }

  textarea.__forkopNfqws2RemoteValidationAttached = true;
  textarea.__forkopNfqws2RemoteValidationRequestId = 0;
  textarea.__forkopNfqws2RemoteValidationTimer = null;

  const runValidation = () => {
    const value = textarea.value;
    const localAnalysis = buildNfqws2LocalAnalysis(value);
    if (!localAnalysis.valid) {
      refreshAnnotatedTextareaValidation(option, section_id, textarea);
      return;
    }

    const requestId =
      (textarea.__forkopNfqws2RemoteValidationRequestId || 0) + 1;
    textarea.__forkopNfqws2RemoteValidationRequestId = requestId;

    validateNfqws2StrategyRemotely(value).then(() => {
      if (textarea.__forkopNfqws2RemoteValidationRequestId !== requestId) {
        return;
      }

      refreshAnnotatedTextareaValidation(option, section_id, textarea);
    });
  };

  const scheduleValidation = (delay = NFQWS_REMOTE_VALIDATION_DEBOUNCE_MS) => {
    if (textarea.__forkopNfqws2RemoteValidationTimer) {
      window.clearTimeout(textarea.__forkopNfqws2RemoteValidationTimer);
    }

    textarea.__forkopNfqws2RemoteValidationTimer = window.setTimeout(() => {
      textarea.__forkopNfqws2RemoteValidationTimer = null;
      runValidation();
    }, delay);
  };

  textarea.addEventListener("input", () => scheduleValidation());
  textarea.addEventListener("change", () => scheduleValidation(0));
  textarea.addEventListener("blur", () => scheduleValidation(0));

  scheduleValidation(0);
}

function parseCommentAwareListTokens(value) {
  const text = value ? `${value}` : "";
  const tokens = [];
  const lines = text.split(/\r\n|\r|\n/);
  const newlines = text.match(/\r\n|\r|\n/g) || [];
  let offset = 0;

  lines.forEach((line, index) => {
    const hashIndex = line.indexOf("#");
    const slashIndex = line.indexOf("//");
    let commentIndex = -1;

    if (hashIndex >= 0 && slashIndex >= 0) {
      commentIndex = Math.min(hashIndex, slashIndex);
    } else if (hashIndex >= 0) {
      commentIndex = hashIndex;
    } else if (slashIndex >= 0) {
      commentIndex = slashIndex;
    }

    const source = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
    const matcher = /[^,\s]+/g;
    let match;

    while ((match = matcher.exec(source)) !== null) {
      tokens.push({
        value: match[0],
        start: offset + match.index,
        end: offset + match.index + match[0].length,
      });
    }

    offset += line.length + (newlines[index] ? newlines[index].length : 0);
  });

  return tokens;
}

function analyzeTextListValue(value, validateItem, emptyMessage, options = {}) {
  const text = value ? `${value}` : "";
  if (!text.length) {
    return { valid: true, message: "", annotations: [] };
  }

  const tokens = parseCommentAwareListTokens(text);
  if (!tokens.length) {
    return { valid: false, message: emptyMessage, annotations: [] };
  }

  const duplicateMessage = options.duplicateMessage || getDuplicateValueText();
  const annotationMap = new Map();
  const errors = [];
  const seen = new Set();

  tokens.forEach((token) => {
    if (typeof validateItem === "function") {
      const validation = validateItem(token.value);
      if (!validation.valid) {
        errors.push(`${token.value}: ${validation.message}`);
        addAnnotationIssue(annotationMap, token, validation.message);
      }
    }

    const normalized = options.normalizeDuplicateValue
      ? options.normalizeDuplicateValue(token.value)
      : token.value;

    if (!normalized) {
      return;
    }

    if (seen.has(normalized)) {
      errors.push(`${token.value}: ${duplicateMessage}`);
      addAnnotationIssue(annotationMap, token, duplicateMessage);
      return;
    }

    seen.add(normalized);
  });

  if (!errors.length) {
    return { valid: true, message: "", annotations: [] };
  }

  return {
    valid: false,
    message: [getValidationHeaderText(), ...errors].join("\n"),
    annotations: finalizeAnnotations(annotationMap),
  };
}

function analyzeDomainSuffixText(value) {
  const validateDomainCondition = (domain) => {
    const normalized = `${domain || ""}`.trim();
    if (normalized.includes("/")) {
      return { valid: false, message: _("Invalid domain address") };
    }

    return main.validateDomain(normalized, true);
  };

  return analyzeTextListValue(
    value,
    (item) => {
      const colonIndex = item.indexOf(":");
      const prefix = colonIndex > 0 ? item.slice(0, colonIndex) : "";
      const body = colonIndex > 0 ? item.slice(colonIndex + 1) : item;

      if (!prefix) {
        return validateDomainCondition(body);
      }

      if (!["full", "keyword", "regex"].includes(prefix)) {
        return {
          valid: false,
          message: _("Allowed domain prefixes are full:, keyword:, and regex:"),
        };
      }

      if (!body.length) {
        return { valid: false, message: _("Value cannot be empty") };
      }

      if (prefix === "full") {
        return validateDomainCondition(body);
      }

      if (prefix === "keyword") {
        const validation = validateKeyword(null, body);
        return validation === true
          ? { valid: true, message: _("Valid") }
          : { valid: false, message: validation };
      }

      if (/[,\s]/.test(body)) {
        return {
          valid: false,
          message: _("Regular expression must not contain spaces or commas"),
        };
      }

      const validation = validateRegex(null, body);
      return validation === true
        ? { valid: true, message: _("Valid") }
        : { valid: false, message: validation };
    },
    _("At least one valid domain must be specified."),
    {
      normalizeDuplicateValue: (item) => `${item}`.toLowerCase(),
    },
  );
}

function domainValuesWithPrefix(section_id, key, prefix) {
  return getConfigListValues(section_id, key).map((value) =>
    prefix ? `${prefix}:${value}` : value,
  );
}

function domainTextValuesWithPrefix(section_id, key, prefix) {
  const legacyText = uci.get(UCI_PACKAGE, section_id, `${key}_text`);
  if (!legacyText) {
    return [];
  }

  return main
    .parseValueList(legacyText)
    .map((value) => (prefix ? `${prefix}:${value}` : value));
}

function uniqueDomainTextValues(values) {
  const seen = new Set();

  return values.filter((value) => {
    const key = `${value}`.toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function appendUniqueDomainTextValues(textValue, values) {
  const originalText = typeof textValue === "string" ? textValue : "";
  const seen = new Set(
    main.parseValueList(originalText).map((value) => `${value}`.toLowerCase()),
  );
  const additions = uniqueDomainTextValues(values).filter((value) => {
    const key = `${value}`.toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  if (!additions.length) {
    return originalText;
  }

  const base = originalText.replace(/\s+$/, "");
  return [base, ...additions].filter(Boolean).join("\n");
}

function loadCombinedDomainText(section_id) {
  const textValue =
    uci.get(UCI_PACKAGE, section_id, "domain") ||
    uci.get(UCI_PACKAGE, section_id, "domain_suffix_text");
  const values = [
    ...domainValuesWithPrefix(section_id, "domain_suffix", ""),
    ...domainValuesWithPrefix(section_id, "domain_keyword", "keyword"),
    ...domainValuesWithPrefix(section_id, "domain_regex", "regex"),
    ...domainTextValuesWithPrefix(section_id, "domain_suffix", ""),
    ...domainTextValuesWithPrefix(section_id, "domain", "full"),
    ...domainTextValuesWithPrefix(section_id, "domain_keyword", "keyword"),
    ...domainTextValuesWithPrefix(section_id, "domain_regex", "regex"),
  ];

  return appendUniqueDomainTextValues(textValue, values);
}

function analyzeIpCidrText(value) {
  return analyzeTextListValue(
    value,
    (item) => main.validateSubnet(item),
    _("At least one valid IP or subnet must be specified."),
    {
      normalizeDuplicateValue: (item) => `${item}`.trim(),
    },
  );
}

function validatePortCondition(_section_id, value) {
  const normalized = value ? `${value}`.trim() : "";

  if (!normalized.length) {
    return true;
  }

  const match = normalized.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) {
    return _("Invalid port or range. Use 80 or 1000-2000");
  }

  const start = Number.parseInt(match[1], 10);
  const end = match[2] ? Number.parseInt(match[2], 10) : start;

  if (start < 1 || start > 65535 || end < 1 || end > 65535) {
    return _("Port must be between 1 and 65535");
  }

  if (start > end) {
    return _("Port range start must be less than or equal to end");
  }

  return true;
}

function getNfqwsOptionArgumentMode(option) {
  if (NFQWS_REQUIRED_ARG_OPTIONS.has(option)) {
    return "required";
  }

  if (NFQWS_OPTIONAL_ARG_OPTIONS.has(option)) {
    return "optional";
  }

  if (NFQWS_NO_ARG_OPTIONS.has(option)) {
    return "none";
  }

  return "unknown";
}

function getNfqws2OptionArgumentMode(option) {
  if (NFQWS2_REQUIRED_ARG_OPTIONS.has(option)) {
    return "required";
  }

  if (NFQWS2_OPTIONAL_ARG_OPTIONS.has(option)) {
    return "optional";
  }

  if (NFQWS2_NO_ARG_OPTIONS.has(option)) {
    return "none";
  }

  return "unknown";
}

function normalizeNfqwsStrategyWhitespace(value) {
  return value ? `${value}`.replace(/\s+/g, " ").trim() : "";
}

function parseNfqwsRuntimeTokens(value) {
  const text = value ? `${value}` : "";
  const tokens = [];
  const matcher = /\S+/g;
  let match;

  while ((match = matcher.exec(text)) !== null) {
    tokens.push({
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return tokens;
}
function normalizeNfqwsStrategyValue(value) {
  const normalized = normalizeNfqwsStrategyWhitespace(value);
  if (!normalized.length) {
    return "";
  }

  return normalized === ZAPRET_LEGACY_DEFAULT_NFQWS_OPT
    ? ZAPRET_DEFAULT_NFQWS_OPT
    : normalized;
}

function getCachedNfqwsRemoteValidation(value) {
  const normalized = normalizeNfqwsStrategyValue(value);
  return normalized.length
    ? nfqwsRemoteValidationCache.get(normalized) || null
    : null;
}

function cacheNfqwsRemoteValidation(value, result) {
  const normalized = normalizeNfqwsStrategyValue(value);
  if (!normalized.length) {
    return result;
  }

  const cached = {
    valid: result && result.valid === true,
    message: result && result.message ? `${result.message}` : "",
    needle: result && result.needle ? `${result.needle}` : "",
    needles:
      result && Array.isArray(result.needles)
        ? result.needles.filter(Boolean).map((item) => `${item}`)
        : result && result.needle
          ? [`${result.needle}`]
          : [],
  };

  nfqwsRemoteValidationCache.set(normalized, cached);
  return cached;
}

function buildNfqwsRemoteValidationFallback(error) {
  const message =
    error && error.message
      ? `${error.message}`
      : _("Unable to validate the NFQWS strategy through the backend parser.");

  return {
    valid: false,
    message: _("Backend validation failed: %s").format(message),
    needle: "",
    needles: [],
  };
}

function validateNfqwsStrategyRemotely(value) {
  const normalized = normalizeNfqwsStrategyValue(value);

  if (!normalized.length) {
    return Promise.resolve({
      valid: true,
      message: "",
      needle: "",
      needles: [],
    });
  }

  if (nfqwsRemoteValidationCache.has(normalized)) {
    return Promise.resolve(nfqwsRemoteValidationCache.get(normalized));
  }

  if (nfqwsRemoteValidationInflight.has(normalized)) {
    return nfqwsRemoteValidationInflight.get(normalized);
  }

  const validationTask = fs
    .exec(NFQWS_VALIDATION_COMMAND, [
      "validate_nfqws_strategy_json",
      normalized,
    ])
    .then((result) => {
      const payload = JSON.parse(
        (result && result.stdout ? result.stdout : "{}").trim() || "{}",
      );
      return cacheNfqwsRemoteValidation(normalized, {
        valid: payload.valid === true,
        message: payload.message || "",
        needle: payload.needle || "",
        needles: Array.isArray(payload.needles)
          ? payload.needles.filter(Boolean)
          : payload.needle
            ? [payload.needle]
            : [],
      });
    })
    .catch((error) =>
      cacheNfqwsRemoteValidation(
        normalized,
        buildNfqwsRemoteValidationFallback(error),
      ),
    )
    .finally(() => {
      nfqwsRemoteValidationInflight.delete(normalized);
    });

  nfqwsRemoteValidationInflight.set(normalized, validationTask);
  return validationTask;
}

function getNfqwsForbiddenTokenInfo(token, index) {
  const configFileMessage = _(
    "External nfqws config files bypass Forkop queue management and explicit validation.",
  );
  const hostSelectionMessage = _(
    "Resource selection by hostname inside nfqws is not supported here; sing-box selects resources before NFQUEUE.",
  );
  const ipSelectionMessage = _(
    "Resource selection by IP or CIDR inside nfqws is not supported here; sing-box selects resources before NFQUEUE.",
  );
  const placeholderMessage = _(
    "Zapret hostlist templates are not supported here because Forkop does not expand them for per-rule NFQWS strategies.",
  );
  const queueMessage = _(
    "The NFQUEUE number is assigned by Forkop for each rule and must not be overridden here.",
  );
  const fwmarkMessage = _(
    "The desync fwmark is managed by Forkop for loop prevention and must not be overridden here.",
  );
  const daemonMessage = _(
    "Forkop manages the nfqws process lifecycle itself, so daemon mode is not allowed here.",
  );
  const dryRunMessage = _(
    "This field must start a working nfqws strategy; --dry-run exits immediately and is not allowed here.",
  );
  const versionMessage = _(
    "This field must start a working nfqws strategy; --version exits immediately and is not allowed here.",
  );

  if (index === 0 && (token.startsWith("@") || token.startsWith("$"))) {
    return {
      reason: configFileMessage,
      captureNextValue: false,
    };
  }

  if (token === "<HOSTLIST>" || token === "<HOSTLIST_NOAUTO>") {
    return {
      reason: placeholderMessage,
      captureNextValue: false,
    };
  }

  if (
    token === "--hostlist" ||
    token.startsWith("--hostlist=") ||
    token === "--hostlist-domains" ||
    token.startsWith("--hostlist-domains=") ||
    token === "--hostlist-exclude" ||
    token.startsWith("--hostlist-exclude=") ||
    token === "--hostlist-exclude-domains" ||
    token.startsWith("--hostlist-exclude-domains=") ||
    token === "--hostlist-auto" ||
    token.startsWith("--hostlist-auto=") ||
    token === "--hostlist-auto-fail-threshold" ||
    token.startsWith("--hostlist-auto-fail-threshold=") ||
    token === "--hostlist-auto-fail-time" ||
    token.startsWith("--hostlist-auto-fail-time=") ||
    token === "--hostlist-auto-retrans-threshold" ||
    token.startsWith("--hostlist-auto-retrans-threshold=") ||
    token === "--hostlist-auto-debug" ||
    token.startsWith("--hostlist-auto-debug=")
  ) {
    return {
      reason: hostSelectionMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (
    token === "--ipset" ||
    token.startsWith("--ipset=") ||
    token === "--ipset-ip" ||
    token.startsWith("--ipset-ip=") ||
    token === "--ipset-exclude" ||
    token.startsWith("--ipset-exclude=") ||
    token === "--ipset-exclude-ip" ||
    token.startsWith("--ipset-exclude-ip=")
  ) {
    return {
      reason: ipSelectionMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (token === "--qnum" || token.startsWith("--qnum=")) {
    return {
      reason: queueMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (
    token === "--dpi-desync-fwmark" ||
    token.startsWith("--dpi-desync-fwmark=")
  ) {
    return {
      reason: fwmarkMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (token === "--daemon") {
    return {
      reason: daemonMessage,
      captureNextValue: false,
    };
  }

  if (token === "--dry-run") {
    return {
      reason: dryRunMessage,
      captureNextValue: false,
    };
  }

  if (token === "--version") {
    return {
      reason: versionMessage,
      captureNextValue: false,
    };
  }

  return null;
}

function buildNfqwsLocalAnalysis(value) {
  const text = value ? `${value}` : "";
  if (!text.trim().length) {
    return {
      valid: false,
      message: _("NFQWS strategy cannot be empty"),
      annotations: [],
    };
  }

  if (text.trim() === ZAPRET_LEGACY_DEFAULT_NFQWS_OPT) {
    return { valid: true, message: "", annotations: [] };
  }

  const tokens = parseNfqwsRuntimeTokens(text);
  const annotationMap = new Map();
  const errors = [];

  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index];
    const bareToken = token.value.includes("=")
      ? token.value.slice(0, token.value.indexOf("="))
      : token.value;
    const nextToken = tokens[index + 1] || null;

    const forbidden = getNfqwsForbiddenTokenInfo(token.value, index);
    if (forbidden) {
      addAnnotationIssue(annotationMap, token, forbidden.reason);

      let displayToken = token.value;

      if (
        forbidden.captureNextValue &&
        nextToken &&
        !nextToken.value.startsWith("--")
      ) {
        addAnnotationIssue(annotationMap, nextToken, forbidden.reason);
        displayToken = `${displayToken} ${nextToken.value}`;
        index += 2;
      } else {
        index += 1;
      }

      errors.push(`${displayToken}: ${forbidden.reason}`);
      continue;
    }

    if (!token.value.startsWith("--")) {
      const reason = _(
        "Unexpected standalone token. Use explicit flags such as --name or --name=value.",
      );
      addAnnotationIssue(annotationMap, token, reason);
      errors.push(`${token.value}: ${reason}`);
      index += 1;
      continue;
    }

    const mode = getNfqwsOptionArgumentMode(bareToken);
    if (mode === "unknown") {
      const reason = _("Unknown NFQWS flag.");
      addAnnotationIssue(annotationMap, token, reason);
      errors.push(`${token.value}: ${reason}`);
      index += 1;
      continue;
    }

    if (mode === "none") {
      if (token.value.includes("=")) {
        const reason = _("This flag does not accept a value.");
        addAnnotationIssue(annotationMap, token, reason);
        errors.push(`${token.value}: ${reason}`);
      }

      index += 1;
      continue;
    }

    if (mode === "optional") {
      if (
        nextToken &&
        !token.value.includes("=") &&
        !nextToken.value.startsWith("--")
      ) {
        const reason = _(
          "Optional values must be attached with '=' here; a separate token would be ignored by nfqws.",
        );
        addAnnotationIssue(annotationMap, token, reason);
        addAnnotationIssue(annotationMap, nextToken, reason);
        errors.push(`${token.value} ${nextToken.value}: ${reason}`);
        index += 2;
      } else {
        index += 1;
      }

      continue;
    }

    if (!token.value.includes("=")) {
      if (!nextToken || nextToken.value.startsWith("--")) {
        const reason = _("This option requires a value.");
        addAnnotationIssue(annotationMap, token, reason);
        errors.push(`${token.value}: ${reason}`);
        index += 1;
        continue;
      }

      index += 2;
      continue;
    }

    index += 1;
  }

  if (!errors.length) {
    return { valid: true, message: "", annotations: [] };
  }

  return {
    valid: false,
    message: [getValidationHeaderText(), ...errors].join("\n"),
    annotations: finalizeAnnotations(annotationMap),
  };
}

function addNfqwsRemoteValidationNeedleAnnotations(
  annotationMap,
  tokens,
  remoteValidation,
  needle,
) {
  if (!needle.length) {
    return;
  }

  let matched = false;

  tokens.forEach((token) => {
    const tokenValue = token.value || "";
    const optionMatch =
      needle.startsWith("--") &&
      (tokenValue === needle || tokenValue.startsWith(`${needle}=`));
    const valueMatch =
      tokenValue === needle ||
      tokenValue.endsWith(`=${needle}`) ||
      (!needle.startsWith("--") && tokenValue.includes(`=${needle},`)) ||
      (!needle.startsWith("--") && tokenValue.endsWith(`=${needle}`));

    if (optionMatch || valueMatch) {
      addAnnotationIssue(annotationMap, token, remoteValidation.message);
      matched = true;
    }
  });

  if (matched) {
    return;
  }

  if (needle.startsWith("--")) {
    tokens
      .filter((token) => token.value && token.value.startsWith(needle))
      .forEach((token) =>
        addAnnotationIssue(annotationMap, token, remoteValidation.message),
      );
  }
}

function addNfqwsRemoteValidationAnnotations(
  annotationMap,
  tokens,
  remoteValidation,
) {
  const needles =
    remoteValidation &&
    Array.isArray(remoteValidation.needles) &&
    remoteValidation.needles.length
      ? remoteValidation.needles.map((needle) => `${needle}`)
      : remoteValidation && remoteValidation.needle
        ? [`${remoteValidation.needle}`]
        : [];

  needles.forEach((needle) =>
    addNfqwsRemoteValidationNeedleAnnotations(
      annotationMap,
      tokens,
      remoteValidation,
      needle,
    ),
  );
}

function analyzeNfqwsStrategy(value) {
  const localAnalysis = buildNfqwsLocalAnalysis(value);
  if (!localAnalysis.valid) {
    return localAnalysis;
  }

  const remoteValidation = getCachedNfqwsRemoteValidation(value);
  if (!remoteValidation || remoteValidation.valid) {
    return localAnalysis;
  }

  const text = value ? `${value}` : "";
  const tokens = parseNfqwsRuntimeTokens(text);
  const annotationMap = new Map();

  localAnalysis.annotations.forEach((annotation) =>
    addAnnotationIssue(annotationMap, annotation, annotation.message),
  );
  addNfqwsRemoteValidationAnnotations(annotationMap, tokens, remoteValidation);

  return {
    valid: false,
    message: [getValidationHeaderText(), remoteValidation.message].join("\n"),
    annotations: finalizeAnnotations(annotationMap),
  };
}

function normalizeNfqws2StrategyValue(value) {
  const normalized = normalizeNfqwsStrategyWhitespace(value);
  return normalized.length ? normalized : ZAPRET2_DEFAULT_NFQWS2_OPT;
}

function getCachedNfqws2RemoteValidation(value) {
  const normalized = normalizeNfqws2StrategyValue(value);
  return normalized.length
    ? nfqws2RemoteValidationCache.get(normalized) || null
    : null;
}

function cacheNfqws2RemoteValidation(value, result) {
  const normalized = normalizeNfqws2StrategyValue(value);
  if (!normalized.length) {
    return result;
  }

  const cached = {
    valid: result && result.valid === true,
    message: result && result.message ? `${result.message}` : "",
    needle: result && result.needle ? `${result.needle}` : "",
    needles:
      result && Array.isArray(result.needles)
        ? result.needles.filter(Boolean).map((item) => `${item}`)
        : result && result.needle
          ? [`${result.needle}`]
          : [],
  };

  nfqws2RemoteValidationCache.set(normalized, cached);
  return cached;
}

function buildNfqws2RemoteValidationFallback(error) {
  const message =
    error && error.message
      ? `${error.message}`
      : _("Unable to validate the NFQWS2 strategy through the backend parser.");

  return {
    valid: false,
    message: _("Backend validation failed: %s").format(message),
    needle: "",
    needles: [],
  };
}

function validateNfqws2StrategyRemotely(value) {
  const normalized = normalizeNfqws2StrategyValue(value);

  if (!normalized.length) {
    return Promise.resolve({
      valid: true,
      message: "",
      needle: "",
      needles: [],
    });
  }

  if (nfqws2RemoteValidationCache.has(normalized)) {
    return Promise.resolve(nfqws2RemoteValidationCache.get(normalized));
  }

  if (nfqws2RemoteValidationInflight.has(normalized)) {
    return nfqws2RemoteValidationInflight.get(normalized);
  }

  const validationTask = fs
    .exec(NFQWS_VALIDATION_COMMAND, [
      "validate_nfqws2_strategy_json",
      normalized,
    ])
    .then((result) => {
      const payload = JSON.parse(
        (result && result.stdout ? result.stdout : "{}").trim() || "{}",
      );
      return cacheNfqws2RemoteValidation(normalized, {
        valid: payload.valid === true,
        message: payload.message || "",
        needle: payload.needle || "",
        needles: Array.isArray(payload.needles)
          ? payload.needles.filter(Boolean)
          : payload.needle
            ? [payload.needle]
            : [],
      });
    })
    .catch((error) =>
      cacheNfqws2RemoteValidation(
        normalized,
        buildNfqws2RemoteValidationFallback(error),
      ),
    )
    .finally(() => {
      nfqws2RemoteValidationInflight.delete(normalized);
    });

  nfqws2RemoteValidationInflight.set(normalized, validationTask);
  return validationTask;
}

function getNfqws2ForbiddenTokenInfo(token, index, nextToken) {
  const configFileMessage = _(
    "External nfqws2 config files bypass Forkop queue management and explicit validation.",
  );
  const hostSelectionMessage = _(
    "Resource selection by hostname inside nfqws2 is not supported here; sing-box selects resources before NFQUEUE.",
  );
  const ipSelectionMessage = _(
    "Resource selection by IP or CIDR inside nfqws2 is not supported here; sing-box selects resources before NFQUEUE.",
  );
  const placeholderMessage = _(
    "Zapret2 hostlist templates are not supported here because Forkop does not expand them for per-rule NFQWS2 strategies.",
  );
  const queueMessage = _(
    "The NFQUEUE number is assigned by Forkop for each rule and must not be overridden here.",
  );
  const fwmarkMessage = _(
    "The desync fwmark is managed by Forkop for loop prevention and must not be overridden here.",
  );
  const fuzzMessage = _(
    "Fuzzing is not supported here because Forkop needs deterministic runtime validation.",
  );
  const interceptMessage = _(
    "Disabling interception is incompatible with action=zapret2 because Forkop sends matched traffic through NFQUEUE.",
  );
  const daemonMessage = _(
    "Forkop manages the nfqws2 process lifecycle itself, so daemon mode is not allowed here.",
  );
  const dryRunMessage = _(
    "This field must start a working nfqws2 strategy; --dry-run exits immediately and is not allowed here.",
  );
  const versionMessage = _(
    "This field must start a working nfqws2 strategy; --version exits immediately and is not allowed here.",
  );

  if (index === 0 && (token.startsWith("@") || token.startsWith("$"))) {
    return {
      reason: configFileMessage,
      captureNextValue: false,
    };
  }

  if (token === "<HOSTLIST>" || token === "<HOSTLIST_NOAUTO>") {
    return {
      reason: placeholderMessage,
      captureNextValue: false,
    };
  }

  if (
    token === "--hostlist" ||
    token.startsWith("--hostlist=") ||
    token === "--hostlist-domains" ||
    token.startsWith("--hostlist-domains=") ||
    token === "--hostlist-exclude" ||
    token.startsWith("--hostlist-exclude=") ||
    token === "--hostlist-exclude-domains" ||
    token.startsWith("--hostlist-exclude-domains=") ||
    token === "--hostlist-auto" ||
    token.startsWith("--hostlist-auto=") ||
    token === "--hostlist-auto-fail-threshold" ||
    token.startsWith("--hostlist-auto-fail-threshold=") ||
    token === "--hostlist-auto-fail-time" ||
    token.startsWith("--hostlist-auto-fail-time=") ||
    token === "--hostlist-auto-retrans-threshold" ||
    token.startsWith("--hostlist-auto-retrans-threshold=") ||
    token === "--hostlist-auto-debug" ||
    token.startsWith("--hostlist-auto-debug=") ||
    token === "--hostlist-auto-retrans-reset" ||
    token.startsWith("--hostlist-auto-retrans-reset=")
  ) {
    return {
      reason: hostSelectionMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (
    token === "--ipset" ||
    token.startsWith("--ipset=") ||
    token === "--ipset-ip" ||
    token.startsWith("--ipset-ip=") ||
    token === "--ipset-exclude" ||
    token.startsWith("--ipset-exclude=") ||
    token === "--ipset-exclude-ip" ||
    token.startsWith("--ipset-exclude-ip=")
  ) {
    return {
      reason: ipSelectionMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (token === "--qnum" || token.startsWith("--qnum=")) {
    return {
      reason: queueMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (
    token === "--fwmark" ||
    token.startsWith("--fwmark=") ||
    token === "--dpi-desync-fwmark" ||
    token.startsWith("--dpi-desync-fwmark=")
  ) {
    return {
      reason: fwmarkMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (token === "--fuzz" || token.startsWith("--fuzz=")) {
    return {
      reason: fuzzMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (
    token === "--intercept=0" ||
    token === "--intercept=false" ||
    token === "--intercept=no" ||
    (token === "--intercept" && nextToken && nextToken.value === "0")
  ) {
    return {
      reason: interceptMessage,
      captureNextValue: token === "--intercept",
    };
  }

  if (token === "--daemon") {
    return {
      reason: daemonMessage,
      captureNextValue: false,
    };
  }

  if (token === "--dry-run") {
    return {
      reason: dryRunMessage,
      captureNextValue: false,
    };
  }

  if (token === "--version") {
    return {
      reason: versionMessage,
      captureNextValue: false,
    };
  }

  return null;
}

function buildNfqws2LocalAnalysis(value) {
  const text = value ? `${value}` : "";
  if (!text.trim().length) {
    return {
      valid: false,
      message: _("NFQWS2 strategy cannot be empty"),
      annotations: [],
    };
  }

  const tokens = parseNfqwsRuntimeTokens(text);
  const annotationMap = new Map();
  const errors = [];

  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index];
    const bareToken = token.value.includes("=")
      ? token.value.slice(0, token.value.indexOf("="))
      : token.value;
    const nextToken = tokens[index + 1] || null;

    const forbidden = getNfqws2ForbiddenTokenInfo(
      token.value,
      index,
      nextToken,
    );
    if (forbidden) {
      addAnnotationIssue(annotationMap, token, forbidden.reason);

      let displayToken = token.value;

      if (
        forbidden.captureNextValue &&
        nextToken &&
        !nextToken.value.startsWith("--")
      ) {
        addAnnotationIssue(annotationMap, nextToken, forbidden.reason);
        displayToken = `${displayToken} ${nextToken.value}`;
        index += 2;
      } else {
        index += 1;
      }

      errors.push(`${displayToken}: ${forbidden.reason}`);
      continue;
    }

    if (!token.value.startsWith("--")) {
      const reason = _(
        "Unexpected standalone token. Use explicit flags such as --name or --name=value.",
      );
      addAnnotationIssue(annotationMap, token, reason);
      errors.push(`${token.value}: ${reason}`);
      index += 1;
      continue;
    }

    const mode = getNfqws2OptionArgumentMode(bareToken);
    if (mode === "unknown") {
      const reason = _("Unknown NFQWS2 flag.");
      addAnnotationIssue(annotationMap, token, reason);
      errors.push(`${token.value}: ${reason}`);
      index += 1;
      continue;
    }

    if (mode === "none") {
      if (token.value.includes("=")) {
        const reason = _("This flag does not accept a value.");
        addAnnotationIssue(annotationMap, token, reason);
        errors.push(`${token.value}: ${reason}`);
      }

      index += 1;
      continue;
    }

    if (mode === "optional") {
      if (
        nextToken &&
        !token.value.includes("=") &&
        !nextToken.value.startsWith("--")
      ) {
        const reason = _(
          "Optional values must be attached with '=' here; a separate token would be ignored by nfqws2.",
        );
        addAnnotationIssue(annotationMap, token, reason);
        addAnnotationIssue(annotationMap, nextToken, reason);
        errors.push(`${token.value} ${nextToken.value}: ${reason}`);
        index += 2;
      } else {
        index += 1;
      }

      continue;
    }

    if (!token.value.includes("=")) {
      if (!nextToken || nextToken.value.startsWith("--")) {
        const reason = _("This option requires a value.");
        addAnnotationIssue(annotationMap, token, reason);
        errors.push(`${token.value}: ${reason}`);
        index += 1;
        continue;
      }

      index += 2;
      continue;
    }

    index += 1;
  }

  if (!errors.length) {
    return { valid: true, message: "", annotations: [] };
  }

  return {
    valid: false,
    message: [getValidationHeaderText(), ...errors].join("\n"),
    annotations: finalizeAnnotations(annotationMap),
  };
}

function analyzeNfqws2Strategy(value) {
  const localAnalysis = buildNfqws2LocalAnalysis(value);
  if (!localAnalysis.valid) {
    return localAnalysis;
  }

  const remoteValidation = getCachedNfqws2RemoteValidation(value);
  if (!remoteValidation || remoteValidation.valid) {
    return localAnalysis;
  }

  const text = value ? `${value}` : "";
  const tokens = parseNfqwsRuntimeTokens(text);
  const annotationMap = new Map();

  localAnalysis.annotations.forEach((annotation) =>
    addAnnotationIssue(annotationMap, annotation, annotation.message),
  );
  addNfqwsRemoteValidationAnnotations(annotationMap, tokens, remoteValidation);

  return {
    valid: false,
    message: [getValidationHeaderText(), remoteValidation.message].join("\n"),
    annotations: finalizeAnnotations(annotationMap),
  };
}

function normalizeByedpiStrategyWhitespace(value) {
  return value ? `${value}`.replace(/\s+/g, " ").trim() : "";
}

function normalizeByedpiStrategyValue(value) {
  const normalized = normalizeByedpiStrategyWhitespace(value);
  return normalized.length ? normalized : BYEDPI_DEFAULT_CMD_OPTS;
}

function getCachedByedpiRemoteValidation(value) {
  const normalized = normalizeByedpiStrategyValue(value);
  return normalized.length
    ? byedpiRemoteValidationCache.get(normalized) || null
    : null;
}

function cacheByedpiRemoteValidation(value, result) {
  const normalized = normalizeByedpiStrategyValue(value);
  if (!normalized.length) {
    return result;
  }

  const cached = {
    valid: result && result.valid === true,
    message: result && result.message ? `${result.message}` : "",
    needle: result && result.needle ? `${result.needle}` : "",
    needles:
      result && Array.isArray(result.needles)
        ? result.needles.filter(Boolean).map((item) => `${item}`)
        : result && result.needle
          ? [`${result.needle}`]
          : [],
  };

  byedpiRemoteValidationCache.set(normalized, cached);
  return cached;
}

function buildByedpiRemoteValidationFallback(error) {
  const message =
    error && error.message
      ? `${error.message}`
      : _("Unable to validate the ByeDPI strategy through the backend parser.");

  return {
    valid: false,
    message: _("Backend validation failed: %s").format(message),
    needle: "",
    needles: [],
  };
}

function validateByedpiStrategyRemotely(value) {
  const normalized = normalizeByedpiStrategyValue(value);

  if (!normalized.length) {
    return Promise.resolve({
      valid: true,
      message: "",
      needle: "",
      needles: [],
    });
  }

  if (byedpiRemoteValidationCache.has(normalized)) {
    return Promise.resolve(byedpiRemoteValidationCache.get(normalized));
  }

  if (byedpiRemoteValidationInflight.has(normalized)) {
    return byedpiRemoteValidationInflight.get(normalized);
  }

  const validationTask = fs
    .exec(NFQWS_VALIDATION_COMMAND, [
      "validate_byedpi_strategy_json",
      normalized,
    ])
    .then((result) => {
      const payload = JSON.parse(
        (result && result.stdout ? result.stdout : "{}").trim() || "{}",
      );
      return cacheByedpiRemoteValidation(normalized, {
        valid: payload.valid === true,
        message: payload.message || "",
        needle: payload.needle || "",
        needles: Array.isArray(payload.needles)
          ? payload.needles.filter(Boolean)
          : payload.needle
            ? [payload.needle]
            : [],
      });
    })
    .catch((error) =>
      cacheByedpiRemoteValidation(
        normalized,
        buildByedpiRemoteValidationFallback(error),
      ),
    )
    .finally(() => {
      byedpiRemoteValidationInflight.delete(normalized);
    });

  byedpiRemoteValidationInflight.set(normalized, validationTask);
  return validationTask;
}

function getByedpiShortOptionName(token) {
  return token.length > 2 ? token.slice(0, 2) : token;
}

function byedpiTokenLooksLikeOption(token) {
  return /^--.+/.test(token) || /^-[A-Za-z].*/.test(token);
}

function getByedpiControlledTokenInfo(token) {
  const listenMessage = _(
    "ByeDPI listen address and port are assigned by Forkop and must not be set in the strategy.",
  );
  const transparentMessage = _(
    "Transparent proxy mode is incompatible with action=byedpi because Forkop connects to ciadpi through SOCKS.",
  );
  const daemonMessage = _(
    "Forkop manages the ciadpi process lifecycle itself, so daemon mode is not allowed here.",
  );
  const pidfileMessage = _(
    "Forkop manages ciadpi pid files itself, so pidfile options are not allowed here.",
  );
  const exitMessage = _(
    "This field must start a working ciadpi strategy; help/version options exit immediately and are not allowed here.",
  );

  if (
    token === "--ip" ||
    token.startsWith("--ip=") ||
    token === "-i" ||
    /^-i.+/.test(token) ||
    token === "--port" ||
    token.startsWith("--port=") ||
    token === "-p" ||
    /^-p.+/.test(token)
  ) {
    return {
      reason: listenMessage,
      captureNextValue:
        token === "--ip" ||
        token === "-i" ||
        token === "--port" ||
        token === "-p",
    };
  }

  if (token === "--transparent" || token === "-E" || /^-E.+/.test(token)) {
    return {
      reason: transparentMessage,
      captureNextValue: false,
    };
  }

  if (token === "--daemon" || token === "-D" || /^-D.+/.test(token)) {
    return {
      reason: daemonMessage,
      captureNextValue: false,
    };
  }

  if (
    token === "--pidfile" ||
    token.startsWith("--pidfile=") ||
    token === "-w" ||
    /^-w.+/.test(token)
  ) {
    return {
      reason: pidfileMessage,
      captureNextValue: token === "--pidfile" || token === "-w",
    };
  }

  if (
    token === "--help" ||
    token === "-h" ||
    /^-h.+/.test(token) ||
    token === "--version" ||
    token === "-v" ||
    /^-v.+/.test(token)
  ) {
    return {
      reason: exitMessage,
      captureNextValue: false,
    };
  }

  return null;
}

function validateByedpiStrategyToken(token, nextToken) {
  const controlled = getByedpiControlledTokenInfo(token);
  if (controlled) {
    return {
      valid: false,
      reason: controlled.reason,
      captureNextValue: controlled.captureNextValue,
    };
  }

  if (/^--[^=]+=/.test(token)) {
    const base = token.split("=", 1)[0];
    const value = token.slice(base.length + 1);

    if (BYEDPI_LONG_VALUE_OPTIONS.has(base)) {
      return value.length
        ? { valid: true, consumeNext: false }
        : {
            valid: false,
            reason: _("ByeDPI option requires a value: %s").format(base),
            captureNextValue: false,
          };
    }

    if (BYEDPI_LONG_FLAG_OPTIONS.has(base)) {
      return {
        valid: false,
        reason: _("ByeDPI option does not accept a value: %s").format(base),
        captureNextValue: false,
      };
    }

    return {
      valid: false,
      reason: _("Unknown ByeDPI option: %s").format(base),
      captureNextValue: false,
    };
  }

  if (/^--.+/.test(token)) {
    if (BYEDPI_LONG_VALUE_OPTIONS.has(token)) {
      return nextToken && !byedpiTokenLooksLikeOption(nextToken)
        ? { valid: true, consumeNext: true }
        : {
            valid: false,
            reason: _("ByeDPI option requires a value: %s").format(token),
            captureNextValue: false,
          };
    }

    if (BYEDPI_LONG_FLAG_OPTIONS.has(token)) {
      return { valid: true, consumeNext: false };
    }

    return {
      valid: false,
      reason: _("Unknown ByeDPI option: %s").format(token),
      captureNextValue: false,
    };
  }

  if (/^-./.test(token)) {
    if (token === "-") {
      return {
        valid: false,
        reason: _("Unexpected ByeDPI strategy argument: %s").format(token),
        captureNextValue: false,
      };
    }

    const short = getByedpiShortOptionName(token);
    const compactValue = token.slice(short.length);

    if (BYEDPI_SHORT_VALUE_OPTIONS.has(short)) {
      if (token === short) {
        return nextToken && !byedpiTokenLooksLikeOption(nextToken)
          ? { valid: true, consumeNext: true }
          : {
              valid: false,
              reason: _("ByeDPI option requires a value: %s").format(short),
              captureNextValue: false,
            };
      }

      return compactValue.length
        ? { valid: true, consumeNext: false }
        : {
            valid: false,
            reason: _("ByeDPI option requires a value: %s").format(short),
            captureNextValue: false,
          };
    }

    if (BYEDPI_SHORT_FLAG_OPTIONS.has(short)) {
      return token === short
        ? { valid: true, consumeNext: false }
        : {
            valid: false,
            reason: _(
              "ByeDPI option does not accept a compact value: %s",
            ).format(short),
            captureNextValue: false,
          };
    }

    return {
      valid: false,
      reason: _("Unknown ByeDPI option: %s").format(short),
      captureNextValue: false,
    };
  }

  return {
    valid: false,
    reason: _("Unexpected ByeDPI strategy argument: %s").format(token),
    captureNextValue: false,
  };
}

function buildByedpiLocalAnalysis(value) {
  const text = value ? `${value}` : "";
  if (!text.trim().length) {
    return {
      valid: false,
      message: _("ByeDPI strategy cannot be empty"),
      annotations: [],
    };
  }

  const tokens = parseNfqwsRuntimeTokens(text);
  const annotationMap = new Map();
  const errors = [];

  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index];
    const nextToken = tokens[index + 1] || null;
    const tokenValidation = validateByedpiStrategyToken(
      token.value,
      nextToken ? nextToken.value : null,
    );

    if (tokenValidation.valid) {
      index += tokenValidation.consumeNext ? 2 : 1;
      continue;
    }

    addAnnotationIssue(annotationMap, token, tokenValidation.reason);
    let displayToken = token.value;

    if (
      tokenValidation.captureNextValue &&
      nextToken &&
      !nextToken.value.startsWith("-")
    ) {
      addAnnotationIssue(annotationMap, nextToken, tokenValidation.reason);
      displayToken = `${displayToken} ${nextToken.value}`;
      index += 2;
    } else {
      index += 1;
    }

    errors.push(`${displayToken}: ${tokenValidation.reason}`);
  }

  if (!errors.length) {
    return { valid: true, message: "", annotations: [] };
  }

  return {
    valid: false,
    message: [getValidationHeaderText(), ...errors].join("\n"),
    annotations: finalizeAnnotations(annotationMap),
  };
}

function analyzeByedpiStrategy(value) {
  const localAnalysis = buildByedpiLocalAnalysis(value);
  if (!localAnalysis.valid) {
    return localAnalysis;
  }

  const remoteValidation = getCachedByedpiRemoteValidation(value);
  if (!remoteValidation || remoteValidation.valid) {
    return localAnalysis;
  }

  const text = value ? `${value}` : "";
  const tokens = parseNfqwsRuntimeTokens(text);
  const annotationMap = new Map();

  localAnalysis.annotations.forEach((annotation) =>
    addAnnotationIssue(annotationMap, annotation, annotation.message),
  );
  addNfqwsRemoteValidationAnnotations(annotationMap, tokens, remoteValidation);

  return {
    valid: false,
    message: [getValidationHeaderText(), remoteValidation.message].join("\n"),
    annotations: finalizeAnnotations(annotationMap),
  };
}

function configureTextareaOption(option, analyzer, remoteValidationAttacher) {
  const originalRenderWidget = option.renderWidget;

  option.renderWidget = function (section_id, option_index, cfgvalue) {
    const node = originalRenderWidget.call(
      this,
      section_id,
      option_index,
      cfgvalue,
    );
    const textarea =
      node && typeof node.querySelector === "function"
        ? node.querySelector("textarea")
        : node;

    if (textarea) {
      applyTextareaInputAttributes(textarea);
      textarea.addEventListener("input", () => {
        node.dispatchEvent(new CustomEvent("widget-change", { bubbles: true }));
      });
      if (typeof analyzer === "function") {
        attachAnnotatedTextarea(textarea, analyzer);
      }
      if (typeof remoteValidationAttacher === "function") {
        remoteValidationAttacher(this, section_id, textarea);
      }
    }

    return node;
  };
}

function getOptionTextarea(option, section_id) {
  const field =
    typeof option.map.findElement === "function"
      ? option.map.findElement("data-field", option.cbid(section_id))
      : null;

  if (field && typeof field.querySelector === "function") {
    return field.querySelector("textarea");
  }

  const elem =
    typeof option.getUIElement === "function"
      ? option.getUIElement(section_id)
      : null;
  const node = elem && elem.node ? elem.node : null;

  if (node && node.nodeName === "TEXTAREA") {
    return node;
  }

  return node && typeof node.querySelector === "function"
    ? node.querySelector("textarea")
    : null;
}

function rejectStrategyValidation(option, section_id, message) {
  const title = option.stripTags(option.title).trim();
  const error = message || option.getValidationError(section_id) || "";

  return Promise.reject(
    new TypeError(
      `${_('Option "%s" contains an invalid input value.').format(title || option.option)} ${error}`,
    ),
  );
}

function parseStrategyWithRemoteValidation(section_id, config) {
  const active = this.isActive(section_id);

  if (active) {
    if (typeof this.triggerValidation === "function") {
      this.triggerValidation(section_id);
    }

    if (!this.isValid(section_id)) {
      return rejectStrategyValidation(
        this,
        section_id,
        this.getValidationError(section_id),
      );
    }

    const cval = this.cfgvalue(section_id);
    const fval = this.formvalue(section_id);
    const cvalString = cval == null ? "" : `${cval}`;
    const fvalString = fval == null ? "" : `${fval}`;
    const shouldWrite = this.forcewrite || cvalString !== fvalString;

    if (!shouldWrite) {
      return Promise.resolve();
    }

    return config.remoteValidate(fvalString).then((result) => {
      const textarea = getOptionTextarea(this, section_id);

      if (textarea) {
        refreshAnnotatedTextareaValidation(this, section_id, textarea);
      }

      if (typeof this.triggerValidation === "function") {
        this.triggerValidation(section_id);
      }

      if (!result || result.valid !== true) {
        return rejectStrategyValidation(
          this,
          section_id,
          result && result.message ? result.message : config.invalidMessage,
        );
      }

      return Promise.resolve(this.write(section_id, fvalString));
    });
  }

  if (!this.retain) {
    return Promise.resolve(this.remove(section_id));
  }

  return Promise.resolve();
}

function parseNfqwsStrategyOnSave(section_id) {
  return parseStrategyWithRemoteValidation.call(this, section_id, {
    remoteValidate: validateNfqwsStrategyRemotely,
    invalidMessage: _(
      "Unable to validate the NFQWS strategy through the backend parser.",
    ),
  });
}

function parseNfqws2StrategyOnSave(section_id) {
  return parseStrategyWithRemoteValidation.call(this, section_id, {
    remoteValidate: validateNfqws2StrategyRemotely,
    invalidMessage: _(
      "Unable to validate the NFQWS2 strategy through the backend parser.",
    ),
  });
}

function addDynamicConditionField(section, config) {
  const o = section.taboption(
    "conditions",
    form.DynamicList,
    config.key,
    config.label,
    config.description,
  );

  o.modalonly = true;
  if (config.placeholder) {
    o.placeholder = config.placeholder;
  }
  if (config.dynamicValidate) {
    o.validate = config.dynamicValidate;
  }

  o.load = function (section_id) {
    const values = getConfigListValues(section_id, config.key);
    if (values.length) {
      return values;
    }

    const legacyText = uci.get(UCI_PACKAGE, section_id, `${config.key}_text`);
    return legacyText ? main.parseValueList(legacyText) : [];
  };

  o.write = function (section_id, value) {
    writeListOption(section_id, config.key, value);
    uci.unset(UCI_PACKAGE, section_id, `${config.key}_text`);
    uci.unset(UCI_PACKAGE, section_id, `${config.key}_text_mode`);
  };

  return o;
}

function addLocalDeviceSubnetDynamicField(section, config) {
  const o = section.taboption(
    "conditions",
    form.DynamicList,
    config.key,
    config.label,
    config.description,
  );

  o.modalonly = true;
  o.placeholder = _("Device or IP");
  o.validate = function (_section_id, value) {
    if (!value || value.length === 0) {
      return true;
    }
    if (value === localDevices.SYSTEM_DEVICE_VALUE) {
      return true;
    }

    const validation = main.validateSubnet(value);
    return validation.valid ? true : validation.message;
  };
  o.load = function (section_id) {
    const values = getConfigListValues(section_id, config.key);
    if (values.length) {
      return values;
    }

    const legacyText = uci.get(UCI_PACKAGE, section_id, `${config.key}_text`);
    return legacyText ? main.parseValueList(legacyText) : [];
  };
  o.write = function (section_id, value) {
    writeListOption(section_id, config.key, value);
    uci.unset(UCI_PACKAGE, section_id, `${config.key}_text`);
    uci.unset(UCI_PACKAGE, section_id, `${config.key}_text_mode`);
  };
  o.renderWidget = function (section_id, _option_index, cfgvalue) {
    return localDevices.createLocalDeviceDynamicListWidget(
      this,
      section_id,
      cfgvalue,
    );
  };

  return o;
}

function addTextConditionField(section, config) {
  const optionName = config.optionName || `${config.key}_text`;
  const legacyTextOptionName =
    config.legacyTextOptionName || `${config.key}_text`;
  const o = section.taboption(
    "conditions",
    form.TextValue,
    optionName,
    config.label,
    config.description,
  );

  o.rows = 8;
  o.wrap = "soft";
  o.textarea = true;
  o.modalonly = true;
  if (config.textAnalyze) {
    o.validate = function (_section_id, value) {
      const analysis = config.textAnalyze(value);
      return analysis.valid ? true : analysis.message;
    };
  } else if (config.textValidate) {
    o.validate = config.textValidate;
  }
  configureTextareaOption(o, config.textAnalyze);

  o.load = function (section_id) {
    if (typeof config.loadText === "function") {
      return config.loadText(section_id);
    }

    const textValue =
      uci.get(UCI_PACKAGE, section_id, optionName) ||
      uci.get(UCI_PACKAGE, section_id, legacyTextOptionName);
    if (textValue) {
      return valuesToText(textValue);
    }

    return valuesToText(uci.get(UCI_PACKAGE, section_id, config.key));
  };

  o.write = function (section_id, value) {
    const normalized = value ? `${value}`.trim() : "";

    if (normalized.length) {
      uci.set(UCI_PACKAGE, section_id, optionName, normalized);
    } else {
      uci.unset(UCI_PACKAGE, section_id, optionName);
    }

    if (config.key !== optionName) {
      uci.unset(UCI_PACKAGE, section_id, config.key);
    }
    if (legacyTextOptionName !== optionName) {
      uci.unset(UCI_PACKAGE, section_id, legacyTextOptionName);
    }
    uci.unset(UCI_PACKAGE, section_id, `${config.key}_text_mode`);

    if (typeof config.afterWrite === "function") {
      config.afterWrite(section_id);
    }
  };

  return o;
}

function loadRulesetValues(option) {
  delete option.keylist;
  delete option.vallist;

  Object.entries(main.DOMAIN_LIST_OPTIONS).forEach(([key, label]) => {
    option.value(key, _(label));
  });
}

function isBuiltinRulesetValue(value) {
  return Object.prototype.hasOwnProperty.call(main.DOMAIN_LIST_OPTIONS, value);
}

function validateCustomRulesetReference(value) {
  const errorMessage = _(
    "Rule set must be an HTTP(S) URL or an absolute local path",
  );
  if (!value) {
    return true;
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return main.validateUrl(value).valid ? true : errorMessage;
  }
  if (value.startsWith("/")) {
    return main.validatePath(value).valid ? true : errorMessage;
  }
  return errorMessage;
}

function getRulesetReferences(section_id) {
  return getConfigListValues(section_id, "rule_set");
}

function getBuiltInRulesetReferences(section_id) {
  const values = getConfigListValues(section_id, "community_lists").filter(
    (value) => isBuiltinRulesetValue(value),
  );

  return values.filter(
    (value, index, values) =>
      isBuiltinRulesetValue(value) && values.indexOf(value) === index,
  );
}

function getCustomRulesetReferences(section_id) {
  return uniqueDynamicListItems([
    ...getRulesetReferences(section_id).filter(
      (value) => !isBuiltinRulesetValue(value),
    ),
    ...getConfigListValues(section_id, "rule_set_with_subnets"),
  ]);
}

function writeBuiltInRulesetReferences(section_id, values) {
  const refs = normalizeDynamicListItems(values).filter((value) =>
    isBuiltinRulesetValue(value),
  );
  writeListOption(section_id, "community_lists", refs);
}

function writeCustomRulesetReferences(section_id, values) {
  const refs = uniqueDynamicListItems(values);
  if (getRuleResolvedAction(section_id) === "dns") {
    writeDnsRulesetReferences(section_id, refs);
    return;
  }
  const subnetRefs = getConfigListValues(
    section_id,
    "rule_set_with_subnets",
  ).filter((value) => refs.includes(value));
  const subnetRefSet = new Set(subnetRefs);

  writeListOption(
    section_id,
    "rule_set",
    refs.filter((value) => !subnetRefSet.has(value)),
  );
  writeListOption(section_id, "rule_set_with_subnets", subnetRefs);
  uci.unset(UCI_PACKAGE, section_id, RULE_SET_ITEM_SETTINGS_KEY);
}

function writeDnsRulesetReferences(section_id, values) {
  writeListOption(section_id, "rule_set", uniqueDynamicListItems(values));
  uci.unset(UCI_PACKAGE, section_id, "rule_set_with_subnets");
  uci.unset(UCI_PACKAGE, section_id, RULE_SET_ITEM_SETTINGS_KEY);
}

function createSectionContent(section) {
  let o;

  section.tab("settings", _("Settings"));
  section.tab("conditions", _("Conditions"));

  o = section.taboption("settings", form.Flag, "enabled", _("Enable"));
  o.default = "1";
  o.rmempty = false;
  o.editable = true;
  o.width = "6rem";

  o = section.taboption(
    "settings",
    form.DummyValue,
    "_action_display",
    _("Action"),
  );
  o.modalonly = false;
  o.rawhtml = true;
  o.cfgvalue = function (section_id) {
    return getRuleActionDisplayMarkup(section_id);
  };
  o.textvalue = function (section_id) {
    return getRuleActionDisplayValue(section_id);
  };
  o.width = "7rem";

  o = section.taboption(
    "settings",
    form.Value,
    "label",
    _("Section name"),
  );
  o.rmempty = false;
  o.modalonly = true;
  o.load = function (section_id) {
    return uci.get(UCI_PACKAGE, section_id, "label") || section_id;
  };

  o = section.taboption(
    "settings",
    form.ListValue,
    "action",
    _("Action"),
    _("What Forkop should do when this section's conditions match"),
  );
  populateActionOptionValues(o);
  o.default = "connection";
  o.rmempty = false;
  o.modalonly = true;
  o.cfgvalue = function (section_id) {
    return getRuleConfiguredAction(section_id);
  };
  o.load = function (section_id) {
    return ensureActionProvidersAvailabilityLoaded().then(() => {
      populateActionOptionValues(this);
      return this.cfgvalue(section_id);
    });
  };

  o = section.taboption(
    "settings",
    form.ListValue,
    "dns_type",
    _("DNS protocol"),
    _("DNS protocol used by the resolver"),
  );
  o.depends("action", "dns");
  dnsTypeChoices().forEach((choice) => o.value(choice.value, choice.label));
  o.default = "udp";
  o.rmempty = false;
  o.modalonly = true;

  o = section.taboption(
    "settings",
    form.Value,
    "dns_server",
    _("DNS server"),
    _("DNS server used by the resolver"),
  );
  o.depends("action", "dns");
  o.rmempty = false;
  o.modalonly = true;
  o.validate = function (_section_id, value) {
    const normalized = `${value || ""}`.trim();
    if (!normalized) {
      return _("DNS server address cannot be empty");
    }
    const validation = main.validateDNS(normalized);
    return validation.valid ? true : _("Enter a valid DNS server address");
  };

  o = section.taboption(
    "settings",
    form.Flag,
    "dns_detour_enabled",
    _("DNS through section"),
    _("Route requests to this DNS server through another section."),
  );
  o.depends("action", "dns");
  o.default = "0";
  o.rmempty = false;
  o.modalonly = true;

  o = section.taboption(
    "settings",
    form.ListValue,
    "dns_detour_section",
    _("DNS requests through section"),
  );
  o.depends({ action: "dns", dns_detour_enabled: "1" });
  o.rmempty = false;
  o.modalonly = true;
  o.load = function (section_id) {
    refreshDnsDetourSectionOptionValues(this, section_id);
    return uci.get(UCI_PACKAGE, section_id, "dns_detour_section") || "";
  };
  o.validate = function (_section_id, value) {
    return value ? true : _("Select a section");
  };

  o = section.taboption(
    "settings",
    form.TextValue,
    "nfqws_opt",
    _("NFQWS Strategy"),
  );
  o.depends("action", "zapret");
  o.rows = 6;
  o.wrap = "soft";
  o.textarea = true;
  o.modalonly = true;
  o.load = function (section_id) {
    const value = uci.get(UCI_PACKAGE, section_id, "nfqws_opt");
    if (!value || value === ZAPRET_LEGACY_DEFAULT_NFQWS_OPT) {
      return ZAPRET_DEFAULT_NFQWS_OPT;
    }

    return value;
  };
  o.write = function (section_id, value) {
    const normalized = normalizeNfqwsStrategyValue(value);
    const nextValue =
      !normalized.length || normalized === ZAPRET_LEGACY_DEFAULT_NFQWS_OPT
        ? ZAPRET_DEFAULT_NFQWS_OPT
        : normalized;

    return validateNfqwsStrategyRemotely(nextValue).then((result) => {
      if (!result || result.valid !== true) {
        throw new TypeError(
          result && result.message
            ? result.message
            : _(
                "Unable to validate the NFQWS strategy through the backend parser.",
              ),
        );
      }

      uci.set(UCI_PACKAGE, section_id, "nfqws_opt", nextValue);
    });
  };
  o.validate = function (_section_id, value) {
    const analysis = analyzeNfqwsStrategy(value);
    return analysis.valid ? true : analysis.message;
  };
  o.parse = parseNfqwsStrategyOnSave;
  configureTextareaOption(o, analyzeNfqwsStrategy, attachNfqwsRemoteValidation);

  o = section.taboption(
    "settings",
    form.TextValue,
    "nfqws2_opt",
    _("NFQWS2 Strategy"),
  );
  o.depends("action", "zapret2");
  o.rows = 6;
  o.wrap = "soft";
  o.textarea = true;
  o.modalonly = true;
  o.load = function (section_id) {
    return (
      uci.get(UCI_PACKAGE, section_id, "nfqws2_opt") ||
      ZAPRET2_DEFAULT_NFQWS2_OPT
    );
  };
  o.write = function (section_id, value) {
    const normalized = normalizeNfqws2StrategyValue(value);

    return validateNfqws2StrategyRemotely(normalized).then((result) => {
      if (!result || result.valid !== true) {
        throw new TypeError(
          result && result.message
            ? result.message
            : _("Invalid NFQWS2 strategy"),
        );
      }

      uci.set(UCI_PACKAGE, section_id, "nfqws2_opt", normalized);
    });
  };
  o.validate = function (_section_id, value) {
    const analysis = analyzeNfqws2Strategy(value);
    return analysis.valid ? true : analysis.message;
  };
  o.parse = parseNfqws2StrategyOnSave;
  configureTextareaOption(
    o,
    analyzeNfqws2Strategy,
    attachNfqws2RemoteValidation,
  );

  o = section.taboption(
    "settings",
    form.TextValue,
    "byedpi_cmd_opts",
    _("ByeDPI Strategy"),
  );
  o.depends("action", "byedpi");
  o.rows = 6;
  o.wrap = "soft";
  o.textarea = true;
  o.modalonly = true;
  o.load = function (section_id) {
    return (
      uci.get(UCI_PACKAGE, section_id, "byedpi_cmd_opts") ||
      BYEDPI_DEFAULT_CMD_OPTS
    );
  };
  o.write = function (section_id, value) {
    const normalized = normalizeByedpiStrategyValue(value);

    return validateByedpiStrategyRemotely(normalized).then((result) => {
      if (!result || result.valid !== true) {
        throw new TypeError(
          result && result.message
            ? result.message
            : _("Invalid ByeDPI strategy"),
        );
      }

      uci.set(UCI_PACKAGE, section_id, "byedpi_cmd_opts", normalized);
    });
  };
  o.validate = function (_section_id, value) {
    const analysis = analyzeByedpiStrategy(value);
    return analysis.valid ? true : analysis.message;
  };
  configureTextareaOption(o, analyzeByedpiStrategy);

  o = section.taboption(
    "settings",
    form.DynamicList,
    "selector_proxy_links",
    _("Connection URI"),
    _(
      "Supported links: vless, vmess, shadowsocks, trojan, socks, tuic, hysteria, naiveproxy, mieru",
    ),
  );
  o.depends("action", "connection");
  o.rmempty = true;
  o.modalonly = true;
  o.validate = function (_section_id, value) {
    if (!value || value.length === 0) {
      return true;
    }

    const validation = main.validateProxyUrl(value);
    return validation.valid ? true : validation.message;
  };
  o.liveDynamicListNodes = new Map();
  const originalRenderWidget = o.renderWidget;
  o.renderWidget = function (section_id, option_index, cfgvalue) {
    const node = originalRenderWidget.call(
      this,
      section_id,
      option_index,
      cfgvalue,
    );
    this.liveDynamicListNodes.set(section_id, node);
    node.addEventListener("cbi-dynlist-change", () => {
      refreshDashboardFilterChoiceWidgets(section_id);
    });
    return node;
  };
  outboundNameSourceOptions.set("selector_proxy_links", o);

  o = section.taboption(
    "settings",
    SettingsDynamicList,
    "subscription_url",
    _("Subscription"),
    _("Add a subscription provider link"),
  );
  o.depends("action", "connection");
  o.rmempty = true;
  o.modalonly = true;
  o.childType = "subscription_url";
  o.childValueOption = "url";
  o.childDefaults = Object.assign(defaultSubscriptionUrlSettings(), {
    header: () => defaultSubscriptionHeaderLines.slice(),
  });
  o.renderItemSettingsModal = showSubscriptionUrlSettingsModal;
  o.hasItemSettings = function (section_id, value) {
    const normalized = `${value || ""}`.trim();
    if (isExistingChildItem(section_id, normalized, "subscription_url")) {
      return true;
    }

    return this.validate(section_id, normalized) === true;
  };
  o.stagedChildSettings = function (section_id, value) {
    const inputValue = childItemInputValue(
      section_id,
      value,
      "subscription_url",
      "url",
    );
    const store = childPendingSettingsStore(this, section_id);
    return store[inputValue] ? Object.assign({}, store[inputValue]) : null;
  };
  o.clearStagedChildSettings = function (section_id) {
    if (this.pendingChildSettings) {
      delete this.pendingChildSettings[section_id];
    }
  };
  o.renderListItemLabel = function (section_id, itemId) {
    return childItemInputValue(section_id, itemId, "subscription_url", "url");
  };
  o.validate = validateSubscriptionUrlEntry;
  o.validate = function (section_id, value) {
    return validateSubscriptionUrlEntry(
      section_id,
      childItemInputValue(section_id, value, "subscription_url", "url"),
    );
  };

  o = section.taboption(
    "settings",
    InterfaceSettingsDynamicList,
    "interfaces",
    _("Network Interface"),
    _("Select network interface for VPN connection"),
  );
  o.depends("action", "connection");
  o.rmempty = true;
  o.modalonly = true;
  o.datatype = "netdevname";
  o.placeholder = _("Select a network interface");
  o.childType = "section_interface";
  o.childValueOption = "name";
  o.sharedPendingSettingsKey = "interfaces";
  o.childDefaults = Object.assign(defaultInterfaceSettings(), {
    display_name: (interfaceName) => interfaceName,
  });
  o.renderItemSettingsModal = showInterfaceSettingsModal;
  o.hasItemSettings = function (section_id, value) {
    const normalized = `${value || ""}`.trim();
    if (isExistingChildItem(section_id, normalized, "section_interface")) {
      return true;
    }

    return this.validate(section_id, normalized) === true;
  };
  o.stagedChildSettings = function (section_id, value) {
    const inputValue = childItemInputValue(
      section_id,
      value,
      "section_interface",
      "name",
    );
    const store = childPendingSettingsStore(this, section_id);
    return store[inputValue] ? Object.assign({}, store[inputValue]) : null;
  };
  o.clearStagedChildSettings = function (section_id) {
    clearChildPendingSettings(this, section_id);
  };
  o.onListChange = refreshDashboardFilterChoiceWidgets;
  outboundNameSourceOptions.set("interfaces", o);

  o = section.taboption(
    "settings",
    ButtonAddSettingsDynamicList,
    "tunnels",
    _("Tunnel"),
    _(
      "WireGuard, AmneziaWG, Cloudflare WARP, Tailscale, and JSON endpoint tunnels",
    ),
  );
  o.depends("action", "connection");
  o.rmempty = true;
  o.modalonly = true;
  o.addButtonLabel = _("+ Add tunnel");
  o.childType = "tunnel";
  o.ownerOption = "section";
  o.childValueOption = null;
  o.createId = () => randomTunnelId();
  o.renderItemSettingsModal = showTunnelSettingsModal;
  o.renderListItemLabel = function (section_id, value) {
    return tunnelListItemLabel(section_id, value);
  };
  o.validateItemsOnSave = validateTunnelItemsBeforeSave;
  o.validate = function (_section_id, value) {
    if (!`${value || ""}`.trim()) {
      return true;
    }
    if (!isExistingChildItem(_section_id, `${value || ""}`.trim(), "tunnel")) {
      return _("Open tunnel settings and complete the configuration");
    }
    return validateTunnelSettings(
      tunnelInitialSettings(`${value || ""}`.trim(), _section_id),
    );
  };
  o.onListChange = refreshDashboardFilterChoiceWidgets;
  o.afterMaterializeChildItems = function (_section_id, itemIds) {
    itemIds.forEach((itemId, index) => {
      uci.set(UCI_PACKAGE, itemId, "order", `${index}`);
    });
  };
  outboundNameSourceOptions.set("tunnels", o);

  o = section.taboption(
    "settings",
    ButtonAddSettingsDynamicList,
    "outbound_jsons",
    _("JSON outbound"),
    _("Custom sing-box outbound objects in JSON format"),
  );
  o.depends("action", "connection");
  o.rmempty = true;
  o.modalonly = true;
  o.addButtonLabel = _("+ Add JSON outbound");
  o.renderItemSettingsModal = showOutboundJsonSettingsModal;
  o.renderListItemLabel = function (_section_id, value) {
    return outboundJsonListItemLabel(value);
  };
  o.validateItemsOnSave = validateOutboundJsonItemsBeforeSave;
  o.validate = function (_section_id, value) {
    if (!value || value.length === 0) {
      return true;
    }

    const validation = main.validateOutboundJson(value);
    return validation.valid ? true : validation.message;
  };
  o.onListChange = refreshDashboardFilterChoiceWidgets;
  outboundNameSourceOptions.set("outbound_jsons", o);

  o = section.taboption(
    "settings",
    ButtonAddSettingsDynamicList,
    "urltest",
    _("URLTest"),
    _("Server group for automatic lowest-latency selection"),
  );
  o.depends("action", "connection");
  o.rmempty = true;
  o.modalonly = true;
  o.addButtonLabel = _("+ Add URLTest");
  o.childType = "urltest";
  o.childValueOption = "name";
  o.childDefaults = urlTestChildDefaults();
  o.renderItemSettingsModal = showUrlTestSettingsModal;
  o.validateItemsOnSave = function (section_id, values) {
    return validateUrlTestItemsBeforeSave(section_id, values, this);
  };
  o.hasItemSettings = function (section_id, value) {
    const normalized = `${value || ""}`.trim();

    if (isExistingChildItem(section_id, normalized, "urltest")) {
      return true;
    }

    return normalized.length > 0;
  };
  o.inputValueForItem = function (section_id, value) {
    const inputValue = childItemInputValue(
      section_id,
      value,
      "urltest",
      "name",
    );
    const store = childPendingSettingsStore(this, section_id);
    return store[inputValue] && store[inputValue].name
      ? store[inputValue].name
      : inputValue;
  };
  o.stagedChildSettings = function (section_id, value) {
    const id = childItemInputValue(section_id, value, "urltest", "name");
    const store = childPendingSettingsStore(this, section_id);
    return store[id] ? Object.assign({}, store[id]) : null;
  };
  o.clearStagedChildSettings = function (section_id) {
    if (this.pendingChildSettings) {
      delete this.pendingChildSettings[section_id];
    }
  };
  o.renderListItemLabel = function (section_id, itemId) {
    return E(
      "span",
      { class: "fkp-dynlist-label" },
      this.inputValueForItem(section_id, itemId),
    );
  };
  o.onListChange = refreshDashboardFilterChoiceWidgets;

  o = section.taboption(
    "settings",
    ButtonAddSettingsDynamicList,
    "fallback_group",
    _("Fallback"),
    _("Server group for ordered fallback"),
  );
  o.depends("action", "connection");
  o.rmempty = true;
  o.modalonly = true;
  o.addButtonLabel = _("+ Add fallback");
  o.childType = "fallback_group";
  o.childValueOption = "name";
  o.childDefaults = fallbackGroupChildDefaults();
  o.createId = () => randomFallbackGroupId();
  o.renderItemSettingsModal = showFallbackGroupSettingsModal;
  o.validateItemsOnSave = validateFallbackGroupItemsBeforeSave;
  o.hasItemSettings = function (section_id, value) {
    const normalized = `${value || ""}`.trim();

    if (isExistingChildItem(section_id, normalized, "fallback_group")) {
      return true;
    }

    return normalized.length > 0;
  };
  o.inputValueForItem = function (section_id, value) {
    return childItemInputValue(section_id, value, "fallback_group", "name");
  };
  o.renderListItemLabel = function (section_id, itemId) {
    return E(
      "span",
      { class: "fkp-dynlist-label" },
      this.inputValueForItem(section_id, itemId),
    );
  };
  o.onListChange = refreshDashboardFilterChoiceWidgets;

  o = section.taboption(
    "settings",
    form.Flag,
    "outbound_detour_enabled",
    _("Cascade connection"),
    _(
      "Use another section as an intermediate hop to connect to servers in this section. Does not apply to network interfaces, Tailscale, JSON outbounds, or JSON endpoints.",
    ),
  );
  o.default = "0";
  o.rmempty = false;
  o.depends("action", "connection");
  o.modalonly = true;
  o.write = function (section_id, value) {
    if (value === "1") {
      const currentValue =
        uci.get(UCI_PACKAGE, section_id, "outbound_detour_section") || "";
      const targetSections = getOutboundDetourTargetSections(section_id);
      const currentIsValid = targetSections.some(
        (targetSection) => getUciSectionName(targetSection) === currentValue,
      );
      const selectedValue = currentIsValid
        ? currentValue
        : getDefaultOutboundDetourSection(section_id);

      if (selectedValue) {
        uci.set(
          UCI_PACKAGE,
          section_id,
          "outbound_detour_section",
          selectedValue,
        );
      }
    }

    return form.Flag.prototype.write.apply(this, arguments);
  };

  o = section.taboption(
    "settings",
    form.ListValue,
    "outbound_detour_section",
    _("Connect through"),
    _("Select a transit section"),
  );
  o.rmempty = false;
  o.depends({ action: "connection", outbound_detour_enabled: "1" });
  o.modalonly = true;
  o.load = function (section_id) {
    refreshOutboundDetourSectionOptionValues(this, section_id);
    return Promise.resolve(
      uci.get(UCI_PACKAGE, section_id, "outbound_detour_section") || "",
    );
  };
  o.validate = function (section_id, value) {
    if (!value) {
      return _("Select an intermediate section");
    }
    if (value === section_id) {
      return _("Current section cannot be used as its own transit section");
    }
    return true;
  };

  o = section.taboption(
    "settings",
    form.Flag,
    "mixed_proxy_enabled",
    _("Enable Mixed Proxy"),
    _("Expose this section as a local HTTP+SOCKS proxy"),
  );
  o.default = "0";
  o.rmempty = false;
  o.depends("action", "connection");
  o.depends("action", "byedpi");
  o.depends("action", "zapret");
  o.depends("action", "zapret2");
  o.modalonly = true;

  o = section.taboption(
    "settings",
    form.Value,
    "mixed_proxy_port",
    _("Mixed Proxy Port"),
    _("Port for the local mixed proxy of this section"),
  );
  o.rmempty = false;
  o.depends({ action: "connection", mixed_proxy_enabled: "1" });
  o.depends({ action: "byedpi", mixed_proxy_enabled: "1" });
  o.depends({ action: "zapret", mixed_proxy_enabled: "1" });
  o.depends({ action: "zapret2", mixed_proxy_enabled: "1" });
  o.modalonly = true;
  o.validate = function (_section_id, value) {
    if (!value || value.length === 0) {
      return _("Port cannot be empty");
    }

    const parsed = parseInt(value, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 65535) {
      return true;
    }

    return _("Invalid port number. Must be between 1 and 65535");
  };

  o = section.taboption(
    "settings",
    form.Flag,
    "mixed_proxy_auth_enabled",
    _("Enable Mixed Proxy Authentication"),
    _("Require a username and password for the local mixed proxy"),
  );
  o.default = "0";
  o.rmempty = false;
  o.depends({ action: "connection", mixed_proxy_enabled: "1" });
  o.depends({ action: "byedpi", mixed_proxy_enabled: "1" });
  o.depends({ action: "zapret", mixed_proxy_enabled: "1" });
  o.depends({ action: "zapret2", mixed_proxy_enabled: "1" });
  o.modalonly = true;

  o = section.taboption(
    "settings",
    form.Value,
    "mixed_proxy_username",
    _("Mixed Proxy Username"),
  );
  o.rmempty = false;
  o.depends({
    action: "connection",
    mixed_proxy_enabled: "1",
    mixed_proxy_auth_enabled: "1",
  });
  o.depends({
    action: "byedpi",
    mixed_proxy_enabled: "1",
    mixed_proxy_auth_enabled: "1",
  });
  o.depends({
    action: "zapret",
    mixed_proxy_enabled: "1",
    mixed_proxy_auth_enabled: "1",
  });
  o.depends({
    action: "zapret2",
    mixed_proxy_enabled: "1",
    mixed_proxy_auth_enabled: "1",
  });
  o.modalonly = true;
  o.validate = function (_section_id, value) {
    if (!value || value.length === 0) {
      return _("Username cannot be empty");
    }

    return true;
  };

  o = section.taboption(
    "settings",
    form.Value,
    "mixed_proxy_password",
    _("Mixed Proxy Password"),
  );
  o.rmempty = false;
  o.depends({
    action: "connection",
    mixed_proxy_enabled: "1",
    mixed_proxy_auth_enabled: "1",
  });
  o.depends({
    action: "byedpi",
    mixed_proxy_enabled: "1",
    mixed_proxy_auth_enabled: "1",
  });
  o.depends({
    action: "zapret",
    mixed_proxy_enabled: "1",
    mixed_proxy_auth_enabled: "1",
  });
  o.depends({
    action: "zapret2",
    mixed_proxy_enabled: "1",
    mixed_proxy_auth_enabled: "1",
  });
  o.modalonly = true;
  o.validate = function (_section_id, value) {
    if (!value || value.length === 0) {
      return _("Password cannot be empty");
    }

    return true;
  };

  o = section.taboption(
    "settings",
    form.Flag,
    "resolve_real_ip_for_routing",
    _("Resolve real IP for routing"),
    _(
      "Resolve domain names before routing so sing-box can use real destination IPs.",
    ),
  );
  o.default = "0";
  o.rmempty = false;
  o.depends("action", "connection");
  o.modalonly = true;
  o.cfgvalue = function (section_id) {
    const value = uci.get(
      UCI_PACKAGE,
      section_id,
      "resolve_real_ip_for_routing",
    );
    if (value !== null && value !== undefined && value !== "") {
      return value;
    }

    return getRuleResolvedAction(section_id) === "byedpi" ? "1" : "0";
  };

  addTextConditionField(section, {
    key: "domain_suffix",
    optionName: "domain",
    legacyTextOptionName: "domain_suffix_text",
    label: _("Domains"),
    description: _(
      "The rule applies to the domain and all its subdomains. Use full:, keyword:, or regex: prefixes for exact match, keyword match, or regular expression.",
    ),
    textAnalyze: analyzeDomainSuffixText,
    loadText: loadCombinedDomainText,
    afterWrite: function (section_id) {
      [
        "domain_suffix",
        "domain_suffix_text",
        "domain_suffix_text_mode",
        "domain_keyword",
        "domain_regex",
        "domain_text",
        "domain_keyword_text",
        "domain_regex_text",
        "domain_text_mode",
        "domain_keyword_text_mode",
        "domain_regex_text_mode",
      ].forEach((key) => {
        uci.unset(UCI_PACKAGE, section_id, key);
      });
    },
  });

  const ipConditionOption = addTextConditionField(section, {
    key: "ip_cidr",
    optionName: "ip_cidr",
    legacyTextOptionName: "ip_cidr_text",
    label: _("IPs"),
    description: _("Match destination IPs or subnets"),
    textAnalyze: analyzeIpCidrText,
  });
  dependsOnRoutingAction(ipConditionOption);

  const builtInRulesetOption = section.taboption(
    "conditions",
    form.DynamicList,
    "community_lists",
    _("Built-in rule sets"),
    _("Select a predefined domain list"),
  );
  builtInRulesetOption.modalonly = true;
  builtInRulesetOption.placeholder = _("Service list");
  builtInRulesetOption.load = function (section_id) {
    loadRulesetValues(this);
    return getBuiltInRulesetReferences(section_id);
  };
  builtInRulesetOption.write = function (section_id, values) {
    writeBuiltInRulesetReferences(section_id, values);
  };
  builtInRulesetOption.remove = function (section_id) {
    uci.unset(UCI_PACKAGE, section_id, "community_lists");
  };

  const ruleSetOption = section.taboption(
    "conditions",
    SettingsDynamicList,
    "rule_set",
    _("Rule sets"),
    _(
      "Add a link or local path. The format is detected automatically.",
    ),
  );
  ruleSetOption.modalonly = true;
  ruleSetOption.retain = true;
  ruleSetOption.renderItemSettingsModal = showRuleSetSettingsModal;
  ruleSetOption.hasItemSettings = function (section_id) {
    return getRuleResolvedAction(section_id) !== "dns";
  };
  ruleSetOption.load = function (section_id) {
    return getCustomRulesetReferences(section_id);
  };
  ruleSetOption.write = function (section_id, value) {
    writeCustomRulesetReferences(section_id, value);
  };
  ruleSetOption.remove = function (section_id) {
    uci.unset(UCI_PACKAGE, section_id, "rule_set");
    uci.unset(UCI_PACKAGE, section_id, "rule_set_with_subnets");
    uci.unset(UCI_PACKAGE, section_id, RULE_SET_ITEM_SETTINGS_KEY);
  };
  ruleSetOption.validate = function (_section_id, value) {
    return validateCustomRulesetReference(value);
  };

  const sourceIpOption = addLocalDeviceSubnetDynamicField(section, {
    key: "source_ip_cidr",
    label: _("Device filter"),
    description: _(
      "Apply section rules only to the specified source IP addresses",
    ),
  });
  dependsOnRuleConditions(sourceIpOption);

  const fullyRoutedOption = addLocalDeviceSubnetDynamicField(section, {
    key: "fully_routed_ips",
    label: _("Forced device routing"),
    description: _(
      "All traffic from these source IP addresses will be routed through the section.",
    ),
  });
  dependsOnRoutingAction(fullyRoutedOption);
  fullyRoutedOption.depends("action", "dns");
  makeDeviceOptionsExclusive(sourceIpOption, fullyRoutedOption);

  const portsOption = addDynamicConditionField(section, {
    key: "ports",
    label: _("Ports"),
    description: _("Match destination ports. Use a single port or a range"),
    dynamicValidate: validatePortCondition,
  });
  dependsOnRoutingAction(portsOption);
}

function loadSectionTableOptions(sectionRef) {
  const sectionIds = sectionRef.cfgsections();
  const tasks = [];

  for (let i = 0; i < sectionIds.length; i += 1) {
    const sectionId = sectionIds[i];

    for (let j = 0; j < sectionRef.children.length; j += 1) {
      const option = sectionRef.children[j];

      if (option.disable || option.modalonly) {
        continue;
      }

      tasks.push(
        Promise.resolve(option.load.call(option, sectionId)).then((value) => {
          option.cfgvalue(sectionId, value);
        }),
      );
    }
  }

  return Promise.all(tasks);
}

function configureSectionSection(sectionRef, options = {}) {
  setActionProvidersAvailabilityLoader(options.loadActionProvidersAvailability);

  const handleRemove = sectionRef.handleRemove;
  sectionRef.handleRemove = function (section_id) {
    cleanupRemovedChildItems(section_id, "subscription_url", []);
    cleanupRemovedChildItems(section_id, "section_interface", []);
    cleanupRemovedChildItems(section_id, "urltest", []);
    cleanupRemovedChildItems(section_id, "fallback_group", []);
    cleanupRemovedChildItems(section_id, "tunnel", []);
    return handleRemove.apply(this, arguments);
  };

  sectionRef.load = function () {
    // The table renders only non-modal fields; the cloned Add/Edit modal loads
    // action/provider details when the user opens it.
    return Promise.all([
      loadDefaultSubscriptionHeaders(),
      loadSectionTableOptions(this),
    ]);
  };
}

function validateUniqueDynamicListItemName(widget, itemNode, value) {
  const currentLabel = itemNode?.querySelector(".fkp-dynlist-label");
  return Array.from(
    widget?.node?.querySelectorAll(".fkp-dynlist-label") || [],
  ).some(
    (label) =>
      label !== currentLabel &&
      `${label.textContent || ""}`.trim() === `${value || ""}`.trim(),
  )
    ? _("Name must be unique")
    : true;
}

const EntryPoint = {
  configureSectionSection,
  createSectionContent,
  setActionProvidersAvailabilityLoader,
};

return baseclass.extend(EntryPoint);
