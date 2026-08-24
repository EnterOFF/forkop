import { getConfigSections } from './getConfigSections';
import { ClashAPI, Forkop } from '../../types';
import {
  canUseDirectClashApi,
  getClashHttpUrl,
  getProxyUrlName,
  isCopyableProxyLink,
} from '../../../helpers';
import { getOutboundTagBySection } from '../../runtimeTags';
import { ForkopShellMethods } from '../shell';

interface IGetDashboardSectionsResponse {
  success: boolean;
  data: Forkop.OutboundGroup[];
}

type ClashProxyEntry = {
  code: string;
  value: ClashAPI.ProxyBase;
};

type FallbackLevelConfig = {
  id: string;
  displayName: string;
  order: number;
  outbounds?: string[];
};

type ItemSettingsValue = string | string[] | FallbackLevelConfig[] | undefined;
type ItemSettings = Record<string, ItemSettingsValue>;

type UrlTestConfig = {
  id: string;
  code: string;
  displayName: string;
  hideDashboardMembers: boolean;
  testingUrl?: string;
  expectedStatus?: string;
  checkInterval?: string;
  tolerance?: number;
  idleTimeout?: string;
  interruptExistConnections?: boolean;
};

type FallbackConfig = {
  id: string;
  sectionName: string;
  code: string;
  displayName: string;
  hideDashboardMembers: boolean;
  healthCheckUrl: string;
  healthCheckInterval: string;
  healthCheckTimeout: string;
  attemptTimeout: string;
  expectedStatus: string;
  idleTimeout: string;
  interruptExistConnections: boolean;
  levels: FallbackLevelConfig[];
};

type SubscriptionTagConfig = {
  runtimeTag: string;
  displayTag: string;
  showInDashboard: boolean;
  outboundCodes: Set<string>;
};

type ChildType =
  | 'subscription_url'
  | 'section_interface'
  | 'urltest'
  | 'fallback_group'
  | 'fallback_level'
  | 'tunnel'
  | 'tunnel_peer';

type ClashConnectionsSnapshot = {
  downloadTotal?: number;
  uploadTotal?: number;
  memory?: number;
  connections?: unknown[];
};

type DirectClashApiOutcome =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'timeout' }
  | { kind: 'unreachable' };

const CLASH_API_FETCH_TIMEOUT_MS = 5000;
const DEFAULT_LATENCY_TEST_URL = 'https://www.gstatic.com/generate_204';
const CLASH_API_MUTATION_TIMEOUT_MS = 15000;
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
let directClashApiProbeAt = 0;
let directClashApiProbe: Promise<void> | undefined;
const EXPORTABLE_PROVIDER_PROXY_TYPES = new Set([
  'http',
  'hysteria',
  'hysteria2',
  'shadowsocks',
  'socks',
  'trojan',
  'tuic',
  'vless',
  'vmess',
]);

