import { getServiceStatusDisplay } from '../helpers/serviceStatusDisplay';
import { store } from '../services/store.service';
import type { StoreType } from '../services/store.service';
import { PAGE_STATUS_ID } from './pageTitle';

// What the heading says about the service, on every tab: a dot in the colour of
// the state and the state in words. A state the page has not read yet, or could
// not read at all, is left unsaid rather than guessed.
export function renderPageStatus(
  node: HTMLElement,
  state: StoreType['serviceState'],
) {
  if (state.loading || state.failed) {
    node.className = '';
    node.replaceChildren();
    return;
  }

  const display = getServiceStatusDisplay({
    running: Boolean(state.data.forkopRunning),
    busy: state.data.forkopBusy,
  });
  const dot = document.createElement('span');
  dot.className = 'fkp_page-status__dot';

  node.className = `fkp_page-status fkp_page-status--${display.tone}`;
  node.replaceChildren(dot, display.label);
}

export function mountPageStatus(root: ParentNode) {
  const node = root.querySelector<HTMLElement>(`#${PAGE_STATUS_ID}`);
  if (!node) {
    return;
  }

  renderPageStatus(node, store.get().serviceState);
  store.subscribeKey('serviceState', (state) => renderPageStatus(node, state));
}
