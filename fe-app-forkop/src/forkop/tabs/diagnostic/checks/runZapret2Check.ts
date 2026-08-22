import { DIAGNOSTICS_CHECKS_MAP } from './contstants';
import { ForkopShellMethods } from '../../../methods';
import { runNfqueueProviderCheck } from './runNfqueueProviderCheck';

export async function runZapret2Check() {
  return runNfqueueProviderCheck(
    DIAGNOSTICS_CHECKS_MAP.ZAPRET2,
    ForkopShellMethods.getZapret2Status,
    'Zapret2 checks failed',
    {
      providerAvailable: _('Provider binary is available'),
      providerUnavailable: _('Provider binary is not available'),
      packageInstalled: _('Package is installed'),
      packageMissing: _('Package is not installed'),
      rulesPresent: _('There are rules using Zapret2'),
      rulesAbsent: _('No rules use Zapret2'),
      runtimeReady: _('nfqws2 runtime is ready'),
      runtimeNotReady: _('nfqws2 runtime is not ready'),
      runtimeUnexpected: _('Unexpected nfqws2 runtime is running'),
      runtimeStopped: _('nfqws2 runtime is not running'),
      outboundConfigured: _('Outbound is configured'),
      outboundMissing: _('Outbound is not configured'),
      standaloneConflict: _(
        'Standalone Zapret2 is active together with Forkop Zapret2 rules',
      ),
      standaloneActive: _('Standalone service is active'),
      standaloneAutostart: _('Standalone autostart is enabled'),
      standaloneInactive: _('Standalone service is inactive'),
    },
  );
}
