import { latencyClassName } from './latencyClassName';
import {
  canUseDirectClashApi,
  getClashWsUrl,
  onMount,
  preserveScrollForPage,
} from '../../../helpers';
import { copyToClipboard } from '../../../helpers/copyToClipboard';
import { showToast } from '../../../helpers/showToast';
import { prettyBytes } from '../../../helpers/prettyBytes';
import { renderCopyIcon24, renderPinIcon24 } from '../../../icons';
import { CustomForkopMethods } from '../../methods';
import {
  logger,
  setLocalSubscriptionAction,
  socket,
  store,
  StoreType,
} from '../../services';
import {
  renderFlagEmojis,
  renderSections,
  renderSectionsPlaceholder,
  renderWidget,
} from './partials';
import { getClashApiSecret } from '../../methods/custom/getClashApiSecret';
import { resetClashApiTransport } from '../../methods/custom/getDashboardSections';
import { Forkop } from '../../types';
import { refreshRuntimeUiState } from '../../services/runtimeUiState.service';
import { isActiveLuciTab } from '../../helpers/isActiveLuciTab';
import { pollDelayForDuration } from '../../helpers/pollDelay';
import { getServiceStatusDisplay } from '../../helpers/serviceStatusDisplay';
import { resolveOutboundProxyLink } from './resolveOutboundProxyLink';

const SECTIONS_REFRESH_INTERVAL_MS = 10000;
// A core that is down answers nothing for as long as the tab stays open, and a
// controller that hangs rather than refuses costs the connect timeout of every
// attempt. The refresh backs off while it keeps failing, like the widgets and
// the connections table already do.
const SECTIONS_REFRESH_BACKOFF_MAX_MS = 60000;
const SECTIONS_REFRESH_DUTY_MAX_MS = 30000;
// The three Clash API widgets are pushed by websockets whenever the browser can
// open them. When it cannot - an HTTPS page, a controller the browser does not
// reach - the same numbers are polled out of the /connections snapshot the CLI
// transport can fetch. That snapshot is the whole connection list, so it is
// asked for less often than the live socket would have sent it.
const WIDGETS_POLL_INTERVAL_MS = 5000;
const WIDGETS_POLL_BACKOFF_MAX_MS = 30000;
// A connection snapshot the widgets read four numbers out of is not worth
// crowding the router for, so an expensive one spaces the poll out further.
const WIDGETS_POLL_DUTY_MAX_MS = 20000;
// A socket to a port that silently drops packets neither connects nor fails for
// as long as the browser's own connect timeout runs. Nothing arriving in this
// long means the poll should fill the widgets rather than wait it out.
const WIDGETS_SOCKET_GRACE_MS = 2000;
let sectionsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let sectionsRefreshFailures = 0;
let lastSectionsRefreshDurationMs = 0;
let sectionsRefreshPromise: Promise<boolean> | null = null;
let sectionsRefreshQueued = false;
let dashboardMounted = false;
let dashboardMountId = 0;
let dashboardDataUpdatesStarted = false;
let dashboardDataUpdatesId = 0;
let widgetsPollTimer: ReturnType<typeof setTimeout> | null = null;
let widgetsPolling = false;
let widgetsPollFailures = 0;
let widgetsSocketGraceTimer: ReturnType<typeof setTimeout> | null = null;
let lastWidgetsPollDurationMs = 0;
let trafficSocketLive = false;
let connectionsSocketLive = false;
let lastPolledTotals: { at: number; up: number; down: number } | null = null;
let pageUnloading = false;
const latencyRequests = new Set<string>();
const latencySortedSections = new Set<string>();
const selectorRequests = new Set<string>();
const fallbackPinRequests = new Set<string>();
let activeFallbackModal: {
  code: string;
  container: HTMLElement;
  unsubscribe: () => void;
} | null = null;

function sectionLatencyRequestKey(sectionName: string) {
  return `section:${sectionName}`;
}

function outboundLatencyRequestKey(sectionName: string, tag: string) {
  return `outbound:${sectionName}:${tag}`;
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    pageUnloading = true;
  });
  window.addEventListener('pageshow', () => {
    pageUnloading = false;
  });
}

// Fetchers

async function fetchDashboardSectionsOnce(mountId: number) {
  const prev = store.get().sectionsWidget;
  const hasRenderedData = prev.data.length > 0;

  store.set({
    sectionsWidget: {
      ...prev,
      failed: false,
      loading: prev.loading && !hasRenderedData,
    },
  });

  try {
    const { data, success } = await CustomForkopMethods.getDashboardSections();

    if (!dashboardMounted || mountId !== dashboardMountId) {
      return false;
    }

    if (!success) {
      throw new Error('failed to fetch dashboard sections');
    }

    const current = store.get().sectionsWidget;

    store.set({
      sectionsWidget: {
        ...current,
        loading: false,
        failed: false,
        data,
      },
    });

    return true;
  } catch (error) {
    logger.error('[DASHBOARD]', 'fetchDashboardSections: failed', error);

    if (!dashboardMounted || mountId !== dashboardMountId) {
      return false;
    }

    const current = store.get().sectionsWidget;

    store.set({
      sectionsWidget: {
        ...current,
        loading: false,
        failed: current.data.length === 0,
        data: current.data,
      },
    });

    return false;
  }
}

async function fetchDashboardSections(options: { force?: boolean } = {}) {
  if (sectionsRefreshPromise) {
    if (options.force) {
      sectionsRefreshQueued = true;
    }

    return sectionsRefreshPromise;
  }

  const mountId = dashboardMountId;
  const promise = (async () => {
    let success = false;

    do {
      sectionsRefreshQueued = false;
      success = await fetchDashboardSectionsOnce(mountId);
    } while (
      sectionsRefreshQueued &&
      dashboardMounted &&
      mountId === dashboardMountId
    );

    return success;
  })();

  sectionsRefreshPromise = promise;

  try {
    return await promise;
  } finally {
    if (sectionsRefreshPromise === promise) {
      sectionsRefreshPromise = null;
    }
  }
}