function getDisplayName(section: Forkop.ConfigSection) {
  return section.label || section['.name'];
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
    return { success: false, error: clashApiError(status, body) };
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
    const response = await fetch(`${getClashHttpUrl()}${path}`, {
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
    // An aborted request may already have reached the controller, so callers
    // must not repeat it. Any other rejection means the browser never
    // delivered it (blocked port, unreachable controller, CORS, mixed content).
    return { kind: controller?.signal.aborted ? 'timeout' : 'unreachable' };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function fetchClashApiThroughCli<T>(
  method: string,
  path: string,
  body: string,
): Promise<Forkop.MethodResponse<T>> {
  const response = await ForkopShellMethods.clashHttp(method, path, body);

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
  if (directClashApiProbe || Date.now() < directClashApiProbeAt) {
    return;
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
        directClashApiProbeAt = 0;
      }
    })
    .catch(() => undefined)
    .finally(() => {
      directClashApiProbe = undefined;
    });
}

async function requestClashApi<T>(
  path: string,
  init?: RequestInit,
  timeout?: number,
): Promise<Forkop.MethodResponse<T>> {
  const method = (init?.method || 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? init.body : '';

  if (canFetchClashApiDirectly()) {
    const outcome = await fetchClashApiDirectly(
      await ensureClashApiConfigSections(),
      path,
      init,
      timeout,
    );

    if (outcome.kind === 'response') {
      directClashApiSuspended = false;
      directClashApiProbeAt = 0;
      return parseClashApiPayload<T>(outcome.status, outcome.body);
    }

    // A controller that never answered and one that answered too late are the
    // same failure to a caller: both spent their whole budget before the CLI
    // transport got its turn, and repeating that for every request is what the
    // suspension is for.
    suspendDirectClashApi();

    if (outcome.kind === 'timeout' && method !== 'GET' && method !== 'HEAD') {
      return {
        success: false,
        error: _('Clash API request timed out after it was sent'),
      };
    }
  } else if (canReachClashApiFromBrowser()) {
    probeDirectClashApi();
  }

  return fetchClashApiThroughCli<T>(method, path, body);
}

function getLatencyTestUrl() {
  return (
    getSettingsSection(clashApiConfigSections)?.latency_test_url ||
    DEFAULT_LATENCY_TEST_URL
  );
}

function latencyRequestTimeout(timeout: string) {
  return (
    (Number.parseInt(timeout, 10) || CLASH_API_FETCH_TIMEOUT_MS) +
    CLASH_API_FETCH_TIMEOUT_MS
  );
}

export function getClashApiProxyLatency(tag: string, timeout = '5000') {
  const params = new URLSearchParams({
    url: getLatencyTestUrl(),
    timeout,
  });

  return requestClashApi<Forkop.GetClashApiProxyLatency>(
    `/proxies/${encodeURIComponent(tag)}/delay?${params}`,
    undefined,
    latencyRequestTimeout(timeout),
  );
}

export function getClashApiGroupLatency(tag: string, timeout = '10000') {
  const params = new URLSearchParams({
    url: getLatencyTestUrl(),
    timeout,
  });

  return requestClashApi<Forkop.GetClashApiGroupLatency>(
    `/group/${encodeURIComponent(tag)}/delay?${params}`,
    undefined,
    latencyRequestTimeout(timeout),
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

// Refreshing every rule-set downloads one file per remote rule-set, so it needs
// the same ceiling the router-side transport allows rather than the mutation one.
const CLASH_API_RULE_SET_UPDATE_TIMEOUT_MS = 60000;

export function updateClashApiRuleProviders() {
  return requestClashApi<undefined>(
    '/providers/rules',
    { method: 'PUT' },
    CLASH_API_RULE_SET_UPDATE_TIMEOUT_MS,
  );
}

function getClashApiProxies() {
  return requestClashApi<ClashAPI.Proxies>(
    '/proxies',
    undefined,
    CLASH_API_FETCH_TIMEOUT_MS,
  );
}

function getClashApiProxyProviders() {
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
    memory: snapshot?.memory || 0,
    connections: snapshot?.connections?.length || 0,
  };
}

// The Dashboard widgets want four numbers out of a snapshot that carries every
// open connection. A browser that reaches the controller can read them out of
// the whole thing for the cost of one local request; one that cannot would drag
// that snapshot across ubus first, where rpcd refuses a reply past about 256KB,
// so the router is asked for the four numbers instead.
export async function getClashApiConnectionsSummary(): Promise<
  Forkop.MethodResponse<Forkop.ClashConnectionsSummary>
> {
  if (canFetchClashApiDirectly()) {
    const response = await requestClashApi<ClashConnectionsSnapshot>(
      '/connections',
      undefined,
      CLASH_API_FETCH_TIMEOUT_MS,
    );

    return response.success
      ? { success: true, data: summarizeConnections(response.data) }
      : response;
  }

  const response = await ForkopShellMethods.clashSummary();

  if (!response.success) {
    return response;
  }

  return parseClashApiPayload<Forkop.ClashConnectionsSummary>(
    response.data?.status ?? 0,
    response.data?.body || '',
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

function getListValues(value?: string[] | string) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => `${item}`.trim()).filter(Boolean);
  }

  return `${value}`
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function childSections(
  configSections: Forkop.ConfigSection[],
  type: ChildType,
) {
  return configSections.filter((section) => section['.type'] === type);
}

function ownedChildSections(
  parent: Forkop.ConfigSection,
  children: Forkop.ConfigSection[],
) {
  return children.filter(
    (section): section is Forkop.ConfigSection =>
      section.section === parent['.name'],
  );
}

function childSectionsByOwner(
  children: Forkop.ConfigSection[],
  ownerKey: keyof Forkop.ConfigSection,
  ownerValue: string,
) {
  return children.filter((section) => section[ownerKey] === ownerValue);
}

function compactSettingsMap(settings: Record<string, ItemSettings>) {
  return Object.keys(settings).length ? JSON.stringify(settings) : undefined;
}

function hydrateConfigSections(configSections: Forkop.ConfigSection[]) {
  const subscriptionUrls = childSections(configSections, 'subscription_url');
  const interfaces = childSections(configSections, 'section_interface');
  const urltests = childSections(configSections, 'urltest');
  const fallbackGroups = childSections(configSections, 'fallback_group');
  const fallbackLevels = childSections(configSections, 'fallback_level');
  const tunnels = childSections(configSections, 'tunnel');

  return configSections.map((section) => {
    if (section['.type'] !== 'section') {
      return section;
    }

    const next: Forkop.ConfigSection = { ...section };
    const subscriptionUrlItems = ownedChildSections(next, subscriptionUrls);
    const interfaceItems = ownedChildSections(next, interfaces);
    const urltestItems = ownedChildSections(next, urltests);
    const fallbackGroupItems = ownedChildSections(next, fallbackGroups);
    const tunnelItems = ownedChildSections(next, tunnels);

    if (subscriptionUrlItems.length) {
      const settings: Record<string, ItemSettings> = {};
      next.subscription_urls = subscriptionUrlItems
        .map((item) => item.url || '')
        .filter(Boolean);
      subscriptionUrlItems.forEach((item) => {
        if (!item.url) {
          return;
        }
        settings[item.url] = {
          subscription_update_enabled: item.subscription_update_enabled,
          subscription_update_interval: item.subscription_update_interval,
          download_via_proxy_enabled: item.download_via_proxy_enabled,
          download_via_proxy_section: item.download_via_proxy_section,
          user_agent: item.user_agent,
          header: item.header,
          show_dashboard_metadata: item.show_dashboard_metadata,
          show_subscription_name: item.show_subscription_name,
          tag: item.tag,
        };
      });
      next.subscription_url_settings = compactSettingsMap(settings);
    }

    if (interfaceItems.length) {
      next.interfaces = interfaceItems
        .map((item) => item.name || '')
        .filter(Boolean);
    }

    if (urltestItems.length) {
      const settings: Record<string, ItemSettings> = {};
      next.urltests = urltestItems.map((item) => item['.name']);
      urltestItems.forEach((item) => {
        settings[item['.name']] = {
          display_name: item.name || item.display_name,
          urltest_check_interval: item.check_interval,
          urltest_tolerance: item.tolerance,
          urltest_testing_url: item.testing_url,
          expected_status: item.expected_status,
          idle_timeout: item.idle_timeout,
          interrupt_exist_connections: item.interrupt_exist_connections,
          hide_dashboard_members: item.hide_dashboard_members,
          urltest_server_filter_mode: item.server_filter_mode,
          urltest_include_outbounds: item.include_outbounds,
          urltest_include_regex: item.include_regex,
          urltest_exclude_outbounds: item.exclude_outbounds,
          urltest_exclude_regex: item.exclude_regex,
        };
      });
      next.urltest_settings = compactSettingsMap(settings);
    }

    if (fallbackGroupItems.length) {
      const settings: Record<string, ItemSettings> = {};
      next.fallback_groups = fallbackGroupItems.map((item) => item['.name']);
      fallbackGroupItems.forEach((item) => {
        const groupId = item['.name'];
        const levels = childSectionsByOwner(fallbackLevels, 'group', groupId)
          .map(
            (level, index): FallbackLevelConfig => ({
              id: level['.name'],
              displayName: level.name || level['.name'],
              order: Number.parseInt(level.order || `${index}`, 10) || 0,
            }),
          )
          .sort((left, right) =>
            left.order === right.order
              ? left.id.localeCompare(right.id)
              : left.order - right.order,
          );

        settings[groupId] = {
          name: item.name,
          health_check_url: item.health_check_url,
          health_check_interval: item.health_check_interval,
          health_check_timeout: item.health_check_timeout,
          attempt_timeout: item.attempt_timeout,
          expected_status: item.expected_status,
          idle_timeout: item.idle_timeout,
          interrupt_exist_connections: item.interrupt_exist_connections,
          hide_dashboard_members: item.hide_dashboard_members,
          levels,
        };
      });
      next.fallback_group_settings = compactSettingsMap(settings);
    }

    if (tunnelItems.length) {
      next.tunnels = tunnelItems.map((item) => item['.name']);
    }

    return next;
  });
}

function getManualProxyLinks(section: Forkop.ConfigSection) {
  return getListValues(section.selector_proxy_links);
}

function getConnectionInterfaces(section: Forkop.ConfigSection) {
  const values = getListValues(section.interfaces);
  return values.length ? values : getListValues(section.interface);
}

function getConnectionTunnels(section: Forkop.ConfigSection) {
  return getListValues(section.tunnels);
}

function getJsonOutbounds(section: Forkop.ConfigSection) {
  const values = getListValues(section.outbound_jsons);
  return values.length ? values : getListValues(section.outbound_json);
}

function isConnectionAction(action?: string) {
  return Boolean(
    action && ['connection', 'proxy', 'outbound', 'vpn'].includes(action),
  );
}

function hasSubscriptionSources(section: Forkop.ConfigSection) {
  return getSubscriptionSourceCount(section) > 0;
}

function getSubscriptionSourceCount(section: Forkop.ConfigSection) {
  return getListValues(section.subscription_urls).length;
}

function hasConfiguredUrlTestList(section: Forkop.ConfigSection) {
  return getListValues(section.urltests).length > 0;
}

function hasConfiguredFallbackList(section: Forkop.ConfigSection) {
  return getListValues(section.fallback_groups).length > 0;
}

function getUrlTestIds(section: Forkop.ConfigSection) {
  const values = getListValues(section.urltests);
  return values.length
    ? values
    : section.urltest_enabled === '1'
      ? ['urltest']
      : [];
}

function isUrlTestEnabled(section: Forkop.ConfigSection) {
  return getUrlTestIds(section).length > 0;
}

// The same sources the generator counts before it gives a section a selector and
// its own place in the runtime graph. A URLTest or a Fallback is not one of them:
// a group draws its members from this list, so it cannot stand in for it.
function shouldUseProxyGroup(section: Forkop.ConfigSection) {
  return (
    getManualProxyLinks(section).length > 0 ||
    hasSubscriptionSources(section) ||
    getConnectionInterfaces(section).length > 0 ||
    getConnectionTunnels(section).length > 0 ||
    getJsonOutbounds(section).length > 0
  );
}

function getSectionProxyConfigType(section: Forkop.ConfigSection) {
  if (hasSubscriptionSources(section)) {
    return 'subscription' as const;
  }

  if (isUrlTestEnabled(section) && shouldUseProxyGroup(section)) {
    return 'urltest' as const;
  }

  if (getManualProxyLinks(section).length > 0) {
    return 'selector' as const;
  }

  if (getConnectionTunnels(section).length > 0) {
    return 'selector' as const;
  }

  if (getJsonOutbounds(section).length > 0) {
    return 'outbound' as const;
  }

  if (getConnectionInterfaces(section).length > 0) {
    return 'interface' as const;
  }

  if (hasConfiguredFallbackList(section)) {
    return 'selector' as const;
  }

  return undefined;
}

function getJsonOutboundDisplayName(section: Forkop.ConfigSection) {
  try {
    const parsedOutbound = JSON.parse(section.outbound_json || '{}');
    return parsedOutbound?.tag ? decodeURIComponent(parsedOutbound.tag) : '';
  } catch (_error) {
    return '';
  }
}

function buildManualLinkByCode(
  section: Forkop.ConfigSection,
  selectorCodes: string[],
) {
  const links = getManualProxyLinks(section);
  const available = new Set(selectorCodes);
  const taken = new Set<string>();
  const sectionPrefix = `${getDisplayName(section)}/`;

  return new Map(
    links.flatMap((link, index) => {
      const name = getProxyUrlName(link) || `Node #${index + 1}`;
      const base = `${sectionPrefix}${name}`;
      let code = base;
      for (let number = 2; taken.has(code); number += 1) {
        code = `${base} #${number}`;
      }
      taken.add(code);
      return available.has(code) && isCopyableProxyLink(link)
        ? [[code, link] as const]
        : [];
    }),
  );
}

function canExportProviderProxyLink(
  code: string,
  type: string,
  providerTags: string[],
) {
  return (
    EXPORTABLE_PROVIDER_PROXY_TYPES.has(type.toLowerCase()) &&
    providerTags.some((tag) => code.startsWith(`${tag}/`))
  );
}

function getProxyEntryByCode(proxies: ClashProxyEntry[]) {
  return new Map(proxies.map((proxy) => [proxy.code, proxy]));
}

function uniqueCodes(codes: string[]) {
  return Array.from(new Set(codes.filter(Boolean)));
}

function isUrlTestProxyEntry(entry?: ClashProxyEntry) {
  return entry?.value?.type?.toLowerCase() === 'urltest';
}

function getLatencySortValue(outbound: { latency: number }) {
  const latency = Number(outbound.latency);

  return Number.isFinite(latency) && latency > 0
    ? latency
    : Number.POSITIVE_INFINITY;
}

function sortUrlTestMembers(outbounds: Forkop.UrlTestMember[]) {
  return outbounds
    .map((outbound, index) => ({ outbound, index }))
    .sort((left, right) => {
      if (left.outbound.selected !== right.outbound.selected) {
        return left.outbound.selected ? -1 : 1;
      }

      const latencyDiff =
        getLatencySortValue(left.outbound) -
        getLatencySortValue(right.outbound);

      if (latencyDiff !== 0) {
        return latencyDiff;
      }

      return left.index - right.index;
    })
    .map((item) => item.outbound);
}

function itemSettingsMap(value?: string): Record<string, ItemSettings> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, item]) => item && typeof item === 'object' && !Array.isArray(item),
      ),
    ) as Record<string, ItemSettings>;
  } catch (_error) {
    return {};
  }
}

