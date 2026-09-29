import {
  applyChildItemSettings,
  childItemInputValue,
  isExistingChildItem,
} from './childItems';
import {
  changedSettings,
  childPendingSettingsStore,
  hasChangedSettings,
  pendingChildSettings,
  readChildSettings,
} from './itemSettings';
import { setDynamicListItemValue } from './listItems';
import { E } from '../../helpers/element';
import { showToast } from '../../helpers/showToast';

// LuCI keeps a dialog open when its save is refused and says nothing. A field
// whose widget checks its own value is already marked, and its tab counts it;
// any other refusal would go unseen, so its reason is shown.
export function reportRefusedSave(error: unknown, dialog?: ParentNode | null) {
  if (dialog?.querySelector('.cbi-input-invalid')) {
    return;
  }
  const message = error instanceof Error ? error.message : `${error ?? ''}`;
  showToast(message.trim() || _('Settings not saved'), 'error');
}

// LuCI's own section dialog save, which saves with the error dialog off and
// drops whatever refused it. Answers whether the dialog saved.
export function saveSectionModal(
  sectionRef: CBISection,
  modalMap: CBIMap | CBIModalMap,
  ev: Event,
) {
  const mapNode = sectionRef.getActiveModalMap();
  const activeMap = dom.findClassInstance(mapNode) as CBIMap;
  let saved: Promise<unknown> = activeMap.save(undefined, true);
  for (let map = activeMap.parent; map; map = map.parent) {
    const parent = map;
    saved = saved.then(() => parent.load()).then(() => parent.reset());
  }

  return saved
    .then(() => sectionRef.handleModalCancel(modalMap, ev, true))
    .then(
      () => true,
      (error: unknown) => {
        reportRefusedSave(error, mapNode as ParentNode | null);
        return false;
      },
    );
}

export function modalOptionFormValue(
  modalMap: CBIMap,
  section_id: string,
  optionName: string,
) {
  const lookup =
    modalMap && typeof modalMap.lookupOption === 'function'
      ? modalMap.lookupOption(optionName, section_id)
      : null;

  return lookup ? lookup[0].formvalue(lookup[1]) : null;
}

const SINGLE_FIELD_MODAL_STYLE_ID = 'fkp-single-field-modal-styles';

function cleanFormSectionData(sectionData: unknown): ChildSettings {
  const result: ChildSettings = {};

  Object.entries((sectionData || {}) as ChildSettings).forEach(
    ([key, value]) => {
      if (!key || key.charAt(0) === '.') {
        return;
      }

      result[key] = Array.isArray(value) ? value.slice() : value;
    },
  );

  return result;
}

// A dialog that edits one text field: the modal heading already names it, so the
// row drops its label and gives the whole width to the editor.
export const SINGLE_FIELD_MODAL_CLASS = 'fkp-single-field-modal';

export function ensureSingleFieldModalStyles() {
  if (
    typeof document === 'undefined' ||
    !document.head ||
    document.getElementById(SINGLE_FIELD_MODAL_STYLE_ID)
  ) {
    return;
  }

  document.head.insertAdjacentHTML(
    'beforeend',
    `<style id="${SINGLE_FIELD_MODAL_STYLE_ID}">
      .${SINGLE_FIELD_MODAL_CLASS} .cbi-value-title {
        display: none;
      }

      .${SINGLE_FIELD_MODAL_CLASS} .cbi-value-field {
        width: 100%;
        max-width: 100%;
        flex: 1 1 auto;
        float: none;
        padding-left: 0;
        margin-left: 0;
      }

      .${SINGLE_FIELD_MODAL_CLASS} .cbi-value {
        margin-bottom: 0;
      }
    </style>`,
  );
}

