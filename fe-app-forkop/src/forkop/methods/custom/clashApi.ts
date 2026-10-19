import { getConfigSections } from './getConfigSections';
import { ClashAPI, Forkop } from '../../types';
import {
  canUseDirectClashApi,
  getClashApiUrl,
} from '../../../helpers/getClashApiUrl';
import { ForkopShellMethods } from '../shell';
import { DEFAULT_LATENCY_TEST_URL } from '../../../constants';

type ClashConnectionsSnapshot = {
  downloadTotal?: number;
  uploadTotal?: number;
  connections?: unknown[];
};

type DirectClashApiOutcome =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'timeout' }
  | { kind: 'unreachable' };

const CLASH_API_FETCH_TIMEOUT_MS = 5000;
const CLASH_API_MUTATION_TIMEOUT_MS = 15000;
// How long a group test may hold the page. It is a ceiling and not a wait: the
// router answers as soon as the last member is done, so a section whose nodes
// answer is over in a couple of seconds whatever its size, and this only bounds
// the case where a section is too large or too dead to finish. One too large
// even for this is covered by pressing again, since the router sweeps the
// members it tested least recently first.
const GROUP_LATENCY_TIMEOUT_MS = '40000';
// A sweep can answer later than its own budget: a test already dialing when the
// budget runs out is only given up on when its own five seconds are over, and
// not every dial notices a cancelled deadline before then. Measured on a section
// of 133 members, a three second budget answered in 8.6 s. The browser therefore
// waits a whole extra test on top of the budget before it gives up on the
// answer, or it would abandon a sweep the router was about to report.
const GROUP_LATENCY_SWEEP_OVERSHOOT_MS = 5000;
// A browser that cannot reach the controller pays for every doomed attempt: a
// refused port costs a round trip, a dropped one costs the whole timeout. One
// attempt proves the path is not there, and the rest go straight to the CLI
// transport until a probe says otherwise.
//
// Nothing the page is waiting for ever pays for that discovery. The probe runs
// beside the request that decided to skip the direct path, so a controller that
// stays unreachable never costs the page a timeout again, and one that comes
// back is noticed within the probe interval rather than at the next reload.
const DIRECT_CLASH_API_PROBE_INTERVAL_MS = 30000;
const DIRECT_CLASH_API_PROBE_TIMEOUT_MS = 2000;
let clashApiConfigSections: Forkop.ConfigSection[] = [];
let clashApiConfigSectionsPromise: Promise<Forkop.ConfigSection[]> | undefined;
let directClashApiSuspended = false;
let directClashApiReachable = false;
let directClashApiProbeAt = 0;
let directClashApiProbe: Promise<void> | undefined;

export function setClashApiConfigSections(sections: Forkop.ConfigSection[]) {
  clashApiConfigSections = sections;
}
function getSettingsSection(configSections: Forkop.ConfigSection[]) {
  return configSections.find((section) => section['.type'] === 'settings');
}

function getClashApiSecret(configSections: Forkop.ConfigSection[]) {
  return getSettingsSection(configSections)?.yacd_secret_key || '';
}

function canReachClashApiFromBrowser() {
  return canUseDirectClashApi() && typeof fetch === 'function';
}

function canFetchClashApiDirectly() {
  return !directClashApiSuspended && canReachClashApiFromBrowser();
}

function suspendDirectClashApi() {
  directClashApiSuspended = true;
  directClashApiReachable = false;
  directClashApiProbeAt = Date.now() + DIRECT_CLASH_API_PROBE_INTERVAL_MS;
}

// Opening a tab is the moment a user is most likely to have just started the
// core, so the next request probes instead of waiting out the interval. It
// costs nothing to be wrong: no request waits for the probe.
export function resetClashApiTransport() {
  directClashApiProbeAt = 0;
}

function clashApiError(status: number, body: string) {
  // The Clash API reports failures as {"message": "..."}. Show that text rather
  // than the raw JSON, since this string is what the user ends up reading.
  if (body) {
    try {
      const payload = JSON.parse(body);

      if (typeof payload?.message === 'string' && payload.message) {
        return payload.message;
      }
    } catch {
      // Not a JSON error payload, so the body is already the message.
    }
  }

  return body || `Clash API returned HTTP ${status}`;
}

function parseClashApiPayload<T>(
  status: number,
  body: string,
): Forkop.MethodResponse<T> {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return { success: false, error: _('Invalid Clash API response') };
  }

  if (status < 200 || status >= 300) {
    return { success: false, error: clashApiError(status, body), status };
  }

  if (!body) {
    return { success: true, data: undefined as T };
  }

  try {
    return { success: true, data: JSON.parse(body) as T };
  } catch (_error) {
    return { success: false, error: _('Invalid Clash API response') };
  }
}

