// Mirrors duration_to_seconds_value in components/updates.uc. The two are kept
// in step by tests/component_update_interval.sh.
function singBoxDurationSeconds(value: string) {
  const multipliers: Record<string, number> = {
    ns: 1e-9,
    us: 1e-6,
    ms: 1e-3,
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  let rest = `${value || ''}`;
  let total = 0;

  while (rest.length) {
    const matched = /^([0-9]+(?:\.[0-9]+)?)(ns|us|ms|s|m|h|d)/.exec(rest);
    if (!matched) {
      return null;
    }
    total += parseFloat(matched[1]) * multipliers[matched[2]];
    rest = rest.slice(matched[0].length);
  }

  return total > 0 ? Math.round(total) : null;
}

// The update check is run by a cron line, not by a timer that remembers when it
// last fired, so an interval cron cannot express exactly has nowhere to live.
// Mirrors due_check_cron_schedule_text in components/updates.uc: a whole number
// of minutes up to 59, of hours up to 23, or exactly one day. The backend
// refuses anything else and never writes the cron line, which would leave the
// checks silently never running.
export function isCronExpressibleInterval(value: string) {
  const seconds = singBoxDurationSeconds(value);
  if (seconds === null) {
    return false;
  }
  if (seconds === 86400) {
    return true;
  }
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return hours >= 1 && hours <= 23;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes >= 1 && minutes <= 59;
  }
  return false;
}
