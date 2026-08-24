import { TabServiceInstance } from './tab.service';
import { store } from './store.service';
import { logger } from './logger.service';
import { startForkopLogFeed } from './forkopLogFeed.service';
import {
  getForkopLogNotification,
  LogNotificationDeduper,
  ForkopLogNotification,
} from './logNotificationDeduper.service';
import {
  registerRuntimeStateResumeRefresh,
  startRuntimeUiStatePolling,
} from './runtimeUiState.service';
import { ensureSystemInfo } from './systemInfo.service';

type CoreServiceOptions = {
  waitForLogWatcherStart?: () => Promise<unknown>;
  logWatcherStartDelayMs?: number;
};

const LOG_FEED_START_DELAY_MS = 5000;

// Collecting the component versions takes seconds - opkg is asked about every
// package and the core binary about itself - and nothing asked for them until
// the Status or Components tab was opened, so whoever opened one paid the whole
// wait. Warming them once per page means both tabs open with the numbers
// already there, and a page that never visits either only spends the work in
// the background.
//
// On a delay rather than at once: it is several subprocesses on a router that
// may have one slow core, and the first runtime-state poll - the status the user
// is actually looking at - should not have to queue behind them.
const SYSTEM_INFO_PREFETCH_DELAY_MS = 2000;

function componentDisplayName(component: string) {
  const names: Record<string, string> = {
    forkop: 'Forkop',
    sing_box: 'sing-box',
    zapret: 'Zapret',
    zapret2: 'Zapret2',
    byedpi: 'ByeDPI',
  };

  return names[component] || component;
}

function showLogNotification(notification: ForkopLogNotification) {
  if (notification.kind === 'component-update') {
    const message = _('New version %s is available for %s')
      .replace('%s', notification.version)
      .replace('%s', componentDisplayName(notification.component));

    ui.addNotification(
      _('Component update available'),
      E('div', {}, message),
      'warning',
      'fkp-component-update-notification',
    );
    return;
  }

  ui.addNotification(
    _('Forkop Error'),
    E('div', {}, notification.line),
    'error',
    'fkp-log-error-notification',
  );
}

export function coreService(options: CoreServiceOptions = {}) {
  TabServiceInstance.onChange((activeId, tabs) => {
    logger.info('[TAB]', activeId);
    store.set({
      tabService: {
        current: activeId || '',
        all: tabs.map((tab) => tab.id),
      },
    });
  });

  const logNotificationDeduper = new LogNotificationDeduper();

  const notifyLogLine = (line: string) => {
    if (logNotificationDeduper.shouldNotify(line)) {
      const notification = getForkopLogNotification(line);
      if (notification) {
        showLogNotification(notification);
      }
    }
  };

  const startLogFeed = async () => {
    if (options.waitForLogWatcherStart) {
      await Promise.resolve()
        .then(() => options.waitForLogWatcherStart?.())
        .catch(() => null);
    }

    await startForkopLogFeed(notifyLogLine);
  };
  const scheduleStartLogFeed = () =>
    window.setTimeout(() => {
      void startLogFeed();
    }, options.logWatcherStartDelayMs ?? LOG_FEED_START_DELAY_MS);

  if (typeof window !== 'undefined') {
    scheduleStartLogFeed();
    window.setTimeout(() => {
      void ensureSystemInfo().catch(() => null);
    }, SYSTEM_INFO_PREFETCH_DELAY_MS);
  } else {
    void startLogFeed();
  }

  registerRuntimeStateResumeRefresh();
  startRuntimeUiStatePolling();
}
