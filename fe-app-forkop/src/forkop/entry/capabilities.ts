import { ForkopShellMethods } from '../methods/shell';
import { store } from '../services/store.service';

// What the router can offer this page, asked for once per render and shared
// with every tab through the store.
interface UiCapabilities {
  loaded: boolean;
  serverInboundsEnabledCount: number;
}

// The loader the page keeps: the first call asks the router, every later one
// answers from what came back, and calls that overlap share one request.
export function createUiCapabilitiesLoader() {
  const uiCapabilities: UiCapabilities = {
    loaded: false,
    serverInboundsEnabledCount: -1,
  };
  let uiCapabilitiesPromise: Promise<UiCapabilities> | null = null;

  const applyUiCapabilities = function () {
    if (store && typeof store.set === 'function') {
      const currentSystemInfo = store.get().diagnosticsSystemInfo;
      store.set({
        diagnosticsSystemInfo: {
          ...currentSystemInfo,
          capabilitiesLoaded: true,
          server_inbounds_enabled_count:
            uiCapabilities.serverInboundsEnabledCount,
        },
      });
    }
  };

  const updateUiCapabilities = function (data?: {
    server_inbounds_enabled_count?: unknown;
  }) {
    uiCapabilities.loaded = true;
    const serverInboundsEnabledCount =
      typeof data?.server_inbounds_enabled_count !== 'undefined'
        ? Number(data.server_inbounds_enabled_count)
        : -1;
    uiCapabilities.serverInboundsEnabledCount = Number.isFinite(
      serverInboundsEnabledCount,
    )
      ? serverInboundsEnabledCount
      : -1;

    applyUiCapabilities();

    return uiCapabilities;
  };

  return function loadUiCapabilities(): Promise<UiCapabilities> {
    if (uiCapabilities.loaded) {
      return Promise.resolve(uiCapabilities);
    }

    if (uiCapabilitiesPromise) {
      return uiCapabilitiesPromise;
    }

    uiCapabilitiesPromise = ForkopShellMethods.getUiCapabilities()
      .then((response) => {
        if (!response?.success) {
          throw new Error('UI capabilities request failed');
        }

        return updateUiCapabilities(response.data);
      })
      .catch((error) => {
        // Nothing else can answer, so the tabs proceed with the defaults
        // rather than waiting for a capability payload that never arrives.
        console.warn('Failed to load Forkop UI capabilities', error);
        return updateUiCapabilities({});
      })
      .finally(() => {
        uiCapabilitiesPromise = null;
      });

    return uiCapabilitiesPromise;
  };
}
