import { Forkop } from '../../types';

// What a section's own latency test measures: the selector sweeping its
// members, or the one outbound of a section that has no choice to make.
export function sectionLatencyTarget(
  section: Forkop.OutboundGroup,
): { type: 'group' | 'proxy'; tag: string } | undefined {
  if (section.withTagSelect) {
    return { type: 'group', tag: section.code };
  }

  const outbound = section.outbounds[0];
  return outbound ? { type: 'proxy', tag: outbound.code } : undefined;
}