function itemSettingString(
  settings: ItemSettings | undefined,
  key: string,
  fallback = '',
) {
  const value = settings?.[key];
  return typeof value === 'string' ? value : fallback;
}

function itemSettingBoolean(
  settings: ItemSettings | undefined,
  key: string,
  fallback: boolean,
) {
  const value = settings?.[key];
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return value === '1' || value === 'true';
}

function itemSettingNumber(
  settings: ItemSettings | undefined,
  key: string,
  fallback: number,
) {
  const raw = settings?.[key];
  if (raw === undefined || raw === null || raw === '' || Array.isArray(raw)) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function getChildTag(section: Forkop.ConfigSection, displayName: string) {
  return `${getDisplayName(section)}/${displayName}`;
}

function getUrlTestDisplayName(
  section: Forkop.ConfigSection,
  id: string,
  settings: ItemSettings | undefined,
) {
  return itemSettingString(
    settings,
    'display_name',
    id === 'urltest' && !hasConfiguredUrlTestList(section) ? _('Fastest') : id,
  );
}

function getUrlTestConfigs(section: Forkop.ConfigSection): UrlTestConfig[] {
  const settingsMap = itemSettingsMap(section.urltest_settings);

  return getUrlTestIds(section).map((id) => {
    const settings = settingsMap[id] || {};
    const displayName = getUrlTestDisplayName(section, id, settings);

    return {
      id,
      code: getChildTag(section, displayName),
      displayName,
      hideDashboardMembers: itemSettingBoolean(
        settings,
        'hide_dashboard_members',
        false,
      ),
      testingUrl: itemSettingString(
        settings,
        'urltest_testing_url',
        'https://www.gstatic.com/generate_204',
      ),
      expectedStatus: itemSettingString(settings, 'expected_status', '*'),
      checkInterval: itemSettingString(
        settings,
        'urltest_check_interval',
        '3m',
      ),
      tolerance: itemSettingNumber(settings, 'urltest_tolerance', 50),
      idleTimeout: itemSettingString(settings, 'idle_timeout', '30m'),
      // Keep the defaults in sync with urltest_* in config/connections.uc:
      // that is what the generated sing-box configuration actually carries.
      interruptExistConnections: itemSettingBoolean(
        settings,
        'interrupt_exist_connections',
        false,
      ),
    };
  });
}

function fallbackLevelConfigsFromSettings(
  settings: ItemSettings | undefined,
): FallbackLevelConfig[] {
  const value = settings?.levels;

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return [];
      }

      const level = item as Partial<FallbackLevelConfig> &
        Record<string, unknown>;
      const id = `${level.id || ''}`.trim();

      if (!id) {
        return [];
      }

      return [
        {
          id,
          displayName: `${level.displayName || id}`,
          order:
            typeof level.order === 'number' && Number.isFinite(level.order)
              ? level.order
              : index,
          outbounds: getListValues(level.outbounds as string[] | string),
        },
      ];
    })
    .sort((left, right) =>
      left.order === right.order
        ? left.id.localeCompare(right.id)
        : left.order - right.order,
    );
}

