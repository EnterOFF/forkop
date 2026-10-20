import { FORKOP_UCI_PACKAGE } from '../../../../constants';
import { E } from '../../../../helpers/element';
import { store } from '../../../services/store.service';
import type { StoreType } from '../../../services/store.service';

// With WARP requests through a section, the request leaves through the running core's inbound, so
// it cannot go while the core is down; a state not read yet blocks nothing.
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

// LuCI renders the button once, and the service may start or stop meanwhile; the reason also
// stands under it, since a disabled button may show no tooltip.
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
