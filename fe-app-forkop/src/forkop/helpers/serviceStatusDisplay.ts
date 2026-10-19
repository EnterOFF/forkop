import type { Forkop } from '../types';

type ServiceStatusTone = 'success' | 'error' | 'progress';

interface ServiceStatusDisplay {
  label: string;
  tone: ServiceStatusTone;
}

const BUSY_LABELS: Record<Forkop.ServiceBusy, () => string> = {
  start: () => _('starting...'),
  stop: () => _('stopping...'),
  restart: () => _('restarting...'),
  apply: () => _('applying...'),
};

// Running and stopped are not the only two things a service can be, and while an
// operation is in flight they are the wrong question. Applying settings cycles
// the sing-box runtime, so the readiness predicate is briefly false through no
// fault of anyone's - reporting "stopped" for those few seconds is alarming and
// not actionable, and reporting "running" would be made up. What is true, and
// what the user wants to know, is that an operation is under way.
export function getServiceStatusDisplay({
  running,
  busy,
}: {
  running: boolean;
  busy?: Forkop.ServiceBusy | null;
}): ServiceStatusDisplay {
  if (busy) {
    return { label: BUSY_LABELS[busy](), tone: 'progress' };
  }

  return running
    ? { label: _('running'), tone: 'success' }
    : { label: _('stopped'), tone: 'error' };
}