function setSubscriptionUpdating(
  sectionName: string,
  updating: boolean,
  local = false,
) {
  if (local || !updating) {
    setLocalSubscriptionAction(sectionName, updating && local);
  }

  const sectionsWidget = store.get().sectionsWidget;
  const subscriptionUpdatingSections = {
    ...sectionsWidget.subscriptionUpdatingSections,
  };

  if (updating) {
    subscriptionUpdatingSections[sectionName] = true;
  } else {
    delete subscriptionUpdatingSections[sectionName];
  }

  store.set({
    sectionsWidget: {
      ...sectionsWidget,
      subscriptionUpdatingSections,
    },
  });
}

function handleSortByLatency(sectionName: string, enabled: boolean) {
  if (enabled) {
    latencySortedSections.add(sectionName);
  } else {
    latencySortedSections.delete(sectionName);
  }

  void renderSectionsWidget();
}

function widgetsAreLive() {
  return trafficSocketLive && connectionsSocketLive;
}

// The traffic socket reports bytes per second; the snapshot carries only the
// totals, so the rate is what they gained between two polls. A core that
// restarted answers with counters that started over, which is a drop and not a
// rate, and the first poll of a session has nothing to compare against at all.
function polledBandwidth(uploadTotal: number, downloadTotal: number) {
  const at = Date.now();
  const previous = lastPolledTotals;

  lastPolledTotals = { at, up: uploadTotal, down: downloadTotal };

  if (!previous || at <= previous.at) {
    return null;
  }

  const seconds = (at - previous.at) / 1000;

  // Whole bytes per second, like the socket sends: prettyBytes prints anything
  // under a kilobyte verbatim, and a raw quotient would arrive with a tail of
  // decimals behind it.
  return {
    up: Math.round(Math.max(0, uploadTotal - previous.up) / seconds),
    down: Math.round(Math.max(0, downloadTotal - previous.down) / seconds),
  };
}

// A widget whose socket is delivering keeps what the socket said: the poll only
// answers for the widgets that have nothing else to fill them.
function applyWidgetsSnapshot(summary: Forkop.ClashConnectionsSummary) {
  const { uploadTotal, downloadTotal } = summary;
  const bandwidth = polledBandwidth(uploadTotal, downloadTotal);

  store.set({
    ...(trafficSocketLive || !bandwidth
      ? {}
      : {
          bandwidthWidget: {
            loading: false,
            failed: false,
            data: bandwidth,
          },
        }),
    ...(connectionsSocketLive
      ? {}
      : {
          trafficTotalWidget: {
            loading: false,
            failed: false,
            data: { downloadTotal, uploadTotal },
          },
          systemInfoWidget: {
            loading: false,
            failed: false,
            data: {
              connections: summary.connections,
              memory: summary.memory,
            },
          },
        }),
  });
}

function reportWidgetsFailure() {
  widgetsPollFailures += 1;
  lastPolledTotals = null;

  store.set({
    ...(trafficSocketLive
      ? {}
      : {
          bandwidthWidget: {
            loading: false,
            failed: true,
            data: { up: 0, down: 0 },
          },
        }),
    ...(connectionsSocketLive
      ? {}
      : {
          trafficTotalWidget: {
            loading: false,
            failed: true,
            data: { downloadTotal: 0, uploadTotal: 0 },
          },
          systemInfoWidget: {
            loading: false,
            failed: true,
            data: { connections: 0, memory: 0 },
          },
        }),
  });
}

async function pollWidgetsSnapshot(dataUpdatesId: number) {
  const startedAt = Date.now();

  try {
    const response = await CustomForkopMethods.getClashApiConnectionsSummary();

    lastWidgetsPollDurationMs = Date.now() - startedAt;

    if (!widgetsPolling || dataUpdatesId !== dashboardDataUpdatesId) {
      return;
    }

    if (!response.success) {
      reportWidgetsFailure();
      return;
    }

    widgetsPollFailures = 0;
    applyWidgetsSnapshot(response.data);
  } catch (error) {
    logger.error('[DASHBOARD]', 'pollWidgetsSnapshot: failed', error);

    if (widgetsPolling && dataUpdatesId === dashboardDataUpdatesId) {
      reportWidgetsFailure();
    }
  }
}

// A stopped core answers nothing for as long as the tab stays open, so the poll
// slows down while it keeps failing instead of asking every few seconds forever.
function widgetsPollDelay() {
  if (widgetsPollFailures > 0) {
    return Math.min(
      WIDGETS_POLL_INTERVAL_MS * 2 ** widgetsPollFailures,
      WIDGETS_POLL_BACKOFF_MAX_MS,
    );
  }

  return pollDelayForDuration(
    WIDGETS_POLL_INTERVAL_MS,
    lastWidgetsPollDurationMs,
    WIDGETS_POLL_DUTY_MAX_MS,
  );
}

function scheduleWidgetsPoll(dataUpdatesId: number, delay: number) {
  widgetsPollTimer = setTimeout(() => {
    widgetsPollTimer = null;
    void pollWidgetsSnapshot(dataUpdatesId).finally(() => {
      if (widgetsPolling && dataUpdatesId === dashboardDataUpdatesId) {
        scheduleWidgetsPoll(dataUpdatesId, widgetsPollDelay());
      }
    });
  }, delay);
}

function startWidgetsPolling(dataUpdatesId: number) {
  if (widgetsPolling || dataUpdatesId !== dashboardDataUpdatesId) {
    return;
  }

  widgetsPolling = true;
  widgetsPollFailures = 0;
  scheduleWidgetsPoll(dataUpdatesId, 0);
}

function stopWidgetsPolling() {
  widgetsPolling = false;
  widgetsPollFailures = 0;
  lastPolledTotals = null;
  lastWidgetsPollDurationMs = 0;

  if (widgetsSocketGraceTimer) {
    clearTimeout(widgetsSocketGraceTimer);
    widgetsSocketGraceTimer = null;
  }

  if (widgetsPollTimer) {
    clearTimeout(widgetsPollTimer);
    widgetsPollTimer = null;
  }
}

