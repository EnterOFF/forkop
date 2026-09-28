import { normalizeCompiledVersion } from '../../helpers/normalizeCompiledVersion';

// The product and the version of the page that runs, which the build writes
// into the bundle; a development build has none to show. LuCI puts a string
// title into the heading as markup, and a theme draws h2 small as the muted
// part of a heading.
export function pageTitle(compiledVersion: string) {
  const version = normalizeCompiledVersion(compiledVersion);

  return version === 'dev' ? 'Forkop' : `Forkop <small>${version}</small>`;
}
