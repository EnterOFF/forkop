import {
  canUseDirectClashApi,
  getClashSocketUrl,
} from '../../../helpers/getClashApiUrl';
import { onMount } from '../../../helpers/onMount';
import { resetClashApiTransport } from '../../methods/custom/getDashboardSections';
import { pollDelayForDuration } from '../../helpers/pollDelay';
import { shouldCopyFullMonitoringValue } from './valueCopy';
import { createPollChain } from '../../helpers/pollChain';
import { isDocumentVisible } from '../../../helpers/isDocumentVisible';
import { prettyBytes } from '../../../helpers/prettyBytes';
import { showToast } from '../../../helpers/showToast';
import { renderSearchIcon24 } from '../../../icons';
import { CustomForkopMethods } from '../../methods';
import { getClashApiSecret } from '../../methods/custom/getClashApiSecret';
import { loadLocalDeviceChoices } from '../../cbi/localDevices';
import { logger, socket, store, StoreType } from '../../services';
import { Forkop } from '../../types';
import { E } from '../../../helpers/element';
import {
  ConnectionListItem,
  renderConnectionList,
  renderConnectionListState,
} from './connectionList';
import { formatEndpoint } from './endpoint';

type MonitoringTabId = 'active' | 'closed';

type LocalDeviceChoices = Record<string, string>;

interface ClashConnectionMetadata {
  destinationIP?: string;
  destinationPort?: string | number;
  host?: string;
  network?: string;
  processPath?: string;
  sourceIP?: string;
  sourcePort?: string | number;
  type?: string;
  user?: string;
}

interface ClashConnection {
  chains?: string[];
  download?: number;
  id?: string;
  metadata?: ClashConnectionMetadata;
  rule?: string;
  rulePayload?: string;
  start?: string;
  upload?: number;
}

interface ClashConnectionsPayload {
  connections?: ClashConnection[];
}

interface MonitoredConnection extends ClashConnection {
  id: string;
  closedAt?: number;
  lastSeenAt: number;
}

function normalizeConnectionsPayload(value: unknown): ClashConnectionsPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as ClashConnectionsPayload;
}

const RENDER_INTERVAL_MS = 500;
const CONNECTIONS_RPC_POLL_INTERVAL_MS = 1500;
const CONNECTIONS_RPC_POLL_BACKOFF_MAX_MS = 30000;
// The floor the poll may be spaced out to when each answer is expensive. A table
// that refreshes this slowly is a poor live view, but it is the honest one for a
// router that cannot answer faster.
const CONNECTIONS_POLL_DUTY_MAX_MS = 15000;
// A socket to a port that silently drops packets neither connects nor fails for
// as long as the browser's own connect timeout runs, and the tab would sit on
// "Loading connections" for all of it. Nothing arriving in this long means the
// poll should cover the wait, whatever the socket ends up doing.
const CONNECTIONS_SOCKET_GRACE_MS = 2000;
const CLOSED_CONNECTION_LIMIT = 300;
const ALL_FILTER_VALUE = 'all';
const SYSTEM_DEVICE_VALUE = '@system';
const SYSTEM_INBOUND_TAGS = new Set(['system-in', 'system6-in']);

let monitoringMounted = false;
let monitoringMountId = 0;
let monitoringLifecycleRegistered = false;
let monitoringControllerInitialized = false;
let renderTimer: ReturnType<typeof setInterval> | null = null;
let connectionsSocketUrl = '';
let connectionsUpdatesId = 0;
let connectionsSocketGraceTimer: ReturnType<typeof setTimeout> | null = null;
let lastConnectionsPollDurationMs = 0;
let renderSkippedForSelection = false;
let pendingConnectionsPayload: ClashConnectionsPayload | null = null;

let activeTab: MonitoringTabId = 'active';
let selectedDeviceFilter = ALL_FILTER_VALUE;
let searchQuery = '';
let localDeviceChoices: LocalDeviceChoices = {};
let routeDisplayNames: Record<string, string> = {};
let routeSections: Array<{ sectionName: string; displayName: string }> = [];
let serverDisplayNames: Record<string, string> = {};
let lastDeviceFilterSignature = '';
let loading = true;
let failed = false;
let closingAll = false;
let monitoringPaused = false;
let monitoringPausedAt: number | null = null;
let consecutivePollFailures = 0;

