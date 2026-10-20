import { nextSectionId } from '../../../cbi/childItems';
import { ButtonAddSettingsDynamicList } from '../../../cbi/dynamicList';
import { requiredList } from '../../../cbi/required';

import { showClientSettingsModal } from '../clientDialog';
import { pruneClientCredentials, validateClientsOnSave } from '../clients';
import { CLIENT_OWNER_OPTION, CLIENT_TYPE } from '../constants';
import { protocolsWhere, usesClients } from '../protocols';

export function addClientListOption(section: CBISection) {
  const o = section.option(
    ButtonAddSettingsDynamicList,
    'clients',
    _('Clients'),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.addButtonLabel = _('+ Add client');
  o.childType = CLIENT_TYPE;
  o.ownerOption = CLIENT_OWNER_OPTION;
  o.childValueOption = 'name';
  o.createId = () => nextSectionId(CLIENT_TYPE);
  // A Mixed inbound only has accounts while it asks for them; every other
  // protocol always does.
  protocolsWhere((entry) => usesClients(entry.id)).forEach((protocol) =>
    protocol === 'mixed'
      ? o.depends({ protocol, mixed_auth_enabled: '1' })
      : o.depends('protocol', protocol),
  );
  // Otherwise the list shows each client's section id, which the widget falls back to.
  o.renderListItemLabel = function (sectionId: string, value: unknown) {
    return this.inputValueForItem!(sectionId, value);
  };
  o.renderItemSettingsModal = showClientSettingsModal;
  // Credentials the protocol stopped using are dropped once the list is written.
  o.afterMaterializeChildItems = function (sectionId: string) {
    pruneClientCredentials(sectionId);
  };
  // The per-client checks run on save.
  o.validate = requiredList();
  o.validateItemsOnSave = function (sectionId: string, values: unknown) {
    return validateClientsOnSave(sectionId, values, this);
  };
}
