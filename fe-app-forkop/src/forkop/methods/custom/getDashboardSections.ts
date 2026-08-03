import { getConfigSections } from './getConfigSections';
import { ClashAPI, Forkop } from '../../types';
import {
  canUseDirectClashApi,
  getClashHttpUrl,
  getProxyUrlName,
  isCopyableProxyLink,
} from '../../../helpers';
import { allocateRuntimeTag, getOutboundTagBySection } from '../../runtimeTags';
import { ForkopShellMethods } from '../shell';

interface IGetDashboardSectionsResponse {
  success: boolean;
  data: Forkop.OutboundGroup[];
}

type ClashProxyEntry = {
  code: string;
  value: ClashAPI.ProxyBase;
};

type DashboardSectionCache = {
  version?: number;
  section?: string;
  outboundMetadata?: Forkop.GetOutboundMetadata;
  urltestGroups?: Record<string, UrlTestCacheGroup>;
  fallbackGroups?: Record<string, FallbackCacheGroup>;
  providerTags?: string[];
};

type UrlTestCacheGroup = {
  displayName?: string;
  outbounds?: string[];
  url?: string;
  interval?: string;
  tolerance?: string | number;
  idle_timeout?: string;
  interrupt_exist_connections?: boolean;
  hide_dashboard_members?: boolean;
};

type FallbackCacheLevel = {
  id?: string;
  tag?: string;
  displayName?: string;
  order?: number;
  outbounds?: string[];
};

type FallbackCacheGroup = {
  id?: string;
  tag?: string;
  section?: string;
  displayName?: string;
  url?: string;
  interval?: string;
  timeout?: string;
  idle_timeout?: string;
  interrupt_exist_connections?: boolean;
  pin_dashboard?: boolean;
  hide_dashboard_members?: boolean;
  outbounds?: string[];
  levels?: FallbackCacheLevel[];
};

type FallbackLevelConfig = {
  id: string;
  tag?: string;
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
  settings: ItemSettings;
  pinDashboard: boolean;
  hideDashboardMembers: boolean;
};

type FallbackConfig = {
  id: string;
  sectionName: string;
  code: string;
  displayName: string;
  pinDashboard: boolean;
  hideDashboardMembers: boolean;
  healthCheckUrl: string;
  healthCheckInterval: string;
  healthCheckTimeout: string;
  idleTimeout: string;
  interruptExistConnections: boolean;
  levels: FallbackLevelConfig[];
};

type ChildType =
  | 'subscription_url'
  | 'section_interface'
  | 'urltest'
  | 'fallback_group'
  | 'fallback_level'
  | 'tunnel'
  | 'tunnel_peer';