function getFallbackGroupIds(section: Forkop.ConfigSection) {
  return getListValues(section.fallback_groups);
}

function getFallbackConfigs(section: Forkop.ConfigSection): FallbackConfig[] {
  const settingsMap = itemSettingsMap(section.fallback_group_settings);
  const sectionName = section['.name'];

  return getFallbackGroupIds(section).map((id) => {
    const settings = settingsMap[id] || {};
    const levels = fallbackLevelConfigsFromSettings(settings);
    const displayName = itemSettingString(settings, 'name', id);

    return {
      id,
      sectionName,
      code: getChildTag(section, displayName),
      displayName,
      hideDashboardMembers: itemSettingBoolean(
        settings,
        'hide_dashboard_members',
        false,
      ),
      healthCheckUrl: itemSettingString(
        settings,
        'health_check_url',
        'https://www.gstatic.com/generate_204',
      ),
      healthCheckInterval: itemSettingString(
        settings,
        'health_check_interval',
        '5m',
      ),
      healthCheckTimeout: itemSettingString(
        settings,
        'health_check_timeout',
        '5s',
      ),
      attemptTimeout: itemSettingString(settings, 'attempt_timeout', '5s'),
      expectedStatus: itemSettingString(settings, 'expected_status', '*'),
      idleTimeout: itemSettingString(settings, 'idle_timeout', '5m'),
      interruptExistConnections: itemSettingBoolean(
        settings,
        'interrupt_exist_connections',
        false,
      ),
      levels,
    };
  });
}

