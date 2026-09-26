import { alignLuciRpcTimeout } from './alignLuciRpcTimeout';
import { withTimeout } from './withTimeout';

type UbusCallResult<T> =
  | { success: true; data: T }
  | { success: false; message: string; unavailable: boolean };

// LuCI hands main.ts its rpc module as a parameter of the function the view is
// wrapped in, not as a global, so the name has to be reached as it is written.
// Declaring the call lazily keeps the module importable from tests.
function rpcModule() {
  const candidate = typeof rpc === 'undefined' ? undefined : rpc;
  return candidate as unknown as
    | {
        declare: (options: {
          object: string;
          method: string;
          params?: string[];
        }) => (...args: unknown[]) => Promise<unknown>;
      }
    | undefined;
}

// ubus reports a missing object or a denied ACL as a status code rather than a
// transport failure, and both mean the same thing to a caller: this route is not
// available, use the other one. A genuine error from a method that did run is a
// different thing and must not be mistaken for it.
const UNAVAILABLE_STATUS = new Set([
  2, // invalid argument
  4, // method not found
  5, // not found
  6, // permission denied
]);

function isUnavailable(error: unknown) {
  const status = (error as { ubus_rpc_status?: unknown })?.ubus_rpc_status;
  if (typeof status === 'number') {
    return UNAVAILABLE_STATUS.has(status);
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  return /not found|permission denied|Object not found/i.test(message);
}

// A service being restarted - by a package upgrade, or by procd after a crash -
// is missing for a second or two and then back. Treating that as "not installed"
// would send the page down its fallback path for a gap that is about to close,
// so a call that finds nothing there is retried briefly first. An object that is
// genuinely absent costs three quick failures and no more, because the caller
// remembers the answer.
const UNAVAILABLE_RETRIES = 2;
const UNAVAILABLE_RETRY_MS = 700;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callUbus<T>(options: {
  object: string;
  method: string;
  params?: Record<string, unknown>;
  timeoutMs: number;
  retryUnavailable?: boolean;
}): Promise<UbusCallResult<T>> {
  const attempts =
    options.retryUnavailable === false ? 1 : UNAVAILABLE_RETRIES + 1;
  let last = await callUbusOnce<T>(options);

  for (
    let attempt = 1;
    attempt < attempts && !last.success && last.unavailable;
    attempt++
  ) {
    await wait(UNAVAILABLE_RETRY_MS);
    last = await callUbusOnce<T>(options);
  }

  return last;
}

async function callUbusOnce<T>({
  object,
  method,
  params = {},
  timeoutMs,
}: {
  object: string;
  method: string;
  params?: Record<string, unknown>;
  timeoutMs: number;
}): Promise<UbusCallResult<T>> {
  const rpc = rpcModule();
  if (!rpc) {
    return { success: false, message: 'rpc unavailable', unavailable: true };
  }

  alignLuciRpcTimeout(timeoutMs);

  try {
    const names = Object.keys(params);
    const request = rpc.declare({ object, method, params: names });
    const call = request(...names.map((name) => params[name])) as Promise<T>;
    const data = await withTimeout(call, timeoutMs, `${object}.${method}`);

    if (data === null || data === undefined) {
      return { success: false, message: 'empty reply', unavailable: false };
    }

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      unavailable: isUnavailable(error),
    };
  }
}