const activeConnections = new Map<string, MonitoredConnection>();
const closedConnections = new Map<string, MonitoredConnection>();
const closingConnectionIds = new Set<string>();

function normalizeString(value?: string | number | null): string {
  return value == null ? '' : String(value).trim();
}

function getDisplayName(section: Forkop.ConfigSection) {
  return normalizeString(section.label) || section['.name'];
}

function buildRouteDisplayNames(sections: Forkop.ConfigSection[]) {
  const map: Record<string, string> = {
    'direct-out': _('Direct'),
  };
  const serverMap: Record<string, string> = {};
  const routeSectionItems: Array<{ sectionName: string; displayName: string }> =
    [];
  sections
    .filter((section) => section['.type'] === 'section')
    .filter((section) => section.enabled !== '0')
    .forEach((section) => {
      const sectionName = section['.name'];
      const displayName = getDisplayName(section);

      if (!sectionName || !displayName) {
        return;
      }

      routeSectionItems.push({ sectionName: displayName, displayName });
      map[displayName] = displayName;
    });

  sections
    .filter((section) => section['.type'] === 'server')
    .filter((section) => section.enabled !== '0')
    .forEach((section) => {
      const sectionName = section['.name'];
      const displayName = getDisplayName(section);

      if (!sectionName || !displayName) {
        return;
      }

      serverMap[displayName] = displayName;
    });

  routeDisplayNames = map;
  serverDisplayNames = serverMap;
  routeSections = routeSectionItems.sort(
    (a, b) => b.sectionName.length - a.sectionName.length,
  );
}

function getRouteDisplayNameByTag(tag: string): string {
  if (!tag) {
    return '';
  }

  if (routeDisplayNames[tag]) {
    return routeDisplayNames[tag];
  }

  const manualSection = routeSections.find(({ sectionName }) =>
    tag.startsWith(`${sectionName}/`),
  );

  return manualSection?.displayName || '';
}

function getRouteTagFromRule(rule?: string): string {
  const match = normalizeString(rule).match(/=>\s*route\(([^)]+)\)/);
  return normalizeString(match?.[1]).replace(/^['"]|['"]$/g, '');
}

function parseStartedAt(connection: MonitoredConnection): number {
  const startedAt = Date.parse(connection.start || '');
  return Number.isFinite(startedAt) ? startedAt : connection.lastSeenAt;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }

  return `${minutes}:${pad(seconds)}`;
}

function formatConnectionDuration(connection: MonitoredConnection): string {
  const startedAt = parseStartedAt(connection);
  const finishedAt = connection.closedAt || monitoringPausedAt || Date.now();

  return formatDuration(finishedAt - startedAt);
}

function formatBytes(value?: number): string {
  return prettyBytes(Number.isFinite(value) ? Number(value) : 0);
}

function getConnectionSourceIp(connection: ClashConnection): string {
  return normalizeString(connection.metadata?.sourceIP);
}

function getConnectionInboundTag(connection: ClashConnection): string {
  const metadataType = normalizeString(connection.metadata?.type);
  const metadataTypeParts = metadataType.split('/');
  const metadataTag = normalizeString(
    metadataTypeParts.length > 1
      ? metadataTypeParts[metadataTypeParts.length - 1]
      : metadataType,
  );

  if (metadataTag) {
    return metadataTag;
  }

  const ruleInbound = normalizeString(connection.rule).match(
    /(?:^|\s)inbound=([^\s]+)/,
  );

  return normalizeString(ruleInbound?.[1]);
}

function isSystemConnection(connection: ClashConnection): boolean {
  return SYSTEM_INBOUND_TAGS.has(getConnectionInboundTag(connection));
}

function getConnectionSourceFilterValue(connection: ClashConnection): string {
  return isSystemConnection(connection)
    ? SYSTEM_DEVICE_VALUE
    : getConnectionSourceIp(connection);
}

function getServerDisplayNameByInboundTag(tag: string): string {
  return normalizeString(serverDisplayNames[tag]);
}

function getDeviceName(ip: string): string {
  return normalizeString(localDeviceChoices[ip]);
}

