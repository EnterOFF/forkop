// The page itself: the uci map every tab hangs off, and the two grids that are
// the same table twice.
//
// view/forkop/forkop.js is what LuCI dispatches to, and all it does is hand
// this to view.extend(). Everything the page is made of lives here.

export { ForkopView } from './view';
