import { validateDNS } from '../../../validators/validateDns';

function optionListValues(option: CBIOption, section_id: string) {
  const formValue = option.formvalue(section_id);
  const value = formValue != null ? formValue : option.cfgvalue(section_id);
  return L.toArray(value)
    .map((item) => `${item || ''}`.trim())
    .filter(Boolean);
}

export function configureDnsList(
  option: CBIOption,
  defaultValue: string,
  ipOnly = false,
) {
  option.default = [defaultValue];
  option.rmempty = false;
  option.validate = function (_section_id: string, value: string) {
    const normalized = `${value || ''}`.trim();
    if (!normalized) {
      return optionListValues(option, _section_id).length > 0
        ? true
        : _('Add at least one DNS server');
    }
    const validation = validateDNS(normalized, ipOnly);
    return validation.valid ? true : validation.message;
  };
}

export function configureDnsFailoverVisibility(
  option: CBIOption,
  dnsOption: CBIOption,
  dnsKey: string,
) {
  option.depends(dnsKey, '__forkop_multiple_dns__');
  option.retain = true;
  option.checkDepends = function (section_id: string) {
    return optionListValues(dnsOption, section_id).length > 1;
  };
}
