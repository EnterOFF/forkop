import { callUbus } from '../../helpers';
import { isDocumentVisible } from '../../helpers/isDocumentVisible';
import { ForkopShellMethods } from '../methods';
import { getLocalActionOverlay } from './localActionOverlay.service';
import { Forkop } from '../types';
import { logger } from './logger.service';
import {
  FORKOP_CALL_TIMEOUT_MS,
  FORKOP_SERVICE_OBJECT,
  FORKOP_WAIT_RETRY_MS,
  FORKOP_WAIT_TIMEOUT_MS,
} from './forkopWaitTransport';
import { applyUiStateToStore, markUiStateUnavailable } from './uiState.service';

const RUNTIME_UI_STATE_REFRESH_MIN_INTERVAL_MS = 500;
const RUNTIME_UI_STATE_IDLE_POLL_INTERVAL_MS = 10000;
const RUNTIME_UI_STATE_ACTIVE_POLL_INTERVAL_MS = 1000;
// A state service found missing is asked again after this long: an upgrade or
// a crash takes it away for seconds, not for the life of the page.
const STATE_SERVICE_RETRY_MS = 30000;

type RuntimeUiStateListener = (uiState: Forkop.UiState) => void;
type StateTransport = 'unknown' | 'ubus' | 'cli';
type UbusState = Forkop.UiState & { revision?: number };

let runtimeUiStateRefreshPromise: Promise<Forkop.UiState | undefined> | null =
  null;
let lastRuntimeUiStateRefreshAt = 0;
let lastRuntimeUiState: Forkop.UiState | undefined;
let runtimeStateResumeRefreshRegistered = false;
let runtimeStatePollTimer: ReturnType<typeof setTimeout> | null = null;
let runtimeStatePollingStarted = false;
let runtimeStateHasRunningAction = false;
let lastRuntimeUiStateSignature = '';
let transport: StateTransport = 'unknown';
let stateServiceRetryAt = 0;
let stateRevision = 0;
let waitLoopRunning = false;
let waitLoopStop = false;
const runtimeUiStateListeners = new Set<RuntimeUiStateListener>();

function hasRunningAction(uiState: Forkop.UiState) {
  return (
    Boolean(uiState.service.forkop.busy) ||
    [...uiState.actions.service, ...uiState.actions.component].some(
      (action) => action.running,
    )
  );
}

// What the page actually renders. A read that returns something different is a
// transition in progress, and transitions arrive in bursts, so the next one is
// scheduled at the active interval even once the action itself has finished.
// Only the polling transport needs this; the state service reports a change the
// moment it happens.
function stateSignature(uiState: Forkop.UiState) {
  const forkop = uiState.service.forkop;
  return [
    forkop.running,
    forkop.enabled,
    forkop.busy || '',
    uiState.service.sing_box.running,
    [...uiState.actions.service, ...uiState.actions.component].filter(
      (action) => action.running,
    ).length,
  ].join('|');
}

// A click is known here before the runtime has a job to report it, and waiting
// for the next idle poll to notice was most of the lag between pressing a button
// and the page reacting.
function hasLocalPendingAction() {
  const overlay = getLocalActionOverlay();
  return (
    overlay.serviceActions.size > 0 ||
    overlay.componentActions.size > 0 ||
    overlay.subscriptionSections.size > 0
  );
}

function isRuntimeStateActive() {
  return runtimeStateHasRunningAction || hasLocalPendingAction();
}

function getNextPollDelay() {
  return isRuntimeStateActive()
    ? RUNTIME_UI_STATE_ACTIVE_POLL_INTERVAL_MS
    : RUNTIME_UI_STATE_IDLE_POLL_INTERVAL_MS;
}

function notifyRuntimeUiStateListeners(uiState: Forkop.UiState) {
  for (const listener of runtimeUiStateListeners) {
    try {
      listener(uiState);
    } catch (error) {
      logger.error('[RUNTIME_UI_STATE]', 'listener failed', error);
    }
  }
}

