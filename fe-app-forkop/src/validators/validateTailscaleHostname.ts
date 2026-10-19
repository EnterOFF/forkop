import { message } from './messages';

// Tailscale reduces the host name to a DNS label, so anything it would rewrite is
// refused here instead of quietly registering a differently named machine. Both
// the Tailscale server and a Tailscale tunnel register a device under this name.
export function validateTailscaleHostname(value: unknown) {
  const hostname = `${value || ''}`.trim();

  if (!hostname) {
    return message.required();
  }

  return hostname.length <= 63 &&
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(hostname)
    ? true
    : _('Only a-z, 0-9 and hyphens, up to 63 characters');
}
