// The Servers tab: one sing-box inbound per uci section, plus the accounts that
// may use it. Everything the tab needs lives in this directory - the protocol
// table the form is built from, the value checks, the share links, the
// connection dialog and the client list.
//
// Two functions reach the page: one declares the table columns and the section
// lifecycle, the other declares every field of the dialog. The client list is
// the shared child item widget from cbi/, so this tab and the Sections tab edit
// child sections the same way.

export { createServerContent } from './form';
export { configureServerSection, prepareAddedServer } from './table';