async function connectToClashSockets(dataUpdatesId: number) {
  const mountId = dashboardMountId;
  const clashApiSecret = await getClashApiSecret();

  if (
    !dashboardMounted ||
    mountId !== dashboardMountId ||
    dataUpdatesId !== dashboardDataUpdatesId
  ) {
    return;
  }

  socket.subscribe(
    `${getClashWsUrl()}/traffic?token=${clashApiSecret}`,
    (msg) => {
      if (dataUpdatesId !== dashboardDataUpdatesId) {
        return;
      }

      const parsedMsg = JSON.parse(msg);

      trafficSocketLive = true;

      if (widgetsAreLive()) {
        stopWidgetsPolling();
      }

      store.set({
        bandwidthWidget: {
          loading: false,
          failed: false,
          data: { up: parsedMsg.up, down: parsedMsg.down },
        },
      });
    },
    (_err) => {
      if (dataUpdatesId !== dashboardDataUpdatesId) {
        return;
      }

      logger.error(
        '[DASHBOARD]',
        'connectToClashSockets - traffic: failed to connect to',
        getClashWsUrl(),
      );
      trafficSocketLive = false;
      startWidgetsPolling(dataUpdatesId);
    },
  );

  socket.subscribe(
    `${getClashWsUrl()}/connections?token=${clashApiSecret}`,
    (msg) => {
      if (dataUpdatesId !== dashboardDataUpdatesId) {
        return;
      }

      const parsedMsg = JSON.parse(msg);

      connectionsSocketLive = true;

      if (widgetsAreLive()) {
        stopWidgetsPolling();
      }

      store.set({
        trafficTotalWidget: {
          loading: false,
          failed: false,
          data: {
            downloadTotal: parsedMsg.downloadTotal,
            uploadTotal: parsedMsg.uploadTotal,
          },
        },
        systemInfoWidget: {
          loading: false,
          failed: false,
          data: {
            connections: parsedMsg.connections?.length,
            memory: parsedMsg.memory,
          },
        },
      });
    },
    (_err) => {
      if (dataUpdatesId !== dashboardDataUpdatesId) {
        return;
      }

      logger.error(
        '[DASHBOARD]',
        'connectToClashSockets - connections: failed to connect to',
        getClashWsUrl(),
      );
      connectionsSocketLive = false;
      startWidgetsPolling(dataUpdatesId);
    },
  );
}

function sectionsRefreshDelay() {
  if (sectionsRefreshFailures > 0) {
    return Math.min(
      SECTIONS_REFRESH_INTERVAL_MS * 2 ** sectionsRefreshFailures,
      SECTIONS_REFRESH_BACKOFF_MAX_MS,
    );
  }

  return pollDelayForDuration(
    SECTIONS_REFRESH_INTERVAL_MS,
    lastSectionsRefreshDurationMs,
    SECTIONS_REFRESH_DUTY_MAX_MS,
  );
}

function scheduleSectionsRefresh(dataUpdatesId: number, delay: number) {
  sectionsRefreshTimer = setTimeout(() => {
    sectionsRefreshTimer = null;
    const startedAt = Date.now();

    void fetchDashboardSections()
      .then((success) => {
        lastSectionsRefreshDurationMs = Date.now() - startedAt;
        sectionsRefreshFailures = success ? 0 : sectionsRefreshFailures + 1;
      })
      .finally(() => {
        if (dashboardMounted && dataUpdatesId === dashboardDataUpdatesId) {
          scheduleSectionsRefresh(dataUpdatesId, sectionsRefreshDelay());
        }
      });
  }, delay);
}

function stopDashboardDataUpdates() {
  dashboardDataUpdatesStarted = false;
  dashboardDataUpdatesId += 1;

  if (sectionsRefreshTimer) {
    clearTimeout(sectionsRefreshTimer);
    sectionsRefreshTimer = null;
  }

  sectionsRefreshFailures = 0;
  lastSectionsRefreshDurationMs = 0;
  sectionsRefreshQueued = false;
  stopWidgetsPolling();
  trafficSocketLive = false;
  connectionsSocketLive = false;
  socket.resetAll();
}

// The widgets and the sections come from the Clash API, so the tab asks it
// directly rather than asking first whether the core is running: what answers is
// what there is to show. A browser that cannot open a plaintext socket at all -
// an HTTPS page cannot - polls the same numbers out of the connections snapshot
// instead of leaving three widgets permanently unavailable.
function startDashboardDataUpdates() {
  if (dashboardDataUpdatesStarted || !dashboardMounted) {
    return;
  }

  dashboardDataUpdatesStarted = true;
  const dataUpdatesId = ++dashboardDataUpdatesId;
  void fetchDashboardSections({ force: true });

  if (canUseDirectClashApi()) {
    void connectToClashSockets(dataUpdatesId);
    widgetsSocketGraceTimer = setTimeout(() => {
      widgetsSocketGraceTimer = null;
      startWidgetsPolling(dataUpdatesId);
    }, WIDGETS_SOCKET_GRACE_MS);
  } else {
    startWidgetsPolling(dataUpdatesId);
  }

  scheduleSectionsRefresh(dataUpdatesId, SECTIONS_REFRESH_INTERVAL_MS);
}

// Handlers

async function handleChooseOutbound(
  sectionName: string,
  selector: string,
  tag: string,
) {
  const sectionsWidget = store.get().sectionsWidget;
  const section = sectionsWidget.data.find(
    (item) => item.sectionName === sectionName,
  );

  if (
    !section?.withTagSelect ||
    selectorRequests.has(selector) ||
    section.outbounds.some(
      (outbound) => outbound.code === tag && outbound.selected,
    )
  ) {
    return;
  }

  selectorRequests.add(selector);

  try {
    const response = await CustomForkopMethods.setClashApiGroupProxy(
      selector,
      tag,
    );
    if (!response.success) {
      throw new Error(response.error);
    }

    const current = store.get().sectionsWidget;
    store.set({
      sectionsWidget: {
        ...current,
        data: current.data.map((item) =>
          item.sectionName === sectionName
            ? {
                ...item,
                outbounds: item.outbounds.map((outbound) => ({
                  ...outbound,
                  selected: outbound.code === tag,
                })),
              }
            : item,
        ),
      },
    });
    void fetchDashboardSections({ force: true });
  } catch (error) {
    logger.error('[DASHBOARD]', 'handleChooseOutbound failed', error);
  } finally {
    selectorRequests.delete(selector);
  }
}

