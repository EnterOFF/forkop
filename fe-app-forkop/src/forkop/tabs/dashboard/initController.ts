import {
  getClashWsUrl,
  onMount,
  preserveScrollForPage,
} from '../../../helpers';
import { copyToClipboard } from '../../../helpers/copyToClipboard';
import { showToast } from '../../../helpers/showToast';
import { prettyBytes } from '../../../helpers/prettyBytes';
import {
  renderCopyIcon24,
  renderLoaderCircleIcon24,
  renderRotateCcwIcon24,
} from '../../../icons';
import { CustomForkopMethods, ForkopShellMethods } from '../../methods';
import {
  logger,
  setLocalLatencyAction,
  setLocalSubscriptionAction,
  socket,
  store,
  StoreType,
} from '../../services';
import {
  getPendingLatencyTags,
  getOutboundLatencyClass,
  getLatencyTestLabel,
  renderFlagEmojis,
  renderSections,
  renderWidget,
} from './partials';
import { fetchServicesInfo } from '../../fetchers/fetchServicesInfo';
import { getClashApiSecret } from '../../methods/custom/getClashApiSecret';
import { Forkop } from '../../types';
import {
  getCachedRuntimeUiState,
  refreshRuntimeUiState,
  subscribeRuntimeUiState,
} from '../../services/runtimeUiState.service';
import { isActiveLuciTab } from '../../helpers/isActiveLuciTab';
import { shouldShowLoadingForRestoredAction } from '../../helpers/restoredActionLoading';
import { getServiceAvailability } from '../../helpers/serviceAvailability';
import { resolveOutboundProxyLink } from './resolveOutboundProxyLink';

const SECTIONS_REFRESH_INTERVAL_MS = 10000;
const LATENCY_TEST_BUTTON_CLASS = 'dashboard-sections-grid-item-test-latency';
const LATENCY_TEST_BUTTON_LABEL_CLASS =
  'dashboard-sections-grid-item-test-latency__label';
const OUTBOUND_LATENCY_BUTTON_CLASS =
  'fkp_dashboard-page__outbound-grid__item__latency';
