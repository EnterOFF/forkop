import { callBaseMethod } from './callBaseMethod';
import { Forkop } from '../../types';
import { callUbus } from '../../../helpers/callUbus';
import { executeShellCommand } from '../../../helpers/executeShellCommand';
import { isTransientRpcError } from '../../helpers/isTransientRpcError';

const UI_ACTION_RPC_TIMEOUT_MS = 15000;
const COMPONENT_ACTION_RPC_TIMEOUT_MS = 15000;
const COMPONENT_ACTION_POLL_INTERVAL_MS = 1500;
const COMPONENT_ACTION_STATUS_REFRESH_INTERVAL_MS = 15000;
const COMPONENT_ACTION_SELF_UPDATE_SETTLE_MS = 30000;
const COMPONENT_ACTION_TRANSIENT_RPC_GRACE_MS = 30000;
const COMPONENT_ACTION_STATE_DIR = '/var/run/forkop/component-actions';
const GET_UI_STATE_RPC_TIMEOUT_MS = 3000;
// The service answers from memory; this ceiling only covers the case where it
// is still working the first answer out.
const SYSTEM_INFO_UBUS_TIMEOUT_MS = 5000;
// The router-side Clash transport lets curl run for a minute, and LuCI aborts
// every RPC after twenty seconds unless something raises that ceiling.
const CLASH_HTTP_TRANSPORT_TIMEOUT_MS = 65000;
// Diagnostic checks inspect the whole runtime: nftables chains, sing-box, DNS
// probes. On slow routers a single check takes far longer than an ordinary RPC,
// and cutting it short reports a healthy runtime as unreachable.
const DIAGNOSTIC_CHECK_RPC_TIMEOUT_MS = 3 * 60 * 1000;

let checkLogsRequest: Promise<Forkop.MethodResponse<string>> | null = null;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function translate(message: string) {
  return typeof _ === 'function' ? _(message) : message;
}

// The log is text, and a router whose log holds no Forkop line yet answers with
// none: an empty answer is an empty log, not a failed read.
function checkLogs() {
  if (!checkLogsRequest) {
    checkLogsRequest = executeShellCommand({
      command: '/usr/bin/forkop',
      args: [Forkop.AvailableMethods.CHECK_LOGS],
      timeout: 15000,
    })
      .then(
        (response): Forkop.MethodResponse<string> =>
          response.code
            ? {
                success: false,
                error: response.stderr || response.stdout || '',
              }
            : { success: true, data: response.stdout },
      )
      .finally(() => {
        checkLogsRequest = null;
      });
  }

  return checkLogsRequest;
}

function parseJsonObjectOutput<T>(output: string): T | null {
  if (!output) {
    return null;
  }

  try {
    return JSON.parse(output) as T;
  } catch (_error) {
    const jsonMatch = output.match(/(\{[\s\S]*\})\s*$/);

    if (!jsonMatch) {
      return null;
    }

    try {
      return JSON.parse(jsonMatch[1]) as T;
    } catch (_jsonError) {
      return null;
    }
  }
}

function parseComponentActionOutput(output: string) {
  return parseJsonObjectOutput<Forkop.ComponentActionResult>(output);
}

function parseComponentActionResult(
  response: Awaited<ReturnType<typeof executeShellCommand>>,
) {
  return parseComponentActionOutput(response.stdout);
}

function parseComponentActionStartResult(
  response: Awaited<ReturnType<typeof executeShellCommand>>,
) {
  const parsedResponse = parseComponentActionResult(response);

  if (!parsedResponse) {
    return null;
  }

  return parsedResponse as unknown as Forkop.ComponentActionStartResult;
}

function parseUiActionStartResult(
  response: Awaited<ReturnType<typeof executeShellCommand>>,
) {
  return parseJsonObjectOutput<Forkop.UiActionStartResult>(response.stdout);
}

function isComponentActionJobId(jobId: string) {
  return /^[A-Za-z0-9._-]+$/.test(jobId) && jobId !== '.' && jobId !== '..';
}

async function readComponentActionState(jobId: string) {
  if (!isComponentActionJobId(jobId)) {
    return null;
  }

  try {
    return parseComponentActionOutput(
      await fs.read(`${COMPONENT_ACTION_STATE_DIR}/${jobId}.json`),
    );
  } catch (_error) {
    return null;
  }
}

