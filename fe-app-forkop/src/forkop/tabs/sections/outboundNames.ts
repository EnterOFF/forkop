import { FORKOP_UCI_PACKAGE } from '../../../constants';
import { getProxyUrlName } from '../../../helpers/getProxyUrlName';
import {
  childItemInputValue,
  getChildItemIds,
  isExistingChildItem,
} from '../../cbi/childItems';
import { refreshOptionChoices } from '../../cbi/choices';
import { childPendingSettingsStore } from '../../cbi/itemSettings';
import {
  normalizeDynamicListItems,
  normalizeOptionValues,
} from '../../cbi/listValues';
import { getConfigListValues, plainObject } from '../../cbi/uci';
import {
  outboundJsonDisplayTag,
  parseOutboundJsonObject,
} from './outboundJson';
import { safeRuntimeSectionName } from './references';
import { optionMapValue } from './subscriptions/model';
import { tunnelDisplayName } from './tunnels/model';
import { getClashApiProxyProviders } from '../../methods/custom/clashApi';

const outboundNameChoicesCache = new Map();

const outboundNameChoicesInflight = new Map();

const outboundNameChoicesEmptyAt = new Map();

// The runtime knows the server names of a subscription only after the core has
// fetched it, so an empty answer is not a final one. Keeping it forever leaves
// the group and dashboard filters without servers until the page is reloaded.
const OUTBOUND_NAME_CHOICES_EMPTY_TTL_MS = 5000;

// The fields of one dialog share a lookup, and the next dialog asks again: a
// subscription that updated since then delivers other servers.
export function forgetOutboundNameChoices() {
  outboundNameChoicesCache.clear();
  outboundNameChoicesEmptyAt.clear();
}

export const outboundNameSourceOptions = new Map();

const dashboardFilterChoiceRefreshers = new Map<
  string,
  Set<() => boolean | void>
>();

