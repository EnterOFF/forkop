// While the dialog is open a changed value is not stored yet, so the widget wins.
// Every field that depends on the protocol, on the cipher or on the authentication
// switch has to follow the selection immediately instead of after a save.

import { FORKOP_UCI_PACKAGE } from '../../../constants';

export function asList(value: unknown): string[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value.filter(Boolean) : [`${value}`];
}

// A scalar option of a server section; a list option is read with optionList().
export function option(sectionId: string, name: string): string {
  return (uci.get(FORKOP_UCI_PACKAGE, sectionId, name) as string) || '';
}

export function optionList(sectionId: string, name: string) {
  return asList(uci.get(FORKOP_UCI_PACKAGE, sectionId, name));
}

// The widget of an option, found the way LuCI finds it itself: by the id of the
// frame it renders, which every widget carries. The inner control is only named
// widget.<cbid> by some of them - a checkbox puts that in data-widget-id and gives
// its input a random id - so looking for the control found nothing for a flag and
// every reader silently fell back to the stored value. The open dialog is searched
// first, because the table behind it renders the editable columns under the same
// ids.
export function widgetNode(
  sectionId: string,
  name: string,
): HTMLElement | null {
  const id = `cbid.${FORKOP_UCI_PACKAGE}.${sectionId}.${name}`;
  const modal = document.querySelector('#modal_overlay > .modal');

  return ((modal && modal.querySelector(`[id="${id}"]`)) ||
    document.getElementById(id)) as HTMLElement | null;
}

// The rendered widget of a field, when the dialog holding it is open. A widget
// answers what the user has typed; the stored value has not caught up yet.
function liveElement(sectionId: string, name: string): CBIWidget | null {
  const node = widgetNode(sectionId, name);
  const element = node
    ? (dom.findClassInstance(node) as CBIWidget | null)
    : null;

  return element && typeof element.getValue === 'function' ? element : null;
}

export function liveOption(sectionId: string, name: string): string {
  const element = liveElement(sectionId, name);

  if (!element) {
    return option(sectionId, name);
  }

  const value = element.getValue();
  return value == null ? '' : `${value}`;
}

export function isEmptyValue(value: unknown) {
  return (
    value == null ||
    value === '' ||
    (Array.isArray(value) &&
      value.filter((item) => item != null && item !== '').length === 0)
  );
}

export function valueList(value: unknown) {
  return (Array.isArray(value) ? value : [value]).filter(
    (item) => item != null && item !== '',
  );
}

export function hasControlCharacters(value: string) {
  return Array.from(value).some((char) => {
    const code = char.codePointAt(0)!;
    return code < 0x20 || code === 0x7f;
  });
}
