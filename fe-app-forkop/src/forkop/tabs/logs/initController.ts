import { onMount } from '../../../helpers/onMount';
import { copyToClipboard } from '../../../helpers/copyToClipboard';
import { downloadAsTxt } from '../../../helpers/downloadAsTxt';
import { renderSearchIcon24 } from '../../../icons';
import { ForkopShellMethods } from '../../methods';
import { isActiveLuciTab } from '../../helpers/isActiveLuciTab';
import { store } from '../../services/store.service';
import { filterLogText } from './filterLogs';

const AUTO_REFRESH_INTERVAL_MS = 2000;

let controllerInitialized = false;
let loading = false;
let rawLogs = '';
let logsLoaded = false;

// Whether the Logs tab is the one being looked at. The theme lays an inactive
// tab out at zero height instead of hiding it, so the pane's own layout cannot
// say; the tab service can.
function logsTabShown() {
  return (
    !document.hidden &&
    (store.get().tabService.current === 'logs' || isActiveLuciTab('logs'))
  );
}

function element<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}

function getVisibleLogs() {
  const query = element<HTMLInputElement>('logs-search').value;

  return filterLogText(rawLogs, query);
}

function renderLogs(scrollToTop = false) {
  const output = element<HTMLPreElement>('logs-output');
  const visibleLogs = getVisibleLogs();

  output.textContent =
    visibleLogs ||
    (rawLogs ? _('No logs match the current filters') : _('No logs available'));
  output.classList.toggle('fkp_logs-page__output--empty', !visibleLogs);
  element<HTMLButtonElement>('logs-copy').disabled = !visibleLogs;
  element<HTMLButtonElement>('logs-download').disabled = !visibleLogs;

  if (scrollToTop) {
    output.scrollTop = 0;
    output.scrollLeft = 0;
  }
}

function setLoading(nextLoading: boolean) {
  loading = nextLoading;
  element('logs-output').setAttribute('aria-busy', String(nextLoading));
}

async function refreshLogs() {
  if (loading) {
    return;
  }

  const output = element<HTMLPreElement>('logs-output');
  const distanceFromEnd =
    output.scrollHeight - output.scrollTop - output.clientHeight;
  const followEnd = !logsLoaded || distanceFromEnd < 32;
  const previousScrollTop = output.scrollTop;
  const previousScrollLeft = output.scrollLeft;

  setLoading(true);

  try {
    const response = await ForkopShellMethods.checkLogs();

    if (!response.success) {
      throw new Error(response.error);
    }

    const nextLogs = String(response.data ?? '');
    if (logsLoaded && nextLogs === rawLogs) {
      return;
    }

    logsLoaded = true;
    rawLogs = nextLogs;
    renderLogs();
    requestAnimationFrame(() => {
      output.scrollTop = followEnd ? output.scrollHeight : previousScrollTop;
      output.scrollLeft = previousScrollLeft;
    });
  } catch (error) {
    console.error('[LOGS] Failed to load logs', error);
    if (!logsLoaded) {
      element('logs-output').textContent = _('Failed to load logs');
    }
  } finally {
    setLoading(false);
  }
}

function copyVisibleLogs() {
  const visibleLogs = getVisibleLogs();
  if (visibleLogs) {
    copyToClipboard(visibleLogs);
  }
}

function downloadVisibleLogs() {
  const visibleLogs = getVisibleLogs();
  if (visibleLogs) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadAsTxt(visibleLogs, `forkop-logs-${timestamp}`);
  }
}

export async function initController(): Promise<void> {
  if (controllerInitialized) {
    return;
  }

  controllerInitialized = true;
  await onMount('logs-status');

  const autoRefresh = element<HTMLInputElement>('logs-auto-refresh');
  autoRefresh.checked = true;
  document
    .querySelector('.fkp_logs-page__search-icon')
    ?.replaceChildren(renderSearchIcon24());

  element('logs-search').addEventListener('input', () => renderLogs(true));
  autoRefresh.addEventListener('change', () => {
    if (autoRefresh.checked) {
      void refreshLogs();
    }
  });
  element('logs-copy').addEventListener('click', copyVisibleLogs);
  element('logs-download').addEventListener('click', downloadVisibleLogs);

  store.subscribe((next, prev) => {
    if (
      next.tabService.current === 'logs' &&
      prev.tabService.current !== 'logs' &&
      (!logsLoaded || autoRefresh.checked)
    ) {
      void refreshLogs();
    }
  });
  setInterval(() => {
    if (autoRefresh.checked && logsTabShown()) {
      void refreshLogs();
    }
  }, AUTO_REFRESH_INTERVAL_MS);

  if (logsTabShown()) {
    void refreshLogs();
  }
}