export function nativeProviderOutboundNames(
  providerTags: unknown,
  value: unknown,
): string[] {
  const providers = plainObject(plainObject(value).providers);
  const seen = new Set<string>();
  const result: string[] = [];

  (Array.isArray(providerTags) ? providerTags : []).forEach((providerTag) => {
    providerTag = `${providerTag || ''}`.trim();
    const provider = plainObject(providers[providerTag]);
    const runtimePrefix = `${providerTag}/`;

    (Array.isArray(provider.proxies) ? provider.proxies : []).forEach(
      (proxy) => {
        proxy = plainObject(proxy);
        const type = `${proxy.type || ''}`.toLowerCase();
        if (['selector', 'urltest', 'fallback'].includes(type)) {
          return;
        }

        let name = `${proxy.name || ''}`.trim();
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

export function loadNativeProviderOutboundNames(providerTags: unknown) {
  if (!Array.isArray(providerTags) || !providerTags.length) {
    return Promise.resolve([]);
  }

  return getClashApiProxyProviders()
    .then((response) => {
      const providers = response.success ? response.data?.providers : null;
      if (
        !providers ||
        typeof providers !== 'object' ||
        Array.isArray(providers)
      ) {
        return null;
      }
      return nativeProviderOutboundNames(providerTags, { providers });
    })
    .catch(() => null);
}

function readOutboundChoiceState(section_id: string) {
  if (!safeRuntimeSectionName(section_id)) {
    return Promise.resolve(null);
  }

  const sectionDisplayName = `${
    uci.get(FORKOP_UCI_PACKAGE, section_id, 'label') || section_id
  }`.trim();
  return Promise.resolve({
    providerTags: getChildItemIds(section_id, 'subscription_url').map(
      (itemId: string) => {
        const tag = `${uci.get(FORKOP_UCI_PACKAGE, itemId, 'tag') || ''}`;
        return `${sectionDisplayName}/${tag.trim()}`;
      },
    ),
  });
}

function cacheOutboundNameChoices(key: string, names: string[]) {
  outboundNameChoicesCache.set(key, names);
  if (names.length) {
    outboundNameChoicesEmptyAt.delete(key);
  } else {
    outboundNameChoicesEmptyAt.set(key, Date.now());
  }
}

function outboundNameChoicesCached(key: string) {
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
function loadOutboundNameChoices(
  section_id: string,
  key: string,
  providerIndex: number | null,
) {
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

function subscriptionProviderIndex(section_id: string, itemId: string) {
  return getChildItemIds(section_id, 'subscription_url').indexOf(
    `${itemId || ''}`,
  );
}

export function loadSectionOutboundNameChoices(section_id: string) {
  return loadOutboundNameChoices(section_id, section_id, null);
}

export function loadSubscriptionOutboundNameChoices(
  section_id: string,
  itemId: string,
) {
  return loadOutboundNameChoices(
    section_id,
    `${section_id}:${itemId}`,
    subscriptionProviderIndex(section_id, itemId),
  );
}

export function configureLiveDynamicListChoices(
  option: CBIOption,
  getChoices: (sectionId: string) => Array<{ value: string; label: string }>,
  getRefreshSectionId = (section_id: string) => section_id,
) {
  option.renderWidget = function (
    section_id: string,
    _option_index: string,
    cfgvalue: unknown,
  ) {
    const refreshSectionId =
      `${getRefreshSectionId(section_id) || section_id}`.trim();
    const values = L.toArray(cfgvalue != null ? cfgvalue : this.default);
    const choices = getChoices(section_id);
    const labels: Record<string, string> = {};
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
      const currentLabels: Record<string, string> = {};
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
    const refreshBeforeOpening = (event: Event) => {
      if (event.target && (event.target as Element).closest('.add-item')) {
        refreshChoices();
      }
    };
    node.addEventListener('mousedown', refreshBeforeOpening, true);
    node.addEventListener('focusin', refreshBeforeOpening, true);

    if (!dashboardFilterChoiceRefreshers.has(refreshSectionId)) {
      dashboardFilterChoiceRefreshers.set(refreshSectionId, new Set());
    }
    dashboardFilterChoiceRefreshers.get(refreshSectionId)!.add(refreshChoices);

    return node;
  };
}

export function outboundNameChoiceItems(
  names: string[],
  normalizeChoice: ((name: string) => string) | null,
) {
  const seen = new Set<string>();
  const result: Array<{ value: string; label: string }> = [];
  const append = (name: string) => {
    let value = `${name || ''}`.trim();
    if (typeof normalizeChoice === 'function') {
      value = `${normalizeChoice(value) || ''}`.trim();
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

export function currentOutboundNameChoices(
  section_id: string,
  normalizeChoice: ((name: string) => string) | null,
) {
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

export function currentSubscriptionOutboundNameChoices(
  section_id: string,
  itemId: string,
  normalizeChoice: ((name: string) => string) | null,
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

function currentSourceOptionValues(section_id: string, optionName: string) {
  const liveValues = currentLiveDynamicListValues(section_id, optionName);
  if (liveValues != null) {
    return liveValues;
  }

  const option = outboundNameSourceOptions.get(optionName);

  if (option && typeof option.formvalue === 'function') {
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

export function currentLiveDynamicListValues(
  section_id: string,
  optionName: string,
) {
  if (typeof document === 'undefined') {
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
      `cbid.${FORKOP_UCI_PACKAGE}.${section_id}.${optionName}`,
    );
  }

  if (!widget) {
    return null;
  }

  const values = Array.from(
    widget.querySelectorAll('.item > input[type="hidden"]'),
  )
    .map((input) => `${(input as HTMLInputElement).value || ''}`.trim())
    .filter(Boolean);
  const pendingInput = widget.querySelector(
    '.add-item > input[type="text"]',
  ) as HTMLInputElement | null;
  const pendingValue = `${(pendingInput && pendingInput.value) || ''}`.trim();

  if (
    pendingValue &&
    !pendingInput!.classList.contains('cbi-input-invalid') &&
    !values.includes(pendingValue)
  ) {
    values.push(pendingValue);
  }

  return values;
}

export function currentDraftOutboundNames(section_id: string) {
  const names: string[] = [];

  currentSourceOptionValues(section_id, 'connection_link').forEach(
    (value: string, index: number) => {
      const name = `${
        (isExistingChildItem(section_id, value, 'connection_link')
          ? uci.get(FORKOP_UCI_PACKAGE, value, 'name')
          : '') ||
        getProxyUrlName(value) ||
        `Node #${index + 1}`
      }`.trim();
      names.push(name);
    },
  );
  currentSourceOptionValues(section_id, 'interfaces').forEach(
    (itemId: string) => {
      const interfaceName = childItemInputValue(
        section_id,
        itemId,
        'section_interface',
        'name',
      ).trim();
      const option = outboundNameSourceOptions.get('interfaces');
      const staged = childPendingSettingsStore(option, section_id)[
        interfaceName
      ];
      const displayName = `${
        staged?.display_name ||
        (isExistingChildItem(section_id, itemId, 'section_interface')
          ? uci.get(FORKOP_UCI_PACKAGE, itemId, 'display_name')
          : '') ||
        interfaceName
      }`.trim();
      if (displayName) {
        names.push(displayName);
      }
    },
  );
  currentSourceOptionValues(section_id, 'tunnels').forEach((value: unknown) => {
    const name = tunnelDisplayName(section_id, `${value ?? ''}`);
    if (name) {
      names.push(name);
    }
  });
  currentSourceOptionValues(section_id, 'outbound_jsons').forEach(
    (value: unknown, index: number) => {
      const outbound = parseOutboundJsonObject(value);
      const type = `${outbound?.type || ''}`.trim().toLowerCase();
      const tag =
        outboundJsonDisplayTag(value) || `JSON outbound #${index + 1}`;
      if (!['selector', 'urltest', 'fallback', 'dns', 'block'].includes(type)) {
        names.push(tag);
      }
    },
  );

  const taken = new Set();
  return names.map((name: string) => {
    const base = `${name || ''}`.trim();
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
function currentUrlTestNameChoices(section_id: string) {
  const choices: Array<{ value: string; label: string }> = [];
  const seen = new Set<string>();
  const listOption = outboundNameSourceOptions.get('urltest');
  const store = listOption
    ? childPendingSettingsStore(listOption, section_id)
    : {};

  currentSourceOptionValues(section_id, 'urltest').forEach((value: unknown) => {
    const itemValue = `${value || ''}`.trim();
    if (!itemValue) {
      return;
    }

    const staged = store[itemValue];
    const name = `${
      (staged && staged.name) ||
      childItemInputValue(section_id, itemValue, 'urltest', 'name') ||
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
export function addUrlTestMemberOption(
  itemSection: CBISection,
  parentSectionForItem: (itemId: string) => string,
  modes: Array<{ value: string; label: string }>,
) {
  const option = itemSection.option(
    form.DynamicList,
    'include_groups',
    _('Add URLTest'),
    _('The group joins as the single node it has selected'),
  );
  modes
    .map((mode) => mode.value)
    .filter((mode) => mode !== 'direct')
    .forEach((mode) => option.depends('server_filter_mode', mode));
  option.rmempty = true;
  option.placeholder = _('-- Select --');
  option.load = function (itemId: string) {
    const values = normalizeOptionValues(
      optionMapValue(this, itemId, 'include_groups'),
    );
    refreshOptionChoices(
      this,
      currentUrlTestNameChoices(parentSectionForItem(itemId)),
    );
    return values;
  };
  configureLiveDynamicListChoices(
    option,
    (itemId: string) => currentUrlTestNameChoices(parentSectionForItem(itemId)),
    parentSectionForItem,
  );
  return option;
}

export function refreshDashboardFilterChoiceWidgets(section_id: string) {
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
