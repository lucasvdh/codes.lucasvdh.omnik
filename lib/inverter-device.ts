import Homey from "homey";

/**
 * Base class for inverter devices that poll their hardware. The next poll is scheduled only
 * after the previous one finished, so polls never overlap or queue up. A generation counter
 * makes a rescheduled loop drop a timer that was already pending.
 */
export abstract class InverterDevice extends Homey.Device {
  /** Refresh interval in minutes, from the `interval` setting. */
  protected interval?: number;

  private timer?: NodeJS.Timeout;
  private polling = false;
  private stopped = false;
  private generation = 0;

  async onInit(): Promise<void> {
    this.interval = this.getSetting("interval") as number | undefined;
    if (!this.interval) {
      throw new Error("Expected interval to be set");
    }
    this.runTick(this.generation);
  }

  abstract checkProduction(): Promise<void>;

  /** Apply a new polling interval (minutes). Reschedules the next tick. */
  protected resetInterval(newIntervalMinutes: number): void {
    this.interval = newIntervalMinutes;
    this.cancelTimer();
    // A poll in flight reschedules from tick()'s finally block with the new interval.
    if (!this.polling) this.scheduleNext();
  }

  async onUninit(): Promise<void> {
    this.teardown();
  }

  async onDeleted(): Promise<void> {
    this.teardown();
  }

  private runTick(gen: number): void {
    this.tick(gen).catch((err) => this.error("[poller] tick failed", err));
  }

  private async tick(gen: number): Promise<void> {
    if (this.stopped || gen !== this.generation) return;

    if (this.polling) {
      this.log("[poller] skipping tick: previous check still running");
      return;
    }

    this.polling = true;
    try {
      await this.checkProduction();
    } catch (err) {
      // checkProduction handles its own errors; this keeps the loop alive if it doesn't.
      this.error("[poller] checkProduction threw", err);
    } finally {
      this.polling = false;
      this.scheduleNext();
    }
  }

  private scheduleNext(): void {
    if (this.stopped || !this.interval) return;
    const gen = ++this.generation;
    this.timer = this.homey.setTimeout(() => this.runTick(gen), this.interval * 60_000);
  }

  private cancelTimer(): void {
    if (this.timer) {
      this.homey.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private teardown(): void {
    this.stopped = true;
    this.generation++;
    this.cancelTimer();
  }
}
