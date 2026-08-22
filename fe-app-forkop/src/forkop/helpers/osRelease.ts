// OPENWRT_RELEASE ends in the build id the image was cut from, for example
// "ImmortalWrt 24.10.5 r33805-7c4e882aaf6f". The diagnostics report keeps it,
// because a bug report is where a build hash is worth having; the panel row is
// read to answer "which firmware is this", and the hash only makes that longer.
const BUILD_ID = /\s+r\d+(?:[-+][0-9a-z]+)*$/i;

export function formatOsRelease(value: string) {
  const release = `${value ?? ''}`.trim();
  const trimmed = release.replace(BUILD_ID, '').trim();

  return trimmed || release;
}
