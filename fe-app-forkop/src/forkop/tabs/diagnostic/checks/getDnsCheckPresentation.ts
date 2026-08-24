import type { Forkop } from '../../../types';
import { getMeta } from '../helpers/getMeta';

type DnsCheckState = 'error' | 'success' | 'warning';

export function getDnsCheckPresentation(data: Forkop.DnsCheckResult) {
  const captureDisabled = Boolean(data.dns_capture_disabled);
  const captureOk = captureDisabled || Boolean(data.dns_capture_status);

  const allGood =
    Boolean(data.dns_on_router) &&
    Boolean(data.local_dns_status) &&
    captureOk &&
    Boolean(data.bootstrap_dns_status) &&
    Boolean(data.dns_status);

  const atLeastOneGood =
    Boolean(data.dns_on_router) ||
    Boolean(data.local_dns_status) ||
    captureOk ||
    Boolean(data.bootstrap_dns_status) ||
    Boolean(data.dns_status);

  const meta = getMeta({ atLeastOneGood, allGood });
  const state: DnsCheckState =
    captureDisabled && meta.state === 'success' ? 'warning' : meta.state;
  const description =
    captureDisabled && meta.state === 'success'
      ? _('Checks passed with DNS capture disabled')
      : meta.description;

  const captureItemState: DnsCheckState = captureDisabled
    ? 'warning'
    : data.dns_capture_status
      ? 'success'
      : 'error';
  const captureItemKey = captureDisabled
    ? _('DNS capture is disabled')
    : _('DNS capture active');

  return {
    state,
    description,
    captureItemState,
    captureItemKey,
  };
}
