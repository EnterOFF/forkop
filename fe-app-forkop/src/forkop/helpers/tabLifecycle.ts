// How long a tab keeps its live updates once it is out of view: another tab of
// the page or another window and back finds them still running instead of
// starting over, while a tab left behind stops asking the router for what
// nobody is looking at.
export const TAB_HIDDEN_GRACE_MS = 10000;

// Starts a tab's updates when it comes into view and stops them once it has
// been out of view for the grace period. update() is called whenever shown()
// may have changed.
export function createTabLifecycle(options: {
  shown: () => boolean;
  start: () => void;
  stop: () => void;
  graceMs?: number;
}) {
  const graceMs = options.graceMs ?? TAB_HIDDEN_GRACE_MS;
  let running = false;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelStop = () => {
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
  };

  return {
    update() {
      if (options.shown()) {
        cancelStop();
        if (!running) {
          running = true;
          options.start();
        }
        return;
      }

      if (!running || stopTimer) {
        return;
      }

      stopTimer = setTimeout(() => {
        stopTimer = null;
        if (!options.shown()) {
          running = false;
          options.stop();
        }
      }, graceMs);
    },
  };
}
