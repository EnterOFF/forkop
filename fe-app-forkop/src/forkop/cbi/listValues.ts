// The values of a list, from either shape LuCI hands them in.
//
// There are two of these because a scalar means two different things. A widget
// hands back one entry the user typed, and that entry may hold spaces - a
// display name does; so normalizeDynamicListItems keeps it whole. uci hands back
// a bare string for a list option that holds a single value, and a value written
// before the option was a list is space separated inside that one string; so
// normalizeOptionValues splits it. Reading a widget with the uci one would cut a
// name in half, and reading uci with the widget one would keep a whole legacy
// line as a single entry.

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

export function normalizeOptionValues(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .filter(Boolean)
      .map((item) => `${item}`.trim())
      .filter(Boolean);
  }

  return `${value}`
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
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
