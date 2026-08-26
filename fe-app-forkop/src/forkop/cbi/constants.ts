// The Sections and Servers tables are the same grid, and the user moves between
// them by clicking a tab: a name, a switch, one column naming what the row is,
// and the row actions. Only these two columns are declared - the actions column
// is sized by its buttons and the name column takes whatever is left - so these
// two values are what decides whether the columns line up across the tabs, and
// they lived apart until each table had drifted to a width of its own. The kind
// column holds the widest of either side's values, which is Shadowsocks.
export const GRID_SWITCH_COLUMN_WIDTH = '6rem';

export const GRID_KIND_COLUMN_WIDTH = '8rem';