function applyLatencyResult(
  sectionName: string,
  tag: string,
  latencies: Record<string, number>,
  group: boolean,
) {
  const sectionsWidget = store.get().sectionsWidget;
  store.set({
    sectionsWidget: {
      ...sectionsWidget,
      data: sectionsWidget.data.map((section) => {
        if (section.sectionName !== sectionName) {
          return section;
        }

        return {
          ...section,
          outbounds: section.outbounds.map((outbound) => {
            const testedGroup = group && outbound.code === tag;
            const updateMembers = <T extends Forkop.UrlTestMember>(
              members: T[],
            ) =>
              members.map((member) => ({
                ...member,
                latency:
                  latencies[member.code] ?? (testedGroup ? 0 : member.latency),
              }));
            const urlTestInfo = outbound.urlTestInfo
              ? {
                  ...outbound.urlTestInfo,
                  outbounds: updateMembers(outbound.urlTestInfo.outbounds),
                }
              : undefined;
            const fallbackInfo = outbound.fallbackInfo
              ? {
                  ...outbound.fallbackInfo,
                  outbounds: updateMembers(outbound.fallbackInfo.outbounds),
                }
              : undefined;
            const selectedLatency = (
              urlTestInfo?.outbounds || fallbackInfo?.outbounds
            )?.find((member) => member.selected)?.latency;

            return {
              ...outbound,
              latency:
                latencies[outbound.code] ??
                selectedLatency ??
                (outbound.code === tag ? 0 : outbound.latency),
              urlTestInfo,
              fallbackInfo,
            };
          }),
        };
      }),
    },
  });
}

async function handleTestLatency(
  latencyType: 'group' | 'proxy',
  sectionName: string,
  tag: string,
  requestKey: string,
  timeout?: string,
) {
  if (latencyRequests.has(requestKey)) {
    return;
  }

  latencyRequests.add(requestKey);
  void renderSectionsWidget();
  try {
    const response =
      latencyType === 'group'
        ? await CustomForkopMethods.getClashApiGroupLatency(
            tag,
            timeout || '10000',
          )
        : await CustomForkopMethods.getClashApiProxyLatency(
            tag,
            timeout || '5000',
          );
    if (!response.success) throw new Error(response.error);

    if (latencyType === 'group') {
      applyLatencyResult(
        sectionName,
        tag,
        response.data as Record<string, number>,
        true,
      );
    } else {
      applyLatencyResult(
        sectionName,
        tag,
        { [tag]: response.data.delay },
        false,
      );
    }
  } catch (error) {
    logger.error('[DASHBOARD]', 'handleTestLatency: failed', error);
  } finally {
    latencyRequests.delete(requestKey);
    void renderSectionsWidget();
  }
}

async function handleCopyOutbound(outbound: Forkop.Outbound) {
  const link = await resolveOutboundProxyLink(
    outbound,
    CustomForkopMethods.getClashApiProxyLink,
  );
  if (link) {
    copyToClipboard(link);
    return;
  }

  showToast(_('Proxy link is unavailable'), 'error');
}

function formatUrlTestModalValue(value: unknown) {
  if (typeof value === 'boolean') {
    return value ? _('Yes') : _('No');
  }

  const text = `${value ?? ''}`.trim();
  return text || _('No');
}

function formatUrlTestLatency(latency: number) {
  return latency ? `${latency}ms` : 'N/A';
}

function renderDetailsUrl(value: unknown) {
  const url = `${value ?? ''}`.trim();

  if (!/^https?:\/\//i.test(url)) {
    return E('span', {}, formatUrlTestModalValue(value));
  }

  return E(
    'a',
    {
      class: 'fkp_dashboard-page__urltest-details__url',
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    url,
  );
}

function getDetectedCountryFlag(country?: string) {
  const code = `${country || ''}`.trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(code)) {
    return '';
  }

  return String.fromCodePoint(
    ...code.split('').map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
  );
}

function renderDetailsMemberName(member: Forkop.UrlTestMember) {
  const countryFlag = getDetectedCountryFlag(member.country);
  return [
    ...(member.subscriptionTag
      ? [
          E(
            'span',
            {
              class:
                'fkp_dashboard-page__outbound-grid__item__subscription-tag',
            },
            member.subscriptionTag,
          ),
        ]
      : []),
    ...(countryFlag
      ? [
          E(
            'span',
            { class: 'fkp_dashboard-page__urltest-details__country-badge' },
            countryFlag,
          ),
        ]
      : []),
    ...renderFlagEmojis(member.displayName),
  ];
}

function renderUrlTestSelectedValue(info: Forkop.UrlTestInfo) {
  const selectedMember = info.outbounds.find((member) => member.selected);
  const selectedName =
    selectedMember?.displayName || info.selectedName || info.selectedCode || '';
  const name = formatUrlTestModalValue(selectedName);

  if (name === _('No')) {
    return E('span', {}, name);
  }

  return E(
    'span',
    { class: 'fkp_dashboard-page__urltest-details__selected-value' },
    [
      E(
        'span',
        { class: 'fkp_dashboard-page__urltest-details__selected-name' },
        selectedMember ? renderDetailsMemberName(selectedMember) : name,
      ),
      ...(selectedMember?.type
        ? [
            E(
              'span',
              { class: 'fkp_dashboard-page__urltest-details__selected-type' },
              selectedMember.type,
            ),
          ]
        : []),
      ...(selectedMember
        ? [
            E(
              'span',
              { class: latencyClassName(selectedMember.latency) },
              formatUrlTestLatency(selectedMember.latency),
            ),
          ]
        : []),
    ],
  );
}

function renderUrlTestCopyButton(
  title: string,
  onClick: (event: MouseEvent) => void,
) {
  return E(
    'button',
    {
      type: 'button',
      class: 'btn fkp_dashboard-page__urltest-details__copy-button',
      title,
      'aria-label': title,
      click: onClick,
    },
    renderCopyIcon24(),
  );
}

