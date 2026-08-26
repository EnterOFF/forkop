import { FORKOP_UCI_PACKAGE } from '../../../constants';
import {
  applyChildItemSettings,
  childItemInputValue,
  getChildItemIds,
  isExistingChildItem,
  nextSectionId,
  parentSectionIdForItem,
} from '../../cbi/childItems';
import { ButtonAddSettingsDynamicList } from '../../cbi/dynamicList';
import {
  childPendingSettingsStore,
  readChildSettings,
} from '../../cbi/itemSettings';
import {
  addDynamicListItem,
  updateDynamicListItemLabel,
  validateUniqueDynamicListItemName,
} from '../../cbi/listItems';
import {
  nextDynamicListName,
  normalizeDynamicListItems,
} from '../../cbi/listValues';
import { showChildItemSettingsModal } from '../../cbi/modal';
import { addUrlTestMemberOption } from './outboundNames';
import {
  addServerFilterOptions,
  groupServerFilterDescriptions,
} from './serverFilters';
import {
  urlTestUrlChoices,
  validateExpectedStatus,
  validateUrlTestUrl,
} from './urltest';
import { validateRequiredSingBoxDuration } from './validators';

function fallbackGroupSettingsKeys() {
  return [
    'name',
    'health_check_url',
    'health_check_interval',
    'health_check_timeout',
    'attempt_timeout',
    'expected_status',
    'idle_timeout',
    'interrupt_exist_connections',
    'hide_dashboard_members',
  ];
}

export function fallbackGroupChildDefaults() {
  return {
    health_check_url: 'https://www.gstatic.com/generate_204',
    health_check_interval: '5m',
    health_check_timeout: '5s',
    attempt_timeout: '5s',
    expected_status: '*',
    idle_timeout: '5m',
    interrupt_exist_connections: '0',
    hide_dashboard_members: '0',
  };
}

function defaultFallbackGroupSettings(name: string = '') {
  return { name, ...fallbackGroupChildDefaults() };
}

function fallbackLevelSettingsKeys() {
  return [
    'name',
    'order',
    'server_filter_mode',
    'include_outbounds',
    'include_groups',
    'include_regex',
    'exclude_outbounds',
    'exclude_types',
    'exclude_regex',
  ];
}

function defaultFallbackLevelSettings() {
  return {
    name: '',
    order: '0',
    server_filter_mode: 'include',
  };
}

function fallbackLevelSettingsForValidation(
  groupId: string,
  levelId: string,
  option: CBIOption,
) {
  const store = childPendingSettingsStore(option, groupId);

  if (isExistingChildItem(groupId, levelId, 'fallback_level', 'group')) {
    return readChildSettings(
      levelId,
      fallbackLevelSettingsKeys(),
      defaultFallbackLevelSettings(),
    );
  }

  return Object.assign({}, store[levelId] || {});
}

function validateFallbackLevelItemsBeforeSave(
  groupId: string,
  values: unknown,
  option: CBIOption,
) {
  const normalizedValues = normalizeDynamicListItems(values);
  if (!normalizedValues.length) {
    return _('Add at least one server group');
  }

  const names = new Set();
  for (const value of normalizedValues) {
    const levelId = `${value || ''}`;
    const settings = fallbackLevelSettingsForValidation(
      groupId,
      levelId,
      option,
    );

    if (!`${settings.name || ''}`.trim()) {
      return _('Enter a server group name');
    }
    const name = `${settings.name}`.trim();
    if (names.has(name)) return _('Server group names must be unique');
    names.add(name);
  }

  return true;
}

function addFallbackLevelItemOptions(
  itemSection: CBISection,
  options: Partial<ChildItemDialogContext> = {},
) {
  const parentSectionForItem =
    typeof options.parentSectionId === 'function'
      ? options.parentSectionId
      : parentSectionIdForItem;

  const o = itemSection.option(form.Value, 'name', _('Group name'));
  o.rmempty = false;
  o.validate = function (_itemId: string, value: unknown) {
    if (!`${value || ''}`.trim()) return _('Enter a server group name');
    return typeof options.validateName === 'function'
      ? options.validateName!(value)
      : true;
  };

  const fallbackLevelModes = [
    { value: 'all', label: _('All remaining') },
    { value: 'exclude', label: _('All except selected') },
    { value: 'include', label: _('Only selected') },
    { value: 'direct', label: _('Direct') },
  ];
  addUrlTestMemberOption(itemSection, parentSectionForItem, fallbackLevelModes);

  addServerFilterOptions(itemSection, parentSectionForItem, {
    modeLabel: _('Server filter'),
    modeDescription: _('Which servers end up in the group'),
    modes: fallbackLevelModes,
    defaultMode: 'include',
    groupContext: true,
    ...groupServerFilterDescriptions(),
  });
}

