import { renderButton } from '../../../../partials';
import {
  renderCircleCheckBigIcon24,
  renderCirclePlayIcon24,
  renderCircleStopIcon24,
  renderCogIcon24,
  renderFileTextIcon24,
  renderPauseIcon24,
  renderPlayIcon24,
  renderRotateCcwIcon24,
} from '../../../../icons';
import { insertIf } from '../../../../helpers/insertIf';
import { E } from '../../../../helpers/element';

interface ActionProps {
  loading: boolean;
  visible: boolean;
  disabled: boolean;
  onClick: () => void;
}

// While an operation runs, its own button is the progress indicator, so it says
// what is happening. An apply is not a restart: the service keeps running
// through it, and calling it "restarting" reported an outage that never
// happened.
interface RestartActionProps extends ActionProps {
  mode: 'restart' | 'apply';
}

function restartActionText(restart: RestartActionProps) {
  if (!restart.loading) {
    return _('Restart');
  }

  return restart.mode === 'apply' ? _('Applying...') : _('Restarting...');
}

interface IRenderAvailableActionsProps {
  restart: RestartActionProps;
  start: ActionProps;
  stop: ActionProps;
  enable: ActionProps;
  disable: ActionProps;
  globalCheck: ActionProps;
  showConfig: ActionProps;
  showSingBoxConfig: ActionProps;
}

export function renderAvailableActions({
  restart,
  start,
  stop,
  enable,
  disable,
  globalCheck,
  showConfig,
  showSingBoxConfig,
}: IRenderAvailableActionsProps) {
  return E('div', { class: 'fkp_diagnostic-page__controls__actions' }, [
    E('b', {}, _('Available actions')),
    ...insertIf(restart.visible, [
      renderButton({
        classNames: ['cbi-button-apply'],
        onClick: restart.onClick,
        icon: renderRotateCcwIcon24,
        text: restartActionText(restart),
        loading: restart.loading,
        disabled: restart.disabled,
      }),
    ]),
    ...insertIf(stop.visible, [
      renderButton({
        classNames: ['cbi-button-remove'],
        onClick: stop.onClick,
        icon: renderCircleStopIcon24,
        text: stop.loading ? _('Stopping...') : _('Stop'),
        loading: stop.loading,
        disabled: stop.disabled,
      }),
    ]),
    ...insertIf(start.visible, [
      renderButton({
        classNames: ['cbi-button-save'],
        onClick: start.onClick,
        icon: renderCirclePlayIcon24,
        text: start.loading ? _('Starting...') : _('Start'),
        loading: start.loading,
        disabled: start.disabled,
      }),
    ]),
    ...insertIf(disable.visible, [
      renderButton({
        classNames: ['cbi-button-remove'],
        onClick: disable.onClick,
        icon: renderPauseIcon24,
        text: _('Disable autostart'),
        loading: disable.loading,
        disabled: disable.disabled,
      }),
    ]),
    ...insertIf(enable.visible, [
      renderButton({
        classNames: ['cbi-button-save'],
        onClick: enable.onClick,
        icon: renderPlayIcon24,
        text: _('Enable autostart'),
        loading: enable.loading,
        disabled: enable.disabled,
      }),
    ]),
    ...insertIf(globalCheck.visible, [
      renderButton({
        onClick: globalCheck.onClick,
        icon: renderCircleCheckBigIcon24,
        text: _('Global check'),
        loading: globalCheck.loading,
        disabled: globalCheck.disabled,
      }),
    ]),
    ...insertIf(showConfig.visible, [
      renderButton({
        onClick: showConfig.onClick,
        icon: renderFileTextIcon24,
        text: _('Forkop configuration'),
        loading: showConfig.loading,
        disabled: showConfig.disabled,
      }),
    ]),
    ...insertIf(showSingBoxConfig.visible, [
      renderButton({
        onClick: showSingBoxConfig.onClick,
        icon: renderCogIcon24,
        text: _('sing-box configuration'),
        loading: showSingBoxConfig.loading,
        disabled: showSingBoxConfig.disabled,
      }),
    ]),
  ]);
}