function renderUrlTestInfoModal(outbound: Forkop.Outbound) {
  const info = outbound.urlTestInfo;

  if (!info) {
    return E('div', {}, _('URLTest details are unavailable'));
  }

  const fields: Array<{
    label: string;
    value?: unknown;
    children?: Array<HTMLElement | string>;
  }> = [
    {
      label: _('Selected'),
      children: [renderUrlTestSelectedValue(info)],
    },
    { label: _('Check URL'), children: [renderDetailsUrl(info.url)] },
    {
      label: _('Expected status'),
      value: info.expectedStatus === '*' ? _('Any') : info.expectedStatus,
    },
    { label: _('Check interval'), value: info.interval },
    { label: _('Tolerance'), value: info.tolerance },
    { label: _('Idle timeout'), value: info.idleTimeout },
    {
      label: _('Interrupt connections'),
      value: info.interruptExistConnections,
    },
  ];

  return E('div', { class: 'fkp_dashboard-page__urltest-details' }, [
    E(
      'dl',
      { class: 'fkp_dashboard-page__urltest-details__params' },
      fields.map(({ label, value, children }) =>
        E('div', { class: 'fkp_dashboard-page__urltest-details__param' }, [
          E('dt', {}, label),
          E(
            'dd',
            {},
            children || [E('span', {}, formatUrlTestModalValue(value))],
          ),
        ]),
      ),
    ),
    E('div', { class: 'fkp_dashboard-page__urltest-details__outbounds' }, [
      E(
        'div',
        { class: 'fkp_dashboard-page__urltest-details__outbounds-title' },
        _('Nodes'),
      ),
      E(
        'div',
        { class: 'fkp_dashboard-page__urltest-details__table' },
        info.outbounds.length
          ? info.outbounds.map((member) =>
              E(
                'div',
                {
                  class: [
                    'fkp_dashboard-page__urltest-details__row',
                    member.selected
                      ? 'fkp_dashboard-page__urltest-details__row--active'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' '),
                },
                [
                  E(
                    'div',
                    {
                      class: 'fkp_dashboard-page__urltest-details__row-name',
                    },
                    [
                      E('b', {}, renderDetailsMemberName(member)),
                      ...(member.type
                        ? [
                            E(
                              'span',
                              {
                                class:
                                  'fkp_dashboard-page__urltest-details__row-type',
                              },
                              member.type,
                            ),
                          ]
                        : []),
                    ],
                  ),
                  E(
                    'div',
                    {
                      class: 'fkp_dashboard-page__urltest-details__row-meta',
                    },
                    [
                      E(
                        'span',
                        { class: latencyClassName(member.latency) },
                        formatUrlTestLatency(member.latency),
                      ),
                    ],
                  ),
                  member.canCopyLink
                    ? renderUrlTestCopyButton(_('Copy proxy link'), (event) => {
                        event.preventDefault();
                        void handleCopyOutbound(member);
                      })
                    : E('span', {
                        class:
                          'fkp_dashboard-page__urltest-details__copy-placeholder',
                      }),
                ],
              ),
            )
          : [
              E(
                'div',
                { class: 'fkp_dashboard-page__urltest-details__empty' },
                _('Node list is empty'),
              ),
            ],
      ),
    ]),
    E('div', { class: 'fkp_dashboard-page__urltest-details__footer' }, [
      E(
        'button',
        {
          type: 'button',
          class: 'btn cbi-button cbi-button-neutral',
          click: () => {
            ui.hideModal();
          },
        },
        _('Close'),
      ),
    ]),
  ]);
}

function handleShowUrlTestInfo(outbound: Forkop.Outbound) {
  if (!outbound.urlTestInfo) {
    return;
  }

  ui.showModal(
    `${_('URLTest details')}: ${
      outbound.urlTestInfo.displayName || outbound.displayName
    }`,
    renderUrlTestInfoModal(outbound),
  );
}

function renderFallbackSelectedValue(info: Forkop.FallbackInfo) {
  const selectedMember = info.outbounds.find((member) => member.selected);
  const selectedName =
    selectedMember?.displayName || info.selectedName || info.selectedCode || '';
  const name = formatUrlTestModalValue(selectedName);

  if (name === _('No')) {
    return E('span', {}, name);
  }

  return E(
    'span',
    { class: 'fkp_dashboard-page__urltest-details__selected-value' },
    [
      E(
        'span',
        {
          class: [
            'fkp_dashboard-page__urltest-details__selected-name',
            selectedMember
              ? 'fkp_dashboard-page__urltest-details__fallback-name'
              : '',
          ]
            .filter(Boolean)
            .join(' '),
        },
        selectedMember ? renderFallbackMemberName(selectedMember) : name,
      ),
      ...(selectedMember?.type
        ? [
            E(
              'span',
              { class: 'fkp_dashboard-page__urltest-details__selected-type' },
              selectedMember.type,
            ),
          ]
        : []),
      ...(selectedMember
        ? [
            E(
              'span',
              { class: latencyClassName(selectedMember.latency) },
              formatUrlTestLatency(selectedMember.latency),
            ),
          ]
        : []),
    ],
  );
}

function renderFallbackMemberName(member: Forkop.FallbackMember) {
  const levelName = member.levelName || _('Level');

  return [
    E(
      'span',
      { class: 'fkp_dashboard-page__urltest-details__fallback-level' },
      levelName,
    ),
    E(
      'span',
      { class: 'fkp_dashboard-page__urltest-details__fallback-node' },
      renderDetailsMemberName(member),
    ),
  ];
}

function findFallbackInfo(code: string) {
  for (const section of store.get().sectionsWidget.data) {
    for (const outbound of section.outbounds) {
      if (outbound.fallbackInfo?.code === code) {
        return outbound.fallbackInfo;
      }
    }
  }

  return undefined;
}

function fallbackPinRequestKey(code: string, memberCode: string) {
  return `${code}:${memberCode}`;
}

async function handleFallbackPin(code: string, member: Forkop.FallbackMember) {
  const requestKey = fallbackPinRequestKey(code, member.code);

  if (fallbackPinRequests.has(requestKey)) {
    return;
  }

  fallbackPinRequests.add(requestKey);
  refreshFallbackModal();

  try {
    const response = await CustomForkopMethods.setClashApiGroupProxy(
      code,
      member.pinned ? '' : member.code,
    );

    if (!response.success) {
      throw new Error(response.error);
    }

    await fetchDashboardSections({ force: true });
  } catch (error) {
    showToast(_('Failed to pin the server'), 'error');
    logger.error('[DASHBOARD]', 'handleFallbackPin failed', error);
  } finally {
    fallbackPinRequests.delete(requestKey);
    refreshFallbackModal();
  }
}

