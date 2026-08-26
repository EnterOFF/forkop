export function validateRegex(_section_id: string, value: string) {
  if (!value || !value.length) {
    return true;
  }

  try {
    new RegExp(value);
    return true;
  } catch (_error) {
    return _('Invalid regular expression');
  }
}

export function validateKeyword(_section_id: string, value: string) {
  if (!value || !value.length) {
    return true;
  }

  if (/[,\s]/.test(value)) {
    return _('Keyword must not contain spaces or commas');
  }

  return true;
}

function isSingBoxDuration(value: string) {
  return /^(?=.*[1-9])([0-9]+(?:\.[0-9]+)?(?:ns|us|ms|s|m|h|d))+$/.test(value);
}

export function validateOptionalSingBoxDuration(value: unknown) {
  const normalized = value ? `${value}`.trim() : '';

  if (!normalized.length) {
    return true;
  }

  if (isSingBoxDuration(normalized)) {
    return true;
  }

  return _('Use sing-box duration format like 1d, 12h or 30m');
}

export function validateRequiredSingBoxDuration(value: unknown) {
  const normalized = value ? `${value}`.trim() : '';

  if (!normalized.length) {
    return _('Use sing-box duration format like 1d, 12h or 30m');
  }

  if (isSingBoxDuration(normalized)) {
    return true;
  }

  return _('Use sing-box duration format like 1d, 12h or 30m');
}
