import type { Forkop } from '../types';
import { setCoreFeatures } from './coreFeatures.service';
import {
  getLocalActionOverlay,
  setLocalServiceAction,
} from './localActionOverlay.service';
import { store } from './store.service';
import type { StoreType } from './store.service';

type UiActionMap = Partial<Forkop.UiState['actions']>;

function isRunningAction(state: { running?: boolean }) {
  return state.running === true;
}

function getEmptyDiagnosticsActions(): StoreType['diagnosticsActions'] {
  return {
    ...store.get().diagnosticsActions,
    restart: { loading: false },
    start: { loading: false },
    stop: { loading: false },
  };
}

function applyServiceState(uiState: Forkop.UiState) {
  const currentSystemInfo = store.get().diagnosticsSystemInfo;
  const nextSystemInfo = {
    ...currentSystemInfo,
    capabilitiesLoaded: true,
    server_inbounds_enabled_count:
      uiState.capabilities.server_inbounds_enabled_count,
  };

  store.set({
    servicesInfoWidget: {
      loading: false,
      failed: false,
      data: {
        singbox: uiState.service.sing_box.running,
        forkopRunning: uiState.service.forkop.running,
        forkopEnabled: uiState.service.forkop.enabled,
        forkopBusy: uiState.service.forkop.busy || null,
      },
    },
    diagnosticsSystemInfo: nextSystemInfo,
  });
}

function applyActionState(actions: UiActionMap = {}) {
  // The local overlay only covers the gap between a click and the runtime
  // reporting the job; from the first report the operation is the runtime's,
  // and `service.forkop.busy` is what shows it.
  for (const state of actions.service || []) {
    if (isRunningAction(state) && state.action !== 'reload') {
      setLocalServiceAction(state.action, false);
    }
  }

  const diagnosticsActions = getEmptyDiagnosticsActions();

  for (const action of getLocalActionOverlay().serviceActions) {
    diagnosticsActions[action] = { loading: true };
  }

  store.set({ diagnosticsActions });
}

export function applyUiStateToStore(uiState: Forkop.UiState) {
  setCoreFeatures(uiState.capabilities?.core);
  applyServiceState(uiState);
  applyActionState(uiState.actions);
}

// Both transports failed, so nothing is going to fill the widget in. Saying so
// is what lets the page distinguish "state unknown" from "state on its way" -
// an empty store reads as a stopped, disabled service, and offering controls
// for that would act on a state nobody has seen.
export function markUiStateUnavailable() {
  const servicesInfoWidget = store.get().servicesInfoWidget;

  store.set({
    servicesInfoWidget: {
      ...servicesInfoWidget,
      loading: false,
      failed: true,
    },
  });
}
