type SingBoxVersionFields = {
  sing_box_version?: string;
  sing_box_compressed?: number;
};

function isVersionPlaceholder(version: string) {
  const normalized = version.trim().toLowerCase();

  return (
    !normalized ||
    normalized === 'loading' ||
    normalized === 'unknown' ||
    normalized === 'not installed' ||
    (typeof _ === 'function' && normalized === _('unknown').toLowerCase()) ||
    (typeof _ === 'function' && normalized === _('Not installed').toLowerCase())
  );
}

export function formatSingBoxVersion(
  value: SingBoxVersionFields,
  showPackageFlavor = true,
) {
  const version = String(value.sing_box_version || '');

  if (!version || version === 'not installed') {
    return _('Not installed');
  }

  if (isVersionPlaceholder(version)) {
    return version;
  }

  return showPackageFlavor && value.sing_box_compressed
    ? `${version} (${_('compressed')})`
    : version;
}
