// Tailscale reduces the host name to a DNS label, so anything it would rewrite is
// refused here instead of quietly registering a differently named machine. Both
// the Tailscale server and a Tailscale tunnel register a device under this name.
export function validateTailscaleHostname(value: unknown) {
  const hostname = `${value || ''}`.trim();

  if (!hostname) {
    return _('This field is required');
  }
  if (hostname.length > 63) {
    return _('A host name holds at most 63 characters');
  }

  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(hostname)
    ? true
    : _('Use lowercase letters, digits and hyphens');
}
