import { normalizeCompiledVersion } from '../../helpers/normalizeCompiledVersion';

export const PAGE_STATUS_ID = 'fkp_page-status';

// The build writes the version into the bundle; a development build has none. LuCI inserts a
// string title as markup, and themes draw h2 small as the muted part of a heading.
export function pageTitle(compiledVersion: string) {
  const version = normalizeCompiledVersion(compiledVersion);
  const status = `<small id="${PAGE_STATUS_ID}"></small>`;

  return version === 'dev'
    ? `Forkop ${status}`
    : `Forkop <small>${version}</small> ${status}`;
}
