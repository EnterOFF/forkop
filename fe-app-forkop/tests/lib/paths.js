// Where the tests in this directory find the rest of the repository: the
// catalogs, the fixtures shared with the backend tests, the sources the
// catalogs are compared with, and the LuCI views the build produces. A test
// about one module imports it from src and has no use for this.
import path from 'path';

const FRONTEND = path.resolve(import.meta.dirname, '..', '..');
export const ROOT = path.resolve(FRONTEND, '..');
export const SRC = path.join(FRONTEND, 'src');
export const VIEW_DIR = path.join(
  ROOT,
  'luci-app-forkop/htdocs/luci-static/resources/view/forkop',
);
