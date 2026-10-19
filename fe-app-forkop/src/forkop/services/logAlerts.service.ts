import {
  ForkopLogNotification,
  getForkopLogNotification,
  LogNotificationDeduper,
  opensForkopAction,
} from './logNotificationDeduper.service';

// LuCI dismisses an alert by fading it out and then removing it.
function isOpen(node: HTMLElement) {
  return node.isConnected && !node.classList.contains('fade-out');
}

// The alerts the log feed raised. An error reports a step of the action it was
// logged in, so the next action to begin closes them: it either succeeds or
// raises its own.
export class LogAlerts {
  private readonly show: (notification: ForkopLogNotification) => HTMLElement;
  private readonly deduper: LogNotificationDeduper;
  private shown: { line: string; node: HTMLElement }[] = [];

  constructor(
    show: (notification: ForkopLogNotification) => HTMLElement,
    deduper = new LogNotificationDeduper(),
  ) {
    this.show = show;
    this.deduper = deduper;
  }

  // The alerts the page LuCI just reloaded still had open.
  reopen(lines: string[]) {
    lines.forEach((line) => this.raise(line));
  }

  read(line: string) {
    if (opensForkopAction(line)) {
      this.shown.splice(0).forEach(({ node }) => node.remove());
    }
    if (this.deduper.shouldNotify(line)) {
      this.raise(line);
    }
  }

  openLines() {
    return this.shown
      .filter(({ node }) => isOpen(node))
      .map(({ line }) => line);
  }

  private raise(line: string) {
    const notification = getForkopLogNotification(line);
    if (notification) {
      this.shown.push({ line, node: this.show(notification) });
    }
  }
}
