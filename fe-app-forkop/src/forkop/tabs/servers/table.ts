import { FORKOP_UCI_PACKAGE } from '../../../constants';
import { getRuleEditButtonText, loadVisibleTableOptions } from '../../cbi/grid';
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

// The section exists from the moment Add is pressed, and a dialog that is never
// finished leaves it behind. Nothing writes the switch until the dialog is saved,
// and a server without one counts as disabled, so an unfinished server is inert:
// the validator and the generator skip it. The dialog still shows the switch on,
// because that is what saving it writes.
export function prepareAddedServer(sectionId: string) {
  addedServers.add(sectionId);
  uci.set(FORKOP_UCI_PACKAGE, sectionId, 'protocol', DEFAULT_PROTOCOL);
  uci.set(
    FORKOP_UCI_PACKAGE,
    sectionId,
    'security',
    defaultSecurity(DEFAULT_PROTOCOL),
  );
}

export function configureServerSection(sectionRef: CBISection) {
  sectionRef.sortable = false;
  sectionRef.nodescriptions = true;
  sectionRef.load = function () {
    // The router's own addresses and the ports other services hold are read
    // once here, so the port check can name the owner.
    return Promise.all([
      preloadServerModalData(),
      loadVisibleTableOptions(this),
    ]);
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
