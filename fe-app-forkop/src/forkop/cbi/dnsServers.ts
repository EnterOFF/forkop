// A list of DNS servers and its query mode, shared by the four dialogs that ask for them.

import { validateDNS } from '../../validators/validateDns';
import { coreHas, validateCoreFeature } from '../services/coreFeatures.service';
import { optionListValues, requiredList } from './required';

// depends() compares an option to a literal, and "holds more than one entry" is none; the mode
// depends on a sentinel no server can be, and checkDepends answers the real question.
const MULTIPLE_DNS_SENTINEL = '__forkop_multiple_dns__';

// A LuCI modal is built from clones of the section's options, so a sibling is reached by name
// through the rendered map.
function siblingValues(map: CBIMap, name: string, section_id: string) {
  const lookup = map.lookupOption(name, section_id);
  return lookup ? optionListValues(lookup[0], lookup[1]) : [];
}

export function dnsServerPrefixes() {
  return [
    'udp://',
    'tcp://',
    'tls://',
    'https://',
    ...(coreHas('quic') ? ['quic://', 'h3://'] : []),
  ].join(', ');
}

export function configureDnsServerList(
  option: CBIOption,
  options: {
    // Bootstrap servers resolve the other servers, so they must be addresses.
    ipOnly?: boolean;
    // For a field inside a dialog that can switch the whole resolver off.
    appliesTo?: (option: CBIOption, section_id: string) => boolean;
  } = {},
) {
  const check = requiredList(function (_section_id, value) {
    const server = value.trim();
    const validation = validateDNS(server, options.ipOnly);
    // DoQ and DoH3 need QUIC, which a core may be built without.
    return validation === true
      ? validateCoreFeature(/^(quic|h3):\/\//i.test(server) ? 'quic' : '')
      : validation;
  });

  option.rmempty = false;
  option.validate = function (section_id: string, value: string) {
    return options.appliesTo && !options.appliesTo(this, section_id)
      ? true
      : check.call(this, section_id, value);
  };
}

// Shown only once there is a second server to fall back to.
export function configureDnsQueryMode(
  modeOption: CBIOption,
  dnsServerOptionName: string,
  options: {
    // As depends() pairs, so LuCI re-checks the mode when any of them changes; read back in checkDepends.
    alsoDependsOn?: Record<string, string>;
  } = {},
) {
  modeOption.value('parallel', _('Parallel'));
  modeOption.value('sequential', _('Sequential'));
  modeOption.default = 'parallel';
  modeOption.rmempty = false;
  // Otherwise LuCI removes the option whenever it is hidden, dropping the stored choice.
  modeOption.retain = true;
  modeOption.depends(
    Object.assign({}, options.alsoDependsOn, {
      [dnsServerOptionName]: MULTIPLE_DNS_SENTINEL,
    }),
  );
  modeOption.checkDepends = function (section_id: string) {
    const satisfied = Object.entries(options.alsoDependsOn || {}).every(
      ([name, expected]) => {
        const lookup = this.map.lookupOption(name, section_id);
        return lookup ? lookup[0].formvalue(lookup[1]) === expected : false;
      },
    );

    return (
      satisfied &&
      siblingValues(this.map, dnsServerOptionName, section_id).length > 1
    );
  };
}
