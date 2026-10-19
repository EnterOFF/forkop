import { DETOUR_TARGET_ACTIONS, FORKOP_UCI_PACKAGE } from '../../../constants';
import { parseCommentAwareListTokens } from '../../cbi/annotatedTextarea';
import { normalizeDynamicListItems } from '../../cbi/listValues';
import { modalOptionFormValue } from '../../cbi/modal';
import { getUciSectionLabel, getUciSectionName } from '../../cbi/uci';
import { CONNECTION_OUTBOUND_SOURCES, ROUTING_ACTIONS } from './constants';

export function missingConnectionOutbound(
  modalMap: CBIMap,
  section_id: string,
) {
  const action = modalOptionFormValue(modalMap, section_id, 'action');
  if (action !== 'connection') {
    return false;
  }

  return !CONNECTION_OUTBOUND_SOURCES.some(
    (optionName: string) =>
      normalizeDynamicListItems(
        modalOptionFormValue(modalMap, section_id, optionName),
      ).length > 0,
  );
}

// A DNS section answers the queries for the domains it names, or every query of
// the devices it takes whole; one with neither has nothing to answer, and the
// backend refuses it.
export function missingDnsMatcher(modalMap: CBIMap, section_id: string) {
  if (modalOptionFormValue(modalMap, section_id, 'action') !== 'dns') {
    return false;
  }

  const value = (name: string) =>
    modalOptionFormValue(modalMap, section_id, name);
  return (
    !parseCommentAwareListTokens(value('_dns_destinations')).length &&
    !['community_lists', '_dns_rule_set', 'fully_routed_ips'].some(
      (name) => normalizeDynamicListItems(value(name)).length > 0,
    )
  );
}

// A section another section may hand its traffic to: it exists, it is not the
// one asking, it is enabled, and its action is one that carries traffic. The
// same question for a DNS detour, an outbound detour and a download picker.
function isDetourTargetSection(
  section: UciSectionObject,
  currentSectionId: string,
) {
  const sectionName = getUciSectionName(section);
  const action = ((section && section.action) as string) || '';

  return (
    !!sectionName &&
    sectionName !== currentSectionId &&
    section.enabled !== '0' &&
    DETOUR_TARGET_ACTIONS.includes(action)
  );
}

function getOutboundDetourTargetSections(currentSectionId: string) {
  return (uci.sections(FORKOP_UCI_PACKAGE, 'section') || []).filter((section) =>
    isDetourTargetSection(section, currentSectionId),
  );
}

export function refreshOutboundDetourSectionOptionValues(
  option: CBIOption,
  sectionId: string,
) {
  option.keylist = [];
  option.vallist = [];

  getOutboundDetourTargetSections(sectionId).forEach((targetSection) => {
    option.value(
      getUciSectionName(targetSection),
      getUciSectionLabel(targetSection),
    );
  });
}

export function tailscaleDetourSectionValue(
  detour: unknown,
  currentSectionId: string,
): string {
  const wanted = `${detour || ''}`.trim();
  if (!wanted) {
    return '';
  }

  const target = getOutboundDetourTargetSections(currentSectionId).find(
    (section) => getUciSectionLabel(section) === wanted,
  );
  return target ? getUciSectionName(target) : wanted;
}

export function tailscaleDetourTag(sectionId: string) {
  sectionId = `${sectionId || ''}`.trim();
  if (!sectionId) {
    return '';
  }

  const target = (uci.sections(FORKOP_UCI_PACKAGE, 'section') || []).find(
    (section) => getUciSectionName(section) === sectionId,
  );
  return target ? getUciSectionLabel(target) : sectionId;
}

export function refreshDnsDetourSectionOptionValues(
  option: CBIOption,
  sectionId: string,
) {
  option.keylist = [];
  option.vallist = [];

  (uci.sections(FORKOP_UCI_PACKAGE, 'section') || [])
    .filter((section) => isDetourTargetSection(section, sectionId))
    .forEach((targetSection) => {
      option.value(
        getUciSectionName(targetSection),
        getUciSectionLabel(targetSection),
      );
    });
}

export function dependsOnRoutingAction(option: CBIOption) {
  ROUTING_ACTIONS.forEach((action: string) => option.depends('action', action));
  return option;
}

export function dependsOnRuleConditions(option: CBIOption) {
  const routingConditions = [
    'destinations',
    'community_lists',
    'rule_set',
    'ports',
  ];
  ROUTING_ACTIONS.forEach((action: string) =>
    routingConditions.forEach((condition) =>
      option.depends({ action, [condition]: /\S/ }),
    ),
  );
  ['_dns_destinations', 'community_lists', 'rule_set', '_dns_rule_set'].forEach(
    (condition) => option.depends({ action: 'dns', [condition]: /\S/ }),
  );
  return option;
}

export function safeRuntimeSectionName(section_id: string) {
  return /^[A-Za-z0-9_-]+$/.test(`${section_id || ''}`);
}

export function subscriptionDownloadTargetChoices(section_id: string) {
  return (uci.sections(FORKOP_UCI_PACKAGE, 'section') || [])
    .filter((section) => isDetourTargetSection(section, section_id))
    .map((section) => ({
      value: getUciSectionName(section),
      label: getUciSectionLabel(section),
    }));
}
