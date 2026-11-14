import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dailyProductionChanged,
  localDay,
  pollFailureAction,
  productionTransition,
  readingOrNull,
  shouldResetDaily,
  shouldWriteTotal,
} from "../lib/production";

describe("productionTransition", () => {
  it("never fires on the first observation after a restart", () => {
    assert.equal(productionTransition(undefined, 500), null);
    assert.equal(productionTransition(undefined, 0), null);
  });

  it("fires started on 0 -> >0 and stopped on >0 -> 0", () => {
    assert.equal(productionTransition(0, 120), "started");
    assert.equal(productionTransition(120, 0), "stopped");
  });

  it("does not fire while the state stays the same", () => {
    assert.equal(productionTransition(100, 250), null);
    assert.equal(productionTransition(0, 0), null);
  });

  it("ignores non-finite readings on either side", () => {
    assert.equal(productionTransition(NaN, 100), null);
    assert.equal(productionTransition(100, NaN), null);
  });
});

describe("readingOrNull", () => {
  it("passes finite values and maps NaN to null", () => {
    assert.equal(readingOrNull(230.1), 230.1);
    assert.equal(readingOrNull(0), 0);
    assert.equal(readingOrNull(NaN), null);
  });
});

describe("shouldWriteTotal", () => {
  it("writes a positive lifetime total", () => {
    assert.equal(shouldWriteTotal(1234.5, 1200), true);
  });

  it("never lets the lifetime total drop to 0 once it has a value", () => {
    assert.equal(shouldWriteTotal(0, 1200), false);
  });

  it("writes 0 when there is no previous value", () => {
    assert.equal(shouldWriteTotal(0, null), true);
  });

  it("skips unreadable totals", () => {
    assert.equal(shouldWriteTotal(NaN, null), false);
  });
});

describe("pollFailureAction", () => {
  it("keeps the last values after a single failed poll (daytime glitch)", () => {
    assert.equal(pollFailureAction(undefined, true, 1), "keep_last");
    assert.equal(pollFailureAction("mark_unavailable", true, 1), "keep_last");
  });

  it("treats an unreachable inverter as off by default once polls keep failing (night shutdown)", () => {
    assert.equal(pollFailureAction(undefined, true, 2), "report_off");
    assert.equal(pollFailureAction("keep_available", true, 5), "report_off");
  });

  it("marks unavailable when the user chose the legacy behaviour", () => {
    assert.equal(pollFailureAction("mark_unavailable", true, 2), "mark_unavailable");
  });

  it("does not flip an unavailable device back to 'off' on another failure", () => {
    assert.equal(pollFailureAction("keep_available", false, 3), "mark_unavailable");
  });
});

describe("localDay", () => {
  it("uses the Homey time zone, not UTC", () => {
    const lateEvening = new Date("2026-06-01T22:30:00Z");
    assert.equal(localDay(lateEvening, "UTC"), "2026-06-01");
    assert.equal(localDay(lateEvening, "Europe/Amsterdam"), "2026-06-02");
  });
});

describe("shouldResetDaily", () => {
  it("resets the daily total once the last reading is from an earlier day", () => {
    assert.equal(shouldResetDaily("2026-06-01", "2026-06-02"), true);
  });

  it("keeps it on the same day and before the first reading", () => {
    assert.equal(shouldResetDaily("2026-06-02", "2026-06-02"), false);
    assert.equal(shouldResetDaily(undefined, "2026-06-02"), false);
  });
});

describe("dailyProductionChanged", () => {
  it("does not fire for the first value of a new device", () => {
    assert.equal(dailyProductionChanged(null, 1.2), false);
  });

  it("fires when the value changes", () => {
    assert.equal(dailyProductionChanged(1.2, 1.3), true);
    assert.equal(dailyProductionChanged(1.3, 1.3), false);
  });
});