const CLASH_API_FETCH_TIMEOUT_MS = 5000;
const EXPORTABLE_PROVIDER_PROXY_TYPES = new Set([
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

function canFetchClashApiDirectly() {
  return canUseDirectClashApi() && typeof fetch === 'function';
}

async function getClashApi<T>(
  configSections: Forkop.ConfigSection[],
  path: string,
  fallback: () => Promise<Forkop.MethodResponse<T>>,
): Promise<Forkop.MethodResponse<T>> {
  if (canFetchClashApiDirectly()) {
    const secret = getClashApiSecret(configSections);
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      CLASH_API_FETCH_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`${getClashHttpUrl()}${path}`, {
        headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
        signal: controller.signal,
      });

      if (response.ok) {
        return {
          success: true,
          data: (await response.json()) as T,
        };
      }
    } catch (_error) {
      // Fall back to rpcd below for controllers unavailable from the browser.
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return fallback();
}

function getClashApiProxies(configSections: Forkop.ConfigSection[]) {
  return getClashApi(
    configSections,
    '/proxies',
    ForkopShellMethods.getClashApiProxies,
  );
}

function getClashApiProxyProviders(configSections: Forkop.ConfigSection[]) {
  return getClashApi(
    configSections,
    '/providers/proxies',
    ForkopShellMethods.getClashApiProxyProviders,
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
          prefix_nodes: item.prefix_nodes,
          node_prefix: item.node_prefix,
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
          idle_timeout: item.idle_timeout,
          interrupt_exist_connections: item.interrupt_exist_connections,
          pin_dashboard: item.pin_dashboard,
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
          idle_timeout: item.idle_timeout,
          interrupt_exist_connections: item.interrupt_exist_connections,
          pin_dashboard: item.pin_dashboard,
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

function shouldSortByLatency(section: Forkop.ConfigSection) {
  return section.sort_by_latency === '1';
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

function shouldUseProxyGroup(section: Forkop.ConfigSection) {
  return (
    getManualProxyLinks(section).length > 0 ||
    hasSubscriptionSources(section) ||
    getConnectionInterfaces(section).length > 0 ||
    getConnectionTunnels(section).length > 0 ||
    getJsonOutbounds(section).length > 0 ||
    isUrlTestEnabled(section) ||
    hasConfiguredFallbackList(section)
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
  const prefix = `${allocateRuntimeTag(
    `${section['.name']}-manual`,
    'provider',
  )}/`;
  const runtimeCodes = selectorCodes.filter((code) => code.startsWith(prefix));

  return new Map(
    runtimeCodes.flatMap((code, index) => {
      const link = links[index];
      return isCopyableProxyLink(link) ? [[code, link] as const] : [];
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

function isSelectorOutbound(outbound: Forkop.Outbound) {
  return outbound.type?.toLowerCase() === 'selector';
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

function sortOutboundsForDashboard(
  outbounds: Forkop.Outbound[],
  options: {
    pinnedCode?: string;
    pinnedCodes?: string[];
    sortByLatency?: boolean;
  } = {},
) {
  const pinnedCodes = [
    ...(options.pinnedCode ? [options.pinnedCode] : []),
    ...(options.pinnedCodes || []),
  ].filter(Boolean);
  const pinnedRank = new Map(
    pinnedCodes.map((code, index) => [code, index] as const),
  );
  const sortByLatency = options.sortByLatency === true;

  return outbounds
    .map((outbound, index) => ({ outbound, index }))
    .sort((left, right) => {
      const leftPinned = pinnedRank.has(left.outbound.code);
      const rightPinned = pinnedRank.has(right.outbound.code);

      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1;
      }

      if (leftPinned && rightPinned) {
        const rankDiff =
          (pinnedRank.get(left.outbound.code) ?? 0) -
          (pinnedRank.get(right.outbound.code) ?? 0);

        if (rankDiff !== 0) {
          return rankDiff;
        }
      }

      if (sortByLatency) {
        const latencyDiff =
          getLatencySortValue(left.outbound) -
          getLatencySortValue(right.outbound);

        if (latencyDiff !== 0) {
          return latencyDiff;
        }
      }

      return left.index - right.index;
    })
    .map((item) => item.outbound);
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

function isSafeSectionName(sectionName: string) {
  return /^[A-Za-z0-9_-]+$/.test(sectionName);
}

function objectMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item === 'string')
      .map(([key, item]) => [key, item as string]),
  );
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

function getUrlTestTag(sectionName: string, id: string) {
  return getOutboundTagBySection(
    id === 'urltest'
      ? `${sectionName}-urltest`
      : `${sectionName}-urltest-${id}`,
  );
}

function getFallbackTag(sectionName: string, id: string) {
  return getOutboundTagBySection(`${sectionName}-fallback-${id}`);
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
  const sectionName = section['.name'];

  return getUrlTestIds(section).map((id) => {
    const settings = settingsMap[id] || {};

    return {
      id,
      code: getUrlTestTag(sectionName, id),
      displayName: getUrlTestDisplayName(section, id, settings),
      settings,
      pinDashboard: itemSettingBoolean(settings, 'pin_dashboard', true),
      hideDashboardMembers: itemSettingBoolean(
        settings,
        'hide_dashboard_members',
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

    return {
      id,
      sectionName,
      code: getFallbackTag(sectionName, id),
      displayName: itemSettingString(settings, 'name', id),
      pinDashboard: itemSettingBoolean(settings, 'pin_dashboard', true),
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
      idleTimeout: itemSettingString(settings, 'idle_timeout', '5m'),
      interruptExistConnections: itemSettingBoolean(
        settings,
        'interrupt_exist_connections',
        true,
      ),
      levels,
    };
  });
}

async function readDashboardSectionCache(
  sectionName: string,
): Promise<DashboardSectionCache | undefined> {
  if (!isSafeSectionName(sectionName)) {
    return undefined;
  }

  const response =
    await ForkopShellMethods.getDashboardSectionCache(sectionName);
  if (!response.success) {
    throw new Error(response.error || 'Failed to read dashboard section cache');
  }

  const parsed = response.data as DashboardSectionCache;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed
    : undefined;
}

function getUrlTestGroups(dashboardCache?: DashboardSectionCache) {
  const groups = dashboardCache?.urltestGroups;

  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) {
    return {};
  }

  return groups;
}

function getFallbackGroups(dashboardCache?: DashboardSectionCache) {
  const groups = dashboardCache?.fallbackGroups;

  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) {
    return {};
  }

  return groups;
}

function getOutboundDisplayName(
  code: string,
  entry: ClashProxyEntry | undefined,
  link: string,
  outboundMetadata?: Forkop.GetOutboundMetadata,
) {
  const metadataName = outboundMetadata?.names?.[code];

  return getProxyUrlName(link) || metadataName || entry?.value?.name || code;
}

function getOutboundDisplayType(
  code: string,
  entry: ClashProxyEntry | undefined,
  outboundMetadata?: Forkop.GetOutboundMetadata,
) {
  const protocol = outboundMetadata?.protocols?.[code]?.toLowerCase();
  if (protocol === 'amneziawg') return 'AmneziaWG';
  if (protocol === 'tailscale') return 'Tailscale';
  return entry?.value?.type || '';
}

function buildUrlTestInfo({
  code,
  displayName,
  entry,
  groupCache,
  proxyByCode,
  manualLinkByCode,
  exportableProviderTags,
  outboundMetadata,
}: {
  code: string;
  displayName: string;
  entry?: ClashProxyEntry;
  groupCache?: UrlTestCacheGroup;
  proxyByCode: Map<string, ClashProxyEntry>;
  manualLinkByCode: Map<string, string>;
  exportableProviderTags: string[];
  outboundMetadata?: Forkop.GetOutboundMetadata;
}): Forkop.UrlTestInfo {
  const childCodes = uniqueCodes([
    ...(entry?.value.all || []),
    ...(groupCache?.outbounds || []),
  ]);
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

      return [
        {
          code: childCode,
          displayName: getOutboundDisplayName(
            childCode,
            childEntry,
            link,
            outboundMetadata,
          ),
          latency: childEntry?.value?.history?.[0]?.delay || 0,
          type: getOutboundDisplayType(childCode, childEntry, outboundMetadata),
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
    code,
    displayName: groupCache?.displayName || displayName,
    selectedCode: selectedCode || undefined,
    selectedName: selectedName || undefined,
    url: groupCache?.url,
    interval: groupCache?.interval,
    tolerance: groupCache?.tolerance,
    idleTimeout: groupCache?.idle_timeout || '30m',
    interruptExistConnections: groupCache?.interrupt_exist_connections,
    outbounds,
  };
}

function buildFallbackInfo({
  config,
  entry,
  groupCache,
  proxyByCode,
  manualLinkByCode,
  exportableProviderTags,
  outboundMetadata,
}: {
  config: FallbackConfig;
  entry?: ClashProxyEntry;
  groupCache?: FallbackCacheGroup;
  proxyByCode: Map<string, ClashProxyEntry>;
  manualLinkByCode: Map<string, string>;
  exportableProviderTags: string[];
  outboundMetadata?: Forkop.GetOutboundMetadata;
}): Forkop.FallbackInfo {
  const selectedCode = entry?.value.now || '';
  const cacheLevels = Array.isArray(groupCache?.levels)
    ? groupCache.levels
    : [];
  const configLevelById = new Map(
    config.levels.map((level) => [level.id, level]),
  );
  const configuredLevels = cacheLevels.length ? cacheLevels : config.levels;
  const runtimeLevels = Array.isArray(entry?.value.levels)
    ? entry.value.levels
    : [];
  const levels = (
    runtimeLevels.length
      ? runtimeLevels.map((runtimeLevel, index): FallbackLevelConfig => {
          const runtimeTag = `${runtimeLevel.tag || ''}`;
          const metadata =
            configuredLevels.find(
              (level) => level.tag === runtimeTag || level.id === runtimeTag,
            ) || configuredLevels[index];
          const id = `${metadata?.id || runtimeTag || `level-${index + 1}`}`;
          const configLevel = configLevelById.get(id);

          return {
            id,
            tag: runtimeTag || metadata?.tag || id,
            displayName:
              metadata?.displayName ||
              configLevel?.displayName ||
              `${index + 1}`,
            order:
              typeof metadata?.order === 'number' &&
              Number.isFinite(metadata.order)
                ? metadata.order
                : (configLevel?.order ?? index),
            outbounds: uniqueCodes(runtimeLevel.outbounds || []),
          };
        })
      : configuredLevels.map((level, index) => {
          const id = `${level.id || `level-${index + 1}`}`;
          const configLevel = configLevelById.get(id);

          return {
            id,
            tag: level.tag || id,
            displayName:
              level.displayName || configLevel?.displayName || `${index + 1}`,
            order:
              typeof level.order === 'number' && Number.isFinite(level.order)
                ? level.order
                : (configLevel?.order ?? index),
            outbounds: uniqueCodes(level.outbounds || []),
          };
        })
  ).sort((left, right) =>
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

      return {
        code: childCode,
        displayName: getOutboundDisplayName(
          childCode,
          childEntry,
          link,
          outboundMetadata,
        ),
        latency: childEntry?.value?.history?.[0]?.delay || 0,
        type: getOutboundDisplayType(childCode, childEntry, outboundMetadata),
        selected: selectedCode === childCode,
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
    displayName: groupCache?.displayName || config.displayName,
    selectedCode: selectedCode || undefined,
    selectedName: selectedName || undefined,
    healthCheckUrl: groupCache?.url || config.healthCheckUrl,
    healthCheckInterval: groupCache?.interval || config.healthCheckInterval,
    healthCheckTimeout: groupCache?.timeout || config.healthCheckTimeout,
    idleTimeout: groupCache?.idle_timeout || config.idleTimeout,
    interruptExistConnections:
      groupCache?.interrupt_exist_connections ??
      config.interruptExistConnections,
    outbounds,
  };
}

function buildProxyGroupOutbounds(
  section: Forkop.ConfigSection,
  proxies: ClashProxyEntry[],
  outboundMetadata?: Forkop.GetOutboundMetadata,
  urltestGroups: Record<string, UrlTestCacheGroup> = {},
  fallbackGroups: Record<string, FallbackCacheGroup> = {},
  exportableProviderTags: string[] = [],
) {
  const sectionName = section['.name'];
  const proxyByCode = getProxyEntryByCode(proxies);
  const selectorTag = getOutboundTagBySection(sectionName);
  const selector = proxyByCode.get(selectorTag);
  const urlTestConfigs = getUrlTestConfigs(section);
  const urlTestConfigByCode = new Map(
    urlTestConfigs.map((config) => [config.code, config]),
  );
  const fallbackConfigs = getFallbackConfigs(section);
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
  const selectorCodes = selector?.value?.all ?? [];
  const manualLinkByCode = buildManualLinkByCode(section, selectorCodes);
  const urlTestCodes = urlTestConfigs.map((config) => config.code);
  const fallbackGroupCodes = fallbackConfigs.map((config) => config.code);
  const hiddenMemberCodes = new Set<string>();
  const hideMembers = (codes: string[]) => {
    uniqueCodes(codes).forEach((code) => hiddenMemberCodes.add(code));
  };

  urlTestEntries.forEach(({ config, entry }) => {
    const cache = urltestGroups[config.code];
    if (config.hideDashboardMembers || cache?.hide_dashboard_members) {
      hideMembers(
        entry?.value.all?.length ? entry.value.all : cache?.outbounds || [],
      );
    }
  });
  fallbackEntries.forEach(({ config, entry }) => {
    const cache = fallbackGroups[config.code];
    if (!config.hideDashboardMembers && !cache?.hide_dashboard_members) {
      return;
    }

    const levels = entry?.value.levels?.length
      ? entry.value.levels
      : cache?.levels?.length
        ? cache.levels
        : config.levels;
    levels.forEach((level) => hideMembers(level.outbounds || []));
  });
  const builtInUrltestCode = urlTestCodes[0] || '';
  const selectorFallbackCodes = uniqueCodes([
    ...urlTestCodes,
    ...fallbackGroupCodes,
    ...urlTestEntries.flatMap(({ entry }) => entry?.value.all || []),
  ]);
  const groupCodes = uniqueCodes([
    ...(selectorCodes.length ? selectorCodes : selectorFallbackCodes),
    ...urlTestCodes,
    ...fallbackGroupCodes,
  ]);
  const groupOutboundCodes = new Set([...urlTestCodes, ...fallbackGroupCodes]);

  const outbounds = uniqueCodes(groupCodes)
    .filter(
      (code) => groupOutboundCodes.has(code) || !hiddenMemberCodes.has(code),
    )
    .flatMap((code) => {
      const item = proxyByCode.get(code);
      const urlTestConfig = urlTestConfigByCode.get(code);
      const fallbackConfig = fallbackConfigByCode.get(code);

      if (!item && !urlTestConfig && !fallbackConfig) {
        return [];
      }

      const link = manualLinkByCode.get(code) || '';
      const canCopyLink =
        isCopyableProxyLink(link) ||
        canExportProviderProxyLink(
          code,
          item?.value?.type || '',
          exportableProviderTags,
        );
      const displayName =
        fallbackConfig?.displayName ||
        urlTestConfig?.displayName ||
        getOutboundDisplayName(code, item, link, outboundMetadata);
      const isRuntimeUrlTest = isUrlTestProxyEntry(item);
      const urlTestInfo =
        urlTestConfig || isRuntimeUrlTest
          ? buildUrlTestInfo({
              code,
              displayName,
              entry: item,
              groupCache: urltestGroups[code],
              proxyByCode,
              manualLinkByCode,
              exportableProviderTags,
              outboundMetadata,
            })
          : undefined;
      const fallbackInfo = fallbackConfig
        ? buildFallbackInfo({
            config: fallbackConfig,
            entry: item,
            groupCache: fallbackGroups[code],
            proxyByCode,
            manualLinkByCode,
            exportableProviderTags,
            outboundMetadata,
          })
        : undefined;
      const groupInfo = urlTestInfo || fallbackInfo;
      const selectedGroupMember = groupInfo?.outbounds.find(
        (member) => member.selected,
      );
      const hasLiveGroupMember = !groupInfo || groupInfo.outbounds.length > 0;

      return [
        {
          code,
          displayName,
          latency:
            selectedGroupMember?.latency ||
            item?.value.history?.[0]?.delay ||
            0,
          type: fallbackConfig
            ? 'Fallback'
            : getOutboundDisplayType(code, item, outboundMetadata) || 'URLTest',
          selected: selector?.value?.now === code,
          link,
          canCopyLink,
          runtimeAvailable: item && hasLiveGroupMember ? undefined : false,
          urlTestInfo,
          fallbackInfo,
        },
      ];
    });

  const sortedOutbounds = sortOutboundsForDashboard(outbounds, {
    pinnedCodes: [
      ...urlTestEntries
        .filter(({ config }) => config.pinDashboard)
        .map(({ config }) => config.code),
      ...fallbackEntries
        .filter(({ config }) => config.pinDashboard)
        .map(({ config }) => config.code),
    ],
    sortByLatency: shouldSortByLatency(section),
  });
  const latencyTestCodes = sortedOutbounds
    .filter(
      (outbound) =>
        outbound.runtimeAvailable !== false &&
        !isSelectorOutbound(outbound) &&
        !outbound.fallbackInfo,
    )
    .map((outbound) => outbound.code);

  return {
    selector,
    latencyTestCode: selector?.code || builtInUrltestCode,
    latencyTestCodes:
      latencyTestCodes.length > 0 ? latencyTestCodes : undefined,
    outbounds: sortedOutbounds,
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

function getSectionProviderTags(dashboardCache?: DashboardSectionCache) {
  return getListValues(dashboardCache?.providerTags);
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
  providerTags: string[],
  providers: Record<string, ClashAPI.ProxyProvider>,
) {
  const items = providerTags.slice(0, sourceCount).flatMap((tag, index) => {
    const sourceIndex = index + 1;
    const provider = providers[tag];
    if (
      !provider ||
      (provider.subscriptionInfo === undefined &&
        provider.subscriptionMetadata === undefined)
    ) {
      return [];
    }
    const metadata = providerSubscriptionMetadata(provider, sourceIndex);
    return metadata && isSubscriptionMetadataVisible(section, sourceIndex)
      ? [metadata]
      : [];
  });

  return items.length ? items : undefined;
}

function getOutboundMetadata(
  dashboardCache?: DashboardSectionCache,
  providerTags: string[] = [],
  proxies: ClashProxyEntry[] = [],
) {
  const metadata = dashboardCache?.outboundMetadata;
  const names = objectMap(metadata?.names);
  const protocols = objectMap(metadata?.protocols);
  const prefixes = providerTags.map((tag) => `${tag}/`);

  proxies.forEach((proxy) => {
    const prefix = prefixes.find((value) => proxy.code.startsWith(value));
    if (prefix) {
      names[proxy.code] = proxy.code.slice(prefix.length);
    }
  });

  if (!Object.keys(names).length && !Object.keys(protocols).length) {
    return undefined;
  }

  return { names, protocols };
}

export async function getDashboardSections(): Promise<IGetDashboardSectionsResponse> {
  const configSections = hydrateConfigSections(await getConfigSections());
  const hasSubscriptions = configSections.some(hasSubscriptionSources);
  const [clashProxies, clashProviders] = await Promise.all([
    getClashApiProxies(configSections),
    hasSubscriptions
      ? getClashApiProxyProviders(configSections)
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
  const dashboardCaches = new Map<string, DashboardSectionCache | undefined>();

  for (const section of activeSections) {
    if (shouldUseProxyGroup(section)) {
      dashboardCaches.set(
        section['.name'],
        await readDashboardSectionCache(section['.name']),
      );
    }
  }

  const data = activeSections.map((section) => {
    const displayName = getDisplayName(section);
    const sectionName = section['.name'];
    const sectionAction = section.action;
    const proxyConfigType = getSectionProxyConfigType(section);

    if (isConnectionAction(sectionAction) && shouldUseProxyGroup(section)) {
      const subscriptionSourceCount = getSubscriptionSourceCount(section);
      const subscriptionEnabled = subscriptionSourceCount > 0;
      const dashboardCache = dashboardCaches.get(sectionName);
      const providerTags = getSectionProviderTags(dashboardCache);
      const outboundMetadata = getOutboundMetadata(
        dashboardCache,
        providerTags,
        proxies,
      );
      const subscriptionMetadata = subscriptionEnabled
        ? getSubscriptionMetadata(
            section,
            subscriptionSourceCount,
            providerTags,
            providers,
          )
        : undefined;
      const urltestGroups = getUrlTestGroups(dashboardCache);
      const fallbackGroups = getFallbackGroups(dashboardCache);
      const { selector, latencyTestCode, latencyTestCodes, outbounds } =
        buildProxyGroupOutbounds(
          section,
          proxies,
          outboundMetadata,
          urltestGroups,
          fallbackGroups,
          providerTags.slice(0, subscriptionSourceCount),
        );

      return {
        withTagSelect: true,
        code: selector?.code || sectionName,
        sectionName,
        displayName,
        action: sectionAction,
        latencyTestCode,
        latencyTestCodes,
        proxyConfigType,
        subscriptionSourceCount,
        subscriptionMetadata,
        outbounds,
      };
    }

    if (sectionAction === 'vpn') {
      const outboundTag = getOutboundTagBySection(sectionName);
      const outbound = proxies.find((proxy) => proxy.code === outboundTag);

      return {
        withTagSelect: false,
        code: outbound?.code || sectionName,
        sectionName,
        displayName,
        action: sectionAction,
        latencyTestTimeout: '10000',
        outbounds: [
          {
            code: outbound?.code || sectionName,
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
      const outboundTag = getOutboundTagBySection(sectionName);
      const outbound = proxies.find((proxy) => proxy.code === outboundTag);

      return {
        withTagSelect: false,
        code: outbound?.code || sectionName,
        sectionName,
        displayName,
        action: sectionAction,
        outbounds: [
          {
            code: outbound?.code || sectionName,
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
      code: sectionName,
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
