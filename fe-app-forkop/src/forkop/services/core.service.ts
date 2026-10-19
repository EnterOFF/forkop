import { TabServiceInstance } from './tab.service';
import { store } from './store.service';
import { logger } from './logger.service';
import {
  getForkopLogCursor,
  startForkopLogFeed,
} from './forkopLogFeed.service';
import { ForkopLogNotification } from './logNotificationDeduper.service';
import { LogAlerts } from './logAlerts.service';
import {
  dropLogNotificationHandoff,
  saveLogNotificationHandoff,
  takeLogNotificationHandoff,
} from './logNotificationHandoff.service';
import {
  registerRuntimeStateResumeRefresh,
  startRuntimeUiStatePolling,
} from './runtimeUiState.service';
import { ensureSystemInfo } from './systemInfo.service';
import { E } from '../../helpers/element';

// Collecting the installed versions takes seconds - opkg is asked about every
// package and the core binary about itself. Warming them once per page lets the
// Status tab open with the numbers already there, and a page that never visits
// it only spends the work in the background.
//
// On a delay rather than at once: it is several subprocesses on a router that
// may have one slow core, and the first runtime-state poll - the status the user
// is actually looking at - should not have to queue behind them.
const SYSTEM_INFO_PREFETCH_DELAY_MS = 2000;

function showLogNotification(notification: ForkopLogNotification) {
  return ui.addNotification(
    _('Forkop Error'),
    E('div', {}, notification.message),
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

  const logAlerts = new LogAlerts(showLogNotification);
  const handoff = takeLogNotificationHandoff();
  logAlerts.reopen(handoff?.lines ?? []);

  window.addEventListener('pagehide', () => {
    saveLogNotificationHandoff({
      cursor: getForkopLogCursor() || handoff?.cursor || 0,
      lines: logAlerts.openLines(),
    });
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      dropLogNotificationHandoff();
    }
  });

  startForkopLogFeed((line) => logAlerts.read(line), handoff?.cursor ?? 0);
  window.setTimeout(() => {
    void ensureSystemInfo().catch(() => null);
  }, SYSTEM_INFO_PREFETCH_DELAY_MS);

  registerRuntimeStateResumeRefresh();
  startRuntimeUiStatePolling();
}
