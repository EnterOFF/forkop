import { FORKOP_UCI_PACKAGE } from '../../../constants';
import { getProxyUrlName } from '../../../helpers/getProxyUrlName';
import { validateProxyUrl } from '../../../validators/validateProxyUrl';
import { getChildItemIds, isExistingChildItem } from '../../cbi/childItems';
import { childPendingSettingsStore } from '../../cbi/itemSettings';
import {
  updateDynamicListItemLabel,
  validateUniqueDynamicListItemName,
} from '../../cbi/listItems';
import { showChildItemSettingsModal } from '../../cbi/modal';
import { E } from '../../../helpers/element';
import { addCascadeOptions } from './cascade';
import { validateConnectionUriCore } from './coreSupport';
import { refreshDashboardFilterChoiceWidgets } from './outboundNames';

export function validateConnectionLink(value: unknown) {
  const link = `${value ?? ''}`.trim();
  if (!link) {
    return true;
  }

  const validation = validateProxyUrl(link);
  return validation.valid
    ? validateConnectionUriCore(link)
    : validation.message;
}

// The entries of the section's link list as its dialog holds them now, or the
// stored links when the list is not on screen.
function listedLinkValues(sectionId: string, option: CBIOption): string[] {
  let values: unknown = null;
  try {
    values = option && option.formvalue ? option.formvalue(sectionId) : null;
  } catch (_error) {
    values = null;
  }

  return Array.isArray(values)
    ? values.map((value) => `${value || ''}`.trim()).filter(Boolean)
    : getChildItemIds(sectionId, 'connection_link');
}

// The name one entry runs under: what its section stores, or - for a link the
// section has not been saved with yet - what its dialog or the list gave it.
function listedLinkName(sectionId: string, option: CBIOption, value: string) {
  if (isExistingChildItem(sectionId, value, 'connection_link')) {
    return `${uci.get(FORKOP_UCI_PACKAGE, value, 'name') || ''}`.trim();
  }

  return `${childPendingSettingsStore(option, sectionId)[value]?.name || ''}`.trim();
}

// A pasted link is named after the server it describes, and one that names none
// is "Node #N", N counting the links the section already has. Either moves on to
// "#2" and further while another link of the section holds the name.
function nextLinkName(
  sectionId: string,
  option: CBIOption,
  link: string,
  values: string[] = listedLinkValues(sectionId, option),
) {
  const taken = new Set(
    values
      .filter((value) => value !== link)
      .map((value) => listedLinkName(sectionId, option, value))
      .filter(Boolean),
  );
  const own = getProxyUrlName(link).trim();
  if (own) {
    let name = own;
    for (let number = 2; taken.has(name); number += 1) {
      name = `${own} #${number}`;
    }
    return name;
  }

  for (let number = taken.size + 1; number < 100000; number += 1) {
    if (!taken.has(`Node #${number}`)) return `Node #${number}`;
  }
  return `Node #${Date.now()}`;
}

// The name of a link the list never named, which is one typed into the add field
// and saved with the section from there. The links the same save stored before
// it hold their names already, so they count too.
export function savedLinkName(
  sectionId: string,
  option: CBIOption,
  link: string,
) {
  const values = listedLinkValues(sectionId, option);
  const stored = getChildItemIds(sectionId, 'connection_link').filter(
    (itemId) => !values.includes(itemId),
  );
  return nextLinkName(sectionId, option, link, [...stored, ...values]);
}

// What the list shows for one entry, which is the name: a link is named the
// moment it is added, so the dialog, the uniqueness check and the save all see
// the name the list shows.
export function connectionLinkName(
  sectionId: string,
  option: CBIOption,
  value: string,
) {
  const listed = listedLinkName(sectionId, option, value);
  if (listed || isExistingChildItem(sectionId, value, 'connection_link')) {
    return listed;
  }

  const store = childPendingSettingsStore(option, sectionId);
  store[value] = Object.assign({}, store[value], {
    name: nextLinkName(sectionId, option, value),
  });
  return `${store[value].name}`;
}

export function connectionLinkListItemLabel(
  sectionId: string,
  option: CBIOption,
  value: string,
) {
  return E(
    'span',
    { class: 'fkp-dynlist-label' },
    connectionLinkName(sectionId, option, value),
  );
}

// A link taken back out of the list gives up its name, along with everything
// else its dialog had staged.
export function forgetRemovedLinkDrafts(
  sectionId: string,
  option: CBIOption,
  values: string[],
) {
  const store = childPendingSettingsStore(option, sectionId);
  Object.keys(store).forEach((value) => {
    if (!values.includes(value)) delete store[value];
  });
}

function connectionLinkSettingsKeys() {
  return ['name', 'uri', 'detour_section'];
}

function writeTrimmed(this: CBIOption, itemId: string, value: unknown) {
  return form.Value.prototype.write.call(this, itemId, `${value ?? ''}`.trim());
}

export function showConnectionLinkSettingsModal(
  sectionId: string,
  itemValue: unknown,
  option: CBIOption,
  widget: CBIWidget,
  itemNode: Element | null,
) {
  const name = connectionLinkName(sectionId, option, `${itemValue ?? ''}`);
  return showChildItemSettingsModal(sectionId, itemValue, option, {
    typeName: 'connection_link',
    valueOption: 'uri',
    keys: connectionLinkSettingsKeys(),
    itemNode,
    defaults: (inputValue: string) => ({ uri: inputValue, name }),
    addOptions: (itemSection: CBISection) => {
      let o = itemSection.option(form.Value, 'name', _('Server name'));
      o.rmempty = false;
      o.write = writeTrimmed;
      o.validate = function (_itemId: string, value: unknown) {
        return `${value || ''}`.trim()
          ? validateUniqueDynamicListItemName(widget, itemNode, value)
          : _('Enter a display name');
      };

      o = itemSection.option(form.Value, 'uri', _('Connection URI'));
      // A link carries the credentials of its server.
      o.password = true;
      o.rmempty = false;
      o.write = writeTrimmed;
      o.validate = function (_itemId: string, value: unknown) {
        return `${value || ''}`.trim()
          ? validateConnectionLink(value)
          : _('Paste a connection URI');
      };

      addCascadeOptions(
        itemSection,
        () => sectionId,
        _('Connect to the server through another section'),
      );
    },
    title: () => (name ? _('Server: %s').format(name) : _('Server settings')),
    afterSave: (
      _itemId: string,
      _inputValue: string,
      settings: ChildSettings,
    ) => {
      updateDynamicListItemLabel(itemNode, `${settings.name || ''}`.trim());
      refreshDashboardFilterChoiceWidgets(sectionId);
    },
  });
}
