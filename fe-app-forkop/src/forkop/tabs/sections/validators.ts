import { message } from '../../../validators/messages';

// Called from inside a text field that holds a list of values, or from a dialog
// whose section is not the one being edited, so it takes the value alone.
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
    return message.invalidRegex();
  }
}
