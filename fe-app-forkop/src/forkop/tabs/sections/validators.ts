// Neither of these is ever handed to an option's validate(): both are called
// from inside a text field that holds a list of values, or from a dialog whose
// section is not the one being edited. So they take the value alone.
export function validateRegex(value: string) {
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

export function validateKeyword(value: string) {
  if (!value || !value.length) {
    return true;
  }

  if (/[,\s]/.test(value)) {
    return _('Keyword must not contain spaces or commas');
  }

  return true;
}
