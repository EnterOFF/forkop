import { DIAGNOSTICS_CHECKS_MAP } from './contstants';
import { ForkopShellMethods } from '../../../methods';
import { runNfqueueProviderCheck } from './runNfqueueProviderCheck';

export async function runZapretCheck() {
  return runNfqueueProviderCheck(
    DIAGNOSTICS_CHECKS_MAP.ZAPRET,
    ForkopShellMethods.getZapretStatus,
    'Zapret checks failed',
    {
      providerAvailable: _('Zapret provider binary is available'),
      providerUnavailable: _('Zapret provider binary is not available'),
      packageInstalled: _('Zapret package is installed'),
      packageMissing: _('Zapret package is not installed'),
      rulesPresent: _('There are rules using Zapret'),
      rulesAbsent: _('No rules use Zapret'),
      runtimeReady: _('Forkop-managed nfqws runtime is ready'),
      runtimeNotReady: _('Forkop-managed nfqws runtime is not ready'),
      runtimeUnexpected: _(
        'Unexpected Forkop-managed nfqws runtime is running',
      ),
      runtimeStopped: _('Forkop-managed nfqws runtime is not running'),
      outboundConfigured: _('Zapret sing-box outbound is configured'),
      outboundMissing: _('Zapret sing-box outbound is not configured'),
      standaloneConflict: _(
        'Standalone Zapret is active together with Forkop Zapret rules',
      ),
      standaloneActive: _('Standalone Zapret service is active'),
      standaloneAutostart: _('Standalone Zapret autostart is enabled'),
      standaloneInactive: _('Standalone Zapret service is inactive'),
    },
  );
}
