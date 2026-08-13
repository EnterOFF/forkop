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
  maxFailedTimes: number;
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

const CLASH_API_FETCH_TIMEOUT_MS = 5000;
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
          max_failed_times: item.max_failed_times,
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
      checkInterval: itemSettingString(
        settings,
        'urltest_check_interval',
        '3m',
      ),
      tolerance: itemSettingNumber(settings, 'urltest_tolerance', 50),
      idleTimeout: itemSettingString(settings, 'idle_timeout', '30m'),
      interruptExistConnections: itemSettingBoolean(
        settings,
        'interrupt_exist_connections',
        true,
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
      maxFailedTimes: itemSettingNumber(settings, 'max_failed_times', 5),
      expectedStatus: itemSettingString(settings, 'expected_status', '*'),
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
  const configuredLevels = config.levels;
  const runtimeGroups = Array.isArray(entry?.value.groups)
    ? entry.value.groups
    : [];
  const levels = (
    runtimeGroups.length
      ? runtimeGroups.map((runtimeGroup, index): FallbackLevelConfig => {
          const metadata = configuredLevels[index];
          return {
            id: metadata?.id || `level-${index + 1}`,
            displayName: metadata?.displayName || `${index + 1}`,
            order:
              typeof metadata?.order === 'number' &&
              Number.isFinite(metadata.order)
                ? metadata.order
                : index,
            outbounds: uniqueCodes(runtimeGroup.outbounds || []),
          };
        })
      : configuredLevels.map((level, index) => {
          const id = `${level.id || `level-${index + 1}`}`;

          return {
            id,
            displayName: level.displayName || `${index + 1}`,
            order:
              typeof level.order === 'number' && Number.isFinite(level.order)
                ? level.order
                : index,
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
    maxFailedTimes: config.maxFailedTimes,
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
  const bindRuntimeCodes = <T extends { code: string }>(
    configs: T[],
    type: string,
  ) => {
    const candidates = selectorCodes.filter(
      (code) => proxyByCode.get(code)?.value.type.toLowerCase() === type,
    );
    const remaining = new Set(candidates);
    return configs.map((config) => {
      const code =
        candidates.find(
          (candidate) =>
            remaining.has(candidate) &&
            (candidate === config.code ||
              candidate.startsWith(`${config.code} #`)),
        ) || candidates.find((candidate) => remaining.has(candidate));
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

    const levels = entry?.value.groups?.length
      ? entry.value.groups
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
      const hasLiveGroupMember = !groupInfo || groupInfo.outbounds.length > 0;

      return [
        {
          code,
          displayName,
          subscriptionTag:
            fallbackConfig || urlTestConfig
              ? undefined
              : presentation.subscriptionTag,
          latency:
            selectedGroupMember?.latency ||
            item?.value.history?.[0]?.delay ||
            0,
          type: fallbackConfig
            ? 'Fallback'
            : getOutboundDisplayType(item) || 'URLTest',
          selected: selector?.value?.now === code,
          link,
          canCopyLink,
          runtimeAvailable: item && hasLiveGroupMember ? undefined : false,
          urlTestInfo,
          fallbackInfo,
        },
      ];
    });

  const latencyTestCodes = outbounds
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
            subscriptionTags.map((item) => item.runtimeTag),
            providers,
          )
        : undefined;
      const { selector, latencyTestCode, latencyTestCodes, outbounds } =
        buildProxyGroupOutbounds(section, proxies, subscriptionTags);

      return {
        withTagSelect: true,
        code: selector?.code || displayName,
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
