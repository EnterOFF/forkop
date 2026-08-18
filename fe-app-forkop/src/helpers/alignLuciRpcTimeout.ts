// LuCI aborts every RPC request after L.env.rpctimeout seconds (20 by default),
// which silently caps the longer timeouts this app asks for. Diagnostic checks
// on slow routers legitimately need more than that, so the transport ceiling is
// raised to cover the requested timeout and the app timeout stays in charge.
const LUCI_RPC_TIMEOUT_DEFAULT_SECONDS = 20;
const LUCI_RPC_TIMEOUT_HEADROOM_SECONDS = 5;

export function alignLuciRpcTimeout(timeoutMs: number) {
  const env = typeof L === 'undefined' ? undefined : L?.env;

  if (!env || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return;
  }

  const required =
    Math.ceil(timeoutMs / 1000) + LUCI_RPC_TIMEOUT_HEADROOM_SECONDS;
  const current =
    typeof env.rpctimeout === 'number' && Number.isFinite(env.rpctimeout)
      ? env.rpctimeout
      : LUCI_RPC_TIMEOUT_DEFAULT_SECONDS;

  if (current < required) {
    env.rpctimeout = required;
  }
}
