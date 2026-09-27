// The diagnostics run is the one part of the Status tab that outlives its page:
// LuCI unmounts the tab on every switch while the pass keeps writing checks into
// the shared store, and coming back re-renders whatever it got to. That contract
// only exists at the controller, so this drives the real one over a stubbed page
// and asks the two questions no smaller unit can answer: does a remount start a
// second pass over the same checks, and does anything it sets off clear the list
// the first pass is still filling in.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Forkop } from '../../../types';
import type { StoreService, StoreType } from '../../../services/store.service';

const CHECK_ORDER = ['DNS', 'SINGBOX', 'NFT', 'OUTBOUNDS', 'FAKEIP'];

const mocks = vi.hoisted(() => {
  const runnerCalls: string[] = [];
  let releaseRunningCheck: (() => void) | null = null;
  let runActionClick: (() => void) | null = null;

  return {
    runnerCalls,
    // Every check stops on the router until the test lets it finish, which is
    // where a tab switch lands in the reported case.
    createCheckRunner: (code: string) => async () => {
      runnerCalls.push(code);

      await new Promise<void>((resolve) => {
        releaseRunningCheck = resolve;
      });
    },
    reset() {
      runnerCalls.length = 0;
      releaseRunningCheck = null;
    },
    finishRunningCheck() {
      const release = releaseRunningCheck;

      releaseRunningCheck = null;
      release?.();
    },
    isCheckRunning: () => releaseRunningCheck !== null,
    clickRunAction: () => runActionClick?.(),
    renderRunAction: (props: { click: () => void }) => {
      runActionClick = props.click;
      return {};
    },
    renderStub: () => ({}),
    uiState: {
      service: {},
      capabilities: {
        server_inbounds_enabled_count: 0,
      },
      actions: { service: [], component: [] },
    } as unknown as Forkop.UiState,
  };
});

vi.mock('../../../../helpers/onMount', () => ({
  onMount: async () => ({}),
}));
vi.mock('../../../../helpers/preserveScrollForPage', () => ({
  preserveScrollForPage: (renderFn: () => void) => renderFn(),
}));

// The real store, because the run and the page share it; stubs for everything
// that would otherwise reach the router.
vi.mock('../../../services', async () => ({
  ...(await import('../../../services/store.service')),
  logger: { debug: () => {}, error: () => {}, info: () => {}, warn: () => {} },
  getCachedRuntimeUiState: () => mocks.uiState,
  refreshRuntimeUiState: async () => mocks.uiState,
  subscribeRuntimeUiState: () => () => {},
  setLocalServiceAction: () => {},
}));

vi.mock('../../../services/systemInfo.service', () => ({
  ensureSystemInfo: async () => ({}),
}));

vi.mock('../../../methods', () => ({
  ForkopShellMethods: {},
  CustomForkopMethods: {},
}));

vi.mock('../partials', () => ({
  renderAvailableActions: mocks.renderStub,
  renderCheckSection: mocks.renderStub,
  renderRunAction: mocks.renderRunAction,
  renderSystemInfo: mocks.renderStub,
}));

vi.mock('../checks/runDnsCheck', () => ({
  runDnsCheck: mocks.createCheckRunner('DNS'),
}));
vi.mock('../checks/runSingBoxCheck', () => ({
  runSingBoxCheck: mocks.createCheckRunner('SINGBOX'),
}));
vi.mock('../checks/runNftCheck', () => ({
  runNftCheck: mocks.createCheckRunner('NFT'),
}));
vi.mock('../checks/runSectionsCheck', () => ({
  runSectionsCheck: mocks.createCheckRunner('OUTBOUNDS'),
}));
vi.mock('../checks/runFakeIPCheck', () => ({
  runFakeIPCheck: mocks.createCheckRunner('FAKEIP'),
}));

let store: StoreService<StoreType>;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function showTab(tab: string) {
  store.set({ tabService: { current: tab, all: [] } });
  await flush();
}

function getCheckState(code: string) {
  return store.get().diagnosticsChecks.find((check) => check.code === code)
    ?.state;
}

function getCheckStates() {
  return store
    .get()
    .diagnosticsChecks.map((check) => check.state)
    .join(',');
}

describe('diagnostic run lifecycle', () => {
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
    await flush();
  });

  // One page session for the whole file, the way the browser has it: each case
  // starts by leaving the Status tab, which is what hands the check list back.
  beforeEach(async () => {
    mocks.reset();
    await showTab('dashboard');
  });

  it('keeps one pass and its progress across tab switches', async () => {
    await showTab('diagnostic');
    mocks.clickRunAction();
    await flush();

    expect(mocks.runnerCalls).toEqual(['DNS']);

    // Leaving and coming back while DNS is still on the router: the pass belongs
    // to the page session, not to the mounted page.
    for (let switches = 0; switches < 3; switches += 1) {
      await showTab('dashboard');
      await showTab('diagnostic');
    }

    expect(mocks.runnerCalls).toEqual(['DNS']);
    expect(store.get().diagnosticsRunAction.loading).toBe(true);
    expect(getCheckState('DNS')).toBe('loading');

    for (let index = 0; index < CHECK_ORDER.length; index += 1) {
      expect(mocks.runnerCalls[index]).toBe(CHECK_ORDER[index]);
      mocks.finishRunningCheck();
      await flush();
    }

    expect(mocks.runnerCalls).toEqual(CHECK_ORDER);
    expect(mocks.isCheckRunning()).toBe(false);
    expect(store.get().diagnosticsRunAction.loading).toBe(false);
  });

  it('shows the result of a pass that finished on another tab', async () => {
    await showTab('diagnostic');
    mocks.clickRunAction();
    await flush();
    await showTab('dashboard');

    while (mocks.isCheckRunning()) {
      mocks.finishRunningCheck();
      await flush();
    }

    expect(mocks.runnerCalls).toEqual(CHECK_ORDER);

    // Coming back reads the installed providers again, and that read must not
    // rebuild the list on top of the result waiting on it.
    await showTab('diagnostic');

    expect(getCheckState('FAKEIP')).toBe('loading');
    expect(mocks.runnerCalls).toEqual(CHECK_ORDER);

    // The result belonged to that visit; leaving hands the list back.
    await showTab('dashboard');

    expect(getCheckStates()).toBe('skipped,skipped,skipped,skipped,skipped');
  });
});
