import {
  FORKOP_UCI_PACKAGE,
  LATENCY_TEST_URL_OPTIONS,
} from '../../../constants';
import { validateUrlField } from '../../../validators/validateUrl';
import {
  childItemNameCheck,
  getChildItemIds,
  isExistingChildItem,
  parentSectionIdForItem,
} from '../../cbi/childItems';
import { childPendingSettingsStore } from '../../cbi/itemSettings';
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
import {
  addExpectedStatusOption,
  addGroupHealthCheckTailOptions,
} from './healthCheck';
import {
  addServerFilterOptions,
  groupServerFilterDescriptions,
} from './serverFilters';
import { optionMapValue } from './subscriptions/model';
import { validateRequiredSingBoxDuration } from '../../../validators/validateSingBoxDuration';

function validateUrlTestTolerance(value: unknown) {
  if (!value || `${value}`.length === 0) {
    return _('Must be a number in the range of 0 - 10000');
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

  return _('Must be a number in the range of 0 - 10000');
}

function urlTestSettingsKeys() {
  return [
    'name',
    'check_interval',
    'tolerance',
    'testing_url',
    'expected_status',
    'idle_timeout',
    'interrupt_exist_connections',
    'server_filter_mode',
    'include_outbounds',
    'include_regex',
    'exclude_outbounds',
    'exclude_types',
    'exclude_regex',
  ];
}

export function urlTestChildDefaults() {
  return {
    check_interval: '3m',
    tolerance: '50',
    testing_url: 'https://www.gstatic.com/generate_204',
    expected_status: '*',
    idle_timeout: '30m',
    interrupt_exist_connections: '0',
    server_filter_mode: 'all',
  };
}

function defaultUrlTestSettings(name: string) {
  return { name: `${name || ''}`, ...urlTestChildDefaults() };
}

function addUrlTestItemOptions(
  itemSection: CBISection,
  options: Partial<ChildItemDialogContext> = {},
) {
  const parentSectionForItem =
    typeof options.parentSectionId === 'function'
      ? options.parentSectionId
      : parentSectionIdForItem;

  let o = itemSection.option(form.Value, 'name', _('Group name'));
  o.rmempty = false;
  o.load = function (itemId: string) {
    return (
      optionMapValue(this, itemId, 'name') ||
      optionMapValue(this, itemId, 'display_name') ||
      ''
    );
  };
  o.validate = childItemNameCheck(options);

  o = itemSection.option(
    form.Value,
    'testing_url',
    _('Check URL'),
    _('Latency measurement for every server'),
  );
  o.default = 'https://www.gstatic.com/generate_204';
  o.rmempty = false;
  LATENCY_TEST_URL_OPTIONS.forEach((value: string) => o.value(value));
  o.validate = function (_itemId: string, value: unknown) {
    return validateUrlField(value);
  };

  addExpectedStatusOption(itemSection);

  o = itemSection.option(
    form.Value,
    'check_interval',
    _('Check interval'),
    _('How often every server of the group is checked'),
  );
  o.default = '3m';
  o.rmempty = false;
  o.validate = function (_itemId: string, value: unknown) {
    return validateRequiredSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Value,
    'tolerance',
    _('Latency difference'),
    _('Switching threshold in ms at which to move to a faster server'),
  );
  o.default = '50';
  o.rmempty = false;
  o.validate = function (_itemId: string, value: unknown) {
    return validateUrlTestTolerance(value);
  };

  addGroupHealthCheckTailOptions(itemSection, '30m');

  addServerFilterOptions(itemSection, parentSectionForItem, {
    groupContext: true,
    modeLabel: _('Server filter'),
    modeDescription: _('Which servers end up in the group'),
    modes: [
      { value: 'all', label: _('All servers') },
      { value: 'exclude', label: _('All except selected') },
      { value: 'include', label: _('Only selected') },
    ],
    ...groupServerFilterDescriptions(),
  });
}

export function showUrlTestSettingsModal(
  _section_id: string,
  itemValue: unknown,
  option: CBIOption,
  widget: CBIWidget,
  itemNode: Element | null,
  context: ChildItemModalContext = {},
) {
  const defaultName = context.adding
    ? nextDynamicListName(
        option,
        _section_id,
        getChildItemIds(_section_id, 'urltest'),
        'URLTest',
      )
    : '';
  return showChildItemSettingsModal(_section_id, itemValue, option, {
    typeName: 'urltest',
    valueOption: 'name',
    keys: urlTestSettingsKeys(),
    itemNode,
    defaults: () => defaultUrlTestSettings(defaultName),
    addOptions: addUrlTestItemOptions,
    validateName: validateUniqueDynamicListItemName.bind(
      null,
      widget,
      itemNode,
    ),
    title: (name: string) => {
      const normalized = `${name || ''}`.trim();
      return !normalized || /^urltest-[a-z0-9]+-\d+$/.test(normalized)
        ? _('URLTest settings')
        : _('URLTest: %s').format(normalized);
    },
    afterSave: (
      itemId: string,
      inputValue: unknown,
      settings: ChildSettings,
      existing: boolean,
    ) => {
      const displayName = `${settings.name || inputValue || ''}`.trim();

      if (existing) {
        uci.unset(FORKOP_UCI_PACKAGE, itemId, 'id');
        uci.unset(FORKOP_UCI_PACKAGE, itemId, 'display_name');
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

export function validateUrlTestItemsBeforeSave(
  section_id: string,
  values: unknown,
  option: CBIOption,
) {
  const store = childPendingSettingsStore(option, section_id);

  for (const value of normalizeDynamicListItems(values)) {
    const itemId = `${value || ''}`;
    let name = '';

    if (isExistingChildItem(section_id, itemId, 'urltest')) {
      name = `${
        uci.get(FORKOP_UCI_PACKAGE, itemId, 'name') ||
        uci.get(FORKOP_UCI_PACKAGE, itemId, 'display_name') ||
        ''
      }`;
    } else if (store[itemId]) {
      name = `${store[itemId].name || ''}`;
    }

    if (!`${name || ''}`.trim()) {
      return _('Enter a display name');
    }
  }

  return true;
}
