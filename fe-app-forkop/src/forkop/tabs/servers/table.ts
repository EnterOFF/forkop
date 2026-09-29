import { FORKOP_UCI_PACKAGE } from '../../../constants';
import { getRuleEditButtonText, loadVisibleTableOptions } from '../../cbi/grid';
import { saveSectionModal } from '../../cbi/modal';
import { listClients, removeServerClients } from './clients';
import { DEFAULT_PROTOCOL } from './constants';
import { iconSvg, showServerDetailsModal } from './details';
import { preloadServerModalData } from './network';
import {
  defaultSecurity,
  getProtocol,
  linkScheme,
  usesClients,
  usesProfile,
} from './protocols';
import { E } from '../../../helpers/element';

function renderServerRowActions(sectionRef: CBISection, sectionId: string) {
  const editLabel = getRuleEditButtonText();
  const detailsLabel = _('Server details');
  const tdEl = E(
    'td',
    { class: 'td cbi-section-table-cell nowrap cbi-section-actions' },
    E('div'),
  );
  const actionsEl = tdEl.lastElementChild as HTMLElement;

  // Only a server whose accounts can be handed a link or a profile has anything to
  // show: SSH has no share link format, and Tailscale and a JSON inbound have no
  // accounts at all.
  if (
    usesClients(getProtocol(sectionId)) &&
    (linkScheme(getProtocol(sectionId)) || usesProfile(getProtocol(sectionId)))
  ) {
    dom.append(
      actionsEl,
      E(
        'button',
        {
          class: 'cbi-button center fkp-server-info',
          title: detailsLabel,
          'aria-label': detailsLabel,
          click: (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            showServerDetailsModal(sectionId, listClients(sectionId));
          },
        },
        iconSvg('info'),
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

// Add creates the section before its dialog opens, with what the dialog needs to
// render: a protocol and its security. The switch is left to the dialog's Save;
// dismissing the dialog takes the section away again.
export function prepareAddedServer(sectionId: string) {
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

  sectionRef.handleModalSave = function (modalMap: CBIModalMap, ev: Event) {
    return saveSectionModal(this, modalMap, ev);
  };

  sectionRef.renderRowActions = function (sectionId: string) {
    return renderServerRowActions(this, sectionId);
  };
}
