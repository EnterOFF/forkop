// The rendered entries of a dynamic list, reached through their DOM nodes.
//
// LuCI's DynamicList keeps each entry's real value in a hidden input inside the
// entry and shows a label beside it, so the two can differ: a child item shows
// the name the user gave it while the list stores the id of its section. Every
// helper here works that pair, which is why they all start by finding the hidden
// input and checking it belongs to the entry rather than to a nested one.

// The hidden input holding an entry's stored value, or null when the node given
// is not an entry.

import { E } from '../../helpers/element';
import { message } from '../../validators/messages';
function itemValueInput(
  item: Element | null | undefined,
): HTMLInputElement | null {
  const hidden = item
    ? (item.querySelector('input[type="hidden"]') as HTMLInputElement | null)
    : null;
  return hidden && hidden.parentNode === item ? hidden : null;
}

export function findDynamicListItemByValue(
  dl: HTMLElement,
  value: unknown,
): Element | null {
  const stringValue = `${value}`;
  const items = dl.querySelectorAll('.item');

  for (let i = 0; i < items.length; i += 1) {
    const hidden = itemValueInput(items[i]);
    if (hidden && hidden.value === stringValue) {
      return items[i];
    }
  }

  return null;
}

export function dynamicListItemCurrentValue(
  item: Element | null,
  fallback: string,
): string {
  const hidden = itemValueInput(item);
  return hidden ? hidden.value : fallback;
}

export function dynamicListItemValues(dl: HTMLElement): string[] {
  return Array.from(dl.querySelectorAll('.item'))
    .map((item) => {
      const hidden = itemValueInput(item);
      return hidden ? hidden.value : null;
    })
    .filter((value): value is string => value != null);
}

// The label a child item list shows for one entry: the name the item was given
// rather than the id the widget stores under it.
export function renderChildItemLabel(
  option: CBIOption,
  sectionId: string,
  itemId: string,
) {
  return E(
    'span',
    { class: 'fkp-dynlist-label' },
    option.inputValueForItem!(sectionId, itemId),
  );
}

export function updateDynamicListItemLabel(
  item: Element | null,
  label: string,
): void {
  const labelNode = item ? item.querySelector('.fkp-dynlist-label') : null;
  if (labelNode) {
    labelNode.textContent = `${label || ''}`;
  }
}

export function addDynamicListItem(
  widget: CBIWidget,
  value: unknown,
  text?: string,
): Element | null {
  if (!widget || !widget.node) {
    return null;
  }

  const normalized = `${value || ''}`.trim();
  if (!normalized) {
    return null;
  }

  const options = (widget.options || {}) as {
    hasEquivalentValue?: (value: string, node: HTMLElement) => boolean;
    addButtonLabel?: string;
  };

  if (
    typeof options.hasEquivalentValue === 'function' &&
    options.hasEquivalentValue(normalized, widget.node)
  ) {
    widget.dispatchCbiDynlistChange(widget.node, normalized);
    return null;
  }

  widget.addItem(widget.node, normalized, text || null, false);
  widget.dispatchCbiDynlistChange(widget.node, normalized);
  updateButtonAddDynamicListLayout(widget.node, options.addButtonLabel);

  return findDynamicListItemByValue(widget.node, normalized);
}

// The add button of a list that adds through a dialog rather than by typing: it
// is rebuilt as a dropdown control so it lines up with the entries above it and
// carries the caption the option asked for.
export function updateButtonAddDynamicListLayout(
  dl: HTMLElement,
  label?: string,
): void {
  const addButton = dl
    ? dl.querySelector('.add-item > .fkp-button-add-control') ||
      dl.querySelector('.add-item > .cbi-button-add')
    : null;
  if (!addButton) {
    return;
  }

  if (!addButton.classList.contains('fkp-button-add-control')) {
    addButton.className = 'cbi-dropdown fkp-button-add-control';
    addButton.replaceChildren(
      E(
        'ul',
        { tabindex: '-1' },
        E('li', { placeholder: '', selected: '', display: '0' }),
      ),
      E('span', { 'aria-hidden': 'true' }, '\u200b'),
    );
  }

  const buttonLabel = label || '+';
  (addButton.querySelector('li') as HTMLElement).textContent = buttonLabel;
  addButton.setAttribute('role', 'button');
  addButton.setAttribute('tabindex', '0');
  addButton.setAttribute('aria-label', buttonLabel);
  addButton.setAttribute(
    'aria-disabled',
    dl.hasAttribute('disabled') ? 'true' : 'false',
  );
}

export function setDynamicListItemValue(
  item: Element | null | undefined,
  value: unknown,
): void {
  const hidden = itemValueInput(item);
  if (hidden) {
    hidden.value = `${value || ''}`;
  }
}

function dynamicListItemLabels(widget: CBIWidget) {
  return Array.from(widget?.node?.querySelectorAll('.fkp-dynlist-label') || []);
}

export function dynamicListItemNames(widget: CBIWidget) {
  return dynamicListItemLabels(widget).map((label) =>
    `${label.textContent || ''}`.trim(),
  );
}

export function validateUniqueDynamicListItemName(
  widget: CBIWidget,
  itemNode: Element | null,
  value: unknown,
): true | string {
  const currentLabel = itemNode?.querySelector('.fkp-dynlist-label');
  return dynamicListItemLabels(widget).some(
    (label) =>
      label !== currentLabel &&
      `${label.textContent || ''}`.trim() === `${value || ''}`.trim(),
  )
    ? message.nameTaken()
    : true;
}
