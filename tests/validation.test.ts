import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeIpv4, parseWifiSn } from "../lib/validation";

describe("normalizeIpv4", () => {
  it("accepts an IPv4 address and trims stray whitespace", () => {
    assert.equal(normalizeIpv4("192.168.1.42"), "192.168.1.42");
    assert.equal(normalizeIpv4(" 192.168.1.42 "), "192.168.1.42");
  });

  it("rejects incomplete or invalid addresses", () => {
    for (const input of ["", "192.168.1.", "192.168.1.300", "inverter.local", undefined, 42]) {
      assert.equal(normalizeIpv4(input), null, String(input));
    }
  });
});

describe("parseWifiSn", () => {
  it("accepts a numeric S/N that fits in 32 bits", () => {
    assert.equal(parseWifiSn("1612345678"), 1612345678);
    assert.equal(parseWifiSn(" 4294967295 "), 4294967295);
    assert.equal(parseWifiSn(1612345678), 1612345678);
  });

  it("rejects text, zero and values the binary protocol can't carry", () => {
    for (const input of ["abc", "", "0", "6041234567", "16123.5", -1, Number.NaN, undefined]) {
      assert.equal(parseWifiSn(input), null, String(input));
    }
  });
});
