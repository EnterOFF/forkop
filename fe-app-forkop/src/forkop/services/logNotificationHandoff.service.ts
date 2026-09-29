import { getSessionStorage } from './sessionStorage.service';

// LuCI reloads the page a moment after it applied a change, so the alerts an
// apply raised and the lines written while the next page loads would be lost
// with the old page. The page leaving hands both to the next one: the alerts
// still open, and the log cursor to go on reading from.
const HANDOFF_STORAGE_KEY = 'forkop:log-notification-handoff:v1';

// An apply reloads the page within seconds. A handoff older than this was left
// by a page the user navigated away from, and its lines are history.
const HANDOFF_MAX_AGE_MS = 30000;

export type LogNotificationHandoff = { cursor: number; lines: string[] };

export function saveLogNotificationHandoff(
  handoff: LogNotificationHandoff,
  storage: Storage | null = getSessionStorage(),
  now = Date.now(),
) {
  try {
    storage?.setItem(
      HANDOFF_STORAGE_KEY,
      JSON.stringify({ at: now, cursor: handoff.cursor, lines: handoff.lines }),
    );
  } catch {
    // Without storage the next page starts reading where the log stands.
  }
}

export function dropLogNotificationHandoff(
  storage: Storage | null = getSessionStorage(),
) {
  try {
    storage?.removeItem(HANDOFF_STORAGE_KEY);
  } catch {
    // Nothing was stored.
  }
}

export function takeLogNotificationHandoff(
  storage: Storage | null = getSessionStorage(),
  now = Date.now(),
): LogNotificationHandoff | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(HANDOFF_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  dropLogNotificationHandoff(storage);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const age = now - Number(parsed?.at);
    if (
      !(age >= 0 && age <= HANDOFF_MAX_AGE_MS) ||
      typeof parsed.cursor !== 'number' ||
      !Array.isArray(parsed.lines)
    ) {
      return null;
    }
    return {
      cursor: parsed.cursor,
      lines: parsed.lines.filter(
        (line: unknown): line is string => typeof line === 'string',
      ),
    };
  } catch {
    return null;
  }
}