const OUTBOUND_LATENCY_VALUE_CLASS = `${OUTBOUND_LATENCY_BUTTON_CLASS}-value`;
const OUTBOUND_LATENCY_STATE_CLASSES = [
  `${OUTBOUND_LATENCY_BUTTON_CLASS}--empty`,
  `${OUTBOUND_LATENCY_BUTTON_CLASS}--green`,
  `${OUTBOUND_LATENCY_BUTTON_CLASS}--yellow`,
  `${OUTBOUND_LATENCY_BUTTON_CLASS}--red`,
];
let sectionsRefreshTimer: ReturnType<typeof setInterval> | null = null;
let sectionsRefreshPromise: Promise<boolean> | null = null;
let sectionsRefreshQueued = false;
let actionStateUnsubscribe: (() => void) | null = null;
let dashboardMounted = false;
let dashboardMountId = 0;
let dashboardDataUpdatesStarted = false;
let dashboardDataUpdatesId = 0;
let pageUnloading = false;
const followedLatencyJobs = new Set<string>();
const handledLatencyJobs = new Set<string>();
const latencyFetchingTargets: Record<string, string> = {};
const latencyJobIds: Record<string, string> = {};
const latencyCancelRequests = new Set<string>();
const cancellingLatencyJobs = new Set<string>();
const cancellingLatencySections = new Set<string>();
const latencySortedSections = new Set<string>();
let latencyAckQueue: Promise<unknown> = Promise.resolve();

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
  if (getDashboardServiceAvailability() === 'stopped') {
    return false;
  }

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

    if (
      !dashboardMounted ||
      mountId !== dashboardMountId ||
      getDashboardServiceAvailability() === 'stopped'
    ) {
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

    if (
      !dashboardMounted ||
      mountId !== dashboardMountId ||
      getDashboardServiceAvailability() === 'stopped'
    ) {
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

function setSelectorSwitching(sectionName: string, tag?: string) {
  const sectionsWidget = store.get().sectionsWidget;
  const selectorSwitchingSections = {
    ...sectionsWidget.selectorSwitchingSections,
  };

  if (tag) {
    selectorSwitchingSections[sectionName] = tag;
  } else {
    delete selectorSwitchingSections[sectionName];
  }

  store.set({
    sectionsWidget: {
      ...sectionsWidget,
      selectorSwitchingSections,
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

function setLatencyFetching(
  sectionName: string,
  fetching: boolean,
  local = false,
  progress?: Forkop.LatencyActionProgress,
  target?: string,
) {
  if (local || !fetching) {
    setLocalLatencyAction(sectionName, fetching && local);
  }

  const sectionsWidget = store.get().sectionsWidget;
  const latencyFetchingSections = {
    ...sectionsWidget.latencyFetchingSections,
  };
  const latencyProgressSections = {
    ...sectionsWidget.latencyProgressSections,
  };

  if (fetching) {
    latencyFetchingSections[sectionName] = true;
    if (target) {
      latencyFetchingTargets[sectionName] = target;
    }
    if (progress) {
      latencyProgressSections[sectionName] = progress;
    }
  } else {
    delete latencyFetchingSections[sectionName];
    delete latencyProgressSections[sectionName];
    delete latencyFetchingTargets[sectionName];
    const jobId = latencyJobIds[sectionName];
    delete latencyJobIds[sectionName];
    latencyCancelRequests.delete(sectionName);
    cancellingLatencySections.delete(sectionName);
    if (jobId) {
      cancellingLatencyJobs.delete(jobId);
    }
  }

  store.set({
    sectionsWidget: {
      ...sectionsWidget,
      latencyFetchingSections,
      latencyProgressSections,
    },
  });
}

function queueLatencyAck(jobId: string) {
  latencyAckQueue = latencyAckQueue
    .catch(() => undefined)
    .then(() => ForkopShellMethods.uiActionAck('latency', jobId));
}

async function completeLatencyTestJob(jobId: string, sectionName: string) {
  if (pageUnloading) {
    setLatencyFetching(sectionName, false);
    return;
  }

  if (jobId && handledLatencyJobs.has(jobId)) {
    return;
  }

  if (jobId) {
    handledLatencyJobs.add(jobId);
    queueLatencyAck(jobId);
  }

  try {
    await fetchDashboardSections({ force: true });
  } finally {
    setLatencyFetching(sectionName, false);
  }
}

async function followLatencyTestJob(jobId: string, sectionName: string) {
  if (followedLatencyJobs.has(jobId)) {
    return;
  }

  followedLatencyJobs.add(jobId);

  try {
    const response = await ForkopShellMethods.waitLatencyTestJob(
      jobId,
      (state) => {
        if (!pageUnloading && state.running) {
          setLatencyFetching(
            sectionName,
            true,
            false,
            state.progress,
            state.latency_type === 'proxy' ? state.tag : undefined,
          );
        }
      },
    );

    if (!response.success) {
      throw new Error(response.error);
    }
    if (!response.data.success) {
      showToast(response.data.message || _('Latency test failed'), 'error');
    }

    await completeLatencyTestJob(jobId, sectionName);
  } catch (error) {
    logger.error('[DASHBOARD]', 'followLatencyTestJob failed', error);
    if (!pageUnloading) {
      setLatencyFetching(sectionName, false);
    }
  } finally {
    followedLatencyJobs.delete(jobId);
  }
}

function followLatencyTestState(state: Forkop.LatencyActionState) {
  const jobId = state.job_id;
  const sectionName = state.section || '';

  if (!jobId || !sectionName) {
    return;
  }

  if (state.running) {
    latencyJobIds[sectionName] = jobId;
    if (shouldShowLoadingForRestoredAction(state)) {
      setLatencyFetching(
        sectionName,
        true,
        false,
        state.progress,
        state.latency_type === 'proxy' ? state.tag : undefined,
      );
    }
    void followLatencyTestJob(jobId, sectionName);
    return;
  }

  if (handledLatencyJobs.has(jobId)) {
    return;
  }

  void completeLatencyTestJob(jobId, sectionName).catch((error) => {
    logger.error('[DASHBOARD]', 'completeLatencyTestJob failed', error);
    if (!pageUnloading) setLatencyFetching(sectionName, false);
  });
}

async function cancelLatencyTest(sectionName: string) {
  latencyCancelRequests.add(sectionName);
  if (!cancellingLatencySections.has(sectionName)) {
    cancellingLatencySections.add(sectionName);
    renderSectionsWidget();
  }

  const jobId = latencyJobIds[sectionName];
  if (!jobId || cancellingLatencyJobs.has(jobId)) {
    return;
  }

  cancellingLatencyJobs.add(jobId);
  const response = await ForkopShellMethods.latencyTestCancel(jobId);
  if (!response.success) {
    cancellingLatencyJobs.delete(jobId);
    latencyCancelRequests.delete(sectionName);
    cancellingLatencySections.delete(sectionName);
    renderSectionsWidget();
    logger.error('[DASHBOARD]', 'cancelLatencyTest failed', response.error);
  }
}

function followDashboardActionsFromUiState(uiState: Forkop.UiState) {
  for (const state of uiState.actions.latency || []) {
    if (state.running || (state.job_id && state.section)) {
      followLatencyTestState(state);
    } else if (state.job_id && !handledLatencyJobs.has(state.job_id)) {
      handledLatencyJobs.add(state.job_id);
      queueLatencyAck(state.job_id);
    }
  }
}

function startActionStateWatcher() {
  if (actionStateUnsubscribe) {
    return;
  }

  actionStateUnsubscribe = subscribeRuntimeUiState((uiState) => {
    if (dashboardMounted) {
      followDashboardActionsFromUiState(uiState);
    }
  });
}

function stopActionStateWatcher() {
  if (!actionStateUnsubscribe) {
    return;
  }

  actionStateUnsubscribe();
  actionStateUnsubscribe = null;
}

async function connectToClashSockets(dataUpdatesId: number) {
  const mountId = dashboardMountId;
  const clashApiSecret = await getClashApiSecret();

  if (
    !dashboardMounted ||
    mountId !== dashboardMountId ||
    dataUpdatesId !== dashboardDataUpdatesId ||
    getDashboardServiceAvailability() === 'stopped'
  ) {
    return;
  }

  socket.subscribe(
    `${getClashWsUrl()}/traffic?token=${clashApiSecret}`,
    (msg) => {
      if (
        dataUpdatesId !== dashboardDataUpdatesId ||
        getDashboardServiceAvailability() === 'stopped'
      ) {
        return;
      }

      const parsedMsg = JSON.parse(msg);

      store.set({
        bandwidthWidget: {
          loading: false,
          failed: false,
          data: { up: parsedMsg.up, down: parsedMsg.down },
        },
      });
    },
    (_err) => {
      if (
        dataUpdatesId !== dashboardDataUpdatesId ||
        getDashboardServiceAvailability() === 'stopped'
      ) {
        return;
      }

      logger.error(
        '[DASHBOARD]',
        'connectToClashSockets - traffic: failed to connect to',
        getClashWsUrl(),
      );
      store.set({
        bandwidthWidget: {
          loading: false,
          failed: true,
          data: { up: 0, down: 0 },
        },
      });
    },
  );

  socket.subscribe(
    `${getClashWsUrl()}/connections?token=${clashApiSecret}`,
    (msg) => {
      if (
        dataUpdatesId !== dashboardDataUpdatesId ||
        getDashboardServiceAvailability() === 'stopped'
      ) {
        return;
      }

      const parsedMsg = JSON.parse(msg);

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
      if (
        dataUpdatesId !== dashboardDataUpdatesId ||
        getDashboardServiceAvailability() === 'stopped'
      ) {
        return;
      }

      logger.error(
        '[DASHBOARD]',
        'connectToClashSockets - connections: failed to connect to',
        getClashWsUrl(),
      );
      store.set({
        trafficTotalWidget: {
          loading: false,
          failed: true,
          data: { downloadTotal: 0, uploadTotal: 0 },
        },
        systemInfoWidget: {
          loading: false,
          failed: true,
          data: {
            connections: 0,
            memory: 0,
          },
        },
      });
    },
  );
}

function getDashboardServiceAvailability() {
  const service = store.get().servicesInfoWidget;

  return getServiceAvailability({
    loading: service.loading,
    failed: service.failed,
    running: service.data.forkopRunning,
  });
}

function stopDashboardDataUpdates() {
  dashboardDataUpdatesStarted = false;
  dashboardDataUpdatesId += 1;

  if (sectionsRefreshTimer) {
    clearInterval(sectionsRefreshTimer);
    sectionsRefreshTimer = null;
  }

  sectionsRefreshQueued = false;
  socket.resetAll();
}

function startDashboardDataUpdates() {
  if (
    dashboardDataUpdatesStarted ||
    !dashboardMounted ||
    getDashboardServiceAvailability() === 'stopped'
  ) {
    return;
  }

  dashboardDataUpdatesStarted = true;
  const dataUpdatesId = ++dashboardDataUpdatesId;
  void fetchDashboardSections({ force: true });
  void connectToClashSockets(dataUpdatesId);
  sectionsRefreshTimer = setInterval(() => {
    void fetchDashboardSections();
  }, SECTIONS_REFRESH_INTERVAL_MS);
}

function syncDashboardServiceAvailability() {
  const availability = getDashboardServiceAvailability();
  const stopped = availability === 'stopped';
  const container = document.getElementById('dashboard-status');

  container?.classList.toggle('fkp_dashboard-page--service-stopped', stopped);

  if (stopped || availability === 'loading') {
    stopDashboardDataUpdates();
    return;
  }

  startDashboardDataUpdates();
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
    sectionsWidget.selectorSwitchingSections[sectionName] ||
    section.outbounds.some(
      (outbound) => outbound.code === tag && outbound.selected,
    )
  ) {
    return;
  }

  setSelectorSwitching(sectionName, tag);

  try {
    await ForkopShellMethods.setClashApiGroupProxy(selector, tag);
    await fetchDashboardSections({ force: true });
  } finally {
    setSelectorSwitching(sectionName);
  }
}

function getInitialLatencyProgress(
  latencyType: Forkop.LatencyActionState['latency_type'],
  tag: string,
): Forkop.LatencyActionProgress | undefined {
  if (latencyType !== 'proxy_list') {
    return { completed: 0, total: 1, failed: 0, pending: [tag] };
  }

  try {
    const tags = JSON.parse(tag);
    if (!Array.isArray(tags)) {
      return undefined;
    }

    const pending = tags.filter(
      (item) => typeof item === 'string' && item.length > 0,
    ) as string[];

    return pending.length > 0
      ? { completed: 0, total: pending.length, failed: 0, pending }
      : undefined;
  } catch {
    return undefined;
  }
}

async function handleTestLatency(
  latencyType: Forkop.LatencyActionState['latency_type'],
  sectionName: string,
  tag: string,
  timeout?: string,
  target?: string,
) {
  if (store.get().sectionsWidget.latencyFetchingSections[sectionName]) {
    await cancelLatencyTest(sectionName);
    return;
  }

  setLatencyFetching(
    sectionName,
    true,
    true,
    getInitialLatencyProgress(latencyType, tag),
    target,
  );
  try {
    const startResponse = await ForkopShellMethods.latencyTestStart(
      latencyType,
      sectionName,
      tag,
      timeout,
    );

    if (!startResponse.success) {
      throw new Error(startResponse.error);
    }

    const jobId = startResponse.data.job_id;
    latencyJobIds[sectionName] = jobId;
    if (latencyCancelRequests.has(sectionName)) {
      await cancelLatencyTest(sectionName);
    }
    await followLatencyTestJob(jobId, sectionName);
  } catch (error) {
    logger.error('[DASHBOARD]', 'handleTestLatency: failed', error);
    setLatencyFetching(sectionName, false);
  }
}

async function handleCopyOutbound(outbound: Forkop.Outbound) {
  const link = await resolveOutboundProxyLink(
    outbound,
    ForkopShellMethods.getClashApiProxyLink,
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

function getUrlTestLatencyClass(latency: number) {
  if (!latency) {
    return 'fkp_dashboard-page__outbound-grid__item__latency--empty';
  }

  if (latency < 800) {
    return 'fkp_dashboard-page__outbound-grid__item__latency--green';
  }

  if (latency < 1500) {
    return 'fkp_dashboard-page__outbound-grid__item__latency--yellow';
  }

  return 'fkp_dashboard-page__outbound-grid__item__latency--red';
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
              { class: getUrlTestLatencyClass(selectedMember.latency) },
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
    { label: _('Testing URL'), children: [renderDetailsUrl(info.url)] },
    { label: _('Interval'), value: info.interval },
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
                        { class: getUrlTestLatencyClass(member.latency) },
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
              { class: getUrlTestLatencyClass(selectedMember.latency) },
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

function renderFallbackInfoModal(outbound: Forkop.Outbound) {
  const info = outbound.fallbackInfo;

  if (!info) {
    return E('div', {}, _('Fallback details are unavailable'));
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
    { label: _('Check interval'), value: info.healthCheckInterval },
    { label: _('Availability timeout'), value: info.healthCheckTimeout },
    { label: _('Maximum failed attempts'), value: info.maxFailedTimes },
    {
      label: _('Expected status'),
      value: info.expectedStatus === '*' ? _('Any') : info.expectedStatus,
    },
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
                      E(
                        'b',
                        {
                          class:
                            'fkp_dashboard-page__urltest-details__fallback-name',
                        },
                        renderFallbackMemberName(member),
                      ),
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
                        { class: getUrlTestLatencyClass(member.latency) },
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

function handleShowFallbackInfo(outbound: Forkop.Outbound) {
  if (!outbound.fallbackInfo) {
    return;
  }

  ui.showModal(
    `${_('Fallback details')}: ${
      outbound.fallbackInfo.displayName || outbound.displayName
    }`,
    renderFallbackInfoModal(outbound),
  );
}

async function handleUpdateSubscription(section: Forkop.OutboundGroup) {
  if (
    store.get().sectionsWidget.subscriptionUpdatingSections[section.sectionName]
  ) {
    return;
  }

  setSubscriptionUpdating(section.sectionName, true, true);

  try {
    const response = await ForkopShellMethods.subscriptionUpdate(
      section.sectionName,
    );

    if (!response.success) {
      throw new Error(response.error);
    }
    if (!pageUnloading) {
      showToast(_('Subscriptions updated'), 'success');
      void fetchDashboardSections({ force: true });
      void fetchServicesInfo();
    }
  } catch (error) {
    logger.error('[DASHBOARD]', 'handleUpdateSubscription: failed', error);
    if (!pageUnloading) {
      showToast(_('Failed to update subscriptions'), 'error');
    }
  } finally {
    setSubscriptionUpdating(section.sectionName, false);
  }
}

function shallowRecordEqual<T>(
  left: Record<string, T>,
  right: Record<string, T>,
) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => left[key] === right[key]);
}

function hasSameLatencyCardStructure(
  left: Forkop.OutboundGroup[],
  right: Forkop.OutboundGroup[],
) {
  return (
    left.length === right.length &&
    left.every(
      (section, sectionIndex) =>
        section.sectionName === right[sectionIndex]?.sectionName &&
        section.outbounds.length === right[sectionIndex]?.outbounds.length &&
        section.outbounds.every(
          (outbound, outboundIndex) =>
            outbound.code ===
            right[sectionIndex]?.outbounds[outboundIndex]?.code,
        ),
    )
  );
}

function canUpdateLatencyProgressInline(
  prev: StoreType['sectionsWidget'],
  next: StoreType['sectionsWidget'],
) {
  return (
    prev.loading === next.loading &&
    prev.failed === next.failed &&
    (prev.data === next.data ||
      (Object.keys(next.latencyFetchingSections).length > 0 &&
        hasSameLatencyCardStructure(prev.data, next.data))) &&
    shallowRecordEqual(
      prev.latencyFetchingSections,
      next.latencyFetchingSections,
    ) &&
    shallowRecordEqual(
      prev.subscriptionUpdatingSections,
      next.subscriptionUpdatingSections,
    ) &&
    shallowRecordEqual(
      prev.selectorSwitchingSections,
      next.selectorSwitchingSections,
    )
  );
}

function findLatencyTestButton(container: HTMLElement, sectionName: string) {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      `.${LATENCY_TEST_BUTTON_CLASS}`,
    ),
  ).find((button) => button.dataset.latencySection === sectionName);
}

function updateLatencyProgressInline(
  prev: StoreType['sectionsWidget'],
  sectionsWidget: StoreType['sectionsWidget'],
) {
  const container = document.getElementById('dashboard-sections-grid');

  if (!container) {
    return false;
  }

  const dataChanged = prev.data !== sectionsWidget.data;

  for (const section of sectionsWidget.data) {
    if (!sectionsWidget.latencyFetchingSections[section.sectionName]) {
      continue;
    }

    const button = findLatencyTestButton(container, section.sectionName);
    const label = button?.querySelector<HTMLElement>(
      `.${LATENCY_TEST_BUTTON_LABEL_CLASS}`,
    );

    if (!label) {
      return false;
    }

    const text = getLatencyTestLabel(
      sectionsWidget.latencyProgressSections[section.sectionName],
    );

    if (label.textContent !== text) {
      label.textContent = text;
    }

    if (!dataChanged) {
      continue;
    }

    const progress =
      sectionsWidget.latencyProgressSections[section.sectionName];
    if (!Array.isArray(progress?.pending)) {
      continue;
    }

    const pending = getPendingLatencyTags(section, progress);
    const latencyButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-latency-targets]'),
    ).filter(
      (latencyButton) =>
        latencyButton.dataset.latencySection === section.sectionName,
    );
    const exactTarget = latencyFetchingTargets[section.sectionName];
    const hasExactTarget = section.outbounds.some(
      (outbound) => outbound.code === exactTarget,
    );

    for (const latencyButton of latencyButtons) {
      let targets: string[];
      try {
        const value = JSON.parse(latencyButton.dataset.latencyTargets || '[]');
        if (!Array.isArray(value)) {
          return false;
        }
        targets = value;
      } catch {
        return false;
      }

      const outbound = section.outbounds.find(
        (item) => item.code === latencyButton.dataset.latencyCode,
      );
      if (!outbound) {
        return false;
      }

      const latencyValue = latencyButton.querySelector<HTMLElement>(
        `.${OUTBOUND_LATENCY_VALUE_CLASS}`,
      );
      if (!latencyValue) {
        return false;
      }

      latencyValue.textContent = outbound.latency
        ? `${outbound.latency}ms`
        : 'N/A';
      latencyButton.classList.remove(...OUTBOUND_LATENCY_STATE_CLASSES);
      latencyButton.classList.add(getOutboundLatencyClass(outbound.latency));

      const active = hasExactTarget
        ? latencyButton.dataset.latencyCode === exactTarget
        : targets.some((tag) => pending.has(tag));
      if (active === (latencyButton.getAttribute('aria-busy') === 'true')) {
        continue;
      }

      const icon = latencyButton.querySelector('svg');
      if (!icon) {
        return false;
      }

      icon.replaceWith(
        active ? renderLoaderCircleIcon24() : renderRotateCcwIcon24(),
      );
      if (active) {
        latencyButton.setAttribute('aria-busy', 'true');
      } else {
        latencyButton.removeAttribute('aria-busy');
      }
    }
  }

  return true;
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
    const renderedWidget = renderSections({
      loading: sectionsWidget.loading,
      failed: sectionsWidget.failed,
      section: {
        code: '',
        sectionName: '',
        displayName: '',
        outbounds: [],
        withTagSelect: false,
      },
      onTestLatency: () => {},
      onTestOutboundLatency: () => {},
      onChooseOutbound: () => {},
      onCopyOutbound: () => {},
      onShowUrlTestInfo: () => {},
      onShowFallbackInfo: () => {},
      onUpdateSubscription: () => {},
      latencyFetching: false,
      latencyProgress: undefined,
      subscriptionUpdating: false,
      selectorSwitchingTag: undefined,
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
      latencyFetching: Boolean(
        sectionsWidget.latencyFetchingSections[section.sectionName],
      ),
      latencyCancelling: cancellingLatencySections.has(section.sectionName),
      latencyProgress:
        sectionsWidget.latencyProgressSections[section.sectionName],
      latencyFetchingTarget: latencyFetchingTargets[section.sectionName],
      subscriptionUpdating: Boolean(
        sectionsWidget.subscriptionUpdatingSections[section.sectionName],
      ),
      selectorSwitchingTag:
        sectionsWidget.selectorSwitchingSections[section.sectionName],
      sortByLatency: latencySortedSections.has(section.sectionName),
      onSortByLatencyChange: handleSortByLatency,
      onTestLatency: (tag) => {
        if (section.withTagSelect) {
          if (Array.isArray(tag)) {
            return handleTestLatency(
              'proxy_list',
              section.sectionName,
              JSON.stringify(tag),
            );
          }

          return handleTestLatency('group', section.sectionName, tag);
        }

        return handleTestLatency(
          'proxy',
          section.sectionName,
          Array.isArray(tag) ? JSON.stringify(tag) : tag,
          section.latencyTestTimeout,
        );
      },
      onTestOutboundLatency: (latencyType, tag) => {
        const serializedTag = Array.isArray(tag) ? JSON.stringify(tag) : tag;
        void handleTestLatency(
          latencyType,
          section.sectionName,
          serializedTag,
          section.latencyTestTimeout,
          serializedTag,
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

  const renderedWidget = renderWidget({
    loading: servicesInfoWidget.loading,
    failed: servicesInfoWidget.failed,
    title: _('Services info'),
    items: [
      {
        key: 'Forkop',
        value: servicesInfoWidget.data.forkopRunning
          ? _('✔ Running')
          : _('✘ Stopped'),
        attributes: {
          class: servicesInfoWidget.data.forkopRunning
            ? 'fkp_dashboard-page__widgets-section__item__row--success'
            : 'fkp_dashboard-page__widgets-section__item__row--error',
        },
      },
      {
        key: 'Sing-box',
        value: servicesInfoWidget.data.singbox
          ? _('✔ Running')
          : _('✘ Stopped'),
        attributes: {
          class: servicesInfoWidget.data.singbox
            ? 'fkp_dashboard-page__widgets-section__item__row--success'
            : 'fkp_dashboard-page__widgets-section__item__row--error',
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
    const inlineUpdated =
      canUpdateLatencyProgressInline(
        prev.sectionsWidget,
        next.sectionsWidget,
      ) &&
      updateLatencyProgressInline(prev.sectionsWidget, next.sectionsWidget);

    if (!inlineUpdated) {
      renderSectionsWidget();
    }
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
    syncDashboardServiceAvailability();
    renderServicesInfoWidget();
  }
}

async function onPageMount() {
  // Cleanup before mount
  onPageUnmount();

  dashboardMounted = true;
  dashboardMountId += 1;
  const mountId = dashboardMountId;
  const hasRuntimeSnapshot = Boolean(getCachedRuntimeUiState());

  if (!hasRuntimeSnapshot) {
    const uiState = await refreshRuntimeUiState({ force: true });

    if (!dashboardMounted || mountId !== dashboardMountId) {
      return;
    }

    if (!uiState) {
      void fetchServicesInfo();
    }
  }

  // Add new listener
  store.subscribe(onStoreUpdate);
  startActionStateWatcher();
  void renderSectionsWidget();
  void renderBandwidthWidget();
  void renderTrafficTotalWidget();
  void renderSystemInfoWidget();
  void renderServicesInfoWidget();
  syncDashboardServiceAvailability();

  if (hasRuntimeSnapshot) {
    void refreshRuntimeUiState({ force: true });
  }
}

function onPageUnmount() {
  dashboardMounted = false;
  dashboardMountId += 1;

  stopDashboardDataUpdates();
  stopActionStateWatcher();
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
