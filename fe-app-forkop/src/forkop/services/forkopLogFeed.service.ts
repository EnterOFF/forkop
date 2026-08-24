import { callUbus } from '../../helpers';
import { logger } from './logger.service';

// The page used to ask for the whole filtered log buffer every five seconds and
// work out for itself which lines were new: 48 KB and 310 ms of router CPU per
// tab, per poll, to notice a line that usually was not there. The state service
// reads only the tail, once for every tab, and hands out lines by cursor - so a
// new line arrives when it is written, and nothing crosses the wire when there
// is none.
const LOG_OBJECT = 'forkop';
const LOG_CALL_TIMEOUT_MS = 5000;
// Past the ceiling the service parks a request for.
const LOG_WAIT_TIMEOUT_MS = 20000;
const LOG_RETRY_MS = 3000;

type LogReply = { cursor?: number; lines?: string[] };

let running = false;
let stopRequested = false;
let cursor = 0;

function isDocumentVisible() {
  return (
    typeof document === 'undefined' ||
    !document.visibilityState ||
    document.visibilityState === 'visible'
  );
}

function adopt(reply: LogReply) {
  if (typeof reply.cursor === 'number') {
    cursor = reply.cursor;
  }
  return reply.lines || [];
}

// True when the service answered, false when it is not there and the caller
// should fall back to polling. The first read only takes the cursor: the lines
// already in the buffer are history, and announcing them would notify about
// everything that happened before the page was opened.
export async function startForkopLogFeed(onNewLog: (line: string) => void) {
  if (running) {
    return true;
  }

  const first = await callUbus<LogReply>({
    object: LOG_OBJECT,
    method: 'logs',
    timeoutMs: LOG_CALL_TIMEOUT_MS,
  });

  if (!first.success) {
    return false;
  }

  adopt(first.data);
  running = true;
  stopRequested = false;

  void (async () => {
    try {
      while (!stopRequested) {
        if (!isDocumentVisible()) {
          await new Promise((resolve) => setTimeout(resolve, LOG_RETRY_MS));
          continue;
        }

        const response = await callUbus<LogReply>({
          object: LOG_OBJECT,
          method: 'logs_wait',
          params: { cursor },
          timeoutMs: LOG_WAIT_TIMEOUT_MS,
        });

        if (stopRequested) {
          break;
        }

        if (response.success) {
          for (const line of adopt(response.data)) {
            try {
              onNewLog(line);
            } catch (error) {
              logger.error('[LOG_FEED]', 'listener failed', error);
            }
          }
          continue;
        }

        if (response.unavailable) {
          logger.info('[LOG_FEED]', 'log feed went away', response.message);
          break;
        }

        logger.error('[LOG_FEED]', 'log wait failed', response.message);
        await new Promise((resolve) => setTimeout(resolve, LOG_RETRY_MS));
      }
    } finally {
      running = false;
    }
  })();

  return true;
}

export function stopForkopLogFeed() {
  stopRequested = true;
}

export function isForkopLogFeedRunning() {
  return running;
}

export function resetForkopLogFeed() {
  running = false;
  stopRequested = false;
  cursor = 0;
}