function renderFallbackMemberRow(
  info: Forkop.FallbackInfo,
  member: Forkop.FallbackMember,
) {
  const busy = fallbackPinRequests.has(
    fallbackPinRequestKey(info.code, member.code),
  );
  const choose = () => {
    void handleFallbackPin(info.code, member);
  };

  return E(
    'div',
    {
      class: [
        'fkp_dashboard-page__urltest-details__row',
        'fkp_dashboard-page__urltest-details__row--selectable',
        member.selected
          ? 'fkp_dashboard-page__urltest-details__row--active'
          : '',
        busy ? 'fkp_dashboard-page__urltest-details__row--busy' : '',
      ]
        .filter(Boolean)
        .join(' '),
      role: 'button',
      tabIndex: 0,
      'aria-pressed': member.pinned ? 'true' : 'false',
      click: (event: MouseEvent) => {
        event.preventDefault();
        choose();
      },
      keydown: (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }

        event.preventDefault();
        choose();
      },
    },
    [
      E('div', { class: 'fkp_dashboard-page__urltest-details__row-name' }, [
        E(
          'b',
          { class: 'fkp_dashboard-page__urltest-details__fallback-name' },
          renderFallbackMemberName(member),
        ),
        ...(member.type
          ? [
              E(
                'span',
                { class: 'fkp_dashboard-page__urltest-details__row-type' },
                member.type,
              ),
            ]
          : []),
        ...(member.pinned
          ? [
              E(
                'span',
                {
                  class: 'fkp_dashboard-page__urltest-details__row-pin',
                  'aria-hidden': 'true',
                },
                renderPinIcon24(),
              ),
            ]
          : []),
      ]),
      E('div', { class: 'fkp_dashboard-page__urltest-details__row-meta' }, [
        E(
          'span',
          { class: latencyClassName(member.latency) },
          formatUrlTestLatency(member.latency),
        ),
      ]),
      member.canCopyLink
        ? renderUrlTestCopyButton(_('Copy proxy link'), (event) => {
            event.preventDefault();
            event.stopPropagation();
            void handleCopyOutbound(member);
          })
        : E('span', {
            class: 'fkp_dashboard-page__urltest-details__copy-placeholder',
          }),
    ],
  );
}

function renderFallbackInfoModal(info?: Forkop.FallbackInfo) {
  if (!info) {
    return [E('div', {}, _('Fallback details are unavailable'))];
  }

  const fields: Array<{
    label: string;
    value?: unknown;
    children?: Array<HTMLElement | string>;
  }> = [
    {
      label: _('Selected'),
      children: [renderFallbackSelectedValue(info)],
    },
    {
      label: _('Check URL'),
      children: [renderDetailsUrl(info.healthCheckUrl)],
    },
    {
      label: _('Expected status'),
      value: info.expectedStatus === '*' ? _('Any') : info.expectedStatus,
    },
    { label: _('Check interval'), value: info.healthCheckInterval },
    { label: _('Check timeout'), value: info.healthCheckTimeout },
    { label: _('Connection timeout'), value: info.attemptTimeout },
    { label: _('Idle timeout'), value: info.idleTimeout },
    {
      label: _('Interrupt connections'),
      value: info.interruptExistConnections,
    },
  ];

  return [
    E(
      'dl',
      { class: 'fkp_dashboard-page__urltest-details__params' },
      fields.map(({ label, value, children }) =>
        E('div', { class: 'fkp_dashboard-page__urltest-details__param' }, [
          E('dt', {}, label),
          E(
            'dd',
            {},
            children || [E('span', {}, formatUrlTestModalValue(value))],
          ),
        ]),
      ),
    ),
    E('div', { class: 'fkp_dashboard-page__urltest-details__outbounds' }, [
      E(
        'div',
        { class: 'fkp_dashboard-page__urltest-details__outbounds-title' },
        _('Nodes'),
      ),
      E(
        'div',
        { class: 'fkp_dashboard-page__urltest-details__hint' },
        _('Click a server to pin its priority. Click it again to unpin.'),
      ),
      E(
        'div',
        { class: 'fkp_dashboard-page__urltest-details__table' },
        info.outbounds.length
          ? info.outbounds.map((member) =>
              renderFallbackMemberRow(info, member),
            )
          : [
              E(
                'div',
                { class: 'fkp_dashboard-page__urltest-details__empty' },
                _('Node list is empty'),
              ),
            ],
      ),
    ]),
    E('div', { class: 'fkp_dashboard-page__urltest-details__footer' }, [
      E(
        'button',
        {
          type: 'button',
          class: 'btn cbi-button cbi-button-neutral',
          click: () => {
            closeFallbackModal();
            ui.hideModal();
          },
        },
        _('Close'),
      ),
    ]),
  ];
}

function closeFallbackModal() {
  activeFallbackModal?.unsubscribe();
  activeFallbackModal = null;
}

function refreshFallbackModal() {
  const modal = activeFallbackModal;

  if (!modal) {
    return;
  }

  if (!document.body.contains(modal.container)) {
    closeFallbackModal();
    return;
  }

  modal.container.replaceChildren(
    ...renderFallbackInfoModal(findFallbackInfo(modal.code)),
  );
}

function handleShowFallbackInfo(outbound: Forkop.Outbound) {
  const info = outbound.fallbackInfo;

  if (!info) {
    return;
  }

  closeFallbackModal();

  const container = E(
    'div',
    { class: 'fkp_dashboard-page__urltest-details' },
    renderFallbackInfoModal(info),
  ) as HTMLElement;

  activeFallbackModal = {
    code: info.code,
    container,
    unsubscribe: store.subscribeKey('sectionsWidget', () => {
      refreshFallbackModal();
    }),
  };

  ui.showModal(
    `${_('Fallback details')}: ${info.displayName || outbound.displayName}`,
    container,
  );
}

function setRuleSetUpdating(sectionName: string, updating: boolean) {
  const sectionsWidget = store.get().sectionsWidget;
  const ruleSetUpdatingSections = {
    ...sectionsWidget.ruleSetUpdatingSections,
  };

  if (updating) {
    ruleSetUpdatingSections[sectionName] = true;
  } else {
    delete ruleSetUpdatingSections[sectionName];
  }

  store.set({
    sectionsWidget: {
      ...sectionsWidget,
      ruleSetUpdatingSections,
    },
  });
}

