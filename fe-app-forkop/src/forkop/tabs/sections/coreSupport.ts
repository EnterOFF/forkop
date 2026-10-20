import { FORKOP_UCI_PACKAGE } from '../../../constants';
import {
  coreFeatureOfType,
  coreHas,
  coreHasAnyEndpoint,
  coreSupportsType,
  linkCoreFeatures,
  missingCoreFeatureNote,
  validateCoreFeature,
} from '../../services/coreFeatures.service';
import { parseOutboundJsonObject } from './outboundJson';

// The share links a section dials itself, by name, and the sing-box type the
// name stands for in the installed core.
const CONNECTION_URI_TYPES = [
  ['vless', 'vless'],
  ['vmess', 'vmess'],
  ['shadowsocks', 'shadowsocks'],
  ['trojan', 'trojan'],
  ['socks', 'socks'],
  ['tuic', 'tuic'],
  ['hysteria', 'hysteria2'],
  ['naiveproxy', 'naive'],
  ['mieru', 'mieru'],
  ['anytls', 'anytls'],
  ['trusttunnel', 'trusttunnel'],
];

export function connectionUriDescription() {
  return _('Supported URIs: %s').format(
    CONNECTION_URI_TYPES.filter(([, type]) =>
      coreSupportsType(type, ['outbound']),
    )
      .map(([name]) => name)
      .join(', '),
  );
}

// A link the installed core would fail to start with: its protocol, or the uTLS hello a
// fingerprint or Reality asks for, is not in the build.
export function validateConnectionUriCore(link: string) {
  return validateCoreFeature(
    linkCoreFeatures(link).find((feature) => !coreHas(feature)) || '',
  );
}

function tunnelKindCoreFeature(kind: string) {
  return kind === 'json' ? '' : coreFeatureOfType(kind, ['endpoint']);
}

// A JSON endpoint is one of the endpoint types the core builds, so it needs the core to build one.
export function tunnelKindAvailable(kind: string) {
  if (kind === 'json') {
    return coreHasAnyEndpoint();
  }
  const feature = tunnelKindCoreFeature(kind);
  return !feature || coreHas(feature);
}

// What a saved tunnel needs: its kind's feature, or a JSON endpoint's for the type it declares.
export function tunnelCoreFeature(kind: string, endpointJson: unknown) {
  if (kind !== 'json') {
    return tunnelKindCoreFeature(kind);
  }
  const type = parseOutboundJsonObject(endpointJson)?.type;
  return typeof type === 'string'
    ? coreFeatureOfType(type.trim().toLowerCase(), ['endpoint'])
    : '';
}

// Subscriptions are not included: the core skips a server it cannot build and starts anyway.
export function sectionMissingCoreFeatures(sectionId: string) {
  const missing = new Set<string>();
  (uci.sections(FORKOP_UCI_PACKAGE, 'tunnel') || [])
    .filter((tunnel) => tunnel.section === sectionId)
    .forEach((tunnel) => {
      const feature = tunnelCoreFeature(
        `${tunnel.kind || 'wireguard'}`.toLowerCase(),
        tunnel.endpoint_json,
      );
      if (feature && !coreHas(feature)) {
        missing.add(feature);
      }
    });
  (uci.sections(FORKOP_UCI_PACKAGE, 'connection_link') || [])
    .filter((link) => link.section === sectionId)
    .forEach((link) =>
      linkCoreFeatures(`${link.uri || ''}`)
        .filter((feature) => !coreHas(feature))
        .forEach((feature) => missing.add(feature)),
    );
  return [...missing];
}

// Types the installed core can build, plus any the filter already names, so a save keeps them.
export function coreFilterTypeChoices(
  choices: Array<{ value: string; label: string }>,
  selected: string[],
) {
  return choices
    .filter(
      (choice) =>
        coreSupportsType(choice.value) || selected.includes(choice.value),
    )
    .map((choice) =>
      coreSupportsType(choice.value)
        ? choice
        : {
            value: choice.value,
            label: `${choice.label} (${missingCoreFeatureNote(coreFeatureOfType(choice.value))})`,
          },
    );
}
