import { FORKOP_UCI_PACKAGE } from '../../../constants';
import { getRuleEditButtonText, loadVisibleTableOptions } from '../../cbi/grid';
import { saveSectionModal } from '../../cbi/modal';
import { listClients, removeServerClients } from './clients';
import { DEFAULT_PROTOCOL } from './constants';
import { iconSvg, showServerDetailsModal } from './details';
import { preloadServerModalData } from './network';
import { showTailscaleServerDetailsModal } from './tailscale';
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

  // Tailscale shows its state in the tailnet; JSON inbounds have nothing to show.
  const protocol = getProtocol(sectionId);
  const showDetails =
    protocol === 'tailscale'
      ? () => showTailscaleServerDetailsModal(sectionId)
      : usesClients(protocol) && (linkScheme(protocol) || usesProfile(protocol))
        ? () => showServerDetailsModal(sectionId, listClients(sectionId))
        : null;
  if (showDetails) {
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
            showDetails();
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

// Add creates the section with a protocol and its security for the dialog to render; dismissing
// the dialog takes it away again.
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
    // Read once here, so the port check can name the owner.
    return Promise.all([
      preloadServerModalData(),
      loadVisibleTableOptions(this),
    ]);
  };

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