function getServerSourceNameByIp(ip: string): string {
  if (!ip) {
    return '';
  }

  const connections = [
    ...Array.from(activeConnections.values()),
    ...Array.from(closedConnections.values()),
  ];

  for (const connection of connections) {
    if (getConnectionSourceIp(connection) !== ip) {
      continue;
    }

    const serverName = getServerDisplayNameByInboundTag(
      getConnectionInboundTag(connection),
    );

    if (serverName) {
      return serverName;
    }
  }

  return '';
}

function getDeviceFilterLabel(ip: string): string {
  if (ip === SYSTEM_DEVICE_VALUE) {
    return _('System');
  }

  const serverName = getServerSourceNameByIp(ip);
  if (serverName) {
    return serverName;
  }

  const deviceName = getDeviceName(ip);
  return deviceName || ip;
}

function getSourceCellParts(connection: MonitoredConnection) {
  const ip = getConnectionSourceIp(connection);
  const inboundTag = getConnectionInboundTag(connection);
  if (isSystemConnection(connection)) {
    return {
      primary: _('System'),
      copyValue: _('System'),
      searchValue: [_('System'), ip, inboundTag].filter(Boolean).join(' '),
    };
  }
  const serverName = getServerDisplayNameByInboundTag(inboundTag);

  if (serverName) {
    // An inbound with several accounts reports the one that authenticated, and
    // without it the rows of one server cannot be told apart.
    const client = normalizeString(connection.metadata?.user);
    const primary = client ? `${serverName} (${client})` : serverName;

    return {
      primary,
      copyValue: primary,
      searchValue: [primary, ip, inboundTag].filter(Boolean).join(' '),
    };
  }

  const deviceName = getDeviceName(ip);

  if (deviceName) {
    return {
      primary: deviceName,
      copyValue: deviceName,
      searchValue: `${deviceName} ${ip}`,
    };
  }

  return {
    primary: ip || '-',
    copyValue: ip || '-',
    searchValue: ip,
  };
}

function getTargetCellParts(connection: MonitoredConnection): {
  primary: string;
  searchValue: string;
} {
  const metadata = connection.metadata || {};
  const host = normalizeString(metadata.host);
  const destinationIp = normalizeString(metadata.destinationIP);
  const port = metadata.destinationPort;
  const primaryTarget = host || destinationIp;
  const primary = primaryTarget ? formatEndpoint(primaryTarget, port) : '-';

  return {
    primary,
    searchValue: [primary, host, destinationIp].filter(Boolean).join(' '),
  };
}

function getRoute(connection: MonitoredConnection): string {
  const chains = Array.isArray(connection.chains) ? connection.chains : [];
  const routeTag = [...chains].reverse().find(getRouteDisplayNameByTag);
  const fallbackRouteTag = getRouteTagFromRule(connection.rule);

  return (
    getRouteDisplayNameByTag(routeTag || '') ||
    getRouteDisplayNameByTag(fallbackRouteTag) ||
    normalizeString(routeTag) ||
    normalizeString(fallbackRouteTag) ||
    '-'
  );
}

function getNetwork(connection: MonitoredConnection): string {
  return normalizeString(connection.metadata?.network).toLowerCase() || '-';
}

function sortConnections(
  connections: MonitoredConnection[],
  tab: MonitoringTabId,
): MonitoredConnection[] {
  return [...connections].sort((a, b) => {
    if (tab === 'closed') {
      return (b.closedAt || 0) - (a.closedAt || 0);
    }

    return parseStartedAt(b) - parseStartedAt(a);
  });
}

function getConnectionsForActiveTab(): MonitoredConnection[] {
  const source =
    activeTab === 'active'
      ? Array.from(activeConnections.values())
      : Array.from(closedConnections.values());

  return sortConnections(source, activeTab);
}

function normalizeSearchValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function getSearchValues(connection: MonitoredConnection): string[] {
  const target = getTargetCellParts(connection);
  const source = getSourceCellParts(connection);

  return [
    connection.id,
    target.primary,
    getNetwork(connection),
    getRoute(connection),
    formatConnectionDuration(connection),
    formatBytes(connection.download),
    formatBytes(connection.upload),
    source.primary,
    source.copyValue,
    source.searchValue,
  ].filter(Boolean);
}

