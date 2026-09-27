import { FORKOP_UCI_PACKAGE } from '../../../../constants';
import { validatePath } from '../../../../validators/validatePath';
import { validateUrl } from '../../../../validators/validateUrl';
import { getChildItemIds, isExistingChildItem } from '../../../cbi/childItems';
import { childPendingSettingsStore } from '../../../cbi/itemSettings';
import { modalOptionFormValue } from '../../../cbi/modal';
import { subscriptionOverrideKeys } from './overrides';

export let defaultSubscriptionHeaderLines: string[] = [];

let defaultSubscriptionHeadersPromise: Promise<string[]> | null = null;

export function loadDefaultSubscriptionHeaders() {
  if (defaultSubscriptionHeadersPromise) {
    return defaultSubscriptionHeadersPromise;
  }

  defaultSubscriptionHeadersPromise = fs
    .exec('/usr/bin/forkop', ['get_subscription_default_headers'])
    .then((response) => {
      if (response.code) {
        throw new Error(_('Failed to load default subscription headers'));
      }

      const parsed = JSON.parse(response.stdout || '[]');
      if (!Array.isArray(parsed)) {
        throw new Error(_('Failed to load default subscription headers'));
      }

      defaultSubscriptionHeaderLines = parsed
        .map((value: unknown) => `${value || ''}`.trim())
        .filter(Boolean);
      return defaultSubscriptionHeaderLines.slice();
    })
    .catch((error) => {
      defaultSubscriptionHeadersPromise = null;
      throw error;
    });

  return defaultSubscriptionHeadersPromise;
}

export function optionMapValue(
  option: CBIOption,
  section_id: string,
  key: string,
) {
  const value =
    option && option.map && option.map.data
      ? option.map.data.get(option.map.config, section_id, key)
      : uci.get(FORKOP_UCI_PACKAGE, section_id, key);

  return value == null ? '' : value;
}

// What another option of the same dialog holds now: its widget's value once it
// is rendered, the stored one before that. A check reads this, so it sees a
// switch the user has just turned on.
export function currentOptionValue(
  option: CBIOption,
  section_id: string,
  key: string,
) {
  const value = modalOptionFormValue(option.map, section_id, key);
  return value == null ? optionMapValue(option, section_id, key) : value;
}

function remoteSubscriptionUrlSettingsKeys() {
  return [
    'subscription_update_enabled',
    'subscription_update_interval',
    'download_via_proxy_enabled',
    'download_via_proxy_section',
    'header',
    'show_dashboard_metadata',
  ];
}

export function subscriptionUrlSettingsKeys(remote: boolean = true) {
  const keys = [
    'tag',
    'server_filter_mode',
    'include_outbounds',
    'include_regex',
    'exclude_outbounds',
    'exclude_types',
    'exclude_regex',
    ...subscriptionOverrideKeys(),
  ];
  return remote ? [...remoteSubscriptionUrlSettingsKeys(), ...keys] : keys;
}

export function cleanupRemoteSubscriptionUrlSettings(itemId: string) {
  remoteSubscriptionUrlSettingsKeys().forEach((key: string) =>
    uci.unset(FORKOP_UCI_PACKAGE, itemId, key),
  );
}

// A value here is only sound for an option the dialog either shows or keeps: a
// hidden field without retain is removed from the section when the dialog is
// saved, so seeding one would make the stored item something its own dialog
// never writes, and opening it and pressing Save without a change would delete
// the value again.
export function defaultSubscriptionUrlSettings(
  headers: string[] = [],
  tag: string = 'sub1',
  remote: boolean = true,
) {
  const settings = {
    tag,
    server_filter_mode: 'all',
  };
  if (remote) {
    Object.assign(settings, {
      subscription_update_enabled: '1',
      subscription_update_interval: '1h',
      download_via_proxy_enabled: '0',
      header: Array.isArray(headers) ? headers.slice() : [],
      show_dashboard_metadata: '1',
    });
  }
  return settings;
}

// The subscriptions a section has, as its dialog currently holds them: the
// entries of the live list, so one the user added or took out counts before the
// section is saved. A widget that is not on screen - a headless parse, a list
// that has not rendered - answers with nothing, and the stored children are then
// the whole truth.
export function listedSubscriptionValues(
  sectionId: string,
  option: CBIOption,
): string[] {
  return (
    liveListValues(option, sectionId) ||
    getChildItemIds(sectionId, 'subscription_url')
  );
}