// Both refresh endpoints answer 204 on success and 503 naming what failed, so
// the outcome is reportable rather than guessed at. Anything less than every
// target succeeding is reported as a failure: a partially refreshed set of
// lists is not what the button promised.
async function handleUpdateRuleSets(section: Forkop.OutboundGroup) {
  if (store.get().sectionsWidget.ruleSetUpdatingSections[section.sectionName]) {
    return;
  }

  setRuleSetUpdating(section.sectionName, true);

  try {
    const response = await CustomForkopMethods.updateClashApiRuleProviders(
      section.ruleSetProviderTags || [],
    );

    if (!response.success) {
      throw new Error(response.error);
    }

    showToast(_('Lists updated'), 'success');
  } catch (error) {
    logger.error('[DASHBOARD]', 'handleUpdateRuleSets: failed', error);
    showToast(_('Failed to update lists'), 'error');
  } finally {
    setRuleSetUpdating(section.sectionName, false);
  }
}

async function handleUpdateSubscription(section: Forkop.OutboundGroup) {
  if (
    store.get().sectionsWidget.subscriptionUpdatingSections[section.sectionName]
  ) {
    return;
  }

  setSubscriptionUpdating(section.sectionName, true, true);

  try {
    const response = await CustomForkopMethods.updateClashApiProxyProviders(
      section.subscriptionProviderTags || [],
    );

    if (!response.success) {
      throw new Error(response.error);
    }
    if (!pageUnloading) {
      void fetchDashboardSections({ force: true });
      void refreshRuntimeUiState({ force: true });
    }

    showToast(_('Subscriptions updated'), 'success');
  } catch (error) {
    logger.error('[DASHBOARD]', 'handleUpdateSubscription: failed', error);
    showToast(_('Failed to update subscriptions'), 'error');
  } finally {
    setSubscriptionUpdating(section.sectionName, false);
  }
}

// Renderer

async function renderSectionsWidget() {
  logger.debug('[DASHBOARD]', 'renderSectionsWidget');
  const sectionsWidget = store.get().sectionsWidget;
  const container = document.getElementById('dashboard-sections-grid');

  if (!container) {
    return;
  }

  if (sectionsWidget.loading || sectionsWidget.failed) {
    const renderedWidget = renderSectionsPlaceholder({
      loading: sectionsWidget.loading,
      failed: sectionsWidget.failed,
    });

    return preserveScrollForPage(() => {
      container.replaceChildren(renderedWidget);
    });
  }

  const renderedWidgets = sectionsWidget.data.map((section) =>
    renderSections({
      loading: sectionsWidget.loading,
      failed: sectionsWidget.failed,
      section,
      latencyFetching: latencyRequests.has(
        sectionLatencyRequestKey(section.sectionName),
      ),
      latencyFetchingTargets: new Set(
        section.outbounds
          .map((outbound) => outbound.code)
          .filter((tag) =>
            latencyRequests.has(
              outboundLatencyRequestKey(section.sectionName, tag),
            ),
          ),
      ),
      subscriptionUpdating: Boolean(
        sectionsWidget.subscriptionUpdatingSections[section.sectionName],
      ),
      ruleSetUpdating: Boolean(
        sectionsWidget.ruleSetUpdatingSections[section.sectionName],
      ),
      onUpdateRuleSets: (target: Forkop.OutboundGroup) => {
        void handleUpdateRuleSets(target);
      },
      sortByLatency: latencySortedSections.has(section.sectionName),
      onSortByLatencyChange: handleSortByLatency,
      onTestLatency: (tag) => {
        void handleTestLatency(
          section.withTagSelect ? 'group' : 'proxy',
          section.sectionName,
          tag,
          sectionLatencyRequestKey(section.sectionName),
          section.latencyTestTimeout,
        );
      },
      onTestOutboundLatency: (latencyType, tag) => {
        void handleTestLatency(
          latencyType,
          section.sectionName,
          tag,
          outboundLatencyRequestKey(section.sectionName, tag),
          section.latencyTestTimeout,
        );
      },
      onChooseOutbound: (sectionName, selector, tag) => {
        void handleChooseOutbound(sectionName, selector, tag);
      },
      onCopyOutbound: (_section, outbound) => {
        void handleCopyOutbound(outbound);
      },
      onShowUrlTestInfo: (outbound) => {
        handleShowUrlTestInfo(outbound);
      },
      onShowFallbackInfo: (outbound) => {
        handleShowFallbackInfo(outbound);
      },
      onUpdateSubscription: (section) => {
        void handleUpdateSubscription(section);
      },
    }),
  );

  return preserveScrollForPage(() => {
    container.replaceChildren(...renderedWidgets);
  });
}

async function renderBandwidthWidget() {
  logger.debug('[DASHBOARD]', 'renderBandwidthWidget');
  const traffic = store.get().bandwidthWidget;

  const container = document.getElementById('dashboard-widget-traffic');

  if (!container) {
    return;
  }

  if (traffic.loading || traffic.failed) {
    const renderedWidget = renderWidget({
      loading: traffic.loading,
      failed: traffic.failed,
      title: '',
      items: [],
    });

    return container.replaceChildren(renderedWidget);
  }

  const renderedWidget = renderWidget({
    loading: traffic.loading,
    failed: traffic.failed,
    title: _('Traffic'),
    items: [
      { key: _('Uplink'), value: `${prettyBytes(traffic.data.up)}/s` },
      { key: _('Downlink'), value: `${prettyBytes(traffic.data.down)}/s` },
    ],
  });

  container.replaceChildren(renderedWidget);
}