function matchesConnectionFilters(
  connection: MonitoredConnection,
  normalizedSearch: string,
): boolean {
  const sourceIp = getConnectionSourceFilterValue(connection);
  if (
    selectedDeviceFilter !== ALL_FILTER_VALUE &&
    sourceIp !== selectedDeviceFilter
  ) {
    return false;
  }

  if (!normalizedSearch) {
    return true;
  }

  return getSearchValues(connection).some((value) =>
    normalizeSearchValue(value).includes(normalizedSearch),
  );
}

function getVisibleConnections(): MonitoredConnection[] {
  const normalizedSearch = normalizeSearchValue(searchQuery);

  return getConnectionsForActiveTab().filter((connection) =>
    matchesConnectionFilters(connection, normalizedSearch),
  );
}

function countFilteredConnections(
  connections: Map<string, MonitoredConnection>,
): number {
  const normalizedSearch = normalizeSearchValue(searchQuery);
  let count = 0;

  connections.forEach((connection) => {
    if (matchesConnectionFilters(connection, normalizedSearch)) {
      count += 1;
    }
  });

  return count;
}

function moveConnectionToClosed(connection: MonitoredConnection, now: number) {
  closedConnections.set(connection.id, {
    ...connection,
    closedAt: now,
    lastSeenAt: now,
  });
}

function trimClosedConnections() {
  const sorted = sortConnections(
    Array.from(closedConnections.values()),
    'closed',
  );

  sorted.slice(CLOSED_CONNECTION_LIMIT).forEach((connection) => {
    closedConnections.delete(connection.id);
  });
}

function applyConnectionsPayload(payload: ClashConnectionsPayload) {
  if (monitoringPaused) {
    pendingConnectionsPayload = payload;
    return;
  }

  const mountId = monitoringMountId;
  const now = Date.now();
  const incomingIds = new Set<string>();
  const rawConnections = Array.isArray(payload.connections)
    ? payload.connections
    : [];

  rawConnections.forEach((rawConnection) => {
    const id = normalizeString(rawConnection.id);
    if (!id) {
      return;
    }

    incomingIds.add(id);
    closedConnections.delete(id);
    activeConnections.set(id, {
      ...rawConnection,
      id,
      lastSeenAt: now,
    });
  });

  Array.from(activeConnections.entries()).forEach(([id, connection]) => {
    if (!incomingIds.has(id)) {
      activeConnections.delete(id);
      moveConnectionToClosed(connection, now);
    }
  });

  trimClosedConnections();
  loading = false;
  failed = false;

  if (monitoringMounted && mountId === monitoringMountId) {
    renderControls();
    renderConnections();
  }
}

function setTab(tab: MonitoringTabId) {
  if (activeTab === tab) {
    return;
  }

  activeTab = tab;
  renderControls();
  renderConnections();
}

function getKnownSourceIps(): string[] {
  const ips = new Set<string>();

  activeConnections.forEach((connection) => {
    const ip = getConnectionSourceFilterValue(connection);
    if (ip) {
      ips.add(ip);
    }
  });

  closedConnections.forEach((connection) => {
    const ip = getConnectionSourceFilterValue(connection);
    if (ip) {
      ips.add(ip);
    }
  });

  return Array.from(ips).sort((a, b) => {
    const byLabel = getDeviceFilterLabel(a).localeCompare(
      getDeviceFilterLabel(b),
    );
    return byLabel || a.localeCompare(b);
  });
}

function renderDeviceFilterOptions() {
  const select = document.getElementById(
    'monitoring-device-filter',
  ) as HTMLSelectElement | null;

  if (!select) {
    return;
  }

  const sourceIps = getKnownSourceIps();
  if (
    selectedDeviceFilter !== ALL_FILTER_VALUE &&
    !sourceIps.includes(selectedDeviceFilter)
  ) {
    selectedDeviceFilter = ALL_FILTER_VALUE;
  }

  const signature = [
    selectedDeviceFilter,
    ...sourceIps.map((ip) => `${ip}:${getDeviceFilterLabel(ip)}`),
  ].join('|');
  if (signature === lastDeviceFilterSignature) {
    select.value = selectedDeviceFilter;
    return;
  }

  lastDeviceFilterSignature = signature;

  const options = [
    E('option', { value: ALL_FILTER_VALUE }, _('All devices')),
    ...sourceIps.map((ip) =>
      E('option', { value: ip }, getDeviceFilterLabel(ip)),
    ),
  ];

  select.replaceChildren(...options);
  select.value = selectedDeviceFilter;
}

