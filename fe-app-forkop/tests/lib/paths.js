// Where the tests in this directory find the rest of the repository.
//
// A check that reads the frontend sources as text, or the LuCI bundle the build
// produces, needs a path rather than an import. Everything else imports from
// `src` directly and has no use for this.
import path from 'path';

export const FRONTEND = path.resolve(import.meta.dirname, '..', '..');
export const ROOT = path.resolve(FRONTEND, '..');
export const SRC = path.join(FRONTEND, 'src');
export const VIEW_DIR = path.join(
  ROOT,
  'luci-app-forkop/htdocs/luci-static/resources/view/forkop',
);
export const BUNDLE = path.join(VIEW_DIR, 'main.js');