async function renderTrafficTotalWidget() {
  logger.debug('[DASHBOARD]', 'renderTrafficTotalWidget');
  const trafficTotalWidget = store.get().trafficTotalWidget;

  const container = document.getElementById('dashboard-widget-traffic-total');

  if (!container) {
    return;
  }

  if (trafficTotalWidget.loading || trafficTotalWidget.failed) {
    const renderedWidget = renderWidget({
      loading: trafficTotalWidget.loading,
      failed: trafficTotalWidget.failed,
      title: '',
      items: [],
    });

    return container.replaceChildren(renderedWidget);
  }

  const renderedWidget = renderWidget({
    loading: trafficTotalWidget.loading,
    failed: trafficTotalWidget.failed,
    title: _('Traffic Total'),
    items: [
      {
        key: _('Uplink'),
        value: String(prettyBytes(trafficTotalWidget.data.uploadTotal)),
      },
      {
        key: _('Downlink'),
        value: String(prettyBytes(trafficTotalWidget.data.downloadTotal)),
      },
    ],
  });

  container.replaceChildren(renderedWidget);
}

async function renderSystemInfoWidget() {
  logger.debug('[DASHBOARD]', 'renderSystemInfoWidget');
  const systemInfoWidget = store.get().systemInfoWidget;

  const container = document.getElementById('dashboard-widget-system-info');

  if (!container) {
    return;
  }

  if (systemInfoWidget.loading || systemInfoWidget.failed) {
    const renderedWidget = renderWidget({
      loading: systemInfoWidget.loading,
      failed: systemInfoWidget.failed,
      title: '',
      items: [],
    });

    return container.replaceChildren(renderedWidget);
  }

  const renderedWidget = renderWidget({
    loading: systemInfoWidget.loading,
    failed: systemInfoWidget.failed,
    title: _('System info'),
    items: [
      {
        key: _('Active Connections'),
        value: String(systemInfoWidget.data.connections),
      },
      {
        key: _('Memory Usage'),
        value: String(prettyBytes(systemInfoWidget.data.memory)),
      },
    ],
  });

  container.replaceChildren(renderedWidget);
}

async function renderServicesInfoWidget() {
  logger.debug('[DASHBOARD]', 'renderServicesInfoWidget');
  const servicesInfoWidget = store.get().servicesInfoWidget;

  const container = document.getElementById('dashboard-widget-service-info');

  if (!container) {
    return;
  }

  if (servicesInfoWidget.loading || servicesInfoWidget.failed) {
    const renderedWidget = renderWidget({
      loading: servicesInfoWidget.loading,
      failed: servicesInfoWidget.failed,
      title: '',
      items: [],
    });

    return container.replaceChildren(renderedWidget);
  }

  const forkopDisplay = getServiceStatusDisplay({
    running: Boolean(servicesInfoWidget.data.forkopRunning),
    busy: servicesInfoWidget.data.forkopBusy,
  });
  // sing-box has no operation of its own to report; it is cycled by Forkop's.
  const singBoxDisplay = getServiceStatusDisplay({
    running: Boolean(servicesInfoWidget.data.singbox),
    busy: servicesInfoWidget.data.forkopBusy,
  });

  const renderedWidget = renderWidget({
    loading: servicesInfoWidget.loading,
    failed: servicesInfoWidget.failed,
    title: _('Services info'),
    items: [
      {
        key: 'Forkop',
        value: forkopDisplay.label,
        attributes: {
          class: `fkp_dashboard-page__widgets-section__item__row--${forkopDisplay.tone}`,
        },
      },
      {
        key: 'Sing-box',
        value: singBoxDisplay.label,
        attributes: {
          class: `fkp_dashboard-page__widgets-section__item__row--${singBoxDisplay.tone}`,
        },
      },
    ],
  });

  container.replaceChildren(renderedWidget);
}

async function onStoreUpdate(
  next: StoreType,
  prev: StoreType,
  diff: Partial<StoreType>,
) {
  if (diff.sectionsWidget) {
    renderSectionsWidget();
  }

  if (diff.bandwidthWidget) {
    renderBandwidthWidget();
  }

  if (diff.trafficTotalWidget) {
    renderTrafficTotalWidget();
  }

  if (diff.systemInfoWidget) {
    renderSystemInfoWidget();
  }

  if (diff.servicesInfoWidget) {
    renderServicesInfoWidget();
  }
}

async function onPageMount() {
  // Cleanup before mount
  onPageUnmount();

  dashboardMounted = true;
  dashboardMountId += 1;
  resetClashApiTransport();

  // Add new listener
  store.subscribe(onStoreUpdate);
  void renderSectionsWidget();
  void renderBandwidthWidget();
  void renderTrafficTotalWidget();
  void renderSystemInfoWidget();
  void renderServicesInfoWidget();
  startDashboardDataUpdates();

  // The service widget is the only part of the page that reads the service state,
  // so it is fetched after the Clash API is already being asked.
  void refreshRuntimeUiState({ force: true });
}

function onPageUnmount() {
  dashboardMounted = false;
  dashboardMountId += 1;

  stopDashboardDataUpdates();
  sectionsRefreshQueued = false;
  sectionsRefreshPromise = null;
  // Remove old listener
  store.unsubscribe(onStoreUpdate);
  // Clear store
  store.reset(['bandwidthWidget', 'trafficTotalWidget', 'systemInfoWidget']);
}

let dashboardLifecycleRegistered = false;
let dashboardControllerInitialized = false;

function registerLifecycleListeners() {
  if (dashboardLifecycleRegistered) {
    return;
  }

  dashboardLifecycleRegistered = true;

  store.subscribe((next, prev, diff) => {
    if (
      diff.tabService &&
      next.tabService.current !== prev.tabService.current
    ) {
      logger.debug(
        '[DASHBOARD]',
        'active tab diff event, active tab:',
        diff.tabService.current,
      );
      const isDashboardVisible = next.tabService.current === 'dashboard';

      if (isDashboardVisible) {
        logger.debug(
          '[DASHBOARD]',
          'registerLifecycleListeners',
          'onPageMount',
        );
        return onPageMount();
      }

      if (!isDashboardVisible) {
        logger.debug(
          '[DASHBOARD]',
          'registerLifecycleListeners',
          'onPageUnmount',
        );
        return onPageUnmount();
      }
    }
  });
}

export async function initController(): Promise<void> {
  if (dashboardControllerInitialized) {
    return;
  }

  dashboardControllerInitialized = true;

  onMount('dashboard-status').then(() => {
    logger.debug('[DASHBOARD]', 'initController', 'onMount');
    registerLifecycleListeners();
    if (
      store.get().tabService.current === 'dashboard' ||
      isActiveLuciTab('dashboard')
    ) {
      onPageMount();
    }
  });
}
