import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capabilityChanges } from "../lib/capabilities";

const ALL = ["measure_power", "meter_power", "meter_power.daily", "measure_voltage", "measure_frequency", "measure_temperature"];

describe("capabilityChanges", () => {
  it("adds missing capabilities for TCP (devices paired before v1.2 / v1.4)", () => {
    const present = ["measure_power", "meter_power", "measure_voltage"];
    assert.deepEqual(capabilityChanges("tcp", present, ALL), {
      add: ["meter_power.daily", "measure_frequency", "measure_temperature"],
      remove: [],
    });
  });

  it("removes the readings HTTP can't deliver and doesn't add them back", () => {
    assert.deepEqual(capabilityChanges("http", ALL, ALL), {
      add: [],
      remove: ["measure_voltage", "measure_frequency", "measure_temperature"],
    });
  });

  it("restores them when the user switches back to TCP", () => {
    const httpOnly = ["measure_power", "meter_power", "meter_power.daily"];
    assert.deepEqual(capabilityChanges("tcp", httpOnly, ALL).add, ["measure_voltage", "measure_frequency", "measure_temperature"]);
  });
});
