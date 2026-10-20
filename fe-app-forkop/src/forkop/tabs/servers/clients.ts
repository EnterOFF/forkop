// A client is an account the server accepts, its own UCI section with a name and credentials.

import { message } from '../../../validators/messages';
import { FORKOP_UCI_PACKAGE } from '../../../constants';
import {
  cleanupRemovedChildItems,
  isExistingChildItem,
} from '../../cbi/childItems';
import { childPendingSettingsStore } from '../../cbi/itemSettings';
import {
  CLIENT_KEYS,
  CLIENT_OWNER_OPTION,
  CLIENT_ROUTING_KEYS,
  CLIENT_TYPE,
  MAX_CLIENT_NAME_LENGTH,
} from './constants';
import { generateCredential, randomItem } from './credentials';
import { hasControlCharacters, valueList } from './formValues';
import {
  credentialFields,
  getProtocol,
  getShadowsocksMethod,
  isAuthenticationEnabled,
  isShadowsocks2022,
  supportsVisionFlow,
  usesLoginName,
} from './protocols';
import {
  validateRequiredText,
  validateShadowsocksPassword,
  validateUuid,
} from './validators';

export function clientSections(sectionId: string) {
  return (uci.sections(FORKOP_UCI_PACKAGE, CLIENT_TYPE) || []).filter(
    (section) => `${section[CLIENT_OWNER_OPTION] || ''}` === `${sectionId}`,
  );
}

function readClient(section: Partial<UciSectionObject>): ServerClient {
  return {
    id: `${section['.name'] || ''}`,
    name: `${section.name || ''}`,
    uuid: `${section.uuid || ''}`,
    password: `${section.password || ''}`,
    flow: `${section.flow || ''}`,
  };
}

export function listClients(sectionId: string) {
  return clientSections(sectionId).map(readClient);
}

export function routerClientNames() {
  return (uci.sections(FORKOP_UCI_PACKAGE, CLIENT_TYPE) || []).map(
    (section) => `${section.name || ''}`,
  );
}

const CLIENT_NAME_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');

// Random rather than numbered, so clients of different servers stay apart in Monitoring; the name
// fits the account names login protocols accept.
export function nextClientName(taken: string[]) {
  const names = new Set(taken.map((name) => `${name}`.toLowerCase()));
  let name = '';

  do {
    name = `user-${Array.from({ length: 5 }, () => randomItem(CLIENT_NAME_ALPHABET)).join('')}`;
  } while (names.has(name));

  return name;
}

export function clientNameLabel(protocol: string) {
  return usesLoginName(protocol) ? _('User name') : _('Name');
}

export function validateClientName(sectionId: string, value: unknown) {
  const name = `${value || ''}`.trim();

  if (!name) {
    return message.required();
  }
  if (name.length > MAX_CLIENT_NAME_LENGTH) {
    return _('Up to %d characters').format(MAX_CLIENT_NAME_LENGTH);
  }

  if (usesLoginName(getProtocol(sectionId))) {
    return /^[A-Za-z0-9._-]+$/.test(name) ? true : message.nameCharacters();
  }

  return hasControlCharacters(name) ? message.noControlCharacters() : true;
}

export function validateClientCredential(
  sectionId: string,
  field: string,
  value: string,
) {
  if (field === 'uuid') {
    return `${value || ''}`.trim()
      ? validateUuid(sectionId, value)
      : message.required();
  }
  if (field === 'password') {
    return getProtocol(sectionId) === 'shadowsocks'
      ? validateShadowsocksPassword(sectionId, value)
      : validateRequiredText(sectionId, value);
  }
  return true;
}

// The password goes when authentication is off, the flow where the listener cannot carry it.
export function visibleClientFields(sectionId: string) {
  const protocol = getProtocol(sectionId);

  return credentialFields(protocol).filter((field: string) => {
    if (field === 'password') {
      return isAuthenticationEnabled(sectionId);
    }
    if (field === 'flow') {
      return supportsVisionFlow(sectionId);
    }
    return true;
  });
}

export function clientCredentialLabel(sectionId: string, field: string) {
  if (field === 'uuid') {
    return _('UUID');
  }
  if (field === 'flow') {
    return _('Flow');
  }

  return getProtocol(sectionId) === 'shadowsocks' &&
    isShadowsocks2022(getShadowsocksMethod(sectionId))
    ? _('Key')
    : _('Password');
}

