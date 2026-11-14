import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { movedAddress, normalizeMac } from "../lib/mac";

describe("normalizeMac", () => {
  it("accepts the common notations", () => {
    for (const input of ["ac:cf:23:00:00:01", "ACCF23000001", "ac-cf-23-00-00-01"]) {
      assert.equal(normalizeMac(input), "AC:CF:23:00:00:01", input);
    }
  });

  it("rejects anything else", () => {
    for (const input of ["", "ac:cf:23", "zz:cf:23:00:00:01", undefined, 42]) {
      assert.equal(normalizeMac(input), null, String(input));
    }
  });
});

describe("movedAddress", () => {
  it("returns the new IP when the device's module shows up elsewhere (DHCP change)", () => {
    assert.equal(movedAddress("AC:CF:23:00:00:01", "accf23000001", "192.168.1.50", "192.168.1.42"), "192.168.1.50");
  });

  it("ignores other modules, unchanged addresses and devices without a stored MAC", () => {
    assert.equal(movedAddress("AC:CF:23:00:00:01", "AC:CF:23:00:00:02", "192.168.1.50", "192.168.1.42"), null);
    assert.equal(movedAddress("AC:CF:23:00:00:01", "AC:CF:23:00:00:01", "192.168.1.42", " 192.168.1.42 "), null);
    assert.equal(movedAddress(undefined, "AC:CF:23:00:00:01", "192.168.1.50", "192.168.1.42"), null);
  });
});
