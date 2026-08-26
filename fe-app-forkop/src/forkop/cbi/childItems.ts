import { FORKOP_UCI_PACKAGE } from '../../constants';
import { settingValueEquals } from './itemSettings';
import {
  findDynamicListItemByValue,
  setDynamicListItemValue,
} from './listItems';
import { normalizeDynamicListItems } from './listValues';

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
const SECTION_ID_PREFIXES: Record<string, string> = {
  fallback_group: 'group',
  fallback_level: 'level',
  section: 'section',
  section_interface: 'iface',
  server: 'server',
  server_client: 'client',
  subscription_url: 'sub',
  tunnel: 'tunnel',
  tunnel_peer: 'peer',
  urltest: 'urltest',
};

const issuedSectionIds = new Set<string>();

export function nextSectionId(typeName: string) {
  const prefix = SECTION_ID_PREFIXES[typeName] || typeName;

  for (let i = 0; i < 100; i += 1) {
    const id = `${prefix}_${Math.floor(Math.random() * 0x1000000)
      .toString(16)
      .padStart(6, '0')}`;

    // A staged child reaches uci only when its parent is saved, so an id handed out
    // earlier in the same dialog is not visible through uci.get() yet.
    if (!issuedSectionIds.has(id) && !uci.get(FORKOP_UCI_PACKAGE, id)) {
      issuedSectionIds.add(id);
      return id;
    }
  }

  return `${prefix}_${Date.now().toString(16)}`;
}

function childOwnerOption(ownerOption?: string) {
  return ownerOption || 'section';
}