async function readForkopVersion() {
  const response = await executeShellCommand({
    command: '/usr/bin/forkop',
    args: ['show_version'],
    timeout: COMPONENT_ACTION_RPC_TIMEOUT_MS,
  });

  if ((response.code ?? 0) !== 0 || !response.stdout) {
    return '';
  }

  return response.stdout.trim();
}

async function isComponentActionStillRunning(
  jobId: string,
  component: Forkop.ComponentName,
  action: Forkop.ComponentAction,
) {
  const response = await callBaseMethod<Forkop.UiState>(
    Forkop.AvailableMethods.GET_UI_STATE,
    [],
    '/usr/bin/forkop',
    { timeout: GET_UI_STATE_RPC_TIMEOUT_MS },
  );

  return (
    response.success &&
    response.data.actions.component.some(
      (state) =>
        state.job_id === jobId &&
        state.component === component &&
        state.action === action &&
        state.running === true,
    )
  );
}

function componentActionFailure(
  response: Awaited<ReturnType<typeof executeShellCommand>>,
  parsedResponse?: Pick<Forkop.ComponentActionResult, 'message'> | null,
) {
  return {
    success: false,
    error: parsedResponse?.message || response.stderr || _('Failed to execute'),
  } as Forkop.MethodFailureResponse;
}

function uiActionFailure(
  response: Awaited<ReturnType<typeof executeShellCommand>>,
  parsedResponse?: { message?: string } | null,
  fallback: string = _('Failed to execute'),
) {
  return {
    success: false,
    error: parsedResponse?.message || response.stderr || fallback,
  } as Forkop.MethodFailureResponse;
}

function createTransientRpcGraceTracker(graceMs: number) {
  let failureStartedAt = 0;

  return {
    reset() {
      failureStartedAt = 0;
    },
    shouldContinue(error?: string) {
      if (!isTransientRpcError(error)) {
        failureStartedAt = 0;
        return false;
      }

      if (!failureStartedAt) {
        failureStartedAt = Date.now();
      }

      return Date.now() - failureStartedAt < graceMs;
    },
  };
}

function diagnosticCheck<T>(
  method: Forkop.AvailableMethods,
  args: string[] = [],
) {
  return callBaseMethod<T>(method, args, '/usr/bin/forkop', {
    timeout: DIAGNOSTIC_CHECK_RPC_TIMEOUT_MS,
  });
}