export function clientSettingsDefaults(
  sectionId: string,
  inputValue: unknown,
  existing: boolean,
  listOption: CBIOption,
) {
  const protocol = getProtocol(sectionId);
  const defaults: ChildSettings = {};

  if (existing) {
    return defaults;
  }

  // A fresh client starts with credentials it can connect with.
  defaults.name =
    `${inputValue || ''}`.trim() || generateClientName(sectionId, listOption);
  visibleClientFields(sectionId).forEach((field: string) => {
    if (field === 'flow') {
      return;
    }
    defaults[field] = generateCredential(sectionId, protocol, field);
  });

  return defaults;
}

// A generated name skips every name on the router, so it always points at one client.
export function generateClientName(sectionId: string, listOption: CBIOption) {
  return nextClientName([
    ...listedClientNames(sectionId, listOption),
    ...routerClientNames(),
  ]);
}

// The names the list shows now: an unsaved removal gives its name back.
export function listedClientNames(sectionId: string, listOption: CBIOption) {
  let current = null;

  if (listOption && typeof listOption.formvalue === 'function') {
    try {
      current = listOption.formvalue(sectionId);
    } catch (_error) {
      // The widget is not mounted; the stored sections are all there is.
    }
  }

  if (current == null) {
    return clientSections(sectionId).map((section) => `${section.name || ''}`);
  }

  return valueList(current).map((value: unknown) =>
    typeof listOption.inputValueForItem === 'function'
      ? listOption.inputValueForItem(sectionId, value)
      : `${value}`,
  );
}

export function validateClientsOnSave(
  sectionId: string,
  values: unknown,
  listOption: CBIOption,
) {
  const items = (Array.isArray(values) ? values : [values]).filter(Boolean);

  if (!items.length) {
    return message.required();
  }

  const store = childPendingSettingsStore(listOption, sectionId) || {};
  const seen = new Set<string>();
  for (const value of items) {
    const existing = isExistingChildItem(
      sectionId,
      value,
      CLIENT_TYPE,
      CLIENT_OWNER_OPTION,
    );
    const settings: ChildSettings = existing
      ? readClient(uci.get(FORKOP_UCI_PACKAGE, value) || {})
      : Object.assign({ name: value }, store[value] || {});
    const name = `${settings.name || value || ''}`.trim();

    if (validateClientName(sectionId, name) !== true) {
      return message.item(name || `${value}`, message.fixSettings());
    }

    if (seen.has(name.toLowerCase())) {
      return message.item(name, message.nameTaken());
    }
    seen.add(name.toLowerCase());

    for (const field of visibleClientFields(sectionId)) {
      if (field === 'flow') {
        continue;
      }
      const result = validateClientCredential(
        sectionId,
        field,
        `${settings[field] || ''}`,
      );
      if (result !== true) {
        return message.item(name, message.fixSettings());
      }
    }
  }

  return true;
}

export function pruneClientCredentials(sectionId: string) {
  const keep = new Set(visibleClientFields(sectionId));

  clientSections(sectionId).forEach((section) => {
    const stale = CLIENT_KEYS.filter(
      (key: string) =>
        key !== 'name' && !keep.has(key) && !CLIENT_ROUTING_KEYS.includes(key),
    );
    if (section.routing_override !== '1') {
      stale.push(...CLIENT_ROUTING_KEYS);
    }
    if (section.routing_mode !== 'section') {
      stale.push('routing_section');
    }

    stale.forEach((key: string) => {
      if (section[key] != null) {
        uci.unset(FORKOP_UCI_PACKAGE, section['.name'], key);
      }
    });
  });
}

// Cleared through the LuCI-owned option, forgetting what load() returned too, or the save would
// find them equal and skip the write; the clients go only when the dialog is saved.
export function clearClientList(mapRef: CBIMap, sectionId: string) {
  const found = mapRef ? mapRef.lookupOption('clients', sectionId) : null;
  const listOption = found ? found[0] : null;

  if (!listOption) {
    return;
  }

  if (typeof listOption.clearStagedChildSettings === 'function') {
    listOption.clearStagedChildSettings(sectionId);
  }

  const element = listOption.getUIElement(sectionId);
  if (element) {
    element.setValue([]);
  }

  listOption.cfgvalue(sectionId, []);
}

export function removeServerClients(sectionId: string) {
  cleanupRemovedChildItems(sectionId, CLIENT_TYPE, [], CLIENT_OWNER_OPTION);
}
