import { isCopyableProxyLink } from '../../../helpers/isCopyableProxyLink';
import type { Forkop } from '../../types';

type FetchProxyLink = (
  tag: string,
) => Promise<Forkop.MethodResponse<Forkop.GetClashApiProxyLink>>;

export async function resolveOutboundProxyLink(
  outbound: Forkop.Outbound,
  fetchProxyLink: FetchProxyLink,
) {
  const configuredLink = outbound.link?.trim() || '';
  if (isCopyableProxyLink(configuredLink)) return configuredLink;
  if (!outbound.canCopyLink) return '';

  const response = await fetchProxyLink(outbound.code);
  const runtimeLink = response.success ? response.data?.url?.trim() : '';
  return isCopyableProxyLink(runtimeLink) ? runtimeLink : '';
}
