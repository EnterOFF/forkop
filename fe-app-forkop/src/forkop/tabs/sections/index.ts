// The Sections tab: one routing rule per uci section, and everything a rule can
// be built out of - a DNS server, a DPI-free connection, a subscription, a
// network interface, a URLTest group, a fallback chain, a tunnel - each with the
// dialog that edits it.
//
// Two functions reach the page: one declares the table columns and the section
// lifecycle, the other declares every field of the dialog. Everything else in
// this directory exists to serve those two, and the generic parts of it - the
// child item list, its settings dialogs, the annotated textarea - live one level
// up in cbi/, because the Servers and Settings tabs use them too.

export { createSectionContent } from './form';
export { configureSectionSection } from './table';
export { openSectionDialog, registerSectionDialog } from './sectionDialog';