function liveListValues(option: CBIOption, sectionId: string) {
  let values: unknown = null;

  try {
    values = option && option.formvalue ? option.formvalue(sectionId) : null;
  } catch (_error) {
    return null;
  }

  return Array.isArray(values)
    ? values.map((value) => `${value || ''}`.trim()).filter(Boolean)
    : null;
}

// The tag one entry carries: what its section stores, or - while the entry is
// still a draft the section has never been saved with - what the list is holding
// for it.
function listedSubscriptionTag(
  sectionId: string,
  option: CBIOption,
  value: string,
) {
  if (isExistingChildItem(sectionId, value, 'subscription_url')) {
    return `${uci.get(FORKOP_UCI_PACKAGE, value, 'tag') || ''}`.trim();
  }

  return `${childPendingSettingsStore(option, sectionId)[value]?.tag || ''}`.trim();
}

// Every tag the section's subscriptions hold, including the one a subscription
// whose dialog was never opened carries from the moment its link was added.
export function configuredSubscriptionTags(
  sectionId: string,
  option: CBIOption,
  excluded: string[] = [],
  values: string[] = listedSubscriptionValues(sectionId, option),
) {
  return values
    .filter((value) => !excluded.includes(value))
    .map((value) => listedSubscriptionTag(sectionId, option, value))
    .filter(Boolean);
}

// sub{N}, where N counts the subscriptions the section already names: a new one
// is numbered after the last instead of filling the gap a removed one left, and
// moves on while a sibling still holds that number.
export function nextSubscriptionTag(
  sectionId: string,
  option: CBIOption,
  values: string[] = listedSubscriptionValues(sectionId, option),
) {
  const taken = new Set(
    configuredSubscriptionTags(sectionId, option, [], values),
  );
  for (let number = taken.size + 1; number < 100000; number += 1) {
    const value = `sub${number}`;
    if (!taken.has(value)) return value;
  }
  return `sub${Date.now()}`;
}

// Names every entry of the list that has no name yet, which is how a subscription
// gets its tag the moment its link is added rather than when someone opens its
// dialog: the dialog then shows the name it will be saved under, the uniqueness
// check counts it, and the section's save writes it. A link taken back out of the
// list gives its name up again, along with everything else its dialog had staged.
export function reserveSubscriptionTags(
  sectionId: string,
  option: CBIOption,
  values: string[],
) {
  const store = childPendingSettingsStore(option, sectionId);
  const drafts = values.filter(
    (value) => !isExistingChildItem(sectionId, value, 'subscription_url'),
  );

  Object.keys(store).forEach((value) => {
    if (!drafts.includes(value)) delete store[value];
  });

  drafts.forEach((value) => {
    if (listedSubscriptionTag(sectionId, option, value)) return;
    store[value] = Object.assign({}, store[value], {
      tag: nextSubscriptionTag(sectionId, option, values),
    });
  });
}

function parseSubscriptionUrlEntry(
  value: unknown,
): { valid: true; url: string } | { valid: false; message: string } {
  const normalized = value ? `${value}`.trim() : '';

  if (!normalized.length) {
    return { valid: true, url: '' };
  }

  if (normalized.includes('|')) {
    return {
      valid: false,
      message: _('Configure User-Agent in the item settings'),
    };
  }

  return { valid: true, url: normalized };
}

export function isRemoteSubscriptionSource(value: unknown) {
  const source = `${value || ''}`.trim();
  return source.startsWith('http://') || source.startsWith('https://');
}

export function validateSubscriptionUrlEntry(
  _section_id: string,
  value: string,
) {
  if (!value || value.length === 0) {
    return true;
  }

  const parsed = parseSubscriptionUrlEntry(value);
  if (!parsed.valid) {
    return parsed.message;
  }

  const validation = isRemoteSubscriptionSource(parsed.url)
    ? validateUrl(`${parsed.url}`)
    : validatePath(`${parsed.url}`);
  return validation.valid
    ? true
    : _('Subscription must be an HTTP(S) URL or an absolute local path');
}
