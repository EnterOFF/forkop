import { FORKOP_UCI_PACKAGE } from '../../constants';
import { nextSectionId } from '../cbi/childItems';
import { getRuleEditButtonText } from '../cbi/grid';
import { clearSharedChildPendingSettings } from '../cbi/itemSettings';
import { captureUnsavedUci, restoreUnsavedUci } from '../cbi/unsavedUci';
import type { UnsavedUci } from '../cbi/unsavedUci';
import { E } from '../../helpers/element';

// LuCI's own Add control asks for a name first. Both grids name a section
// themselves - the id says what type it is and the label is a free-form name the
// dialog shows - so the control here is the button alone.
function renderSectionAdd(sectionRef: CBISection, extraClass?: string) {
  const el = E('div', { class: 'cbi-section-create' });
  const buttonTitle = sectionRef.titleFn('addbtntitle') || _('Add');
  const button = E(
    'button',
    {
      class: 'cbi-button cbi-button-add',
      title: buttonTitle,
      click: ui.createHandlerFn(sectionRef, 'handleAdd'),
      disabled: sectionRef.map.readonly || null,
    },
    [buttonTitle],
  );

  if (extraClass) {
    el.classList.add(extraClass);
  }

  el.appendChild(button);

  return el;
}

// The label a new row is offered: one past the highest number its prefix already
// carries. A server and a section may not share a name, so both are looked at,
// and a count of the rows would offer the name of one still there once an
// earlier row had been removed.
function nextLabel(sectionRef: CBISection, configName: string, prefix: string) {
  const taken = new Set(
    ['server', 'section'].flatMap((type) =>
      (sectionRef.map.data.sections(configName, type) || []).map((section) =>
        `${section.label || ''}`.trim(),
      ),
    ),
  );
  const pattern = new RegExp(`^${prefix} #(\\d+)$`);
  let number =
    Math.max(
      0,
      ...[...taken].map((label) => Number(pattern.exec(label)?.[1] || 0)),
    ) + 1;
  while (taken.has(`${prefix} #${number}`)) number += 1;
  return `${prefix} #${number}`;
}

// A new row: the section is created under an id naming its type, and given a
// label the user can change, because the id is not shown anywhere.
export function addLabeledSection(sectionRef: CBISection) {
  const configName = sectionRef.uciconfig || sectionRef.map.config;
  const prefix = sectionRef.sectiontype === 'section' ? 'Section' : 'Server';
  const label = nextLabel(sectionRef, configName, prefix);
  const sectionId = sectionRef.map.data.add(
    configName,
    sectionRef.sectiontype,
    nextSectionId(sectionRef.sectiontype),
  );

  sectionRef.map.data.set(configName, sectionId, 'label', label);
  return sectionId;
}

// What the Sections and Servers grids have in common: they are the same table
// twice, and the user moves between them by clicking a tab.
export function configureGridSection(
  sectionRef: CBISection,
  type: string,
  title: string,
  addTitle: string,
  // What the tab wants written into a section the moment Add is pressed, before
  // its dialog opens - the Servers tab seeds a protocol there.
  onSectionAdded?: (sectionId: string) => void,
) {
  sectionRef.anonymous = false;
  sectionRef.addremove = true;
  sectionRef.sortable = true;
  sectionRef.rowcolors = true;
  sectionRef.nodescriptions = true;
  sectionRef.modaltitle = function (section_id: string) {
    const label = uci.get(FORKOP_UCI_PACKAGE, section_id, 'label');
    return section_id ? `${title}: ${label || section_id}` : addTitle;
  };
  sectionRef.sectiontitle = function (section_id: string) {
    return uci.get(FORKOP_UCI_PACKAGE, section_id, 'label') || section_id;
  };
  sectionRef.renderSectionAdd = function (extraClass?: string) {
    return renderSectionAdd(sectionRef, extraClass);
  };
  sectionRef.handleAdd = function () {
    const sectionId = addLabeledSection(this);
    const mapNode = this.getPreviousModalMap();
    const prevMap = (
      mapNode ? dom.findClassInstance(mapNode) : this.map
    ) as CBIMap;

    prevMap.addedSection = sectionId;
    onSectionAdded?.(sectionId);
    return this.renderMoreOptionsModal(sectionId);
  };

  // A nested dialog writes its item into uci when it closes, ahead of the
  // section dialog's own save, and a refused save leaves the options that passed.
  // Dismissing the dialog puts uci back as it was when the dialog opened, so the
  // next save anywhere on the page does not push what the user threw away.
  let unsaved: UnsavedUci | null = null;
  sectionRef.renderMoreOptionsModal = function (
    section_id: string,
    ev?: Event,
  ) {
    unsaved = captureUnsavedUci();
    return form.GridSection.prototype.renderMoreOptionsModal.call(
      this,
      section_id,
      ev,
    );
  };
  sectionRef.handleModalCancel = function (
    modalMap: unknown,
    ev: Event,
    isSaving?: boolean,
  ) {
    if (!isSaving && unsaved) {
      restoreUnsavedUci(unsaved);
    }
    unsaved = null;
    clearSharedChildPendingSettings();
    return form.GridSection.prototype.handleModalCancel.call(
      this,
      modalMap,
      ev,
      isSaving,
    );
  };

  if (type === 'section') {
    // The shared grid layer owns the word on the row action button, so the two
    // tables spell it the same way.
    sectionRef.renderRowActions = function (section_id: string) {
      return form.TableSection.prototype.renderRowActions.call(
        this,
        section_id,
        getRuleEditButtonText(),
      );
    };
  }
}