function childItemOrder(item: UciSectionObject) {
  const value = item ? item.order : null;
  const parsed = Number.parseInt(value == null ? '0' : `${value}`, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getChildItemIds(
  section_id: string,
  typeName: string | undefined,
  ownerOption?: string,
): string[] {
  const ownerKey = childOwnerOption(ownerOption);
  const items = uci
    .sections(FORKOP_UCI_PACKAGE, typeName)
    .filter((item) => item[ownerKey] === section_id);

  if (
    ['fallback_level', 'tunnel', 'tunnel_peer'].includes(typeName as string)
  ) {
    items.sort((a, b) => {
      const orderDiff = childItemOrder(a) - childItemOrder(b);
      if (orderDiff !== 0) {
        return orderDiff;
      }

      return `${a['.name'] || ''}`.localeCompare(`${b['.name'] || ''}`);
    });
  }

  return items.map((item) => item['.name']).filter(Boolean);
}

function childItemValue(
  itemId: string,
  valueOption: string | undefined,
  fallback: string,
): string {
  if (!valueOption) {
    return itemId;
  }

  const value = uci.get(FORKOP_UCI_PACKAGE, itemId, valueOption);
  return value == null || value === '' ? fallback || itemId : `${value}`;
}

export function childItemInputValue(
  section_id: string,
  value: unknown,
  typeName: string | undefined,
  valueOption: string | undefined,
  ownerOption?: string,
): string {
  const itemId = `${value || ''}`;

  if (isExistingChildItem(section_id, itemId, typeName, ownerOption)) {
    return childItemValue(itemId, valueOption, itemId);
  }

  return itemId;
}

export function isExistingChildItem(
  section_id: string,
  itemId: string,
  typeName: string | undefined,
  ownerOption?: string,
): boolean {
  const ownerKey = childOwnerOption(ownerOption);

  return Boolean(
    itemId &&
      uci.get(FORKOP_UCI_PACKAGE, itemId, '.type') === typeName &&
      uci.get(FORKOP_UCI_PACKAGE, itemId, ownerKey) === section_id,
  );
}

function createChildItem(
  section_id: string,
  options: ChildItemOptions,
  inputValue: unknown,
) {
  const rawValue = `${inputValue || ''}`.trim();

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
    typeof options.createId === 'function'
      ? `${options.createId(rawValue, section_id) || ''}`.trim()
      : '';
  const itemId =
    (requestedId &&
      uci.add(FORKOP_UCI_PACKAGE, options.typeName as string, requestedId)) ||
    requestedId ||
    uci.add(FORKOP_UCI_PACKAGE, options.typeName as string);

  uci.set(
    FORKOP_UCI_PACKAGE,
    itemId,
    childOwnerOption(options.ownerOption),
    section_id,
  );

  if (options.valueOption) {
    uci.set(FORKOP_UCI_PACKAGE, itemId, options.valueOption, rawValue);
  }

  if (options.defaults && typeof options.defaults === 'object') {
    Object.entries(options.defaults).forEach(([key, value]) => {
      value =
        typeof value === 'function'
          ? value(rawValue, section_id, itemId)
          : value;
      if (value !== undefined && value !== null && value !== '') {
        uci.set(
          FORKOP_UCI_PACKAGE,
          itemId,
          key,
          Array.isArray(value)
            ? value.map((item) => `${item || ''}`).filter(Boolean)
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

export function applyChildItemSettings(
  itemId: string,
  settings: ChildSettings | null | undefined,
) {
  Object.entries(settings || {}).forEach(([key, value]) => {
    if (!key || key.charAt(0) === '.') {
      return;
    }

    // Writing a value the section already holds still counts as a change in
    // LuCI, so a dialog that rewrites its whole item - the tunnel one does, to
    // drop the fields of the kind it no longer is - would report every option
    // of that item as changed by a save that changed nothing.
    if (settingValueEquals(uci.get(FORKOP_UCI_PACKAGE, itemId, key), value)) {
      return;
    }

    if (value === undefined || value === null || value === '') {
      uci.unset(FORKOP_UCI_PACKAGE, itemId, key);
    } else if (Array.isArray(value)) {
      const values = value
        .map((item) => `${item || ''}`.trim())
        .filter((item) => item.length);
      if (values.length) {
        uci.set(FORKOP_UCI_PACKAGE, itemId, key, values);
      } else {
        uci.unset(FORKOP_UCI_PACKAGE, itemId, key);
      }
    } else {
      uci.set(FORKOP_UCI_PACKAGE, itemId, key, `${value}`);
    }
  });
}

export function materializeChildItems(
  section_id: string,
  options: ChildItemOptions,
  inputValue: unknown,
) {
  const itemIds: string[] = [];
  const seen = new Set<string>();
  const resolved = new Map<string, string>();

  normalizeDynamicListItems(inputValue).forEach((value) => {
    let itemId = resolved.get(value);

    if (itemId == null) {
      const createdItem = createChildItem(section_id, options, value);
      itemId = createdItem.value;
      const stagedSettings =
        createdItem.created && typeof options.stagedSettings === 'function'
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
export function adoptMaterializedChildItems(
  option: CBIOption,
  section_id: string,
  resolved: Map<string, string>,
) {
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

function cleanupFallbackLevelsForGroup(groupId: string) {
  getChildItemIds(groupId, 'fallback_level', 'group').forEach(
    (levelId: string) => {
      uci.remove(FORKOP_UCI_PACKAGE, levelId);
    },
  );
}

function cleanupTunnelPeers(tunnelId: string) {
  getChildItemIds(tunnelId, 'tunnel_peer', 'tunnel').forEach(
    (peerId: string) => {
      uci.remove(FORKOP_UCI_PACKAGE, peerId);
    },
  );
}

export function cleanupRemovedChildItems(
  section_id: string,
  typeName: string | undefined,
  keepValues: unknown,
  ownerOption?: string,
) {
  const keep = new Set(normalizeDynamicListItems(keepValues));

  getChildItemIds(section_id, typeName, ownerOption).forEach(
    (itemId: string) => {
      if (!keep.has(itemId)) {
        if (typeName === 'fallback_group') {
          cleanupFallbackLevelsForGroup(itemId);
        } else if (typeName === 'tunnel') {
          cleanupTunnelPeers(itemId);
        }
        uci.remove(FORKOP_UCI_PACKAGE, itemId);
      }
    },
  );
}

export function parentSectionIdForItem(itemId: string): string {
  return (uci.get(FORKOP_UCI_PACKAGE, itemId, 'section') as string) || '';
}
