import { TabServiceInstance } from './tab.service';
import { store } from './store.service';
import { logger } from './logger.service';
import {
  getForkopLogCursor,
  startForkopLogFeed,
} from './forkopLogFeed.service';
import {
  getForkopLogNotification,
  LogNotificationDeduper,
  ForkopLogNotification,
} from './logNotificationDeduper.service';
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

    return ui.addNotification(
      _('Component update available'),
      E('div', {}, message),
      'warning',
      'fkp-component-update-notification',
    );
  }

  return ui.addNotification(
    _('Forkop Error'),
    E('div', {}, notification.line),
    'error',
    'fkp-log-error-notification',
  );
}

// LuCI dismisses an alert by fading it out and then removing it.
function isOpen(node: HTMLElement) {
  return node.isConnected && !node.classList.contains('fade-out');
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
  const shownLogNotifications: { line: string; node: HTMLElement }[] = [];

  const show = (line: string) => {
    const notification = getForkopLogNotification(line);
    if (notification) {
      shownLogNotifications.push({
        line,
        node: showLogNotification(notification),
      });
    }
  };

  const handoff = takeLogNotificationHandoff();
  handoff?.lines.forEach(show);

  const notifyLogLine = (line: string) => {
    if (logNotificationDeduper.shouldNotify(line)) {
      show(line);
    }
  };

  window.addEventListener('pagehide', () => {
    saveLogNotificationHandoff({
      cursor: getForkopLogCursor() || handoff?.cursor || 0,
      lines: shownLogNotifications
        .filter(({ node }) => isOpen(node))
        .map(({ line }) => line),
    });
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      dropLogNotificationHandoff();
    }
  });

  window.setTimeout(
    () => startForkopLogFeed(notifyLogLine, handoff?.cursor ?? 0),
    LOG_FEED_START_DELAY_MS,
  );
  window.setTimeout(() => {
    void ensureSystemInfo().catch(() => null);
  }, SYSTEM_INFO_PREFETCH_DELAY_MS);

  registerRuntimeStateResumeRefresh();
  startRuntimeUiStatePolling();
}