function getOutboundPresentation(
  code: string,
  sectionDisplayName: string,
  subscriptionTags: SubscriptionTagConfig[],
) {
  const sectionPrefix = `${sectionDisplayName}/`;
  const relativeCode = code.startsWith(sectionPrefix)
    ? code.slice(sectionPrefix.length)
    : code;
  const subscription = subscriptionTags.find((item) =>
    item.outboundCodes.has(code),
  );

  return {
    displayName: subscription
      ? code.slice(subscription.runtimeTag.length + 1)
      : relativeCode,
    subscriptionTag: subscription?.showInDashboard
      ? subscription.displayTag
      : undefined,
  };
}

function getOutboundDisplayType(entry: ClashProxyEntry | undefined) {
  return entry?.value?.type || '';
}

function buildUrlTestInfo({
  config,
  entry,
  proxyByCode,
  manualLinkByCode,
  exportableProviderTags,
  sectionDisplayName,
  subscriptionTags,
}: {
  config: UrlTestConfig;
  entry?: ClashProxyEntry;
  proxyByCode: Map<string, ClashProxyEntry>;
  manualLinkByCode: Map<string, string>;
  exportableProviderTags: string[];
  sectionDisplayName: string;
  subscriptionTags: SubscriptionTagConfig[];
}): Forkop.UrlTestInfo {
  const childCodes = uniqueCodes(entry?.value.all || []);
  const selectedCode = entry?.value.now || '';
  const outbounds = sortUrlTestMembers(
    childCodes.flatMap((childCode) => {
      const childEntry = proxyByCode.get(childCode);
      const link = manualLinkByCode.get(childCode) || '';
      const canCopyLink =
        isCopyableProxyLink(link) ||
        canExportProviderProxyLink(
          childCode,
          childEntry?.value?.type || '',
          exportableProviderTags,
        );
      const presentation = getOutboundPresentation(
        childCode,
        sectionDisplayName,
        subscriptionTags,
      );

      return [
        {
          code: childCode,
          ...presentation,
          latency: childEntry?.value?.history?.[0]?.delay || 0,
          type: getOutboundDisplayType(childEntry),
          selected: selectedCode === childCode,
          link,
          canCopyLink,
        },
      ];
    }),
  );
  const selectedName =
    outbounds.find((outbound) => outbound.code === selectedCode)?.displayName ||
    selectedCode;

  return {
    code: config.code,
    displayName: config.displayName,
    selectedCode: selectedCode || undefined,
    selectedName: selectedName || undefined,
    url: entry?.value.url || config.testingUrl,
    expectedStatus: config.expectedStatus || '*',
    interval: entry?.value.interval || config.checkInterval,
    tolerance: config.tolerance,
    idleTimeout: entry?.value.idle_timeout || config.idleTimeout || '30m',
    interruptExistConnections: config.interruptExistConnections,
    outbounds,
  };
}

