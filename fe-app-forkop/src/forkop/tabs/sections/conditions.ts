import { FORKOP_UCI_PACKAGE } from '../../../constants';
import { parseValueList } from '../../../helpers/parseValueList';
import { validateDomain } from '../../../validators/validateDomain';
import { validateSubnet } from '../../../validators/validateSubnet';
import {
  analyzeTextListValue,
  configureTextareaOption,
} from '../../cbi/annotatedTextarea';
import {
  SYSTEM_DEVICE_VALUE,
  createLocalDeviceDynamicListWidget,
  normalizeOptionValues,
} from '../../cbi/localDevices';
import {
  getConfigListValues,
  stringArraysEqual,
  valuesToText,
  writeListOption,
} from '../../cbi/uci';
import { validateKeyword, validateRegex } from './validators';

export function makeDeviceOptionsExclusive(
  firstOption: CBIOption,
  secondOption: CBIOption,
) {
  let changing = false;
  const firstWidgets: Record<string, CBIWidget> = {};
  const secondWidgets: Record<string, CBIWidget> = {};

  function removeMatches(
    section_id: string,
    value: unknown,
    otherWidgets: Record<string, CBIWidget>,
  ) {
    if (changing) {
      return;
    }

    const selected = new Set(normalizeOptionValues(value));
    if (!selected.size) {
      return;
    }

    const widget = otherWidgets[section_id];
    if (!widget) {
      return;
    }

    const current = normalizeOptionValues(widget.getValue());
    const filtered = current.filter((item) => !selected.has(item));
    if (stringArraysEqual(current, filtered)) {
      return;
    }

    changing = true;
    try {
      widget.setValue(filtered);
    } finally {
      changing = false;
    }
  }

  firstOption.onDeviceWidgetReady = function (
    section_id: string,
    widget: CBIWidget,
  ) {
    firstWidgets[section_id] = widget;
  };
  secondOption.onDeviceWidgetReady = function (
    section_id: string,
    widget: CBIWidget,
  ) {
    secondWidgets[section_id] = widget;
  };
  firstOption.onDeviceListChange = function (
    section_id: string,
    value: unknown,
  ) {
    removeMatches(section_id, value, secondWidgets);
  };
  secondOption.onDeviceListChange = function (
    section_id: string,
    value: unknown,
  ) {
    removeMatches(section_id, value, firstWidgets);
  };
}

// Shown greyed out in the condition editors: one value per line, and for
// domains every prefix analyzeDomainSuffixText accepts. Both are run through
// their own analyzers by luciPlaceholders.test.js.
export const DOMAIN_CONDITION_PLACEHOLDER = [
  'example.com',
  'full:api.example.com',
  'keyword:google',
  String.raw`regex:^ads\..*\.com$`,
].join('\n');

export const IP_CONDITION_PLACEHOLDER = [
  '1.1.1.1',
  '192.168.1.0/24',
  '2606:4700::/32',
].join('\n');

export function analyzeDomainSuffixText(value: unknown) {
  const validateDomainCondition = (domain: unknown) => {
    const normalized = `${domain || ''}`.trim();
    if (normalized.includes('/')) {
      return { valid: false, message: _('Invalid domain address') };
    }

    return validateDomain(normalized, true);
  };

  return analyzeTextListValue(
    value,
    (item) => {
      const colonIndex = item.indexOf(':');
      const prefix = colonIndex > 0 ? item.slice(0, colonIndex) : '';
      const body = colonIndex > 0 ? item.slice(colonIndex + 1) : item;

      if (!prefix) {
        return validateDomainCondition(body);
      }

      if (!['full', 'keyword', 'regex'].includes(prefix)) {
        return {
          valid: false,
          message: _('Allowed domain prefixes are full:, keyword:, and regex:'),
        };
      }

      if (!body.length) {
        return { valid: false, message: _('Value cannot be empty') };
      }

      if (prefix === 'full') {
        return validateDomainCondition(body);
      }

      if (prefix === 'keyword') {
        const validation = validateKeyword(null as unknown as string, body);
        return validation === true
          ? { valid: true, message: _('Valid') }
          : { valid: false, message: validation };
      }

      if (/[,\s]/.test(body)) {
        return {
          valid: false,
          message: _('Regular expression must not contain spaces or commas'),
        };
      }

      const validation = validateRegex(null as unknown as string, body);
      return validation === true
        ? { valid: true, message: _('Valid') }
        : { valid: false, message: validation };
    },
    _('At least one valid domain must be specified.'),
    {
      normalizeDuplicateValue: (item) => `${item}`.toLowerCase(),
    },
  );
}

