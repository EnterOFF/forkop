import { onMount } from '../../../helpers/onMount';
import { preserveScrollForPage } from '../../../helpers/preserveScrollForPage';
import { runServiceCheck } from './checks/service';
import { runDnsCheck } from './checks/dns';
import { runTrafficCheck } from './checks/traffic';
import { runSectionsCheck } from './checks/sections';
import { runServersCheck } from './checks/servers';
import { CheckOutcome, skipped } from './checks/present';
import { DIAGNOSTICS_CHECKS } from './checks/groups';
import {
  createDiagnosticCheck,
  DiagnosticsCheckOptions,
  diagnosticsCheckCodes,
  getDiagnosticsChecks,
  getLoadingDiagnosticsChecks,
} from './diagnostic.store';
import { checksText, reportText } from './report';
import {
  logger,
  getCachedRuntimeUiState,
  refreshRuntimeUiState,
  refreshRuntimeUiStateNow,
  setLocalServiceAction,
  store,
  StoreType,
  subscribeRuntimeUiState,
} from '../../services';
import { showToast } from '../../../helpers/showToast';
import { ensureSystemInfo } from '../../services/systemInfo.service';
import {
  renderAvailableActions,
  renderCheckSection,
  renderRunAction,
  renderSystemInfo,
} from './partials';
import { ForkopShellMethods } from '../../methods';
import { normalizeCompiledVersion } from '../../../helpers/normalizeCompiledVersion';
import { renderModal } from '../../../partials';
import { FORKOP_LUCI_APP_VERSION } from '../../../constants';
import { Forkop } from '../../types';
import {
  getAutostartControlsPresentation,
  getServiceControlsPresentation,
  getServiceOperation,
  serviceActionFailureMessage,
  shouldDisableDiagnosticRunAction,
} from './serviceTransition';
import type { ServiceOperation } from './serviceTransition';
import { isActiveLuciTab } from '../../helpers/isActiveLuciTab';
import { formatOsRelease } from '../../helpers/osRelease';
import { formatSingBoxVersion } from '../../helpers/singBoxVersion';

let latestCapabilitiesRequestId = 0;
let diagnosticLifecycleRegistered = false;
let diagnosticControllerInitialized = false;
let diagnosticMounted = false;
let diagnosticMountId = 0;
// The check list has two owners. Idle, it is a placeholder naming the checks this
// configuration calls for, and every capability read rebuilds it. From the
// moment a run starts the list is the run's — its progress, and then its result —
// until the page is left behind or a service action makes the result stale.
// Everything else leaves it alone in between: a tab switch puts several
// capability reads in flight at once, and none of them may rebuild the list
// over what the run wrote into it.
let diagnosticsChecksOwnedByRun = false;
const handledServiceActionJobs = new Set<string>();
// What the reader folded or unfolded by hand, per check, until the next run
// lays the list out again: a check with a problem opens, one that passed stays
// a single line.
const checkFolding = new Map<string, boolean>();
// What the service check of the run in flight found.
let forkopRunningInRun = true;
let runServiceData: Forkop.ServiceCheckResult | undefined;

type ServiceRuntimeAction = 'restart' | 'start' | 'stop';
type DiagnosticRunner = {
  code: DIAGNOSTICS_CHECKS;
  run: () => Promise<CheckOutcome>;
};

function getDiagnosticsCheckOptions(
  systemInfo: Pick<
    StoreType['diagnosticsSystemInfo'],
    'server_inbounds_enabled_count'
  > = store.get().diagnosticsSystemInfo,
): DiagnosticsCheckOptions {
  return {
    includeServers: systemInfo.server_inbounds_enabled_count > 0,
  };
}

function getNotRunningDiagnosticsChecks(
  systemInfo = store.get().diagnosticsSystemInfo,
) {
  return getDiagnosticsChecks(
    _('Not running'),
    getDiagnosticsCheckOptions(systemInfo),
  );
}

