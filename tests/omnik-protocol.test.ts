import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ParseError } from "../lib/errors";
import { OmnikProtocol } from "../lib/omnik-tcp-client";
import { buildFrame } from "./helpers/frames";

describe("OmnikProtocol.buildRequest", () => {
  it("builds the 16-byte frame with the S/N twice, little-endian, and a checksum", () => {
    const sn = 0x12345678;
    const frame = OmnikProtocol.buildRequest(sn);
    assert.equal(frame.length, 16);
    assert.deepEqual([...frame.subarray(0, 4)], [0x68, 0x02, 0x40, 0x30]);
    assert.deepEqual([...frame.subarray(4, 8)], [0x78, 0x56, 0x34, 0x12]);
    assert.deepEqual([...frame.subarray(8, 12)], [0x78, 0x56, 0x34, 0x12]);
    assert.deepEqual([...frame.subarray(12, 14)], [0x01, 0x00]);
    const sum = 115 + 2 * (0x78 + 0x56 + 0x34 + 0x12);
    assert.equal(frame[14], sum & 0xff);
    assert.equal(frame[15], 0x16);
  });
});

describe("OmnikProtocol.parseResponse", () => {
  it("reads name, power, voltage, frequency, energy and temperature", () => {
    const data = OmnikProtocol.parseResponse(buildFrame());
    assert.deepEqual(data, {
      inverterName: "TESTINVERTER0001",
      currentPower: 1234,
      currentVoltage: 230.1,
      currentFrequency: 50.01,
      dailyProduction: 12.5,
      totalProduction: 12345.6,
      currentTemperature: 31.2,
    });
  });

  it("sums positive phase powers and averages positive phase voltages", () => {
    const data = OmnikProtocol.parseResponse(
      buildFrame({ powers: [1000, 500, -1], voltagesRaw: [2300, 2320, -1] }),
    );
    assert.equal(data.currentPower, 1500);
    assert.equal(data.currentVoltage, 231);
  });

  it("reports 0 W and 0 V when no phase is positive", () => {
    const data = OmnikProtocol.parseResponse(buildFrame({ powers: [0, 0, 0], voltagesRaw: [0, 0, 0] }));
    assert.equal(data.currentPower, 0);
    assert.equal(data.currentVoltage, 0);
  });

  it("turns unset sensors (0xFFFF / 0xFFFFFFFF) into NaN instead of huge meter values", () => {
    const data = OmnikProtocol.parseResponse(
      buildFrame({ frequencyRaw: 0xffff, dailyRaw: 0xffff, totalRaw: 0xffffffff, temperatureRaw: -1 }),
    );
    assert.ok(Number.isNaN(data.currentFrequency));
    assert.ok(Number.isNaN(data.dailyProduction));
    assert.ok(Number.isNaN(data.totalProduction));
    assert.ok(Number.isNaN(data.currentTemperature));
  });

  it("throws ParseError on a frame shorter than 75 bytes", () => {
    assert.throws(() => OmnikProtocol.parseResponse(Buffer.alloc(74)), ParseError);
  });
});
