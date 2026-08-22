import { DIAGNOSTICS_CHECKS_MAP } from './contstants';
import { ForkopShellMethods } from '../../../methods';
import { runNfqueueProviderCheck } from './runNfqueueProviderCheck';

export async function runZapret2Check() {
  return runNfqueueProviderCheck(
    DIAGNOSTICS_CHECKS_MAP.ZAPRET2,
    ForkopShellMethods.getZapret2Status,
    'Zapret2 checks failed',
    {
      providerAvailable: _('Zapret2 provider binary is available'),
      providerUnavailable: _('Zapret2 provider binary is not available'),
      packageInstalled: _('Zapret2 package is installed'),
      packageMissing: _('Zapret2 package is not installed'),
      rulesPresent: _('There are rules using Zapret2'),
      rulesAbsent: _('No rules use Zapret2'),
      runtimeReady: _('Forkop-managed nfqws2 runtime is ready'),
      runtimeNotReady: _('Forkop-managed nfqws2 runtime is not ready'),
      runtimeUnexpected: _(
        'Unexpected Forkop-managed nfqws2 runtime is running',
      ),
      runtimeStopped: _('Forkop-managed nfqws2 runtime is not running'),
      outboundConfigured: _('Zapret2 sing-box outbound is configured'),
      outboundMissing: _('Zapret2 sing-box outbound is not configured'),
      standaloneConflict: _(
        'Standalone Zapret2 is active together with Forkop Zapret2 rules',
      ),
      standaloneActive: _('Standalone Zapret2 service is active'),
      standaloneAutostart: _('Standalone Zapret2 autostart is enabled'),
      standaloneInactive: _('Standalone Zapret2 service is inactive'),
    },
  );
}
