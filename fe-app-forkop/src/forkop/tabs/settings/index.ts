// The Settings tab: everything that is set once for the whole router rather
// than per rule - which DNS servers answer, which interfaces Forkop takes
// traffic from, what it downloads on a schedule, and where sing-box keeps its
// files.
//
// One function reaches the page and declares the whole tab; the directory
// beside it holds the option groups it declares, in the order the page shows
// them, and the helpers those groups share.

export { createSettingsContent } from './form';
