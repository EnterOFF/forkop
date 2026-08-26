import { FORKOP_UCI_PACKAGE } from '../../constants';
import { normalizeDynamicListItems } from './listValues';

const sharedChildPendingSettings = new Map<
  string,
  Record<string, ChildSettings>
>();

export function readItemSettingsMap(
  section_id: string,
  settingsKey: string,
): Record<string, ChildSettings> {
  const raw = uci.get(FORKOP_UCI_PACKAGE, section_id, settingsKey);

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(`${raw}`);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (_error) {
    return {};
  }
}

function compactItemSettings(values: ChildSettings): ChildSettings {
  const result: ChildSettings = {};

  Object.entries(values || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    if (Array.isArray(value)) {
      const items = value
        .map((item) => `${item || ''}`.trim())
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

function writeItemSettingsMap(
  section_id: string,
  settingsKey: string,
  map: Record<string, ChildSettings>,
) {
  const result: Record<string, ChildSettings> = {};

  Object.entries(map || {}).forEach(([item, settings]) => {
    const compact = compactItemSettings(settings);
    if (item && Object.keys(compact).length) {
      result[item] = compact;
    }
  });

  if (Object.keys(result).length) {
    uci.set(
      FORKOP_UCI_PACKAGE,
      section_id,
      settingsKey,
      JSON.stringify(result),
    );
  } else {
    uci.unset(FORKOP_UCI_PACKAGE, section_id, settingsKey);
  }
}

export function cleanupListItemSettings(
  section_id: string,
  settingsKey: string | undefined,
  values: unknown,
) {
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

export function itemSettingsFlag(
  settings: ChildSettings | null | undefined,
  key: string,
  defaultValue: boolean,
): boolean {
  const value = settings ? settings[key] : null;

  if (value === undefined || value === null || value === '') {
    return Boolean(defaultValue);
  }

  return value === true || `${value}` === '1';
}

export function settingValueEquals(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => {
    if (Array.isArray(value)) {
      return JSON.stringify(value.map((item) => `${item || ''}`));
    }

    return value === undefined || value === null ? '' : `${value}`;
  };

  return normalize(left) === normalize(right);
}

export function readChildSettings(
  itemId: string,
  keys: string[],
  defaults: ChildSettings,
): ChildSettings {
  const result = Object.assign({}, defaults || {});

  keys.forEach((key: string) => {
    const value = uci.get(FORKOP_UCI_PACKAGE, itemId, key);
    if (value !== null && value !== undefined) {
      result[key] = Array.isArray(value) ? value.slice() : value;
    }
  });

  return result;
}

export function changedSettings(
  base: ChildSettings,
  next: ChildSettings,
  keys: string[],
): ChildSettings {
  const result: ChildSettings = {};

  keys.forEach((key: string) => {
    if (!settingValueEquals(base ? base[key] : null, next ? next[key] : null)) {
      result[key] = next ? next[key] : null;
    }
  });

  return result;
}

export function hasChangedSettings(settings: ChildSettings): boolean {
  return Object.keys(settings || {}).length > 0;
}

export function childPendingSettingsStore(
  option: CBIOption,
  section_id: string,
): Record<string, ChildSettings> {
  if (option.sharedPendingSettingsKey) {
    const key = `${option.sharedPendingSettingsKey}:${section_id}`;
    if (!sharedChildPendingSettings.has(key)) {
      sharedChildPendingSettings.set(key, {});
    }
    return sharedChildPendingSettings.get(key) as Record<string, ChildSettings>;
  }

  if (!option.pendingChildSettings) {
    option.pendingChildSettings = {};
  }

  if (!option.pendingChildSettings[section_id]) {
    option.pendingChildSettings[section_id] = {};
  }

  return option.pendingChildSettings[section_id];
}

export function pendingChildSettings(
  option: CBIOption,
  section_id: string,
  value: unknown,
  defaults: ChildSettings,
): ChildSettings {
  const itemValue = `${value || ''}`.trim();
  const store = childPendingSettingsStore(option, section_id);

  if (!store[itemValue]) {
    store[itemValue] = Object.assign({}, defaults || {});
  }

  return store[itemValue];
}

export function clearChildPendingSettings(
  option: CBIOption,
  section_id: string,
) {
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
