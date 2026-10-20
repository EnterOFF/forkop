import { message } from './messages';
import { Check } from './types';

// sing-box judges the outbound and logs what it refuses; Forkop needs only the tag.
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
