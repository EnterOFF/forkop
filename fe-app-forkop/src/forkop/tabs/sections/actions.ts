import { FORKOP_UCI_PACKAGE } from '../../../constants';
import { escapeHtml } from '../../../helpers/escapeHtml';
import { missingCoreFeatureNote } from '../../services/coreFeatures.service';
import { sectionMissingCoreFeatures } from './coreSupport';

export function getRuleConfiguredAction(section_id: string) {
  const action = uci.get(FORKOP_UCI_PACKAGE, section_id, 'action');
  return action ? `${action}` : null;
}

export function getRuleResolvedAction(section_id: string) {
  return getRuleConfiguredAction(section_id) || 'connection';
}

function getActionOptionLabel(action: string) {
  switch (`${action}`) {
    case 'block':
      return 'Block';
    case 'bypass':
      return 'Bypass';
    case 'connection':
      return 'Connection';
    case 'dns':
      return 'DNS';
    case 'vpn':
      return 'VPN';
    case 'outbound':
      return _('JSON outbound');
    case 'proxy':
    default:
      return 'Proxy';
  }
}

export function getRuleActionDisplayValue(section_id: string) {
  return getActionOptionLabel(getRuleResolvedAction(section_id));
}

// The row says so when the installed core cannot run what the section holds,
// which the router then refuses to start with.
export function getRuleActionDisplayMarkup(section_id: string) {
  const label = escapeHtml(getRuleActionDisplayValue(section_id));
  const notes = sectionMissingCoreFeatures(section_id).map((feature) =>
    escapeHtml(missingCoreFeatureNote(feature)),
  );
  return notes.length ? `${label} (${notes.join('; ')})` : label;
}

// currentAction is what the section is stored as, and a dropdown hands back one
// of its own entries and nothing else: without its own action in the list a
// section carrying a retired action would come back from a save as a Connection
// with no servers, which is a configuration that will not build at all.
export function populateActionOptionValues(
  option: CBIOption,
  currentAction?: unknown,
) {
  delete option.keylist;
  delete option.vallist;

  option.value('connection', getActionOptionLabel('connection'));
  option.value('bypass', 'Bypass');
  option.value('block', 'Block');
  option.value('dns', 'DNS');

  const stored = `${currentAction || ''}`.trim();
  if (stored && !option.keylist!.includes(stored)) {
    option.value(stored, getActionOptionLabel(stored));
  }
}
