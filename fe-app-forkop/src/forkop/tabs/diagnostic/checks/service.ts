import { ForkopShellMethods } from '../../../methods';
import type { IDiagnosticsChecksItem } from '../../../services';
import type { Forkop } from '../../../types';
import { formatDuration } from '../../../helpers/formatDuration';
import {
  CheckOutcome,
  finding,
  formatMegabytes,
  outcome,
  unanswered,
} from './present';

// Below this share of free memory the kernel is about to start killing.
const LOW_MEMORY_SHARE = 0.1;

function forkopItem(data: Forkop.ServiceCheckResult) {
  if (data.running) {
    return finding(
      'success',
      'Forkop',
      data.uptime >= 0
        ? _('running for %s').format(formatDuration(data.uptime))
        : _('running'),
    );
  }

  return finding(
    'error',
    'Forkop',
    data.last_error
      ? _('not running: %s').format(data.last_error)
      : _('not running'),
  );
}

function coreItem(data: Forkop.ServiceCheckResult) {
  const key = _('Core');
  const { version, variant, problem } = data.core;

  if (!version) {
    return finding('error', key, _('sing-box-forkop is not installed'));
  }
  if (problem) {
    return finding('error', key, problem);
  }
  return finding(
    'success',
    key,
    variant
      ? _('sing-box-forkop %s (%s)').format(version, variant)
      : _('sing-box-forkop %s').format(version),
  );
}

function conflictItems(data: Forkop.ServiceCheckResult) {
  const key = _('Conflicts');
  const items: IDiagnosticsChecksItem[] = data.conflicts.map((conflict) =>
    conflict.kind === 'tproxy'
      ? finding('error', key, _('%s intercepts traffic').format(conflict.table))
      : finding(
          'error',
          key,
          _('%s takes DNS queries before Forkop').format(conflict.table),
        ),
  );

  if (data.foreign_sing_box.length) {
    items.push(
      finding(
        'error',
        key,
        _('another sing-box is running (PID %s)').format(
          data.foreign_sing_box.join(', '),
        ),
      ),
    );
  }

  return items.length ? items : [finding('success', key, _('none found'))];
}

function memoryItem(data: Forkop.ServiceCheckResult) {
  const key = _('Memory');
  const free = _('%s of %s free').format(
    formatMegabytes(data.memory.available_kb),
    formatMegabytes(data.memory.total_kb),
  );

  if (data.oom.length) {
    const counts = new Map<string, number>();
    for (const kill of data.oom) {
      counts.set(kill.process, (counts.get(kill.process) || 0) + 1);
    }
    const killed = [...counts]
      .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
      .join(', ');

    return finding(
      'warning',
      key,
      _('ran out in the last day: the kernel killed %s').format(killed),
    );
  }

  if (
    data.memory.total_kb > 0 &&
    data.memory.available_kb < data.memory.total_kb * LOW_MEMORY_SHARE
  ) {
    return finding('warning', key, free);
  }

  return finding('success', key, free);
}

export function presentService(
  data: Forkop.ServiceCheckResult,
): IDiagnosticsChecksItem[] {
  return [
    forkopItem(data),
    coreItem(data),
    ...conflictItems(data),
    memoryItem(data),
  ];
}

// A failed call says nothing about the service, so the runtime checks still try.
export async function runServiceCheck(): Promise<{
  result: CheckOutcome;
  running: boolean;
  data?: Forkop.ServiceCheckResult;
}> {
  const response = await ForkopShellMethods.checkService();

  if (!response.success) {
    return { result: unanswered(), running: true };
  }

  return {
    result: outcome(presentService(response.data)),
    running: response.data.running,
    data: response.data,
  };
}