function setButtonActive(button: HTMLElement | null, active: boolean) {
  if (!button) {
    return;
  }

  button.classList.toggle('fkp_monitoring-page__tab--active', active);
}

function renderTabButtonContent(label: string, count: number) {
  return [
    E('span', { class: 'fkp_monitoring-page__tab-label' }, label),
    E('span', { class: 'fkp_monitoring-page__tab-badge' }, String(count)),
  ];
}

function renderControls() {
  const activeButton = document.getElementById(
    'monitoring-tab-active',
  ) as HTMLButtonElement | null;
  const closedButton = document.getElementById(
    'monitoring-tab-closed',
  ) as HTMLButtonElement | null;
  const closeAllButton = document.getElementById(
    'monitoring-close-all',
  ) as HTMLButtonElement | null;
  const autoRefreshInput = document.getElementById(
    'monitoring-auto-refresh',
  ) as HTMLInputElement | null;

  if (activeButton) {
    activeButton.replaceChildren(
      ...renderTabButtonContent(
        _('Active'),
        countFilteredConnections(activeConnections),
      ),
    );
  }

  if (closedButton) {
    closedButton.replaceChildren(
      ...renderTabButtonContent(
        _('Closed'),
        countFilteredConnections(closedConnections),
      ),
    );
  }

  setButtonActive(activeButton, activeTab === 'active');
  setButtonActive(closedButton, activeTab === 'closed');

  if (closeAllButton) {
    closeAllButton.disabled = activeConnections.size === 0 || closingAll;
  }

  if (autoRefreshInput) {
    autoRefreshInput.checked = !monitoringPaused;
  }

  const searchIcon = document.querySelector(
    '.fkp_monitoring-page__search-icon',
  );
  if (searchIcon && searchIcon.childNodes.length === 0) {
    searchIcon.replaceChildren(renderSearchIcon24());
  }

  renderDeviceFilterOptions();
}

function toListItem(connection: MonitoredConnection): ConnectionListItem {
  const source = getSourceCellParts(connection);

  return {
    id: connection.id,
    host: getTargetCellParts(connection).primary,
    source: source.primary,
    sourceCopyValue: source.copyValue,
    route: getRoute(connection),
    network: getNetwork(connection),
    time: formatConnectionDuration(connection),
    download: formatBytes(connection.download),
    upload: formatBytes(connection.upload),
    closing: closingConnectionIds.has(connection.id),
  };
}

function isNodeInsideMonitoring(node: Node | null): boolean {
  const root = document.getElementById('monitoring-status');
  return Boolean(root && node && root.contains(node));
}

function isTextSelectionInsideMonitoring(): boolean {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed) {
    return false;
  }

  return (
    isNodeInsideMonitoring(selection.anchorNode) ||
    isNodeInsideMonitoring(selection.focusNode)
  );
}

function renderConnections(options: { force?: boolean } = {}) {
  const container = document.getElementById('monitoring-connections');
  if (!container) {
    return;
  }

  if (!options.force && isTextSelectionInsideMonitoring()) {
    renderSkippedForSelection = true;
    return;
  }

  renderSkippedForSelection = false;

  if (loading) {
    container.replaceChildren(
      renderConnectionListState(
        _('Loading connections'),
        'fkp_monitoring-page__state--loading',
      ),
    );
    return;
  }

  if (failed) {
    container.replaceChildren(
      renderConnectionListState(
        _('Connections are unavailable'),
        'fkp_monitoring-page__state--error',
      ),
    );
    return;
  }

  const visibleConnections = getVisibleConnections();

  if (visibleConnections.length === 0) {
    container.replaceChildren(
      renderConnectionListState(
        activeTab === 'active'
          ? _('No active connections')
          : _('No closed connections'),
      ),
    );
    return;
  }

  container.replaceChildren(
    renderConnectionList(visibleConnections.map(toListItem), {
      closable: activeTab === 'active',
    }),
  );
}

function flushRenderAfterSelection() {
  if (!renderSkippedForSelection || isTextSelectionInsideMonitoring()) {
    return;
  }

  renderConnections({ force: true });
}

