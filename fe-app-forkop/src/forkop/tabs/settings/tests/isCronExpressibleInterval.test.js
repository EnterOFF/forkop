import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { isCronExpressibleInterval } from '../durations';

// The update check is scheduled by a cron line and nothing else remembers when it
// last ran, so an interval cron cannot express exactly is refused by the backend:
// no line is written and the checks silently never run. The settings form has to
// refuse exactly the same values, or the field accepts something that quietly
// turns the feature off.
//
// Two implementations of one rule cannot be avoided - a static LuCI view cannot
// call ucode while validating a field - so both sides are driven over the same
// list. The backend half is tests/updates/component_update_interval.sh.
const intervals = JSON.parse(
  fs.readFileSync(
    path.resolve(
      import.meta.dirname,
      '../../../../../../tests/fixtures/cron_intervals.json',
    ),
    'utf8',
  ),
);

describe('isCronExpressibleInterval', () => {
  it('has a list to check against', () => {
    expect(intervals.accepted.length).toBeGreaterThan(0);
    expect(intervals.refused.length).toBeGreaterThan(0);
  });

  it.each(intervals.accepted)('accepts %s', (value) => {
    expect(isCronExpressibleInterval(value)).toBe(true);
  });

  it.each(intervals.refused)('refuses %s', (value) => {
    expect(isCronExpressibleInterval(value)).toBe(false);
  });
});
