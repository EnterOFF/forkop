import { FORKOP_UCI_PACKAGE } from '../../../../constants';
import { E } from '../../../../helpers/element';
import { store } from '../../../services/store.service';
import type { StoreType } from '../../../services/store.service';

// With Request WARP through a section on, the profile request leaves through an
// inbound of the running core, so it cannot be made while the core is down. A
// state the page has not read yet blocks nothing: the router still answers.
export function warpGenerateBlockReason(
  viaSection: boolean,
  service: StoreType['serviceState'],
) {
  return viaSection &&
    !service.loading &&
    !service.failed &&
    !service.data.singbox
    ? _('Start Forkop: WARP is requested through a section')
    : '';
}

export function showWarpGenerateBlock(
  button: HTMLButtonElement,
  hint: HTMLElement,
  readonly: boolean,
  reason: string,
) {
  button.disabled = readonly || reason !== '';
  button.title = reason;
  hint.textContent = reason;
  hint.style.display = reason ? '' : 'none';
}

// LuCI renders the button once, when the dialog opens; the service can start or
// stop while it is open. The reason also stands under the button, since a
// browser may show no tooltip over a disabled one.
export function keepWarpGenerateButtonCurrent(option: CBIOption) {
  const renderWidget = option.renderWidget;
  option.renderWidget = function (
    sectionId: string,
    optionIndex: string,
    cfgvalue: unknown,
  ) {
    const widget = renderWidget.call(
      this,
      sectionId,
      optionIndex,
      cfgvalue,
    ) as DocumentFragment;
    const button = widget.querySelector('button');
    if (!button) {
      return widget;
    }
    const hint = E('div', { class: 'cbi-value-description' });
    const readonly = button.disabled;
    const show = () =>
      showWarpGenerateBlock(
        button,
        hint,
        readonly,
        warpGenerateBlockReason(
          uci.get(FORKOP_UCI_PACKAGE, 'settings', 'warp_profiles_via_proxy') ===
            '1',
          store.get().serviceState,
        ),
      );
    show();
    let shown = false;
    const unsubscribe = store.subscribeKey('serviceState', () => {
      if (button.isConnected) {
        shown = true;
      } else if (shown) {
        unsubscribe();
        return;
      }
      show();
    });
    return E([widget, hint]);
  };
}
