import type { Forkop } from '../../../types';
import { getMeta } from '../helpers/getMeta';

export function getDnsCheckPresentation(data: Forkop.DnsCheckResult) {
  const allGood =
    Boolean(data.dns_on_router) &&
    Boolean(data.local_dns_status) &&
    Boolean(data.dns_capture_status) &&
    Boolean(data.bootstrap_dns_status) &&
    Boolean(data.dns_status);

  const atLeastOneGood =
    Boolean(data.dns_on_router) ||
    Boolean(data.local_dns_status) ||
    Boolean(data.dns_capture_status) ||
    Boolean(data.bootstrap_dns_status) ||
    Boolean(data.dns_status);

  return getMeta({ atLeastOneGood, allGood });
}
