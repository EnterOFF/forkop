import { describe, expect, it } from 'vitest';
import { filterLogText } from '../filterLogs';

const logs = [
  'daemon.info sing-box[123]: started',
  'user.notice forkop: [info] sing-box configuration generated',
  'user.err forkop: [error] failed to start',
].join('\n');

describe('log filtering', () => {
  it('shows all logs by default and filters them by search text', () => {
    expect(filterLogText(logs, '')).toBe(logs);
    expect(filterLogText(`${logs}\n`, '')).toBe(logs);
    expect(filterLogText(logs, 'ERROR')).toBe(
      'user.err forkop: [error] failed to start',
    );
  });
});
