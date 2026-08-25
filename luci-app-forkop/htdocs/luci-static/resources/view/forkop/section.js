"use strict";
"require form";
"require baseclass";
"require fs";
"require network";
"require ui";
"require uci";
"require view.forkop.annotations as annotate";
"require view.forkop.local_devices as localDevices";
"require view.forkop.main as main";

const UCI_PACKAGE = main.FORKOP_UCI_PACKAGE;
const RULE_SET_ITEM_SETTINGS_KEY = "rule_set_settings";
// The Sections and Servers tables are the same grid, and the user moves between
// them by clicking a tab: a name, a switch, one column naming what the row is,
// and the row actions. Only these two columns are declared - the actions column
// is sized by its buttons and the name column takes whatever is left - so these
// two values are what decides whether the columns line up across the tabs, and
// they lived apart until each table had drifted to a width of its own. The kind
// column holds the widest of either side's values, which is Shadowsocks.
const GRID_SWITCH_COLUMN_WIDTH = "6rem";
const GRID_KIND_COLUMN_WIDTH = "8rem";
const ROUTING_ACTIONS = [
  "connection",
  "proxy",
  "outbound",
  "vpn",
  "bypass",
  "block",
];
const JSON_ENDPOINT_TYPES = new Set([
  "vpn-server",
  "vpn-client",
  "wireguard",
  "amneziawg",
  "warp",
  "tailscale",
]);
// Shown greyed out in the JSON endpoint editor: the smallest object the
// validator and sing-box both accept, so the shape is read instead of
// described. The tag becomes the name the tunnel is listed under.
const JSON_ENDPOINT_PLACEHOLDER = [
  "{",
  '  "type": "wireguard",',
  '  "tag": "my-endpoint",',
  '  "address": ["10.0.0.2/32"],',
  '  "private_key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="',
  "}",
].join("\n");