async function ensureClashApiConfigSections() {
  if (clashApiConfigSections.length) {
    return clashApiConfigSections;
  }

  if (!clashApiConfigSectionsPromise) {
    clashApiConfigSectionsPromise = getConfigSections()
      .then((sections) => {
        clashApiConfigSections = sections;
        return sections;
      })
      .catch(() => [] as Forkop.ConfigSection[])
      .finally(() => {
        clashApiConfigSectionsPromise = undefined;
      });
  }

  return clashApiConfigSectionsPromise;
}

async function fetchClashApiDirectly(
  configSections: Forkop.ConfigSection[],
  path: string,
  init?: RequestInit,
  timeout?: number,
): Promise<DirectClashApiOutcome> {
  const secret = getClashApiSecret(configSections);
  const controller = timeout ? new AbortController() : undefined;
  const timeoutId = timeout
    ? setTimeout(() => controller?.abort(), timeout)
    : undefined;
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };

  if (secret) headers.Authorization = `Bearer ${secret}`;

  try {
    const response = await fetch(`${getClashApiUrl()}${path}`, {
      ...init,
      headers,
      signal: controller?.signal,
    });

    return {
      kind: 'response',
      status: response.status,
      body: response.status === 204 ? '' : await response.text(),
    };
  } catch (_error) {
    return { kind: controller?.signal.aborted ? 'timeout' : 'unreachable' };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function fetchClashApiThroughCli<T>(
  method: string,
  path: string,
  body: string,
  summary = false,
): Promise<Forkop.MethodResponse<T>> {
  const response = summary
    ? await ForkopShellMethods.clashSummary()
    : await ForkopShellMethods.clashApi(method, path, body);

  if (!response.success) {
    return response;
  }

  return parseClashApiPayload<T>(
    response.data?.status ?? 0,
    response.data?.body || '',
  );
}

// Any answer at all proves the controller is reachable, including the one it
// gives a request without the right secret: what is being asked is whether the
// browser can open the connection, not whether it is allowed through.
function probeDirectClashApi() {
  if (directClashApiProbe) {
    return directClashApiProbe;
  }
  if (Date.now() < directClashApiProbeAt) {
    return Promise.resolve();
  }

  directClashApiProbeAt = Date.now() + DIRECT_CLASH_API_PROBE_INTERVAL_MS;
  directClashApiProbe = ensureClashApiConfigSections()
    .then((configSections) =>
      fetchClashApiDirectly(
        configSections,
        '/version',
        undefined,
        DIRECT_CLASH_API_PROBE_TIMEOUT_MS,
      ),
    )
    .then((outcome) => {
      if (outcome.kind === 'response') {
        directClashApiSuspended = false;
        directClashApiReachable = true;
        directClashApiProbeAt = 0;
      } else {
        suspendDirectClashApi();
      }
    })
    .catch(() => undefined)
    .finally(() => {
      directClashApiProbe = undefined;
    });
  return directClashApiProbe;
}

async function requestClashApi<T>(
  path: string,
  init?: RequestInit,
  timeout?: number,
  // A request the router goes on working on after the browser has stopped
  // waiting must not be sent again. Anything that is not a plain read is such a
  // request, and so is a latency test: the sweep it started outlives the
  // connection that asked for it, and a second one would compete with the first
  // for the same ten test slots and spoil both sets of measurements.
  options?: { keepsRunningAfterTimeout?: boolean; summary?: boolean },
): Promise<Forkop.MethodResponse<T>> {
  const method = (init?.method || 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? init.body : '';
  const keepsRunning =
    options?.keepsRunningAfterTimeout ||
    (method !== 'GET' && method !== 'HEAD');

  if (keepsRunning && canFetchClashApiDirectly() && !directClashApiReachable) {
    await probeDirectClashApi();
  }

  if (canFetchClashApiDirectly()) {
    const outcome = await fetchClashApiDirectly(
      await ensureClashApiConfigSections(),
      path,
      init,
      timeout,
    );

    if (outcome.kind === 'response') {
      directClashApiSuspended = false;
      directClashApiReachable = true;
      directClashApiProbeAt = 0;
      const response = parseClashApiPayload<T>(outcome.status, outcome.body);
      return options?.summary && response.success
        ? {
            success: true,
            data: summarizeConnections(
              response.data as ClashConnectionsSnapshot,
            ) as T,
          }
        : response;
    }

    // A controller that never answered and one that answered too late are the
    // same failure to a caller: both spent their whole budget before the CLI
    // transport got its turn, and repeating that for every request is what the
    // suspension is for.
    suspendDirectClashApi();

    if (keepsRunning) {
      return {
        success: false,
        error:
          outcome.kind === 'timeout'
            ? _('Clash API request timed out after it was sent')
            : _('Clash API response was lost after the request was sent'),
      };
    }
  } else if (canReachClashApiFromBrowser()) {
    void probeDirectClashApi();
  }

  return fetchClashApiThroughCli<T>(method, path, body, options?.summary);
}

function getLatencyTestUrl() {
  return (
    getSettingsSection(clashApiConfigSections)?.latency_test_url ||
    DEFAULT_LATENCY_TEST_URL
  );
}

function latencyRequestTimeout(timeout: string, overshoot = 0) {
  return (
    (Number.parseInt(timeout, 10) || CLASH_API_FETCH_TIMEOUT_MS) +
    overshoot +
    CLASH_API_FETCH_TIMEOUT_MS
  );
}

export async function getClashApiProxyLatency(tag: string, timeout = '5000') {
  await ensureClashApiConfigSections();
  const params = new URLSearchParams({
    url: getLatencyTestUrl(),
    timeout,
  });

  return requestClashApi<Forkop.GetClashApiProxyLatency>(
    `/proxies/${encodeURIComponent(tag)}/delay?${params}`,
    undefined,
    latencyRequestTimeout(timeout),
    { keepsRunningAfterTimeout: true },
  );
}

export async function getClashApiGroupLatency(
  tag: string,
  timeout = GROUP_LATENCY_TIMEOUT_MS,
) {
  await ensureClashApiConfigSections();
  const params = new URLSearchParams({
    url: getLatencyTestUrl(),
    timeout,
  });

  return requestClashApi<Forkop.GetClashApiGroupLatency>(
    `/group/${encodeURIComponent(tag)}/delay?${params}`,
    undefined,
    latencyRequestTimeout(timeout, GROUP_LATENCY_SWEEP_OVERSHOOT_MS),
    { keepsRunningAfterTimeout: true },
  );
}

export function setClashApiGroupProxy(group: string, proxy: string) {
  return requestClashApi<undefined>(
    `/proxies/${encodeURIComponent(group)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: proxy }),
    },
    CLASH_API_MUTATION_TIMEOUT_MS,
  );
}

export function getClashApiProxyLink(tag: string) {
  return requestClashApi<Forkop.GetClashApiProxyLink>(
    `/proxies/${encodeURIComponent(tag)}/link`,
    undefined,
    CLASH_API_FETCH_TIMEOUT_MS,
  );
}

export async function updateClashApiProxyProviders(providerTags: string[]) {
  const responses = await Promise.all(
    providerTags.map((tag) =>
      requestClashApi<undefined>(
        `/providers/proxies/${encodeURIComponent(tag)}`,
        { method: 'PUT' },
        CLASH_API_MUTATION_TIMEOUT_MS,
      ),
    ),
  );

  return (
    responses.find((response) => !response.success) || {
      success: true as const,
      data: undefined,
    }
  );
}

// Refreshing rule-sets downloads files, so it needs the ceiling the router-side
// transport allows rather than the mutation one.
const CLASH_API_RULE_SET_UPDATE_TIMEOUT_MS = 60000;

// The bulk endpoint refreshes every remote rule-set the runtime holds, those of
// the DNS, bypass and block sections the dashboard does not show included, five
// downloads at a time.
export function updateClashApiRuleProviders() {
  return requestClashApi<undefined>(
    '/providers/rules',
    { method: 'PUT' },
    CLASH_API_RULE_SET_UPDATE_TIMEOUT_MS,
  );
}

export function getClashApiProxies() {
  return requestClashApi<ClashAPI.Proxies>(
    '/proxies',
    undefined,
    CLASH_API_FETCH_TIMEOUT_MS,
  );
}

export function getClashApiProxyProviders() {
  return requestClashApi<ClashAPI.ProxyProviders>(
    '/providers/proxies',
    undefined,
    CLASH_API_FETCH_TIMEOUT_MS,
  );
}

export function getClashApiConnections() {
  return requestClashApi<unknown>(
    '/connections',
    undefined,
    CLASH_API_FETCH_TIMEOUT_MS,
  );
}

function summarizeConnections(
  snapshot: ClashConnectionsSnapshot | undefined,
): Forkop.ClashConnectionsSummary {
  return {
    downloadTotal: snapshot?.downloadTotal || 0,
    uploadTotal: snapshot?.uploadTotal || 0,
    connections: snapshot?.connections?.length || 0,
  };
}

// The Dashboard widgets want three numbers out of a snapshot that carries every
// open connection. A browser that reaches the controller can read them out of
// the whole thing for the cost of one local request; one that cannot would drag
// that snapshot across ubus first, where rpcd refuses a reply past about 256KB,
// so the router is asked for the three numbers instead.
export async function getClashApiConnectionsSummary(): Promise<
  Forkop.MethodResponse<Forkop.ClashConnectionsSummary>
> {
  return requestClashApi<Forkop.ClashConnectionsSummary>(
    '/connections',
    undefined,
    CLASH_API_FETCH_TIMEOUT_MS,
    { summary: true },
  );
}

export function closeClashApiConnection(connectionId: string) {
  return requestClashApi<undefined>(
    `/connections/${encodeURIComponent(connectionId)}`,
    { method: 'DELETE' },
    CLASH_API_MUTATION_TIMEOUT_MS,
  );
}

export function closeAllClashApiConnections() {
  return requestClashApi<undefined>(
    '/connections',
    { method: 'DELETE' },
    CLASH_API_MUTATION_TIMEOUT_MS,
  );
}
