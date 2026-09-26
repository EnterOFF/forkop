import { callUbus } from '../../helpers';
import { isDocumentVisible } from '../../helpers/isDocumentVisible';
import { logger } from './logger.service';
import {
  FORKOP_CALL_TIMEOUT_MS,
  FORKOP_SERVICE_OBJECT,
  FORKOP_WAIT_RETRY_MS,
  FORKOP_WAIT_TIMEOUT_MS,
} from './forkopWaitTransport';

// The page used to ask for the whole filtered log buffer every five seconds and
// work out for itself which lines were new: 48 KB and 310 ms of router CPU per
// tab, per poll, to notice a line that usually was not there. The state service
// reads only the tail, once for every tab, and hands out lines by cursor - so a
// new line arrives when it is written, and nothing crosses the wire when there
// is none.
type LogReply = { cursor?: number; lines?: string[] };

const FORKOP_LOG_RETRY_MS = 5000;

let running = false;
let cursor = 0;

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
    object: FORKOP_SERVICE_OBJECT,
    method: 'logs',
    timeoutMs: FORKOP_CALL_TIMEOUT_MS,
  });

  if (!first.success) {
    return false;
  }

  adopt(first.data);
  running = true;

  // The feed lives as long as the page does; the service going away pauses it.
  void (async () => {
    try {
      for (;;) {
        if (!isDocumentVisible()) {
          await new Promise((resolve) =>
            setTimeout(resolve, FORKOP_WAIT_RETRY_MS),
          );
          continue;
        }

        const response = await callUbus<LogReply>({
          object: FORKOP_SERVICE_OBJECT,
          method: 'logs_wait',
          params: { cursor },
          timeoutMs: FORKOP_WAIT_TIMEOUT_MS,
        });

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

        // The state service goes away for an upgrade or a crash and comes
        // back, and the feed with it.
        if (response.unavailable) {
          logger.info('[LOG_FEED]', 'log feed went away', response.message);
          await new Promise((resolve) =>
            setTimeout(resolve, FORKOP_LOG_RETRY_MS),
          );
          continue;
        }

        logger.error('[LOG_FEED]', 'log wait failed', response.message);
        await new Promise((resolve) =>
          setTimeout(resolve, FORKOP_WAIT_RETRY_MS),
        );
      }
    } finally {
      running = false;
    }
  })();

  return true;
}