export const ForkopShellMethods = {
  checkDNSAvailable: async () =>
    diagnosticCheck<Forkop.DnsCheckResult>(
      Forkop.AvailableMethods.CHECK_DNS_AVAILABLE,
    ),
  checkFakeIP: async () =>
    diagnosticCheck<Forkop.FakeIPCheckResult>(
      Forkop.AvailableMethods.CHECK_FAKEIP,
    ),
  checkNftRules: async () =>
    diagnosticCheck<Forkop.NftRulesCheckResult>(
      Forkop.AvailableMethods.CHECK_NFT_RULES,
    ),
  checkInboundsConfig: async () =>
    diagnosticCheck<Forkop.InboundsConfigCheckResult>(
      Forkop.AvailableMethods.CHECK_INBOUNDS_CONFIG,
    ),
  checkSingBox: async () =>
    diagnosticCheck<Forkop.SingBoxCheckResult>(
      Forkop.AvailableMethods.CHECK_SING_BOX,
    ),
  checkInbounds: async () =>
    diagnosticCheck<Forkop.InboundsCheckResult>(
      Forkop.AvailableMethods.CHECK_INBOUNDS,
    ),
  clashHttp: async (method: string, path: string, body = '') =>
    callBaseMethod<Forkop.ClashHttpResponse>(
      Forkop.AvailableMethods.CLASH_HTTP,
      [method, path, body],
      '/usr/bin/forkop',
      { timeout: CLASH_HTTP_TRANSPORT_TIMEOUT_MS },
    ),
  clashSummary: async () =>
    callBaseMethod<Forkop.ClashHttpResponse>(
      Forkop.AvailableMethods.CLASH_SUMMARY,
      [],
      '/usr/bin/forkop',
      { timeout: CLASH_HTTP_TRANSPORT_TIMEOUT_MS },
    ),
  // Through the CLI, not the init script: every init script command waits on
  // procd's per-service lock, and the CLI writes the rc.d symlink at once.
  enable: async () => callBaseMethod<unknown>(Forkop.AvailableMethods.ENABLE),
  disable: async () => callBaseMethod<unknown>(Forkop.AvailableMethods.DISABLE),
  globalCheck: async (masked = true) =>
    diagnosticCheck<unknown>(Forkop.AvailableMethods.GLOBAL_CHECK, [
      masked ? 'masked' : 'raw',
    ]),
  showConfig: async (masked = true) =>
    callBaseMethod<unknown>(Forkop.AvailableMethods.SHOW_CONFIG, [
      masked ? 'masked' : 'raw',
    ]),
  showSingBoxConfig: async (masked = true) =>
    callBaseMethod<unknown>(Forkop.AvailableMethods.SHOW_SING_BOX_CONFIG, [
      masked ? 'masked' : 'raw',
    ]),
  checkLogs,
  // Working the versions out means asking opkg and sing-box, about 1.7 s.
  // The state service holds the answer for as long as the installed packages
  // have not changed; the CLI is what answers when it is not running.
  getSystemInfo: async () => {
    const served = await callUbus<{
      available?: boolean;
      system_info?: Forkop.GetSystemInfo;
    }>({
      object: 'forkop',
      method: 'system_info',
      timeoutMs: SYSTEM_INFO_UBUS_TIMEOUT_MS,
    });

    if (served.success && served.data.available && served.data.system_info) {
      return { success: true as const, data: served.data.system_info };
    }

    return callBaseMethod<Forkop.GetSystemInfo>(
      Forkop.AvailableMethods.GET_SYSTEM_INFO,
    );
  },
  // Which rule-set tags belong to which section. Named by the runtime, because
  // a built-in list is named per section and a custom reference by a hash of
  // itself - neither is reconstructible here.
  getSectionRuleSets: async () =>
    callBaseMethod<Record<string, string[]>>(
      Forkop.AvailableMethods.GET_SECTION_RULE_SETS,
    ),
  getUiState: async () =>
    callBaseMethod<Forkop.UiState>(
      Forkop.AvailableMethods.GET_UI_STATE,
      [],
      '/usr/bin/forkop',
      { timeout: GET_UI_STATE_RPC_TIMEOUT_MS },
    ),
  serviceActionStart: async (action: Forkop.ServiceAction) => {
    const response = await executeShellCommand({
      command: '/usr/bin/forkop',
      args: [Forkop.AvailableMethods.SERVICE_ACTION_ASYNC, action],
      timeout: UI_ACTION_RPC_TIMEOUT_MS,
    });
    const parsedResponse = parseUiActionStartResult(response);

    if (
      (response.code ?? 0) !== 0 ||
      !parsedResponse?.success ||
      !parsedResponse.job_id
    ) {
      return uiActionFailure(
        response,
        parsedResponse,
        _('Service action failed'),
      );
    }

    return {
      success: true,
      data: parsedResponse,
    } as Forkop.MethodSuccessResponse<Forkop.UiActionStartResult>;
  },
  uiActionAck: async (kind: 'service' | 'component', jobId: string) => {
    const response = await executeShellCommand({
      command: '/usr/bin/forkop',
      args: [Forkop.AvailableMethods.UI_ACTION_ACK, kind, jobId],
      timeout: UI_ACTION_RPC_TIMEOUT_MS,
    });
    const parsedResponse = parseUiActionStartResult(response);

    if ((response.code ?? 0) !== 0 || !parsedResponse?.success) {
      return uiActionFailure(response, parsedResponse);
    }

    return {
      success: true,
      data: parsedResponse,
    } as Forkop.MethodSuccessResponse<Forkop.UiActionStartResult>;
  },
  componentActionStart: async (
    component: Forkop.ComponentName,
    action: Forkop.ComponentAction,
  ) => {
    const response = await executeShellCommand({
      command: '/usr/bin/forkop',
      args: [Forkop.AvailableMethods.COMPONENT_ACTION_ASYNC, component, action],
      timeout: COMPONENT_ACTION_RPC_TIMEOUT_MS,
    });
    const parsedResponse = parseComponentActionStartResult(response);

    if (
      (response.code ?? 0) !== 0 ||
      !parsedResponse?.success ||
      !parsedResponse.job_id
    ) {
      return componentActionFailure(response, parsedResponse);
    }

    return {
      success: true,
      data: parsedResponse,
    } as Forkop.MethodSuccessResponse<Forkop.ComponentActionStartResult>;
  },
  componentActionStatus: async (jobId: string) => {
    const response = await executeShellCommand({
      command: '/usr/bin/forkop',
      args: [Forkop.AvailableMethods.COMPONENT_ACTION_STATUS, jobId],
      timeout: COMPONENT_ACTION_RPC_TIMEOUT_MS,
    });
    const parsedResponse = parseComponentActionResult(response);

    if ((response.code ?? 0) !== 0 || !parsedResponse) {
      return componentActionFailure(response, parsedResponse);
    }

    return {
      success: true,
      data: parsedResponse,
    } as Forkop.MethodSuccessResponse<Forkop.ComponentActionResult>;
  },
  componentUpdateCheckCache: async () =>
    callBaseMethod<Forkop.ComponentUpdateCheckCache>(
      Forkop.AvailableMethods.COMPONENT_UPDATE_CHECK_CACHE,
    ),
  waitComponentActionJob: async (
    jobId: string,
    component: Forkop.ComponentName,
    action: Forkop.ComponentAction,
    expectedLatestVersion?: string,
  ) => {
    let selfUpdateVersionMatchedAt = 0;
    let lastStatusRefreshAt = 0;
    const transientRpc = createTransientRpcGraceTracker(
      COMPONENT_ACTION_TRANSIENT_RPC_GRACE_MS,
    );

    while (true) {
      await sleep(COMPONENT_ACTION_POLL_INTERVAL_MS);

      const stateResponse = await readComponentActionState(jobId);

      if (stateResponse) {
        if (!stateResponse.running) {
          transientRpc.reset();
          return {
            success: true,
            data: stateResponse,
          } as Forkop.MethodSuccessResponse<Forkop.ComponentActionResult>;
        }

        if (
          Date.now() - lastStatusRefreshAt <
          COMPONENT_ACTION_STATUS_REFRESH_INTERVAL_MS
        ) {
          continue;
        }
      }

      lastStatusRefreshAt = Date.now();
      const statusResponse = await executeShellCommand({
        command: '/usr/bin/forkop',
        args: [Forkop.AvailableMethods.COMPONENT_ACTION_STATUS, jobId],
        timeout: COMPONENT_ACTION_RPC_TIMEOUT_MS,
      });
      const parsedResponse = parseComponentActionResult(statusResponse);

      if ((statusResponse.code ?? 0) !== 0 || !parsedResponse) {
        if (stateResponse?.running) {
          transientRpc.reset();
          continue;
        }

        if (await isComponentActionStillRunning(jobId, component, action)) {
          transientRpc.reset();
          continue;
        }

        const failure = componentActionFailure(statusResponse, parsedResponse);

        if (transientRpc.shouldContinue(failure.error)) {
          continue;
        }

        if (component === 'forkop' && action === 'install') {
          const installedVersion = expectedLatestVersion
            ? await readForkopVersion()
            : '';

          if (
            expectedLatestVersion &&
            installedVersion === expectedLatestVersion
          ) {
            if (!selfUpdateVersionMatchedAt) {
              selfUpdateVersionMatchedAt = Date.now();
            }

            if (
              Date.now() - selfUpdateVersionMatchedAt >=
              COMPONENT_ACTION_SELF_UPDATE_SETTLE_MS
            ) {
              return {
                success: true,
                data: {
                  success: true,
                  component,
                  action,
                  message: translate('Forkop has been installed'),
                  current_version: installedVersion,
                  latest_version: expectedLatestVersion,
                  changed: true,
                  status: 'latest',
                },
              } as Forkop.MethodSuccessResponse<Forkop.ComponentActionResult>;
            }
          }

          continue;
        }

        return failure;
      }

      transientRpc.reset();
      if (parsedResponse.running) {
        continue;
      }

      return {
        success: true,
        data: parsedResponse,
      } as Forkop.MethodSuccessResponse<Forkop.ComponentActionResult>;
    }
  },
};
