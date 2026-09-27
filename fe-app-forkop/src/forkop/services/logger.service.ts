type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// What the page says about itself goes to the browser console at the level it
// was said at, with its arguments as they are, so an error keeps its stack.
function write(level: LogLevel, args: unknown[]) {
  console[level](`[${level.toUpperCase()}]`, ...args);
}

export const logger = {
  debug: (...args: unknown[]) => write('debug', args),
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args),
};
