import { cleanupRemovedChildItems } from '../../cbi/childItems';
import { loadVisibleTableOptions } from '../../cbi/grid';
import { removeFallbackLevels } from './fallback';
import { missingConnectionOutbound } from './references';
import { removeTunnelPeers } from './tunnels/model';
import { loadDefaultSubscriptionHeaders } from './subscriptions/model';

export function configureSectionSection(sectionRef: CBISection) {
  const handleRemove = sectionRef.handleRemove;
  sectionRef.handleRemove = function (section_id: string, event: Event) {
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

  // Which outbounds a section needs is a property of the section, not of any one
  // of its fields, so the check runs here instead of in an option. Before the
  // dialog writes anything: LuCI parses the options one by one, so a check that
  // refuses halfway leaves the fields that already passed behind.
  sectionRef.handleModalSave = function (modalMap: CBIMap, ev: Event) {
    // On the modal map LuCI overwrites section() with the id of the section
    // being edited, so this reads the id and not the method.
    const editedSectionId = modalMap?.section as unknown as string;
    if (missingConnectionOutbound(modalMap, editedSectionId)) {
      return Promise.resolve();
    }

    return form.GridSection.prototype.handleModalSave.call(this, modalMap, ev);
  };

  sectionRef.load = function () {
    return Promise.all([
      loadDefaultSubscriptionHeaders(),
      loadVisibleTableOptions(this),
    ]);
  };
}
