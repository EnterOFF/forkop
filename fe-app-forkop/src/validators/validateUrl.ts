import { ValidationResult } from './types';
import { isValidHost, isValidPort } from './hostPort';

export function validateUrl(
  url: string,
  protocols = ['http:', 'https:'],
): ValidationResult {
  if (!url.length) {
    return { valid: false, message: _('Invalid URL format') };
  }

  const hasValidProtocol = protocols.some((p) => url.indexOf(p + '//') === 0);

  if (!hasValidProtocol)
    return {
      valid: false,
      message:
        _('URL must use one of the following protocols:') +
        ' ' +
        protocols.join(', '),
    };

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.startsWith('[')
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;
    if (
      (isValidHost(host) || host === 'localhost') &&
      (!parsed.port || isValidPort(parsed.port))
    ) {
      return { valid: true, message: _('Valid') };
    }
  } catch (_e) {
    return { valid: false, message: _('Invalid URL format') };
  }

  return { valid: false, message: _('Invalid URL format') };
}

// The same check as a LuCI field asks it: true, or the reason it refuses. Every
// URL field in the app - a latency test target, a URLTest probe, a Tailscale
// coordination server - runs exactly this.
export function validateUrlField(value: unknown) {
  const validation = validateUrl(`${value || ''}`.trim());
  return validation.valid ? true : validation.message;
}
