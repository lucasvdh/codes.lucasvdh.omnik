import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capabilityOptionsDiffer } from "../lib/capability-options";

describe("capabilityOptionsDiffer", () => {
  const wanted = { title: { en: "Today", nl: "Vandaag" }, decimals: 2 };

  it("is false when the device already has these options (extra options don't matter)", () => {
    assert.equal(capabilityOptionsDiffer({ ...wanted, units: "kWh" }, wanted), false);
  });

  it("is true for a missing or changed option", () => {
    assert.equal(capabilityOptionsDiffer({ decimals: 2 }, wanted), true);
    assert.equal(capabilityOptionsDiffer({ ...wanted, title: { en: "Today" } }, wanted), true);
    assert.equal(capabilityOptionsDiffer(undefined, wanted), true);
  });
});
