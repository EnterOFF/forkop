import {
  keepUnavailableSectionChoice,
  validateSectionChoice,
} from '../../cbi/choices';
import { refreshOutboundDetourSectionOptionValues } from './references';
import { currentOptionValue, optionMapValue } from './subscriptions/model';

// The cascade of one link, subscription or tunnel: the section whose servers it
// is dialled through. Only that section is stored, so the switch reads it and
// writes nothing, and turning the switch off hides the section, which LuCI then
// removes from what the dialog saves.
export function addCascadeOptions(
  itemSection: CBISection,
  parentSectionForItem: (itemId: string) => string,
  description: string,
  dependencies: Array<Record<string, string>> = [],
) {
  const toggle = itemSection.option(
    form.Flag,
    '_cascade',
    _('Cascade connection'),
    description,
  );
  toggle.default = '0';
  toggle.rmempty = false;
  toggle.load = function (itemId: string) {
    return optionMapValue(this, itemId, 'detour_section') ? '1' : '0';
  };
  toggle.write = function () {};
  toggle.remove = function () {};
  dependencies.forEach((dependency) => toggle.depends(dependency));

  const target = itemSection.option(
    form.ListValue,
    'detour_section',
    _('Connect through'),
  );
  target.rmempty = false;
  if (dependencies.length) {
    dependencies.forEach((dependency) =>
      target.depends({ ...dependency, _cascade: '1' }),
    );
  } else {
    target.depends('_cascade', '1');
  }
  target.load = function (itemId: string) {
    refreshOutboundDetourSectionOptionValues(
      this,
      parentSectionForItem(itemId),
    );
    const value = `${optionMapValue(this, itemId, 'detour_section') || ''}`;
    keepUnavailableSectionChoice(this, value);
    return value;
  };
  target.validate = function (itemId: string, value: unknown) {
    return currentOptionValue(this, itemId, '_cascade') === '1'
      ? validateSectionChoice(this, value, parentSectionForItem(itemId))
      : true;
  };
}
