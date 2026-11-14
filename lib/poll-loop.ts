export interface TimerHost {
  setTimeout(callback: () => void, ms: number): NodeJS.Timeout;
  clearTimeout(timer: NodeJS.Timeout | undefined): void;
}

export interface PollLoopOptions {
  timers: TimerHost;
  poll: () => Promise<void>;
  intervalMs: () => number;
  onError: (err: unknown) => void;
}

/**
 * One poll at a time. The next poll is scheduled after the previous one finished, and a poll
 * requested while one is running (settings change) runs right after it, never in parallel.
 */
export class PollLoop {
  private timer?: NodeJS.Timeout;
  private polling = false;
  private rerunRequested = false;
  private stopped = false;

  constructor(private readonly opts: PollLoopOptions) {}

  start(): void {
    this.stopped = false;
    this.pollNow();
  }

  /** Poll as soon as possible: now when idle, otherwise right after the running poll. */
  pollNow(): void {
    if (this.stopped) return;
    if (this.polling) {
      this.rerunRequested = true;
      return;
    }
    this.cancelTimer();
    this.run();
  }

  /** The interval changed: replace the pending timer (a running poll reschedules itself). */
  reschedule(): void {
    if (this.stopped || this.polling) return;
    this.cancelTimer();
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    this.rerunRequested = false;
    this.cancelTimer();
  }

  private run(): void {
    this.polling = true;
    this.opts
      .poll()
      .catch((err: unknown) => this.opts.onError(err))
      .finally(() => {
        this.polling = false;
        if (this.stopped) return;
        if (this.rerunRequested) {
          this.rerunRequested = false;
          this.run();
          return;
        }
        this.scheduleNext();
      });
  }

  private scheduleNext(): void {
    const ms = this.opts.intervalMs();
    if (!(ms > 0)) return;
    this.timer = this.opts.timers.setTimeout(() => {
      this.timer = undefined;
      this.pollNow();
    }, ms);
  }

  private cancelTimer(): void {
    this.opts.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
