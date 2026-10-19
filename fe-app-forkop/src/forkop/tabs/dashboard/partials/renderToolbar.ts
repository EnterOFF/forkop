import { renderButton } from '../../../../partials';
import {
  renderDownloadIcon24,
  renderGaugeIcon24,
  renderRotateCcwIcon24,
} from '../../../../icons';
import { E } from '../../../../helpers/element';

interface IToolbarAction {
  busy: boolean;
  onClick: () => void;
}

interface IRenderToolbarProps {
  testAll?: IToolbarAction;
  updateSubscriptions?: IToolbarAction;
  updateLists?: IToolbarAction;
}

// What acts on every section at once. Lists and subscriptions are refreshed for
// the whole router: a rule set two sections name is one download, and the lists
// of the DNS, bypass and block sections have no card on this page to carry a
// button of their own.
export function renderToolbar({
  testAll,
  updateSubscriptions,
  updateLists,
}: IRenderToolbarProps): HTMLElement[] {
  const actions = [
    testAll &&
      renderButton({
        classNames: ['fkp_dashboard-page__toolbar__action'],
        icon: renderGaugeIcon24,
        text: _('Test all sections'),
        loading: testAll.busy,
        onClick: testAll.onClick,
      }),
    updateSubscriptions &&
      renderButton({
        classNames: ['fkp_dashboard-page__toolbar__action'],
        icon: renderRotateCcwIcon24,
        text: _('Update subscriptions'),
        loading: updateSubscriptions.busy,
        onClick: updateSubscriptions.onClick,
      }),
    updateLists &&
      renderButton({
        classNames: ['fkp_dashboard-page__toolbar__action'],
        icon: renderDownloadIcon24,
        text: _('Update lists'),
        loading: updateLists.busy,
        onClick: updateLists.onClick,
      }),
  ].filter((action): action is HTMLButtonElement => Boolean(action));

  return actions.length
    ? [E('div', { class: 'fkp_dashboard-page__toolbar' }, actions)]
    : [];
}
