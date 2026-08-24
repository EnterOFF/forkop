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

type CoreServiceOptions = {
  waitForLogWatcherStart?: () => Promise<unknown>;
  logWatcherStartDelayMs?: number;
};

const LOG_FEED_START_DELAY_MS = 5000;

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
  } else {
    void startLogFeed();
  }

  registerRuntimeStateResumeRefresh();
  startRuntimeUiStatePolling();
}
