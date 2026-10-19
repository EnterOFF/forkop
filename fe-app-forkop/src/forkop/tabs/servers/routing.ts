import { DETOUR_TARGET_ACTIONS, FORKOP_UCI_PACKAGE } from '../../../constants';
import {
  keepUnavailableSectionChoice,
  validateSectionChoice,
} from '../../cbi/choices';
import { option } from './formValues';
import { validateRequired } from './validators';

function isRoutingSectionAction(action: unknown) {
  return DETOUR_TARGET_ACTIONS.indexOf(`${action || ''}`) !== -1;
}

// Sections a server may hand its traffic to, as value and label pairs.
export function routingSectionChoices() {
  return (uci.sections(FORKOP_UCI_PACKAGE, 'section') || [])
    .filter(
      (section) =>
        section['.name'] &&
        section.enabled !== '0' &&
        isRoutingSectionAction(section.action),
    )
    .map((section) => [
      section['.name'],
      `${section.label || section['.name']}`,
    ]);
}

function loadRoutingSectionChoices(optionRef: CBIOption, sectionId: string) {
  optionRef.keylist = [];
  optionRef.vallist = [];
  routingSectionChoices().forEach(([value, label]) =>
    optionRef.value(value, label),
  );
  keepUnavailableSectionChoice(optionRef, option(sectionId, 'routing_section'));

  return Promise.resolve();
}

export function addRoutingOptions(section: CBISection) {
  let o = section.option(
    form.ListValue,
    'routing_mode',
    _('Routing mode'),
    _("Where to send the traffic of this server's connections"),
  );
  o.value('rules', _('Rules'));
  o.value('direct', _('Direct'));
  o.value('section', _('Section'));
  o.default = 'rules';
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validateRequired;

  o = section.option(form.ListValue, 'routing_section', _('Routing section'));
  o.depends('routing_mode', 'section');
  o.modalonly = true;
  o.rmempty = false;
  o.validate = function (_sectionId: string, value: string) {
    return validateSectionChoice(this, value);
  };
  o.cfgvalue = (sectionId: string) => option(sectionId, 'routing_section');
  o.load = function (sectionId: string) {
    return loadRoutingSectionChoices(this, sectionId);
  };
}
