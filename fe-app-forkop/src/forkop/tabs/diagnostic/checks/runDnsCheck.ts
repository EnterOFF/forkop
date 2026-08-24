import { DIAGNOSTICS_CHECKS_MAP } from './contstants';
import { ForkopShellMethods } from '../../../methods';
import type { IDiagnosticsChecksItem } from '../../../services';
import { updateCheckStore } from './updateCheckStore';
import { getDnsCheckPresentation } from './getDnsCheckPresentation';

export async function runDnsCheck() {
  const { order, title, code } = DIAGNOSTICS_CHECKS_MAP.DNS;

  updateCheckStore({
    order,
    code,
    title,
    description: _('Checking, please wait'),
    state: 'loading',
    items: [],
  });

  const dnsChecks = await ForkopShellMethods.checkDNSAvailable();

  if (!dnsChecks.success) {
    updateCheckStore({
      order,
      code,
      title,
      description: _('Cannot receive checks result'),
      state: 'error',
      items: [],
    });

    throw new Error('DNS checks failed');
  }

  const data = dnsChecks.data;
  const { state, description, captureItemState, captureItemKey } =
    getDnsCheckPresentation(data);

  updateCheckStore({
    order,
    code,
    title,
    description,
    state,
    items: [
      {
        state: data.bootstrap_dns_status ? 'success' : 'error',
        key: _('Bootstrap DNS'),
        value: data.bootstrap_dns_server,
      } satisfies IDiagnosticsChecksItem,
      {
        state: data.dns_status ? 'success' : 'error',
        key: _('Main DNS'),
        value: data.dns_server,
      },
      {
        state: data.dns_on_router ? 'success' : 'error',
        key: _('DNS on router'),
        value: '',
      },
      {
        state: data.local_dns_status ? 'success' : 'error',
        key: _('Local resolver'),
        value: data.local_dns_server,
      },
      {
        state: captureItemState,
        key: captureItemKey,
        value: '',
      },
    ],
  });

  if (state === 'error') {
    throw new Error('DNS checks failed');
  }
}
