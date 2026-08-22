import { DIAGNOSTICS_CHECKS_MAP } from './contstants';
import { ForkopShellMethods } from '../../../methods';
import { runNfqueueProviderCheck } from './runNfqueueProviderCheck';

export async function runZapretCheck() {
  return runNfqueueProviderCheck(
    DIAGNOSTICS_CHECKS_MAP.ZAPRET,
    ForkopShellMethods.getZapretStatus,
    'Zapret checks failed',
    {
      providerAvailable: _('Provider binary is available'),
      providerUnavailable: _('Provider binary is not available'),
      packageInstalled: _('Package is installed'),
      packageMissing: _('Package is not installed'),
      rulesPresent: _('There are rules using Zapret'),
      rulesAbsent: _('No rules use Zapret'),
      runtimeReady: _('nfqws runtime is ready'),
      runtimeNotReady: _('nfqws runtime is not ready'),
      runtimeUnexpected: _('Unexpected nfqws runtime is running'),
      runtimeStopped: _('nfqws runtime is not running'),
      outboundConfigured: _('Outbound is configured'),
      outboundMissing: _('Outbound is not configured'),
      standaloneConflict: _(
        'Standalone Zapret is active together with Forkop Zapret rules',
      ),
      standaloneActive: _('Standalone service is active'),
      standaloneAutostart: _('Standalone autostart is enabled'),
      standaloneInactive: _('Standalone service is inactive'),
    },
  );
}