function rebuildIdleDiagnosticsChecks(
  systemInfo = store.get().diagnosticsSystemInfo,
) {
  if (diagnosticsChecksOwnedByRun) {
    return;
  }

  store.set({
    diagnosticsChecks: getNotRunningDiagnosticsChecks(systemInfo),
  });
}

// Leaving the page and a service action that makes the result stale both end the
// run's claim on the list. A run still filling it in keeps the claim: emptying the
// list under a running pass leaves it writing checks into somebody else's list.
function releaseDiagnosticsChecks() {
  if (store.get().diagnosticsRunAction.loading) {
    return;
  }

  diagnosticsChecksOwnedByRun = false;
  store.set({ diagnosticsRunAction: { loading: false, finished: null } });
  rebuildIdleDiagnosticsChecks();
}

// A click is reflected at once through the local overlay, and the runtime feed
// is the single owner of everything after it: the running operation arrives as
// `service.forkop.busy`, and the job's completion as its action entry flipping
// to running=false. Nothing here polls for either.
function setDiagnosticActionLoading(
  action: keyof StoreType['diagnosticsActions'],
  loading: boolean,
) {
  setLocalServiceAction(action, loading);

  const diagnosticsActions = store.get().diagnosticsActions;

  store.set({
    diagnosticsActions: {
      ...diagnosticsActions,
      [action]: { loading },
    },
  });
}

function isDiagnosticMountActive(mountId = diagnosticMountId) {
  return diagnosticMounted && diagnosticMountId === mountId;
}

function getLocalPendingServiceOperation(
  actions: StoreType['diagnosticsActions'],
): ServiceOperation | null {
  if (actions.restart.loading) {
    return 'restart';
  }
  if (actions.start.loading) {
    return 'start';
  }
  if (actions.stop.loading) {
    return 'stop';
  }
  return null;
}

// Runs on every runtime state notification for the life of the page: a finished
// action is acknowledged once per job, wherever it was started, this page or
// another; the feed keeps reporting a finished action until the acknowledgement
// is collected. A failed one is not said here: every way a start, stop, restart
// or reload fails is written to the log as an error with its reason, and a
// logged error is already raised as an alert.
function settleFinishedServiceActions(uiState: Forkop.UiState) {
  for (const action of uiState.actions.service || []) {
    if (!action.job_id || action.running) {
      continue;
    }

    if (handledServiceActionJobs.has(action.job_id)) {
      continue;
    }

    handledServiceActionJobs.add(action.job_id);
    void ForkopShellMethods.uiActionAck(action.job_id);
    releaseDiagnosticsChecks();
  }
}

async function fetchSystemInfo() {
  rebuildIdleDiagnosticsChecks(await ensureSystemInfo());
}

// A fresh capability read rebuilds the check list unless a run owns it.
function applyDiagnosticsCapabilities(
  nextSystemInfo: StoreType['diagnosticsSystemInfo'],
  resetChecks: boolean,
) {
  const nextState: Partial<StoreType> = {
    diagnosticsSystemInfo: nextSystemInfo,
  };

  if (resetChecks && !diagnosticsChecksOwnedByRun) {
    nextState.diagnosticsChecks =
      getNotRunningDiagnosticsChecks(nextSystemInfo);
  }

  store.set(nextState);
}

