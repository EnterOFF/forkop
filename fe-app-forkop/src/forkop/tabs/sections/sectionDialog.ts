// The dashboard opens a section's dialog from that section's header, and only
// the page knows the grid the dialog belongs to: it is the Sections tab's own
// dialog, with its checks and its save.
let openDialog: ((sectionId: string) => Promise<unknown>) | null = null;

export function registerSectionDialog(
  open: (sectionId: string) => Promise<unknown>,
) {
  openDialog = open;
}

export function openSectionDialog(sectionId: string) {
  return openDialog ? openDialog(sectionId) : Promise.resolve();
}
