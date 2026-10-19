import { Check } from './types';
import { validatePath } from './validatePath';

// Both sing-box file paths are write targets the user picks: the generated
// config replaces whatever already sits at its path, and the cache directory is
// created on start. Requiring the expected file name and a directory above it
// keeps a stray value from overwriting an unrelated file or landing in the
// filesystem root.
export function validateSingBoxFilePath(
  value: string,
  fileName: string,
): Check {
  const path = validatePath(value);
  if (path !== true) {
    return path;
  }

  if (!value.endsWith(fileName)) {
    return _('Path must end with %s').format(fileName);
  }

  return value.split('/').filter(Boolean).length < 2
    ? _('Format: %s').format(`/tmp/${fileName}`)
    : true;
}