// Tags sing-box already uses for Forkop's own inbounds, outbounds and DNS servers.
// A section display name becomes a tag verbatim, so these names are refused here and
// by the runtime check, which reads singbox/constants.uc. The Servers tab keeps the
// same list of its own; the contract test holds both against that table.
const RESERVED_RUNTIME_TAGS = new Set([
  "dns-server",
  "fakeip-server",
  "bootstrap-dns-server",
  "dnsmasq-server",
  "hosts-server",
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

// The servers a Connection section can reach. A URLTest or a Fallback is not one
// of them: a group only arranges the servers of its own section, so it draws its
// members from this same list. A section without any of them contributes no
// outbound and no route, and the generator leaves it out of the runtime graph
// entirely - so it is refused before it can be saved.
const CONNECTION_OUTBOUND_SOURCES = [
  "selector_proxy_links",
  "subscription_url",
  "interfaces",
  "tunnels",
  "outbound_jsons",
];

function modalOptionFormValue(modalMap, section_id, optionName) {
  const lookup =
    modalMap && typeof modalMap.lookupOption === "function"
      ? modalMap.lookupOption(optionName, section_id)
      : null;

  return lookup ? lookup[0].formvalue(lookup[1]) : null;
}

function missingConnectionOutbound(modalMap, section_id) {
  const action = modalOptionFormValue(modalMap, section_id, "action");
  if (action !== "connection") {
    return false;
  }

  return !CONNECTION_OUTBOUND_SOURCES.some(
    (optionName) =>
      normalizeDynamicListItems(
        modalOptionFormValue(modalMap, section_id, optionName),
      ).length > 0,
  );
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
      main.getOutboundTagBySection(getUciSectionLabel(section)) === detour,
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
  return target
    ? main.getOutboundTagBySection(getUciSectionLabel(target))
    : sectionId;
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

  return ["connection", "proxy", "outbound", "vpn"].includes(action);
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

// A dropdown hands back one of its own entries and nothing else. A stored section
// name it has no entry for - the section was deleted or switched off - is therefore
// replaced on save by whichever entry happens to come first, and traffic quietly leaves through a section the
// user never chose. Keeping the stored name in the list leaves the value where it
// is; the configuration check already refuses to build a config that points at a
// section it cannot use, and says which one.
function keepUnavailableSectionChoice(option, storedValue) {
  const value = `${storedValue || ""}`.trim();

  if (!value || (option.keylist || []).includes(value)) {
    return;
  }

  const target = (uci.sections(UCI_PACKAGE, "section") || []).find(
    (section) => getUciSectionName(section) === value,
  );

  option.value(
    value,
    _("%s (section is unavailable)").format(
      target ? getUciSectionLabel(target) : value,
    ),
  );
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
  ["domain", "community_lists", "rule_set", "_dns_rule_set"].forEach(
    (condition) => option.depends({ action: "dns", [condition]: /\S/ }),
  );
  return option;
}

const ANNOTATED_TEXTAREA_STYLE_ID = "fkp-annotated-textarea-styles";
const SINGLE_FIELD_MODAL_STYLE_ID = "fkp-single-field-modal-styles";
const CONNECTIONS_DYNLIST_STYLE_ID = "fkp-connections-dynlist-styles";
const outboundNameChoicesCache = new Map();
const outboundNameChoicesInflight = new Map();
const outboundNameChoicesEmptyAt = new Map();
// The runtime knows the server names of a subscription only after the core has
// fetched it, so an empty answer is not a final one. Keeping it forever leaves
// the group and dashboard filters without servers until the page is reloaded.
const OUTBOUND_NAME_CHOICES_EMPTY_TTL_MS = 5000;
const outboundNameSourceOptions = new Map();
const dashboardFilterChoiceRefreshers = new Map();
const sharedChildPendingSettings = new Map();

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
    .exec("/usr/bin/forkop", ["clash_http", "GET", "/providers/proxies", ""])
    .then((response) => {
      const transport = JSON.parse(response.stdout || "{}");
      if ((response.code ?? 0) !== 0 || transport.status !== 200) {
        throw new Error("Native provider lookup failed");
      }
      const value = JSON.parse(transport.body || "{}");
      if (
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

function readOutboundChoiceState(section_id) {
  if (!safeRuntimeSectionName(section_id)) {
    return Promise.resolve(null);
  }

  const sectionDisplayName = `${
    uci.get(UCI_PACKAGE, section_id, "label") || section_id
  }`.trim();
  return Promise.resolve({
    providerTags: getChildItemIds(section_id, "subscription_url").map(
      (itemId, index) =>
        `${sectionDisplayName}/${
          uci.get(UCI_PACKAGE, itemId, "tag") || `sub${index + 1}`
        }`,
    ),
  });
}

function cacheOutboundNameChoices(key, names) {
  outboundNameChoicesCache.set(key, names);
  if (names.length) {
    outboundNameChoicesEmptyAt.delete(key);
  } else {
    outboundNameChoicesEmptyAt.set(key, Date.now());
  }
}

function outboundNameChoicesCached(key) {
  if (!outboundNameChoicesCache.has(key)) {
    return false;
  }

  const names = outboundNameChoicesCache.get(key);
  if (Array.isArray(names) && names.length) {
    return true;
  }

  return (
    Date.now() - (outboundNameChoicesEmptyAt.get(key) || 0) <
    OUTBOUND_NAME_CHOICES_EMPTY_TTL_MS
  );
}

// providerIndex selects one subscription of the section; null takes them all.
function loadOutboundNameChoices(section_id, key, providerIndex) {
  if (outboundNameChoicesCached(key)) {
    return Promise.resolve(outboundNameChoicesCache.get(key));
  }
  if (outboundNameChoicesInflight.has(key)) {
    return outboundNameChoicesInflight.get(key);
  }
  if (providerIndex != null && providerIndex < 0) {
    return Promise.resolve([]);
  }

  const task = readOutboundChoiceState(section_id)
    .then((state) =>
      state
        ? loadNativeProviderOutboundNames(
            providerIndex == null
              ? state.providerTags
              : [state.providerTags[providerIndex]],
          )
        : null,
    )
    .then((names) => {
      if (names == null) {
        return [];
      }
      // nativeProviderOutboundNames already trimmed and deduplicated them.
      const choices = [...names].sort((a, b) => a.localeCompare(b));
      cacheOutboundNameChoices(key, choices);
      refreshDashboardFilterChoiceWidgets(section_id);
      return choices;
    })
    .catch(() => [])
    .finally(() => {
      outboundNameChoicesInflight.delete(key);
    });

  outboundNameChoicesInflight.set(key, task);

  return task;
}

function subscriptionProviderIndex(section_id, itemId) {
  return getChildItemIds(section_id, "subscription_url").indexOf(
    `${itemId || ""}`,
  );
}

function loadSectionOutboundNameChoices(section_id) {
  return loadOutboundNameChoices(section_id, section_id, null);
}

function loadSubscriptionOutboundNameChoices(section_id, itemId) {
  return loadOutboundNameChoices(
    section_id,
    `${section_id}:${itemId}`,
    subscriptionProviderIndex(section_id, itemId),
  );
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

// Junk counts and sizes reach the core as uint32, packet paddings as uint16.
const AMNEZIA_COUNT_FIELDS = ["jc", "jmin", "jmax"];
const AMNEZIA_PADDING_FIELDS = ["s1", "s2", "s3", "s4"];
const AMNEZIA_INTEGER_FIELDS = [
  ...AMNEZIA_COUNT_FIELDS,
  ...AMNEZIA_PADDING_FIELDS,
];
const AMNEZIA_SIGNATURE_FIELDS = ["i1", "i2", "i3", "i4", "i5"];
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
// Obfuscation a peer never has to know about, so it is what an endpoint whose
// peer may be a plain WireGuard implementation accepts: the WARP endpoint, whose
// peer is Cloudflare, and a wireguard tunnel to an ordinary server.
const ONE_SIDED_AMNEZIA_FIELDS = [
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
// What the Amnezia client writes for a fresh AmneziaWG 3.1 server, kept to the
// parameters a peer never has to know about: the junk counts and sizes come from
// its installer, the timings and the signature packet from its constants. Jc is
// fixed at 5, the middle of the 4 to 6 the installer draws from -- the junk is
// random content of a random size in every handshake, so rolling the count over
// three values changed nothing anyone could observe.
//
// I1 is Amnezia's own packet: a byte-correct DNS answer for icloud.com whose
// first two bytes stay random. A signature packet has to look like a protocol,
// which a random payload does not, so it is used verbatim rather than generated.
//
// They arrive with the obfuscation toggle, which exists only where there is
// nothing to transcribe. An AmneziaWG dialog is the other case: every field
// there is copied from the server's configuration, junk and signature packets
// included, and a filled-in transcription target is how a field gets skipped.
const ONE_SIDED_AMNEZIA_DEFAULTS = {
  jc: "5",
  jmin: "10",
  jmax: "50",
  i1: "<r 2><b 0x858000010001000000000669636c6f756403636f6d0000010001c00c000100010000105a00044d583737>",
  content_padding_addition: "10-100",
  rekey_after_time: "100-120",
  rekey_timeout: "3-7",
  reject_after_time: "150-180",
  keepalive_timeout: "5-15",
  max_handshake_attempts: "15-20",
};
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
    node.addEventListener("touchstart", () => this.syncSettingsButtons(node));
    node.addEventListener("touchmove", () => this.syncSettingsButtons(node));
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
      const { itemIds, resolved } = materializeChildItems(
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
      adoptMaterializedChildItems(this, section_id, resolved);
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
      // LuCI removes an option the dialog hides, and for a child item list that
      // would mean deleting the sections behind it. Only a list the user could
      // see says anything about its items: a list the dialog hid - because the
      // section is no longer a Connection, because the protocol has no accounts,
      // because authentication was switched off - was cleared by nobody. What it
      // holds cannot be typed again: an account password every device is
      // configured with, a tunnel private key, a subscription URL. The runtime
      // reads none of them in that state, and they are all there again when the
      // field that hid them goes back.
      if (this.isActive(section_id)) {
        cleanupRemovedChildItems(
          this.childOwner(section_id),
          this.childType,
          [],
          this.ownerOption,
        );
      }
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
  if (!outboundNameChoicesCached(section_id)) {
    loadSectionOutboundNameChoices(section_id);
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
  if (!outboundNameChoicesCached(cacheKey)) {
    loadSubscriptionOutboundNameChoices(section_id, itemId);
  }

  return outboundNameChoiceItems(
    outboundNameChoicesCache.get(cacheKey) || [],
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
      names.push(name || `Node #${index + 1}`);
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
  currentSourceOptionValues(section_id, "tunnels").forEach((value) => {
    const name = tunnelDisplayName(section_id, value);
    if (name) {
      names.push(name);
    }
  });
  currentSourceOptionValues(section_id, "outbound_jsons").forEach(
    (value, index) => {
      const outbound = parseOutboundJsonObject(value);
      const type = `${outbound?.type || ""}`.trim().toLowerCase();
      const tag = outboundJsonDisplayTag(value) || `JSON outbound #${index + 1}`;
      if (!["selector", "urltest", "fallback", "dns", "block"].includes(type)) {
        names.push(tag);
      }
    },
  );

  const taken = new Set();
  return names.map((name) => {
    const base = `${name || ""}`.trim();
    let unique = base;
    for (let number = 2; taken.has(unique); number += 1) {
      unique = `${base} #${number}`;
    }
    taken.add(unique);
    return unique;
  });
}

// A Fallback level can hold a URLTest group, so the picker has to follow the
// section form: a URLTest added but not saved yet is offered, and one removed
// but not saved yet is gone right away.
function currentUrlTestNameChoices(section_id) {
  const choices = [];
  const seen = new Set();
  const listOption = outboundNameSourceOptions.get("urltest");
  const store = listOption
    ? childPendingSettingsStore(listOption, section_id)
    : {};

  currentSourceOptionValues(section_id, "urltest").forEach((value) => {
    const itemValue = `${value || ""}`.trim();
    if (!itemValue) {
      return;
    }

    const staged = store[itemValue];
    const name = `${
      (staged && staged.name) ||
      childItemInputValue(section_id, itemValue, "urltest", "name") ||
      itemValue
    }`.trim();

    if (name && !seen.has(name)) {
      seen.add(name);
      choices.push({ value: name, label: name });
    }
  });

  return choices;
}

// Adding a URLTest is independent of how the level filters servers, so it sits
// above the filter instead of inside it. A level that goes direct has no
// members at all, which is the one mode where it does not belong.
function addUrlTestMemberOption(itemSection, parentSectionForItem, modes) {
  const option = itemSection.option(
    form.DynamicList,
    "include_groups",
    _("Add URLTest"),
    _("The group joins as the single node it has selected"),
  );
  modes
    .map((mode) => mode.value)
    .filter((mode) => mode !== "direct")
    .forEach((mode) => option.depends("server_filter_mode", mode));
  option.rmempty = true;
  option.placeholder = _("-- Select --");
  option.load = function (itemId) {
    const values = normalizeOptionValues(
      optionMapValue(this, itemId, "include_groups"),
    );
    refreshOptionChoices(
      this,
      currentUrlTestNameChoices(parentSectionForItem(itemId)),
    );
    return values;
  };
  configureLiveDynamicListChoices(
    option,
    (itemId) => currentUrlTestNameChoices(parentSectionForItem(itemId)),
    parentSectionForItem,
  );
  return option;
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

  return ["connection", "proxy", "outbound", "vpn"].includes(action);
}

function subscriptionDownloadTargetChoices(section_id) {
  return (uci.sections(UCI_PACKAGE, "section") || [])
    .filter((section) => isDownloadThroughTargetSection(section, section_id))
    .map((section) => ({
      value: getUciSectionName(section),
      label: getUciSectionLabel(section),
    }));
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

// The three server filter blocks - a Fallback server group, a URLTest group and a
// subscription - ask the same questions. Only the lines that name what the servers
// end up in differ, so the rest is written once and every block spreads it.
function sharedServerFilterDescriptions() {
  return {
    includeRegexDescription: _(
      "Servers whose names match the regular expression",
    ),
    // Both filter modes offer an Exclude by pattern row, and neither of them
    // needs to name what the pattern removes the servers from.
    excludeRegexDescription: _(
      "Remove servers whose names match the regular expression",
    ),
    whitelistExcludeServersDescription: _(
      "Remove servers from the selection above",
    ),
  };
}

function groupServerFilterDescriptions() {
  return Object.assign(sharedServerFilterDescriptions(), {
    includeServersDescription: _("The servers that end up in the group"),
    blacklistExcludeServersDescription: _(
      "The servers that do not end up in the group",
    ),
    excludeTypesDescription: _(
      "Servers of these protocols do not end up in the group",
    ),
  });
}

function subscriptionServerFilterDescriptions() {
  return Object.assign(sharedServerFilterDescriptions(), {
    includeServersDescription: _("The servers that are imported"),
    blacklistExcludeServersDescription: _("The servers that are not imported"),
    excludeTypesDescription: _("Servers of these protocols are not imported"),
  });
}

// "Only selected" keeps the servers the filter names, so a filter that names none
// keeps none: the generated group carries an include pattern that matches nothing.
// Without a provider the group is then dropped from the configuration, and with one
// it stays and is permanently empty, so neither is what the mode was chosen for. A
// Fallback level also counts the URLTest it includes, which is offered above the
// filter and is a member like any server.
function missingFilterSelectionMessage(modeOption, itemId) {
  if (modeOption.formvalue(itemId) !== "include") {
    return null;
  }

  return ["include_outbounds", "include_regex", "include_groups"].some(
    (optionName) =>
      normalizeDynamicListItems(
        modalOptionFormValue(modeOption.map, itemId, optionName),
      ).length > 0,
  )
    ? null
    : _("Select at least one server or set a pattern");
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
      "_blacklist_exclude_types",
      "exclude_types",
      _("Exclude types"),
      options.excludeTypesDescription,
      null,
      ["exclude"],
    ],
    [
      "_blacklist_exclude_regex",
      "exclude_regex",
      _("Exclude by pattern"),
      options.excludeRegexDescription,
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
      "_whitelist_exclude_types",
      "exclude_types",
      _("Exclude types"),
      options.excludeTypesDescription,
      null,
      ["include"],
    ],
    [
      "_whitelist_exclude_regex",
      "exclude_regex",
      _("Exclude by pattern"),
      options.excludeRegexDescription,
      validateRegex,
      ["include"],
    ],
  ].forEach(
    ([key, storageKey, label, description, validator, visibleModes]) => {
      const isList =
        storageKey.endsWith("_outbounds") || storageKey === "exclude_types";
      const field = itemSection.option(
        isList ? form.DynamicList : form.Value,
        key,
        label,
        description,
      );
      (visibleModes || []).forEach((mode) =>
        field.depends("server_filter_mode", mode),
      );
      field.rmempty = true;
      if (key !== storageKey) {
        field.ucioption = storageKey;
        field.retain = true;
        const mode = (visibleModes || [])[0];
        if (mode) {
          if (!sharedFields[mode]) {
            sharedFields[mode] = {};
          }
          sharedFields[mode][storageKey] = field;
        }
      }
      if (storageKey === "exclude_types") {
        const choices = options.groupContext
          ? groupTypeChoices()
          : providerTypeChoices();
        field.load = function (itemId) {
          const values = normalizeOptionValues(
            optionMapValue(this, itemId, storageKey),
          );
          refreshOptionChoices(this, choices);
          return values;
        };
        field.placeholder = _("-- Select --");
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
            loadSectionOutboundNameChoices(sectionId);
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

  const modeOptionParse = modeOption.parse;
  modeOption.parse = function (itemId) {
    const message = missingFilterSelectionMessage(this, itemId);
    if (message) {
      return Promise.reject(new TypeError(message));
    }

    return modeOptionParse.apply(this, arguments);
  };

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

function validateExpectedStatus(value) {
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

function remoteSubscriptionUrlSettingsKeys() {
  return [
    "subscription_update_enabled",
    "subscription_update_interval",
    "download_via_proxy_enabled",
    "download_via_proxy_section",
    "header",
    "show_dashboard_metadata",
  ];
}

function subscriptionUrlSettingsKeys(remote = true) {
  const keys = [
    "show_subscription_name",
    "tag",
    "server_filter_mode",
    "include_outbounds",
    "include_regex",
    "exclude_outbounds",
    "exclude_types",
    "exclude_regex",
    ...subscriptionOverrideKeys(),
  ];
  return remote ? [...remoteSubscriptionUrlSettingsKeys(), ...keys] : keys;
}

function cleanupRemoteSubscriptionUrlSettings(itemId) {
  remoteSubscriptionUrlSettingsKeys().forEach((key) =>
    uci.unset(UCI_PACKAGE, itemId, key),
  );
}

// A value here is only sound for an option the dialog either shows or keeps: a
// hidden field without retain is removed from the section when the dialog is
// saved, so seeding one would make the stored item something its own dialog
// never writes, and opening it and pressing Save without a change would delete
// the value again.
function defaultSubscriptionUrlSettings(
  headers = [],
  tag = "sub1",
  remote = true,
) {
  const settings = {
    show_subscription_name: "0",
    tag,
    server_filter_mode: "all",
  };
  if (remote) {
    Object.assign(settings, {
      subscription_update_enabled: "1",
      subscription_update_interval: "1h",
      download_via_proxy_enabled: "0",
      header: Array.isArray(headers) ? headers.slice() : [],
      show_dashboard_metadata: "1",
    });
  }
  return settings;
}

function configuredSubscriptionTags(sectionId, option, excludedItemId, excludedInputValue) {
  const result = [];
  getChildItemIds(sectionId, "subscription_url").forEach((itemId) => {
    if (itemId !== excludedItemId) {
      const value = `${uci.get(UCI_PACKAGE, itemId, "tag") || ""}`.trim();
      if (value) result.push(value);
    }
  });
  const store = childPendingSettingsStore(option, sectionId);
  Object.entries(store).forEach(([inputValue, settings]) => {
    if (inputValue !== excludedInputValue) {
      const value = `${settings?.tag || ""}`.trim();
      if (value) result.push(value);
    }
  });
  return result;
}

function nextSubscriptionTag(sectionId, option) {
  const taken = new Set(configuredSubscriptionTags(sectionId, option));
  for (let number = 1; number < 100000; number += 1) {
    const value = `sub${number}`;
    if (!taken.has(value)) return value;
  }
  return `sub${Date.now()}`;
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

function subscriptionOverrideKeys() {
  return [
    "override_prefix",
    "override_suffix",
    "override_rename",
    "override_patch",
  ];
}

// Shown greyed out in the JSON field of the server parameters dialog: a scalar
// and a nested object, so the shape of a merge is read instead of described.
const OVERRIDE_PATCH_PLACEHOLDER = [
  "{",
  '  "packet_encoding": "xudp",',
  '  "tls": {',
  '    "utls": {',
  '      "enabled": true,',
  '      "fingerprint": "chrome"',
  '    }',
  '  }',
  "}",
].join("\n");

// Parameters the section owns rather than the subscription, mirroring
// RESERVED_OVERRIDE_PATCH_PATHS in the backend.
function reservedOverridePatchPaths() {
  return ["detour"];
}

function reservedOverridePatchPath(document) {
  return reservedOverridePatchPaths().find((path) => {
    let node = document;
    for (const segment of path.split(".")) {
      if (!node || typeof node !== "object" || Array.isArray(node)) {
        return false;
      }
      node = node[segment];
    }
    return node !== undefined && node !== null;
  });
}

// A rename rule carries spaces, so a value that arrives as a single string is
// one rule: splitting it the way a word list is split would shatter it.
function subscriptionRenameLines(value) {
  const lines = Array.isArray(value) ? value : value ? [value] : [];
  return lines.map((line) => `${line ?? ""}`.trim()).filter(Boolean);
}

// Go reads a group reference as far as the letters, digits and underscores
// behind it go, so $1x asks for a group named "1x" and leaves nothing in its
// place. ${1} ends the number instead. $$ is a literal dollar sign and never
// starts a reference.
function validateRenameReplacement(replacement) {
  return /\$[0-9]+[A-Za-z_]/.test(`${replacement}`.replace(/\$\$/g, ""))
    ? _("Write ${1} instead of $1 when a letter follows the group number")
    : true;
}

function showSubscriptionOverrideModal(parentMap, itemId) {
  const read = (key) => parentMap.data.get(parentMap.config, itemId, key);
  const settings = {};
  subscriptionOverrideKeys().forEach((key) => {
    settings[key] =
      key === "override_rename"
        ? subscriptionRenameLines(read(key))
        : `${read(key) ?? ""}`;
  });

  const data = { settings };
  const map = new form.JSONMap(data);
  const itemSection = map.section(form.NamedSection, "settings");
  itemSection.anonymous = true;
  itemSection.addremove = false;

  let o = itemSection.option(
    form.Value,
    "override_prefix",
    _("Name prefix"),
    _("Added in front of every server name"),
  );
  o.rmempty = true;

  o = itemSection.option(
    form.Value,
    "override_suffix",
    _("Name suffix"),
    _("Added after every server name"),
  );
  o.rmempty = true;

  o = itemSection.option(
    form.DynamicList,
    "override_rename",
    _("Rename servers"),
    _(
      "One rule per line: pattern => replacement, applied in order. The pattern is a regular expression, $1 in the replacement keeps a captured group and ${1} keeps it in front of a letter. Example: ^HK-(.*)$ => Hong Kong $1",
    ),
  );
  o.rmempty = true;
  o.validate = function (_sectionId, value) {
    const normalized = `${value || ""}`.trim();
    if (!normalized) {
      return true;
    }
    // The first separator wins, so a replacement may contain one itself.
    const separator = normalized.indexOf("=>");
    if (separator < 0) {
      return _("Use the pattern => replacement form");
    }
    const pattern = normalized.slice(0, separator).trim();
    if (!pattern) {
      return _("Enter a regular expression before =>");
    }
    const patternError = validateRegex(null, pattern);
    if (patternError !== true) {
      return patternError;
    }
    return validateRenameReplacement(normalized.slice(separator + 2).trim());
  };

  const patchOption = itemSection.option(
    form.TextValue,
    "override_patch",
    "JSON",
    _(
      "A JSON object merged into every server. Parameters a server does not support are skipped, matching parameters are overwritten",
    ),
  );
  patchOption.placeholder = OVERRIDE_PATCH_PLACEHOLDER;
  // One line more than the placeholder, so the example never scrolls.
  patchOption.rows = 10;
  patchOption.wrap = "soft";
  patchOption.textarea = true;
  patchOption.rmempty = true;
  patchOption.validate = function (_sectionId, value) {
    const normalized = `${value || ""}`.trim();
    if (!normalized) {
      return true;
    }
    let parsed;
    try {
      parsed = JSON.parse(normalized);
    } catch (_error) {
      return _("Enter a valid JSON object");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return _("Enter a valid JSON object");
    }
    const reserved = reservedOverridePatchPath(parsed);
    if (reserved) {
      return _("%s is set by the cascade connection of the section").format(
        reserved,
      );
    }
    return true;
  };
  configureTextareaOption(patchOption);

  return renderStackedJsonSettingsModal(
    _("Server parameters"),
    map,
    (saved) => {
      subscriptionOverrideKeys().forEach((key) => {
        const value =
          key === "override_rename"
            ? subscriptionRenameLines(saved[key])
            : `${saved[key] ?? ""}`.trim();
        if (value.length) {
          parentMap.data.set(parentMap.config, itemId, key, value);
        } else {
          parentMap.data.unset(parentMap.config, itemId, key);
        }
      });
    },
  );
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
    _("Headers"),
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

  return renderStackedJsonSettingsModal(_("Headers"), map, () => {
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
    "domain_resolver_dns_server",
    "domain_resolver_dns_fallback_strategy",
    "domain_resolver_dns_detour_enabled",
    "domain_resolver_dns_detour_section",
  ];
}

// Everything the resolver dialog hides behind the Domain Resolver flag is left
// out: those options carry their default in the form and mean the same by their
// absence in the configuration, and seeding one would only be deleted again the
// first time the dialog is saved.
function defaultInterfaceSettings(displayName = "") {
  return {
    display_name: displayName,
    domain_resolver_enabled: "0",
  };
}

// The protocols a subscription can deliver, mirroring
// FILTERABLE_PROVIDER_TYPES in the backend. sing-box builds provider nodes from
// outbounds only, so endpoint protocols never appear here.
function providerTypeChoices() {
  return [
    ["vless", "VLESS"],
    ["vmess", "VMess"],
    ["trojan", "Trojan"],
    ["shadowsocks", "Shadowsocks"],
    ["hysteria2", "Hysteria2"],
    ["hysteria", "Hysteria"],
    ["tuic", "TUIC"],
    ["anytls", "AnyTLS"],
    ["naive", "NaiveProxy"],
    ["mieru", "Mieru"],
    ["snell", "Snell"],
    ["shadowtls", "ShadowTLS"],
    ["sudoku", "Sudoku"],
    ["trusttunnel", "TrustTunnel"],
    ["masque", "MASQUE"],
    ["openvpn", "OpenVPN"],
    ["ssh", "SSH"],
    ["tor", "Tor"],
    ["socks", "SOCKS"],
    ["http", "HTTP"],
  ].map(([value, label]) => ({ value, label }));
}

// A group also holds the servers a section configures itself, which is the only
// way a tunnel or a network interface becomes a member. sing-box has no
// AmneziaWG protocol, so Forkop resolves it from the WireGuard endpoint that
// carries an amnezia block.
function groupTypeChoices() {
  return [
    ...providerTypeChoices(),
    ...[
      ["wireguard", "WireGuard"],
      ["amneziawg", "AmneziaWG"],
      ["warp", "WARP"],
      ["tailscale", "Tailscale"],
      ["direct", _("Network interface")],
    ].map(([value, label]) => ({ value, label })),
  ];
}

function urlTestSettingsKeys() {
  return [
    "name",
    "check_interval",
    "tolerance",
    "testing_url",
    "expected_status",
    "idle_timeout",
    "interrupt_exist_connections",
    "hide_dashboard_members",
    "server_filter_mode",
    "include_outbounds",
    "include_regex",
    "exclude_outbounds",
    "exclude_types",
    "exclude_regex",
  ];
}

function urlTestChildDefaults() {
  return {
    check_interval: "3m",
    tolerance: "50",
    testing_url: "https://www.gstatic.com/generate_204",
    expected_status: "*",
    idle_timeout: "30m",
    interrupt_exist_connections: "0",
    hide_dashboard_members: "0",
    server_filter_mode: "all",
  };
}

function defaultUrlTestSettings(name) {
  return { name: `${name || ""}`, ...urlTestChildDefaults() };
}

function fallbackGroupSettingsKeys() {
  return [
    "name",
    "health_check_url",
    "health_check_interval",
    "health_check_timeout",
    "attempt_timeout",
    "expected_status",
    "idle_timeout",
    "interrupt_exist_connections",
    "hide_dashboard_members",
  ];
}

function fallbackGroupChildDefaults() {
  return {
    health_check_url: "https://www.gstatic.com/generate_204",
    health_check_interval: "5m",
    health_check_timeout: "5s",
    attempt_timeout: "5s",
    expected_status: "*",
    idle_timeout: "5m",
    interrupt_exist_connections: "0",
    hide_dashboard_members: "0",
  };
}

function defaultFallbackGroupSettings(name = "") {
  return { name, ...fallbackGroupChildDefaults() };
}

function fallbackLevelSettingsKeys() {
  return [
    "name",
    "order",
    "server_filter_mode",
    "include_outbounds",
    "include_groups",
    "include_regex",
    "exclude_outbounds",
    "exclude_types",
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

// A section id stays in the config for good, so it names the type it belongs to.
// LuCI's createSID() is not that name: its "new" prefix marks a section the browser
// has not saved yet, and handing it to add() as an explicit name writes that marker
// to /etc/config/forkop forever. Every section gets an id, including the children
// nothing points at, because an anonymous one can only be addressed as @type[index]:
// libuci numbers those by position across the whole file, so the address of a client
// moves when a client of another server is removed and a stored command then edits
// the wrong section. The suffix is random rather than the lowest free number, because
// a number given back after a delete would quietly rebind a stale pointer:
// dns_detour_section and the other section references are not cleared when their
// target is removed. Each view that creates a section carries this helper, because a
// name imported across two views is undefined in a browser that cached one of them
// before an app upgrade.
const SECTION_ID_PREFIXES = {
  fallback_group: "group",
  fallback_level: "level",
  section: "section",
  section_interface: "iface",
  server: "server",
  server_client: "client",
  subscription_url: "sub",
  tunnel: "tunnel",
  tunnel_peer: "peer",
  urltest: "urltest",
};
const issuedSectionIds = new Set();

function nextSectionId(typeName) {
  const prefix = SECTION_ID_PREFIXES[typeName] || typeName;

  for (let i = 0; i < 100; i += 1) {
    const id = `${prefix}_${Math.floor(Math.random() * 0x1000000)
      .toString(16)
      .padStart(6, "0")}`;

    // A staged child reaches uci only when its parent is saved, so an id handed out
    // earlier in the same dialog is not visible through uci.get() yet.
    if (!issuedSectionIds.has(id) && !uci.get(UCI_PACKAGE, id)) {
      issuedSectionIds.add(id);
      return id;
    }
  }

  return `${prefix}_${Date.now().toString(16)}`;
}

function addSubscriptionUrlItemOptions(itemSection, options = {}) {
  const parentSectionForItem =
    typeof options.parentSectionId === "function"
      ? options.parentSectionId
      : parentSectionIdForItem;

  let o;
  if (options.remote !== false) {
    o = itemSection.option(
      form.Flag,
      "subscription_update_enabled",
      _("Subscription auto update"),
    );
    o.default = "1";
    o.rmempty = false;

    o = itemSection.option(
      form.Value,
      "subscription_update_interval",
      _("Update interval"),
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
      _("Request the subscription through a section"),
    );
    o.default = "0";
    o.rmempty = false;

    o = itemSection.option(
      form.ListValue,
      "download_via_proxy_section",
      _("Request through"),
    );
    o.depends("download_via_proxy_enabled", "1");
    o.load = function (itemId) {
      const sectionId = parentSectionForItem(itemId);
      refreshOptionChoices(this, subscriptionDownloadTargetChoices(sectionId));
      const value =
        optionMapValue(this, itemId, "download_via_proxy_section") || "";
      keepUnavailableSectionChoice(this, value);
      return value;
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
      form.Button,
      "_subscription_headers",
      _("Headers"),
      _("Change the HTTP headers of the request"),
    );
    o.inputtitle = _("Edit");
    o.inputstyle = "edit";
    o.onclick = function () {
      return showSubscriptionHeadersModal(itemSection.map, "settings");
    };

    o = itemSection.option(
      form.Flag,
      "show_dashboard_metadata",
      _("Show metadata"),
      _("Show the metadata block on the dashboard"),
    );
    o.default = "1";
    o.rmempty = false;
  }

  o = itemSection.option(
    form.Flag,
    "show_subscription_name",
    _("Add tag"),
    _("Adds the tag to its nodes and metadata on the dashboard"),
  );
  o.default = "0";
  o.rmempty = false;

  o = itemSection.option(form.Value, "tag", _("Tag"));
  o.depends("show_subscription_name", "1");
  o.rmempty = false;
  // The tag names the subscription's provider whether or not it is added to the
  // node names, so it is in effect even while this field is hidden and must
  // survive a save that does not show it.
  o.retain = true;
  o.validate = function (_itemId, value) {
    const normalized = `${value || ""}`.trim();
    if (!normalized) return _("Enter a subscription tag");
    if (normalized.includes("/")) {
      return _("Subscription tag must not contain /");
    }
    const sectionId = parentSectionForItem(_itemId);
    const ownerId = typeof options.ownerId === "function" ? options.ownerId() : "";
    const inputValue =
      typeof options.itemValue === "function" ? options.itemValue() : "";
    return configuredSubscriptionTags(
      sectionId,
      options.listOption,
      ownerId === sectionId ? "" : ownerId,
      inputValue,
    ).includes(normalized)
      ? _("Subscription tag must be unique within the section")
      : true;
  };

  o = itemSection.option(
    form.Button,
    "_subscription_override",
    _("Server parameters"),
    _("Change the parameters of the servers this subscription adds"),
  );
  o.inputtitle = _("Edit");
  o.inputstyle = "edit";
  o.onclick = function () {
    return showSubscriptionOverrideModal(itemSection.map, "settings");
  };

  addServerFilterOptions(itemSection, parentSectionForItem, {
    ownerId: options.ownerId,
    modeLabel: _("Server filter"),
    modeDescription: _("Which servers to import"),
    modes: [
      { value: "all", label: _("All servers") },
      { value: "exclude", label: _("All except selected") },
      { value: "include", label: _("Only selected") },
    ],
    ...subscriptionServerFilterDescriptions(),
  });
}

function addInterfaceItemOptions(itemSection, options = {}) {
  const parentSectionForItem =
    typeof options.parentSectionId === "function"
      ? options.parentSectionId
      : parentSectionIdForItem;

  let o = itemSection.option(form.Value, "display_name", _("Interface name"));
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

  const dnsServerOption = itemSection.option(
    form.DynamicList,
    "domain_resolver_dns_server",
    _("DNS Server"),
    _(
      "Several servers give automatic failover. The protocol is set by a prefix: udp://, tcp://, tls://, https://, quic://, h3://",
    ),
  );
  // No address is proposed: a resolver that silently defaults to a public server
  // is a DNS choice made for the user.
  dnsServerOption.depends("domain_resolver_enabled", "1");
  dnsServerOption.rmempty = false;
  dnsServerOption.validate = function (itemId, value) {
    if (optionMapValue(this, itemId, "domain_resolver_enabled") !== "1") {
      return true;
    }
    const normalized = `${value || ""}`.trim();
    if (!normalized) {
      return L.toArray(this.formvalue(itemId)).some((item) =>
        `${item || ""}`.trim(),
      )
        ? true
        : _("Add at least one DNS server");
    }
    const validation = main.validateDNS(normalized);
    return validation.valid ? true : validation.message;
  };

  const dnsQueryModeOption = itemSection.option(
    form.ListValue,
    "domain_resolver_dns_fallback_strategy",
    _("DNS Query Mode"),
    _(
      "Parallel asks every server at once and is faster. Sequential asks them in turn until the first answer",
    ),
  );
  dnsQueryModeOption.value("parallel", _("Parallel"));
  dnsQueryModeOption.value("sequential", _("Sequential"));
  dnsQueryModeOption.default = "parallel";
  dnsQueryModeOption.rmempty = false;
  dnsQueryModeOption.retain = true;
  dnsQueryModeOption.depends({
    domain_resolver_enabled: "1",
    domain_resolver_dns_server: "__forkop_multiple_dns__",
  });
  dnsQueryModeOption.checkDepends = function (itemId) {
    const enabledOption = this.map.lookupOption(
      "domain_resolver_enabled",
      itemId,
    );
    const serverOption = this.map.lookupOption(
      "domain_resolver_dns_server",
      itemId,
    );
    const enabled = enabledOption?.[0].formvalue(enabledOption[1]);
    const servers = serverOption?.[0].formvalue(serverOption[1]);
    return enabled === "1" && normalizeDynamicListItems(servers).length > 1;
  };
  const originalDnsServerRenderWidget = dnsServerOption.renderWidget;
  dnsServerOption.renderWidget = function (itemId, option_index, cfgvalue) {
    const node = originalDnsServerRenderWidget.call(
      this,
      itemId,
      option_index,
      cfgvalue,
    );
    node.addEventListener("cbi-dynlist-change", () => {
      this.map.checkDepends();
    });
    return node;
  };

  o = itemSection.option(
    form.Flag,
    "domain_resolver_dns_detour_enabled",
    _("DNS through section"),
    _(
      "Route the resolver's DNS requests through a section instead of this network interface",
    ),
  );
  o.depends("domain_resolver_enabled", "1");
  o.default = "0";
  o.rmempty = false;

  o = itemSection.option(
    form.ListValue,
    "domain_resolver_dns_detour_section",
    _("DNS requests through"),
  );
  o.depends({
    domain_resolver_enabled: "1",
    domain_resolver_dns_detour_enabled: "1",
  });
  o.rmempty = false;
  o.load = function (itemId) {
    refreshDnsDetourSectionOptionValues(this, parentSectionForItem(itemId));
    const value = optionMapValue(
      this,
      itemId,
      "domain_resolver_dns_detour_section",
    );
    keepUnavailableSectionChoice(this, value);
    return value;
  };
  o.validate = function (itemId, value) {
    if (
      optionMapValue(this, itemId, "domain_resolver_enabled") !== "1" ||
      optionMapValue(this, itemId, "domain_resolver_dns_detour_enabled") !== "1"
    ) {
      return true;
    }
    return value ? true : _("Select a section");
  };
}

function addUrlTestItemOptions(itemSection, options = {}) {
  const parentSectionForItem =
    typeof options.parentSectionId === "function"
      ? options.parentSectionId
      : parentSectionIdForItem;

  let o = itemSection.option(form.Value, "name", _("Group name"));
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
    "testing_url",
    _("Check URL"),
    _("Latency measurement for every server"),
  );
  o.default = "https://www.gstatic.com/generate_204";
  o.rmempty = false;
  urlTestUrlChoices().forEach((value) => o.value(value));
  o.validate = function (_itemId, value) {
    return validateUrlTestUrl(value);
  };

  o = itemSection.option(
    form.Value,
    "expected_status",
    _("Expected status"),
    _(
      "HTTP status codes of a successful check. * is any response, or values and ranges: 204/200-299",
    ),
  );
  o.default = "*";
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateExpectedStatus(value);
  };

  o = itemSection.option(
    form.Value,
    "check_interval",
    _("Check interval"),
    _("How often every server of the group is checked"),
  );
  o.default = "3m";
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateRequiredSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Value,
    "tolerance",
    _("Latency difference"),
    _("Switching threshold in ms at which to move to a faster server"),
  );
  o.default = "50";
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateUrlTestTolerance(value);
  };

  o = itemSection.option(
    form.Value,
    "idle_timeout",
    _("Idle timeout"),
    _("How long until health checks stop when the group is unused"),
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
    _("Drop every active connection when the selected server changes"),
  );
  o.default = "0";
  o.rmempty = false;

  o = itemSection.option(
    form.Flag,
    "hide_dashboard_members",
    _("Hide group servers"),
    _("Hide servers included in this group from the dashboard"),
  );
  o.default = "0";
  o.rmempty = false;

  addServerFilterOptions(itemSection, parentSectionForItem, {
    groupContext: true,
    modeLabel: _("Server filter"),
    modeDescription: _("Which servers end up in the group"),
    modes: [
      { value: "all", label: _("All servers") },
      { value: "exclude", label: _("All except selected") },
      { value: "include", label: _("Only selected") },
    ],
    ...groupServerFilterDescriptions(),
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
    return _("Add at least one server group");
  }

  const names = new Set();
  for (const value of normalizedValues) {
    const levelId = `${value || ""}`;
    const settings = fallbackLevelSettingsForValidation(
      groupId,
      levelId,
      option,
    );

    if (!`${settings.name || ""}`.trim()) {
      return _("Enter a server group name");
    }
    const name = `${settings.name}`.trim();
    if (names.has(name)) return _("Server group names must be unique");
    names.add(name);
  }

  return true;
}

function addFallbackLevelItemOptions(itemSection, options = {}) {
  const parentSectionForItem =
    typeof options.parentSectionId === "function"
      ? options.parentSectionId
      : parentSectionIdForItem;

  let o = itemSection.option(form.Value, "name", _("Group name"));
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    if (!`${value || ""}`.trim()) return _("Enter a server group name");
    return typeof options.validateName === "function"
      ? options.validateName(value)
      : true;
  };

  const fallbackLevelModes = [
    { value: "all", label: _("All remaining") },
    { value: "exclude", label: _("All except selected") },
    { value: "include", label: _("Only selected") },
    { value: "direct", label: _("Direct") },
  ];
  addUrlTestMemberOption(itemSection, parentSectionForItem, fallbackLevelModes);

  addServerFilterOptions(itemSection, parentSectionForItem, {
    modeLabel: _("Server filter"),
    modeDescription: _("Which servers end up in the group"),
    modes: fallbackLevelModes,
    defaultMode: "include",
    groupContext: true,
    ...groupServerFilterDescriptions(),
  });
}

function addFallbackGroupItemOptions(itemSection, options = {}) {
  const parentSectionForGroup =
    typeof options.parentSectionId === "function"
      ? options.parentSectionId
      : parentSectionIdForItem;
  const ownerId =
    typeof options.ownerId === "function" ? options.ownerId : () => "";

  let o = itemSection.option(form.Value, "name", _("Group name"));
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
    _("Availability check for every server"),
  );
  o.default = "https://www.gstatic.com/generate_204";
  o.rmempty = false;
  urlTestUrlChoices().forEach((value) => o.value(value));
  o.validate = function (_itemId, value) {
    return validateUrlTestUrl(value);
  };

  o = itemSection.option(
    form.Value,
    "expected_status",
    _("Expected status"),
    _(
      "HTTP status codes of a successful check. * is any response, or values and ranges: 204/200-299",
    ),
  );
  o.default = "*";
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateExpectedStatus(value);
  };

  o = itemSection.option(
    form.Value,
    "health_check_interval",
    _("Check interval"),
    _("How often every server of the group is checked"),
  );
  o.default = "5m";
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateRequiredSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Value,
    "health_check_timeout",
    _("Check timeout"),
    _("How long to wait for a server to answer"),
  );
  o.default = "5s";
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateRequiredSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Value,
    "attempt_timeout",
    _("Connection timeout"),
    _("How long to wait for a connection before moving to the next server"),
  );
  o.default = "5s";
  o.rmempty = false;
  o.validate = function (_itemId, value) {
    return validateRequiredSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Value,
    "idle_timeout",
    _("Idle timeout"),
    _("How long until health checks stop when the group is unused"),
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
    _("Drop every active connection when the selected server changes"),
  );
  o.default = "0";
  o.rmempty = false;

  o = itemSection.option(
    form.Flag,
    "hide_dashboard_members",
    _("Hide group servers"),
    _("Hide servers included in this group from the dashboard"),
  );
  o.default = "0";
  o.rmempty = false;

  o = itemSection.option(
    ButtonAddSettingsDynamicList,
    "fallback_level",
    _("Server groups"),
    _("Required. Checked from top to bottom until the first working server"),
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
  o.createId = () => nextSectionId("fallback_level");
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
        : _("Add at least one server group");
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

// A dialog that edits one text field: the modal heading already names it, so the
// row drops its label and gives the whole width to the editor.
const SINGLE_FIELD_MODAL_CLASS = "fkp-single-field-modal";

function ensureSingleFieldModalStyles() {
  if (
    typeof document === "undefined" ||
    !document.head ||
    document.getElementById(SINGLE_FIELD_MODAL_STYLE_ID)
  ) {
    return;
  }

  document.head.insertAdjacentHTML(
    "beforeend",
    `<style id="${SINGLE_FIELD_MODAL_STYLE_ID}">
      .${SINGLE_FIELD_MODAL_CLASS} .cbi-value-title {
        display: none;
      }

      .${SINGLE_FIELD_MODAL_CLASS} .cbi-value-field {
        width: 100%;
        max-width: 100%;
        flex: 1 1 auto;
        float: none;
        padding-left: 0;
        margin-left: 0;
      }

      .${SINGLE_FIELD_MODAL_CLASS} .cbi-value {
        margin-bottom: 0;
      }
    </style>`,
  );
}

function renderStackedJsonSettingsModal(title, map, onSave, options = {}) {
  const modal = document.querySelector("#modal_overlay > .modal.cbi-modal");
  const activeMap = modal ? modal.querySelector(".cbi-map:not(.hidden)") : null;
  const buttonRow = modal ? modal.querySelector("div.button-row") : null;
  const heading = modal ? modal.querySelector("h4") : null;

  if (!modal || !activeMap || !buttonRow || !heading) {
    return Promise.resolve();
  }

  return map.render().then((nodes) => {
    if (options.singleField) {
      ensureSingleFieldModalStyles();
      nodes.classList.add(SINGLE_FIELD_MODAL_CLASS);
    }

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
        options.saveLabel || _("Save"),
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
        // A pending item is stored under its display value, so an item that is
        // still being added has nothing to restore and must use fresh defaults
        // instead of the state a dismissed modal left behind.
        inputValue
          ? pendingChildSettings(option, section_id, inputValue, defaults)
          : defaults,
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
    itemValue: () => inputValue,
    listOption: option,
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
        // A draft item is identified by its display value, so the list item has
        // to follow the rename to keep pointing at its staged settings.
        setDynamicListItemValue(settings.itemNode, nextInputValue);
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
  const source = childItemInputValue(
    _section_id,
    itemValue,
    "subscription_url",
    "url",
  );
  const remote = isRemoteSubscriptionSource(source);
  const headers = remote
    ? loadDefaultSubscriptionHeaders()
    : Promise.resolve([]);
  return headers.then((headers) =>
    showChildItemSettingsModal(_section_id, itemValue, option, {
      typeName: "subscription_url",
      valueOption: "url",
      keys: subscriptionUrlSettingsKeys(remote),
      defaults: (_inputValue, existing) =>
        defaultSubscriptionUrlSettings(
          existing ? [] : headers,
          nextSubscriptionTag(_section_id, option),
          remote,
        ),
      addOptions: (itemSection, options) =>
        addSubscriptionUrlItemOptions(
          itemSection,
          Object.assign({}, options, { remote }),
        ),
      title: () => _("Subscription settings"),
      afterSave: (itemId, _inputValue, _settings, existing) => {
        if (!remote && existing) cleanupRemoteSubscriptionUrlSettings(itemId);
      },
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
    itemNode,
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
    itemNode,
    defaults,
    addOptions: (itemSection) =>
      addFallbackLevelItemOptions(itemSection, {
        parentSectionId: () => context.parentSectionId || "",
        validateName: validateUniqueDynamicListItemName.bind(
          null,
          widget,
          itemNode,
        ),
      }),
    title: (name) => {
      const normalized = `${name || ""}`.trim();
      return normalized
        ? `${_("Server group settings")}: ${normalized}`
        : _("Server group settings");
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
    ? nextSectionId("fallback_group")
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
        : tunnel.kind === "amneziawg" || endpointType === "amneziawg"
          ? "amneziawg"
          : tunnel.kind === "tailscale" || endpointType === "tailscale"
            ? "tailscale"
            : "wireguard";
  const junkEnabled = (forKind) =>
    kind === forKind &&
    ONE_SIDED_AMNEZIA_FIELDS.some((key) => tunnel[`amnezia_${key}`] != null);
  const warpJunkEnabled = junkEnabled("warp");
  const wireguardJunkEnabled = junkEnabled("wireguard");
  const tailscaleDetour = `${tunnel.tailscale_detour_section || ""}`.trim();
  const settings = {
    name: kind === "json" ? `${endpoint.tag || ""}` : `${tunnel.name || ""}`,
    tunnel_type: kind,
    warp_junk_enabled: warpJunkEnabled ? "1" : "0",
    wireguard_junk_enabled: wireguardJunkEnabled ? "1" : "0",
    address: normalizeOptionValues(tunnel.address),
    private_key: `${tunnel.private_key || ""}`,
    listen_port: tunnel.listen_port ? `${tunnel.listen_port}` : "",
    mtu: tunnel.mtu ? `${tunnel.mtu}` : "",
    peer_ids: tunnelPeerIds(value),
    warp_keepalive: tunnel.warp_keepalive ? `${tunnel.warp_keepalive}` : "",
    warp_profile_id: `${tunnel.warp_profile_id || ""}`,
    warp_auth_token: `${tunnel.warp_profile_auth_token || ""}`,
    warp_private_key: `${tunnel.warp_profile_private_key || ""}`,
    warp_license_key: `${tunnel.warp_profile_license_key || ""}`,
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
    "warp_profile_license_key",
    "warp_junk_enabled",
    "wireguard_junk_enabled",
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

// Both endpoints that take the one-sided class gate it behind their own
// obfuscation flag, so the fields stay out of a dialog that does not use them.
function oneSidedAmneziaEnabled(kind, settings) {
  if (kind === "warp") {
    return `${settings.warp_junk_enabled || ""}` === "1";
  }
  return (
    kind === "wireguard" && `${settings.wireguard_junk_enabled || ""}` === "1"
  );
}

// Asking for obfuscation fills the fields that are still empty, so an imported
// configuration and anything typed by hand are never overwritten. The stored
// value is read as well as the widget: a field that the toggle keeps hidden has
// no widget to ask yet, and formvalue answers null for it.
function fillOneSidedAmneziaDefaults(map, amneziaOptions) {
  Object.keys(ONE_SIDED_AMNEZIA_DEFAULTS).forEach((key) => {
    const option = amneziaOptions[key];
    if (!option) {
      return;
    }
    const current = `${
      option.formvalue("settings") ??
      map.data.get(map.config, "settings", option.option) ??
      ""
    }`.trim();
    if (!current) {
      setModalOptionValue(map, option, ONE_SIDED_AMNEZIA_DEFAULTS[key]);
    }
  });
}

function tunnelStorageSettings(settings) {
  const kind = `${settings.tunnel_type || "wireguard"}`;
  const storedAmneziaFields =
    kind === "amneziawg"
      ? AMNEZIA_FIELDS
      : oneSidedAmneziaEnabled(kind, settings)
        ? ONE_SIDED_AMNEZIA_FIELDS
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
    warp_profile_license_key: `${settings.warp_license_key || ""}`.trim(),
    tailscale_auth_key: `${settings.tailscale_auth_key || ""}`.trim(),
    tailscale_hostname: `${settings.tailscale_hostname || ""}`.trim(),
    tailscale_control_url: `${settings.tailscale_control_url || ""}`.trim(),
    // Every other field of a kind the tunnel is not collapses to nothing here;
    // this one has a default, so it needs the same gate or a WireGuard tunnel
    // ends up storing a Tailscale option it never showed.
    tailscale_accept_routes:
      kind === "tailscale" ? `${settings.tailscale_accept_routes || "1"}` : "",
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

function createTunnelItem(sectionId, tunnelId, settings) {
  const itemId = isExistingChildItem(sectionId, tunnelId, "tunnel", "section")
    ? tunnelId
    : uci.add(UCI_PACKAGE, "tunnel", tunnelId) || tunnelId;
  if (uci.get(UCI_PACKAGE, itemId, "section") !== sectionId) {
    uci.set(UCI_PACKAGE, itemId, "section", sectionId);
  }
  // The dialog owns every key of a tunnel, so the ones it did not fill are
  // cleared - a tunnel that is no longer WireGuard must not keep WireGuard
  // fields. Naming them all rather than unsetting them first leaves the values
  // that did not change alone, so a save that changed nothing writes nothing.
  const target = {};
  tunnelSettingsKeys().forEach((key) => {
    target[key] = Object.prototype.hasOwnProperty.call(settings, key)
      ? settings[key]
      : "";
  });
  applyChildItemSettings(itemId, target);
  return itemId;
}

function materializeTunnelPeers(tunnelId, values, option) {
  const store = childPendingSettingsStore(option, tunnelId);
  const { itemIds } = materializeChildItems(
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
    if (`${settings.warp_license_key || ""}`.trim()) {
      profile.license_key = `${settings.warp_license_key}`.trim();
    }
    if (Object.keys(profile).length > 0) {
      // A user-supplied profile must win over sing-box's cached WARP config.
      // The core uses this native flag to recreate the endpoint from the
      // current credentials instead of silently reusing stale cache data.
      profile.recreate = true;
      endpoint.profile = profile;
    }
    if (oneSidedAmneziaEnabled(kind, settings)) {
      const amnezia = tunnelAmneziaSettings(settings, ONE_SIDED_AMNEZIA_FIELDS);
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
    type: kind,
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
  } else if (oneSidedAmneziaEnabled(kind, settings)) {
    const amnezia = tunnelAmneziaSettings(settings, ONE_SIDED_AMNEZIA_FIELDS);
    if (Object.keys(amnezia).length > 0) {
      endpoint.amnezia = amnezia;
    }
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
    oneSidedAmneziaEnabled(`${settings.tunnel_type || ""}`, settings)
  ) {
    const rangeFields =
      kind === "amneziawg"
        ? AMNEZIA_RANGE_FIELDS
        : AMNEZIA_RANGE_FIELDS.filter((key) =>
            ONE_SIDED_AMNEZIA_FIELDS.includes(key),
          );
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
  // A configuration that sets a parameter both ends must agree on describes an
  // AmneziaWG peer. One that sets only the one-sided ones is a WireGuard tunnel
  // with obfuscation, which any server accepts.
  const amneziaKeys = Object.keys(endpoint.amnezia || {});
  const twoSided = amneziaKeys.some(
    (key) => !ONE_SIDED_AMNEZIA_FIELDS.includes(key),
  );
  setModalOptionValue(map, fields.type, twoSided ? "amneziawg" : "wireguard");
  if (fields.wireguardJunk) {
    setModalOptionValue(
      map,
      fields.wireguardJunk,
      !twoSided && amneziaKeys.length > 0 ? "1" : "0",
    );
  }
  setModalOptionValue(map, fields.address, endpoint.address || []);
  setModalOptionValue(map, fields.privateKey, endpoint.private_key || "");
  setModalOptionValue(map, fields.listenPort, endpoint.listen_port || "");
  setModalOptionValue(map, fields.mtu, endpoint.mtu || "");
  const peerStore = childPendingSettingsStore(fields.peers, fields.tunnelId);
  const peerIds = (endpoint.peers || []).map((peer) => {
    const id = nextSectionId("tunnel_peer");
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

function addWireGuardPeerItemOptions(section) {
  let o = section.option(
    form.Value,
    "address",
    _("Server address"),
    _("Peer hostname or IP address"),
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
    _("An extra key shared with this peer"),
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
    _("The subnets that go through this peer"),
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
      "Interval between packets that keep the tunnel open, in seconds. Empty means the default",
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
  const peerId = context.adding
    ? nextSectionId("tunnel_peer")
    : `${itemValue || ""}`;
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
      return _("Paste a configuration, a wireguard:// link or a vpn:// link");
    }
    // A vpn:// link and an Amnezia profile carry a compressed or nested
    // payload that only the import step decodes; a configuration file and a
    // share link are checked while the user types.
    if (/^vpn:\/\//iu.test(input) || input.startsWith("{")) {
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
    { singleField: true, saveLabel: _("Import") },
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
    ? nextSectionId("tunnel")
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

  let o = itemSection.option(form.Value, "name", _("Tunnel name"));
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
    _("Fill the fields from an existing configuration"),
  );
  importButton.inputtitle = _("Import");
  importButton.inputstyle = "apply";
  importButton.depends("tunnel_type", "wireguard");
  importButton.depends("tunnel_type", "amneziawg");

  const warpGenerateButton = itemSection.option(
    form.Button,
    "_generate_warp_profile",
    _("WARP profile"),
    _("Registers a device and fills the fields below"),
  );
  warpGenerateButton.inputtitle = _("Generate profile");
  warpGenerateButton.inputstyle = "apply";
  warpGenerateButton.depends("tunnel_type", "warp");

  const tailscaleAuthKeyOption = itemSection.option(
    form.Value,
    "tailscale_auth_key",
    _("Authorization key"),
    _("Auth Key from the Tailscale admin console"),
  );
  tailscaleAuthKeyOption.password = true;
  tailscaleAuthKeyOption.rmempty = false;
  tailscaleAuthKeyOption.depends("tunnel_type", "tailscale");

  const tailscaleHostnameOption = itemSection.option(
    form.Value,
    "tailscale_hostname",
    _("Device name"),
    _("The name this device appears under in the Tailscale console"),
  );
  tailscaleHostnameOption.rmempty = false;
  tailscaleHostnameOption.depends("tunnel_type", "tailscale");

  const tailscaleControlUrlOption = itemSection.option(
    form.Value,
    "tailscale_control_url",
    _("Coordination server"),
    _("Change only for a self-hosted Headscale"),
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
    _("Coordination server through a section"),
    _("Reach the coordination server through a section instead of the WAN"),
  );
  tailscaleDetourEnabledOption.default = "0";
  tailscaleDetourEnabledOption.rmempty = false;
  tailscaleDetourEnabledOption.depends("tunnel_type", "tailscale");

  const tailscaleDetourSectionOption = itemSection.option(
    form.ListValue,
    "tailscale_detour_section",
    _("Coordination server through"),
  );
  refreshOutboundDetourSectionOptionValues(
    tailscaleDetourSectionOption,
    section_id,
  );
  keepUnavailableSectionChoice(
    tailscaleDetourSectionOption,
    data.settings.tailscale_detour_section,
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
    _("Accept subnets advertised by other devices in your Tailscale network"),
  );
  tailscaleAcceptRoutesOption.default = "1";
  tailscaleAcceptRoutesOption.rmempty = false;
  tailscaleAcceptRoutesOption.depends("tunnel_type", "tailscale");

  const tailscaleExitNodeOption = itemSection.option(
    form.Value,
    "tailscale_exit_node",
    _("Exit node"),
    _(
      "IP address or device name in Tailscale through which traffic is forwarded",
    ),
  );
  tailscaleExitNodeOption.rmempty = false;
  tailscaleExitNodeOption.depends("tunnel_type", "tailscale");

  const endpointJsonOption = itemSection.option(
    form.TextValue,
    "endpoint_json",
    _("JSON endpoint"),
  );
  endpointJsonOption.placeholder = JSON_ENDPOINT_PLACEHOLDER;
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
    _("Interface IPv4 or IPv6 addresses in CIDR format"),
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
    _("Local UDP port. Empty means the default"),
  );
  listenPortOption.datatype = "port";
  listenPortOption.rmempty = true;
  listenPortOption.depends("tunnel_type", "wireguard");
  listenPortOption.depends("tunnel_type", "amneziawg");

  const mtuOption = itemSection.option(form.Value, "mtu", "MTU");
  // What transport/wireguard in the core falls back to when the endpoint carries
  // no MTU of its own.
  mtuOption.placeholder = "1408";
  mtuOption.datatype = "range(1,65535)";
  mtuOption.rmempty = true;
  mtuOption.depends("tunnel_type", "wireguard");
  mtuOption.depends("tunnel_type", "amneziawg");

  const peersOption = itemSection.option(
    ButtonAddSettingsDynamicList,
    "peer_ids",
    _("Peers"),
    _("Required. Remote nodes to connect to"),
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
      wireguardJunk: wireguardJunkOption,
      amnezia: amneziaOptions,
    });
  };

  o = itemSection.option(
    form.Value,
    "warp_keepalive",
    _("Persistent keepalive"),
    _(
      "Interval between packets that keep the tunnel open, in seconds. Empty means the default",
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
    _("Profile ID"),
  );
  warpProfileIdOption.rmempty = false;
  warpProfileIdOption.depends("tunnel_type", "warp");

  const warpAuthTokenOption = itemSection.option(
    form.Value,
    "warp_auth_token",
    _("Auth token"),
  );
  warpAuthTokenOption.password = true;
  warpAuthTokenOption.rmempty = false;
  warpAuthTokenOption.depends("tunnel_type", "warp");

  const warpPrivateKeyOption = itemSection.option(
    form.Value,
    "warp_private_key",
    _("Private key"),
  );
  warpPrivateKeyOption.password = true;
  warpPrivateKeyOption.rmempty = false;
  warpPrivateKeyOption.depends("tunnel_type", "warp");

  const warpLicenseKeyOption = itemSection.option(
    form.Value,
    "warp_license_key",
    _("License key"),
    _("Applies WARP+ to the profile account"),
  );
  warpLicenseKeyOption.password = true;
  warpLicenseKeyOption.rmempty = true;
  warpLicenseKeyOption.depends("tunnel_type", "warp");

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
      "Masks traffic with the Amnezia mechanism to make it harder to identify",
    ),
  );
  warpJunkOption.default = "0";
  warpJunkOption.rmempty = false;
  warpJunkOption.depends("tunnel_type", "warp");
  warpJunkOption.onchange = function (_event, _sectionId, value) {
    if (value === "1") {
      fillOneSidedAmneziaDefaults(map, amneziaOptions);
    }
  };

  const wireguardJunkOption = itemSection.option(
    form.Flag,
    "wireguard_junk_enabled",
    _("Traffic obfuscation"),
    _(
      "Masks traffic with the Amnezia mechanism to make it harder to identify",
    ),
  );
  wireguardJunkOption.default = "0";
  wireguardJunkOption.rmempty = false;
  wireguardJunkOption.depends("tunnel_type", "wireguard");
  wireguardJunkOption.onchange = function (_event, _sectionId, value) {
    if (value === "1") {
      fillOneSidedAmneziaDefaults(map, amneziaOptions);
    }
  };

  AMNEZIA_FIELDS.forEach((key) => {
    const option = itemSection.option(
      form.Value,
      `amnezia_${key}`,
      amneziaFieldLabel(key),
    );
    if (AMNEZIA_COUNT_FIELDS.includes(key)) {
      option.datatype = "and(uinteger,range(0,4294967295))";
    }
    if (AMNEZIA_PADDING_FIELDS.includes(key)) {
      option.datatype = "and(uinteger,range(0,65535))";
    }
    if (AMNEZIA_RANGE_FIELDS.includes(key)) {
      option.validate = function (_itemId, value) {
        return validateAmneziaRange(value);
      };
    }
    option.rmempty = true;
    option.retain = true;
    option.depends("tunnel_type", "amneziawg");
    if (ONE_SIDED_AMNEZIA_FIELDS.includes(key)) {
      option.depends({ tunnel_type: "warp", warp_junk_enabled: "1" });
      option.depends({
        tunnel_type: "wireguard",
        wireguard_junk_enabled: "1",
      });
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
    if (AMNEZIA_SIGNATURE_FIELDS.includes(key)) {
      option.validate = function (_itemId, value) {
        const normalized = `${value || ""}`.trim();
        return !normalized || main.validateAmneziaSignature(normalized)
          ? true
          : _(
              "AmneziaWG I1-I5 must be Custom Protocol Signature tags such as <b 0xdeadbeef><r 4>",
            );
      };
    }
    amneziaOptions[key] = option;
  });

  typeOption.onchange = function (_event, _sectionId, value) {
    if (previousTunnelType === "amneziawg") {
      if (value === "warp") {
        setModalOptionValue(map, warpJunkOption, "1");
      } else if (value === "wireguard") {
        setModalOptionValue(map, wireguardJunkOption, "1");
      }
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

// Shown greyed out in the JSON outbound editor: the smallest object
// validateOutboundJson accepts for a server type, whose tag becomes the name
// the outbound is listed and routed under.
const JSON_OUTBOUND_PLACEHOLDER = [
  "{",
  '  "type": "socks",',
  '  "tag": "my-outbound",',
  '  "server": "127.0.0.1",',
  '  "server_port": 1080',
  "}",
].join("\n");

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
  );
  jsonOption.placeholder = JSON_OUTBOUND_PLACEHOLDER;
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
    _("JSON outbound"),
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
    { singleField: true },
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
    _(
      "By default only the domain conditions of a rule set are applied. This option adds its IP addresses and subnets to nftables. Large lists can load the router heavily. Enable it only if you know the set holds the subnets you need",
    ),
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
    case "outbound":
      return _("JSON outbound");
    case "proxy":
    default:
      return "Proxy";
  }
}

function getRuleActionDisplayValue(section_id) {
  return getActionOptionLabel(getRuleResolvedAction(section_id));
}

function getRuleActionDisplayMarkup(section_id) {
  return getRuleActionDisplayValue(section_id);
}

// currentAction is what the section is stored as, and a dropdown hands back one
// of its own entries and nothing else: without its own action in the list a
// section carrying a retired action would come back from a save as a Connection
// with no servers, which is a configuration that will not build at all.
function populateActionOptionValues(option, currentAction) {
  delete option.keylist;
  delete option.vallist;

  option.value("connection", getActionOptionLabel("connection"));
  option.value("bypass", "Bypass");
  option.value("block", "Block");
  option.value("dns", "DNS");

  const stored = `${currentAction || ""}`.trim();
  if (stored && !option.keylist.includes(stored)) {
    option.value(stored, getActionOptionLabel(stored));
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

function createChildItem(section_id, options, inputValue) {
  const rawValue = `${inputValue || ""}`.trim();

  // Only a stored child section id identifies an existing item. A display value
  // is always a draft, even when an item that is still stored carries the same
  // name, so removing an item and adding a new one with the same name keeps the
  // freshly entered settings instead of resurrecting the removed section.
  if (
    isExistingChildItem(
      section_id,
      rawValue,
      options.typeName,
      options.ownerOption,
    )
  ) {
    return {
      value: rawValue,
      text: options.valueOption
        ? childItemValue(rawValue, options.valueOption, rawValue)
        : rawValue,
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

    // Writing a value the section already holds still counts as a change in
    // LuCI, so a dialog that rewrites its whole item - the tunnel one does, to
    // drop the fields of the kind it no longer is - would report every option
    // of that item as changed by a save that changed nothing.
    if (settingValueEquals(uci.get(UCI_PACKAGE, itemId, key), value)) {
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
  const itemIds = [];
  const seen = new Set();
  const resolved = new Map();

  normalizeDynamicListItems(inputValue).forEach((value) => {
    let itemId = resolved.get(value);

    if (itemId == null) {
      const createdItem = createChildItem(section_id, options, value);
      itemId = createdItem.value;
      const stagedSettings =
        createdItem.created && typeof options.stagedSettings === "function"
          ? options.stagedSettings(value, itemId, createdItem.created)
          : null;

      if (stagedSettings) {
        applyChildItemSettings(itemId, stagedSettings);
      }

      if (itemId) {
        resolved.set(value, itemId);
      }
    }

    if (itemId && !seen.has(itemId)) {
      seen.add(itemId);
      itemIds.push(itemId);
    }
  });

  return { itemIds, resolved };
}

// Replaces draft list values with the child section ids they were stored as, so
// a repeated write of the same widget updates those sections instead of storing
// duplicates and losing the staged settings.
function adoptMaterializedChildItems(option, section_id, resolved) {
  let widget = null;

  try {
    widget = option.getUIElement(section_id);
  } catch (_error) {
    // The widget is not mounted; the stored ids are loaded on the next render.
  }

  if (!widget || !widget.node) {
    return;
  }

  resolved.forEach((itemId, value) => {
    if (itemId === value) {
      return;
    }

    const item = findDynamicListItemByValue(widget.node, value);
    if (item) {
      setDynamicListItemValue(item, itemId);
    }
  });
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

function isRemoteSubscriptionSource(value) {
  const source = `${value || ""}`.trim();
  return source.startsWith("http://") || source.startsWith("https://");
}

function validateSubscriptionUrlEntry(_section_id, value) {
  if (!value || value.length === 0) {
    return true;
  }

  const parsed = parseSubscriptionUrlEntry(value);
  if (!parsed.valid) {
    return parsed.message;
  }

  const validation = isRemoteSubscriptionSource(parsed.url)
    ? main.validateUrl(parsed.url)
    : main.validatePath(parsed.url);
  return validation.valid
    ? true
    : _("Subscription must be an HTTP(S) URL or an absolute local path");
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

  const duplicateMessage = options.duplicateMessage || annotate.getDuplicateValueText();
  const annotationMap = new Map();
  const errors = [];
  const seen = new Set();

  tokens.forEach((token) => {
    if (typeof validateItem === "function") {
      const validation = validateItem(token.value);
      if (!validation.valid) {
        errors.push(`${token.value}: ${validation.message}`);
        annotate.addAnnotationIssue(annotationMap, token, validation.message);
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
      annotate.addAnnotationIssue(annotationMap, token, duplicateMessage);
      return;
    }

    seen.add(normalized);
  });

  if (!errors.length) {
    return { valid: true, message: "", annotations: [] };
  }

  return {
    valid: false,
    message: [annotate.getValidationHeaderText(), ...errors].join("\n"),
    annotations: annotate.finalizeAnnotations(annotationMap),
  };
}

// Shown greyed out in the condition editors: one value per line, and for
// domains every prefix analyzeDomainSuffixText accepts. Both are run through
// their own analyzers by luciPlaceholders.test.js.
const DOMAIN_CONDITION_PLACEHOLDER = [
  "example.com",
  "full:api.example.com",
  "keyword:google",
  String.raw`regex:^ads\..*\.com$`,
].join("\n");

const IP_CONDITION_PLACEHOLDER = [
  "1.1.1.1",
  "192.168.1.0/24",
  "2606:4700::/32",
].join("\n");

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

function configureTextareaOption(option, analyzer) {
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
  o.placeholder = config.placeholder;
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

  section.tab("settings", _("Route"));
  section.tab("conditions", _("Conditions"));

  o = section.taboption("settings", form.Flag, "enabled", _("Enable"));
  o.default = "1";
  o.rmempty = false;
  o.editable = true;
  o.width = GRID_SWITCH_COLUMN_WIDTH;

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
  o.width = GRID_KIND_COLUMN_WIDTH;

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
  o.validate = function (section_id, value) {
    const normalized = `${value || ""}`.trim();
    if (!normalized) return _("Enter a section name");
    if (normalized.includes("/")) return _("Section name must not contain /");
    if (RESERVED_RUNTIME_TAGS.has(normalized)) {
      return _("This section name is reserved by Forkop");
    }
    return [
      ...(uci.sections(UCI_PACKAGE, "section") || []),
      ...(uci.sections(UCI_PACKAGE, "server") || []),
    ].some(
      (item) =>
        item[".name"] !== section_id &&
        `${item.label || item[".name"] || ""}`.trim() === normalized,
    )
      ? _("Section name must be unique")
      : true;
  };

  o = section.taboption(
    "settings",
    form.ListValue,
    "action",
    _("Action"),
    _("What to do when this section's conditions match"),
  );
  populateActionOptionValues(o);
  o.default = "connection";
  o.rmempty = false;
  o.modalonly = true;
  o.cfgvalue = function (section_id) {
    return getRuleConfiguredAction(section_id);
  };
  o.load = function (section_id) {
    const value = this.cfgvalue(section_id);
    populateActionOptionValues(this, value);
    return value;
  };

  const dnsServerOption = section.taboption(
    "settings",
    form.DynamicList,
    "dns_server",
    _("DNS Server"),
    _(
      "Resolves domains that match the section conditions. Several servers give automatic failover. The protocol is set by a prefix: udp://, tcp://, tls://, https://, quic://, h3://",
    ),
  );
  o = dnsServerOption;
  o.depends("action", "dns");
  o.rmempty = false;
  o.modalonly = true;
  o.validate = function (section_id, value) {
    const normalized = `${value || ""}`.trim();
    if (!normalized) {
      return L.toArray(this.formvalue(section_id)).some((item) =>
        `${item || ""}`.trim(),
      )
        ? true
        : _("Add at least one DNS server");
    }
    const validation = main.validateDNS(normalized);
    return validation.valid ? true : validation.message;
  };

  const dnsQueryModeOption = section.taboption(
    "settings",
    form.ListValue,
    "dns_fallback_strategy",
    _("DNS Query Mode"),
    _(
      "Parallel asks every server at once and is faster. Sequential asks them in turn until the first answer",
    ),
  );
  dnsQueryModeOption.value("parallel", _("Parallel"));
  dnsQueryModeOption.value("sequential", _("Sequential"));
  dnsQueryModeOption.default = "parallel";
  dnsQueryModeOption.rmempty = false;
  dnsQueryModeOption.modalonly = true;
  dnsQueryModeOption.retain = true;
  dnsQueryModeOption.depends({
    action: "dns",
    dns_server: "__forkop_multiple_dns__",
  });
  dnsQueryModeOption.checkDepends = function (section_id) {
    const actionOption = this.map.lookupOption("action", section_id);
    const dnsServerOption = this.map.lookupOption("dns_server", section_id);
    const action = actionOption?.[0].formvalue(actionOption[1]);
    const servers = dnsServerOption?.[0].formvalue(dnsServerOption[1]);
    return action === "dns" && normalizeDynamicListItems(servers).length > 1;
  };
  const originalDnsServerRenderWidget = dnsServerOption.renderWidget;
  dnsServerOption.renderWidget = function (section_id, option_index, cfgvalue) {
    const node = originalDnsServerRenderWidget.call(
      this,
      section_id,
      option_index,
      cfgvalue,
    );
    node.addEventListener("cbi-dynlist-change", () => {
      this.map.checkDepends();
    });
    return node;
  };

  o = section.taboption(
    "settings",
    form.Flag,
    "dns_detour_enabled",
    _("DNS through section"),
    _("Route DNS requests through a section"),
  );
  o.depends("action", "dns");
  o.default = "0";
  o.rmempty = false;
  o.modalonly = true;

  o = section.taboption(
    "settings",
    form.ListValue,
    "dns_detour_section",
    _("DNS requests through"),
  );
  o.depends({ action: "dns", dns_detour_enabled: "1" });
  o.rmempty = false;
  o.modalonly = true;
  o.load = function (section_id) {
    refreshDnsDetourSectionOptionValues(this, section_id);
    const value = uci.get(UCI_PACKAGE, section_id, "dns_detour_section") || "";
    keepUnavailableSectionChoice(this, value);
    return value;
  };
  o.validate = function (_section_id, value) {
    return value ? true : _("Select a section");
  };

  o = section.taboption(
    "settings",
    form.DynamicList,
    "selector_proxy_links",
    _("Connection URI"),
    _(
      "Supported URIs: vless, vmess, shadowsocks, trojan, socks, http, tuic, hysteria, naiveproxy, mieru, anytls",
    ),
  );
  o.depends("action", "connection");
  o.rmempty = true;
  o.modalonly = true;
  // The other four sources a Connection section can have are child sections that
  // a hidden list leaves alone; these links live in the section itself, and they
  // are pasted server URIs nobody can type again. An action the user picked in
  // the same dialog is not a reason to throw them away - the runtime reads none
  // of them unless the action is Connection, and they are all still there when
  // the action goes back.
  o.retain = true;
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
    _("Subscription URL or local path"),
  );
  o.depends("action", "connection");
  o.rmempty = true;
  o.modalonly = true;
  o.childType = "subscription_url";
  o.childValueOption = "url";
  o.createId = () => nextSectionId("subscription_url");
  o.childDefaults = Object.assign(
    defaultSubscriptionUrlSettings([], "", false),
    {
      subscription_update_enabled: (value) =>
        isRemoteSubscriptionSource(value) ? "1" : null,
      subscription_update_interval: (value) =>
        isRemoteSubscriptionSource(value) ? "1h" : null,
      download_via_proxy_enabled: (value) =>
        isRemoteSubscriptionSource(value) ? "0" : null,
      header: (value) =>
        isRemoteSubscriptionSource(value)
          ? defaultSubscriptionHeaderLines.slice()
          : null,
      show_dashboard_metadata: (value) =>
        isRemoteSubscriptionSource(value) ? "1" : null,
      tag: (_value, sectionId) => nextSubscriptionTag(sectionId, o),
    },
  );
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
  o.afterMaterializeChildItems = function (_section_id, itemIds) {
    itemIds.forEach((itemId) => {
      const source = childItemInputValue(
        _section_id,
        itemId,
        "subscription_url",
        "url",
      );
      if (!isRemoteSubscriptionSource(source)) {
        cleanupRemoteSubscriptionUrlSettings(itemId);
      }
    });
  };
  o.renderListItemLabel = function (section_id, itemId) {
    return childItemInputValue(section_id, itemId, "subscription_url", "url");
  };
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
  );
  o.depends("action", "connection");
  o.rmempty = true;
  o.modalonly = true;
  o.datatype = "netdevname";
  o.placeholder = _("Select an interface");
  o.childType = "section_interface";
  o.childValueOption = "name";
  o.createId = () => nextSectionId("section_interface");
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
      "WireGuard, AmneziaWG, Cloudflare WARP, Tailscale and JSON endpoint are available",
    ),
  );
  o.depends("action", "connection");
  o.rmempty = true;
  o.modalonly = true;
  o.addButtonLabel = _("+ Add tunnel");
  o.childType = "tunnel";
  o.ownerOption = "section";
  o.childValueOption = null;
  o.createId = () => nextSectionId("tunnel");
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
    _("A custom sing-box outbound object"),
  );
  o.depends("action", "connection");
  o.rmempty = true;
  o.modalonly = true;
  // Kept for the same reason as the connection URIs above: hand-written outbound
  // objects the section holds itself, which an action change must not discard.
  o.retain = true;
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
    _("Selects the node with the lowest latency"),
  );
  o.depends("action", "connection");
  o.rmempty = true;
  o.modalonly = true;
  o.addButtonLabel = _("+ Add URLTest");
  o.childType = "urltest";
  o.childValueOption = "name";
  o.createId = () => nextSectionId("urltest");
  o.childDefaults = urlTestChildDefaults();
  outboundNameSourceOptions.set("urltest", o);
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
    _("Selects the first available node by priority"),
  );
  o.depends("action", "connection");
  o.rmempty = true;
  o.modalonly = true;
  o.addButtonLabel = _("+ Add fallback");
  o.childType = "fallback_group";
  o.childValueOption = "name";
  o.childDefaults = fallbackGroupChildDefaults();
  outboundNameSourceOptions.set("fallback_group", o);
  o.createId = () => nextSectionId("fallback_group");
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
      "Use another section as an intermediate hop to connect to servers in this section. Does not apply to network interfaces, Tailscale, JSON outbounds, or JSON endpoints",
    ),
  );
  o.default = "0";
  o.rmempty = false;
  o.depends("action", "connection");
  o.modalonly = true;
  o.write = function (section_id, value) {
    // Turning the cascade on needs a section to cascade through, so one is filled
    // in when none is stored. Only then: a section that is stored but not in the
    // list right now - its target was deleted or switched off - is still what the
    // user chose, and replacing it here would send this section's traffic
    // somewhere else without saying so.
    if (
      value === "1" &&
      !(uci.get(UCI_PACKAGE, section_id, "outbound_detour_section") || "")
    ) {
      const selectedValue = getDefaultOutboundDetourSection(section_id);

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
    const value =
      uci.get(UCI_PACKAGE, section_id, "outbound_detour_section") || "";
    keepUnavailableSectionChoice(this, value);
    return Promise.resolve(value);
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

  addTextConditionField(section, {
    key: "domain_suffix",
    optionName: "domain",
    legacyTextOptionName: "domain_suffix_text",
    label: _("Domains"),
    placeholder: DOMAIN_CONDITION_PLACEHOLDER,
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
    placeholder: IP_CONDITION_PLACEHOLDER,
    textAnalyze: analyzeIpCidrText,
  });
  dependsOnRoutingAction(ipConditionOption);

  const builtInRulesetOption = section.taboption(
    "conditions",
    form.DynamicList,
    "community_lists",
    _("Built-in lists"),
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

  const dnsRuleSetOption = section.taboption(
    "conditions",
    form.DynamicList,
    "_dns_rule_set",
    _("Rule sets"),
    _("A URL or local path. The format is detected automatically"),
  );
  dnsRuleSetOption.depends("action", "dns");
  dnsRuleSetOption.modalonly = true;
  // Both rule set fields read and write the same list, and this one is shown only
  // for a DNS rule. Without retain LuCI would call its remove() on every other
  // action - and that remove clears the list, the subnet flags and the per-rule
  // set settings of a section this field is not even shown for.
  dnsRuleSetOption.retain = true;
  dnsRuleSetOption.load = function (section_id) {
    return getCustomRulesetReferences(section_id);
  };
  dnsRuleSetOption.write = function (section_id, value) {
    writeDnsRulesetReferences(section_id, value);
  };
  dnsRuleSetOption.remove = function (section_id) {
    writeDnsRulesetReferences(section_id, []);
  };
  dnsRuleSetOption.validate = function (_section_id, value) {
    return validateCustomRulesetReference(value);
  };

  const ruleSetOption = section.taboption(
    "conditions",
    SettingsDynamicList,
    "rule_set",
    _("Rule sets"),
    _("A URL or local path. The format is detected automatically"),
  );
  dependsOnRoutingAction(ruleSetOption);
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
    label: _("Only for devices"),
    description: _("The section conditions only match these devices"),
  });
  dependsOnRuleConditions(sourceIpOption);

  const fullyRoutedOption = addLocalDeviceSubnetDynamicField(section, {
    key: "fully_routed_ips",
    label: _("Devices"),
    description: _(
      "All traffic from these devices is forced through the section",
    ),
  });
  dependsOnRoutingAction(fullyRoutedOption);
  fullyRoutedOption.depends("action", "dns");
  makeDeviceOptionsExclusive(sourceIpOption, fullyRoutedOption);

  const portsOption = addDynamicConditionField(section, {
    key: "ports",
    label: _("Ports"),
    description: _("Match destination ports"),
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

function configureSectionSection(sectionRef) {
  const handleRemove = sectionRef.handleRemove;
  sectionRef.handleRemove = function (section_id) {
    cleanupRemovedChildItems(section_id, "subscription_url", []);
    cleanupRemovedChildItems(section_id, "section_interface", []);
    cleanupRemovedChildItems(section_id, "urltest", []);
    cleanupRemovedChildItems(section_id, "fallback_group", []);
    cleanupRemovedChildItems(section_id, "tunnel", []);
    return handleRemove.apply(this, arguments);
  };

  // Which outbounds a section needs is a property of the section, not of any one
  // of its fields, so the check runs here instead of in an option. Before the
  // dialog writes anything: LuCI parses the options one by one, so a check that
  // refuses halfway leaves the fields that already passed behind.
  sectionRef.handleModalSave = function (modalMap, ev) {
    if (missingConnectionOutbound(modalMap, modalMap?.section)) {
      return Promise.resolve();
    }

    return form.GridSection.prototype.handleModalSave.call(this, modalMap, ev);
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
  // The two grid columns the Servers tab has to match, so that switching tabs
  // does not move every column on the page.
  GRID_KIND_COLUMN_WIDTH,
  GRID_SWITCH_COLUMN_WIDTH,
  // The child item list widget and its stacked settings dialog are shared with the
  // Servers tab, which lists server clients the same way this tab lists interfaces,
  // URLTests and tunnels.
  ButtonAddSettingsDynamicList,
  // The static DNS records dialog in the Settings tab is the other dialog that
  // gives one text field the whole modal.
  SINGLE_FIELD_MODAL_CLASS,
  addDynamicListItem,
  childItemInputValue,
  childPendingSettingsStore,
  cleanupRemovedChildItems,
  configureSectionSection,
  configureTextareaOption,
  createSectionContent,
  ensureSingleFieldModalStyles,
  isExistingChildItem,
  // The Servers and Settings tabs have section dropdowns of their own, and a
  // stored name none of them offers has to survive there for the same reason.
  keepUnavailableSectionChoice,
  showChildItemSettingsModal,
  updateDynamicListItemLabel,
  validateUniqueDynamicListItemName,
};

return baseclass.extend(EntryPoint);
