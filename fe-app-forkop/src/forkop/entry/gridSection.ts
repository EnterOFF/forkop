import { FORKOP_UCI_PACKAGE } from '../../constants';
import { nextSectionId } from '../cbi/childItems';
import { getRuleEditButtonText } from '../tabs/servers';

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

// A new row: the section is created under an id naming its type, and given a
// label the user can change, because the id is not shown anywhere.
function addLabeledSection(sectionRef: CBISection) {
  const configName = sectionRef.uciconfig || sectionRef.map.config;
  const prefix = sectionRef.sectiontype === 'section' ? 'Section' : 'Server';
  const label = `${prefix} #${sectionRef.cfgsections().length + 1}`;
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
  sectionRef.addLabeledSection = function () {
    return addLabeledSection(this);
  };
  sectionRef.handleAdd = function () {
    const sectionId = this.addLabeledSection!();
    const mapNode = this.getPreviousModalMap();
    const prevMap = (
      mapNode ? dom.findClassInstance(mapNode) : this.map
    ) as CBIMap;

    prevMap.addedSection = sectionId;
    return this.renderMoreOptionsModal(sectionId);
  };

  if (type === 'section') {
    // The Servers tab owns the word on the row action button, so the two tables
    // spell it the same way.
    sectionRef.renderRowActions = function (section_id: string) {
      return form.TableSection.prototype.renderRowActions.call(
        this,
        section_id,
        getRuleEditButtonText(),
      );
    };
  }
}
