import { callBaseMethod } from './callBaseMethod';
import { Forkop } from '../../types';
import { callUbus } from '../../../helpers/callUbus';
import { executeShellCommand } from '../../../helpers/executeShellCommand';

const UI_ACTION_RPC_TIMEOUT_MS = 15000;
const GET_UI_STATE_RPC_TIMEOUT_MS = 3000;
// The service answers from memory; this ceiling only covers the case where it
// is still working the first answer out.
const SYSTEM_INFO_UBUS_TIMEOUT_MS = 5000;
// The router-side Clash transport lets curl run for a minute, and LuCI aborts
// every RPC after twenty seconds unless something raises that ceiling.
const CLASH_API_TRANSPORT_TIMEOUT_MS = 65000;
// Diagnostic checks inspect the whole runtime: nftables chains, sing-box, DNS
// probes. On slow routers a single check takes far longer than an ordinary RPC,
// and cutting it short reports a healthy runtime as unreachable.
const DIAGNOSTIC_CHECK_RPC_TIMEOUT_MS = 3 * 60 * 1000;

let checkLogsRequest: Promise<Forkop.MethodResponse<string>> | null = null;

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

function parseUiActionStartResult(
  response: Awaited<ReturnType<typeof executeShellCommand>>,
) {
  return parseJsonObjectOutput<Forkop.UiActionStartResult>(response.stdout);
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
  clashApi: async (method: string, path: string, body = '') =>
    callBaseMethod<Forkop.ClashApiResponse>(
      Forkop.AvailableMethods.CLASH_API,
      [method, path, body],
      '/usr/bin/forkop',
      {
        timeout:
          method.toUpperCase() === 'GET' && !path.includes('/delay?')
            ? 10000
            : CLASH_API_TRANSPORT_TIMEOUT_MS,
      },
    ),
  clashSummary: async () =>
    callBaseMethod<Forkop.ClashApiResponse>(
      Forkop.AvailableMethods.CLASH_SUMMARY,
      [],
      '/usr/bin/forkop',
      { timeout: 10000 },
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
  // Working the versions out is a CLI run that asks the package manager and
  // sing-box. The state service holds the answer for as long as the installed
  // packages have not changed; the CLI is what answers when it is not running.
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
  // Runs the core itself, so only a page the state service cannot answer asks.
  getCoreFeatures: async () =>
    callBaseMethod<Forkop.CoreFeatures>(
      Forkop.AvailableMethods.GET_CORE_FEATURES,
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
  uiActionAck: async (jobId: string) => {
    const response = await executeShellCommand({
      command: '/usr/bin/forkop',
      args: [Forkop.AvailableMethods.UI_ACTION_ACK, jobId],
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
};