export function renderStackedJsonSettingsModal(
  title: string,
  map: CBIMap,
  onSave: (settings: ChildSettings) => unknown,
  options: StackedModalOptions = {},
) {
  const modal = document.querySelector('#modal_overlay > .modal.cbi-modal');
  const activeMap = modal ? modal.querySelector('.cbi-map:not(.hidden)') : null;
  const buttonRow = modal ? modal.querySelector('div.button-row') : null;
  const heading = modal ? modal.querySelector('h4') : null;

  if (!modal || !activeMap || !buttonRow || !heading) {
    return Promise.resolve();
  }

  return map.render().then((nodes) => {
    if (options.singleField) {
      ensureSingleFieldModalStyles();
      nodes.classList.add(SINGLE_FIELD_MODAL_CLASS);
    }

    const titleNode = E('span', {}, title ? ` » ${title}` : '');
    const originalButtonClass = buttonRow.getAttribute('class') || '';
    const originalButtonNodes = Array.from(buttonRow.childNodes);
    let closed = false;
    let saveButton: HTMLButtonElement | undefined;

    const restoreButtonRow = () => {
      buttonRow.textContent = '';
      originalButtonNodes.forEach((node) => buttonRow.appendChild(node));
      buttonRow.setAttribute('class', originalButtonClass);
    };

    const close = () => {
      if (closed) {
        return;
      }

      closed = true;

      if (nodes.parentNode) {
        nodes.parentNode.removeChild(nodes);
      }
      if (titleNode.parentNode) {
        titleNode.parentNode.removeChild(titleNode);
      }

      activeMap.classList.remove('hidden');
      restoreButtonRow();
    };

    const save = () => {
      if (saveButton) {
        saveButton.disabled = true;
      }

      return map
        .parse()
        .then(() =>
          Promise.resolve(
            onSave(cleanFormSectionData(map.data.get(map.config, 'settings'))),
          ),
        )
        .then(close)
        .catch((error: unknown) => {
          reportRefusedSave(error, nodes);
          if (saveButton) {
            saveButton.disabled = false;
          }
        });
    };

    buttonRow.textContent = '';
    buttonRow.append(
      // This dialog is stacked on another one, and leaving it puts that one back
      // rather than closing anything: `close` above takes the nested map out and
      // restores the parent's own buttons. "Close" said the opposite of what the
      // button does.
      E(
        'button',
        {
          class: 'btn cbi-button',
          click: close,
        },
        _('Back'),
      ),
      ' ',
      ...(() => {
        saveButton = E(
          'button',
          {
            class: 'btn cbi-button cbi-button-positive important',
            click: save,
          },
          options.saveLabel || _('Save'),
        );
        const action = options.secondaryAction;
        // The theme spreads the items of the row apart, so two buttons meant to
        // sit together on its right are one item of it.
        return action
          ? [
              E('span', {}, [
                E(
                  'button',
                  {
                    class: 'btn cbi-button cbi-button-neutral',
                    click: () => action.run(save),
                  },
                  action.label,
                ),
                ' ',
                saveButton,
              ]),
            ]
          : [saveButton];
      })(),
    );

    heading.appendChild(titleNode);
    activeMap.classList.add('hidden');
    activeMap.parentNode!.insertBefore(nodes, activeMap.nextElementSibling);
  });
}

export function showChildItemSettingsModal(
  section_id: string,
  itemValue: unknown,
  option: CBIOption,
  settings: ChildItemDialog,
) {
  const value = `${itemValue || ''}`.trim();
  const existing = isExistingChildItem(
    section_id,
    value,
    settings.typeName,
    settings.ownerOption,
  );
  const inputValue = childItemInputValue(
    section_id,
    value,
    settings.typeName,
    settings.valueOption,
    settings.ownerOption,
  );
  const defaults =
    typeof settings.defaults === 'function'
      ? settings.defaults(inputValue, existing)
      : Object.assign({}, settings.defaults || {});
  const initialSettings = existing
    ? readChildSettings(value, settings.keys, defaults)
    : Object.assign(
        {},
        // A pending item is stored under its display value, so an item that is
        // still being added has nothing to restore and must use fresh defaults
        // instead of the state a dismissed modal left behind.
        inputValue
          ? pendingChildSettings(option, section_id, inputValue, defaults)
          : defaults,
      );
  const data = {
    settings: Object.assign({}, initialSettings),
  };
  const map = new form.JSONMap(data);
  const itemSection = map.section(form.NamedSection, 'settings');
  itemSection.anonymous = true;
  itemSection.addremove = false;
  settings.addOptions(itemSection, {
    parentSectionId: () => section_id,
    ownerId: () => value || section_id,
    itemValue: () => inputValue,
    listOption: option,
    validateName: settings.validateName,
  });

  return renderStackedJsonSettingsModal(
    settings.title(inputValue),
    map,
    (nextSettings: ChildSettings) => {
      if (existing) {
        const diff = changedSettings(
          initialSettings,
          nextSettings,
          settings.keys,
        );
        if (hasChangedSettings(diff)) {
          applyChildItemSettings(value, diff);
        }
        if (typeof settings.afterSave === 'function') {
          settings.afterSave(value, inputValue, nextSettings, existing);
        }
        return;
      }

      const nextInputValue =
        `${nextSettings[settings.valueOption ?? ''] || inputValue || ''}`.trim();
      const store = childPendingSettingsStore(option, section_id);
      if (nextInputValue !== inputValue) {
        delete store[inputValue];
        // A draft item is identified by its display value, so the list item has
        // to follow the rename to keep pointing at its staged settings.
        setDynamicListItemValue(settings.itemNode, nextInputValue);
      }
      store[nextInputValue] = nextSettings;
      if (typeof settings.afterSave === 'function') {
        settings.afterSave(value, nextInputValue, nextSettings, existing);
      }
    },
  );
}

export function setModalOptionValue(
  map: CBIMap,
  option: CBIOption,
  value: unknown,
) {
  map.data.set(map.config, 'settings', option.option, value);
  const element =
    typeof option.getUIElement === 'function'
      ? option.getUIElement('settings')
      : null;
  if (element && typeof element.setValue === 'function') {
    element.setValue(value as string | string[] | null);
    element.triggerValidation();
  }
}
