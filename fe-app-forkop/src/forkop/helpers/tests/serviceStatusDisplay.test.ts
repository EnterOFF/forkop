import { beforeAll, describe, expect, it } from 'vitest';
import { getServiceStatusDisplay } from '../serviceStatusDisplay';

beforeAll(() => {
  (globalThis as unknown as { _: (value: string) => string })._ = (value) =>
    value;
});

describe('service status display', () => {
  it('reports running and stopped when nothing is in flight', () => {
    expect(getServiceStatusDisplay({ running: true, busy: null })).toEqual({
      label: '✔ Running',
      tone: 'success',
    });
    expect(getServiceStatusDisplay({ running: false, busy: null })).toEqual({
      label: '✘ Stopped',
      tone: 'error',
    });
  });

  // Applying settings cycles the sing-box runtime, so readiness is briefly
  // false. Reporting a stopped service for those seconds is alarming and not
  // actionable; what is true is that an operation is under way.
  it('reports the operation instead of a readiness that is momentarily meaningless', () => {
    expect(getServiceStatusDisplay({ running: false, busy: 'apply' })).toEqual({
      label: '⟳ Applying...',
      tone: 'progress',
    });
    expect(getServiceStatusDisplay({ running: true, busy: 'apply' })).toEqual({
      label: '⟳ Applying...',
      tone: 'progress',
    });
  });

  it.each([
    ['start' as const, '⟳ Starting...'],
    ['stop' as const, '⟳ Stopping...'],
    ['restart' as const, '⟳ Restarting...'],
    ['apply' as const, '⟳ Applying...'],
  ])('names the %s operation', (busy, label) => {
    expect(getServiceStatusDisplay({ running: true, busy })).toEqual({
      label,
      tone: 'progress',
    });
  });
});
