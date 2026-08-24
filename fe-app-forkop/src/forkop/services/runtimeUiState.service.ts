import { ForkopShellMethods } from '../methods';
import { getLocalActionOverlay } from './localActionOverlay.service';
import { Forkop } from '../types';
import { logger } from './logger.service';
import { applyUiStateToStore } from './uiState.service';

const RUNTIME_UI_STATE_REFRESH_MIN_INTERVAL_MS = 500;
const RUNTIME_UI_STATE_IDLE_POLL_INTERVAL_MS = 10000;
const RUNTIME_UI_STATE_ACTIVE_POLL_INTERVAL_MS = 1000;
type RuntimeUiStateListener = (uiState: Forkop.UiState) => void;

let runtimeUiStateRefreshPromise: Promise<Forkop.UiState | undefined> | null =
  null;
let lastRuntimeUiStateRefreshAt = 0;
let lastRuntimeUiState: Forkop.UiState | undefined;
let runtimeStateResumeRefreshRegistered = false;
let runtimeStatePollTimer: ReturnType<typeof setTimeout> | null = null;
let runtimeStatePollingStarted = false;
let runtimeStateHasRunningAction = false;
let lastRuntimeUiStateSignature = '';
const runtimeUiStateListeners = new Set<RuntimeUiStateListener>();

function isDocumentVisible() {
  return (
    typeof document === 'undefined' ||
    !document.visibilityState ||
    document.visibilityState === 'visible'
  );
}

function hasRunningAction(uiState: Forkop.UiState) {
  return (
    Boolean(uiState.service.forkop.busy) ||
    [...uiState.actions.service, ...uiState.actions.component].some(
      (action) => action.running,
    )
  );
}

// What the page actually renders. A poll that returns something different is a
// transition in progress, and transitions arrive in bursts, so the next one is
// scheduled at the active interval even once the action itself has finished.
function stateSignature(uiState: Forkop.UiState) {
  const forkop = uiState.service.forkop;
  return [
    forkop.running,
    forkop.enabled,
    forkop.busy || '',
    forkop.dns_configured,
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

function scheduleRuntimeUiStatePoll(delay = getNextPollDelay()) {
  if (
    !runtimeStatePollingStarted ||
    runtimeStatePollTimer ||
    typeof window === 'undefined'
  ) {
    return;
  }

  runtimeStatePollTimer = window.setTimeout(() => {
    runtimeStatePollTimer = null;
    void refreshRuntimeUiState()
      .catch(() => undefined)
      .finally(() => {
        scheduleRuntimeUiStatePoll();
      });
  }, delay);
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

  const promise = ForkopShellMethods.getUiState()
    .then((response) => {
      if (!response.success) {
        return undefined;
      }

      applyUiStateToStore(response.data);
      lastRuntimeUiState = response.data;

      const signature = stateSignature(response.data);
      const changed = signature !== lastRuntimeUiStateSignature;
      lastRuntimeUiStateSignature = signature;

      runtimeStateHasRunningAction = hasRunningAction(response.data) || changed;
      notifyRuntimeUiStateListeners(response.data);
      return response.data;
    })
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

// Called when the page starts or finishes an action of its own: the pacing it
// was waiting on no longer matches what is happening, so the pending wait is
// dropped and the state is read again straight away.
export function refreshRuntimeUiStateNow() {
  if (runtimeStatePollTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(runtimeStatePollTimer);
    runtimeStatePollTimer = null;
  }

  const refreshed = refreshRuntimeUiState({ force: true });
  if (runtimeStatePollingStarted) {
    void refreshed.finally(() => {
      scheduleRuntimeUiStatePoll();
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

export function getCachedRuntimeUiState() {
  return lastRuntimeUiState;
}

export function registerRuntimeStateResumeRefresh() {
  if (runtimeStateResumeRefreshRegistered || typeof window === 'undefined') {
    return;
  }

  runtimeStateResumeRefreshRegistered = true;

  const refreshOnResume = () => {
    if (!isDocumentVisible()) {
      return;
    }

    void refreshRuntimeUiState({ force: true });
  };

  document.addEventListener('visibilitychange', refreshOnResume);
  window.addEventListener('pageshow', refreshOnResume);
  window.addEventListener('focus', refreshOnResume);
}

export function startRuntimeUiStatePolling() {
  if (runtimeStatePollingStarted || typeof window === 'undefined') {
    return;
  }

  runtimeStatePollingStarted = true;
  void refreshRuntimeUiState({ force: true }).finally(() => {
    scheduleRuntimeUiStatePoll();
  });
}
