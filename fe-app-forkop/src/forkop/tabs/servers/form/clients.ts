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
  // Without this the list shows the child section id of every stored client: the
  // widget item carries the id as its value and falls back to it for the label.
  o.renderListItemLabel = function (sectionId: string, value: unknown) {
    return this.inputValueForItem!(sectionId, value);
  };
  o.renderItemSettingsModal = showClientSettingsModal;
  // Credentials the protocol stopped using are dropped once the list is written, so
  // switching protocol never leaves a stale password behind.
  o.afterMaterializeChildItems = function (sectionId: string) {
    pruneClientCredentials(sectionId);
  };
  // An empty list is reported by the option's own check, the way the Sections tab
  // asks for at least one server group; the per client checks run on save.
  o.validate = requiredList();
  o.validateItemsOnSave = function (sectionId: string, values: unknown) {
    return validateClientsOnSave(sectionId, values, this);
  };
}
