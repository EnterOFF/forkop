import type { IDiagnosticsChecksStoreItem, StoreType } from '../../services';
import type { Forkop } from '../../types';
import { formatDuration } from '../../helpers/formatDuration';
import { formatMegabytes } from './checks/present';

const MARKS: Record<IDiagnosticsChecksStoreItem['state'], string> = {
  success: '✓',
  warning: '!',
  error: '✗',
  skipped: '–',
  loading: '…',
};

// The checks as the page shows them: a group per line, its findings under it.
export function checksText(checks: IDiagnosticsChecksStoreItem[]) {
  const lines: string[] = [];

  for (const check of [...checks].sort((a, b) => a.order - b.order)) {
    lines.push(`${MARKS[check.state]} ${check.title} — ${check.description}`);
    for (const item of check.items) {
      lines.push(
        `    ${MARKS[item.state]} ${item.key}${item.value ? `: ${item.value}` : ''}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function timestamp(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function section(title: string, body: string) {
  const text = body.trim();
  return `== ${title} ==\n${text ? `${text}\n` : `${_('empty')}\n`}`;
}

export interface ReportInput {
  generatedAt: Date;
  systemInfo: StoreType['diagnosticsSystemInfo'];
  luciVersion: string;
  service?: Forkop.ServiceCheckResult;
}

// The router masks the checks like the rest of the report.
export function reportText(
  input: ReportInput,
  attachments: Forkop.ReportAttachments,
) {
  const { systemInfo, service } = input;
  const versions = [`Forkop ${systemInfo.forkop_version}`];
  if (input.luciVersion && input.luciVersion !== systemInfo.forkop_version) {
    versions.push(`LuCI ${input.luciVersion}`);
  }
  versions.push(`sing-box ${systemInfo.sing_box_version}`);

  const system = [
    versions.join(' · '),
    `${systemInfo.openwrt_version} · ${systemInfo.device_model}`,
  ];
  if (service) {
    system.push(
      `${_('Router up for %s').format(formatDuration(service.router_uptime))} · ${_(
        'Memory: %s of %s free',
      ).format(
        formatMegabytes(service.memory.available_kb),
        formatMegabytes(service.memory.total_kb),
      )}`,
    );
  }

  return [
    `${_('Forkop diagnostic report')} · ${timestamp(input.generatedAt)}\n`,
    section(_('System'), system.join('\n')),
    section(_('Checks'), attachments.checks),
    section(_('Log'), attachments.log),
    section(_('Forkop configuration'), attachments.forkop_config),
    section(_('sing-box configuration'), attachments.sing_box_config),
    section('nftables', attachments.nftables),
    section(_('Routing rules'), attachments.ip_rules),
  ].join('\n');
}
