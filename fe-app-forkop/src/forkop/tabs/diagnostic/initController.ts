import { onMount, preserveScrollForPage } from '../../../helpers';
import { runDnsCheck } from './checks/runDnsCheck';
import { runSingBoxCheck } from './checks/runSingBoxCheck';
import { runInboundsCheck } from './checks/runInboundsCheck';
import { runNftCheck } from './checks/runNftCheck';
import { runFakeIPCheck } from './checks/runFakeIPCheck';
import { runZapretCheck } from './checks/runZapretCheck';
import { runZapret2Check } from './checks/runZapret2Check';
import { runByedpiCheck } from './checks/runByedpiCheck';
import {
  DIAGNOSTICS_CHECKS,
  DIAGNOSTICS_CHECKS_MAP,
} from './checks/contstants';
import {
  DiagnosticsProviderOptions,
  getDiagnosticsChecks,
  getLoadingDiagnosticsChecks,
} from './diagnostic.store';
import {
  logger,
  getCachedRuntimeUiState,
  refreshRuntimeUiState,
  setLocalServiceAction,
  store,
  StoreType,
  subscribeRuntimeUiState,
} from '../../services';
import { ensureSystemInfo } from '../../services/systemInfo.service';
import {
  renderAvailableActions,
  renderCheckSection,
  renderRunAction,
  renderSystemInfo,
} from './partials';
import { CustomForkopMethods, ForkopShellMethods } from '../../methods';
import { fetchServicesInfo } from '../../fetchers/fetchServicesInfo';
import { normalizeCompiledVersion } from '../../../helpers/normalizeCompiledVersion';
import { renderModal } from '../../../partials';
import { FORKOP_LUCI_APP_VERSION } from '../../../constants';
import { runSectionsCheck } from './checks/runSectionsCheck';
import { Forkop } from '../../types';
import {
  getAvailableActionsDisabledState,
  getServiceTransition,
  hasComponentActionLoading,
  hasLocalMutatingServiceActionLoading,
  isServiceTransitionStatus,
  shouldDisableDiagnosticRunAction,
  shouldSkipServicesInfoAutoRefresh,
  shouldShowRestartAction,
  shouldShowStartAction,
  shouldShowStopAction,
} from './serviceTransition';
import { isActiveLuciTab } from '../../helpers/isActiveLuciTab';
import { formatOsRelease } from '../../helpers/osRelease';
import { formatSingBoxVersion } from '../../helpers/singBoxVersion';
import {
  formatMaskedSingBoxConfig,
  maskGlobalCheckText,
  stringifySingBoxConfig,
} from './helpers/maskDiagnostics';

const SERVICE_STATUS_REFRESH_INTERVAL_MS = 2000;
const SERVICE_ACTION_STATUS_TIMEOUT_MS = 45000;

let latestProviderInfoRequestId = 0;
let diagnosticLifecycleRegistered = false;
let diagnosticControllerInitialized = false;
let diagnosticMounted = false;
let diagnosticMountId = 0;
// The check list has two owners. Idle, it is a placeholder naming the checks the
// installed providers call for, and every capability read rebuilds it. From the
// moment a run starts the list is the run's — its progress, and then its result —
// until the page is left behind or a service action makes the result stale.
// Everything else has to leave it alone in between: a tab switch puts several
// capability reads in flight at once, and whichever landed last used to rebuild
// the list on top of what the run had just written into it.
let diagnosticsChecksOwnedByRun = false;
let servicesInfoStateUnsubscribe: (() => void) | null = null;
let servicesInfoRefreshPromise: Promise<void> | null = null;
const followedServiceActionJobs = new Set<string>();
const handledServiceActionJobs = new Set<string>();

