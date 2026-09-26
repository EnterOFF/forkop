// Neither of these is ever handed to an option's validate(): both are called
// from inside a text field that holds a list of values, or from a dialog whose
// section is not the one being edited. So they take the value alone.
// sing-box matches these with RE2, which writes a leading (?i) and a named
// group as JavaScript cannot; the backend refuses whatever RE2 and Forkop
// would read differently.
export function validateRegex(value: string) {
  if (!value || !value.length) {
    return true;
  }

  try {
    new RegExp(value.replace(/^\(\?i\)/, '').replace(/\(\?P</g, '(?<'));
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