async function fetchDiagnosticsCapabilities({
  resetChecks = true,
}: { resetChecks?: boolean } = {}) {
  const requestId = ++latestCapabilitiesRequestId;

  try {
    const uiState = await refreshRuntimeUiState({ force: true });

    if (requestId !== latestCapabilitiesRequestId) {
      return;
    }

    if (uiState) {
      const currentSystemInfo = store.get().diagnosticsSystemInfo;
      const nextSystemInfo = {
        ...currentSystemInfo,
        capabilitiesLoaded: true,
        server_inbounds_enabled_count:
          uiState.capabilities.server_inbounds_enabled_count,
      };

      applyDiagnosticsCapabilities(nextSystemInfo, resetChecks);
      return;
    }

    // Without the runtime feed the number of servers is unknown, and the
    // servers check says for itself whether there is anything to check.
    const nextSystemInfo = {
      ...store.get().diagnosticsSystemInfo,
      capabilitiesLoaded: true,
      server_inbounds_enabled_count: -1,
    };

    applyDiagnosticsCapabilities(nextSystemInfo, resetChecks);
  } catch (error) {
    logger.error('[DIAGNOSTIC]', 'fetchDiagnosticsCapabilities failed', error);

    if (requestId === latestCapabilitiesRequestId) {
      const currentSystemInfo = store.get().diagnosticsSystemInfo;

      store.set({
        diagnosticsSystemInfo: {
          ...currentSystemInfo,
          capabilitiesLoaded: true,
          server_inbounds_enabled_count: -1,
        },
      });
    }
  }
}

function renderDiagnosticsChecks() {
  logger.debug('[DIAGNOSTIC]', 'renderDiagnosticsChecks');
  const diagnosticsChecks = [...store.get().diagnosticsChecks].sort(
    (a, b) => a.order - b.order,
  );
  const container = document.getElementById('fkp_diagnostic-page-checks');

  const renderedDiagnosticsChecks = diagnosticsChecks.map((check) => {
    const expanded =
      checkFolding.get(check.code) ??
      (check.state === 'warning' || check.state === 'error');
    return renderCheckSection(check, {
      expanded,
      onToggle: () => {
        checkFolding.set(check.code, !expanded);
        renderDiagnosticsChecks();
      },
    });
  });

  return preserveScrollForPage(() => {
    container!.replaceChildren(...renderedDiagnosticsChecks);
  });
}

function renderDiagnosticRunActionWidget() {
  logger.debug('[DIAGNOSTIC]', 'renderDiagnosticRunActionWidget');

  const { loading, finished } = store.get().diagnosticsRunAction;
  const { diagnosticsActions, servicesInfoWidget } = store.get();
  const capabilitiesLoaded =
    store.get().diagnosticsSystemInfo.capabilitiesLoaded;
  const container = document.getElementById('fkp_diagnostic-page-run-check');
  const disabled = shouldDisableDiagnosticRunAction({
    capabilitiesLoaded,
    operation: getServiceOperation({
      busy: servicesInfoWidget.data.forkopBusy,
      localPending: getLocalPendingServiceOperation(diagnosticsActions),
    }),
  });

  const renderedAction = renderRunAction({
    loading,
    disabled,
    click: () => runChecks(),
    // The report is the result of a run, so it is offered once one finished.
    report:
      finished && !loading
        ? {
            loading: diagnosticsActions.report.loading,
            disabled: diagnosticsActions.report.loading,
            click: () => handleReport(),
          }
        : null,
  });

  return preserveScrollForPage(() => {
    container!.replaceChildren(renderedAction);
  });
}

// Starting the action is all the click does. The local overlay shows the
// operation until the runtime reports the job, the runtime feed carries it from
// there, and completion - success, failure, acknowledgement - is settled by the
// feed listener. Only a start that never became a job is this handler's to
// clean up, because in that case the feed has nothing to say.
async function handleServiceRuntimeAction(action: ServiceRuntimeAction) {
  setDiagnosticActionLoading(action, true);

  try {
    const startResponse = await ForkopShellMethods.serviceActionStart(action);

    if (!startResponse.success) {
      throw new Error(startResponse.error);
    }
  } catch (e) {
    logger.error('[DIAGNOSTIC]', `handleServiceRuntimeAction(${action})`, e);
    showToast(serviceActionFailureMessage(action), 'error');
    setDiagnosticActionLoading(action, false);
  } finally {
    void refreshRuntimeUiStateNow();
  }
}

async function handleRestart() {
  await handleServiceRuntimeAction('restart');
}