function addFallbackGroupItemOptions(
  itemSection: CBISection,
  options: Partial<ChildItemDialogContext> = {},
) {
  const parentSectionForGroup =
    typeof options.parentSectionId === 'function'
      ? options.parentSectionId
      : parentSectionIdForItem;
  const ownerId =
    typeof options.ownerId === 'function' ? options.ownerId : () => '';

  let o = itemSection.option(form.Value, 'name', _('Group name'));
  o.rmempty = false;
  o.validate = function (_itemId: string, value: unknown) {
    return `${value || ''}`.trim()
      ? (options.validateName?.(value) ?? true)
      : _('Enter a display name');
  };

  o = itemSection.option(
    form.Value,
    'health_check_url',
    _('Check URL'),
    _('Availability check for every server'),
  );
  o.default = 'https://www.gstatic.com/generate_204';
  o.rmempty = false;
  urlTestUrlChoices().forEach((value: string) => o.value(value));
  o.validate = function (_itemId: string, value: unknown) {
    return validateUrlTestUrl(value);
  };

  o = itemSection.option(
    form.Value,
    'expected_status',
    _('Expected status'),
    _(
      'HTTP status codes of a successful check. * is any response, or values and ranges: 204/200-299',
    ),
  );
  o.default = '*';
  o.rmempty = false;
  o.validate = function (_itemId: string, value: unknown) {
    return validateExpectedStatus(value);
  };

  o = itemSection.option(
    form.Value,
    'health_check_interval',
    _('Check interval'),
    _('How often every server of the group is checked'),
  );
  o.default = '5m';
  o.rmempty = false;
  o.validate = function (_itemId: string, value: unknown) {
    return validateRequiredSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Value,
    'health_check_timeout',
    _('Check timeout'),
    _('How long to wait for a server to answer'),
  );
  o.default = '5s';
  o.rmempty = false;
  o.validate = function (_itemId: string, value: unknown) {
    return validateRequiredSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Value,
    'attempt_timeout',
    _('Connection timeout'),
    _('How long to wait for a connection before moving to the next server'),
  );
  o.default = '5s';
  o.rmempty = false;
  o.validate = function (_itemId: string, value: unknown) {
    return validateRequiredSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Value,
    'idle_timeout',
    _('Idle timeout'),
    _('How long until health checks stop when the group is unused'),
  );
  o.default = '5m';
  o.rmempty = false;
  o.validate = function (_itemId: string, value: unknown) {
    return validateRequiredSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Flag,
    'interrupt_exist_connections',
    _('Interrupt connections'),
    _('Drop every active connection when the selected server changes'),
  );
  o.default = '0';
  o.rmempty = false;

  o = itemSection.option(
    form.Flag,
    'hide_dashboard_members',
    _('Hide group servers'),
    _('Hide servers included in this group from the dashboard'),
  );
  o.default = '0';
  o.rmempty = false;

  o = itemSection.option(
    ButtonAddSettingsDynamicList,
    'fallback_level',
    _('Server groups'),
    _('Required. Checked from top to bottom until the first working server'),
  );
  o.rmempty = false;
  o.modalonly = true;
  o.addButtonLabel = _('+ Add servers');
  o.childType = 'fallback_level';
  o.ownerOption = 'group';
  o.childOwnerId = ownerId;
  o.parentSectionId = parentSectionForGroup;
  o.childValueOption = 'name';
  o.childDefaults = defaultFallbackLevelSettings();
  o.createId = () => nextSectionId('fallback_level');
  o.renderItemSettingsModal = showFallbackLevelSettingsModal;
  o.validateItemsOnSave = function (groupId: string, values: unknown) {
    return validateFallbackLevelItemsBeforeSave(groupId, values, this);
  };
  o.validate = function (groupId: string, value: unknown) {
    if (!`${value || ''}`.trim()) {
      const current =
        typeof this.formvalue === 'function' ? this.formvalue(groupId) : [];
      return normalizeDynamicListItems(current).length
        ? true
        : _('Add at least one server group');
    }
    return true;
  };
  o.hasItemSettings = function (groupId: string, value: unknown) {
    const normalized = `${value || ''}`.trim();

    if (isExistingChildItem(groupId, normalized, 'fallback_level', 'group')) {
      return true;
    }

    return normalized.length > 0;
  };
  o.inputValueForItem = function (groupId: string, value: unknown) {
    const inputValue = childItemInputValue(
      groupId,
      value,
      'fallback_level',
      'name',
      'group',
    );
    const store = childPendingSettingsStore(this, groupId);
    return store[inputValue] && store[inputValue].name
      ? `${store[inputValue].name}`
      : inputValue;
  };
  o.stagedChildSettings = function (groupId: string, value: unknown) {
    const id = childItemInputValue(
      groupId,
      value,
      'fallback_level',
      'name',
      'group',
    );
    const store = childPendingSettingsStore(this, groupId);
    return store[id] ? Object.assign({}, store[id]) : null;
  };
  o.clearStagedChildSettings = function (groupId: string) {
    if (this.pendingChildSettings) {
      delete this.pendingChildSettings[groupId];
    }
  };
  o.afterMaterializeChildItems = function (
    _groupId: string,
    itemIds: string[],
  ) {
    itemIds.forEach((itemId: string, index: number) => {
      uci.set(FORKOP_UCI_PACKAGE, itemId, 'order', `${index}`);
    });
  };
  o.renderListItemLabel = function (groupId: string, itemId: string) {
    return E(
      'span',
      { class: 'fkp-dynlist-label' },
      this.inputValueForItem!(groupId, itemId),
    );
  };
}