function domainValuesWithPrefix(
  section_id: string,
  key: string,
  prefix: string,
) {
  return getConfigListValues(section_id, key).map((value: string) =>
    prefix ? `${prefix}:${value}` : value,
  );
}

function domainTextValuesWithPrefix(
  section_id: string,
  key: string,
  prefix: string,
) {
  const legacyText = uci.get(FORKOP_UCI_PACKAGE, section_id, `${key}_text`);
  if (!legacyText) {
    return [];
  }

  return parseValueList(`${legacyText}`).map((value: string) =>
    prefix ? `${prefix}:${value}` : value,
  );
}

function uniqueDomainTextValues(values: string[]) {
  const seen = new Set<string>();

  return values.filter((value: unknown) => {
    const key = `${value}`.toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function appendUniqueDomainTextValues(textValue: unknown, values: string[]) {
  const originalText = typeof textValue === 'string' ? textValue : '';
  const seen = new Set(
    parseValueList(originalText).map((value: unknown) =>
      `${value}`.toLowerCase(),
    ),
  );
  const additions = uniqueDomainTextValues(values).filter((value: unknown) => {
    const key = `${value}`.toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  if (!additions.length) {
    return originalText;
  }

  const base = originalText.replace(/\s+$/, '');
  return [base, ...additions].filter(Boolean).join('\n');
}

export function loadCombinedDomainText(section_id: string) {
  const textValue =
    uci.get(FORKOP_UCI_PACKAGE, section_id, 'domain') ||
    uci.get(FORKOP_UCI_PACKAGE, section_id, 'domain_suffix_text');
  const values = [
    ...domainValuesWithPrefix(section_id, 'domain_suffix', ''),
    ...domainValuesWithPrefix(section_id, 'domain_keyword', 'keyword'),
    ...domainValuesWithPrefix(section_id, 'domain_regex', 'regex'),
    ...domainTextValuesWithPrefix(section_id, 'domain_suffix', ''),
    ...domainTextValuesWithPrefix(section_id, 'domain', 'full'),
    ...domainTextValuesWithPrefix(section_id, 'domain_keyword', 'keyword'),
    ...domainTextValuesWithPrefix(section_id, 'domain_regex', 'regex'),
  ];

  return appendUniqueDomainTextValues(textValue, values);
}

export function analyzeIpCidrText(value: unknown) {
  return analyzeTextListValue(
    value,
    (item) => validateSubnet(item),
    _('At least one valid IP or subnet must be specified.'),
    {
      normalizeDuplicateValue: (item) => `${item}`.trim(),
    },
  );
}

export function validatePortCondition(_section_id: string, value: unknown) {
  const normalized = value ? `${value}`.trim() : '';

  if (!normalized.length) {
    return true;
  }

  const match = normalized.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) {
    return _('Invalid port or range. Use 80 or 1000-2000');
  }

  const start = Number.parseInt(match[1], 10);
  const end = match[2] ? Number.parseInt(match[2], 10) : start;

  if (start < 1 || start > 65535 || end < 1 || end > 65535) {
    return _('Port must be between 1 and 65535');
  }

  if (start > end) {
    return _('Port range start must be less than or equal to end');
  }

  return true;
}

// One condition field of the Conditions tab: the uci option it writes, its
// wording, and - for the text fields - how its contents are read, checked and
// marked up.
interface ConditionFieldConfig {
  key: string;
  label: string;
  description?: string;
  placeholder?: string;
  optionName?: string;
  // A field that used to store its text under a different option; the value is
  // still read from there for a configuration written before the rename.
  legacyTextOptionName?: string;
  dynamicValidate?: OptionValidator;
  textValidate?: OptionValidator;
  textAnalyze?: TextAnalyzer;
  loadText?: (sectionId: string) => string;
  afterWrite?: (sectionId: string) => void;
}

export function addDynamicConditionField(
  section: CBISection,
  config: ConditionFieldConfig,
) {
  const o = section.taboption(
    'conditions',
    form.DynamicList,
    config.key,
    config.label,
    config.description,
  );

  o.modalonly = true;
  if (config.placeholder) {
    o.placeholder = config.placeholder;
  }
  if (config.dynamicValidate) {
    o.validate = config.dynamicValidate;
  }

  o.load = function (section_id: string) {
    const values = getConfigListValues(section_id, config.key);
    if (values.length) {
      return values;
    }

    const legacyText = uci.get(
      FORKOP_UCI_PACKAGE,
      section_id,
      `${config.key}_text`,
    );
    return legacyText ? parseValueList(`${legacyText}`) : [];
  };

  o.write = function (section_id: string, value: unknown) {
    writeListOption(section_id, config.key, value);
    uci.unset(FORKOP_UCI_PACKAGE, section_id, `${config.key}_text`);
    uci.unset(FORKOP_UCI_PACKAGE, section_id, `${config.key}_text_mode`);
  };

  return o;
}

export function addLocalDeviceSubnetDynamicField(
  section: CBISection,
  config: ConditionFieldConfig,
) {
  const o = section.taboption(
    'conditions',
    form.DynamicList,
    config.key,
    config.label,
    config.description,
  );

  o.modalonly = true;
  o.placeholder = _('Device or IP');
  o.validate = function (_section_id: string, value: string) {
    if (!value || value.length === 0) {
      return true;
    }
    if (value === SYSTEM_DEVICE_VALUE) {
      return true;
    }

    const validation = validateSubnet(value);
    return validation.valid ? true : validation.message;
  };
  o.load = function (section_id: string) {
    const values = getConfigListValues(section_id, config.key);
    if (values.length) {
      return values;
    }

    const legacyText = uci.get(
      FORKOP_UCI_PACKAGE,
      section_id,
      `${config.key}_text`,
    );
    return legacyText ? parseValueList(`${legacyText}`) : [];
  };
  o.write = function (section_id: string, value: unknown) {
    writeListOption(section_id, config.key, value);
    uci.unset(FORKOP_UCI_PACKAGE, section_id, `${config.key}_text`);
    uci.unset(FORKOP_UCI_PACKAGE, section_id, `${config.key}_text_mode`);
  };
  o.renderWidget = function (
    section_id: string,
    _option_index,
    cfgvalue: unknown,
  ) {
    return createLocalDeviceDynamicListWidget(this, section_id, cfgvalue);
  };

  return o;
}

export function addTextConditionField(
  section: CBISection,
  config: ConditionFieldConfig,
) {
  const optionName = config.optionName || `${config.key}_text`;
  const legacyTextOptionName =
    config.legacyTextOptionName || `${config.key}_text`;
  const o = section.taboption(
    'conditions',
    form.TextValue,
    optionName,
    config.label,
    config.description,
  );

  o.rows = 8;
  o.wrap = 'soft';
  o.textarea = true;
  o.modalonly = true;
  o.placeholder = config.placeholder;
  if (config.textAnalyze) {
    const analyze = config.textAnalyze;
    o.validate = function (_section_id: string, value: string) {
      const analysis = analyze(value);
      return analysis.valid ? true : `${analysis.message}`;
    };
  } else if (config.textValidate) {
    o.validate = config.textValidate;
  }
  configureTextareaOption(o, config.textAnalyze);

  o.load = function (section_id: string) {
    if (typeof config.loadText === 'function') {
      return config.loadText(section_id);
    }

    const textValue =
      uci.get(FORKOP_UCI_PACKAGE, section_id, optionName) ||
      uci.get(FORKOP_UCI_PACKAGE, section_id, legacyTextOptionName);
    if (textValue) {
      return valuesToText(textValue);
    }

    return valuesToText(uci.get(FORKOP_UCI_PACKAGE, section_id, config.key));
  };

  o.write = function (section_id: string, value: unknown) {
    const normalized = value ? `${value}`.trim() : '';

    if (normalized.length) {
      uci.set(FORKOP_UCI_PACKAGE, section_id, optionName, normalized);
    } else {
      uci.unset(FORKOP_UCI_PACKAGE, section_id, optionName);
    }

    if (config.key !== optionName) {
      uci.unset(FORKOP_UCI_PACKAGE, section_id, config.key);
    }
    if (legacyTextOptionName !== optionName) {
      uci.unset(FORKOP_UCI_PACKAGE, section_id, legacyTextOptionName);
    }
    uci.unset(FORKOP_UCI_PACKAGE, section_id, `${config.key}_text_mode`);

    if (typeof config.afterWrite === 'function') {
      config.afterWrite(section_id);
    }
  };

  return o;
}
