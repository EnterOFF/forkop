import { callUbus } from '../../helpers/callUbus';
import { logger } from './logger.service';
import {
  FORKOP_CALL_TIMEOUT_MS,
  FORKOP_SERVICE_OBJECT,
} from './forkopWaitTransport';

// The state service reads the tail of the log once for every tab and hands out
// lines by cursor. They ride on the page's one parked request for the state, so
// a new line arrives when it is written and nothing crosses the wire when there
// is none.
export type LogReply = { cursor?: number; lines?: string[] };

let started = false;
let cursor: number | undefined;
let onLine: (line: string) => void = () => {};

// The cursor the feed has read up to. Undefined until the feed knows where the
// log stands, and until then the state wait asks for no lines.
export function getForkopLogCursor() {
  return cursor;
}

// The feed lives as long as the page does. A page that takes over from the one
// LuCI just reloaded goes on from that page's cursor.
export function startForkopLogFeed(
  onNewLog: (line: string) => void,
  resumeFrom = 0,
) {
  if (started) {
    return;
  }
  started = true;
  onLine = onNewLog;

  if (resumeFrom > 0) {
    cursor = resumeFrom;
  }
}

// Asked by the state wait before it parks, until it has an answer. The feed
// starts from where the log stands: the lines already in the buffer are
// history, and announcing them would notify about everything that happened
// before the page was opened.
export async function placeForkopLogFeed() {
  if (!started || cursor !== undefined) {
    return;
  }

  const response = await callUbus<LogReply>({
    object: FORKOP_SERVICE_OBJECT,
    method: 'logs',
    timeoutMs: FORKOP_CALL_TIMEOUT_MS,
  });

  if (response.success) {
    cursor = response.data.cursor ?? 0;
    return;
  }

  logger.info('[LOG_FEED]', 'log position unknown', response.message);
}

// What a state wait sent with the feed's cursor brought back.
export function takeForkopLogLines(reply: LogReply) {
  if (cursor === undefined || typeof reply.cursor !== 'number') {
    return;
  }

  cursor = reply.cursor;
  for (const line of reply.lines || []) {
    try {
      onLine(line);
    } catch (error) {
      logger.error('[LOG_FEED]', 'listener failed', error);
    }
  }
}
