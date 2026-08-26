import { cleanupRemovedChildItems } from '../../cbi/childItems';
import { missingConnectionOutbound } from './references';
import { loadDefaultSubscriptionHeaders } from './subscriptions/model';

function loadSectionTableOptions(sectionRef: CBISection) {
  const sectionIds = sectionRef.cfgsections();
  const tasks = [];

  for (let i = 0; i < sectionIds.length; i += 1) {
    const sectionId = sectionIds[i];

    for (let j = 0; j < sectionRef.children.length; j += 1) {
      const option = sectionRef.children[j];

      if (option.disable || option.modalonly) {
        continue;
      }

      tasks.push(
        Promise.resolve(option.load.call(option, sectionId)).then(
          (value: unknown) => {
            option.cfgvalue(sectionId, value);
          },
        ),
      );
    }
  }

  return Promise.all(tasks);
}

export function configureSectionSection(sectionRef: CBISection) {
  const handleRemove = sectionRef.handleRemove;
  sectionRef.handleRemove = function (section_id: string, event: Event) {
    cleanupRemovedChildItems(section_id, 'subscription_url', []);
    cleanupRemovedChildItems(section_id, 'section_interface', []);
    cleanupRemovedChildItems(section_id, 'urltest', []);
    cleanupRemovedChildItems(section_id, 'fallback_group', []);
    cleanupRemovedChildItems(section_id, 'tunnel', []);
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
    // The table renders only non-modal fields; the cloned Add/Edit modal loads
    // action/provider details when the user opens it.
    return Promise.all([
      loadDefaultSubscriptionHeaders(),
      loadSectionTableOptions(this),
    ]);
  };
}
