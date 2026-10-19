// Enable and Disable autostart are one button that swaps places: which of the
// two is shown follows `service.forkop.enabled`, and no local flag stands in
// for it while the click is in flight. So the spinner has to outlast the read
// that brings the new value back - stopping it first puts the button the user
// just pressed back on the page, idle and unchanged, which reads as a click
// that did nothing. That ordering only exists in the controller, so this drives
// the real one over a stubbed page and records every frame the row renders.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Forkop } from '../../../types';
import type { StoreService, StoreType } from '../../../services/store.service';

interface ActionProps {
  loading: boolean;
  visible: boolean;
  onClick: () => void;
}

const mocks = vi.hoisted(() => {
  const frames: string[] = [];
  let recording = false;
  let latest: { enable: ActionProps; disable: ActionProps } | null = null;

  return {
    frames,
    startRecording() {
      recording = true;
      frames.length = 0;
    },
    latestActions: () => latest,
    refreshRuntimeUiStateNow: vi.fn(async () => undefined),
    showToast: vi.fn(),
    enable: vi.fn(async () => ({ success: true, data: undefined })),
    disable: vi.fn(async () => ({ success: true, data: undefined })),
    renderStub: () => ({}),
    // Only the two autostart controls matter, and only in the shape the user
    // sees them: which one is on the row, and whether it is spinning.
    renderAvailableActions: (props: {
      enable: ActionProps;
      disable: ActionProps;
    }) => {
      latest = props;

      if (recording) {
        const shown = [
          ['enable', props.enable] as const,
          ['disable', props.disable] as const,
        ]
          .filter(([, action]) => action.visible)
          .map(
            ([name, action]) => `${name}:${action.loading ? 'busy' : 'idle'}`,
          )
          .join('+');

        if (frames[frames.length - 1] !== shown) {
          frames.push(shown);
        }
      }

      return {};
    },
    uiState: {
      service: {},
      capabilities: {
        server_inbounds_enabled_count: 0,
      },
      actions: { service: [] },
    } as unknown as Forkop.UiState,
  };
});

vi.mock('../../../../helpers/showToast', () => ({
  showToast: mocks.showToast,
}));
vi.mock('../../../../helpers/onMount', () => ({
  onMount: async () => ({}),
}));
vi.mock('../../../../helpers/preserveScrollForPage', () => ({
  preserveScrollForPage: (renderFn: () => void) => renderFn(),
}));

// The real store, because the page and the handler share it; stubs for
// everything that would otherwise reach the router.
vi.mock('../../../services', async () => ({
  ...(await import('../../../services/store.service')),
  logger: { debug: () => {}, error: () => {}, info: () => {}, warn: () => {} },
  getCachedRuntimeUiState: () => mocks.uiState,
  refreshRuntimeUiState: async () => mocks.uiState,
  refreshRuntimeUiStateNow: mocks.refreshRuntimeUiStateNow,
  subscribeRuntimeUiState: () => () => {},
  setLocalServiceAction: () => {},
}));

vi.mock('../../../services/systemInfo.service', () => ({
  ensureSystemInfo: async () => ({}),
}));

vi.mock('../../../methods', () => ({
  ForkopShellMethods: {
    enable: mocks.enable,
    disable: mocks.disable,
  },
  CustomForkopMethods: {},
}));

vi.mock('../partials', () => ({
  renderAvailableActions: mocks.renderAvailableActions,
  renderCheckSection: mocks.renderStub,
  renderRunAction: mocks.renderStub,
  renderSystemInfo: mocks.renderStub,
}));

let store: StoreService<StoreType>;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// The page has an answer about the service, so the row is offered at all, and
// autostart stands where the caller says.
function publishAutostart(enabled: number) {
  store.set({
    servicesInfoWidget: {
      loading: false,
      failed: false,
      data: {
        singbox: 1,
        forkopRunning: 1,
        forkopEnabled: enabled,
        forkopBusy: null,
      },
    },
  });
}

describe('autostart button', () => {
  beforeAll(async () => {
    const element = {
      isConnected: true,
      offsetParent: {},
      replaceChildren() {},
    };

    globalThis.document = {
      getElementById: () => element,
      querySelector: () => null,
    } as unknown as Document;

    ({ store } = await import('../../../services'));

    const { initController } = await import('../initController');

    await initController();
    store.set({ tabService: { current: 'diagnostic', all: [] } });
    await flush();
  });

  beforeEach(() => {
    mocks.enable.mockClear();
    mocks.disable.mockClear();
    mocks.showToast.mockClear();
    mocks.refreshRuntimeUiStateNow.mockReset();
    mocks.refreshRuntimeUiStateNow.mockResolvedValue(undefined);
  });

  it('holds the spinner until the opposite button is the one on the row', async () => {
    publishAutostart(0);
    await flush();
    mocks.refreshRuntimeUiStateNow.mockImplementation(async () => {
      publishAutostart(1);
      return undefined;
    });

    mocks.startRecording();
    mocks.latestActions()!.enable.onClick();
    await flush();

    expect(mocks.enable).toHaveBeenCalledOnce();
    expect(mocks.frames).toEqual(['enable:busy', 'disable:idle']);
  });

  it('does the same in the other direction', async () => {
    publishAutostart(1);
    await flush();
    mocks.refreshRuntimeUiStateNow.mockImplementation(async () => {
      publishAutostart(0);
      return undefined;
    });

    mocks.startRecording();
    mocks.latestActions()!.disable.onClick();
    await flush();

    expect(mocks.disable).toHaveBeenCalledOnce();
    expect(mocks.frames).toEqual(['disable:busy', 'enable:idle']);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  // The button stays where it was, which on its own reads as a click that did
  // nothing.
  it('says so when the switch did not move', async () => {
    publishAutostart(0);
    await flush();
    mocks.enable.mockResolvedValueOnce({ success: false, data: undefined });

    mocks.latestActions()!.enable.onClick();
    await flush();

    expect(mocks.showToast).toHaveBeenCalledWith(
      'Could not enable autostart',
      'error',
    );
  });
});