function showFallbackLevelSettingsModal(
  groupId: string,
  itemValue: unknown,
  option: CBIOption,
  widget: CBIWidget,
  itemNode: Element | null,
  context: ChildItemModalContext = {},
) {
  const defaults = defaultFallbackLevelSettings();
  if (context.adding) {
    defaults.name = nextDynamicListName(
      option,
      'settings',
      getChildItemIds(groupId, 'fallback_level', 'group'),
      'Group',
    );
  }

  return showChildItemSettingsModal(groupId, itemValue, option, {
    typeName: 'fallback_level',
    ownerOption: 'group',
    valueOption: 'name',
    keys: fallbackLevelSettingsKeys(),
    itemNode,
    defaults,
    addOptions: (itemSection: CBISection) =>
      addFallbackLevelItemOptions(itemSection, {
        parentSectionId: () => `${context.parentSectionId ?? ''}`,
        validateName: validateUniqueDynamicListItemName.bind(
          null,
          widget,
          itemNode,
        ),
      }),
    title: (name: string) => {
      const normalized = `${name || ''}`.trim();
      return normalized
        ? `${_('Server group settings')}: ${normalized}`
        : _('Server group settings');
    },
    afterSave: (
      itemId: string,
      inputValue: unknown,
      settings: ChildSettings,
      existing: boolean,
    ) => {
      const displayName = `${settings.name || inputValue || ''}`.trim();

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

function createFallbackGroupItem(
  section_id: string,
  groupId: string,
  settings: ChildSettings,
) {
  const created =
    uci.add(FORKOP_UCI_PACKAGE, 'fallback_group', groupId) || groupId;

  uci.set(FORKOP_UCI_PACKAGE, created, 'section', section_id);
  Object.entries(fallbackGroupChildDefaults()).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      uci.set(FORKOP_UCI_PACKAGE, created, key, `${value}`);
    }
  });
  applyChildItemSettings(created, settings);

  return created;
}

export function showFallbackGroupSettingsModal(
  section_id: string,
  itemValue: unknown,
  option: CBIOption,
  widget: CBIWidget,
  itemNode: Element | null,
  context: ChildItemModalContext = {},
) {
  const groupId = context.adding
    ? nextSectionId('fallback_group')
    : `${itemValue || ''}`.trim();

  if (!groupId) {
    return null;
  }

  const defaultName = context.adding
    ? nextDynamicListName(
        option,
        section_id,
        getChildItemIds(section_id, 'fallback_group'),
        'Fallback',
      )
    : '';

  return showChildItemSettingsModal(section_id, groupId, option, {
    typeName: 'fallback_group',
    valueOption: 'name',
    keys: fallbackGroupSettingsKeys(),
    defaults: defaultFallbackGroupSettings(defaultName),
    addOptions: addFallbackGroupItemOptions,
    validateName: validateUniqueDynamicListItemName.bind(
      null,
      widget,
      itemNode,
    ),
    title: (name: string) => {
      if (context.adding) {
        return _('Fallback settings');
      }

      const normalized = `${name || ''}`.trim();
      return normalized
        ? `${_('Fallback settings')}: ${normalized}`
        : _('Fallback settings');
    },
    afterSave: (
      itemId: string,
      inputValue: unknown,
      settings: ChildSettings,
      existing: boolean,
    ) => {
      const displayName = `${settings.name || inputValue || ''}`.trim();

      if (!existing) {
        const created = createFallbackGroupItem(section_id, groupId, settings);
        const store = childPendingSettingsStore(option, section_id);
        delete store[groupId];
        delete store[`${inputValue}`];
        delete store[displayName];
        addDynamicListItem(widget, created, displayName);
        return;
      }

      updateDynamicListItemLabel(itemNode, displayName);
    },
  });
}

export function validateFallbackGroupItemsBeforeSave(
  section_id: string,
  values: unknown,
) {
  for (const value of normalizeDynamicListItems(values)) {
    const groupId = `${value || ''}`.trim();

    if (!isExistingChildItem(section_id, groupId, 'fallback_group')) {
      return _('Open Fallback settings and enter a display name');
    }

    if (!`${uci.get(FORKOP_UCI_PACKAGE, groupId, 'name') || ''}`.trim()) {
      return _('Enter a display name');
    }
  }

  return true;
}
