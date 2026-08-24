// A poll that costs the router more than a fraction of the interval it runs on
// is a page keeping the router busy on its own behalf. The interval a tab asks
// for is therefore a floor rather than a promise: what the last answer actually
// cost raises it.
//
// A direct request on a LAN takes a few milliseconds and never moves the floor,
// so nothing changes while the browser talks to the controller itself. The CLI
// transport, a loaded router, or a connection list that has grown large all cost
// more, and the poll spaces itself out for exactly as long as they do - without
// a constant per transport that would be wrong on the next router.
const POLL_DUTY_FACTOR = 8;

export function pollDelayForDuration(
  baseIntervalMs: number,
  durationMs: number,
  maxIntervalMs: number,
) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return baseIntervalMs;
  }

  return Math.min(
    Math.max(baseIntervalMs, Math.round(durationMs * POLL_DUTY_FACTOR)),
    maxIntervalMs,
  );
}
