import { normalizeCompiledVersion } from '../../helpers/normalizeCompiledVersion';

export const PAGE_STATUS_ID = 'fkp_page-status';

// The product and the version of the page that runs, which the build writes
// into the bundle; a development build has none to show. LuCI puts a string
// title into the heading as markup, and a theme draws h2 small as the muted
// part of a heading. The service state is drawn into its own place after them
// once the page knows it.
export function pageTitle(compiledVersion: string) {
  const version = normalizeCompiledVersion(compiledVersion);
  const status = `<small id="${PAGE_STATUS_ID}"></small>`;

  return version === 'dev'
    ? `Forkop ${status}`
    : `Forkop <small>${version}</small> ${status}`;
}
