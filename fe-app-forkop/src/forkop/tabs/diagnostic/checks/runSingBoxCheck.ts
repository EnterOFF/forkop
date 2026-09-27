import { DIAGNOSTICS_CHECKS_MAP } from './contstants';
import { ForkopShellMethods } from '../../../methods';
import { updateCheckStore } from './updateCheckStore';
import { getMeta } from '../helpers/getMeta';

export async function runSingBoxCheck() {
  const { order, title, code } = DIAGNOSTICS_CHECKS_MAP.SINGBOX;

  updateCheckStore({
    order,
    code,
    title,
    description: _('Checking, please wait'),
    state: 'loading',
    items: [],
  });

  const singBoxChecks = await ForkopShellMethods.checkSingBox();

  if (!singBoxChecks.success) {
    updateCheckStore({
      order,
      code,
      title,
      description: _('Cannot receive checks result'),
      state: 'error',
      items: [],
    });

    throw new Error('Sing-box checks failed');
  }

  const data = singBoxChecks.data;

  const allGood =
    Boolean(data.sing_box_installed) &&
    Boolean(data.sing_box_version_ok) &&
    Boolean(data.sing_box_service_exist) &&
    Boolean(data.sing_box_autostart_disabled) &&
    Boolean(data.sing_box_process_running) &&
    Boolean(data.sing_box_ports_listening);

  const atLeastOneGood =
    Boolean(data.sing_box_installed) ||
    Boolean(data.sing_box_version_ok) ||
    Boolean(data.sing_box_service_exist) ||
    Boolean(data.sing_box_autostart_disabled) ||
    Boolean(data.sing_box_process_running) ||
    Boolean(data.sing_box_ports_listening);

  const { state, description } = getMeta({ atLeastOneGood, allGood });

  updateCheckStore({
    order,
    code,
    title,
    description,
    state,
    items: [
      {
        state: data.sing_box_installed ? 'success' : 'error',
        key: _('Installed'),
        value: '',
      },
      {
        state: data.sing_box_version_ok ? 'success' : 'error',
        key: _('Version is compatible'),
        value: '',
      },
      {
        state: data.sing_box_service_exist ? 'success' : 'error',
        key: _('Service exists'),
        value: '',
      },
      {
        state: data.sing_box_autostart_disabled ? 'success' : 'error',
        key: _('Autostart disabled'),
        value: '',
      },
      {
        state: data.sing_box_process_running ? 'success' : 'error',
        key: _('Process running'),
        value: '',
      },
      {
        state: data.sing_box_ports_listening ? 'success' : 'error',
        key: _('Ports listening'),
        value: '',
      },
    ],
  });

  if (!atLeastOneGood || !data.sing_box_process_running) {
    throw new Error('Sing-box checks failed');
  }
}
