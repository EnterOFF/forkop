import type { Forkop } from '../../types';

// What the service is doing right now, as one value. The runtime publishes it
// in `service.forkop.busy`; a freshly clicked button fills the gap until the
// runtime has a job to report. Everything the control row shows derives from
// this and from whether the service is running - there is no third source.
export type ServiceOperation = Forkop.ServiceBusy;

export type ServiceControlMode = 'restart' | 'apply';

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

export interface ServiceControlState {
  visible: boolean;
  loading: boolean;
  disabled: boolean;
}

export interface ServiceControlsPresentation {
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

// How long an operation may run before the row stops treating it as normal
// progress. Every lifecycle action on a slow router finishes well inside this;
// past it, the operation is not coming back on its own.
export const STUCK_OPERATION_SECONDS = 90;

// The rules, in full:
//
//   * while an operation runs, its own button is the only control shown - it
//     carries the spinner and the present-tense label, and it is the only
//     disabled control. Nothing else appears or moves underneath the cursor
//     while the user waits;
//   * once an operation has been running long enough to be stuck, Stop appears
//     beside it. That is the one case where the user needs a way out, and the
//     only case where the extra button is worth the change in the row;
//   * Restart is offered when there is something to restart;
//   * Start is offered when the service is down and nothing is in flight.
//
// Nothing here is a safety mechanism. Conflicting actions are serialized by the
// runtime lock, which a second browser tab, curl or ssh would bypass anyway, so
// hiding a button protects nothing - it is a statement about what is worth
// showing, and the stuck case is what makes hiding Stop safe to do.
export function getServiceControlsPresentation({
  running,
  operation,
  operationSeconds = 0,
  known = true,
}: {
  running: boolean;
  operation: ServiceOperation | null;
  operationSeconds?: number;
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
  const stuck = !idle && operationSeconds >= STUCK_OPERATION_SECONDS;

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
      visible: operation === 'stop' || (idle && running) || stuck,
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

export function shouldSkipServicesInfoAutoRefresh({
  force,
  localMutatingActionLoading,
}: {
  force: boolean;
  localMutatingActionLoading: boolean;
}) {
  return !force && localMutatingActionLoading;
}

// A read-only probe is most useful exactly when the service is down - "sing-box
// is not running, the nft table is absent" is the diagnosis, not a reason to
// refuse. The only gate left is the page not yet knowing what to check.
export function shouldDisableDiagnosticRunAction({
  providerInfoLoaded,
}: {
  providerInfoLoaded: boolean;
}) {
  return !providerInfoLoaded;
}

export function hasComponentActionLoading(actions: ComponentActions) {
  return Object.values(actions).some((action) => action.loading);
}
