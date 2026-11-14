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

/** Never two polls at once: a poll requested during a poll runs right after it. */
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
