import { ValidationResult } from './types';
import { validatePath } from './validatePath';

// Both sing-box file paths are write targets the user picks: the generated
// config replaces whatever already sits at its path, and the cache directory is
// created on start. Requiring the expected file name and a directory above it
// keeps a stray value from overwriting an unrelated file or landing in the
// filesystem root.
export function validateSingBoxFilePath(
  value: string,
  fileName: string,
): ValidationResult {
  const path = validatePath(value);
  if (!path.valid) {
    return path;
  }

  if (!value.endsWith(fileName)) {
    return {
      valid: false,
      message: _('Path must end with %s').replace('%s', fileName),
    };
  }

  if (value.split('/').filter(Boolean).length < 2) {
    return {
      valid: false,
      message: _(
        'Path must contain at least one directory (like /tmp/%s)',
      ).replace('%s', fileName),
    };
  }

  return { valid: true, message: _('Valid') };
}
