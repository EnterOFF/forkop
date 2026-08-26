export function normalizeDynamicListItems(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => `${item || ''}`.trim())
      .filter((item) => item.length);
  }

  const normalized = `${value}`.trim();
  return normalized.length ? [normalized] : [];
}

export function nextDynamicListName(
  option: CBIOption,
  formSectionId: string,
  savedItems: unknown,
  prefix: string,
) {
  let current: UciValue | undefined = null;
  if (option && typeof option.formvalue === 'function') {
    try {
      current = option.formvalue(formSectionId);
    } catch (_error) {
      // The widget is not mounted; use the saved child sections below.
    }
  }

  const items = normalizeDynamicListItems(
    current == null ? savedItems : current,
  );
  return `${prefix} #${items.length + 1}`;
}

export function uniqueDynamicListItems(value: unknown): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  normalizeDynamicListItems(value).forEach((item) => {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  });

  return result;
}
