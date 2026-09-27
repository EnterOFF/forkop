import { DOMAIN_LIST_OPTIONS, FORKOP_UCI_PACKAGE } from '../../../constants';
import { validatePath } from '../../../validators/validatePath';
import { validateUrl } from '../../../validators/validateUrl';
import { itemSettingsFlag, readItemSettingsMap } from '../../cbi/itemSettings';
import {
  normalizeDynamicListItems,
  uniqueDynamicListItems,
} from '../../cbi/listValues';
import { renderStackedJsonSettingsModal } from '../../cbi/modal';
import { getConfigListValues, writeListOption } from '../../cbi/uci';
import { getRuleResolvedAction } from './actions';
import { RULE_SET_ITEM_SETTINGS_KEY } from './constants';

function ruleSetIncludesSubnets(section_id: string, value: string) {
  const settings = readItemSettingsMap(section_id, RULE_SET_ITEM_SETTINGS_KEY);
  const itemSettings = settings && settings[value];

  if (
    itemSettings &&
    typeof itemSettings === 'object' &&
    itemSettings.include_subnets != null
  ) {
    return itemSettingsFlag(itemSettings, 'include_subnets', false);
  }

  return getConfigListValues(section_id, 'rule_set_with_subnets').includes(
    value,
  );
}

export function showRuleSetSettingsModal(
  section_id: string,
  itemValue: unknown,
  option: CBIOption,
  widget: CBIWidget,
) {
  const data = {
    settings: {
      include_subnets: ruleSetIncludesSubnets(section_id, `${itemValue ?? ''}`)
        ? '1'
        : '0',
    },
  };
  const map = new form.JSONMap(data);
  const section = map.section(form.NamedSection, 'settings');
  section.anonymous = true;
  section.addremove = false;

  const includeSubnets = section.option(
    form.Flag,
    'include_subnets',
    _('Include IP addresses and subnets'),
    _(
      'By default only the domain conditions of a rule set are applied. This option adds its IP addresses and subnets to nftables. Large lists can load the router heavily. Enable it only if you know the set holds the subnets you need',
    ),
  );
  includeSubnets.default = '0';
  includeSubnets.rmempty = false;

  return renderStackedJsonSettingsModal(
    _('Rule set settings'),
    map,
    (settings: ChildSettings) => {
      const value = settings.include_subnets === '1';
      const refs = uniqueDynamicListItems(
        widget && typeof widget.getValue === 'function'
          ? widget.getValue()
          : getCustomRulesetReferences(section_id),
      );
      const subnets = new Set(
        getConfigListValues(section_id, 'rule_set_with_subnets').filter((ref) =>
          refs.includes(ref),
        ),
      );

      if (value) {
        subnets.add(`${itemValue}`);
      } else {
        subnets.delete(`${itemValue}`);
      }

      writeListOption(
        section_id,
        'rule_set',
        refs.filter((ref) => !subnets.has(ref)),
      );
      writeListOption(section_id, 'rule_set_with_subnets', [...subnets]);
      if (option && typeof option.getUIElement === 'function') {
        option.getUIElement(section_id)!.setValue(refs);
      }
    },
  );
}

export function loadRulesetValues(option: CBIOption) {
  delete option.keylist;
  delete option.vallist;

  Object.entries(DOMAIN_LIST_OPTIONS).forEach(([key, label]) => {
    option.value(key, label);
  });
}

function isBuiltinRulesetValue(value: string) {
  return Object.prototype.hasOwnProperty.call(DOMAIN_LIST_OPTIONS, value);
}

export function validateCustomRulesetReference(value: string) {
  const errorMessage = _(
    'Rule set must be an HTTP(S) URL or an absolute local path',
  );
  if (!value) {
    return true;
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return validateUrl(value).valid ? true : errorMessage;
  }
  if (value.startsWith('/')) {
    return validatePath(value).valid ? true : errorMessage;
  }
  return errorMessage;
}

function getRulesetReferences(section_id: string) {
  return getConfigListValues(section_id, 'rule_set');
}

export function getBuiltInRulesetReferences(section_id: string) {
  const values = getConfigListValues(section_id, 'community_lists').filter(
    (value: string) => isBuiltinRulesetValue(value),
  );

  return values.filter(
    (value: string, index: number, all: string[]) =>
      isBuiltinRulesetValue(value) && all.indexOf(value) === index,
  );
}

export function getCustomRulesetReferences(section_id: string) {
  return uniqueDynamicListItems([
    ...getRulesetReferences(section_id).filter(
      (value: string) => !isBuiltinRulesetValue(value),
    ),
    ...getConfigListValues(section_id, 'rule_set_with_subnets'),
  ]);
}

export function writeBuiltInRulesetReferences(
  section_id: string,
  values: unknown,
) {
  const refs = normalizeDynamicListItems(values).filter((value: string) =>
    isBuiltinRulesetValue(value),
  );
  writeListOption(section_id, 'community_lists', refs);
}

export function writeCustomRulesetReferences(
  section_id: string,
  values: unknown,
) {
  const refs = uniqueDynamicListItems(values);
  if (getRuleResolvedAction(section_id) === 'dns') {
    writeDnsRulesetReferences(section_id, refs);
    return;
  }
  const subnetRefs = getConfigListValues(
    section_id,
    'rule_set_with_subnets',
  ).filter((value: string) => refs.includes(value));
  const subnetRefSet = new Set(subnetRefs);

  writeListOption(
    section_id,
    'rule_set',
    refs.filter((value: string) => !subnetRefSet.has(value)),
  );
  writeListOption(section_id, 'rule_set_with_subnets', subnetRefs);
  uci.unset(FORKOP_UCI_PACKAGE, section_id, RULE_SET_ITEM_SETTINGS_KEY);
}

export function writeDnsRulesetReferences(section_id: string, values: unknown) {
  writeListOption(section_id, 'rule_set', uniqueDynamicListItems(values));
  uci.unset(FORKOP_UCI_PACKAGE, section_id, 'rule_set_with_subnets');
  uci.unset(FORKOP_UCI_PACKAGE, section_id, RULE_SET_ITEM_SETTINGS_KEY);
}
