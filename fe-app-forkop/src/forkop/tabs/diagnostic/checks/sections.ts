import { CustomForkopMethods } from '../../../methods';
import { getDashboardSections } from '../../../methods/custom/getDashboardSections';
import type { IDiagnosticsChecksItem } from '../../../services';
import type { Forkop } from '../../../types';
import { CheckOutcome, finding, formatMs, outcome, skipped } from './present';

type Section = Forkop.OutboundGroup;

// How one latency test ended, from what the Clash API answered: a delay, a
// test that ran out of time (504), one that failed outright (503), an outbound
// the running configuration does not have (404), or no answer from the API.
export type Probe =
  | { delay: number }
  | { failure: 'timeout' | 'error' | 'missing' | 'unavailable' };

export function probeResult(
  response: Forkop.MethodResponse<Forkop.GetClashApiProxyLatency>,
): Probe {
  if (response.success && Number(response.data?.delay) > 0) {
    return { delay: Number(response.data.delay) };
  }
  const status = response.success ? 0 : Number(response.status || 0);
  if (status === 504) {
    return { failure: 'timeout' };
  }
  if (status === 503 || (response.success && response.data?.message)) {
    return { failure: 'error' };
  }
  if (status === 404) {
    return { failure: 'missing' };
  }
  return { failure: 'unavailable' };
}

// A section with a choice is tested on the node it uses, with one test's budget; a section of one
// outbound with the section's timeout.
function target(section: Section) {
  if (!section.withTagSelect) {
    return {
      code: section.code,
      node: '',
      timeout: section.latencyTestTimeout,
    };
  }
  const node =
    section.outbounds.find((item) => item.selected) ??
    section.outbounds.find((item) => item.type?.toLowerCase() === 'urltest') ??
    section.outbounds[0];

  return { code: node?.code || section.code, node: node?.displayName || '' };
}

export function presentSection(
  section: Section,
  node: string,
  probe: Probe,
): IDiagnosticsChecksItem {
  const key = section.displayName;
  const on = (text: string) => (node ? `${node}: ${text}` : text);

  if ('delay' in probe) {
    return finding(
      'success',
      key,
      node ? `${node} · ${formatMs(probe.delay)}` : formatMs(probe.delay),
    );
  }

  // An interface that leads only to its own networks has no way out to the
  // test address, and is fine.
  if (
    section.action === 'vpn' &&
    section.outbounds[0]?.runtimeAvailable &&
    probe.failure !== 'unavailable'
  ) {
    return finding(
      'warning',
      key,
      _('interface is up, no internet through it'),
    );
  }

  switch (probe.failure) {
    case 'timeout':
      return finding('error', key, on(_('no answer in time')));
    case 'error':
      return finding('error', key, on(_('connection failed')));
    case 'missing':
      return finding('error', key, on(_('not in the running configuration')));
    default:
      return finding(
        'warning',
        key,
        on(_('not checked: the Clash API did not answer')),
      );
  }
}

export async function runSectionsCheck(): Promise<CheckOutcome> {
  const sections = await getDashboardSections();

  if (!sections.success) {
    return {
      state: 'warning',
      description: _('Not checked: the Clash API did not answer'),
      items: [],
    };
  }
  if (!sections.data.length) {
    return skipped(_('No sections with a proxy'));
  }

  const items = await Promise.all(
    sections.data.map(async (section) => {
      const { code, node, timeout } = target(section);
      const response = await CustomForkopMethods.getClashApiProxyLatency(
        code,
        ...(timeout ? [timeout] : []),
      );
      return presentSection(section, node, probeResult(response));
    }),
  );

  return outcome(items);
}