function applyState(uiState: Forkop.UiState) {
  applyUiStateToStore(uiState);
  lastRuntimeUiState = uiState;

  const signature = stateSignature(uiState);
  const changed = signature !== lastRuntimeUiStateSignature;
  lastRuntimeUiStateSignature = signature;

  runtimeStateHasRunningAction = hasRunningAction(uiState) || changed;
  notifyRuntimeUiStateListeners(uiState);
}

function adoptUbusState(value: UbusState) {
  if (typeof value.revision === 'number') {
    stateRevision = value.revision;
  }

  const uiState: Forkop.UiState = {
    service: value.service,
    capabilities: value.capabilities,
    actions: value.actions,
  };
  applyState(uiState);
  return uiState;
}

// The state service answers in a few milliseconds because it is already
// running. The CLI is what answers when it is not installed yet, or not up.
//
// `state` hands back what the service published last. It recomputes when its
// watch notices a change, which is twice a second at best, so a page that has
// just changed something itself would be answered with the state from before
// its own action - an autostart symlink it removed a moment ago is still there.
// `refresh` is the same answer computed on the spot, and costs the recompute.
function useCli(reason: string) {
  transport = 'cli';
  stateServiceRetryAt = Date.now() + STATE_SERVICE_RETRY_MS;
  logger.info('[RUNTIME_UI_STATE]', 'using the CLI', reason);
}

async function readState(
  recompute: boolean,
): Promise<Forkop.UiState | undefined> {
  if (transport !== 'cli' || Date.now() >= stateServiceRetryAt) {
    const response = await callUbus<UbusState>({
      object: FORKOP_SERVICE_OBJECT,
      method: recompute ? 'refresh' : 'state',
      timeoutMs: FORKOP_CALL_TIMEOUT_MS,
    });

    if (response.success) {
      transport = 'ubus';
      return adoptUbusState(response.data);
    }

    // A service that is present but failing is not a reason to abandon it.
    if (!response.unavailable && transport === 'ubus') {
      return undefined;
    }

    useCli(response.message);
  }

  const response = await ForkopShellMethods.getUiState();
  if (!response.success) {
    // The CLI was the last transport left; the page is told the state is
    // unknown rather than left waiting for an answer that is not coming.
    markUiStateUnavailable();
    return undefined;
  }

  applyState(response.data);
  return response.data;
}

// `force` is the caller saying it has a reason to read now: it skips the
// throttle that keeps ordinary polls apart, and it asks the state service for a
// fresh computation rather than for whatever it published last.
export async function refreshRuntimeUiState({
  force = false,
}: { force?: boolean } = {}): Promise<Forkop.UiState | undefined> {
  if (!isDocumentVisible()) {
    return undefined;
  }

  if (runtimeUiStateRefreshPromise) {
    return runtimeUiStateRefreshPromise;
  }

  const now = Date.now();
  if (
    !force &&
    now - lastRuntimeUiStateRefreshAt < RUNTIME_UI_STATE_REFRESH_MIN_INTERVAL_MS
  ) {
    return undefined;
  }

  lastRuntimeUiStateRefreshAt = now;

  const promise = readState(force)
    .catch((error) => {
      logger.error('[RUNTIME_UI_STATE]', 'refresh failed', error);
      return undefined;
    })
    .finally(() => {
      if (runtimeUiStateRefreshPromise === promise) {
        runtimeUiStateRefreshPromise = null;
      }
    });

  runtimeUiStateRefreshPromise = promise;
  return runtimeUiStateRefreshPromise;
}

function clearPollTimer() {
  if (runtimeStatePollTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(runtimeStatePollTimer);
    runtimeStatePollTimer = null;
  }
}

function scheduleRuntimeUiStatePoll(delay = getNextPollDelay()) {
  if (
    !runtimeStatePollingStarted ||
    runtimeStatePollTimer ||
    waitLoopRunning ||
    typeof window === 'undefined'
  ) {
    return;
  }

  runtimeStatePollTimer = window.setTimeout(() => {
    runtimeStatePollTimer = null;
    void refreshRuntimeUiState()
      .catch(() => undefined)
      .finally(() => {
        startTransportLoop();
      });
  }, delay);
}

