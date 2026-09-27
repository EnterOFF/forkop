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
import { E } from '../../helpers/element';

const LOG_FEED_START_DELAY_MS = 5000;

// Collecting the component versions takes seconds - opkg is asked about every
// package and the core binary about itself. Warming them once per page lets the
// Status and Components tabs open with the numbers already there, and a page
// that never visits either only spends the work in the background.
//
// On a delay rather than at once: it is several subprocesses on a router that
// may have one slow core, and the first runtime-state poll - the status the user
// is actually looking at - should not have to queue behind them.
const SYSTEM_INFO_PREFETCH_DELAY_MS = 2000;

function componentDisplayName(component: string) {
  const names: Record<string, string> = {
    forkop: 'Forkop',
    sing_box: 'sing-box',
  };

  return names[component] || component;
}

function showLogNotification(notification: ForkopLogNotification) {
  if (notification.kind === 'component-update') {
    const message = _('New version %s is available for %s').format(
      notification.version,
      componentDisplayName(notification.component),
    );

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

export function coreService() {
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

  window.setTimeout(
    () => startForkopLogFeed(notifyLogLine),
    LOG_FEED_START_DELAY_MS,
  );
  window.setTimeout(() => {
    void ensureSystemInfo().catch(() => null);
  }, SYSTEM_INFO_PREFETCH_DELAY_MS);

  registerRuntimeStateResumeRefresh();
  startRuntimeUiStatePolling();
}
