import { Forkop } from '../../../types';
import { updateCheckStore } from './updateCheckStore';
import { IDiagnosticsChecksItem } from '../../../services';
import { getCheckItemsMeta } from './getCheckItemsMeta';

// Zapret and Zapret2 are the same runtime with a different binary, and
// providers/nfqueue/runtime.uc answers both from one status payload, so the two
// checks read the same fields and differ only in the words they use. Every
// label is passed in as a literal so it keeps its own translation.
export interface INfqueueProviderCheckLabels {
  providerAvailable: string;
  providerUnavailable: string;
  packageInstalled: string;
  packageMissing: string;
  rulesPresent: string;
  rulesAbsent: string;
  runtimeReady: string;
  runtimeNotReady: string;
  runtimeUnexpected: string;
  runtimeStopped: string;
  outboundConfigured: string;
  outboundMissing: string;
  standaloneConflict: string;
  standaloneActive: string;
  standaloneAutostart: string;
  standaloneInactive: string;
}

interface INfqueueProviderCheck {
  order: number;
  title: string;
  code: string;
}

export async function runNfqueueProviderCheck(
  check: INfqueueProviderCheck,
  loadStatus: () => Promise<
    Forkop.MethodResponse<Forkop.GetNfqueueProviderStatus>
  >,
  failureMessage: string,
  labels: INfqueueProviderCheckLabels,
) {
  const { order, title, code } = check;

  updateCheckStore({
    order,
    code,
    title,
    description: _('Checking, please wait'),
    state: 'loading',
    items: [],
  });

  const status = await loadStatus();

  if (!status.success) {
    updateCheckStore({
      order,
      code,
      title,
      description: _('Cannot receive checks result'),
      state: 'error',
      items: [],
    });

    throw new Error(failureMessage);
  }

  const data = status.data;
  const providerAvailable = Boolean(data.provider_available ?? data.installed);
  const packageInstalled = Boolean(data.package_installed);
  const hasRules = Number(data.enabled_rule_count || 0) > 0;
  const queueOverlap = Boolean(data.queue_overlap);
  const expectedProcesses = Number(data.expected_process_count || 0);
  const runningProcesses = Number(data.running_process_count || 0);
  const supervisorProcesses = Number(data.supervisor_process_count || 0);
  const runtimeReady =
    !hasRules ||
    (runningProcesses === expectedProcesses &&
      supervisorProcesses === expectedProcesses);
  const unexpectedRuntime =
    !hasRules && (runningProcesses > 0 || supervisorProcesses > 0);
  const outboundsConfigured = Boolean(data.outbounds_configured);
  const standaloneServiceEnabled = Boolean(data.standalone_service_enabled);
  const standaloneServiceRunning = Boolean(data.standalone_service_running);
  // The backend keeps the queues apart, so a standalone service beside Forkop
  // rules is a possible policy overlap rather than a broken runtime.
  const standaloneConflict = hasRules && standaloneServiceRunning;
  const standaloneAutostartRisk =
    hasRules && standaloneServiceEnabled && !standaloneServiceRunning;

  const items: Array<IDiagnosticsChecksItem> = [
    {
      state: providerAvailable ? 'success' : hasRules ? 'error' : 'warning',
      key: providerAvailable
        ? labels.providerAvailable
        : labels.providerUnavailable,
      value: data.provider_path || '',
    },
    {
      state: packageInstalled ? 'success' : hasRules ? 'error' : 'warning',
      key: packageInstalled ? labels.packageInstalled : labels.packageMissing,
      value: '',
    },
    {
      state: hasRules && !providerAvailable ? 'error' : 'success',
      key: hasRules ? labels.rulesPresent : labels.rulesAbsent,
      value: '',
    },
    {
      state: unexpectedRuntime || !runtimeReady ? 'error' : 'success',
      key: hasRules
        ? runtimeReady
          ? labels.runtimeReady
          : labels.runtimeNotReady
        : unexpectedRuntime
          ? labels.runtimeUnexpected
          : labels.runtimeStopped,
      value: hasRules ? `${runningProcesses}/${expectedProcesses}` : '',
    },
    {
      state: queueOverlap ? 'error' : 'success',
      key: queueOverlap
        ? _('NFQUEUE range overlaps with another rule')
        : _('NFQUEUE range is available'),
      value: `${Number(data.queue_base || 0)}-${Number(data.queue_range_end || 0)}`,
    },
    {
      state: !hasRules || outboundsConfigured ? 'success' : 'error',
      key: outboundsConfigured
        ? labels.outboundConfigured
        : labels.outboundMissing,
      value: '',
    },
    {
      state:
        standaloneConflict || standaloneAutostartRisk ? 'warning' : 'success',
      key: standaloneServiceRunning
        ? standaloneConflict
          ? labels.standaloneConflict
          : labels.standaloneActive
        : standaloneAutostartRisk
          ? labels.standaloneAutostart
          : labels.standaloneInactive,
      value: '',
    },
  ];
  const { state, description } = getCheckItemsMeta(items);

  updateCheckStore({
    order,
    code,
    title,
    description,
    state,
    items,
  });
}