function setMonitoringPaused(paused: boolean) {
  if (monitoringPaused === paused) {
    return;
  }

  monitoringPaused = paused;
  monitoringPausedAt = paused ? Date.now() : null;
  renderSkippedForSelection = false;
  renderControls();

  if (!paused) {
    const payload = pendingConnectionsPayload;
    pendingConnectionsPayload = null;

    if (payload) {
      applyConnectionsPayload(payload);
      return;
    }

    if (connectionsPoll.active) {
      connectionsPoll.now();
    }
  }

  renderConnections();
}

function getSelectionValueElements(selection: Selection): HTMLElement[] {
  const root = document.getElementById('monitoring-status');
  if (!root) {
    return [];
  }

  return Array.from(
    root.querySelectorAll<HTMLElement>(
      '.fkp_monitoring-page__value[data-copy-value]',
    ),
  ).filter((element) => {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      try {
        if (selection.getRangeAt(index).intersectsNode(element)) {
          return true;
        }
      } catch (_error) {
        return false;
      }
    }

    return false;
  });
}

function handleMonitoringValueCopy(event: ClipboardEvent) {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed) {
    return;
  }

  const valueElements = getSelectionValueElements(selection);
  if (valueElements.length !== 1) {
    return;
  }

  const valueElement = valueElements[0];
  const fullText =
    valueElement.getAttribute('data-copy-value') ||
    valueElement.textContent ||
    '';
  const selectedText = selection.toString();

  if (!shouldCopyFullMonitoringValue(valueElement, selectedText, fullText)) {
    return;
  }

  event.clipboardData?.setData('text/plain', fullText);
  event.preventDefault();
}

async function closeConnection(connectionId: string) {
  if (!connectionId || closingConnectionIds.has(connectionId)) {
    return;
  }

  closingConnectionIds.add(connectionId);
  renderConnections();

  try {
    const response =
      await CustomForkopMethods.closeClashApiConnection(connectionId);

    if (!response.success) {
      showToast(_('Failed to close connection'), 'error');
      return;
    }

    const now = Date.now();
    const connection = activeConnections.get(connectionId);
    if (connection) {
      activeConnections.delete(connectionId);
      moveConnectionToClosed(connection, now);
      trimClosedConnections();
      pendingConnectionsPayload = null;
      renderControls();
    }
  } catch (error) {
    logger.error('[MONITORING]', 'closeConnection: failed', error);
    showToast(_('Failed to close connection'), 'error');
  } finally {
    closingConnectionIds.delete(connectionId);
    renderConnections();
  }
}

async function closeAllConnections() {
  if (activeConnections.size === 0 || closingAll) {
    return;
  }

  closingAll = true;
  renderControls();

  try {
    const response = await CustomForkopMethods.closeAllClashApiConnections();

    if (!response.success) {
      showToast(_('Failed to close connections'), 'error');
      return;
    }

    const now = Date.now();
    activeConnections.forEach((connection) => {
      moveConnectionToClosed(connection, now);
    });
    activeConnections.clear();
    pendingConnectionsPayload = null;
    trimClosedConnections();
  } catch (error) {
    logger.error('[MONITORING]', 'closeAllConnections: failed', error);
    showToast(_('Failed to close connections'), 'error');
  } finally {
    closingAll = false;
    renderControls();
    renderConnections();
  }
}

function bindControls() {
  const activeButton = document.getElementById('monitoring-tab-active');
  const closedButton = document.getElementById('monitoring-tab-closed');
  const select = document.getElementById(
    'monitoring-device-filter',
  ) as HTMLSelectElement | null;
  const searchInput = document.getElementById(
    'monitoring-search',
  ) as HTMLInputElement | null;
  const closeAllButton = document.getElementById('monitoring-close-all');
  const autoRefreshInput = document.getElementById(
    'monitoring-auto-refresh',
  ) as HTMLInputElement | null;
  const connectionsContainer = document.getElementById(
    'monitoring-connections',
  );

  if (activeButton) {
    activeButton.onclick = () => setTab('active');
  }

  if (closedButton) {
    closedButton.onclick = () => setTab('closed');
  }

  if (closeAllButton) {
    closeAllButton.onclick = () => {
      void closeAllConnections();
    };
  }

  if (autoRefreshInput) {
    autoRefreshInput.onchange = () => {
      setMonitoringPaused(!autoRefreshInput.checked);
    };
  }

  if (select) {
    select.onchange = () => {
      selectedDeviceFilter = select.value || ALL_FILTER_VALUE;
      renderControls();
      renderConnections();
    };
  }

  if (searchInput) {
    searchInput.oninput = () => {
      searchQuery = searchInput.value;
      renderControls();
      renderConnections();
    };
  }

  if (connectionsContainer) {
    connectionsContainer.onclick = (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest(
        '.fkp_monitoring-page__row-action',
      ) as HTMLButtonElement | null;

      if (button?.value) {
        void closeConnection(button.value);
      }
    };
  }
}

