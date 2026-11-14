// Homey-free decisions for turning inverter readings into capability values and Flow triggers.

import type { OfflineBehavior } from "./types";

export type ProductionTransition = "started" | "stopped" | null;

/**
 * 0 <-> >0 transition of measure_power. The first observation after a (re)start is only a
 * baseline and never fires; non-finite readings never count as a transition.
 */
export function productionTransition(
  previous: number | undefined,
  current: number,
): ProductionTransition {
  if (previous === undefined || !Number.isFinite(previous) || !Number.isFinite(current)) return null;
  const wasProducing = previous > 0;
  const isProducing = current > 0;
  if (wasProducing === isProducing) return null;
  return isProducing ? "started" : "stopped";
}

/** Sensors the protocol can't deliver come through as NaN; Homey shows null as "-". */
export function readingOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/**
 * meter_power is lifetime kWh. Insights treats a drop to 0 or null as a regression that breaks
 * monthly totals, so a 0 is only written when there is no previous value.
 */
export function shouldWriteTotal(total: number, previousTotal: number | null): boolean {
  if (!Number.isFinite(total)) return false;
  return total > 0 || previousTotal == null;
}

export type PollFailureAction = "report_off" | "mark_unavailable";

/**
 * keep_available (default): the inverter and its WiFi module power down at night, so an
 * unreachable inverter is treated as "off" (power 0) while the device is available.
 * Once the device is already unavailable, only a successful poll brings it back.
 */
export function pollFailureAction(
  behavior: OfflineBehavior | undefined,
  available: boolean,
): PollFailureAction {
  return (behavior ?? "keep_available") === "keep_available" && available
    ? "report_off"
    : "mark_unavailable";
}

/** Calendar day (YYYY-MM-DD) in the Homey's time zone. */
export function localDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * The inverter only resets "today" when it wakes up, so without this the previous day's
 * value would stay on screen (and in conditions) from midnight until sunrise.
 */
export function shouldResetDaily(lastReadingDay: string | undefined, today: string): boolean {
  return lastReadingDay !== undefined && lastReadingDay !== today;
}

/** The first value of a new device is a baseline, not a change. */
export function dailyProductionChanged(previous: number | null, next: number): boolean {
  return previous != null && previous !== next;
}
