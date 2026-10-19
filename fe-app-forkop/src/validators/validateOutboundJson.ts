import { message } from './messages';
import { Check } from './types';

// The field hands sing-box an outbound as written: whatever sing-box accepts is
// its business, and it says what it refuses in the log. Forkop itself needs only
// the tag, which names the outbound in the section and in the routes.
export function validateOutboundJson(
  value: string,
  usedTags: string[] = [],
): Check {
  const normalized = `${value || ''}`.trim();

  if (!normalized.length) {
    return message.required();
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(normalized);
  } catch {
    return message.invalidJson();
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return message.invalidJson();
  }

  const tag = (parsed as { tag?: unknown }).tag;
  if (typeof tag !== 'string' || !tag.trim()) {
    return message.noTag();
  }

  return usedTags.some((usedTag) => `${usedTag || ''}`.trim() === tag.trim())
    ? message.nameTaken()
    : true;
}
