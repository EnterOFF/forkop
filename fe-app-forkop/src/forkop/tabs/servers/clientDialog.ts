import {
  addDynamicListItem,
  updateDynamicListItemLabel,
  validateUniqueDynamicListItemName,
} from '../../cbi/listItems';
import {
  keepUnavailableSectionChoice,
  validateSectionChoice,
} from '../../cbi/choices';
import { showChildItemSettingsModal } from '../../cbi/modal';
import {
  clientCredentialLabel,
  clientNameLabel,
  clientSettingsDefaults,
  generateClientName,
  validateClientCredential,
  validateClientName,
  visibleClientFields,
} from './clients';
import {
  CLIENT_KEYS,
  CLIENT_OWNER_OPTION,
  CLIENT_ROUTING_MODES,
  CLIENT_TYPE,
} from './constants';
import { addGenerateButton } from './controls';
import { generateCredential } from './credentials';
import { getProtocol, hasListener } from './protocols';
import { routingSectionChoices } from './routing';

export function addClientCredentialOptions(
  sectionId: string,
  itemSection: CBISection,
) {
  const protocol = getProtocol(sectionId);

  visibleClientFields(sectionId).forEach((field: string) => {
    if (field === 'flow') {
      const flow = itemSection.option(
        form.ListValue,
        'flow',
        clientCredentialLabel(sectionId, field),
      );
      flow.value('', _('None'));
      flow.value('xtls-rprx-vision', 'xtls-rprx-vision');
      flow.rmempty = true;
      return;
    }

    const credential = itemSection.option(
      form.Value,
      field,
      clientCredentialLabel(sectionId, field),
    );
    credential.password = field !== 'uuid';
    credential.validate = (_id, value: string) =>
      validateClientCredential(sectionId, field, value);
    addGenerateButton(credential, () =>
      generateCredential(sectionId, protocol, field),
    );
  });
}

export function addClientOptions(
  sectionId: string,
  itemSection: CBISection,
  helpers: ChildItemDialogContext,
  listOption: CBIOption,
) {
  const protocol = getProtocol(sectionId);

  const name = itemSection.option(
    form.Value,
    'name',
    clientNameLabel(protocol),
  );
  name.validate = function (_id, value: string) {
    const result = validateClientName(sectionId, value);
    if (result !== true) {
      return result;
    }
    return typeof helpers.validateName === 'function'
      ? helpers.validateName(value)
      : true;
  };
  addGenerateButton(name, () => generateClientName(sectionId, listOption));

  addClientCredentialOptions(sectionId, itemSection);
  addClientRoutingOptions(sectionId, itemSection);
}

// Client rules come before the server's, so an override wins without touching the server mode.
export function addClientRoutingOptions(
  sectionId: string,
  itemSection: CBISection,
) {
  if (!hasListener(getProtocol(sectionId))) {
    return;
  }

  const override = itemSection.option(
    form.Flag,
    'routing_override',
    _('Override routing'),
    _("A routing mode of this client's own instead of the server's"),
  );
  override.default = '0';
  override.rmempty = true;

  const mode = itemSection.option(
    form.ListValue,
    'routing_mode',
    _('Routing mode'),
  );
  CLIENT_ROUTING_MODES.forEach(([value, label]) => mode.value(value, label));
  mode.default = 'rules';
  mode.rmempty = false;
  mode.depends('routing_override', '1');

  const target = itemSection.option(
    form.ListValue,
    'routing_section',
    _('Routing section'),
  );
  routingSectionChoices().forEach(([value, label]) =>
    target.value(value, label),
  );
  target.rmempty = false;
  target.load = function (sid: string) {
    const value = form.ListValue.prototype.load.call(this, sid);
    keepUnavailableSectionChoice(this, value);
    return value;
  };
  target.depends({ routing_override: '1', routing_mode: 'section' });
  target.validate = function (_id: string, value: string) {
    return validateSectionChoice(this, value);
  };
}

export function showClientSettingsModal(
  sectionId: string,
  itemValue: unknown,
  listOption: CBIOption,
  widget: CBIWidget,
  itemNode: Element | null,
  context: ChildItemModalContext = {},
) {
  return showChildItemSettingsModal(sectionId, itemValue, listOption, {
    typeName: CLIENT_TYPE,
    ownerOption: CLIENT_OWNER_OPTION,
    valueOption: 'name',
    keys: CLIENT_KEYS,
    itemNode,
    defaults: (inputValue: string, existing: boolean) =>
      clientSettingsDefaults(sectionId, inputValue, existing, listOption),
    addOptions: (itemSection: CBISection, helpers: ChildItemDialogContext) =>
      addClientOptions(sectionId, itemSection, helpers, listOption),
    validateName: validateUniqueDynamicListItemName.bind(
      null,
      widget,
      itemNode,
    ),
    title: (name: string) =>
      `${name || ''}`.trim() ? _('Client: %s').format(name) : _('Client'),
    afterSave: (
      itemId: string,
      inputValue: string,
      _settings: ChildSettings,
      existing: boolean,
    ) => {
      if (existing) {
        updateDynamicListItemLabel(itemNode, inputValue);
        return;
      }
      if (context.adding) {
        addDynamicListItem(widget, inputValue);
      } else {
        updateDynamicListItemLabel(itemNode, inputValue);
      }
    },
  });
}
