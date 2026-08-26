// Reading and writing Forkop's own uci package, in the shapes the forms use.
//
// LuCI stores a list option as a bare string when it holds one value and as an
// array when it holds several, and hands back either; every helper here takes
// both and answers in one shape, so a caller never has to ask which it got.

import { FORKOP_UCI_PACKAGE } from '../../constants';
import { normalizeDynamicListItems, normalizeOptionValues } from './listValues';

// A list as a textarea shows it: one value per line.
export function valuesToText(values: unknown): string {
  if (!values) {
    return '';
  }

  if (Array.isArray(values)) {
    return values.filter(Boolean).join('\n');
  }

  return values ? `${values}` : '';
}

export function getUciSectionName(section: UciSectionObject | null): string {
  return section && section['.name'] ? section['.name'] : '';
}

// The name the user gave a section, falling back to its id when it has none.
export function getUciSectionLabel(section: UciSectionObject | null): string {
  return (section && (section.label as string)) || getUciSectionName(section);
}

export function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function getConfigListValues(section_id: string, key: string): string[] {
  return normalizeOptionValues(uci.get(FORKOP_UCI_PACKAGE, section_id, key));
}

export function stringArraysEqual(left: unknown, right: unknown): boolean {
  const first = normalizeDynamicListItems(left);
  const second = normalizeDynamicListItems(right);

  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

// Writes a list option, or removes it when nothing is left. An unchanged list is
// not written at all: LuCI counts any set() as a change, and a save that rewrites
// what was already there shows up as a change the user did not make.
export function writeListOption(
  section_id: string,
  key: string,
  values: unknown,
): void {
  const normalized = normalizeOptionValues(values);

  if (stringArraysEqual(getConfigListValues(section_id, key), normalized)) {
    return;
  }

  if (normalized.length) {
    uci.set(FORKOP_UCI_PACKAGE, section_id, key, normalized);
  } else {
    uci.unset(FORKOP_UCI_PACKAGE, section_id, key);
  }
}