function buildFallbackInfo({
  config,
  entry,
  proxyByCode,
  manualLinkByCode,
  exportableProviderTags,
  sectionDisplayName,
  subscriptionTags,
}: {
  config: FallbackConfig;
  entry?: ClashProxyEntry;
  proxyByCode: Map<string, ClashProxyEntry>;
  manualLinkByCode: Map<string, string>;
  exportableProviderTags: string[];
  sectionDisplayName: string;
  subscriptionTags: SubscriptionTagConfig[];
}): Forkop.FallbackInfo {
  const selectedCode = entry?.value.now || '';
  const pinnedCode = entry?.value.fixed || '';
  const configuredLevels = config.levels;
  const runtimeGroups = Array.isArray(entry?.value.groups)
    ? entry.value.groups
    : [];
  // The Clash API reports the members of every level but not their names, and
  // both sides order the levels the same way, so the name of each one comes
  // from the configuration entry in the same position.
  const levels = runtimeGroups
    .map((runtimeGroup, index): FallbackLevelConfig => {
      const metadata = configuredLevels[index];
      return {
        id: metadata?.id || `level-${index + 1}`,
        displayName: metadata?.displayName || `${index + 1}`,
        order:
          typeof metadata?.order === 'number' && Number.isFinite(metadata.order)
            ? metadata.order
            : index,
        outbounds: uniqueCodes(runtimeGroup.outbounds || []),
      };
    })
    .sort((left, right) =>
      left.order === right.order
        ? left.id.localeCompare(right.id)
        : left.order - right.order,
    );
  const outbounds = levels.flatMap((level, levelIndex) => {
    const members = uniqueCodes(level.outbounds || []).map((childCode) => {
      const childEntry = proxyByCode.get(childCode);
      const link = manualLinkByCode.get(childCode) || '';
      const canCopyLink =
        isCopyableProxyLink(link) ||
        canExportProviderProxyLink(
          childCode,
          childEntry?.value?.type || '',
          exportableProviderTags,
        );
      const presentation = getOutboundPresentation(
        childCode,
        sectionDisplayName,
        subscriptionTags,
      );

      return {
        code: childCode,
        ...presentation,
        latency: childEntry?.value?.history?.[0]?.delay || 0,
        type: getOutboundDisplayType(childEntry),
        selected: selectedCode === childCode,
        pinned: pinnedCode === childCode,
        link,
        canCopyLink,
        levelIndex,
        levelName: level.displayName,
        levelId: level.id,
      };
    });

    return members;
  });
  const selectedName =
    outbounds.find((outbound) => outbound.code === selectedCode)?.displayName ||
    selectedCode;

  return {
    code: config.code,
    displayName: config.displayName,
    selectedCode: selectedCode || undefined,
    selectedName: selectedName || undefined,
    healthCheckUrl: config.healthCheckUrl,
    healthCheckInterval: config.healthCheckInterval,
    healthCheckTimeout: config.healthCheckTimeout,
    attemptTimeout: config.attemptTimeout,
    expectedStatus: config.expectedStatus,
    idleTimeout: config.idleTimeout,
    interruptExistConnections: config.interruptExistConnections,
    outbounds,
  };
}

