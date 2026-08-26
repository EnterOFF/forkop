// A sing-box duration: one or more number-and-unit pairs, with at least one
// non-zero digit, so "0s" and "" are refused and "1d", "12h" and "2m30s" are
// not. sing-box parses the same shape, and a field that accepts anything else
// produces a configuration the service refuses to start with.
//
// The Sections and Settings tabs both ask for durations, and both answer the
// way a LuCI field check does: true, or the reason it refuses.
const SING_BOX_DURATION_MESSAGE = () =>
  _('Use sing-box duration format like 1d, 12h or 30m');

export function isSingBoxDuration(value: string) {
  return /^(?=.*[1-9])([0-9]+(?:\.[0-9]+)?(?:ns|us|ms|s|m|h|d))+$/.test(value);
}

export function validateOptionalSingBoxDuration(value: unknown) {
  const normalized = value ? `${value}`.trim() : '';

  if (!normalized.length) {
    return true;
  }

  return isSingBoxDuration(normalized) ? true : SING_BOX_DURATION_MESSAGE();
}

export function validateRequiredSingBoxDuration(value: unknown) {
  const normalized = value ? `${value}`.trim() : '';

  return normalized.length && isSingBoxDuration(normalized)
    ? true
    : SING_BOX_DURATION_MESSAGE();
}
