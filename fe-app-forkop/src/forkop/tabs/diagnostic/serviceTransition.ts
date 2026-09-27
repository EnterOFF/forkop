import type { Forkop } from '../../types';

// What the service is doing right now, as one value. The runtime publishes it
// in `service.forkop.busy`; a freshly clicked button fills the gap until the
// runtime has a job to report. Everything the control row shows derives from
// this and from whether the service is running - there is no third source.
export type ServiceOperation = Forkop.ServiceBusy;

type ServiceControlMode = 'restart' | 'apply';

type LoadingActionState = {
  loading: boolean;
};

type DiagnosticServiceActions = {
  restart: LoadingActionState;
  start: LoadingActionState;
  stop: LoadingActionState;
  enable: LoadingActionState;
  disable: LoadingActionState;
};

type ComponentActions = Record<string, LoadingActionState>;

interface ServiceControlState {
  visible: boolean;
  loading: boolean;
  disabled: boolean;
}

interface ServiceControlsPresentation {
  restart: ServiceControlState & { mode: ServiceControlMode };
  start: ServiceControlState;
  stop: ServiceControlState;
}

export function getServiceOperation({
  busy,
  localPending,
}: {
  busy?: Forkop.ServiceBusy | null;
  localPending?: ServiceOperation | null;
}): ServiceOperation | null {
  return busy || localPending || null;
}

export function isServiceBusy(operation: ServiceOperation | null) {
  return operation !== null;
}

// The rules, in full:
//
//   * while an operation runs, its own button is the only control shown - it
//     carries the spinner and the present-tense label, and it is the only
//     disabled control. Nothing else appears or moves underneath the cursor
//     while the user waits;
//   * Restart is offered when there is something to restart;
//   * Start is offered when the service is down and nothing is in flight.
//
// Nothing here is a safety mechanism. Conflicting actions are serialized by the
// runtime lock, which a second browser tab, curl or ssh would bypass anyway, so
// hiding a button protects nothing - it is a statement about what is worth
// showing. Nothing is offered to interrupt an operation: the runtime refuses
// any action while another one runs.
export function getServiceControlsPresentation({
  running,
  operation,
  known = true,
}: {
  running: boolean;
  operation: ServiceOperation | null;
  known?: boolean;
}): ServiceControlsPresentation {
  // Nothing is offered about a service whose state has not arrived yet. An
  // empty store reads as running=0 with no operation, which is exactly what a
  // stopped service reads as - so the row would offer Start for a service that
  // is running, which is what LuCI reloading the view after Save & Apply makes
  // happen at the worst possible moment.
  if (!known) {
    const hidden = { visible: false, loading: false, disabled: true };
    return {
      restart: { ...hidden, mode: 'restart' },
      start: { ...hidden },
      stop: { ...hidden },
    };
  }

  const applying = operation === 'apply';
  const restarting = operation === 'restart' || applying;
  const idle = operation === null;

  return {
    restart: {
      mode: applying ? 'apply' : 'restart',
      visible: restarting || (running && idle),
      loading: restarting,
      disabled: restarting,
    },
    start: {
      visible: operation === 'start' || (!running && idle),
      loading: operation === 'start',
      disabled: operation === 'start',
    },
    stop: {
      visible: operation === 'stop' || (idle && running),
      loading: operation === 'stop',
      disabled: operation === 'stop',
    },
  };
}

// Autostart is a symlink, orthogonal to whether the service runs and safe to
// toggle during any operation, so it is never gated by service state.
export function getAutostartControlsPresentation({
  enabled,
  enableLoading,
  disableLoading,
  known = true,
}: {
  enabled: boolean;
  enableLoading: boolean;
  disableLoading: boolean;
  known?: boolean;
}) {
  // Same reason: an empty store reads as "autostart is off".
  if (!known) {
    const hidden = { visible: false, loading: false, disabled: true };
    return { enable: { ...hidden }, disable: { ...hidden } };
  }

  return {
    enable: {
      visible: !enabled,
      loading: enableLoading,
      disabled: enableLoading,
    },
    disable: {
      visible: enabled,
      loading: disableLoading,
      disabled: disableLoading,
    },
  };
}

export function hasLocalMutatingServiceActionLoading(
  actions: DiagnosticServiceActions,
) {
  return (
    actions.restart.loading ||
    actions.start.loading ||
    actions.stop.loading ||
    actions.enable.loading ||
    actions.disable.loading
  );
}

// A read-only probe is most useful exactly when the service is down - "sing-box
// is not running, the nft table is absent" is the diagnosis, not a reason to
// refuse. The only gate left is the page not yet knowing what to check.
export function shouldDisableDiagnosticRunAction({
  capabilitiesLoaded,
}: {
  capabilitiesLoaded: boolean;
}) {
  return !capabilitiesLoaded;
}

export function hasComponentActionLoading(actions: ComponentActions) {
  return Object.values(actions).some((action) => action.loading);
}

// What a finished service action says when it failed, or nothing when the page
// has to stay quiet about it.
//
// Applying a configuration is the one action the user did not ask this page for:
// it is what a Save & Apply anywhere in LuCI runs, and it always fails for a
// reason - the option the configuration check refused, the step of the apply
// that gave up. Every one of those reasons is written to the log as an error,
// and an error in the log is already raised as an ordinary error alert with the
// reason in it. A toast beside it could only repeat that something went wrong,
// which the alert has said already, and said better.
const SERVICE_ACTION_FAILURE_LABELS: Record<string, () => string> = {
  start: () => _('Failed to start the service'),
  stop: () => _('Failed to stop the service'),
  restart: () => _('Failed to restart the service'),
};

export function serviceActionFailureMessage(action: string): string | null {
  if (action === 'reload') {
    return null;
  }

  const label = SERVICE_ACTION_FAILURE_LABELS[action];
  return label ? label() : _('Service action failed');
}
