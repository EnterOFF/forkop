// A list of DNS servers and the query mode that goes with it.
//
// Four dialogs ask this pair of questions: the Settings tab twice, for the main
// and the bootstrap resolvers; a DNS section; and a network interface's own
// resolver. They differ in what the option is called and in what else has to be
// switched on for it to matter, and in nothing else - so what they share lives
// here instead of being written out four times.

import { validateDNS } from '../../validators/validateDns';
import { coreHas, validateCoreFeature } from '../services/coreFeatures.service';
import { optionListValues, requiredList } from './required';

// LuCI's depends() compares an option to a literal value, and "holds more than
// one entry" is not a value. So the mode depends on a sentinel no DNS server can
// ever be, which puts the option on the list's dependency graph, and answers the
// real question in checkDepends below.
const MULTIPLE_DNS_SENTINEL = '__forkop_multiple_dns__';

// The value of a sibling option of the same section, or an empty list when the
// dialog has no such field. Two of these dialogs are LuCI modals, and a modal is
// built from clones of the section's options rather than from the options
// themselves, so a sibling is reached by name through the map being rendered -
// the original object would answer for a widget that dialog is not showing.
function siblingValues(map: CBIMap, name: string, section_id: string) {
  const lookup = map.lookupOption(name, section_id);
  return lookup ? optionListValues(lookup[0], lookup[1]) : [];
}

// The prefixes a server can be written with in the installed core.
export function dnsServerPrefixes() {
  return [
    'udp://',
    'tcp://',
    'tls://',
    'https://',
    ...(coreHas('quic') ? ['quic://', 'h3://'] : []),
  ].join(', ');
}

// The list itself, which a resolver cannot do without.
export function configureDnsServerList(
  option: CBIOption,
  options: {
    // Bootstrap servers resolve the addresses of the other servers, so they can
    // only be addresses themselves.
    ipOnly?: boolean;
    // The field is inside a dialog that can switch the whole resolver off, and a
    // list nobody is going to read must not hold that dialog open.
    appliesTo?: (option: CBIOption, section_id: string) => boolean;
  } = {},
) {
  const check = requiredList(function (_section_id, value) {
    const server = value.trim();
    const validation = validateDNS(server, options.ipOnly);
    // DNS over QUIC and over HTTP/3 are QUIC, which a core may be built without.
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

// Parallel or sequential, shown only once there is a second server to fall back
// to - one server has no order to be asked in.
export function configureDnsQueryMode(
  modeOption: CBIOption,
  dnsServerOptionName: string,
  options: {
    // What else has to hold, as depends() pairs so LuCI re-checks the mode when
    // any of them changes, and read back in checkDepends because the sentinel
    // makes the whole condition ours to answer.
    alsoDependsOn?: Record<string, string>;
  } = {},
) {
  modeOption.value('parallel', _('Parallel'));
  modeOption.value('sequential', _('Sequential'));
  modeOption.default = 'parallel';
  modeOption.rmempty = false;
  // Without this LuCI removes the option every time the mode is hidden, which
  // would drop a stored choice the moment a second server is taken away.
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
