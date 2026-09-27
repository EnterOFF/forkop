import { ValidationResult } from './types';

function invalid(message: string): ValidationResult {
  return { valid: false, message };
}

// The field hands sing-box an outbound as written: whatever sing-box accepts is
// its business, and it says what it refuses in the log. Forkop itself needs only
// the tag, which names the outbound in the section and in the routes.
export function validateOutboundJson(
  value: string,
  usedTags: string[] = [],
): ValidationResult {
  const normalized = `${value || ''}`.trim();

  if (!normalized.length) {
    return invalid(_('JSON outbound cannot be empty'));
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(normalized);
  } catch {
    return invalid(_('Invalid JSON format'));
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return invalid(_('JSON outbound must be a JSON object'));
  }

  const tag = (parsed as { tag?: unknown }).tag;
  if (typeof tag !== 'string' || !tag.trim()) {
    return invalid(_('JSON outbound must contain a non-empty tag field'));
  }

  if (usedTags.some((usedTag) => `${usedTag || ''}`.trim() === tag.trim())) {
    return invalid(_('Duplicate JSON outbound tag'));
  }

  return { valid: true, message: _('Valid') };
}
