// The Sections and Servers tables are the same grid, and the user moves between
// them by clicking a tab: a name, a switch, one column naming what the row is,
// and the row actions. Only these two columns are declared - the actions column
// is sized by its buttons and the name column takes whatever is left - so these
// two values decide whether the columns line up across the tabs. The kind column
// holds the widest of either side's values, which is Shadowsocks.
export const GRID_SWITCH_COLUMN_WIDTH = '6rem';

export const GRID_KIND_COLUMN_WIDTH = '8rem';

// The word on a row action button. LuCI's own catalog owns the "Edit" msgid and
// translates it as "Редактировать", which is too long for a table cell beside the
// other actions, and Forkop ships no English catalog - so a msgid is also the
// English text. Hence a Forkop msgid, which carries the short Russian word, and the
// English word written out here for when the catalog hands that msgid straight back.
// Changing the msgid means changing the string it is compared against.
//
// Both grids show this button, so it is shared for the same reason the widths
// above are: a word chosen on one tab and not the other is visible the moment
// the user clicks across.
export function getRuleEditButtonText() {
  const label = _('Edit rule action');

  return label === 'Edit rule action' ? 'Edit' : label;
}

// Everything the table itself renders, loaded before the grid is drawn.
//
// A grid row shows only the options that are not modalonly; the rest belong to
// the Add/Edit dialog, which LuCI clones and loads when the user opens it. So a
// section's load() pulls exactly the columns and leaves the dialog alone -
// loading every option here would fetch the whole form for every row.
export function loadVisibleTableOptions(sectionRef: CBISection) {
  const tasks: Promise<unknown>[] = [];

  sectionRef.cfgsections().forEach((sectionId: string) => {
    sectionRef.children.forEach((option) => {
      if (option.disable || option.modalonly) {
        return;
      }

      tasks.push(
        Promise.resolve(option.load.call(option, sectionId)).then(
          (value: unknown) => {
            option.cfgvalue(sectionId, value);
          },
        ),
      );
    });
  });

  return Promise.all(tasks);
}