async function loadLocalDevices() {
  try {
    localDeviceChoices = (await loadLocalDeviceChoices()) || {};
  } catch (error) {
    logger.warn('[MONITORING]', 'loadLocalDevices: failed', error);
    localDeviceChoices = {};
  } finally {
    renderControls();
    renderConnections();
  }
}

async function loadRouteDisplayNames() {
  try {
    buildRouteDisplayNames(await CustomForkopMethods.getConfigSections());
  } catch (error) {
    logger.warn('[MONITORING]', 'loadRouteDisplayNames: failed', error);
    buildRouteDisplayNames([]);
  } finally {
    renderControls();
    renderConnections();
  }
}

function reportPollFailure() {
  consecutivePollFailures += 1;
  failed = true;
  loading = false;
  renderConnections();
}

async function pollConnectionsSnapshot() {
  if (!monitoringMounted || monitoringPaused) {
    return;
  }

  const mountId = monitoringMountId;
  const startedAt = Date.now();

  try {
    const response = await CustomForkopMethods.getClashApiConnections();

    lastConnectionsPollDurationMs = Date.now() - startedAt;

    if (
      !monitoringMounted ||
      mountId !== monitoringMountId ||
      !connectionsPoll.active
    ) {
      return;
    }

    if (!response.success) {
      reportPollFailure();
      return;
    }

    consecutivePollFailures = 0;
    applyConnectionsPayload(normalizeConnectionsPayload(response.data));
  } catch (error) {
    if (
      !monitoringMounted ||
      mountId !== monitoringMountId ||
      !connectionsPoll.active
    ) {
      return;
    }

    logger.error('[MONITORING]', 'connections polling failed', error);
    reportPollFailure();
  }
}

// A stopped core answers nothing for as long as the tab stays open, so the poll
// slows down while it keeps failing instead of asking every second and a half
// forever. The first answer puts it back to the interval its own cost allows.
function connectionsPollDelay() {
  if (consecutivePollFailures > 0) {
    return Math.min(
      CONNECTIONS_RPC_POLL_INTERVAL_MS * 2 ** consecutivePollFailures,
      CONNECTIONS_RPC_POLL_BACKOFF_MAX_MS,
    );
  }

  return pollDelayForDuration(
    CONNECTIONS_RPC_POLL_INTERVAL_MS,
    lastConnectionsPollDurationMs,
    CONNECTIONS_POLL_DUTY_MAX_MS,
  );
}

const connectionsPoll = createPollChain(
  pollConnectionsSnapshot,
  connectionsPollDelay,
);

function startConnectionsPolling() {
  connectionsPoll.start(0);
}

function stopConnectionsPolling() {
  connectionsPoll.stop();
  consecutivePollFailures = 0;

  if (connectionsSocketGraceTimer) {
    clearTimeout(connectionsSocketGraceTimer);
    connectionsSocketGraceTimer = null;
  }
}

