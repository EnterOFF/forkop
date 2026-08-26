import { FORKOP_UCI_PACKAGE } from '../../../constants';
import { listClients, removeServerClients } from './clients';
import { DEFAULT_PROTOCOL, addedServers } from './constants';
import { showServerDetailsModal } from './details';
import { preloadServerModalData } from './network';
import {
  defaultSecurity,
  getProtocol,
  linkScheme,
  usesClients,
} from './protocols';

function loadServerTableOptions(sectionRef: CBISection) {
  const tasks: Promise<unknown>[] = [];

  sectionRef.cfgsections().forEach((sectionId: string) => {
    sectionRef.children.forEach((child) => {
      if (child.disable || child.modalonly) {
        return;
      }
      tasks.push(
        Promise.resolve(child.load.call(child, sectionId)).then(
          (value: unknown) => child.cfgvalue(sectionId, value),
        ),
      );
    });
  });

  return Promise.all(tasks);
}

// The word on a row action button. LuCI's own catalog owns the "Edit" msgid and
// translates it as "Редактировать", which is too long for a table cell beside the
// other actions, and Forkop ships no English catalog - so a msgid is also the
// English text. Hence a Forkop msgid, which carries the short Russian word, and the
// English word written out here for when the catalog hands that msgid straight back.
// Changing the msgid means changing the string it is compared against.
//
// The Sections tab shows the same button. Its rows are configured from forkop.js,
// which already builds this tab through this module, so it takes the label from here
// instead of keeping a second copy of the comparison.
export function getRuleEditButtonText() {
  const label = _('Edit rule action');

  return label === 'Edit rule action' ? 'Edit' : label;
}

function renderServerRowActions(sectionRef: CBISection, sectionId: string) {
  const editLabel = getRuleEditButtonText();
  const detailsLabel = _('Server details');
  const tdEl = E(
    'td',
    { class: 'td cbi-section-table-cell nowrap cbi-section-actions' },
    E('div'),
  );
  const actionsEl = tdEl.lastElementChild as HTMLElement;

  // Only a server whose accounts can be handed a link has anything to show: SSH has
  // no share link format, and Tailscale and a JSON inbound have no accounts at all.
  if (
    usesClients(getProtocol(sectionId)) &&
    linkScheme(getProtocol(sectionId))
  ) {
    dom.append(
      actionsEl,
      E(
        'button',
        {
          class: 'cbi-button center fkp-server-info',
          title: detailsLabel,
          'aria-label': detailsLabel,
          style: 'display:inline-block;',
          click: (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            showServerDetailsModal(sectionId, listClients(sectionId));
          },
        },
        E('span', { class: 'fkp-server-info__glyph' }, 'ⓘ'),
      ),
    );
  }

  dom.append(
    actionsEl,
    E(
      'button',
      {
        title: editLabel,
        class: 'btn cbi-button cbi-button-edit',
        click: ui.createHandlerFn(
          sectionRef,
          'renderMoreOptionsModal',
          sectionId,
        ),
      },
      editLabel,
    ),
  );

  if (sectionRef.addremove) {
    dom.append(
      actionsEl,
      E(
        'button',
        {
          title: _('Delete'),
          class: 'btn cbi-button cbi-button-remove',
          click: ui.createHandlerFn(sectionRef, 'handleRemove', sectionId),
          disabled: sectionRef.map.readonly || null,
        },
        _('Delete'),
      ),
    );
  }

  return tdEl;
}

export function configureServerSection(sectionRef: CBISection) {
  sectionRef.sortable = false;
  sectionRef.nodescriptions = true;
  sectionRef.load = function () {
    // The table renders only non-modal fields; the cloned Add/Edit modal loads the
    // rest when the user opens it. The router's own addresses and the ports other
    // services hold are read once here, so the port check can name the owner.
    return Promise.all([
      preloadServerModalData(),
      loadServerTableOptions(this),
    ]);
  };

  sectionRef.handleAdd = function () {
    const sectionId = this.addLabeledSection!();
    const mapNode = this.getPreviousModalMap();
    const prevMap = (
      mapNode ? dom.findClassInstance(mapNode) : this.map
    ) as CBIMap;

    prevMap.addedSection = sectionId;
    // The section exists from the moment Add is pressed, and a dialog that is never
    // finished leaves it behind. Nothing writes the switch until the dialog is
    // saved, and a server without one counts as disabled, so an unfinished server
    // is inert: the validator and the generator skip it. The dialog still shows
    // the switch on, because that is what saving it writes.
    addedServers.add(sectionId);
    uci.set(FORKOP_UCI_PACKAGE, sectionId, 'protocol', DEFAULT_PROTOCOL);
    uci.set(
      FORKOP_UCI_PACKAGE,
      sectionId,
      'security',
      defaultSecurity(DEFAULT_PROTOCOL),
    );

    return this.renderMoreOptionsModal(sectionId);
  };

  // Removing a server takes its clients with it, otherwise they stay behind as
  // sections pointing at a server that no longer exists.
  sectionRef.handleRemove = function (sectionId: string, ev) {
    removeServerClients(sectionId);

    return form.GridSection.prototype.handleRemove.call(this, sectionId, ev);
  };

  sectionRef.handleModalSave = function (modalMap: CBIModalMap, ev) {
    const mapNode = this.getActiveModalMap();
    const activeMap = dom.findClassInstance(mapNode) as CBIModalMap;
    const sectionId = modalMap?.section || activeMap.section;

    return (
      activeMap
        .parse()
        .then(() => {
          addedServers.delete(sectionId);

          return form.GridSection.prototype.handleModalSave.call(
            this,
            modalMap,
            ev,
          );
        })
        // A rejected check already marks its own field and the dialog stays open,
        // but that first pass wrote every field that did pass, the switch among
        // them. A server that never got through its checks goes back to disabled,
        // so leaving the page with the dialog open cannot stop the service.
        .catch(() => {
          if (addedServers.has(sectionId)) {
            uci.unset(FORKOP_UCI_PACKAGE, sectionId, 'enabled');
          }

          return null;
        })
    );
  };

  sectionRef.renderRowActions = function (sectionId: string) {
    return renderServerRowActions(this, sectionId);
  };
}
