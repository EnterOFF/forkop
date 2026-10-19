// Which checks show their details is the controller's call, made again for
// every run: a check with a problem opens, one that passed is a single line,
// and what the reader folds by hand holds until the next run lays the list out
// again. This drives the real controller over a stubbed page and reads what it
// asks each check to draw.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Forkop } from '../../../types';
import type {
  IDiagnosticsChecksStoreItem,
  StoreService,
  StoreType,
} from '../../../services/store.service';

type Drawn = { expanded?: boolean; onToggle?: () => void };

const mocks = vi.hoisted(() => {
  const drawn = new Map<string, Drawn>();
  let runActionClick: (() => void) | null = null;

  return {
    drawn,
    clickRunAction: () => runActionClick?.(),
    renderRunAction: (props: { click: () => void }) => {
      runActionClick = props.click;
      return {};
    },
    renderCheckSection: (check: { code: string }, options: Drawn) => {
      drawn.set(check.code, options);
      return {};
    },
    renderStub: () => ({}),
    uiState: {
      service: {},
      capabilities: { server_inbounds_enabled_count: 0 },
      actions: { service: [] },
    } as unknown as Forkop.UiState,
  };
});

vi.mock('../../../../helpers/onMount', () => ({
  onMount: async () => ({}),
}));
vi.mock('../../../../helpers/preserveScrollForPage', () => ({
  preserveScrollForPage: (renderFn: () => void) => renderFn(),
}));
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
  renderCheckSection: mocks.renderCheckSection,
  renderRunAction: mocks.renderRunAction,
  renderSystemInfo: mocks.renderStub,
}));
for (const runner of [
  'runDnsCheck',
  'runSingBoxCheck',
  'runNftCheck',
  'runSectionsCheck',
  'runInboundsCheck',
  'runFakeIPCheck',
]) {
  vi.doMock(`../checks/${runner}`, () => ({ [runner]: async () => {} }));
}

let store: StoreService<StoreType>;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// The list a finished run leaves, one check in each state that matters.
function publishResult() {
  const states: Record<string, IDiagnosticsChecksStoreItem['state']> = {
    DNS: 'success',
    SINGBOX: 'error',
    NFT: 'warning',
  };
  store.set({
    diagnosticsChecks: store.get().diagnosticsChecks.map((check) => ({
      ...check,
      state: states[check.code] || 'success',
      items: [{ state: 'success', key: 'checked', value: '' }],
    })),
  });
}

describe('which checks show their details', () => {
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

  beforeEach(async () => {
    mocks.clickRunAction();
    await flush();
    publishResult();
    await flush();
  });

  it('opens a check with a problem and keeps one that passed to a line', () => {
    expect(mocks.drawn.get('SINGBOX')?.expanded).toBe(true);
    expect(mocks.drawn.get('NFT')?.expanded).toBe(true);
    expect(mocks.drawn.get('DNS')?.expanded).toBe(false);
  });

  it('keeps what the reader folded by hand until the next run', async () => {
    mocks.drawn.get('DNS')?.onToggle?.();
    mocks.drawn.get('NFT')?.onToggle?.();
    expect(mocks.drawn.get('DNS')?.expanded).toBe(true);
    expect(mocks.drawn.get('NFT')?.expanded).toBe(false);

    publishResult();
    await flush();
    expect(mocks.drawn.get('DNS')?.expanded).toBe(true);

    mocks.clickRunAction();
    await flush();
    publishResult();
    await flush();
    expect(mocks.drawn.get('DNS')?.expanded).toBe(false);
    expect(mocks.drawn.get('NFT')?.expanded).toBe(true);
  });
});