async function connectToConnectionsSocket(updatesId: number) {
  const mountId = monitoringMountId;
  // Without the secret the socket is refused, and the poll covers for it.
  const clashApiSecret = await getClashApiSecret().catch(() => '');

  if (
    !monitoringMounted ||
    mountId !== monitoringMountId ||
    updatesId !== connectionsUpdatesId
  ) {
    return;
  }

  connectionsSocketUrl = getClashSocketUrl('/connections', clashApiSecret);

  socket.subscribe(
    connectionsSocketUrl,
    (msg) => {
      if (updatesId !== connectionsUpdatesId) {
        return;
      }

      // The socket is delivering again, so the poll that covered for it stops.
      stopConnectionsPolling();

      try {
        applyConnectionsPayload(JSON.parse(msg) as ClashConnectionsPayload);
      } catch (error) {
        logger.error('[MONITORING]', 'connections socket parse failed', error);
      }
    },
    (_err) => {
      if (
        !monitoringMounted ||
        mountId !== monitoringMountId ||
        updatesId !== connectionsUpdatesId
      ) {
        return;
      }

      // The socket manager retries on its own with a growing delay, so the
      // poll only covers the gap until one of those attempts connects. Dropping
      // the subscription here would pin the tab to the slow transport for as
      // long as it stays open, and a core that restarts closes this socket
      // every time. What the table already shows stays on screen: a reconnect
      // is not a reason to empty it.
      startConnectionsPolling();
    },
  );
}

function startConnectionsUpdates() {
  if (canUseDirectClashApi()) {
    const updatesId = ++connectionsUpdatesId;
    void connectToConnectionsSocket(updatesId);
    connectionsSocketGraceTimer = setTimeout(() => {
      connectionsSocketGraceTimer = null;
      startConnectionsPolling();
    }, CONNECTIONS_SOCKET_GRACE_MS);
    return;
  }

  startConnectionsPolling();
}

function stopConnectionsUpdates() {
  connectionsUpdatesId += 1;
  stopConnectionsPolling();

  if (connectionsSocketUrl) {
    socket.disconnect(connectionsSocketUrl);
    connectionsSocketUrl = '';
  }
}

function resetMonitoringState() {
  activeTab = 'active';
  selectedDeviceFilter = ALL_FILTER_VALUE;
  searchQuery = '';
  lastDeviceFilterSignature = '';
  loading = true;
  failed = false;
  closingAll = false;
  monitoringPaused = false;
  monitoringPausedAt = null;
  consecutivePollFailures = 0;
  lastConnectionsPollDurationMs = 0;
  pendingConnectionsPayload = null;
  activeConnections.clear();
  closedConnections.clear();
  closingConnectionIds.clear();

  const searchInput = document.getElementById(
    'monitoring-search',
  ) as HTMLInputElement | null;
  if (searchInput) {
    searchInput.value = '';
  }
}

// The connections come from the Clash API, so the tab asks it directly instead of
// asking first whether the core is running: an answer is the only thing that says
// there is something to show.
function onPageMount() {
  onPageUnmount();

  monitoringMounted = true;
  monitoringMountId += 1;

  resetClashApiTransport();
  resetMonitoringState();
  bindControls();
  renderControls();
  renderConnections();
  startConnectionsUpdates();

  void loadLocalDevices();
  void loadRouteDisplayNames();

  document.addEventListener('selectionchange', flushRenderAfterSelection);
  document.addEventListener('copy', handleMonitoringValueCopy);

  renderTimer = setInterval(() => {
    if (monitoringPaused || !isDocumentVisible()) {
      return;
    }

    renderConnections();
  }, RENDER_INTERVAL_MS);
}

function onPageUnmount() {
  monitoringMounted = false;
  monitoringMountId += 1;

  if (renderTimer) {
    clearInterval(renderTimer);
    renderTimer = null;
  }

  stopConnectionsUpdates();

  document.removeEventListener('selectionchange', flushRenderAfterSelection);
  document.removeEventListener('copy', handleMonitoringValueCopy);
}

function registerLifecycleListeners() {
  if (monitoringLifecycleRegistered) {
    return;
  }

  monitoringLifecycleRegistered = true;

  store.subscribe(
    (next: StoreType, prev: StoreType, diff: Partial<StoreType>) => {
      if (
        diff.tabService &&
        next.tabService.current !== prev.tabService.current
      ) {
        const isMonitoringVisible = next.tabService.current === 'monitoring';

        if (isMonitoringVisible) {
          return onPageMount();
        }

        if (!isMonitoringVisible) {
          return onPageUnmount();
        }
      }
    },
  );
}

export async function initController(): Promise<void> {
  if (monitoringControllerInitialized) {
    return;
  }

  monitoringControllerInitialized = true;

  onMount('monitoring-status').then(() => {
    registerLifecycleListeners();

    if (store.get().tabService.current === 'monitoring') {
      onPageMount();
    }
  });
}
