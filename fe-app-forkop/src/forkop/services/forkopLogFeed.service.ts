import { callUbus } from '../../helpers/callUbus';
import { isDocumentVisible } from '../../helpers/isDocumentVisible';
import { logger } from './logger.service';
import {
  FORKOP_CALL_TIMEOUT_MS,
  FORKOP_SERVICE_OBJECT,
  FORKOP_WAIT_RETRY_MS,
  FORKOP_WAIT_TIMEOUT_MS,
} from './forkopWaitTransport';

// The state service reads the tail of the log once for every tab and hands out
// lines by cursor, so a new line arrives when it is written and nothing crosses
// the wire when there is none.
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The feed lives as long as the page does. Its first answer only gives the
// cursor: the lines already in the buffer are history, and announcing them
// would notify about everything that happened before the page was opened. The
// state service going away - for an upgrade, a crash, or before the page ever
// reached it - pauses the feed until it is back.
export function startForkopLogFeed(onNewLog: (line: string) => void) {
  if (running) {
    return;
  }
  running = true;

  void (async () => {
    let started = false;
    for (;;) {
      if (!isDocumentVisible()) {
        await sleep(FORKOP_WAIT_RETRY_MS);
        continue;
      }

      const response = started
        ? await callUbus<LogReply>({
            object: FORKOP_SERVICE_OBJECT,
            method: 'logs_wait',
            params: { cursor },
            timeoutMs: FORKOP_WAIT_TIMEOUT_MS,
          })
        : await callUbus<LogReply>({
            object: FORKOP_SERVICE_OBJECT,
            method: 'logs',
            timeoutMs: FORKOP_CALL_TIMEOUT_MS,
          });

      if (response.success) {
        const lines = adopt(response.data);
        if (started) {
          for (const line of lines) {
            try {
              onNewLog(line);
            } catch (error) {
              logger.error('[LOG_FEED]', 'listener failed', error);
            }
          }
        }
        started = true;
        continue;
      }

      if (response.unavailable) {
        logger.info('[LOG_FEED]', 'log feed went away', response.message);
        await sleep(FORKOP_LOG_RETRY_MS);
        continue;
      }

      logger.error('[LOG_FEED]', 'log wait failed', response.message);
      await sleep(FORKOP_WAIT_RETRY_MS);
    }
  })();
}
