import {
  childItemInputValue,
  parentSectionIdForItem,
} from '../../../cbi/childItems';
import {
  keepUnavailableSectionChoice,
  refreshOptionChoices,
} from '../../../cbi/choices';
import { showChildItemSettingsModal } from '../../../cbi/modal';
import { subscriptionDownloadTargetChoices } from '../references';
import {
  addServerFilterOptions,
  subscriptionServerFilterDescriptions,
} from '../serverFilters';
import {
  validateOptionalSingBoxDuration,
  validateRequiredSingBoxDuration,
} from '../../../../validators/validateSingBoxDuration';
import { showSubscriptionHeadersModal } from './headers';
import {
  cleanupRemoteSubscriptionUrlSettings,
  configuredSubscriptionTags,
  defaultSubscriptionUrlSettings,
  isRemoteSubscriptionSource,
  loadDefaultSubscriptionHeaders,
  nextSubscriptionTag,
  optionMapValue,
  subscriptionUrlSettingsKeys,
} from './model';
import { showSubscriptionOverrideModal } from './overrides';

export function addSubscriptionUrlItemOptions(
  itemSection: CBISection,
  options: Partial<ChildItemDialogContext> = {},
) {
  const parentSectionForItem =
    typeof options.parentSectionId === 'function'
      ? options.parentSectionId
      : parentSectionIdForItem;

  let o: CBIOption;
  if (options.remote !== false) {
    o = itemSection.option(
      form.Flag,
      'subscription_update_enabled',
      _('Subscription auto update'),
    );
    o.default = '1';
    o.rmempty = false;

    o = itemSection.option(
      form.Value,
      'subscription_update_interval',
      _('Update interval'),
    );
    o.depends('subscription_update_enabled', '1');
    o.placeholder = '1h';
    o.validate = function (itemId: string, value: unknown) {
      return optionMapValue(this, itemId, 'subscription_update_enabled') === '1'
        ? validateRequiredSingBoxDuration(value)
        : validateOptionalSingBoxDuration(value);
    };

    o = itemSection.option(
      form.Flag,
      'download_via_proxy_enabled',
      _('Request the subscription through a section'),
    );
    o.default = '0';
    o.rmempty = false;

    o = itemSection.option(
      form.ListValue,
      'download_via_proxy_section',
      _('Request through'),
    );
    o.depends('download_via_proxy_enabled', '1');
    o.load = function (itemId: string) {
      const sectionId = parentSectionForItem(itemId);
      refreshOptionChoices(this, subscriptionDownloadTargetChoices(sectionId));
      const value =
        optionMapValue(this, itemId, 'download_via_proxy_section') || '';
      keepUnavailableSectionChoice(this, value);
      return value;
    };
    o.validate = function (itemId: string, value: unknown) {
      const sectionId = parentSectionForItem(itemId);
      if (optionMapValue(this, itemId, 'download_via_proxy_enabled') !== '1') {
        return true;
      }
      if (!value) {
        return _('Select a section for downloading this subscription');
      }
      if (value === sectionId) {
        return _('Current section cannot download its own subscription');
      }
      return true;
    };

    o = itemSection.option(
      form.Button,
      '_subscription_headers',
      _('Headers'),
      _('Change the HTTP headers of the request'),
    );
    o.inputtitle = _('Edit');
    o.inputstyle = 'edit';
    o.onclick = function () {
      return showSubscriptionHeadersModal(itemSection.map, 'settings');
    };

    o = itemSection.option(
      form.Flag,
      'show_dashboard_metadata',
      _('Show metadata'),
      _('Show the metadata block on the dashboard'),
    );
    o.default = '1';
    o.rmempty = false;
  }

  o = itemSection.option(
    form.Flag,
    'show_subscription_name',
    _('Show tag'),
    _('Adds the tag to every node of this subscription on the dashboard'),
  );
  o.default = '0';
  o.rmempty = false;

  o = itemSection.option(form.Value, 'tag', _('Tag'));
  o.depends('show_subscription_name', '1');
  o.rmempty = false;
  // The tag names the subscription's provider whether or not it is added to the
  // node names, so it is in effect even while this field is hidden and must
  // survive a save that does not show it.
  o.retain = true;
  o.validate = function (_itemId: string, value: unknown) {
    const normalized = `${value || ''}`.trim();
    if (!normalized) return _('Enter a subscription tag');
    if (normalized.includes('/')) {
      return _('Subscription tag must not contain /');
    }
    const sectionId = parentSectionForItem(_itemId);
    const ownerId =
      typeof options.ownerId === 'function' ? options.ownerId() : '';
    const inputValue =
      typeof options.itemValue === 'function' ? options.itemValue() : '';
    return configuredSubscriptionTags(sectionId, options.listOption!, [
      ownerId === sectionId ? '' : ownerId,
      inputValue,
    ]).includes(normalized)
      ? _('Subscription tag must be unique within the section')
      : true;
  };

  o = itemSection.option(
    form.Button,
    '_subscription_override',
    _('Server parameters'),
    _('Change the parameters of the servers this subscription adds'),
  );
  o.inputtitle = _('Edit');
  o.inputstyle = 'edit';
  o.onclick = function () {
    return showSubscriptionOverrideModal(itemSection.map, 'settings');
  };

  addServerFilterOptions(itemSection, parentSectionForItem, {
    ownerId: options.ownerId,
    modeLabel: _('Server filter'),
    modeDescription: _('Which servers to import'),
    modes: [
      { value: 'all', label: _('All servers') },
      { value: 'exclude', label: _('All except selected') },
      { value: 'include', label: _('Only selected') },
    ],
    ...subscriptionServerFilterDescriptions(),
  });
}

export function showSubscriptionUrlSettingsModal(
  _section_id: string,
  itemValue: unknown,
  option: CBIOption,
) {
  const source = childItemInputValue(
    _section_id,
    itemValue,
    'subscription_url',
    'url',
  );
  const remote = isRemoteSubscriptionSource(source);
  const headers = remote
    ? loadDefaultSubscriptionHeaders()
    : Promise.resolve([]);
  return headers.then((headers: string[]) =>
    showChildItemSettingsModal(_section_id, itemValue, option, {
      typeName: 'subscription_url',
      valueOption: 'url',
      keys: subscriptionUrlSettingsKeys(remote),
      defaults: (_inputValue: unknown, existing: boolean) =>
        defaultSubscriptionUrlSettings(
          existing ? [] : headers,
          nextSubscriptionTag(_section_id, option),
          remote,
        ),
      addOptions: (itemSection: CBISection, options) =>
        addSubscriptionUrlItemOptions(
          itemSection,
          Object.assign({}, options, { remote }),
        ),
      title: () => _('Subscription settings'),
      afterSave: (
        itemId: string,
        _inputValue: unknown,
        _settings: ChildSettings,
        existing: boolean,
      ) => {
        if (!remote && existing) cleanupRemoteSubscriptionUrlSettings(itemId);
      },
    }),
  );
}
