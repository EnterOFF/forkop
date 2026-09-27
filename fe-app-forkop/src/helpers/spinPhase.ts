/** One turn of the loader, shared by the CSS keyframes and the phase below. */
export const SPIN_PERIOD_MS = 1000;

/**
 * The `animation-delay` that puts a freshly built spinner where the one it
 * replaces had got to.
 *
 * A CSS animation is timed from the element it runs on, so every spinner starts
 * its turn at twelve o'clock. Nothing on this page renders in place - a store
 * update hands the widget's container a newly built subtree - so the spinner of a
 * running action is rebuilt for as long as the action lasts.
 *
 * A negative delay starts an animation part-way through, and the document's clock
 * is the one the browser times animations against. Deriving the delay from it
 * gives every spinner the same phase whenever it is built, so a replacement
 * appears at the angle its predecessor had reached.
 */
export function spinPhaseDelayMs(now: number): number {
  return -(now % SPIN_PERIOD_MS);
}

/** The declaration to put on a spinner, read off the document clock. */
export function spinPhaseStyle(): string {
  const timelineTime = document.timeline?.currentTime;
  const now =
    typeof timelineTime === 'number' ? timelineTime : performance.now();

  return `animation-delay: ${spinPhaseDelayMs(now)}ms`;
}
