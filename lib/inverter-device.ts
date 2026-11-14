import Homey from "homey";
import { PollLoop } from "./poll-loop";

/** Base class for inverter devices that poll their hardware through a PollLoop. */
export abstract class InverterDevice extends Homey.Device {
  /** Refresh interval in minutes, from the `interval` setting. */
  protected interval?: number;

  private loop?: PollLoop;

  async onInit(): Promise<void> {
    this.interval = this.getSetting("interval") as number | undefined;
    if (!this.interval) {
      throw new Error("Expected interval to be set");
    }
    this.loop = new PollLoop({
      timers: this.homey,
      poll: () => this.checkProduction(),
      intervalMs: () => (this.interval ?? 0) * 60_000,
      onError: (err) => this.error("[poller] checkProduction threw", err),
    });
    this.loop.start();
  }

  abstract checkProduction(): Promise<void>;

  /** Apply a new polling interval (minutes). */
  protected resetInterval(newIntervalMinutes: number): void {
    this.interval = newIntervalMinutes;
    this.loop?.reschedule();
  }

  /** Poll now, or right after the poll that is running. Never runs two polls at once. */
  protected pollNow(): void {
    this.loop?.pollNow();
  }

  async onUninit(): Promise<void> {
    this.loop?.stop();
  }

  async onDeleted(): Promise<void> {
    this.loop?.stop();
  }
}
