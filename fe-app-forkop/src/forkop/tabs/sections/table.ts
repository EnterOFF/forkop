import { cleanupRemovedChildItems } from '../../cbi/childItems';
import { loadVisibleTableOptions } from '../../cbi/grid';
import { reportRefusedSave, saveSectionModal } from '../../cbi/modal';
import { removeFallbackLevels } from './fallback';
import { forgetOutboundNameChoices } from './outboundNames';
import { missingConnectionOutbound, missingDnsMatcher } from './references';
import { removeTunnelPeers } from './tunnels/model';
import { loadDefaultSubscriptionHeaders } from './subscriptions/model';

export function configureSectionSection(sectionRef: CBISection) {
  const handleRemove = sectionRef.handleRemove;
  sectionRef.handleRemove = function (section_id: string, event: Event) {
    cleanupRemovedChildItems(section_id, 'connection_link', []);
    cleanupRemovedChildItems(section_id, 'subscription_url', []);
    cleanupRemovedChildItems(section_id, 'section_interface', []);
    cleanupRemovedChildItems(section_id, 'urltest', []);
    cleanupRemovedChildItems(
      section_id,
      'fallback_group',
      [],
      undefined,
      removeFallbackLevels,
    );
    cleanupRemovedChildItems(
      section_id,
      'tunnel',
      [],
      undefined,
      removeTunnelPeers,
    );
    return handleRemove!.call(this, section_id, event);
  };

  const renderMoreOptionsModal = sectionRef.renderMoreOptionsModal;
  sectionRef.renderMoreOptionsModal = function (
    section_id: string,
    ev?: Event,
  ) {
    forgetOutboundNameChoices();
    return renderMoreOptionsModal.call(this, section_id, ev);
  };

  // A Connection section needs servers and a DNS section something to match, from
  // whichever of several fields: a property of the section, not of any one of
  // its fields, so the check runs here instead of in an option. Before the
  // dialog writes anything: LuCI parses the options one by one, so a check that
  // refuses halfway leaves the fields that already passed behind.
  sectionRef.handleModalSave = function (modalMap: CBIMap, ev: Event) {
    // On the modal map LuCI overwrites section() with the id of the section
    // being edited, so this reads the id and not the method.
    const editedSectionId = modalMap?.section as unknown as string;
    const missing = missingConnectionOutbound(modalMap, editedSectionId)
      ? _(
          'Add a connection URI, subscription, interface, tunnel or JSON outbound',
        )
      : missingDnsMatcher(modalMap, editedSectionId)
        ? _('Add a domain, built-in list, rule set or device')
        : '';
    if (missing) {
      reportRefusedSave(missing);
      return Promise.resolve(false);
    }

    return saveSectionModal(this, modalMap, ev);
  };

  // The default headers only fill in the subscription dialog, which asks again
  // when it opens; the table renders without them.
  sectionRef.load = function () {
    return Promise.all([
      loadDefaultSubscriptionHeaders().catch((error) => {
        console.warn('[SECTIONS] default subscription headers', error);
        return [];
      }),
      loadVisibleTableOptions(this),
    ]);
  };
}