// One request parked on the router for as long as nothing changes, answered the
// moment something does. An idle page costs one open request instead of a
// refresh every ten seconds, and a change reaches the browser in the time it
// takes to serialise it rather than on the next tick.
async function runWaitLoop() {
  if (waitLoopRunning) {
    return;
  }

  waitLoopRunning = true;
  waitLoopStop = false;

  try {
    while (!waitLoopStop && isDocumentVisible() && transport === 'ubus') {
      const response = await callUbus<UbusState>({
        object: FORKOP_SERVICE_OBJECT,
        method: 'state_wait',
        params: { revision: stateRevision },
        timeoutMs: FORKOP_WAIT_TIMEOUT_MS,
      });

      if (waitLoopStop) {
        break;
      }

      if (response.success) {
        adoptUbusState(response.data);
        continue;
      }

      if (response.unavailable) {
        useCli(response.message);
        break;
      }

      logger.error('[RUNTIME_UI_STATE]', 'state wait failed', response.message);
      await new Promise((resolve) => setTimeout(resolve, FORKOP_WAIT_RETRY_MS));
    }
  } finally {
    waitLoopRunning = false;
    if (runtimeStatePollingStarted && transport !== 'ubus') {
      scheduleRuntimeUiStatePoll();
    }
  }
}

function startTransportLoop() {
  if (!runtimeStatePollingStarted) {
    return;
  }

  if (transport === 'ubus') {
    clearPollTimer();
    // A loop hidden a moment ago may still be waiting on its request, and has to
    // carry on once it comes back rather than stop.
    waitLoopStop = false;
    void runWaitLoop();
    return;
  }

  scheduleRuntimeUiStatePoll();
}

// Called when the page starts or finishes an action of its own: whatever the
// feed was waiting on no longer matches what is happening, so the state is read
// again straight away.
export function refreshRuntimeUiStateNow() {
  clearPollTimer();

  const refreshed = refreshRuntimeUiState({ force: true });
  if (runtimeStatePollingStarted) {
    void refreshed.finally(() => {
      startTransportLoop();
    });
  }
  return refreshed;
}

export function subscribeRuntimeUiState(listener: RuntimeUiStateListener) {
  runtimeUiStateListeners.add(listener);

  if (lastRuntimeUiState) {
    try {
      listener(lastRuntimeUiState);
    } catch (error) {
      logger.error('[RUNTIME_UI_STATE]', 'listener failed', error);
    }
  }

  return () => {
    runtimeUiStateListeners.delete(listener);
  };
}

// Which transport answered is remembered for the life of the page; tests need
// to be able to forget it between cases.
export function resetRuntimeUiStateTransport() {
  transport = 'unknown';
  stateServiceRetryAt = 0;
  stateRevision = 0;
  lastRuntimeUiState = undefined;
  lastRuntimeUiStateSignature = '';
  lastRuntimeUiStateRefreshAt = 0;
}

export function getCachedRuntimeUiState() {
  return lastRuntimeUiState;
}

export function registerRuntimeStateResumeRefresh() {
  if (runtimeStateResumeRefreshRegistered || typeof window === 'undefined') {
    return;
  }

  runtimeStateResumeRefreshRegistered = true;

  const onVisibilityChange = () => {
    if (!isDocumentVisible()) {
      // A request parked from a hidden tab holds a connection open for nothing.
      waitLoopStop = true;
      clearPollTimer();
      return;
    }

    void refreshRuntimeUiStateNow();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pageshow', onVisibilityChange);
  window.addEventListener('focus', onVisibilityChange);
}

export function startRuntimeUiStatePolling() {
  if (runtimeStatePollingStarted || typeof window === 'undefined') {
    return;
  }

  runtimeStatePollingStarted = true;
  void refreshRuntimeUiState({ force: true }).finally(() => {
    startTransportLoop();
  });
}