type ServiceRuntimeAction = 'restart' | 'start' | 'stop';
type DiagnosticRunner = {
  code: DIAGNOSTICS_CHECKS;
  run: () => Promise<void>;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function getDiagnosticsProviderOptions(
  systemInfo: Pick<
    StoreType['diagnosticsSystemInfo'],
    | 'zapret_installed'
    | 'zapret2_installed'
    | 'byedpi_installed'
    | 'server_inbounds_enabled_count'
  > = store.get().diagnosticsSystemInfo,
): DiagnosticsProviderOptions {
  return {
    includeZapret: Boolean(systemInfo.zapret_installed),
    includeZapret2: Boolean(systemInfo.zapret2_installed),
    includeByedpi: Boolean(systemInfo.byedpi_installed),
    includeInbounds: systemInfo.server_inbounds_enabled_count > 0,
  };
}

function getNotRunningDiagnosticsChecks(
  systemInfo = store.get().diagnosticsSystemInfo,
) {
  return getDiagnosticsChecks(
    _('Not running'),
    getDiagnosticsProviderOptions(systemInfo),
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
  rebuildIdleDiagnosticsChecks();
}

function setDiagnosticActionLoading(
  action: keyof StoreType['diagnosticsActions'],
  loading: boolean,
  local = false,
) {
  if (local || !loading) {
    setLocalServiceAction(action, loading && local);
  }

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

function isLocalMutatingServiceActionLoading() {
  const actions = store.get().diagnosticsActions;

  return hasLocalMutatingServiceActionLoading(actions);
}

function isMutatingServiceActionLoading() {
  return (
    isLocalMutatingServiceActionLoading() ||
    isServiceTransitionStatus(store.get().servicesInfoWidget.data.forkopStatus)
  );
}

function getForkopStatusText(running: boolean, enabled: boolean) {
  if (running) {
    return enabled ? 'running & enabled' : 'running but disabled';
  }

  return enabled ? 'stopped but enabled' : 'stopped & disabled';
}

function setDisplayedForkopRunning(running: boolean) {
  const servicesInfoWidget = store.get().servicesInfoWidget;
  const enabled = Boolean(servicesInfoWidget.data.forkopEnabled);

  store.set({
    servicesInfoWidget: {
      ...servicesInfoWidget,
      loading: false,
      data: {
        ...servicesInfoWidget.data,
        forkopRunning: running ? 1 : 0,
        forkopStatus: getForkopStatusText(running, enabled),
      },
    },
  });
}

async function refreshDiagnosticServicesInfo({
  force = false,
  mountId = diagnosticMountId,
  allowInactive = false,
}: {
  force?: boolean;
  mountId?: number;
  allowInactive?: boolean;
} = {}) {
  if (!allowInactive && !isDiagnosticMountActive(mountId)) {
    return;
  }

  if (
    shouldSkipServicesInfoAutoRefresh({
      force,
      localMutatingActionLoading: isLocalMutatingServiceActionLoading(),
    })
  ) {
    return;
  }

  if (servicesInfoRefreshPromise) {
    return servicesInfoRefreshPromise;
  }

  const promise = fetchServicesInfo()
    .then((uiState) => {
      followServiceActionsFromUiState(uiState);
    })
    .catch((error) => {
      logger.error(
        '[DIAGNOSTIC]',
        'refreshDiagnosticServicesInfo failed',
        error,
      );
    })
    .finally(() => {
      if (servicesInfoRefreshPromise === promise) {
        servicesInfoRefreshPromise = null;
      }
    });

  servicesInfoRefreshPromise = promise;
  return promise;
}

async function waitForForkopRunningState(expectedRunning: boolean) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SERVICE_ACTION_STATUS_TIMEOUT_MS) {
    await refreshDiagnosticServicesInfo({ force: true, allowInactive: true });

    const forkopRunning = Boolean(
      store.get().servicesInfoWidget.data.forkopRunning,
    );

    if (forkopRunning === expectedRunning) {
      return true;
    }

    await sleep(SERVICE_STATUS_REFRESH_INTERVAL_MS);
  }

  return false;
}

function startServiceActionStateWatcher() {
  if (servicesInfoStateUnsubscribe) {
    return;
  }

  servicesInfoStateUnsubscribe = subscribeRuntimeUiState((uiState) => {
    if (diagnosticMounted) {
      followServiceActionsFromUiState(uiState);
    }
  });
}

function stopServiceActionStateWatcher() {
  if (!servicesInfoStateUnsubscribe) {
    return;
  }

  servicesInfoStateUnsubscribe();
  servicesInfoStateUnsubscribe = null;
}

function isVisibleServiceRuntimeAction(
  action: Forkop.ServiceActionState['action'],
): action is ServiceRuntimeAction {
  return action === 'restart' || action === 'start' || action === 'stop';
}

function setServiceActionStateLoading(
  state: Forkop.ServiceActionState,
  loading: boolean,
) {
  if (!isVisibleServiceRuntimeAction(state.action)) {
    return;
  }

  setDiagnosticActionLoading(state.action, loading);
}

async function followServiceActionState(state: Forkop.ServiceActionState) {
  const jobId = state.job_id;

  if (!jobId || followedServiceActionJobs.has(jobId)) {
    return;
  }

  if (!state.running && handledServiceActionJobs.has(jobId)) {
    return;
  }

  followedServiceActionJobs.add(jobId);
  if (state.running) {
    setServiceActionStateLoading(state, true);
  }

  try {
    if (state.running) {
      await ForkopShellMethods.waitServiceActionJob(jobId);
    }
  } catch (error) {
    logger.error('[DIAGNOSTIC]', 'followServiceActionState failed', error);
  } finally {
    handledServiceActionJobs.add(jobId);
    setServiceActionStateLoading(state, false);
    await refreshDiagnosticServicesInfo({ force: true, allowInactive: true });
    void ForkopShellMethods.uiActionAck('service', jobId);
    followedServiceActionJobs.delete(jobId);
    releaseDiagnosticsChecks();
  }
}

function followServiceActionsFromUiState(uiState?: Forkop.UiState) {
  if (!uiState) {
    return;
  }

  for (const action of uiState.actions.service || []) {
    if (action.job_id) {
      void followServiceActionState(action);
    }
  }
}

async function fetchSystemInfo() {
  rebuildIdleDiagnosticsChecks(await ensureSystemInfo());
}

// A provider that is not installed has no version to show, and a fresh capability
// read rebuilds the check list unless a run owns it.
function applyDiagnosticsProviderInfo(
  nextSystemInfo: StoreType['diagnosticsSystemInfo'],
  resetChecks: boolean,
) {
  if (!nextSystemInfo.zapret_installed) {
    nextSystemInfo.zapret_version = 'not installed';
  }

  if (!nextSystemInfo.zapret2_installed) {
    nextSystemInfo.zapret2_version = 'not installed';
  }

  if (!nextSystemInfo.byedpi_installed) {
    nextSystemInfo.byedpi_version = 'not installed';
  }

  const nextState: Partial<StoreType> = {
    diagnosticsSystemInfo: nextSystemInfo,
  };

  if (resetChecks && !diagnosticsChecksOwnedByRun) {
    nextState.diagnosticsChecks =
      getNotRunningDiagnosticsChecks(nextSystemInfo);
  }

  store.set(nextState);
}

async function fetchDiagnosticsProviderInfo({
  resetChecks = true,
}: { resetChecks?: boolean } = {}) {
  const requestId = ++latestProviderInfoRequestId;

  try {
    const uiState = await refreshRuntimeUiState({ force: true });

    if (requestId !== latestProviderInfoRequestId) {
      return;
    }

    if (uiState) {
      const currentSystemInfo = store.get().diagnosticsSystemInfo;
      const nextSystemInfo = {
        ...currentSystemInfo,
        providerInfoLoaded: true,
        zapret_installed: uiState.capabilities.zapret_installed,
        zapret2_installed: uiState.capabilities.zapret2_installed,
        byedpi_installed: uiState.capabilities.byedpi_installed,
        server_inbounds_enabled_count:
          uiState.capabilities.server_inbounds_enabled_count,
      };

      applyDiagnosticsProviderInfo(nextSystemInfo, resetChecks);
      return;
    }

    const [zapretRuntime, zapret2Runtime, byedpiRuntime, inboundsConfig] =
      await Promise.all([
        ForkopShellMethods.checkZapretRuntime(),
        ForkopShellMethods.checkZapret2Runtime(),
        ForkopShellMethods.checkByedpiRuntime(),
        ForkopShellMethods.checkInboundsConfig(),
      ]);

    if (requestId !== latestProviderInfoRequestId) {
      return;
    }

    const currentSystemInfo = store.get().diagnosticsSystemInfo;
    const nextSystemInfo = {
      ...currentSystemInfo,
      providerInfoLoaded: true,
      zapret_installed: zapretRuntime.success
        ? zapretRuntime.data.zapret_installed
        : currentSystemInfo.zapret_installed,
      zapret2_installed: zapret2Runtime.success
        ? zapret2Runtime.data.zapret2_installed
        : currentSystemInfo.zapret2_installed,
      byedpi_installed: byedpiRuntime.success
        ? byedpiRuntime.data.byedpi_installed
        : currentSystemInfo.byedpi_installed,
      server_inbounds_enabled_count: inboundsConfig.success
        ? inboundsConfig.data.enabled_count
        : -1,
    };

    if (!zapretRuntime.success) {
      logger.error('[DIAGNOSTIC]', 'fetchZapretRuntime failed', zapretRuntime);
    }

    if (!zapret2Runtime.success) {
      logger.error(
        '[DIAGNOSTIC]',
        'fetchZapret2Runtime failed',
        zapret2Runtime,
      );
    }

    if (!byedpiRuntime.success) {
      logger.error('[DIAGNOSTIC]', 'fetchByedpiRuntime failed', byedpiRuntime);
    }

    if (!inboundsConfig.success) {
      logger.error(
        '[DIAGNOSTIC]',
        'fetchInboundsConfig failed',
        inboundsConfig,
      );
    }

    applyDiagnosticsProviderInfo(nextSystemInfo, resetChecks);
  } catch (error) {
    logger.error('[DIAGNOSTIC]', 'fetchDiagnosticsProviderInfo failed', error);

    if (requestId === latestProviderInfoRequestId) {
      const currentSystemInfo = store.get().diagnosticsSystemInfo;

      store.set({
        diagnosticsSystemInfo: {
          ...currentSystemInfo,
          providerInfoLoaded: true,
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

  const renderedDiagnosticsChecks = diagnosticsChecks.map((check) =>
    renderCheckSection(check),
  );

  return preserveScrollForPage(() => {
    container!.replaceChildren(...renderedDiagnosticsChecks);
  });
}

function renderDiagnosticRunActionWidget() {
  logger.debug('[DIAGNOSTIC]', 'renderDiagnosticRunActionWidget');

  const { loading } = store.get().diagnosticsRunAction;
  const providerInfoLoaded =
    store.get().diagnosticsSystemInfo.providerInfoLoaded;
  const servicesInfoWidget = store.get().servicesInfoWidget;
  const forkopRunning = Boolean(servicesInfoWidget.data.forkopRunning);
  const container = document.getElementById('fkp_diagnostic-page-run-check');

  const renderedAction = renderRunAction({
    loading,
    disabled: shouldDisableDiagnosticRunAction({
      providerInfoLoaded,
      servicesInfoLoading: servicesInfoWidget.loading,
      forkopRunning,
      mutatingServiceActionLoading: isMutatingServiceActionLoading(),
    }),
    click: () => runChecks(),
  });

  return preserveScrollForPage(() => {
    container!.replaceChildren(renderedAction);
  });
}

async function handleServiceRuntimeAction({
  action,
  expectedRunning,
  optimisticRunning,
}: {
  action: ServiceRuntimeAction;
  expectedRunning: boolean;
  optimisticRunning?: boolean;
}) {
  setDiagnosticActionLoading(action, true, true);
  let jobId = '';
  let ownsJobFollow = false;
  let delegatedToWatcher = false;

  if (optimisticRunning !== undefined) {
    setDisplayedForkopRunning(optimisticRunning);
  }

  try {
    const startResponse = await ForkopShellMethods.serviceActionStart(action);

    if (!startResponse.success) {
      throw new Error(startResponse.error);
    }

    jobId = startResponse.data.job_id;
    if (followedServiceActionJobs.has(jobId)) {
      delegatedToWatcher = true;
      return;
    }

    followedServiceActionJobs.add(jobId);
    ownsJobFollow = true;
    const result = await ForkopShellMethods.waitServiceActionJob(jobId);

    if (!result.success) {
      throw new Error(result.error);
    }

    if (result.data.success === false) {
      throw new Error(result.data.message || _('Service action failed'));
    }

    await waitForForkopRunningState(expectedRunning);
  } catch (e) {
    logger.error('[DIAGNOSTIC]', `handleServiceRuntimeAction(${action})`, e);
  } finally {
    if (!delegatedToWatcher) {
      if (ownsJobFollow) {
        followedServiceActionJobs.delete(jobId);
      }

      setDiagnosticActionLoading(action, false);
      await refreshDiagnosticServicesInfo({ force: true, allowInactive: true });
      if (jobId) {
        handledServiceActionJobs.add(jobId);
        void ForkopShellMethods.uiActionAck('service', jobId);
      }
      releaseDiagnosticsChecks();
    }
  }
}

async function handleRestart() {
  await handleServiceRuntimeAction({
    action: 'restart',
    expectedRunning: true,
    optimisticRunning: false,
  });
}

async function handleStart() {
  await handleServiceRuntimeAction({
    action: 'start',
    expectedRunning: true,
  });
}

async function handleStop() {
  await handleServiceRuntimeAction({
    action: 'stop',
    expectedRunning: false,
  });
}

async function handleEnable() {
  setDiagnosticActionLoading('enable', true);

  try {
    await ForkopShellMethods.enable();
  } catch (e) {
    logger.error('[DIAGNOSTIC]', 'handleEnable - e', e);
  } finally {
    await refreshDiagnosticServicesInfo({
      force: true,
      allowInactive: true,
    });
    setDiagnosticActionLoading('enable', false);
  }
}

async function handleDisable() {
  setDiagnosticActionLoading('disable', true);

  try {
    await ForkopShellMethods.disable();
  } catch (e) {
    logger.error('[DIAGNOSTIC]', 'handleDisable - e', e);
  } finally {
    await refreshDiagnosticServicesInfo({
      force: true,
      allowInactive: true,
    });
    setDiagnosticActionLoading('disable', false);
  }
}

async function handleShowGlobalCheck() {
  setDiagnosticActionLoading('globalCheck', true);

  try {
    const globalCheck = await ForkopShellMethods.globalCheck(false);

    if (globalCheck.success) {
      const rawGlobalCheckText = (globalCheck.data as string) ?? '';
      const maskedGlobalCheckText = maskGlobalCheckText(rawGlobalCheckText);

      ui.showModal(
        _('Global check'),
        renderModal(rawGlobalCheckText, 'global_check', {
          maskText: () => maskedGlobalCheckText,
          initialAutoRefresh: false,
          showMaskValuesToggle: true,
        }),
      );
    } else {
      logger.error('[DIAGNOSTIC]', 'handleShowGlobalCheck - e', globalCheck);
    }
  } catch (e) {
    logger.error('[DIAGNOSTIC]', 'handleShowGlobalCheck - e', e);
  } finally {
    setDiagnosticActionLoading('globalCheck', false);
  }
}

async function handleUpdateRuleSets() {
  setDiagnosticActionLoading('updateRuleSets', true);

  try {
    const response = await CustomForkopMethods.updateClashApiRuleProviders();

    if (!response.success) {
      throw new Error(response.error);
    }
  } catch (e) {
    // sing-box logs which rule-set failed and why, so the page stays quiet here
    // like every other action in this block.
    logger.error('[DIAGNOSTIC]', 'handleUpdateRuleSets - e', e);
  } finally {
    setDiagnosticActionLoading('updateRuleSets', false);
  }
}

async function handleShowForkopConfig() {
  setDiagnosticActionLoading('showConfig', true);

  try {
    const showConfig = await ForkopShellMethods.showConfig(false);

    if (showConfig.success) {
      const rawConfigText = (showConfig.data as string) ?? '';
      const maskedConfigText = maskGlobalCheckText(rawConfigText);

      ui.showModal(
        _('Forkop configuration'),
        renderModal(rawConfigText, 'show_config', {
          maskText: () => maskedConfigText,
          initialAutoRefresh: false,
          showMaskValuesToggle: true,
        }),
      );
    } else {
      logger.error('[DIAGNOSTIC]', 'handleShowForkopConfig - e', showConfig);
    }
  } catch (e) {
    logger.error('[DIAGNOSTIC]', 'handleShowForkopConfig - e', e);
  } finally {
    setDiagnosticActionLoading('showConfig', false);
  }
}

async function handleShowSingBoxConfig() {
  setDiagnosticActionLoading('showSingBoxConfig', true);

  try {
    const showSingBoxConfig = await ForkopShellMethods.showSingBoxConfig(false);

    if (showSingBoxConfig.success) {
      const rawSingBoxConfigText = stringifySingBoxConfig(
        showSingBoxConfig.data,
      );
      const maskedSingBoxConfigText = formatMaskedSingBoxConfig(
        showSingBoxConfig.data,
      );

      ui.showModal(
        _('sing-box configuration'),
        renderModal(rawSingBoxConfigText, 'show_sing_box_config', {
          maskText: () => maskedSingBoxConfigText,
          initialAutoRefresh: false,
          showMaskValuesToggle: true,
        }),
      );
    } else {
      logger.error(
        '[DIAGNOSTIC]',
        'handleShowSingBoxConfig - e',
        showSingBoxConfig,
      );
    }
  } catch (e) {
    logger.error('[DIAGNOSTIC]', 'handleShowSingBoxConfig - e', e);
  } finally {
    setDiagnosticActionLoading('showSingBoxConfig', false);
  }
}

function renderDiagnosticAvailableActionsWidget() {
  const diagnosticsActions = store.get().diagnosticsActions;
  const updatesActions = store.get().updatesActions;
  const servicesInfoWidget = store.get().servicesInfoWidget;
  logger.debug('[DIAGNOSTIC]', 'renderDiagnosticAvailableActionsWidget');

  const forkopEnabled = Boolean(servicesInfoWidget.data.forkopEnabled);
  const forkopRunning = Boolean(servicesInfoWidget.data.forkopRunning);
  const serviceTransition = getServiceTransition(
    servicesInfoWidget.data.forkopStatus,
  );
  const restartLoading =
    diagnosticsActions.restart.loading || serviceTransition.restarting;
  const startLoading =
    diagnosticsActions.start.loading || serviceTransition.starting;
  const stopLoading =
    diagnosticsActions.stop.loading || serviceTransition.stopping;
  const atLeastOneMutatingActionLoading =
    restartLoading ||
    startLoading ||
    stopLoading ||
    diagnosticsActions.enable.loading ||
    diagnosticsActions.disable.loading;
  const componentActionLoading = hasComponentActionLoading(updatesActions);
  const { serviceControlsDisabled, utilityActionsDisabled } =
    getAvailableActionsDisabledState({
      servicesInfoLoading: servicesInfoWidget.loading,
      mutatingServiceActionLoading: atLeastOneMutatingActionLoading,
      componentActionLoading,
    });
  const startVisible = shouldShowStartAction({
    forkopRunning,
    restartLoading,
    startLoading,
    stopLoading,
  });
  const stopVisible = shouldShowStopAction({
    forkopRunning,
    restartLoading,
    startLoading,
    stopLoading,
  });

  const container = document.getElementById('fkp_diagnostic-page-actions');

  const renderedActions = renderAvailableActions({
    restart: {
      loading: restartLoading,
      visible: shouldShowRestartAction({
        forkopRunning,
        restartLoading,
        startLoading,
        stopLoading,
      }),
      onClick: handleRestart,
      disabled: serviceControlsDisabled,
    },
    start: {
      loading: startLoading,
      visible: startVisible,
      onClick: handleStart,
      disabled: serviceControlsDisabled,
    },
    stop: {
      loading: stopLoading,
      visible: stopVisible,
      onClick: handleStop,
      disabled: serviceControlsDisabled,
    },
    enable: {
      loading: diagnosticsActions.enable.loading,
      visible: !forkopEnabled,
      onClick: handleEnable,
      disabled: serviceControlsDisabled,
    },
    disable: {
      loading: diagnosticsActions.disable.loading,
      visible: forkopEnabled,
      onClick: handleDisable,
      disabled: serviceControlsDisabled,
    },
    globalCheck: {
      loading: diagnosticsActions.globalCheck.loading,
      visible: true,
      onClick: handleShowGlobalCheck,
      disabled: utilityActionsDisabled,
    },
    updateRuleSets: {
      loading: diagnosticsActions.updateRuleSets.loading,
      visible: true,
      onClick: handleUpdateRuleSets,
      disabled: utilityActionsDisabled || !forkopRunning,
    },
    showConfig: {
      loading: diagnosticsActions.showConfig.loading,
      visible: true,
      onClick: handleShowForkopConfig,
      disabled: utilityActionsDisabled,
    },
    showSingBoxConfig: {
      loading: diagnosticsActions.showSingBoxConfig.loading,
      visible: true,
      onClick: handleShowSingBoxConfig,
      disabled: utilityActionsDisabled,
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

  const items = [
    {
      key: 'Forkop',
      value: normalizeCompiledVersion(diagnosticsSystemInfo.forkop_version),
    },
    {
      key: 'Luci App',
      value: normalizeCompiledVersion(FORKOP_LUCI_APP_VERSION),
    },
    {
      key: 'Sing-box',
      value: formatSingBoxVersion(diagnosticsSystemInfo, false),
    },
  ];

  if (diagnosticsSystemInfo.zapret_installed) {
    items.push({
      key: 'Zapret',
      value: diagnosticsSystemInfo.zapret_version,
    });
  }

  if (diagnosticsSystemInfo.zapret2_installed) {
    items.push({
      key: 'Zapret2',
      value: diagnosticsSystemInfo.zapret2_version,
    });
  }

  if (diagnosticsSystemInfo.byedpi_installed) {
    items.push({
      key: 'ByeDPI',
      value: diagnosticsSystemInfo.byedpi_version,
    });
  }

  items.push(
    {
      key: 'OS',
      value: formatOsRelease(diagnosticsSystemInfo.openwrt_version),
    },
    {
      key: 'Device',
      value: diagnosticsSystemInfo.device_model,
    },
  );

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

  if (diff.diagnosticsRunAction) {
    renderDiagnosticRunActionWidget();
  }

  if (
    diff.diagnosticsActions ||
    diff.servicesInfoWidget ||
    diff.updatesActions
  ) {
    renderDiagnosticAvailableActionsWidget();
  }

  if (diff.diagnosticsActions || diff.servicesInfoWidget) {
    renderDiagnosticRunActionWidget();
  }

  if (diff.diagnosticsSystemInfo) {
    renderDiagnosticSystemInfoWidget();
    renderDiagnosticRunActionWidget();
  }
}

function setDiagnosticCheckLoading(code: DIAGNOSTICS_CHECKS) {
  const meta = DIAGNOSTICS_CHECKS_MAP[code];
  const diagnosticsChecks = store.get().diagnosticsChecks;
  const other = diagnosticsChecks.filter((item) => item.code !== code);

  store.set({
    diagnosticsChecks: [
      ...other,
      {
        order: meta.order,
        code: meta.code,
        title: meta.title,
        description: _('Checking, please wait'),
        state: 'loading',
        items: [],
      },
    ],
  });
}

function getDiagnosticRunners(
  providerOptions: DiagnosticsProviderOptions,
): DiagnosticRunner[] {
  return [
    { code: DIAGNOSTICS_CHECKS.DNS, run: runDnsCheck },
    { code: DIAGNOSTICS_CHECKS.SINGBOX, run: runSingBoxCheck },
    ...(providerOptions.includeInbounds
      ? [{ code: DIAGNOSTICS_CHECKS.INBOUNDS, run: runInboundsCheck }]
      : []),
    { code: DIAGNOSTICS_CHECKS.NFT, run: runNftCheck },
    ...(providerOptions.includeZapret
      ? [{ code: DIAGNOSTICS_CHECKS.ZAPRET, run: runZapretCheck }]
      : []),
    ...(providerOptions.includeZapret2
      ? [{ code: DIAGNOSTICS_CHECKS.ZAPRET2, run: runZapret2Check }]
      : []),
    ...(providerOptions.includeByedpi
      ? [{ code: DIAGNOSTICS_CHECKS.BYEDPI, run: runByedpiCheck }]
      : []),
    { code: DIAGNOSTICS_CHECKS.OUTBOUNDS, run: runSectionsCheck },
    { code: DIAGNOSTICS_CHECKS.FAKEIP, run: runFakeIPCheck },
  ];
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

  diagnosticsChecksOwnedByRun = true;
  store.set({
    diagnosticsRunAction: { loading: true },
    diagnosticsChecks: getLoadingDiagnosticsChecks(
      getDiagnosticsProviderOptions(),
    ).diagnosticsChecks,
  });

  try {
    await fetchDiagnosticsProviderInfo({ resetChecks: false });

    const providerOptions = getDiagnosticsProviderOptions();

    store.set({
      diagnosticsChecks:
        getLoadingDiagnosticsChecks(providerOptions).diagnosticsChecks,
    });

    for (const runner of getDiagnosticRunners(providerOptions)) {
      setDiagnosticCheckLoading(runner.code);

      try {
        await runner.run();
      } catch (e) {
        logger.error(
          '[DIAGNOSTIC]',
          `runChecks - ${runner.run.name} failed`,
          e,
        );
      }
    }
  } catch (e) {
    logger.error('[DIAGNOSTIC]', 'runChecks - e', e);
  } finally {
    store.set({ diagnosticsRunAction: { loading: false } });
  }
}

async function loadInitialDiagnosticData() {
  const diagnosticStatus = document.getElementById('diagnostic-status');

  if (diagnosticStatus?.isConnected && diagnosticStatus.offsetParent !== null) {
    if (store.get().diagnosticsRunAction.loading) {
      return;
    }

    await fetchSystemInfo();
    await fetchDiagnosticsProviderInfo();
  }
}

// Whichever mount is current owns the listeners. Detaching says nothing about the
// check list: that belongs to the page being left, and to the run that may still
// be writing into it.
function detachDiagnosticPage() {
  diagnosticMounted = false;
  diagnosticMountId += 1;
  stopServiceActionStateWatcher();

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
    const uiState = await refreshRuntimeUiState({ force: true });

    if (!isDiagnosticMountActive(mountId)) {
      return;
    }

    if (!uiState) {
      void refreshDiagnosticServicesInfo({ force: true });
    }
  }

  // Add new listener
  store.subscribe(onStoreUpdate);
  startServiceActionStateWatcher();

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