function buildProxyGroupOutbounds(
  section: Forkop.ConfigSection,
  proxies: ClashProxyEntry[],
  subscriptionTags: SubscriptionTagConfig[],
) {
  const sectionDisplayName = getDisplayName(section);
  const exportableProviderTags = subscriptionTags.map(
    (item) => item.runtimeTag,
  );
  const proxyByCode = getProxyEntryByCode(proxies);
  const selectorTag = getOutboundTagBySection(sectionDisplayName);
  const selector = proxyByCode.get(selectorTag);
  const selectorCodes = selector?.value?.all ?? [];
  // The runtime tag of a group is its name, and a second group of the same name
  // gets a " #2" suffix from the generator. A configured group the runtime does
  // not carry keeps its own code and is dropped below: only what the Clash API
  // reports is on the dashboard.
  const bindRuntimeCodes = <T extends { code: string }>(
    configs: T[],
    type: string,
  ) => {
    const candidates = selectorCodes.filter(
      (code) => proxyByCode.get(code)?.value.type.toLowerCase() === type,
    );
    const remaining = new Set(candidates);
    return configs.map((config) => {
      const code = candidates.find(
        (candidate) =>
          remaining.has(candidate) &&
          (candidate === config.code ||
            candidate.startsWith(`${config.code} #`)),
      );
      if (code) remaining.delete(code);
      return code ? { ...config, code } : config;
    });
  };
  const urlTestConfigs = bindRuntimeCodes(
    getUrlTestConfigs(section),
    'urltest',
  );
  const urlTestConfigByCode = new Map(
    urlTestConfigs.map((config) => [config.code, config]),
  );
  const fallbackConfigs = bindRuntimeCodes(
    getFallbackConfigs(section),
    'fallback',
  );
  const fallbackConfigByCode = new Map(
    fallbackConfigs.map((config) => [config.code, config]),
  );
  const urlTestEntries = urlTestConfigs.map((config) => ({
    config,
    entry: proxyByCode.get(config.code),
  }));
  const fallbackEntries = fallbackConfigs.map((config) => ({
    config,
    entry: proxyByCode.get(config.code),
  }));
  const manualLinkByCode = buildManualLinkByCode(section, selectorCodes);
  const urlTestCodes = urlTestConfigs.map((config) => config.code);
  const fallbackGroupCodes = fallbackConfigs.map((config) => config.code);
  const hiddenMemberCodes = new Set<string>();
  const hideMembers = (codes: string[]) => {
    uniqueCodes(codes).forEach((code) => hiddenMemberCodes.add(code));
  };

  urlTestEntries.forEach(({ config, entry }) => {
    if (config.hideDashboardMembers) hideMembers(entry?.value.all || []);
  });
  fallbackEntries.forEach(({ config, entry }) => {
    if (!config.hideDashboardMembers) {
      return;
    }

    (entry?.value.groups || []).forEach((level) =>
      hideMembers(level.outbounds || []),
    );
  });
  const groupOutboundCodes = new Set([...urlTestCodes, ...fallbackGroupCodes]);

  const outbounds = uniqueCodes(selectorCodes)
    .filter(
      (code) => groupOutboundCodes.has(code) || !hiddenMemberCodes.has(code),
    )
    .flatMap((code) => {
      const item = proxyByCode.get(code);
      const urlTestConfig = urlTestConfigByCode.get(code);
      const fallbackConfig = fallbackConfigByCode.get(code);

      if (!item) {
        return [];
      }

      const link = manualLinkByCode.get(code) || '';
      const canCopyLink =
        isCopyableProxyLink(link) ||
        canExportProviderProxyLink(
          code,
          item.value?.type || '',
          exportableProviderTags,
        );
      const presentation = getOutboundPresentation(
        code,
        sectionDisplayName,
        subscriptionTags,
      );
      const displayName =
        fallbackConfig?.displayName ||
        urlTestConfig?.displayName ||
        presentation.displayName;
      const isRuntimeUrlTest = isUrlTestProxyEntry(item);
      const effectiveUrlTestConfig =
        urlTestConfig ||
        (isRuntimeUrlTest
          ? {
              id: code,
              code,
              displayName,
              hideDashboardMembers: false,
            }
          : undefined);
      const urlTestInfo = effectiveUrlTestConfig
        ? buildUrlTestInfo({
            config: effectiveUrlTestConfig,
            entry: item,
            proxyByCode,
            manualLinkByCode,
            exportableProviderTags,
            sectionDisplayName,
            subscriptionTags,
          })
        : undefined;
      const fallbackInfo = fallbackConfig
        ? buildFallbackInfo({
            config: fallbackConfig,
            entry: item,
            proxyByCode,
            manualLinkByCode,
            exportableProviderTags,
            sectionDisplayName,
            subscriptionTags,
          })
        : undefined;
      const groupInfo = urlTestInfo || fallbackInfo;
      const selectedGroupMember = groupInfo?.outbounds.find(
        (member) => member.selected,
      );

      return [
        {
          code,
          displayName,
          subscriptionTag:
            fallbackConfig || urlTestConfig
              ? undefined
              : presentation.subscriptionTag,
          latency:
            selectedGroupMember?.latency || item.value.history?.[0]?.delay || 0,
          type: fallbackConfig
            ? 'Fallback'
            : getOutboundDisplayType(item) || 'URLTest',
          selected: selector?.value?.now === code,
          link,
          canCopyLink,
          urlTestInfo,
          fallbackInfo,
        },
      ];
    });

  return {
    selector,
    latencyTestCode: selector?.code,
    outbounds,
  };
}

function isSubscriptionMetadataVisible(
  section: Forkop.ConfigSection,
  sourceIndex: number,
) {
  const sourceEntry = getListValues(section.subscription_urls)[sourceIndex - 1];
  const settings = itemSettingsMap(section.subscription_url_settings)[
    sourceEntry
  ];

  return settings?.show_dashboard_metadata !== '0';
}

function getSectionSubscriptionTags(
  section: Forkop.ConfigSection,
  providers: Record<string, ClashAPI.ProxyProvider>,
) {
  const sectionDisplayName = getDisplayName(section);
  const settings = itemSettingsMap(section.subscription_url_settings);

  return getListValues(section.subscription_urls).map((source, index) => {
    const sourceSettings = settings[source];
    const displayTag = itemSettingString(
      sourceSettings,
      'tag',
      `sub${index + 1}`,
    );
    return {
      runtimeTag: `${sectionDisplayName}/${displayTag}`,
      displayTag,
      showInDashboard: itemSettingBoolean(
        sourceSettings,
        'show_subscription_name',
        false,
      ),
      outboundCodes: new Set(
        (providers[`${sectionDisplayName}/${displayTag}`]?.proxies || []).map(
          (proxy) => proxy.name,
        ),
      ),
    };
  });
}

