import { ForkopShellMethods } from '../../../methods';
import type { IDiagnosticsChecksItem } from '../../../services';
import type { Forkop } from '../../../types';
import {
  CheckOutcome,
  finding,
  formatDuration,
  formatMegabytes,
  outcome,
  unanswered,
} from './present';

// Shadowsocks 2022 refuses a client more than 30 seconds off.
const CLOCK_TOLERANCE_S = 30;
// Below this share of free memory the kernel is about to start killing.
const LOW_MEMORY_SHARE = 0.1;

// When the browser asked and when it heard back, to judge the router's clock
// against: the router stamped its answer somewhere in between.
export interface RequestWindow {
  sentAt: number;
  receivedAt: number;
}

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
      _('ran out within a day, the kernel stopped %s').format(killed),
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

// The router stamps its answer in whole seconds somewhere between the request
// and its reply, so only a difference beyond that window is the clock's.
export function clockSkewSeconds(routerTime: number, window: RequestWindow) {
  const stamp = routerTime * 1000;
  const earliest = window.sentAt - 1000;
  const latest = window.receivedAt + 1000;
  const skew =
    stamp < earliest ? earliest - stamp : stamp > latest ? stamp - latest : 0;

  return Math.round(skew / 1000);
}

function clockItem(data: Forkop.ServiceCheckResult, window: RequestWindow) {
  const key = _('Clock');
  const skew = clockSkewSeconds(data.time, window);

  if (skew > CLOCK_TOLERANCE_S) {
    return finding(
      'warning',
      key,
      _('%s off from this device').format(formatDuration(skew)),
    );
  }

  return finding('success', key, _('matches this device'));
}

export function presentService(
  data: Forkop.ServiceCheckResult,
  window: RequestWindow,
): IDiagnosticsChecksItem[] {
  return [
    forkopItem(data),
    ...conflictItems(data),
    memoryItem(data),
    clockItem(data, window),
  ];
}

// Whether the checks that need the runtime can run comes back with the result.
// A failed call says nothing about the service, so they still try.
export async function runServiceCheck(): Promise<{
  result: CheckOutcome;
  running: boolean;
  data?: Forkop.ServiceCheckResult;
}> {
  const sentAt = Date.now();
  const response = await ForkopShellMethods.checkService();
  const receivedAt = Date.now();

  if (!response.success) {
    return { result: unanswered(), running: true };
  }

  return {
    result: outcome(presentService(response.data, { sentAt, receivedAt })),
    running: response.data.running,
    data: response.data,
  };
}