async function handleStart() {
  await handleServiceRuntimeAction('start');
}

async function handleStop() {
  await handleServiceRuntimeAction('stop');
}

// Autostart has no job and no local overlay standing in for it: which of the
// two buttons is shown follows `service.forkop.enabled` and nothing else. So
// the pressed button keeps its spinner until the new value has arrived, and a
// switch that did not move is said out loud.
async function handleAutostartAction(
  action: 'enable' | 'disable',
  request: () => Promise<{ success: boolean }>,
  failure: string,
) {
  setDiagnosticActionLoading(action, true);

  const result = await request().catch(() => ({ success: false }));
  if (!result.success) {
    showToast(failure, 'error');
  }

  await refreshRuntimeUiStateNow();
  setDiagnosticActionLoading(action, false);
}

async function handleEnable() {
  await handleAutostartAction(
    'enable',
    () => ForkopShellMethods.enable(),
    _('Could not enable autostart'),
  );
}

async function handleDisable() {
  await handleAutostartAction(
    'disable',
    () => ForkopShellMethods.disable(),
    _('Could not disable autostart'),
  );
}

// The backend masks what these show, and the values are asked for again only
// when the toggle says to show them.
function diagnosticText(
  load: (
    masked: boolean,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>,
) {
  return async ({ maskValues }: { maskValues: boolean }) => {
    const result = await load(maskValues);
    if (!result.success) {
      throw new Error(result.error || 'Failed to load diagnostics');
    }
    return typeof result.data === 'string'
      ? result.data
      : JSON.stringify(result.data, null, 2);
  };
}

// A diagnostic shown in a dialog. The backend masks what it shows, and a read
// that fails is said rather than only logged.
async function showDiagnosticModal(
  action: 'showConfig' | 'showSingBoxConfig',
  title: string,
  name: string,
  load: (
    masked: boolean,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>,
) {
  setDiagnosticActionLoading(action, true);

  try {
    const getText = diagnosticText(load);
    const text = await getText({ maskValues: true });

    ui.showModal(
      title,
      renderModal(text, name, {
        getText,
        showMaskValuesToggle: true,
      }),
    );
  } catch (error) {
    logger.error('[DIAGNOSTIC]', name, error);
    showToast(_('Failed to load diagnostics'), 'error');
  } finally {
    setDiagnosticActionLoading(action, false);
  }
}

// The report is the checks of the finished run as the page shows them, and
// what the router adds to them. Masked, the router hides the same values in the
// checks as in the rest.
async function buildReport(masked: boolean) {
  const run = store.get().diagnosticsRunAction.finished;
  const attachments = await ForkopShellMethods.report(
    masked,
    checksText(store.get().diagnosticsChecks),
  );
  if (!attachments.success) {
    throw new Error(attachments.error || 'Failed to collect the report');
  }
  return reportText(
    {
      generatedAt: new Date(),
      systemInfo: store.get().diagnosticsSystemInfo,
      luciVersion: normalizeCompiledVersion(FORKOP_LUCI_APP_VERSION),
      service: run?.service,
    },
    attachments.data,
  );
}

async function handleReport() {
  setDiagnosticActionLoading('report', true);

  try {
    const getText = ({ maskValues }: { maskValues: boolean }) =>
      buildReport(maskValues);
    const text = await getText({ maskValues: true });

    ui.showModal(
      _('Diagnostic report'),
      renderModal(text, 'forkop-report', {
        getText,
        showMaskValuesToggle: true,
      }),
    );
  } catch (error) {
    logger.error('[DIAGNOSTIC]', 'report', error);
    showToast(_('Failed to load diagnostics'), 'error');
  } finally {
    setDiagnosticActionLoading('report', false);
  }
}

function handleShowForkopConfig() {
  return showDiagnosticModal(
    'showConfig',
    _('Forkop configuration'),
    'show_config',
    ForkopShellMethods.showConfig,
  );
}

function handleShowSingBoxConfig() {
  return showDiagnosticModal(
    'showSingBoxConfig',
    _('sing-box configuration'),
    'show_sing_box_config',
    ForkopShellMethods.showSingBoxConfig,
  );
}

function renderDiagnosticAvailableActionsWidget() {
  const diagnosticsActions = store.get().diagnosticsActions;
  const servicesInfoWidget = store.get().servicesInfoWidget;
  logger.debug('[DIAGNOSTIC]', 'renderDiagnosticAvailableActionsWidget');

  const forkopEnabled = Boolean(servicesInfoWidget.data.forkopEnabled);
  const forkopRunning = Boolean(servicesInfoWidget.data.forkopRunning);
  const operation = getServiceOperation({
    busy: servicesInfoWidget.data.forkopBusy,
    localPending: getLocalPendingServiceOperation(diagnosticsActions),
  });
  // The widget starts out loading with an empty snapshot; until the first one
  // arrives there is nothing to say about the service.
  const stateKnown = !servicesInfoWidget.loading || servicesInfoWidget.failed;
  const controls = getServiceControlsPresentation({
    running: forkopRunning,
    operation,
    known: stateKnown,
  });
  const autostart = getAutostartControlsPresentation({
    enabled: forkopEnabled,
    enableLoading: diagnosticsActions.enable.loading,
    disableLoading: diagnosticsActions.disable.loading,
    known: stateKnown,
  });

  const container = document.getElementById('fkp_diagnostic-page-actions');

  const renderedActions = renderAvailableActions({
    restart: { ...controls.restart, onClick: handleRestart },
    start: { ...controls.start, onClick: handleStart },
    stop: { ...controls.stop, onClick: handleStop },
    enable: { ...autostart.enable, onClick: handleEnable },
    disable: { ...autostart.disable, onClick: handleDisable },
    // Read-only actions are never gated by service state or by another action:
    // they answer questions, and the questions matter most when something is
    // wrong. Each one still blocks its own double submit while it runs.
    showConfig: {
      loading: diagnosticsActions.showConfig.loading,
      visible: true,
      onClick: handleShowForkopConfig,
      disabled: diagnosticsActions.showConfig.loading,
    },
    showSingBoxConfig: {
      loading: diagnosticsActions.showSingBoxConfig.loading,
      visible: true,
      onClick: handleShowSingBoxConfig,
      disabled: diagnosticsActions.showSingBoxConfig.loading,
    },
  });

  return preserveScrollForPage(() => {
    container!.replaceChildren(renderedActions);
  });
}

function renderDiagnosticSystemInfoWidget() {
  logger.debug('[DIAGNOSTIC]', 'renderDiagnosticSystemInfoWidget');
  const diagnosticsSystemInfo = store.get().diagnosticsSystemInfo;

  const container = document.getElementById('fkp_diagnostic-page-system-info');

  const forkopVersion = normalizeCompiledVersion(
    diagnosticsSystemInfo.forkop_version,
  );
  const luciVersion = normalizeCompiledVersion(FORKOP_LUCI_APP_VERSION);
  // The two packages ship together, so the page's own version is worth a row
  // only when it is not the one the backend reports.
  const items = [
    { key: 'Forkop', value: forkopVersion },
    ...(diagnosticsSystemInfo.loaded && luciVersion !== forkopVersion
      ? [{ key: 'LuCI', value: luciVersion }]
      : []),
    { key: 'sing-box', value: formatSingBoxVersion(diagnosticsSystemInfo) },
    {
      key: _('OS'),
      value: formatOsRelease(diagnosticsSystemInfo.openwrt_version),
    },
    { key: _('Device'), value: diagnosticsSystemInfo.device_model },
  ];

  const renderedSystemInfo = renderSystemInfo({
    items,
  });

  return preserveScrollForPage(() => {
    container!.replaceChildren(renderedSystemInfo);
  });
}

async function onStoreUpdate(
  _next: StoreType,
  _prev: StoreType,
  diff: Partial<StoreType>,
) {
  if (diff.diagnosticsChecks) {
    renderDiagnosticsChecks();
  }

  if (
    diff.diagnosticsRunAction ||
    diff.diagnosticsSystemInfo ||
    diff.diagnosticsActions ||
    diff.servicesInfoWidget
  ) {
    renderDiagnosticRunActionWidget();
  }

  if (diff.diagnosticsActions || diff.servicesInfoWidget) {
    renderDiagnosticAvailableActionsWidget();
  }

  if (diff.diagnosticsSystemInfo) {
    renderDiagnosticSystemInfoWidget();
  }
}

function setDiagnosticCheck(code: DIAGNOSTICS_CHECKS, result: CheckOutcome) {
  const other = store
    .get()
    .diagnosticsChecks.filter((item) => item.code !== code);

  store.set({
    diagnosticsChecks: [
      ...other,
      { ...createDiagnosticCheck(code, result.description), ...result },
    ],
  });
}

// Everything after the service check needs the runtime; with Forkop down they
// would only repeat that it is down, each in its own words.
function getDiagnosticRunners(
  checkOptions: DiagnosticsCheckOptions,
): DiagnosticRunner[] {
  const runners: Record<DIAGNOSTICS_CHECKS, () => Promise<CheckOutcome>> = {
    [DIAGNOSTICS_CHECKS.SERVICE]: async () => {
      const service = await runServiceCheck();
      runServiceData = service.data;
      forkopRunningInRun = service.running;
      return service.result;
    },
    [DIAGNOSTICS_CHECKS.DNS]: runDnsCheck,
    [DIAGNOSTICS_CHECKS.TRAFFIC]: runTrafficCheck,
    [DIAGNOSTICS_CHECKS.SECTIONS]: runSectionsCheck,
    [DIAGNOSTICS_CHECKS.SERVERS]: runServersCheck,
  };

  return diagnosticsCheckCodes(checkOptions).map((code) => ({
    code,
    run: () =>
      code === DIAGNOSTICS_CHECKS.SERVICE || forkopRunningInRun
        ? runners[code]()
        : Promise.resolve(skipped(_('Skipped: Forkop is not running'))),
  }));
}

// One pass, one page session. The run outlives the tab that started it: a LuCI tab
// switch unmounts the page while the loop below keeps writing checks into the
// shared store, so coming back just re-renders where it got to. The guard is what
// keeps that to a single pass — every other entry point, a second click or a
// remount, has to find the run already in flight and leave it alone.
async function runChecks() {
  if (store.get().diagnosticsRunAction.loading) {
    return;
  }

  let finished: StoreType['diagnosticsRunAction']['finished'] = null;
  diagnosticsChecksOwnedByRun = true;
  checkFolding.clear();
  store.set({
    diagnosticsRunAction: { loading: true, finished: null },
    diagnosticsChecks: getLoadingDiagnosticsChecks(getDiagnosticsCheckOptions())
      .diagnosticsChecks,
  });

  try {
    await fetchDiagnosticsCapabilities({ resetChecks: false });

    // A run checks the servers unless it knows there are none.
    const checkOptions = {
      includeServers:
        store.get().diagnosticsSystemInfo.server_inbounds_enabled_count !== 0,
    };

    store.set({
      diagnosticsChecks:
        getLoadingDiagnosticsChecks(checkOptions).diagnosticsChecks,
    });

    forkopRunningInRun = true;
    runServiceData = undefined;

    for (const runner of getDiagnosticRunners(checkOptions)) {
      setDiagnosticCheck(runner.code, {
        state: 'loading',
        description: _('Checking, please wait'),
        items: [],
      });

      try {
        setDiagnosticCheck(runner.code, await runner.run());
      } catch (e) {
        logger.error('[DIAGNOSTIC]', `runChecks - ${runner.code} failed`, e);
        setDiagnosticCheck(runner.code, {
          state: 'error',
          description: _('Cannot receive checks result'),
          items: [],
        });
      }
    }

    finished = { service: runServiceData };
  } catch (e) {
    logger.error('[DIAGNOSTIC]', 'runChecks - e', e);
  } finally {
    store.set({ diagnosticsRunAction: { loading: false, finished } });
  }
}

async function loadInitialDiagnosticData() {
  const diagnosticStatus = document.getElementById('diagnostic-status');

  if (diagnosticStatus?.isConnected && diagnosticStatus.offsetParent !== null) {
    if (store.get().diagnosticsRunAction.loading) {
      return;
    }

    await fetchSystemInfo();
    await fetchDiagnosticsCapabilities();
  }
}

// Whichever mount is current owns the listeners. Detaching says nothing about the
// check list: that belongs to the page being left, and to the run that may still
// be writing into it.
function detachDiagnosticPage() {
  diagnosticMounted = false;
  diagnosticMountId += 1;

  // Remove old listener
  store.unsubscribe(onStoreUpdate);
}

async function onPageMount() {
  // Cleanup before mount
  detachDiagnosticPage();

  diagnosticMounted = true;
  diagnosticMountId += 1;
  const mountId = diagnosticMountId;
  const hasRuntimeSnapshot = Boolean(getCachedRuntimeUiState());

  if (!hasRuntimeSnapshot) {
    await refreshRuntimeUiState({ force: true });

    if (!isDiagnosticMountActive(mountId)) {
      return;
    }
  }

  // Add new listener
  store.subscribe(onStoreUpdate);

  // Initial checks render
  renderDiagnosticsChecks();

  // Initial run checks action render
  renderDiagnosticRunActionWidget();

  // Initial available actions render
  renderDiagnosticAvailableActionsWidget();

  // Initial system info render
  renderDiagnosticSystemInfoWidget();

  if (hasRuntimeSnapshot) {
    void refreshRuntimeUiState({ force: true });
  }

  void loadInitialDiagnosticData();
}

function onPageUnmount() {
  detachDiagnosticPage();
  releaseDiagnosticsChecks();
}

function registerLifecycleListeners() {
  if (diagnosticLifecycleRegistered) {
    return;
  }

  diagnosticLifecycleRegistered = true;

  store.subscribe((next, prev, diff) => {
    if (
      diff.tabService &&
      next.tabService.current !== prev.tabService.current
    ) {
      logger.debug(
        '[DIAGNOSTIC]',
        'active tab diff event, active tab:',
        diff.tabService.current,
      );
      const isDIAGNOSTICVisible = next.tabService.current === 'diagnostic';

      if (isDIAGNOSTICVisible) {
        logger.debug(
          '[DIAGNOSTIC]',
          'registerLifecycleListeners',
          'onPageMount',
        );
        return onPageMount();
      }

      if (!isDIAGNOSTICVisible) {
        logger.debug(
          '[DIAGNOSTIC]',
          'registerLifecycleListeners',
          'onPageUnmount',
        );
        return onPageUnmount();
      }
    }
  });
}

export async function initController(): Promise<void> {
  if (diagnosticControllerInitialized) {
    return;
  }

  diagnosticControllerInitialized = true;

  // For the life of the page, not the tab: a service action keeps running when
  // the user wanders off to another tab, and its acknowledgement and failure
  // report belong to whoever sees the feed next, not to a mount.
  subscribeRuntimeUiState(settleFinishedServiceActions);

  onMount('diagnostic-status').then(() => {
    logger.debug('[DIAGNOSTIC]', 'initController', 'onMount');
    registerLifecycleListeners();
    if (
      store.get().tabService.current === 'diagnostic' ||
      isActiveLuciTab('diagnostic')
    ) {
      onPageMount();
    }
  });
}