function providerNumber(
  value: ClashAPI.ProxyProvider['subscriptionInfo'],
  lower: 'upload' | 'download' | 'total' | 'expire',
) {
  const upper = `${lower[0].toUpperCase()}${lower.slice(1)}` as
    | 'Upload'
    | 'Download'
    | 'Total'
    | 'Expire';
  const number = Number(value?.[lower] ?? value?.[upper] ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function providerSubscriptionMetadata(
  provider: ClashAPI.ProxyProvider,
  sourceIndex: number,
  subscriptionTag: string,
): Forkop.SubscriptionMetadata | undefined {
  const metadata = provider.subscriptionMetadata || {};
  const upload = providerNumber(provider.subscriptionInfo, 'upload');
  const download = providerNumber(provider.subscriptionInfo, 'download');
  const total = providerNumber(provider.subscriptionInfo, 'total');
  const expire = providerNumber(provider.subscriptionInfo, 'expire');
  const used = upload + download;

  if (
    !upload &&
    !download &&
    !total &&
    !expire &&
    !Object.keys(metadata).length
  ) {
    return undefined;
  }

  return {
    ...metadata,
    sourceIndex,
    sourceSection: provider.name,
    ...(subscriptionTag ? { subscriptionTag } : {}),
    ...(upload || download || total
      ? {
          traffic: {
            upload,
            download,
            used,
            total,
            remaining: total > 0 ? Math.max(total - used, 0) : undefined,
            isUnlimited: total <= 0,
          },
        }
      : {}),
    ...(expire ? { expire } : {}),
  };
}

function getSubscriptionMetadata(
  section: Forkop.ConfigSection,
  sourceCount: number,
  subscriptionTags: SubscriptionTagConfig[],
  providers: Record<string, ClashAPI.ProxyProvider>,
) {
  const items = subscriptionTags.slice(0, sourceCount).flatMap((tag, index) => {
    const sourceIndex = index + 1;
    const provider = providers[tag.runtimeTag];
    if (
      !provider ||
      (provider.subscriptionInfo === undefined &&
        provider.subscriptionMetadata === undefined)
    ) {
      return [];
    }
    const metadata = providerSubscriptionMetadata(
      provider,
      sourceIndex,
      tag.showInDashboard ? tag.displayTag : '',
    );
    return metadata && isSubscriptionMetadataVisible(section, sourceIndex)
      ? [metadata]
      : [];
  });

  return items.length ? items : undefined;
}

export async function getDashboardSections(): Promise<IGetDashboardSectionsResponse> {
  const configSections = hydrateConfigSections(await getConfigSections());
  clashApiConfigSections = configSections;
  const hasSubscriptions = configSections.some(hasSubscriptionSources);
  const [clashProxies, clashProviders] = await Promise.all([
    getClashApiProxies(),
    hasSubscriptions
      ? getClashApiProxyProviders()
      : Promise.resolve({
          success: true as const,
          data: { providers: {} },
        }),
  ]);

  if (!clashProxies.success || !clashProxies.data?.proxies) {
    return {
      success: false,
      data: [],
    };
  }

  const proxies = Object.entries(clashProxies.data.proxies).map(
    ([key, value]) => ({
      code: key,
      value,
    }),
  );
  const providers = clashProviders.success
    ? clashProviders.data?.providers || {}
    : {};
  const activeSections = configSections.filter(
    (section) => section.enabled !== '0' && isConnectionAction(section.action),
  );
  const data = activeSections.map((section) => {
    const displayName = getDisplayName(section);
    const sectionName = section['.name'];
    const sectionAction = section.action;
    const proxyConfigType = getSectionProxyConfigType(section);

    if (isConnectionAction(sectionAction) && shouldUseProxyGroup(section)) {
      const subscriptionSourceCount = getSubscriptionSourceCount(section);
      const subscriptionEnabled = subscriptionSourceCount > 0;
      const subscriptionTags = getSectionSubscriptionTags(section, providers);
      const subscriptionMetadata = subscriptionEnabled
        ? getSubscriptionMetadata(
            section,
            subscriptionSourceCount,
            subscriptionTags,
            providers,
          )
        : undefined;
      const { selector, latencyTestCode, outbounds } = buildProxyGroupOutbounds(
        section,
        proxies,
        subscriptionTags,
      );

      return {
        withTagSelect: true,
        code: selector?.code || displayName,
        sectionName,
        displayName,
        action: sectionAction,
        latencyTestCode,
        proxyConfigType,
        subscriptionSourceCount,
        subscriptionProviderTags: subscriptionTags.map(
          (item) => item.runtimeTag,
        ),
        subscriptionMetadata,
        outbounds,
      };
    }

    if (sectionAction === 'vpn') {
      const outboundTag = getOutboundTagBySection(displayName);
      const outbound = proxies.find((proxy) => proxy.code === outboundTag);

      return {
        withTagSelect: false,
        code: outbound?.code || displayName,
        sectionName,
        displayName,
        action: sectionAction,
        latencyTestTimeout: '10000',
        outbounds: [
          {
            code: outbound?.code || displayName,
            displayName: section.interface || outbound?.value?.name || '',
            latency: outbound?.value?.history?.[0]?.delay || 0,
            type: outbound?.value?.type || '',
            selected: true,
            canCopyLink: false,
            runtimeAvailable: Boolean(outbound),
          },
        ],
      };
    }

    if (sectionAction === 'outbound') {
      const outboundTag = getOutboundTagBySection(displayName);
      const outbound = proxies.find((proxy) => proxy.code === outboundTag);

      return {
        withTagSelect: false,
        code: outbound?.code || displayName,
        sectionName,
        displayName,
        action: sectionAction,
        outbounds: [
          {
            code: outbound?.code || displayName,
            displayName:
              getJsonOutboundDisplayName(section) ||
              outbound?.value?.name ||
              '',
            latency: outbound?.value?.history?.[0]?.delay || 0,
            type: outbound?.value?.type || '',
            selected: true,
            canCopyLink: false,
          },
        ],
      };
    }

    return {
      withTagSelect: false,
      code: displayName,
      sectionName,
      displayName,
      action: sectionAction,
      outbounds: [],
    };
  });

  return {
    success: true,
    data,
  };
}
